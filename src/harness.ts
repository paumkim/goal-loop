/**
 * Harness-owned judge and planner children plus the report helpers shared with the prompt/context hooks.
 * The lifecycle itself lives in ./host-child.ts; this module owns the generation decisions.
 */
import type { Plugin } from "@opencode/plugin"
import type { GoalConfig } from "./core/config.ts"
import type { Logger, EmitterPort } from "./runtime/ports.ts"
import type { GoalController } from "./runtime/controller.ts"
import type { ModelRef } from "./core/types.ts"
import type { PlannedGoal } from "./core/planner.ts"
import { ABSTENTION_REASON, evaluationAbstention } from "./core/evaluation-gate.ts"
import { EVALUATOR_AGENT_ID, EVALUATOR_AGENT_TITLE, isEvaluatorReport, verdictFromNativeReport } from "./core/evaluator-agent.ts"
import { PLANNER_AGENT_ID, PLANNER_AGENT_TITLE, parsePlan, planGoalRequest } from "./core/planner.ts"
import { backgroundResultID, nativeEvaluationRequest, stripGoalEvaluations } from "./core/prompts.ts"
import { currentTurnStart, renderParentSummary } from "./core/transcript.ts"
import { spawnHostChild, type ChildEvent } from "./host-child.ts"

export interface HarnessDeps {
  readonly ctx: Plugin.Context
  readonly config: GoalConfig
  readonly log: Logger
  readonly lifetime: AbortController
  readonly probe: boolean
  /** Nested headless children are workers, not goal owners: they never spawn a judge or planner child. */
  readonly nestedHeadless: boolean
  readonly controller: () => GoalController
  readonly background: () => { noteInternal(id: string, agentID: string): void; internalAgentOf(id: string): string | undefined }
  readonly emit: () => EmitterPort
  readonly noteInternal: (id: string, agentID: string) => void
  readonly asEvaluatorError: (value: unknown) => Error
  readonly settle: (ms: number, signal: AbortSignal) => Promise<void>
  readonly planScopeFor: (stored: { condition: string; scope: "trivial" | "code" } | undefined, condition: string) => "trivial" | "code" | undefined
  readonly EVALUATION_SUMMARY_CHARS: number
  readonly EVALUATION_SETTLE_MS: number
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
}

/** One evaluator child per working session, reused across verdicts and loop steps. Cleared on dispose. */
export const evaluatorChildBySession = new Map<string, string>()

/** One arm-time planner child per working session, reused on every arm. Cleared on dispose. */
export const plannerChildBySession = new Map<string, string>()

