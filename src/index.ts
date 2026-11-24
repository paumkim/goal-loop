/**
 * goal-loop: `/goal <condition>` and `/goal-loop <objective>` for OpenCode v2.
 *
 * Sets a completion condition for the session; after every turn an evaluator checks it against the conversation
 * and, until it holds, the plugin starts the next turn itself. `/goal-loop` layers a continuous improvement
 * loop on the same machinery: once the evaluator says `met`, the achieved iteration is summarized and the next,
 * harder goal is armed automatically until the loop is cleared, capped, or the evaluator finds nothing left.
 * Mirrors Claude Code's /goal (status, clear aliases, met / not met / impossible verdicts, stall guard, retries,
 * background-work check-ins, restore on restart).
 */
import { estimateContextTokens } from "./core/context-size.ts"
import { Plugin } from "@opencode/plugin"
import { ensureStartupScaffold, hasJq, pluginRootFromMeta, resolveCoordinatorBin } from "./core/bootstrap.ts"
import { resolveConfig } from "./core/config.ts"
import { EVALUATOR_AGENT_ID, EVALUATOR_AGENT_TITLE, EVALUATOR_SYSTEM_PROMPT, isEvaluatorReport, verdictFromNativeReport } from "./core/evaluator-agent.ts"
import { findRepository, resolveCommitPolicy, resolveProjectRoot } from "./core/git.ts"
import { parseBool, parseGoalCommand, parseGoalLoopDirective } from "./core/parse.ts"
import { PLANNER_AGENT_ID, PLANNER_AGENT_TITLE, PLANNER_SYSTEM_PROMPT, parsePlan, planGoalRequest, type PlannedGoal } from "./core/planner.ts"
import { parseVerdict } from "./core/verdict.ts"
import { currentTurnStart, renderParentSummary, renderTranscript } from "./core/transcript.ts"
import { carriesGoalGrammar, compactGoalInstructions, coordinatorFlow, directive as directivePrompt, nativeEvaluationRequest, systemReminder, stripGoalNotes, stripGoalContext, stripGoalEvaluations, isGoalEvaluationMessage, TERMINAL_REMINDER } from "./core/prompts.ts"
import type { ModelRef, UsageSnapshot } from "./core/types.ts"
import { createRpcHandlers } from "./rpc-handlers.ts"
import { GoalRpc } from "./rpc.ts"
import { BackgroundTracker } from "./runtime/background.ts"
import { AutoCompactor } from "./runtime/compactor.ts"
import { GoalController } from "./runtime/controller.ts"
import { Evaluator } from "./runtime/evaluator.ts"
import { createGoalMirror } from "./core/mirror.ts"
import { createRouter, type ServerEvent } from "./runtime/events.ts"
import { systemClock, type EmitterPort, type Logger, type SessionPort } from "./runtime/ports.ts"
import { GoalStore } from "./runtime/store.ts"
import { withFileSink } from "./core/file-log.ts"
// Shared plain-language error formatter (the filename is historical: it was born in the TUI).
import { userFacingError } from "./tui-error.ts"
import { update as cliUpdate } from "../bin/goal-loop.mjs"

const PLUGIN_ID = "goal-loop"

/**
 * The native replay window installed by `/reset-context`. OpenCode's transcript builder replays a completed
 * compaction's `native.messages` *instead of* its summary (`to-llm-message.ts`, `case "compaction"`), and an empty
 * array replays as zero LLM messages. That makes the next request look like a cold session start — fresh system
 * prompt, no conversation messages — while the session ID, its metadata and its on-disk history survive.
 *
 * An empty `summary` is kept as a fallback for hosts predating native replay: there the compaction message renders
 * as a `<conversation-checkpoint>` containing only empty text, still far smaller than a generated summary.
 */
const COLD_REPLAY = { summary: "", native: { messages: [] } }

/**
 * Budget for the *native* evaluator child's evidence digest. Deliberately far below the generation judge's
 * `maxTranscriptChars` (20k): a native child gets the condition explicitly and only needs the worker's latest
 * tool evidence. A large digest in a long-lived session carried prior verdicts about other conditions and
 * drowned out the real one (see renderParentSummary).
 */
const EVALUATION_SUMMARY_CHARS = 4_000

/**
 * The verdict evaluator child created for each working session. After a met verdict the loop's summarizer and
 * next-goal planner are spawned as children of that evaluator session, so planning continues inside it instead of
 * starting another fresh child of the working session. Keyed by the working session id: the runtime already threads
 * that id through every loop call, so no controller or port contract changes.
 */
const verdictChildBySession = new Map<string, string>()

/**
 * The worker's reply can still be landing when the turn ends and the harness builds the judge prompt (a small model
 * once delegated first and wrote its "hi" answer 25 ms later). When the first parent-context read has no usable
 * evidence, wait this bounded window and re-read so the judge scores the turn's real output, not an empty summary.
 * Abortable so a killed goal never parks the verdict.
 */
const EVALUATION_SETTLE_MS = 250
const settle = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) return resolve()
  const onAbort = () => { clearTimeout(timer); resolve() }
  const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve() }, ms)
  signal.addEventListener("abort", onAbort, { once: true })
})

/** Keep the provider's classification text (429 / "free usage limit" / "rate limit") on an evaluator failure so the
 * controller can pause a quota error instead of retrying it as a generic unreadable verdict. */
