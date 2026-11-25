/**
 * Host hook registration for the server plugin: compaction, prompt, generate and context.
 * Kept out of setup() so the composition root stays short; all state is passed in explicitly.
 */
import type { Plugin } from "@opencode/plugin"
import type { GoalConfig } from "./core/config.ts"
import type { GoalController } from "./runtime/controller.ts"
import type { Evaluator } from "./runtime/evaluator.ts"
import type { PlannedGoal } from "./core/planner.ts"
import type { AgentMessaging } from "./runtime/messaging.ts"
import { CLEAR_ALIASES, parseGoalLoopDirective } from "./core/parse.ts"
import { EVALUATOR_AGENT_ID } from "./core/evaluator-agent.ts"
import { PLANNER_AGENT_ID } from "./core/planner.ts"
import { backgroundResultID, carriesGoalGrammar, coordinatorFlow, directive as directivePrompt, PEER_PARENTS_HINT, systemReminder, TERMINAL_REMINDER } from "./core/prompts.ts"
import { compactGoalInstructions, stripGoalContext, stripGoalEvaluations, stripGoalNotes, isGoalEvaluationMessage } from "./core/prompts.ts"

export interface HookDeps {
  readonly ctx: Plugin.Context
  readonly config: GoalConfig
  readonly controller: GoalController
  readonly evaluator: Evaluator
  readonly messaging: AgentMessaging
  /** Read-only view of the other parent agents known to be alive (no storage reads, no message bodies). */
  readonly background: { readonly otherParentAddresses: (exclude: string) => readonly string[] }
  readonly agentIdFor: (sessionID: string) => Promise<string>
  readonly handleBareLoop: (sessionID: string) => Promise<"update" | "status">
  readonly planGoal: (sessionID: string, raw: string) => Promise<PlannedGoal | undefined>
  readonly armedPlanScopes: Map<string, { condition: string; scope: "trivial" | "code" }>
  readonly resetPending: Set<string>
  readonly isInjectedPrompt: (event: { readonly prompt?: unknown; readonly metadata?: unknown }) => boolean
  readonly plannerChildren: Set<string>
  readonly evaluatorChildren: Set<string>
  readonly seenBackgroundResults: Map<string, Set<string>>
  readonly isPluginReport: (message: unknown) => boolean
  readonly isInternalChildReport: (message: unknown) => boolean
  readonly coldReplay: { summary: string; metadata: { recent: string } }
}