export function createHarness(deps: HarnessDeps) {
  const { ctx, config, log, lifetime, probe, nestedHeadless, controller, background, emit, noteInternal, asEvaluatorError, settle, planScopeFor, EVALUATION_SUMMARY_CHARS, EVALUATION_SETTLE_MS, sleep } = deps
    // The harness owns one evaluator subagent child per working session. It is created with the working session as
    // its parentID, so OpenCode shows it as a subagent instead of a new top-level session, and it is reused for every
    // verdict and loop generation. The verdict still comes from the child's own event stream and `Evaluator.evaluate`
    // decides: `met` ends the goal (or arms the next loop iteration), `not_met` is the only path that dispatches a
    // continuation steer. Tracked so the generate/context hooks can shape the child's generation without touching
    // worker sessions. Any host completion report is stripped from model-bound context below.
    const evaluatorChildren = new Set<string>()
    /** Host subagent reports are wake signals, not instructions. Per session, admit each report id at most once
     * while a goal is live; once the goal ends, drop them all. Without this a completed report rides every later
     * request and retriggers a no-op wake cycle (stale report -> no edit -> turn ends -> same report injected). */
    const seenBackgroundResults = new Map<string, Set<string>>()
    /** Defensive strip for `<subagent>` completion reports attributed to a judge or arm-time planner child. The
     * verdict / planned condition comes from the child's event stream, never from a report, so a stray report must
     * not teach the worker its own verdict or treat the planner's raw JSON as evidence (SPEC-workstreams.md CXLI).
     * Neither child admits a report into the working session now; this guard keeps a foreign/legacy one inert. */
    const isPluginReport = (message: unknown) => {
      if (!message || typeof message !== "object") return false
      const m = message as Record<string, unknown>
      if (m.type !== "synthetic") return false
      if (isEvaluatorReport(m.metadata)) return true
      const md = m.metadata as Record<string, unknown> | undefined
      return md?.source === "subagent" && typeof md.agent === "string" && md.agent.toLowerCase() === PLANNER_AGENT_ID
    }
    /** A host completion from a harness-owned child is wake plumbing, never worker evidence. `isPluginReport` catches
     * the agent-tagged shape; this catches a report whose metadata is absent or renamed by the child id registered
     * with the background tracker — so restoring the planner's parent link cannot put its raw plan in the worker. */
    const isInternalChildReport = (message: unknown) => {
      const id = backgroundResultID(message)
      return id !== undefined && background().internalAgentOf(id) !== undefined
    }
    /**
     * An injected wake is wake plumbing, not a user decision. While the goal-owning parent keeps moving, the
     * harness admits each child completion report into its inbox and the plugin's own continuations arrive as
     * synthetic steers; both can surface on the prompt hook. Treating either as a user prompt resumed a paused
     * goal on every wake (and could re-arm a loop from a quoted directive). Accept both host shapes: a synthetic
     * message type, a subagent/goal source tag, or a `<background-result>` body.
     */
    const isInjectedPrompt = (event: { readonly prompt?: unknown; readonly metadata?: unknown }): boolean => {
      const prompt = event.prompt
      const fields: unknown[] = [event.metadata, prompt]
      if (prompt && typeof prompt === "object") {
        const p = prompt as Record<string, unknown>
        fields.push(p.metadata, p.type)
        if (typeof p.text === "string") {
          if (/<background-result\b/i.test(p.text)) return true
        }
      }
      return fields.some((field) => {
        if (typeof field === "string") return field.toLowerCase() === "synthetic"
        if (!field || typeof field !== "object") return false
        const source = (field as Record<string, unknown>).source
        if (typeof source !== "string") return false
        const tag = source.toLowerCase()
        return tag === "subagent" || tag === "goal"
      })
    }

    /**
     * One generation on the working session's evaluator subagent child. The child is created on first use with the
     * working session as its parent, then prompted again on later turns and loop steps. No fresh top-level session
     * is spawned for a verdict. Returns the reused child id with this generation's text.
     */
    const spawnEvaluator = async (
      sessionID: string,
      model: ModelRef,
      prompt: string,
      signal: AbortSignal,
    ): Promise<{ text: string; id: string }> => {
      // The judge is a parent-linked child of the goal owner. Register it by id and agent identity so the
      // background tracker never counts this verdict child as a worker the parent delegated and is waiting on;
      // otherwise a still-running judge (reused across loop steps) self-defers the next evaluation.
      const { text, id, failure } = await spawnHostChild({
        host: ctx,
        cache: evaluatorChildBySession,
        active: evaluatorChildren,
        noteInternal: (child, agent) => noteInternal(child, agent),
        sessionID,
        agentID: EVALUATOR_AGENT_ID,
        title: EVALUATOR_AGENT_TITLE,
        model,
        text: prompt,
        signal,
        observe: (run) => {
          const onAbort = () => { run.abort(); run.finish(run.text()) }
          // An external abort is the evaluator's own timeout/interrupt, not a provider failure.
          if (signal.aborted) onAbort()
          else signal.addEventListener("abort", onAbort, { once: true })
          void (async () => {
            try {
              for await (const evt of ctx.event.subscribe({ signal: run.signal })) {
                const data = (evt as ChildEvent).data ?? {}
                if (data.sessionID !== run.id) continue
                if (evt.type === "session.text.delta") run.append(String(data.delta ?? ""))
                if (evt.type === "session.execution.succeeded") { run.abort(); run.finish(run.text()); return }
                if (evt.type === "session.execution.failed") {
                  if (!signal.aborted) { run.fail(data.error ?? data.reason ?? data.message ?? "judge execution failed"); run.abort() }
                  return
                }
              }
            } catch {
              // The subscription was aborted (verdict already delivered) or the event stream closed.
            }
            // A stream that ends without a terminal event must still release the evaluator child, not hang until timeout.
            run.finish(run.text())
          })()
          return () => signal.removeEventListener("abort", onAbort)
        },
        promptRejected: (run, error) => {
          if (signal.aborted) return
          run.fail(error)
          run.abort()
        },
      })
      // Do not admit a `<subagent>` completion into the working session: even queued with `resume: false`, a
      // synthetic is durably admitted to the parent's inbox, so the parent would see the judge's context and be
      // pulled into a turn it never had to take. The terminal toast, HUD pill and durable record carry the visible
      // outcome. The verdict was already read from this child's own event stream. Throw after the text is
      // collected so callers can classify a quota error and pause instead of retrying.
      if (failure !== undefined) throw asEvaluatorError(failure)
      return { text, id }
    }

    // Evaluator self-talk is not evidence: strip every <goal-evaluation> prompt and any judge completion report
    // from the transcript digest, so a child's completion cannot be scored as the parent's own work.
    const evaluatorContext = async (sessionID: string, signal: AbortSignal) =>
      stripGoalEvaluations((await ctx.session.context({ sessionID }, { signal })).filter((message) => !isPluginReport(message)))

    // The harness judges every turn itself: build the authoritative rubric from this turn's work, run it in the
    // working session's reused evaluator subagent child on the session's current model, then pass the child's text
    // through the same contract guard a native `<subagent>` report used to pass. Foreign / echo-mismatch / unreadable
    // text throws, so `Evaluator.evaluate` classifies it as an `EvaluatorVerdictError` instead of trusting a stale
    // verdict.
    const nativeVerdict = async (sessionID: string, signal: AbortSignal, _turn: number) => {
      // A nested headless instance shares the owner's working directory and plugin storage, so it can adopt
      // the owner's live record on restore. It still must not judge it: the live terminal's evaluator is
      // the single verdict authority. Defer before any judge child is spawned or goal state is touched.
      if (nestedHeadless) {
        return { verdict: "not_met" as const, reason: ABSTENTION_REASON["nested-headless"], abstain: "nested-headless" as const }
      }
      // `sessionID` is always the goal-owning parent: descendant sessions never spawn a verdict (the harness
      // injects their reports back into the parent instead). The parent's reply is the evidence; the bundled
      // Planner subagent's distilled condition and scope ride the request through `armedPlanScopes` below.
      const condition = controller().activeCondition(sessionID)
      if (!condition?.trim()) {
        // Empty <condition> is the harness-owned empty-request trigger. Abstain before the judge child is
        // spawned: no verdict text is generated and the controller settles no goal state (see the abstain
        // branch in GoalController.evaluate). The old `return undefined` fell through to a not_met, which
        // advanced the turn on a request with nothing to judge.
        return { verdict: "not_met" as const, reason: ABSTENTION_REASON["empty-condition"], abstain: "empty-condition" as const }
      }
      const model = await sessionModel(sessionID, signal)
      if (!model) throw new Error("judge child model unavailable: session has no active model")
      const digest = (ctx: readonly unknown[]) =>
        renderParentSummary(ctx, { maxChars: EVALUATION_SUMMARY_CHARS, since: currentTurnStart(ctx) })
      let summary = digest(await evaluatorContext(sessionID, signal))
      if (!summary.trim()) {
        // The worker's reply can still be landing at turn end. Give it a bounded window and re-read so the judge
        // scores the turn's real output instead of an empty summary.
        await settle(EVALUATION_SETTLE_MS, signal)
        summary = digest(await evaluatorContext(sessionID, signal))
      }
      // The earliest point where the whole request is visible: condition, fresh evidence (the finished turn's
      // digest) and active-session state. Abstain before spawning the judge child, so an incomplete request
      // emits no verdict at all. Genuine requests keep the exact prompt and reason they always had.
      const abstention = evaluationAbstention({
        condition,
        hasFreshEvidence: Boolean(summary.trim()),
        activeSessions: await controller().isActive(sessionID),
      })
      if (abstention) return { verdict: "not_met" as const, reason: ABSTENTION_REASON[abstention], abstain: abstention }
      const parent = controller().live(sessionID)
      const planScope = planScopeFor(armedPlanScopes.get(sessionID), condition)
      const prompt = nativeEvaluationRequest({
        condition,
        summary,
        ...(planScope ? { armPlanScope: planScope } : {}),
        nonce: Math.random().toString(36).slice(2, 10),
        ...(parent?.loopEnabled
          ? {
              loop: {
                objective: parent.loopObjective ?? condition,
                iteration: parent.loopIteration ?? 1,
                maxLoops: parent.loopMaxLoops ?? config.maxLoops,
                history: parent.loopHistory ?? [],
              },
            }
          : {}),
      })
      const { text } = await spawnEvaluator(sessionID, model, prompt, signal)
      return verdictFromNativeReport({ key: sessionID, body: text, state: "completed" }, condition)
    }

    // Resolve per generation so a /model switch mid-goal is followed on the next verdict.
    const sessionModel = async (sessionID: string, signal: AbortSignal): Promise<ModelRef | undefined> => {
      const current = (await ctx.session.get({ sessionID }, { signal })).model
      return current ? { providerID: current.providerID, id: current.id, ...(current.variant ? { variant: current.variant } : {}) } : undefined
    }

    // Arm-time planner: one short, toolless child reads only the raw (often pasted) /goal body and returns a
    // concise condition. The worker and the evaluator both read the stored result, so they cannot drift. Failure,
    // quota or timeout falls back to the raw text with a minimal directive — never the old heuristic essays.
    const plannerChildren = new Set<string>()
    // The arm-time planner's scope rides into the first evaluation prompt (no new persisted field). A failed
    // planner leaves no new plan, so an old entry must never be applied to the next goal: the stored condition
    // has to match the condition actually being judged. See planScopeFor.
    const armedPlanScopes = new Map<string, { condition: string; scope: "trivial" | "code" }>()
    const PLAN_TIMEOUT_MS = 30_000
    // Hard ceiling on *waiting* for the child. The soft budget above only asks the host to cancel the child prompt;
    // the caller must not receive the raw goal until the child's own stream reports a terminal event.
    const PLAN_WAIT_CEILING_MS = 5 * 60_000
    const planGoal = async (sessionID: string, raw: string): Promise<PlannedGoal | undefined> => {
      // Unit tests mock the host but cannot deliver a planner child's completion; planning is a host-only step.
      if (nestedHeadless || probe || process.env.NODE_ENV === "test" || lifetime.signal.aborted || !raw.trim()) return undefined
      // Show the goal bar during the planning window: the record is armed only after planning completes, so
      // without this transient snapshot the first arm offered nothing but the background toast (screenshot 165841).
      controller().showPlanning(sessionID, raw.trim())
      const budget = AbortSignal.any([lifetime.signal, AbortSignal.timeout(PLAN_TIMEOUT_MS)])
      const model = await sessionModel(sessionID, budget).catch(() => undefined)
      if (!model) {
        controller().endPlanning(sessionID)
        return undefined
      }
      emit().notice({ sessionID, kind: "set", level: "info", title: "goal-loop", message: "Distilling goal into a concise condition…" })
      // The planner is goal-loop machinery, not a worker the owner delegated. Exclude it from busy() so arming a
      // goal cannot self-defer its first evaluation. Registered by id so its completion report is never admitted
      // to the worker as evidence or as a wake signal, parent link or no parent link.
      let childActive = false
      try {
        const { text } = await spawnHostChild({
          host: ctx,
          cache: plannerChildBySession,
          active: plannerChildren,
          noteInternal: (child, agent) => noteInternal(child, agent),
          sessionID,
          agentID: PLANNER_AGENT_ID,
          title: PLANNER_AGENT_TITLE,
          model,
          text: planGoalRequest(raw),
          signal: budget,
          observe: (run) => {
            // The soft budget asks the host to cancel the child prompt, but it is NOT a child outcome: releasing the
            // caller on timeout used to deliver the raw goal while the planner was still working. Wait for the child's
            // own terminal event instead. A dropped event stream re-subscribes; only the hard ceiling ends the wait.
            let timedOut = false
            const onBudgetAbort = () => {
              if (lifetime.signal.aborted) { run.abort(); run.finish(); return }
              if (timedOut) return
              timedOut = true
              log.warn("goal planner exceeded its soft budget; waiting for the child to finish before sending the goal", { sessionID, child: run.id })
              emit().notice({ sessionID, kind: "set", level: "warning", title: "goal-loop", message: "Goal planner is taking longer than expected; waiting for it to finish before sending the goal." })
            }
            if (budget.aborted) onBudgetAbort()
            else budget.addEventListener("abort", onBudgetAbort, { once: true })
            const ceiling = AbortSignal.any([lifetime.signal, AbortSignal.timeout(PLAN_WAIT_CEILING_MS)])
            const onCeiling = () => { run.abort(); run.finish() }
            if (ceiling.aborted) onCeiling()
            else ceiling.addEventListener("abort", onCeiling, { once: true })
            void (async () => {
              while (!run.signal.aborted) {
                try {
                  for await (const evt of ctx.event.subscribe({ signal: run.signal })) {
                    const data = (evt as ChildEvent).data ?? {}
                    if (data.sessionID !== run.id) continue
                    if (evt.type === "session.execution.started") childActive = true
                    if (evt.type === "session.text.delta") { childActive = true; run.append(String(data.delta ?? "")) }
                    // Only a terminal event from THIS generation ends the wait. Stale events from a reused child are
                    // ignored because no started/delta was seen after dispatch. `interrupted` is a real cancellation
                    // outcome: after the soft budget the host may stop the child that way instead of failing it.
                    if (!childActive) continue
                    if (evt.type === "session.execution.succeeded") { run.finish(); return }
                    if (evt.type === "session.execution.failed" || evt.type === "session.execution.interrupted") { run.fail("planner execution failed"); return }
                  }
                } catch {
                  // Stream dropped: re-subscribe until the child itself reports a terminal event.
                }
                if (run.signal.aborted) break
                await sleep(500, run.signal).catch(() => undefined)
              }
              run.finish()
            })()
            return () => {
              budget.removeEventListener("abort", onBudgetAbort)
              ceiling.removeEventListener("abort", onCeiling)
            }
          },
          promptRejected: (run) => {
            // The host refused to admit the child prompt at all: there is no execution to wait for.
            if (!childActive) run.fail("planner prompt refused")
          },
        })
        // Do not admit a `<subagent>` synthetic: even queued with `resume: false`, a synthetic is durably admitted
        // to the parent's inbox, so the parent sees the planner's context and is pulled into a turn it never had to
        // take. The plan is consumed here from this child's own event stream; the planning notice, goal bar and
        // durable record carry the visible outcome. The reused child stays navigable after it finishes. Both the
        // command and prompt-hook callers await this function before delivering the user's kickoff, so that
        // delivery happens only here — after the planner succeeded, failed, was interrupted or hit the hard
        // ceiling, never mid-plan.
        return parsePlan(text)
      } catch (error) {
        log.warn("goal planner failed", { error: String(error) })
        return undefined
      } finally {
        // Lift the check-in suppression whether the planner landed, failed or timed out. A successful arm
        // replaces the runtime anyway; a failed plan restores the still-live wait's schedule.
        controller().endPlanning(sessionID)
      }
    }

  return { evaluatorChildren, plannerChildren, seenBackgroundResults, isPluginReport, isInternalChildReport, isInjectedPrompt, spawnEvaluator, evaluatorContext, nativeVerdict, sessionModel, planGoal, armedPlanScopes }
}