function asEvaluatorError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const status = typeof record.status === "number" ? `status ${record.status} ` : ""
    const error = new Error(`evaluator child failed (${status}${String(record.message ?? record.type ?? record.error ?? JSON.stringify(record))})`)
    // A provider quota error is an object whose 429/code lives in structured fields, not in the message text
    // ("slow down" carries no quota phrase). Flattening to a string alone drops that signal, so the tightened
    // isUsageLimitError would miss a genuine quota and retry instead of pausing. Carry the structured fields
    // onto the Error so the detector reads the same 429/code it would have read before flattening.
    for (const key of ["status", "code", "type", "name", "error"] as const) {
      const field = record[key]
      if (typeof field === "string" || typeof field === "number") {
        Object.defineProperty(error, key, { value: field, enumerable: true, configurable: true })
      }
    }
    return error
  }
  return new Error(`evaluator child failed (${String(value)})`)
}

const DESCRIPTION = "keep working until a condition is met"
const LOOP_DESCRIPTION = "keep working toward an objective; bare /goal-loop checks for plugin updates; each achieved goal arms an improved one"

function createLogger(): Logger {
  const tag = `[${PLUGIN_ID}]`
  const extra = (value?: Record<string, unknown>) => (value ? [value] : [])
  return {
    info: (message, value) => console.info(tag, message, ...extra(value)),
    warn: (message, value) => console.warn(tag, message, ...extra(value)),
    error: (message, value) => console.error(tag, message, ...extra(value)),
  }
}

function toUsage(info: { cost?: number; tokens?: Partial<{ input: number; output: number; reasoning: number; cache: { read: number; write: number } }> }): UsageSnapshot {
  const tokens = info.tokens ?? {}
  return {
    cost: info.cost ?? 0,
    input: tokens.input ?? 0,
    output: tokens.output ?? 0,
    reasoning: tokens.reasoning ?? 0,
    cacheRead: tokens.cache?.read ?? 0,
    cacheWrite: tokens.cache?.write ?? 0,
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })

/** Env flag: `1/true/yes/on` (case-insensitive) enables; anything else is off. Probe mode makes plugin storage read-only. */
const probeFlag = (value: string | undefined) => parseBool(value) === true