export async function registerHooks(deps: HookDeps): Promise<void> {
  const { ctx, config, controller, evaluator, messaging, background, agentIdFor, handleBareLoop, planGoal, armedPlanScopes, resetPending, isInjectedPrompt, plannerChildren, evaluatorChildren, seenBackgroundResults, isPluginReport, isInternalChildReport, coldReplay } = deps
    // ---- hooks
    // OpenCode's own compaction prompt always summarizes the conversation, so an instruction from the user to carry
    // nothing over cannot change its output. /reset-context marks the session; setting `result` here makes the host
    // skip the summary model and store COLD_REPLAY instead. Its empty checkpoint replays with no conversation, which
    // is what makes the next turn look like a cold session start. No native window is installed: an upstream host
    // labels a completed native compaction "Provider compaction", and that string is not overridable from a plugin.
    // Only a marked session is affected, once.
    await ctx.session.hook("compaction", (event) => {
      if (!resetPending.delete(event.sessionID)) return
      event.result = coldReplay as typeof event.result
    })
    // The hook is the resume signal for a genuine user prompt. Injected wakes (child completion reports and
    // synthetic continuations) can reach it too while the parent session is moving, so they are filtered below:
    // a paused goal stays paused until the user actually speaks. The hook also carries the /goal-loop directive:
    // harnesses that do not know the `/goal-loop-<N>` spelling fall through to a plain prompt, and the plugin arms
    // the loop right here — the host awaits this hook before the prompt is admitted, and the mutated text (directive
    // stripped, count applied to this run only) is what the model sees. Unknown-count tokens (not 1..1000) are not
    // guessed: a warning is shown and the default is used.
    await ctx.session.hook("prompt", async (event) => {
      // Harness-owned children are prompted by the plugin itself (judge/planner generations), not by the user.
      // Their prompts must never re-arm a goal or resume a paused one in that session.
      if (plannerChildren.has(event.sessionID) || evaluatorChildren.has(event.sessionID)) return
      // An injected wake is not a user decision: no arming, no resume, no check-in reset. Without this guard,
      // every child report injected while the parent session was moving flipped a paused goal back to active.
      if (isInjectedPrompt(event)) return
      // The judge is a harness-owned evaluator subagent child: its full rubric is built in `nativeVerdict`,
      // not here. No worker delegation prompt to enrich, so every other prompt is left untouched.
      const text = typeof event.prompt?.text === "string" ? event.prompt.text : ""
      const goalLoop = parseGoalLoopDirective(text)
      if (goalLoop) {
        const objective = goalLoop.objective
        // A registered-command invocation classifies `clear|stop|...` through parseGoalCommand, but a raw
        // `/goal-loop[-N] clear` line reaches this hook directly. Without the same guard it armed a loop whose
        // objective was "clear" instead of ending the loop (docs/install.html).
        if (CLEAR_ALIASES.has(objective.toLowerCase())) {
          controller.clear(event.sessionID)
          controller.onUserPrompt(event.sessionID)
          event.prompt.text = "The goal loop was cleared; acknowledge briefly and do not set a new goal."
          return
        }
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
        const condition = planned?.condition ?? objective
        if (planned) armedPlanScopes.set(event.sessionID, { condition, scope: planned.scope })
        else armedPlanScopes.delete(event.sessionID)
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
    await ctx.session.hook("context", async (event) => {
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
        // Verdicts are read from the judge child's own event stream; no completion report is admitted into the
        // working session. Keep the strip so a stray judge report (or the planner's queued completion) cannot teach
        // the worker the verdict it was supposed to earn on its own (SPEC-workstreams.md CXLI position inversion).
        kept = kept.filter((message) => !isPluginReport(message))
        // Host subagent completions are wake signals, not instructions. Terminal sessions drop every one; live
        // sessions admit a report the first time it appears and drop every later copy of the same id. Keep the
        // splice-back contract with the strips above: the host holds the caller's array reference.
        const seenReports = seenBackgroundResults.get(event.sessionID) ?? new Set<string>()
        seenBackgroundResults.set(event.sessionID, seenReports)
        kept = kept.filter((message) => {
          const id = backgroundResultID(message)
          if (id === undefined) return true
          // Mark every id we see, even when we strip it: a report that rode a terminal session is stale forever,
          // so re-arming a goal in the same session must not admit it as fresh (SPEC terminal-injection-dedupe).
          const fresh = !seenReports.has(id)
          seenReports.add(id)
          return live && fresh && !isInternalChildReport(message)
        })
        if (kept.length !== original.length) {
          // Never dispatch a request that does not end on a user turn: strict providers reject it ("The
          // last message must have role=user."), and after a landing compaction the trailing turn can be
          // the only user message in the request (opencode folds the whole summary into it). If stripping
          // removed that trailing turn, keep it: a stale goal line is harmless history, while an invalid
          // request aborts the turn. Splice in place — the host holds the caller's array reference.
          const trailing = original[original.length - 1]
          // Never undo the use-and-forget strip by re-adding a trailing evaluation prompt merely to
          // satisfy the trailing-user repair — a working turn's trailing turn is its steer, not self-talk.
          const repairable =
            trailing !== undefined &&
            !isGoalEvaluationMessage(trailing) &&
            !isPluginReport(trailing) &&
            backgroundResultID(trailing) === undefined
              ? trailing
              : undefined
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
      // Unread hint and peer-parent signal for agent-to-agent messages. The unread nudge tells the recipient
      // to pull its inbox with goal_msg_read; the peer line surfaces goal_msg_send/read proactively when
      // another parent is alive, so workers coordinate without waiting to be told. Neither copies a message
      // body into context, so a retried generation cannot consume one twice. Judge/planner children get
      // neither (no tools, no mailbox).
      if (agentID !== EVALUATOR_AGENT_ID && agentID !== PLANNER_AGENT_ID) {
        const address = await agentIdFor(event.sessionID)
        const unread = await messaging.count(address).catch(() => 0)
        if (unread > 0) {
          event.system.push({
            type: "text",
            text: `goal-loop: ${unread} unread agent message(s). Call goal_msg_read to retrieve and clear them.`,
          })
        }
        if (background.otherParentAddresses(address).length > 0) {
          event.system.push({ type: "text", text: PEER_PARENTS_HINT })
        }
      }
    })

}