/** Runs a verification command via the user's shell, capturing combined output (tail kept). Never touches plugin storage. */
export function createVerifier() {
  return {
    async verify({ command, cwd, timeoutMs, signal }: { command: string; cwd: string; timeoutMs: number; signal: AbortSignal }) {
      const MAX = 16_000
      // Detached, so the command owns its process group and the budget can kill the whole tree, not just the
      // shell. Measured before this fix: `bash -c 'sleep 3; echo hi'` under a 200ms budget returned at 3003ms —
      // SIGKILL reached only the shell, and the surviving `sleep` still held stdout, so the drain waited for it.
      // A command that starts a server would have waited forever.
      const child = Bun.spawn(["bash", "-c", command], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
        detached: true,
      })
      let output = ""
      // One streaming decoder so a multi-byte sequence split across chunks is not corrupted.
      const decoder = new TextDecoder()
      const append = (chunk: Uint8Array) => {
        output = (output + decoder.decode(chunk, { stream: true })).slice(-MAX)
      }
      const readers: Array<ReadableStreamDefaultReader<Uint8Array>> = []
      // Both streams are drained concurrently: an unread pipe fills the OS buffer and blocks the child.
      const read = async (stream: typeof child.stdout) => {
        if (!stream) return
        const reader = stream.getReader()
        readers.push(reader)
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) append(value)
          }
        } catch {
          // stream closed by kill
        }
      }
      let timedOut = false
      // Kill the group, then cancel the drains. Cancelling matters as much as the kill: a descendant that
      // survives the sweep (or a pipe the kernel has not closed yet) must not stall the very budget that
      // just fired — the result is the tail captured so far, never an open-ended wait.
      const killTree = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL")
          else child.kill("SIGKILL")
        } catch {
          try {
            child.kill("SIGKILL")
          } catch {
            // already gone
          }
        }
        for (const reader of readers) {
          try {
            void reader.cancel().catch(() => {})
          } catch {
            // already released
          }
        }
      }
      const timer = setTimeout(() => {
        timedOut = true
        killTree()
      }, timeoutMs)
      const onAbort = () => killTree()
      // Only arm on a live signal: an already-aborted signal never fires its listener, so a cancel that landed
      // between the controller's signal and this spawn would otherwise have run the command to completion.
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
      try {
        const [code] = await Promise.all([child.exited, read(child.stdout), read(child.stderr)])
        return { code, output, timedOut }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
      }
    },
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const config = resolveConfig(ctx.options, process.env)
    const log = withFileSink(createLogger(), process.env.OPENCODE_GOAL_LOG_FILE)
    const lifetime = new AbortController()

    // Ship the evaluator as a first-class agent type, not just a rubric sent to `general`. `AgentEditor.update`
    // creates the agent when absent (host agent.ts contract), so registering here is idempotent across reloads.
    // `mode: "subagent"` keeps it out of the primary picker; deny-all makes tools impossible even before the
    // generate hook strips them. The visible title and system prompt are what make a verdict look like a real
    // delegated task in the terminal.
    await ctx.agent.transform((editor) => {
      editor.update(EVALUATOR_AGENT_ID, (agent) => {
        agent.name = "Evaluator" as unknown as typeof agent.name
        agent.description = "Judges whether the armed /goal condition holds from visible evidence; replies with one verdict object."
        agent.mode = "subagent"
        agent.hidden = false
        agent.color = "#A78BFA"
        agent.system = EVALUATOR_SYSTEM_PROMPT
        agent.permissions = [{ action: "*", resource: "*", effect: "deny" }] as typeof agent.permissions
      })
      // Arm-time planner: one short child that turns a raw pasted /goal body into a concise, self-contained
      // condition. Deny-all and hidden — it never shows in the primary picker and needs no tools.
      editor.update(PLANNER_AGENT_ID, (agent) => {
        agent.name = PLANNER_AGENT_TITLE as unknown as typeof agent.name
        agent.description = "Distills a raw /goal request into one concise condition before the goal is armed."
        agent.mode = "subagent"
        agent.hidden = true
        agent.system = PLANNER_SYSTEM_PROMPT
        agent.permissions = [{ action: "*", resource: "*", effect: "deny" }] as typeof agent.permissions
      })
    })

    // Startup scaffold: provision an idempotent, ready-to-use workflow on bootstrap (git repos get
    // coordinator/workplace layout, goal runtime dirs, workflow docs/templates, and gitignore rules;
    // non-git dirs get runtime-only setup). Never overwrites user content, never breaks goal arming.
    let coordinatorBin: string | undefined
    try {
      const pluginRoot = pluginRootFromMeta(import.meta.dir)
      const repository = findRepository(ctx.location.directory)
      // Anchor the scaffold at the git root: launching from a subfolder (e.g. docs/) must not create
      // .term in that subfolder. resolveProjectRoot returns the repo root for a subfolder and the
      // directory itself outside a repo, so the runtime-only path still applies there.
      const projectRoot = resolveProjectRoot(ctx.location.directory)
      const startup = ensureStartupScaffold({ projectRoot, pluginRoot, learningPath: config.learning.path })
      if (startup.created.length > 0 || startup.notes.length > 0) {
        log.info("startup scaffold", { created: startup.created, existing: startup.existing, notes: startup.notes })
      } else {
        log.info("startup scaffold", { created: [], existing: startup.existing.length, notes: startup.notes })
      }
      if (repository) {
        coordinatorBin = resolveCoordinatorBin(pluginRoot, repository.root)
        if (config.commit.enabled && config.commit.coordinator !== false && !hasJq()) {
          log.warn("jq not found; coordinator state requires jq")
        }
      }
    } catch (error) {
      log.warn("startup scaffold failed", { error: String(error) })
    }
    const commit = resolveCommitPolicy(config.commit, ctx.location.directory, coordinatorBin)
    log.info("commit rule", { required: commit.required, branch: commit.branch, mode: commit.mode ?? "direct", reason: commit.reason })

    // ---- ports onto the OpenCode context
    const session: SessionPort = {
      prompt: async ({ sessionID, text, delivery, files, agents, skills }) => {
        await ctx.session.prompt({ sessionID, text, delivery, files, agents, skills } as Parameters<typeof ctx.session.prompt>[0])
      },
      synthetic: async (input) => {
        await ctx.session.synthetic(input as Parameters<typeof ctx.session.synthetic>[0])
      },
      usage: async (sessionID) => toUsage(await ctx.session.get({ sessionID })),
      compact: async (sessionID, opts) => {
        // A cold compact is a loop-boundary version bump: mark the session so the compaction hook installs
        // COLD_REPLAY instead of a generated summary. On failure drop the mark so a later ordinary compaction
        // keeps its normal summary. Ordinary auto-compaction never passes `cold`.
        if (opts?.cold) resetPending.add(sessionID)
        try {
          await ctx.session.compact({ sessionID } as Parameters<typeof ctx.session.compact>[0])
        } catch (error) {
          if (opts?.cold) resetPending.delete(sessionID)
          throw error
        }
      },
    }

    // Judge child created by the harness for every verdict. It has no parent link: a parent-linked child makes the
    // host deliver its own "↳ Evaluator finished" completion and wake the working parent unconditionally, which
    // wastes a turn after a verdict the harness has already read. The plugin emits its own queued, non-waking report
    // instead. The verdict still comes from the child's own event stream and `Evaluator.evaluate` decides: `met`
    // ends the goal (or arms the next loop iteration), `not_met` is the only path that dispatches a continuation
    // steer. Tracked so the generate/context hooks can shape the judge's generation without touching worker sessions.
    const evaluatorChildren = new Set<string>()
    /** Plugin-emitted `<subagent>` completion report for a judge child. The verdict comes from the child's event
     * stream, never from this report, so it is stripped from model-bound context: the parent must not narrate or
     * re-judge its own verdict (SPEC-workstreams.md CXLI). Its `delivery: "queue"` / `resume: false` shape keeps it
     * from waking anyone; it exists only for the visible completion. */
    const isJudgeReport = (message: unknown) => {
      if (!message || typeof message !== "object") return false
      const m = message as Record<string, unknown>
      return m.type === "synthetic" && isEvaluatorReport(m.metadata)
    }

    /**
     * One evaluator child generation. Verdict spawns (no explicit parent) record their child id for the working
     * session so later loop-step generations can be parented to that evaluator child. Loop planner spawns pass the
     * recorded id explicitly and are not recorded again. Always returns the child id with its text.
     */
    const spawnEvaluator = async (
      sessionID: string,
      model: ModelRef,
      prompt: string,
      signal: AbortSignal,
      parentID?: string,
    ): Promise<{ text: string; id: string }> => {
      const { id } = await ctx.session.create({
        location: ctx.location,
        ...(parentID ? { parentID } : {}),
        title: EVALUATOR_AGENT_TITLE,
        agent: EVALUATOR_AGENT_ID,
        model: model as any,
      } as any)
      if (!parentID) verdictChildBySession.set(sessionID, id)
      evaluatorChildren.add(id)
      const abort = new AbortController()
      let answer = ""
      let failure: unknown
      let finish!: (value: string) => void
      const done = new Promise<string>((resolve) => { finish = resolve })
      const onAbort = () => { abort.abort(); finish(answer) }
      // An external abort is the evaluator's own timeout/interrupt, not a provider failure.
      const fail = (error: unknown) => {
        if (signal.aborted) return
        if (failure === undefined) failure = error
        abort.abort()
        finish("")
      }
      try {
        if (signal.aborted) onAbort()
        else signal.addEventListener("abort", onAbort, { once: true })
        void (async () => {
          try {
            for await (const evt of ctx.event.subscribe({ signal: abort.signal })) {
              const data = (evt as any).data ?? {}
              if (data.sessionID !== id) continue
              if (evt.type === "session.text.delta") answer += String(data.delta ?? "")
              if (evt.type === "session.execution.succeeded") { abort.abort(); finish(answer); return }
              if (evt.type === "session.execution.failed") {
                fail(data.error ?? data.reason ?? data.message ?? "judge execution failed")
                return
              }
            }
          } catch {
            // The subscription was aborted (verdict already delivered) or the event stream closed.
          }
          // A stream that ends without a terminal event must still release the evaluator child, not hang until timeout.
          finish(answer)
        })()
        // The signal must reach the host prompt: a child turn that ignores an external abort used to keep
        // `spawnEvaluator` parked after `done` had resolved, defeating the evaluator's timeout. No resume opt-out
        // here, exactly as for the planner child: the host only wakes a session's execution when `resume !== false`,
        // so that flag left this fresh child admitted to the inbox but never running (no text deltas, no terminal
        // event, 120s timeout). Race so any abort converges immediately; the text still comes from `done` (the
        // child's text deltas), never from the host's completion report.
        await Promise.race([
          ctx.session.prompt({
            sessionID: id,
            text: prompt,
          } as any, { signal }).catch((error: unknown) => fail(error)),
          done.then(() => undefined),
        ])
        const verdict = await done
        // Verdict children have no parent link, so the host delivers no completion and wakes nobody. Emit the
        // visible completion ourselves: queued and non-waking, with a "Goal Achieved." chip for a met verdict and
        // the evaluator label for every other outcome. Loop-step children are parented to the verdict child, so the
        // host reports those to the evaluator session — emitting one here too would duplicate noise in the worker.
        // The verdict already came from this child's event stream, so a delivery failure is only a lost visual and
        // must never block it. `isJudgeReport` keeps this text out of model context (SPEC-workstreams.md CXLI).
        if (!parentID) {
          const description = parseVerdict(verdict)?.verdict === "met" ? "Goal Achieved." : EVALUATOR_AGENT_TITLE
          try {
            await session.synthetic({
              sessionID,
              description,
              text: `<subagent sessionID="${id}" state="completed" description="${description}">\n${verdict}\n</subagent>`,
              metadata: { source: "subagent", childID: id, agent: EVALUATOR_AGENT_ID, state: "completed" },
              delivery: "queue",
              resume: false,
            })
          } catch (error) {
            log.warn("evaluator subagent report could not be delivered", { error: String(error) })
          }
        }
        // Throw after the text is collected so callers can classify a quota error and pause instead of retrying.
        if (failure !== undefined) throw asEvaluatorError(failure)
        return { text: verdict, id }
      } finally {
        signal.removeEventListener("abort", onAbort)
        evaluatorChildren.delete(id)
        // Judge children persist and stay navigable: no `session.remove` here.
      }
    }

    // Evaluator self-talk is not evidence: strip every <goal-evaluation> prompt and any judge completion report
    // from the transcript digest, so a child's completion cannot be scored as the parent's own work.
    const evaluatorContext = async (sessionID: string, signal: AbortSignal) =>
      stripGoalEvaluations((await ctx.session.context({ sessionID }, { signal })).filter((message) => !isJudgeReport(message)))

    // The harness judges every turn itself: build the authoritative rubric from this turn's work, run it in a
    // parentless judge child on the session's current model, then pass the child's text through the same contract
    // guard a native `<subagent>` report used to pass. Foreign / echo-mismatch / unreadable text throws, so
    // `Evaluator.evaluate` classifies it as an `EvaluatorVerdictError` instead of trusting a stale verdict.
    const nativeVerdict = async (sessionID: string, signal: AbortSignal, _turn: number) => {
      const condition = controller.activeCondition(sessionID)
      if (!condition) return undefined
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
      const parent = controller.live(sessionID)
      const prompt = nativeEvaluationRequest({
        condition,
        summary,
        ...(armedPlanScopes.has(sessionID) ? { armPlanScope: armedPlanScopes.get(sessionID)! } : {}),
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
      return verdictFromNativeReport({ key: sessionID, body: text, state: "completed" }, controller.activeCondition(sessionID))
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
    // The arm-time planner's scope rides into the first evaluation prompt (no new persisted field): a fresh arm
    // overwrites it, so the evaluator always sees the scope of the condition it is actually scoring.
    const armedPlanScopes = new Map<string, "trivial" | "code">()
    const PLAN_TIMEOUT_MS = 30_000
    const planGoal = async (sessionID: string, raw: string): Promise<PlannedGoal | undefined> => {
      // Unit tests mock the host but cannot deliver a planner child's completion; planning is a host-only step.
      if (probe || process.env.NODE_ENV === "test" || lifetime.signal.aborted || !raw.trim()) return undefined
      // Show the goal bar during the planning window: the record is armed only after planning completes, so
      // without this transient snapshot the first arm offered nothing but the background toast (screenshot 165841).
      controller.showPlanning(sessionID, raw.trim())
      const budget = AbortSignal.any([lifetime.signal, AbortSignal.timeout(PLAN_TIMEOUT_MS)])
      const model = await sessionModel(sessionID, budget).catch(() => undefined)
      if (!model) return undefined
      emit.notice({ sessionID, kind: "set", level: "info", title: "goal-loop", message: "Distilling goal into a concise condition…" })
      let id: string
      try {
        id = (await ctx.session.create({
          location: ctx.location,
          parentID: sessionID,
          title: PLANNER_AGENT_TITLE,
          agent: PLANNER_AGENT_ID,
          model: model as any,
        } as any)).id
      } catch (error) {
        log.warn("goal planner child could not be created", { error: String(error) })
        return undefined
      }
      plannerChildren.add(id)
      const abort = new AbortController()
      let answer = ""
      let finish!: () => void
      const done = new Promise<void>((resolve) => { finish = resolve })
      const onAbort = () => { abort.abort(); finish() }
      if (budget.aborted) onAbort()
      else budget.addEventListener("abort", onAbort, { once: true })
      try {
        void (async () => {
          try {
            for await (const evt of ctx.event.subscribe({ signal: abort.signal })) {
              const data = (evt as any).data ?? {}
              if (data.sessionID !== id) continue
              if (evt.type === "session.text.delta") answer += String(data.delta ?? "")
              if (evt.type === "session.execution.succeeded") { finish(); return }
              if (evt.type === "session.execution.failed") { abort.abort(); finish(); return }
            }
          } catch {
            // Subscription closed (completion or abort); the text collected so far is the answer.
          }
          finish()
        })()
        await Promise.race([
          ctx.session.prompt({ sessionID: id, text: planGoalRequest(raw) } as any, { signal: budget }).catch(() => undefined),
          done.then(() => undefined),
        ])
        await done
        return parsePlan(answer)
      } catch (error) {
        log.warn("goal planner failed", { error: String(error) })
        return undefined
      } finally {
        budget.removeEventListener("abort", onAbort)
        plannerChildren.delete(id)
      }
    }

    const evaluator = new Evaluator(
      {
        nativeVerdict,
        // Session mode is still a real child turn: the child has no parent conversation, so embed the parent
        // digest in the prompt (the rubric says "conversation above"). Every judge path now clears the gate.
        sessionGenerate: async (sessionID, prompt, signal) => {
          const model = await sessionModel(sessionID, signal)
          if (!model) throw new Error("inherited evaluator model unavailable: session has no active model")
          const transcript = renderTranscript(await evaluatorContext(sessionID, signal), { maxChars: config.evaluator.maxTranscriptChars })
          const { text } = await spawnEvaluator(
            sessionID,
            model,
            `<conversation>\n${transcript}\n</conversation>\n\n${prompt}`,
            signal,
            verdictChildBySession.get(sessionID),
          )
          return text
        },
        modelGenerate: async (sessionID, model, prompt, signal) => {
          const { text } = await spawnEvaluator(sessionID, model, prompt, signal, verdictChildBySession.get(sessionID))
          return text
        },
        context: evaluatorContext,
        sessionModel,
      },
      config.evaluator,
      commit,
      log,
    )

    const background = new BackgroundTracker({
      parentOf: async (sessionID) => (await ctx.session.get({ sessionID })).parentID,
    })

    // RPC is registered after the controller exists; events emitted before that are simply dropped.
    let emit: EmitterPort = { changed: () => {}, notice: () => {} }
    const emitter: EmitterPort = {
      changed: (sessionID, goal) => emit.changed(sessionID, goal),
      notice: (notice) => emit.notice(notice),
    }

    const probe = probeFlag(process.env.OPENCODE_GOAL_PROBE)
    if (probe) log.warn("probe mode: goal storage is read-only (OPENCODE_GOAL_PROBE); restore() will not persist anything")
    const store = new GoalStore(ctx.storage, (error) => log.error("goal storage write failed", { error: String(error) }), { readOnly: probe })
    // The compactor and the controller need each other: the controller asks the compactor to compact at a loop boundary,
    // and the compactor asks the controller (and the background tracker) whether the session has work in flight.
    // The compactor is assigned before anything can call it, so the deferred closure is safe.
    let compactor!: AutoCompactor
    const controller: GoalController = new GoalController({
      config,
      directory: ctx.location.directory,
      commit,
      // A goal follows its session across directories; re-resolve the commit rule for the new checkout so the
      // agent's directives name the right branch and coordinator policy after a move.
      commitFor: (directory) => resolveCommitPolicy(config.commit, directory, coordinatorBin),
      session,
      evaluator,
      background,
      store,
      emitter,
      verifier: createVerifier(),
      compactAtBoundary: (sessionID, opts) => compactor.compactAtBoundary(sessionID, opts),
      estimateContext: async (sessionID) => estimateContextTokens((await ctx.session.context({ sessionID })) as readonly unknown[]),
      context: async (sessionID) => (await ctx.session.context({ sessionID })) as readonly unknown[],
      clock: systemClock,
      log,
    })
    compactor = new AutoCompactor({
      config,
      compact: (sessionID, opts) => session.compact(sessionID, opts),
      context: async (sessionID) => (await ctx.session.context({ sessionID })) as readonly unknown[],
      emitter,
      clock: systemClock,
      log,
      isBusy: async (sessionID) => {
        const work = await background.busy(sessionID).catch(() => ({ subagents: 0, shells: 0 }))
        return work.subagents + work.shells > 0 || controller.isExecuting(sessionID)
      },
    })

    // ---- RPC for clients (status line, dialogs, palette actions)
    const rpc = await ctx.rpc.register(GoalRpc, createRpcHandlers({ controller, log }))
    const quiet = (error: unknown) => log.warn("goal event emit failed", { error: String(error) })
    // Backstop mirror of the latest snapshot: the TUI reads it when both RPC paths are wedged (see core/mirror.ts).
    // Disabled in probe mode (read-only storage) and by OPENCODE_GOAL_MIRROR=0; best-effort, never throws.
    const mirrorEnabled = !probe && process.env.OPENCODE_GOAL_MIRROR !== "0"
    const mirror = mirrorEnabled ? createGoalMirror() : undefined
    emit = {
      changed: (sessionID, goal) => {
        if (mirror) {
          try {
            if (goal) mirror.write(goal)
            else mirror.remove(sessionID)
          } catch (error) {
            log.warn("goal mirror write failed", { error: String(error) })
          }
        }
        return void rpc.events.emit("changed", { sessionID, goal }).catch(quiet)
      },
      notice: (notice) => void rpc.events.emit("notice", { ...notice }).catch(quiet),
    }

    // ---- bare /goal-loop = update check
    // `plugins[].options.update` is the one source of truth, already parsed into `config.update` alongside
    // every other option. The check never blocks prompt admission: it is deferred to the next macrotask,
    // so a fast plugin disposal aborts it before any network request leaves the machine. An immediate
    // toast tells the user the check started; a second toast carries the result. `mode: off` (and probe
    // mode) keep the old status-only behavior.
    const updateTimers = new Set<ReturnType<typeof setTimeout>>()
    const scheduleUpdateCheck = (sessionID: string) => {
      if (probe || config.update.mode !== "auto") return
      emit.notice({
        sessionID,
        kind: "set",
        level: "info",
        title: "goal-loop update",
        message: `Checking GitHub for the ${config.update.channel} channel…`,
      })
      const timer = setTimeout(() => {
        updateTimers.delete(timer)
        if (lifetime.signal.aborted) return
        void (async () => {
          try {
            const result = await cliUpdate([], { env: process.env, cwd: ctx.location.directory })
            const text = (result.stdout || result.stderr).trim() || "Update check produced no output."
            if (!lifetime.signal.aborted) emit.notice({
              sessionID,
              kind: "set",
              level: result.code === 0 ? "info" : "warning",
              title: "goal-loop update",
              message: text,
            })
          } catch (error) {
            if (!lifetime.signal.aborted) emit.notice({
              sessionID,
              kind: "set",
              level: "warning",
              title: "goal-loop update",
              message: `Could not check for updates. ${userFacingError(error)}`,
            })
          }
        })()
      }, 0)
      updateTimers.add(timer)
    }
    const handleBareLoop = async (sessionID: string): Promise<"update" | "status"> => {
      if (probe || config.update.mode !== "auto") {
        await controller.status(sessionID)
        return "status"
      }
      scheduleUpdateCheck(sessionID)
      return "update"
    }

    // Sessions whose next compaction must replay a cold context: the explicit /reset-context command, or the
    // compaction a goal-loop version bump requests at its boundary. The hook consumes the entry exactly once, so
    // an ordinary auto-compaction in the same session keeps its normal summary. A Set keeps concurrent sessions
    // independent; each caller drops its own mark when compact() fails.
    const resetPending = new Set<string>()

    // ---- the /goal, /goal-loop and /reset-context commands
    await ctx.command.transform((editor) => {
      const addCommand = (name: string, description: string, loop: boolean) =>
        editor.add({
          name,
          description,
          execute: async ({ sessionID, prompt, delivery }) => {
            if (loop && (prompt.text ?? "").trim() === "") {
              await handleBareLoop(sessionID)
              return
            }
            const raw = prompt.text ?? ""
            // Status / clear / invalid are commands, not goals — never send them to the planner.
            const shouldPlan = parseGoalCommand(raw, config.maxConditionChars).type === "set"
            const planned = shouldPlan ? await planGoal(sessionID, raw) : undefined
            if (planned) armedPlanScopes.set(sessionID, planned.scope)
            await controller.command({
              sessionID,
              text: planned?.condition ?? raw,
              delivery,
              loop,
              planned: true,
              ...(prompt.files ? { files: prompt.files } : {}),
              ...(prompt.agents ? { agents: prompt.agents } : {}),
              ...(prompt.skills ? { skills: prompt.skills } : {}),
            })
          },
        })
      addCommand("goal", DESCRIPTION, false)
      addCommand("goal-loop", LOOP_DESCRIPTION, true)

      // Same-session context reset. The host still performs a real compaction (so prior messages leave the model
      // request), but the compaction hook below installs an empty native replay window. No new session is created,
      // so the session ID, its files and its history on disk all survive; only the model-visible context is cleared.
      editor.add({
        name: "reset-context",
        description: "Drop this session's context in place, keeping the same session ID",
        execute: async ({ sessionID }) => {
          resetPending.add(sessionID)
          try {
            await session.compact(sessionID)
          } catch (error) {
            resetPending.delete(sessionID)
            throw error
          }
          emit.notice({
            sessionID,
            kind: "compact",
            level: "info",
            title: "goal-loop",
            message: "Context reset. Same session ID; the next turn starts with no conversation history.",
          })
        },
      })
    })

    // ---- hooks
    // OpenCode's own compaction prompt always summarizes the conversation, so an instruction from the user to carry
    // nothing over cannot change its output. /reset-context marks the session; setting `result` here makes the host
    // skip the summary model and store COLD_REPLAY instead. Its empty native window replays as zero messages, which
    // is what makes the next turn look like a cold session start. Only a marked session is affected, once.
    await ctx.session.hook("compaction", (event) => {
      if (!resetPending.delete(event.sessionID)) return
      event.result = COLD_REPLAY as typeof event.result
    })
    // Only real user prompts pass through this hook (synthetic continuations do not), so it is the resume signal.
    // The hook also carries the /goal-loop directive: harnesses that do not know the `/goal-loop-<N>` spelling fall
    // through to a plain prompt, and the plugin arms the loop right here — the host awaits this hook before the
    // prompt is admitted, and the mutated text (directive stripped, count applied to this run only) is what the
    // model sees. Unknown-count tokens (not 1..1000) are not guessed: a warning is shown and the default is used.
    await ctx.session.hook("prompt", async (event) => {
      // The planner child's own prompt is already complete (raw body + output contract). Never re-arm it.
      if (plannerChildren.has(event.sessionID)) return
      // The judge is a harness-owned evaluator subagent child: its full rubric is built in `nativeVerdict`,
      // not here. No worker delegation prompt to enrich, so every other prompt is left untouched.
      const text = typeof event.prompt?.text === "string" ? event.prompt.text : ""
      const goalLoop = parseGoalLoopDirective(text)
      if (goalLoop) {
        const objective = goalLoop.objective
        // The raw-prompt path bypasses parseGoalCommand, so enforce the configured condition limit here too.
        // Count code points, not UTF-16 units, matching parseGoalCommand: astral characters must not count double.
        if (
          objective !== "" &&
          Number.isFinite(config.maxConditionChars) &&
          config.maxConditionChars < Number.MAX_SAFE_INTEGER &&
          [...objective].length > config.maxConditionChars
        ) {
          controller.noteConditionTooLong(event.sessionID, [...objective].length, config.maxConditionChars)
          controller.onUserPrompt(event.sessionID)
          return
        }
        if (objective === "") {
          // Bare directive (/goal-loop, /goal-loop-<N> with no objective): update check (or status when off).
          if (goalLoop.invalidCount !== undefined) controller.noteInvalidLoopCount(event.sessionID, goalLoop.invalidCount)
          const action = await handleBareLoop(event.sessionID)
          controller.onUserPrompt(event.sessionID)
          event.prompt.text = action === "update"
            ? "A goal-loop update check was requested; acknowledge briefly and do not set a goal."
            : "Show the current goal loop status."
          return
        }
        const maxLoops = goalLoop.maxLoops ?? config.maxLoops
        // The admitted user message is the kickoff (no synthetic prompt is sent): the model sees exactly what the
        // command path would have delivered, with the directive token and the count removed from the objective.
        const originalPrompt = event.prompt.text
        const planned = await planGoal(event.sessionID, objective)
        if (planned) armedPlanScopes.set(event.sessionID, planned.scope)
        const condition = planned?.condition ?? objective
        event.prompt.text = directivePrompt(condition, controller.commitForSession(event.sessionID), { iteration: 1, maxLoops, objective: condition, history: [] }, true)
        const armed = await controller.armFromPrompt({
          sessionID: event.sessionID,
          condition,
          maxLoops,
          ...(goalLoop.invalidCount !== undefined ? { invalidCount: goalLoop.invalidCount } : {}),
        })
        // Workstream XLV: the arming-side no-new-gap gate refused (a terminal record was persisted and the notice
        // fired). Restore the user's own line — the directive would tell the model a loop is armed when it is not.
        if (armed.status !== "active") event.prompt.text = originalPrompt
        return
      }
      controller.onUserPrompt(event.sessionID)
    })
    // Evaluator-only shaping of judge-child generations. The child already runs on the plugin's deny-all
    // `evaluator` agent, but belt-and-braces: a small judge that answers the rubric with a tool call yields no
    // text, so all three repair attempts come back empty and the goal stalls on `unreadable verdict after 3
    // attempts: ""`. STRICT_REPAIR's "do not call tools" is only prose; the tools must actually be removed for
    // the request. Deleting in place (the documented SDK mutation pattern) is safe: the surrounding context hook
    // already edits system/messages for these requests. Non-evaluator generations keep their tools untouched.
    await ctx.session.hook("generate", (event) => {
      // Only judge children are toolless. A user prompt admitted while an evaluation is in flight must keep its
      // own tools — the parent is no longer the generation surface, so its inflight flag is irrelevant here.
      if (!evaluatorChildren.has(event.sessionID) && !plannerChildren.has(event.sessionID)) return
      if (plannerChildren.has(event.sessionID)) {
        for (const name of Object.keys(event.tools)) delete event.tools[name]
        return
      }
      event.options.maxTokens = config.evaluator.maxOutputTokens
      for (const name of Object.keys(event.tools)) delete event.tools[name]
    })
    // One context hook, up to three injections: the standing system reminder (config-gated), the
    // one-shot post-compaction re-anchor (never gated — the ground truth must reach the model even
    // when the reminder is off; it is invisible on every request except the one after a landing),
    // and one ground-truth line for sessions whose goal already ended here (achieved / impossible /
    // cleared / failed) — the counter-instruction to a compaction summary that quotes the expired
    // `<goal>` kickoff. The first two are no-ops while no goal work is armed; the third is gated on the
    // request still carrying goal text, so it never becomes a session-long stale system line.
    await ctx.session.hook("context", (event) => {
      // CXXXVIII trims the judge's system prefix to its own identity so a ~7k-token AGENTS.md/SPEC.md block cannot
      // drown the rubric on small models (it caused foreign verdicts on 9router-go/KiloCode-Free). The trim is NOT
      // safe for the built-in `opencode` provider: that gateway rejects a trimmed judge in ~6ms with
      // `provider.free-limit` 429 while the worker and planner on the same model keep running. Keep the full host
      // prefix for `opencode` children; every other provider keeps the narrow CXXXVIII prefix. The per-turn
      // <goal-evaluation> prompt carries the role and output contract either way.
      const agentID = typeof event.agent === "string" ? event.agent : ""
      if (agentID === EVALUATOR_AGENT_ID && event.model?.providerID !== "opencode" && Array.isArray(event.system)) {
        const sys = event.system
        for (let i = sys.length - 1; i >= 0; i--) {
          const text = (sys[i] as { text?: unknown } | undefined)?.text
          if (typeof text !== "string" || !text.includes("You are the Evaluator, a subagent shipped by the goal-loop plugin")) {
            sys.splice(i, 1)
          }
        }
      }
      // Standing activation rule: in a coordinator repo every worker request carries the claim-before-edit
      // flow, not only requests that happen to have a live goal and the system reminder enabled. Without this,
      // an agent can start editing on dev directly (no lease, no worktree) and never sees the rule until a goal
      // is armed. Judge and planner children never edit files, so they keep their own prompts clean.
      const standingPolicy = controller.commitForSession(event.sessionID)
      if (
        agentID !== EVALUATOR_AGENT_ID &&
        agentID !== PLANNER_AGENT_ID &&
        standingPolicy.required &&
        standingPolicy.mode === "coordinator"
      ) {
        event.system.push({ type: "text", text: coordinatorFlow(standingPolicy) })
      }
      const live = controller.live(event.sessionID) !== undefined
      if (config.systemReminder) {
        const condition = controller.activeCondition(event.sessionID)
        if (condition) event.system.push({ type: "text", text: systemReminder(condition, controller.commitForSession(event.sessionID)) })
      }
      const anchor = controller.consumeAnchor(event.sessionID)
      if (anchor) event.system.push({ type: "text", text: anchor })
      // Goal messages are history, not instructions. While a goal is live the kickoff and the armed
      // continuations carry the state and must ride context; only notes are stripped. Once no live
      // goal exists for the session, every goal-grammar message is stripped — a finished goal's
      // "keep working" text must not ride any later request, including the one after a compaction.
      // Splice in place — the host holds the caller's array reference, so a rebound property could go unseen.
      if (Array.isArray(event.messages)) {
        const original = event.messages
        let kept = live ? compactGoalInstructions(stripGoalNotes(original)) : stripGoalContext(original)
        // The evaluator's own voice is not evidence and must not accumulate in model-bound context.
        // On a working turn drop every <goal-evaluation> prompt; while an evaluation is in flight keep
        // only the most recent one — the live rubric the model must answer — and drop older echoes.
        kept = stripGoalEvaluations(kept, { keepLast: evaluator.isEvaluating(event.sessionID) || evaluatorChildren.has(event.sessionID) })
        // The judge's verdict is read from its own event stream. The completion report is emitted by the plugin
        // as a queued, non-waking message, but never let it teach the worker the verdict it was supposed to earn
        // on its own (SPEC-workstreams.md CXLI position inversion).
        kept = kept.filter((message) => !isJudgeReport(message))
        if (kept.length !== original.length) {
          // Never dispatch a request that does not end on a user turn: strict providers reject it ("The
          // last message must have role=user."), and after a landing compaction the trailing turn can be
          // the only user message in the request (opencode folds the whole summary into it). If stripping
          // removed that trailing turn, keep it: a stale goal line is harmless history, while an invalid
          // request aborts the turn. Splice in place — the host holds the caller's array reference.
          const trailing = original[original.length - 1]
          // Never undo the use-and-forget strip by re-adding a trailing evaluation prompt merely to
          // satisfy the trailing-user repair — a working turn's trailing turn is its steer, not self-talk.
          const repairable = trailing !== undefined && !isGoalEvaluationMessage(trailing) && !isJudgeReport(trailing) ? trailing : undefined
          const last = kept[kept.length - 1]
          const repaired = last?.role === "user" || repairable === undefined || last === repairable ? kept : [...kept, repairable]
          original.splice(0, original.length, ...repaired)
        }
      }
      // The terminal ground-truth line is a counter-instruction, so it rides only a request that still
      // carries goal text: a compaction checkpoint quoting the expired `<goal>` kickoff, or a trailing
      // user turn the strict-provider repair kept. With no goal text left in the request there is nothing
      // to counter, and a line injected on every later request would be stale boilerplate for the rest of
      // the session — it is not injected.
      const stillCarriesGoal = Array.isArray(event.messages) ? carriesGoalGrammar(event.messages) : false
      if (!live && stillCarriesGoal && controller.hasTerminalRecord(event.sessionID)) event.system.push({ type: "text", text: TERMINAL_REMINDER })
    })

    // ---- event pump with reconnect
    const route = createRouter({ controller, background, log, compactor })
    void (async () => {
      let backoff = 500
      while (!lifetime.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: lifetime.signal })) {
            backoff = 500
            route(event as ServerEvent)
          }
        } catch (error) {
          if (lifetime.signal.aborted) break
          log.warn("event stream dropped; reconnecting", { error: String(error) })
        }
        await sleep(backoff, lifetime.signal)
        backoff = Math.min(backoff * 2, 15_000)
      }
    })()

    void controller.restore({ resume: !probe }).catch((error) => log.error("goal restore failed", { error: String(error) }))
    log.info("ready", {
      evaluator: config.evaluator.mode,
      model: config.evaluator.model ?? (config.evaluator.inheritModel ? "session (inherited)" : "session"),
    })

    return async () => {
      lifetime.abort()
      for (const timer of updateTimers) clearTimeout(timer)
      updateTimers.clear()
      await controller.dispose()
    }
  },
})
