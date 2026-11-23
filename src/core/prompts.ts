import { elideAtWordBoundary, formatDuration, formatSpend, truncate } from "./format.ts"
import { stripReasoningControl } from "./sanitize.ts"
import { isOpencodeCliCondition, opencodeCliGuide } from "./opencode-cli.ts"
import type { CommitPolicy, LoopEntry, UsageSnapshot } from "./types.ts"

/** Marks every message this plugin writes, so hooks and digests can recognize them. */
export const MARKER = "goal"

/**
 * The worker never judges the verdict or delegates that judgment (delegating work to subagents is fine): the
 * harness runs a standalone evaluator child and only a `not_met` verdict wakes the worker with more work.
 * Background subagents in flight defer that verdict instead of nudging the worker — ending the turn is safe
 * because the harness injects their reports back to wake it. Kept as one exported constant
 * and appended to every worker-facing prompt builder so the kickoff, loop/retry/checkin steers and the system
 * reminder all carry the same absolute contract — not just the kickoff directive.
 */
export const DELEGATE_VERDICT =
  `Do the work, report evidence, end your turn. ` +
  `Evaluator judges; goal-loop detects active sessions and defers its verdict (no nudge); the harness ` +
  `injects results back to wake you. ` +
  `Never state, declare, or assess whether the condition is met — don't judge the verdict, delegate that ` +
  `judgment, or narrate it.`

const escape = (text: string) => text.replace(/<\/(goal[\w-]*)>/gi, "<\\/$1>")

/**
 * Bound an evaluator reason before it rides a session steer. A verbose verdict repeated verbatim every turn is pure
 * context bloat; short reasons are returned byte-identical and the fallback keeps its original meaning.
 */
const MAX_STEER_REASON_CHARS = 400
const steerReason = (reason: string, fallback: string) => {
  const value = typeof reason === "string" ? reason.trim() : ""
  return escape(value ? elideAtWordBoundary(value, MAX_STEER_REASON_CHARS) : fallback)
}

/**
 * The commit rule, as the agent reads it.
 *
 * The rule is the point of the whole plugin here: a goal that ends with its work still uncommitted leaves the
 * job half done, because nothing about it is in the repository's history. The agent is told the branch, because
 * "commit your work" on its own leaves the branch choice to the agent, and the branch is the whole point.
 *
 * Coordinator repositories need a different branch story: normal agents own only `wt/<slug>` in its own
 * worktree, never the target or `main`. `coordinatorFlow` is the exact operator flow the plugin injects so a
 * fresh `/goal <objective>` session knows how to work with no operator help; `packages/coordinator/README.md`
 * in the repo says the same.
 */
function commitRule(policy: CommitPolicy) {
  if (policy.required && policy.mode === "coordinator") return coordinatorFlow(policy)
  return `Commit rule: the working directory is a git repository. Before the goal counts as done, commit the finished work to the \`${policy.branch}\` branch and show the commit output: the commit hash and the branch it landed on, or a \`git status\` on that branch with no uncommitted changes. Work that is done but uncommitted is not done work, and the work is not complete without a visible commit on \`${policy.branch}\`.`
}

const DONE = "before the goal counts as done"
const MET = "before the goal counts as met"
const SLUG_BRANCH = "your wt/<slug> branch"
/** The coordinator one-line rule for agent-facing prompts: byte-identical for suffix/prompt/checkin. */
const coordinatorAgentRule = `Commit on ${SLUG_BRANCH} and submit ${DONE}.`
/** The direct-git rule body, without its trailing punctuation (callers append their own). */
const directRuleBody = (branch: string) => `Commit the finished work to the \`${branch}\` branch ${DONE}`

/**
 * The commit rule as one line, shared by every audience that needs it: agent instructions (`suffix`, used by
 * continuation/retry/check-in), the system reminder (`system`) and the evaluator facts (`facts`). Coordinator
 * repositories speak in `wt/<slug>` + submit terms; direct repositories name the target branch. Kept
 * byte-identical with the pre-refactor prompt text; `test/commit-rule.test.ts` pins every variant.
 */
const commitRuleSentence = (policy: CommitPolicy, kind: "suffix" | "prompt" | "checkin" | "system" | "facts"): string => {
  const branch = policy.branch
  const coordinator = policy.mode === "coordinator"
  switch (kind) {
    case "suffix":
      return coordinator
        ? coordinatorAgentRule
        : `commit the finished work to the \`${branch}\` branch and show the commit output: the commit hash and the branch it landed on`
    case "prompt":
      return coordinator ? coordinatorAgentRule : `${directRuleBody(branch)}.`
    case "checkin":
      return coordinator ? coordinatorAgentRule : `${directRuleBody(branch)}, and show the commit output.`
    case "system":
      return coordinator
        ? `Finished work has to be committed on ${SLUG_BRANCH} and submitted ${MET}.`
        : `Finished work has to be committed to the \`${branch}\` branch ${MET}.`
    case "facts":
      return coordinator
        ? `- This session runs inside a git repository managed by the coordinator. Finished work has to be committed on the agent's own \`wt/<slug>\` branch and submitted (merge into \`${branch}\` by the coordinator) ${MET}.`
        : `- This session runs inside a git repository. Finished work has to be committed to the \`${branch}\` branch ${MET}.`
  }
}

/**
 * The coordinator flow injected into every /goal prompt in a coordinator repo, and — from the context hook —
 * into every worker model request whether or not a goal is armed. Exported as one home so the standing
 * activation rule and the kickoff directive cannot drift apart.
 */
export function coordinatorFlow(policy: CommitPolicy): string {
  const target = policy.branch
  if (!policy.coordinatorBin) {
    // Detection held on the json markers but no absolute binary could be located: never invent or
    // relativize a path the agent cannot run. Say exactly what is missing.
    return [
      `Coordinator repository detected on this machine, but no coordinator binary was found in the project or the plugin.`,
      `Do NOT guess or construct a path to one. Create and work on a \`wt/<slug>\` branch, commit there, and in your final report state that the coordinator binary is missing so the merge into \`${target}\` has to be run manually.`,
    ].join("\n")
  }
  const bin = /\s/.test(policy.coordinatorBin) ? `"${policy.coordinatorBin}"` : policy.coordinatorBin
  return [
    `Coordinator repo. Before editing: claim first — run \`${bin} claim <goal-slug> --agent <you> --paths <scope>\`.`,
    `Derive the slug from the goal, then \`cd <worktree>\` and work only there, commit on your wt/<slug> branch. When done, run \`submit\`.`,
    `Never commit to ${target}/main directly.`,
  ].join("\n")
}

export function commitStatusSuffix(policy: CommitPolicy): string {
  if (!policy.required) return ""
  return commitRuleSentence(policy, "suffix")
}

/**
 * Heuristic: a "broad goal" needs scoped/profile-aware verification evidence (typed checks, targeted proofs),
 * not a single green-but-unscoped gate. Conservative: obvious multi-clause improvement/refactor/audit/completion
 * goals are broad; precise single-scope conditions are not.
 */
export function isBroadGoalCondition(condition: string): boolean {
  const text = condition.trim()
  if (!text) return false
  const words = text.split(/\s+/).filter(Boolean)
  const lower = text.toLowerCase()
  const broadSignals = [
    /\b(improve|refactor|harden|audit|review|optimi[sz]e|stabili[sz]e|cleanup|clean up|overhaul|migrate|redesign|moderni[sz]e)\b/,
    /\b(entire|whole|all|every|across|codebase|project|repository|repo)\b/,
    /\b(backlog|roadmap|complete|finish|end[- ]to[- ]end|comprehensive|systemic|profile[- ]aware|verification matrix)\b/,
    /\b(and|plus|also|including|as well as)\b.*\b(test|lint|typecheck|build|docs|spec|verify|check)\b/,
  ]
  let hits = 0
  for (const re of broadSignals) if (re.test(lower)) hits++
  const clauses = text.split(/[.;\n]+|\bthen\b|\band then\b/i).map((x) => x.trim()).filter(Boolean)
  if (hits >= 2) return true
  if (hits >= 1 && (words.length >= 14 || clauses.length >= 2)) return true
  if (clauses.length >= 3 && words.length >= 18) return true
  // Reuse fuzzy heuristic as a strong broad signal for open-ended goals.
  if (isFuzzyCondition(text) && (hits >= 1 || words.length >= 12)) return true
  return false
}

/** True when the goal has no hard evidence token or reads as vague. */
export function isFuzzyCondition(condition: string): boolean {
  const text = condition.toLowerCase()
  const vague = ["look like", "like a rabbit", "pretty", "nice", "better", "improve", "redesign", "rework", "rabbit"]
  if (vague.some((word) => text.includes(word))) return true
  const hard = /\b(test|tests|build|lint|file|exists|passes|pass|exits|exit|commit|committed)\b/.test(text) || /\d/.test(text)
  return !hard
}

interface LoopPreamble {
  /** 1-based iteration; 1 is the goal set by `/goal-loop` itself. */
  readonly iteration: number
  readonly maxLoops: number
  readonly objective: string
  /** Completed iterations, oldest first. */
  readonly history: ReadonlyArray<LoopEntry>
}

/** Newest completed iterations injected into a loop prompt by default; older ones live on the record's bounded ledger. */
const HISTORY_INJECT_LIMIT = 10
/** Post-compaction re-anchors carry a tighter window: the model's context was just rebuilt, so the newest few iterations are all it needs to avoid re-doing work. */
const REANCHOR_HISTORY_INJECT_LIMIT = 3

/** Compact one-line-per-iteration block; the only loop state a prompt ever carries. */
function historyBlock(history: ReadonlyArray<LoopEntry>, limit: number = HISTORY_INJECT_LIMIT): string {
  if (history.length === 0) return "(none — this is the first iteration)"
  // Inject only the most recent iterations; older ones already shaped the objective and would just grow the prompt.
  const kept = history.slice(-limit)
  const omitted = history.length - kept.length
  const lines = kept.map((entry) => `- v${entry.version}: ${escape(truncate(stripReasoningControl(entry.condition), 100))} — ${escape(truncate(stripReasoningControl(entry.summary), 160))}`)
  if (omitted > 0) lines.unshift(`(${omitted} older completed iteration${omitted === 1 ? "" : "s"} omitted — the bounded ledger rides the record)`)
  return lines.join("\n")
}

/** Repository ground-truth lines, shared by every "don't trust the summary" prompt. Kept byte-identical. */
const TREE_TRUTH: ReadonlyArray<string> = [
  `First, re-read the repository state instead of trusting that summary: git log --oneline -5, git status --short, git branch --show-current`,
  `(and, in a coordinator repo, coordinator status --json and git worktree list), plus the current check output (bun run check or the`,
  `equivalent).`,
]

/** Audit-and-stop lines, shared by every prompt that arms or re-arms a loop iteration. Kept byte-identical. */
const AUDIT_AND_STOP: ReadonlyArray<string> = [
  `Before working, audit the armed condition against CURRENT HEAD:`,
  `(i) enumerate what the condition requires — files, tests, gates, docs;`,
  `(ii) check each requirement against the tree at current HEAD using only fresh command output produced this turn — never summaries;`,
  `(iii) if the required work is already present at HEAD, report it with fresh command output and stop — do not state a verdict about the goal.`,
  `If something is missing, proceed and show evidence.`,
]

/**
 * Loop-specific context for `directive()`. The objective and this iteration's condition are emitted once, together,
 * by `directive()` itself — repeating either here is what made the old kickoff read the same paragraph twice.
 */
function loopPreamble(loop: LoopPreamble): string[] {
  return [
    `Context: this is iteration ${loop.iteration} of at most ${loop.maxLoops} in a continuous improvement loop.`,
    `Prior iterations:\n${historyBlock(loop.history)}`,
  ]
}

/**
 * First turn: the condition itself is the directive. `loop` is set only for `/goal-loop` goals.
 * `planned` marks a condition distilled by the arm-time planner: the condition is already self-contained, so the
 * heuristic fuzzy / opencode-cli / coordinator essays are skipped entirely — that bloat is what the planner removes.
 */
export function directive(condition: string, policy: CommitPolicy, loop?: LoopPreamble, planned = false): string {
  const safeCondition = escape(condition)
  const safeObjective = loop ? escape(loop.objective) : undefined
  // Iteration 1 arms the objective itself, so condition === objective. Say it once instead of twice;
  // later iterations keep both because the condition is a narrower step toward the constant objective.
  const objectiveIsCondition = safeObjective !== undefined && safeObjective.trim() === safeCondition.trim()
  const lines: string[] = [
    `<goal>`,
    ...(loop
      ? [
          `<loop iteration="${loop.iteration}" max="${loop.maxLoops}">`,
          ...loopPreamble(loop),
          `</loop>`,
          `Objective (constant): ${safeObjective}`,
          objectiveIsCondition
            ? `Condition for this iteration: the objective above (no narrower step this iteration).`
            : `Condition for this iteration: ${safeCondition}`,
        ]
      : [safeCondition]),
    `</goal>`,
    ``,
    `WORKING RULES`,
    // One line per paragraph: clients wrap prose themselves, hard breaks render as ragged lines.
    `Show command output when it is part of the work. Do not stop to ask for confirmation unless you are truly blocked.`,
  ]
  if (!planned) {
    if (isFuzzyCondition(condition)) {
      lines.push(
        ``,
        `Fuzzy request: write SPEC.md first (interpretation, acceptance criteria, verification incl screenshot/render for visual), then build, verify against SPEC, commit.`,
      )
    }
    if (isOpencodeCliCondition(condition)) {
      lines.push(``, opencodeCliGuide())
    }
    if (policy.required) lines.push(``, commitRule(policy))
  }
  // Last block on purpose: the completion/no-judge contract is the final thing the worker reads.
  // DELEGATE_VERDICT is the one home for "do the work, end your turn, let the evaluator judge" — no earlier copy.
  lines.push(``, `VERDICT HANDOFF`, DELEGATE_VERDICT)
  return lines.join("\n")
}

/** Synthetic prompt arming iteration N+1 after iteration N was met. */
export function loopContinuation(
  input: { iteration: number; maxLoops: number; condition: string; previousSummary: string; reason: string; learnings?: string },
  policy: CommitPolicy,
): string {
  const learnings = input.learnings?.trim()
  return [
    `<goal-loop iteration="${input.iteration}" max="${input.maxLoops}">`,
    `The previous iteration was achieved (${steerReason(input.reason, "met")}). The loop armed this condition:`,
    escape(input.condition),
    ``,
    `Summary of iteration ${input.iteration - 1} (what is already done; do not redo). Treat it as stale until you re-read the tree:`,
    escape(input.previousSummary),
    ...(learnings ? [``, escape(learnings)] : []),
    ``,
    ...TREE_TRUTH,
    ``,
    ...AUDIT_AND_STOP,
    ``,
    `Work autonomously toward this condition under the same rules: a met result arms the next iteration; a not_met result keeps this one active.`,
    policy.required ? `Before you call it done, ${commitStatusSuffix(policy)}.` : ``,
    `</goal-loop>`,
    DELEGATE_VERDICT,
  ].join("\n")
}

/**
 * Re-anchor queued after a compaction lands on a live (`/goal-loop`) session. Compaction replaces history with a
 * lossy summary; this restores the objective, the armed condition and the completed iterations from the plugin's
 * own record so the loop survives the cut. Queued (`resume: false`): it never wakes the session and never
 * interrupts an in-flight turn; the next steer the loop already dispatches carries it into the model's view.
 */
export function loopReanchor(input: { iteration: number; maxLoops: number; objective: string; condition: string; history: ReadonlyArray<LoopEntry> }): string {
  return [
    `<goal-loop-reanchor iteration="${input.iteration}" max="${input.maxLoops}">`,
    `The session context was just compacted; earlier history was replaced by a lossy summary. Ground truth for this loop:`,
    `Objective (constant): ${escape(input.objective)}`,
    `This iteration: v${input.iteration} of at most ${input.maxLoops} — armed condition:`,
    escape(input.condition),
    ``,
    `Completed iterations (newest ${REANCHOR_HISTORY_INJECT_LIMIT}; older ones ride the record's bounded ledger):`,
    historyBlock(input.history, REANCHOR_HISTORY_INJECT_LIMIT),
    ``,
    ...TREE_TRUTH,
    ``,
    ...AUDIT_AND_STOP,
    ``,
    `The compaction cut the thread, not the loop: keep working toward the armed condition. Do not wait for a user message.`,
    `</goal-loop-reanchor>`,
    DELEGATE_VERDICT,
  ].join("\n")
}

export function continuation(input: { condition: string; turn: number; reason: string; learnings?: string }, policy: CommitPolicy): string {
  const learnings = input.learnings?.trim()
  return [
    `<goal-continuation turn="${input.turn}">`,
    `The goal is not met yet. Keep working toward it.`,
    ``,
    `Goal: ${escape(input.condition)}`,
    `Evaluator: ${steerReason(input.reason, "No reason given.")}`,
    ...(learnings ? [``, escape(learnings)] : []),
    ``,
    `Take the next concrete step, then show the evidence (command output, test results) from your work. If a turn or time limit in the goal applies, report progress against it.`,
    policy.required ? `Before you call the goal done, ${commitStatusSuffix(policy)}.` : ``,
    `</goal-continuation>`,
    DELEGATE_VERDICT,
  ].join("\n")
}

/**
 * Proactive escalation steer for a recurring failure signature. Replaces the old "pause and wait for the
 * user" path: the goal stays active and the worker is handed a concrete, rotated strategy plus the persisted
 * diagnostic artifact. `rotate strategy` wording is kept so the evaluator rubric and the diagnostic reason
 * stay consistent with the escalation they are judging.
 */
export function strategyEscalation(input: {
  condition: string
  turn: number
  reason: string
  count: number
  kind: string
  summary: string
  strategy: string
  signals?: readonly string[]
  diagnostic?: string
  learnings?: string
}, policy: CommitPolicy): string {
  const learnings = input.learnings?.trim()
  return [
    `<goal-strategy-escalation turn="${input.turn}" count="${input.count}" kind="${escape(input.kind)}">`,
    `The same failure has recurred ${input.count} times in a row. Do not repeat the approach that produced it.`,
    ``,
    `Goal: ${escape(input.condition)}`,
    `Evaluator: ${steerReason(input.reason, "No reason given.")}`,
    `Failure signature: ${escape(input.summary)}`,
    ...(input.signals?.length ? [`Recognized no-progress signals: ${escape(input.signals.join(", "))}`] : []),
    ``,
    `Rotate strategy now: ${escape(input.strategy)}`,
    ...(input.diagnostic ? [`Diagnostic artifact: ${escape(input.diagnostic)}`, `Read it before the next step so the evidence is concrete.`] : []),
    ...(learnings ? [``, escape(learnings)] : []),
    ``,
    `Take a concrete step with the new strategy, then show fresh evidence (command output, test results) from this turn. Keep working toward the goal; do not stop or wait for a user message.`,
    policy.required ? `Before you call the goal done, ${commitStatusSuffix(policy)}.` : ``,
    `</goal-strategy-escalation>`,
    DELEGATE_VERDICT,
  ].join("\n")
}

export function retry(input: { condition: string; label: string; learnings?: string }, policy: CommitPolicy): string {
  const learnings = input.learnings?.trim()
  return [
    `<goal-retry>`,
    `The previous turn failed (${input.label}). The goal is still active; continue from where you left off.`,
    `Goal: ${escape(input.condition)}`,
    ...(learnings ? [``, escape(learnings)] : []),
    policy.required ? commitRuleSentence(policy, "prompt") : ``,
    `</goal-retry>`,
    DELEGATE_VERDICT,
  ].join("\n")
}

export function checkin(
  input: { condition: string; waitedMs: number; subagents: number; shells: number; learnings?: string },
  policy: CommitPolicy,
): string {
  const running = input.subagents + input.shells > 0
  const work = [
    input.subagents ? `${input.subagents} subagent${input.subagents === 1 ? "" : "s"}` : "",
    input.shells ? `${input.shells} background shell${input.shells === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" and ")
  const learnings = input.learnings?.trim()
  return [
    `<goal-checkin>`,
    running
      ? `Background work (${work}) has kept the goal waiting for ${formatDuration(input.waitedMs)}. Read their output: keep waiting if they are progressing, and fix or stop any that are stuck.`
      : `Background work stopped without reporting a result. Continue toward the goal.`,
    `Goal: ${escape(input.condition)}`,
    ...(learnings ? [``, escape(learnings)] : []),
    policy.required ? commitRuleSentence(policy, "checkin") : ``,
    `</goal-checkin>`,
    DELEGATE_VERDICT,
  ].join("\n")
}

/**
 * The end-of-record companion to `<goal-note>`: a terminal note (the goal achieved, was judged
 * impossible, or the loop completed) is history, not instructions. The session keeps it — it stays on
 * the terminal as the outcome line — but it must not ride the model's context on later turns, where it
 * only invites a ceremonial acknowledgement. `<goal-note final>` is the stable grammar the context
 * hook matches on (see `stripGoalNotes`). Since Workstream LI (2026-11-18) the loop-arm note is emitted
 * terminal too, and since Workstream LII (2026-11-18) the hook strips plain `<goal-note>` messages as
 * well — legacy plain notes (emitted before LI) were folded into the model's context on every later
 * request forever (the reported "false reminder after already achieved"), and a plain `<goal-note>` is a
 * goal outcome line, never an instruction. No goal note of either kind rides model-bound context any more;
 * both remain on the terminal and in the log.
 */
export const TERMINAL_NOTE_TAG = "<goal-note final>"

export function note(input: { title: string; body: string; final?: boolean }): string {
  return input.final
    ? `${TERMINAL_NOTE_TAG}\n${input.title}\n${escape(input.body)}\n</goal-note>`
    : `<goal-note>\n${input.title}\n${escape(input.body)}\n</goal-note>`
}

/** Structural view of a model-bound message: the `context` hook sees host-shaped messages, so match on the text content parts rather than any metadata the host may or may not propagate. */
interface NoteMessageLike {
  readonly content?: unknown
}

/**
 * The single user message opencode folds a landing compaction into before dispatch. Its `<recent-context>`
 * quotes earlier turns verbatim, including any `<goal>` / `<goal-continuation>` a compacted window held, so
 * the goal-grammar matchers below would otherwise mistake the checkpoint for a live goal message and delete
 * it. It is history (the model is told to treat it as such), never one of the plugin's own notes or
 * instructions, and after a landing compaction it can be the only user message in the request: stripping it
 * leaves a strict provider nothing but its "The last message must have role=user." rejection.
 */
const CHECKPOINT_TAG = "<conversation-checkpoint>"
const isCheckpointPart = (part: unknown): boolean => {
  if (typeof part !== "object" || part === null) return false
  const { type, text } = part as { type?: unknown; text?: unknown }
  return type === "text" && typeof text === "string" && text.includes(CHECKPOINT_TAG)
}
/** True when any content part carries the compaction-checkpoint marker. */
const isCompactionCheckpoint = (content: ReadonlyArray<unknown>): boolean => content.some(isCheckpointPart)

/** True when any text content part carries a goal note of either kind (`<goal-note` prefix). Unknown shapes never match, and a compaction checkpoint is history, never a note. */
export const isGoalNoteMessage = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null) return false
  const content = (message as NoteMessageLike).content
  if (!Array.isArray(content)) return false
  if (isCompactionCheckpoint(content)) return false
  return content.some((part) => {
    if (typeof part !== "object" || part === null) return false
    const { type, text } = part as { type?: unknown; text?: unknown }
    return type === "text" && typeof text === "string" && text.includes("<goal-note")
  })
}

/**
 * Drop goal notes of either kind from a model-bound message list. Mutating in place would share an
 * array with the host, so callers that must signal removals through an array the host holds can splice
 * the result back; this returns a fresh array and never touches its input.
 */
export const stripGoalNotes = <T>(messages: ReadonlyArray<T>): T[] => messages.filter((m) => !isGoalNoteMessage(m))

/**
 * The evaluator's own voice echoed back into the transcript. Every judge child carries the `<goal-evaluation>`
 * rubric prompt, and nothing removes it: it then rides model-bound context on every later turn and floods the
 * evaluator's transcript digest (~5 KB of self-talk per
 * turn, ~27% of a saturated digest). The rubric explicitly discounts prior verdicts, so this text is not evidence —
 * it is the evaluator talking to itself. Use-and-forget: drop it from model-bound context once it has been answered.
 * Compaction checkpoints are history, never a live evaluation prompt, so they are never mistaken for one.
 */
const GOAL_EVALUATION_TAG = "<goal-evaluation"

const isGoalEvaluationPart = (part: unknown): boolean => {
  if (typeof part !== "object" || part === null) return false
  const { type, text } = part as { type?: unknown; text?: unknown }
  return type === "text" && typeof text === "string" && text.includes(GOAL_EVALUATION_TAG)
}

/**
 * True when a message carries the evaluator's own `<goal-evaluation>` prompt. Two host shapes reach this
 * predicate: `ctx.session.context()` messages carry a flat `text` (the digest source), while the `context`
 * hook's model-bound messages carry `content` text parts. Both are matched; unknown shapes never match,
 * and a compaction checkpoint is history in either shape.
 */
export const isGoalEvaluationMessage = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null) return false
  const m = message as NoteMessageLike & { text?: unknown }
  if (typeof m.text === "string") {
    if (m.text.includes(CHECKPOINT_TAG)) return false
    return m.text.includes(GOAL_EVALUATION_TAG)
  }
  const content = m.content
  if (!Array.isArray(content)) return false
  if (isCompactionCheckpoint(content)) return false
  return content.some(isGoalEvaluationPart)
}

/**
 * Drop the evaluator's own `<goal-evaluation>` prompts from a model-bound message list. With `keepLast`, only the
 * most recent evaluation prompt survives — that is the live rubric an in-flight evaluator must answer — while older
 * echoes are dropped. Returns a fresh array and never touches its input (same splice-back contract as
 * {@link stripGoalNotes}).
 */
export const stripGoalEvaluations = <T>(messages: ReadonlyArray<T>, options: { readonly keepLast?: boolean } = {}): T[] => {
  const last = options.keepLast ? messages.reduce((found, m, i) => (isGoalEvaluationMessage(m) ? i : found), -1) : -1
  return messages.filter((m, i) => i === last || !isGoalEvaluationMessage(m))
}

export function systemReminder(condition: string, policy: CommitPolicy): string {
  const lines = [
    `An active /goal is set for this session: ${escape(condition)}`,
    `Only command output and test results visible in this conversation count as evidence.`,
  ]
  if (policy.required) {
    // The claim-before-editing flow is injected standing by the context hook on every worker request, so
    // it is not repeated here when a live goal also turns on the system reminder.
    lines.push(commitRuleSentence(policy, "system"))
  }
  lines.push(DELEGATE_VERDICT)
  return lines.join("\n")
}

interface EvaluationFacts {
  /** The turn being evaluated (1-based). */
  readonly turn: number
  readonly elapsedMs: number
  readonly spend?: UsageSnapshot
}

/**
 * Bound the judge's effort at the prompt level. The downstream caps (400-char steer reason, 4000-char clamp) already
 * assume a short verdict; without saying so up front, the rubric asks for a large structured answer that is then
 * truncated — the "unbounded deliberation" failure mode, worst for a vague condition. Purely additive: the exhaustive
 * evidence contract below stays byte-identical. See SPEC.md Workstream CXXV.
 */
const BOUNDED_EFFORT = `Decide from the evidence actually shown, not from exhaustive hypotheticals: judge only the clauses that bear on the verdict, name the single most critical gap when not met, and keep the reason short (a few lines). For a vague condition in particular, do not enumerate every edge case or re-audit claims irrelevant to the outcome.`

const VERDICTS = [
  `Judge in this order, from fresh visible evidence only (command/test/build/lint/typecheck output, diffs/files shown, commit hashes/branches, gate output at current HEAD), i.e. this turn's output at post-change HEAD. Narration, prior claims, previous verdicts, summaries, absence of failure, and "should pass" are not evidence. Constraints in the condition are clauses.`,
  `1. Parse the armed condition into explicit, verifiable clauses.`,
  `2. Build an evidence matrix per clause; name a concrete evidence type for each observed item (full clause schema in the OUTPUT list below).`,
  `3. Adversarial self-check: "What would falsify met?" and "What important risk is untested?" If any plausible falsifier or material gap remains, do not verdict met. Only gaps counted by the bounded completion condition are material; speculative polish/speed/taste is never one.`,
  `4. Gate policy:`,
  `   - "met": every clause satisfied by fresh, scoped evidence (incl. required commits/submit/merge/checks). Green but unscoped is insufficient for broad goals; transcript-only green does not corroborate a broad claim. See the "Verification matrix/profile" and "Broad-condition verifier corroboration" rules below for the full required-check and verifier-command requirements.`,
  `   - "not_met": missing/weak/stale/contradictory/unscoped evidence, weakened or detached tests/gates, uncommitted or unsubmitted required work, drift, or visible regressions remain. Name the most critical falsifiable gap and the evidence that would close it.`,
  `   - "impossible": only with strong evidence the condition can never be satisfied (self-contradictory or depends on something verifiably unavailable). Difficulty or slow progress is "not_met".`,
  `5. Detect repeated failure signatures from recent verdicts/reasons visible in this conversation (same missing evidence, same failing gate, same flaky/error pattern, same unaddressed gap). If repeating, require strategy escalation: narrow scope, produce a diagnostic artifact, or mark blocked with the blocker.`,
]

const RULES = [
  `If the armed condition was already satisfied at HEAD before the turn began (fresh evidence this turn shows the work landed and gates green): clause-by-clause evidence must still show it satisfied now; state "Already satisfied at HEAD <sha>" in the reason when true, and do not credit narration. A re-proposed identical or materially equivalent condition must still name a concrete next gap on a "next:" line (novelty/no-duplicate: a bare already-satisfied met with no named next concrete gap is downgraded to not_met as duplicate-without-forward-pointer).`,
  `Defensive audit: scan visible evidence for stale, weakened, or self-contradictory state — evidence before last change, SPEC/docs contradicting tree, generated artifacts never committed, half-landed work, or claims contradicted by fresher output. If any bears on the condition or its evidence, verdict is "not_met" and the reason names it. A green gate bought by weakening a test is not green.`,
  `Commit/submit evidence: when the condition or coordinator flow requires commits/submit/merge, treat missing or unverifiable commit hash/branch/submit/merge-next/status evidence as not_met (coordinator: commit on wt/<slug> plus submit/merge evidence; direct: commit on required branch).`,
  `Verification matrix/profile: if required verification checks or check types are configured/applicable for the goal or a broad goal profile, each required check needs fresh executed command/output/exit evidence scoped to the claimed change; treat missing, unscoped, failing, timed-out, or unverifiable required checks as not_met and name the exact check and proof still needed.`,
  `Broad-condition verifier corroboration: for a broad or ambiguous condition, when a verifier command or configured required check is available (e.g. evaluator.verifyCommand or a required verification check), a "met" verdict must be corroborated by that command's fresh executed output scoped to the claimed change; transcript-only or generic green is insufficient for the broad claim. If a verifier command is configured but its fresh corroborating output is absent, unexecuted, or unscoped, the verdict is "not_met" and the reason names the missing verifier-command corroboration.`,
]

/**
 * The deterministic verifier is the closure proof, not just a gate. The default native judge never saw the
 * bounded completion condition and kept demanding unprovable "no polish gap remains" proof even when an
 * evaluator.verifyCommand exited 0 on a clean checkout — the loop never ended. One short line, shared by every
 * completion-facing prompt so the judge cannot re-invent the unprovable clause.
 */
const VERIFIER_CLOSES_COMPLETION = `A clean verifier closes the condition: if an evaluator.verifyCommand (or required check) exited 0 at the current HEAD and the tracked tree is clean, that is conclusive proof the required checks pass — do not demand proof that no polish, speed or taste gap remains; another tweak is always conceivable and is not a gap.`

/**
 * The loop's terminal condition, stated once so the evaluator's `next: none` and the planner's
 * `LOOP_COMPLETE` are decided by the same bounded test. The former wording ("nothing meaningful
 * remains to improve", "every meaningful improvement already complete", "no gap") had no terminal
 * definition: there is always another conceivable polish/speed/taste tweak, so even a fully green
 * build kept re-arming. Completion is now a finite checklist, every item checkable from fresh visible
 * output at current HEAD — the same discipline the `/goal` path uses for its `<condition>` block.
 * Shared as one constant so the two prompts cannot drift apart.
 */
const COMPLETION_CONDITION = [
  `Bounded completion condition — the loop is complete only when ALL of these hold at current HEAD, each shown by fresh visible output:`,
  `  1. Every required check and verifier command for the goal passes with exit 0 and zero failures.`,
  `  2. The tracked tree is clean (git status --short shows no uncommitted source changes).`,
  `  3. No active or submitted lease requires work that is ABSENT at HEAD, and the merge queue has no pending entry.`,
  `  4. The latest met verdict's "next:" pointer names no concrete gap whose required work is ABSENT at HEAD.`,
  VERIFIER_CLOSES_COMPLETION,
  `If any item is unproven or fails, the loop is NOT complete: arm the highest-priority unmet item. Speculative polish, speed or taste preferences are not gaps and never justify re-arming. "No gap" means exactly these four checks pass, not that the repository is perfect.`,
].join("\n")

/**
 * The rubric, with the commit rule folded in.
 *
 * The evaluator judges from the conversation alone, so the commit rule has to be spelled out here as evidence it
 * can look for. A commit hash on the named branch, or a `git status` on that branch with nothing uncommitted, is
 * what "committed" looks like from the outside. Without this the evaluator would accept a finished, verified,
 * uncommitted job as met, which is the exact case the rule exists to catch.
 *
 * In coordinator mode the evidence is two-step: a commit hash on `wt/<slug>` plus a submit or merge step.
 * `submit` output showing the task submitted, `merge-next` output showing it merged into the target branch, or a
 * coordinator `status`/`queue` snapshot showing the lease submitted/done counts. A commit that lives only on the
 * target branch with no wt/ history proves the wrong path for a normal agent (only the coordinator may commit
 * there), so it is `not_met` unless the transcript shows the `coordinator` agent itself did it.
 */
function rubric(policy: CommitPolicy) {
  const lines = [BOUNDED_EFFORT, ...VERDICTS]
  if (policy.required) {
    if (policy.mode === "coordinator") {
      lines.push(
        ``,
        `Commit rule (coordinator): the finished work has to be committed on the agent's own \`wt/<slug>\` branch and submitted. Evidence is a commit hash on \`wt/<slug>\` plus a \`submit\` or \`merge-next\` output showing it merged into \`${policy.branch}\`. Uncommitted work, a \`wt/<slug>\` commit never submitted, or a direct commit on \`${policy.branch}\` by a normal agent means "not_met"; only a direct commit shown by the \`coordinator\` agent itself counts.`,
        `Lease-first rule (coordinator): a normal agent must claim a lease (\`coordinator claim <slug> --agent <you> --paths <scope>\`) and enter its worktree BEFORE the first edit — a prompt reminder alone is not enough, the workflow has to be visible. Evidence is the \`claim\` output plus a \`git branch --show-current\` showing \`wt/<slug>\` (or a worktree directory) ahead of the edits. If a turn edited files in the target checkout (\`${policy.branch}\` / main) without a prior claim, verdict "not_met" and name it: the work must be redone inside a claimed worktree, not merely committed there. Only the \`coordinator\` agent is exempt.`,
      )
    } else {
      lines.push(
        ``,
        `Commit rule: the finished work has to be committed on the \`${policy.branch}\` branch. Evidence is a commit`,
        `hash shown together with the branch it landed on, a \`git status\` on that branch with no uncommitted`,
        `changes, or a \`git log\` that shows the commit on \`${policy.branch}\`. Uncommitted changes to the goal's`,
        `files, or a commit that is not on \`${policy.branch}\`, mean "not_met", and the reason names the commit as`,
        `the missing step.`,
      )
    }
  }
  lines.push(``, ...RULES)
  return lines.join("\n")
}

const OUTPUT = [
  `Reply with ONLY one JSON object and nothing else:`,
  `{"verdict":"met"|"not_met"|"impossible","reason":"<structured reason; use \\n for line breaks>"}`,
  ``,
  `The reason must cover, in order:`,
  `(a) Clause-by-clause judgment with evidence refs: clause, required evidence, observed evidence, status: satisfied|missing|contradicted|unscoped, source/turn.`,
  `(b) Gaps/flaws/risks found, or "none material".`,
  `(c) Repeated-failure/escalation note if any (same missing evidence, same failing gate, same flaky/error pattern, or same unaddressed gap seen in recent visible verdicts/reasons/gate output); if repeating, state required escalation (narrow scope, produce a diagnostic artifact, or mark blocked with blocker). Otherwise state "none".`,
  ``,
  `Then next actions: when not_met, list 1-3 concrete gaps in this exact form — "next:" then "1. [priority/risk] <exact improvement> — evidence gap/finding — required proof to close it."; each gap must name required work that is ABSENT at HEAD. When met, write "next: none" — emit next actions only for a concrete absent-work gap, never for subjective polish, speed or taste preferences.`,
  COMPLETION_CONDITION,
  `Never invent evidence.`,
].join("\n")

function facts(input: EvaluationFacts, policy: CommitPolicy) {
  const lines = [
    `Harness facts (authoritative, measured outside the conversation):`,
    `- This is the end of turn ${input.turn} since the goal was set.`,
    `- Elapsed time: ${formatDuration(input.elapsedMs)}.`,
  ]
  if (input.spend) lines.push(`- Spend since the goal was set: ${formatSpend(input.spend)}.`)
  if (policy.required) {
    lines.push(commitRuleSentence(policy, "facts"))
  }
  return lines.join("\n")
}

/**
 * The whole request the harness's standalone evaluator child gets. The harness builds the summary from the
 * parent's current turn and passes it here; the worker never supplies it. Two inputs only: the original goal and
 * that summary. No raw transcript dump — in a long-lived session that carried prior verdicts about other
 * conditions and a small model judged those instead of the armed one.
 *
 * `/goal-loop` is structurally different: the original goal is the constant objective, the armed condition is one
 * numbered iteration (v1, v2, …) of it, and completed iterations ride as a compacted ledger (newest three, with an
 * explicit omitted count) instead of their old directives. No generation call, no new persisted field.
 */
export function nativeEvaluationRequest(input: {
  readonly condition: string
  readonly summary: string
  /** The arm-time planner's scope, replayed on the check so a trivial reply is judged as a reply. */
  readonly armPlanScope?: "trivial" | "code"
  /** Per-verdict unique token: keeps a free-tier gateway from replaying a cached completion for another prompt. */
  readonly nonce?: string
  readonly loop?: {
    readonly objective: string
    readonly iteration: number
    readonly maxLoops: number
    readonly history: ReadonlyArray<LoopEntry>
  }
}): string {
  const tag = (text: string) => text.replace(/<\/(original-goal|parent-summary|objective|condition|iteration|prior-iterations|goal-evaluation)>/gi, "<\\/$1>")
  const goal = input.loop
    ? [
        `<objective>${tag(input.loop.objective)}</objective>`,
        `<iteration>v${input.loop.iteration} of ${input.loop.maxLoops}</iteration>`,
        `<condition>${tag(input.condition)}</condition>`,
        `<prior-iterations>${historyBlock(input.loop.history, REANCHOR_HISTORY_INJECT_LIMIT)}</prior-iterations>`,
      ]
    : [`<condition>${tag(input.condition)}</condition>`]
  return [
    `<goal-evaluation>`,
    // The arm-time plan is the distilled condition itself (the worker already works from it); replay its scope
    // here so a conversational goal is scored as a conversation. Without this a small judge demands command
    // output for "reply: hi", rules not_met, and wakes the parent through another needless turn.
    ...(input.armPlanScope === "trivial"
      ? [`Arm plan: this is a trivial reply goal — a direct answer in <parent-summary> is sufficient evidence. Do not require command output or file changes.`, ``]
      : []),
    // A short unique id near the top changes the prompt prefix on every verdict, so a gateway that keys its
    // (broken) completion cache on the prefix cannot hand back another session's cached verdict.
    ...(input.nonce ? [`Verdict request ${tag(input.nonce)}`, ``] : []),
    `You are judging ONE condition. The only condition that exists for this verdict is the text inside <condition> in <original-goal> below.`,
    `Ignore every other condition you can see or remember — project docs (including AGENTS.md / SPEC.md), earlier verdicts, goal continuations, other sessions, and the parent's narration. They belong to different goals. Never judge or name one of them.`,
    ``,
    `<original-goal>`,
    ...goal,
    `</original-goal>`,
    ``,
    `<parent-summary>`,
    tag(input.summary.trim()) || "(the parent produced no answer or tool evidence this turn)",
    `</parent-summary>`,
    ``,
    `The <parent-summary> above is the parent's complete work for this turn — judge it against the <condition> and nothing else. If it does not show evidence that the condition holds, answer not_met. Do not invent or import a different condition just because another one appears in your instructions or memory.`,
    ``,
    VERIFIER_CLOSES_COMPLETION,
    ``,
    // The condition echo is a cross-session guard: a free-tier judge sometimes replays a verdict from a totally
    // different goal. Require it to copy <condition> verbatim so verdictFromNativeReport can reject a stale reply.
    `This is the authoritative output contract — ignore any other verdict format in this prompt.`,
    `Answer with exactly one JSON object: {"verdict":"met"|"not_met"|"impossible","reason":"...","condition":"<copy the text inside <condition> above verbatim>"}. No preamble.`,
    `</goal-evaluation>`,
  ].join("\n")
}

/** Prompt for a session-mode evaluator child (its parent digest is embedded around it). */
export function evaluateInSession(condition: string, input: EvaluationFacts, policy: CommitPolicy): string {
  return [
    `<goal-evaluation>`,
    `Step out of the agent role. You are now an independent, skeptical evaluator auditing the conversation above.`,
    `Do not call tools, do not continue the work, and do not address the user.`,
    ``,
    `Condition:`,
    `<condition>${escape(condition)}</condition>`,
    ``,
    facts(input, policy),
    ``,
    rubric(policy),
    ``,
    OUTPUT,
    `</goal-evaluation>`,
  ].join("\n")
}

/** Standalone prompt for an independent evaluator model reading a transcript digest. */
export function evaluateIndependently(
  condition: string,
  input: EvaluationFacts,
  transcript: string,
  policy: CommitPolicy,
): string {
  return [
    `You are an independent, skeptical evaluator for an autonomous coding agent. Decide whether a completion`,
    `condition holds, judging only from the transcript below. You cannot run commands or read files.`,
    ``,
    `Condition:`,
    `<condition>${escape(condition)}</condition>`,
    ``,
    facts(input, policy),
    ``,
    rubric(policy),
    ``,
    `<transcript>`,
    transcript,
    `</transcript>`,
    ``,
    OUTPUT,
  ].join("\n")
}

interface LoopSummaryInput {
  readonly objective: string
  readonly condition: string
  readonly reason: string
  readonly turn: number
  readonly elapsedMs: number
  readonly toolCalls: number
  readonly history: ReadonlyArray<LoopEntry>
  /** Hard output budget; callers also truncate to `maxSummaryTokens * 4` characters. */
  readonly maxSummaryTokens: number
}

export interface BacklogSuggestion {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly priority: number
  readonly impact: "low" | "medium" | "high"
  readonly risk: "low" | "medium" | "high"
  readonly finding: string
  readonly improvement: string
  readonly evidence: ReadonlyArray<string>
}

interface NextGoalInput {
  readonly objective: string
  /** Completed iterations, oldest first (including the one that just ended). */
  readonly history: ReadonlyArray<LoopEntry>
  readonly latestSummary: string
  /** Highest-priority unblocked backlog item, de-duplicated against completed work. */
  readonly backlogSuggestion?: BacklogSuggestion
  /** Recent learning journal entries (formatted) to apply in planning. */
  readonly recentLearnings?: string
}

const summarizeFacts = (input: LoopSummaryInput) => [
  `Objective (constant): ${escape(input.objective)}`,
  `Condition just achieved: ${escape(input.condition)}`,
  `Evaluator verdict: met — ${escape(input.reason || "no reason given")}`,
  `Harness facts (authoritative): end of turn ${input.turn} since this iteration started; elapsed ${formatDuration(input.elapsedMs)}; ${input.toolCalls} tool calls this iteration.`,
]

const SUMMARY_ASK = (input: LoopSummaryInput) => [
  `Write a compact, machine-consumable summary of this loop iteration for the next-goal generator.`,
  `At most ~${input.maxSummaryTokens} tokens. Plain text only: no markdown headings, no greetings, no advice to the user.`,
  `Cover exactly three things: what was achieved (with evidence pointers), key constraints the next iteration must keep, and what remains improvable or unfinished.`,
  `Output exactly the block, nothing before or after it. Never emit reasoning-control tags such as <think> or <ernie:think>; they corrupt the record and the next-goal prompt.`,
  `Prior iterations (oldest first):`,
  historyBlock(input.history),
]

/** Prompt for a session-mode loop summarizer child. */
export function summarizeInSession(input: LoopSummaryInput): string {
  return [
    `<goal-loop-summary>`,
    `Step out of the agent role. You are now a compactor: summarize one completed iteration of an autonomous improvement loop. Do not call tools and do not address the user.`,
    ``,
    ...summarizeFacts(input),
    ``,
    ...SUMMARY_ASK(input),
    `</goal-loop-summary>`,
  ].join("\n")
}

/** Standalone prompt for an independent summarizer model reading a transcript digest. */
export function summarizeIndependently(input: LoopSummaryInput, transcript: string): string {
  return [
    `You are a compactor for an autonomous improvement loop. Summarize one completed iteration from the transcript below; you cannot run commands or read files.`,
    ``,
    ...summarizeFacts(input),
    ``,
    ...SUMMARY_ASK(input),
    ``,
    `<transcript>`,
    transcript,
    `</transcript>`,
  ].join("\n")
}

const NEXT_GOAL_ASK = [
  `Reply with EXACTLY ONE of these, and nothing else:`,
  `1. A single goal condition for the next iteration: concrete, verifiable, imperative, under 300 characters, checkable from visible evidence (command output, files, tests, commits). One line, no quotes, no preamble.`,
  `2. The exact token LOOP_COMPLETE — only when every item of the bounded completion condition below holds at current HEAD.`,
  `You are the loop's defensive auditor, not just a planner. Audit in this order and arm the highest entry on which work is genuinely ABSENT at HEAD:`,
  `a. Failing, weakened or unwired gates (tests skipped, deleted or relaxed; checks detached from the build) — broken truth outranks all cosmetic work.`,
  `b. Stale or contradictory state (docs or SPEC vs the tree, artifacts older than their source, half-landed work, uncommitted leftovers).`,
  `c. Behavior that shipped without tests or gates.`,
  `d. Gaps in the constant objective not yet closed.`,
  `e. Speed and friction (repeated expensive work, slow checks, redundant steps).`,
  `Before proposing, audit the candidate against CURRENT HEAD via the completed history above: enumerate what it would require, and only propose a condition whose required work is ABSENT at HEAD.`,
  `Carry forward any "next:" hint the evaluator attached to the latest met verdict — it is a first-class candidate, subject to the same ABSENT-at-HEAD audit.`,
  COMPLETION_CONDITION,
  `Do not propose a near-duplicate of a completed condition (case/punctuation/whitespace/wording ignored). Do not restate the previous condition. Do not invent new objectives beyond the constant objective above.`,
  `Pick concrete, finishable goals whose required work is ABSENT at HEAD; do not re-arm on speculative polish, speed or taste preferences. A green build with no absent-work gap is done — reply LOOP_COMPLETE, not another polish condition.`,
]

/** Prompt for a session-mode next-condition generator child. */
export function nextGoalInSession(input: NextGoalInput): string {
  return [
    `<goal-loop-next>`,
    `Step out of the agent role. You are the planner of this improvement loop. Do not call tools and do not address the user.`,
    ``,
    ...nextGoalFacts(input),
    ``,
    ...NEXT_GOAL_ASK,
    `</goal-loop-next>`,
  ].join("\n")
}

const backlogBlock = (suggestion: BacklogSuggestion | undefined): string[] => {
  if (!suggestion) return []
  const evidence = suggestion.evidence.length
    ? suggestion.evidence.map((line) => `  - ${escape(stripReasoningControl(line))}`).join("\n")
    : "  - (none)"
  return [
    ``,
    `Suggested backlog item (highest-priority unblocked, de-duplicated against completed work):`,
    `- id: ${escape(suggestion.id)}`,
    `- title: ${escape(stripReasoningControl(suggestion.title))}`,
    `- category: ${escape(suggestion.category)}; priority=${suggestion.priority}; impact=${suggestion.impact}; risk=${suggestion.risk}`,
    `- finding: ${escape(stripReasoningControl(suggestion.finding))}`,
    `- improvement: ${escape(stripReasoningControl(suggestion.improvement))}`,
    `- evidence:`,
    evidence,
    `Prefer a concrete, verifiable next condition that advances this item when its required work is ABSENT at HEAD; otherwise choose the highest-value ABSENT-at-HEAD improvement per the audit above.`,
  ]
}

const nextGoalFacts = (input: NextGoalInput) => {
  const learnings = input.recentLearnings?.trim()
  return [
    `Objective (constant): ${escape(input.objective)}`,
    `Completed iterations (oldest first):`,
    historyBlock(input.history),
    `Latest iteration summary:`,
    escape(stripReasoningControl(input.latestSummary)),
    ...backlogBlock(input.backlogSuggestion),
    ...(learnings ? [``, `Recent learnings (apply when choosing the next improvement):`, escape(learnings)] : []),
  ]
}

/** Standalone prompt for an independent planner model; the summary replaces the transcript. */
export function nextGoalIndependently(input: NextGoalInput): string {
  return [
    `You are the planner of an autonomous improvement loop. Choose the next goal from the summaries below; you cannot run commands or read files.`,
    ``,
    ...nextGoalFacts(input),
    ``,
    ...NEXT_GOAL_ASK,
  ].join("\n")
}

/** The only output that ends a loop early: nothing worth improving remains. */
export const LOOP_COMPLETE = "LOOP_COMPLETE"

/** True when the generator's reply means "nothing worth improving" (tolerates quotes/case). */
export function isLoopComplete(reply: string): boolean {
  const cleaned = reply.trim().replace(/^["'`]+|["'`]+$/g, "").trim()
  return cleaned.toUpperCase() === LOOP_COMPLETE
}

/**
 * Normalize a generator reply into a usable condition, or return undefined when it is unusable.
 * Collapses newlines (the contract is one line), strips surrounding quotes/backticks, and enforces `maxChars`.
 */
export function parseNextCondition(reply: string, maxChars = 2_000): string | undefined {
  if (isLoopComplete(reply)) return undefined
  const cleaned = reply
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned || cleaned.length > maxChars) return undefined
  return cleaned
}

export const REPAIR = `Your previous reply was not valid. ${OUTPUT}`

/** Second-level retry: empty replies usually mean the model called a tool or produced no text. */
export const STRICT_REPAIR = `Your previous reply was not valid. ${OUTPUT} Do not call tools and do not reason out loud — output only the JSON object.`

/**
 * The instruction grammar the plugin writes into the transcript: the `<goal>` kickoff, the `<goal-loop>`
 * arming/ continuation steers, `<goal-continuation>`, `<goal-retry>`, `<goal-checkin>`. Every one of these
 * carries active-work semantics: do the work, leave the verdict to the harness. While a goal is live they are the state
 * carrier and must ride context; once no live goal exists for the session they are history that invites
 * the model to resume a finished goal — the exact post-compaction re-activation class. Suffixes are matched
 * on the opening tag only, so unknown shapes never match.
 */
const INSTRUCTION_TAGS = ["<goal>", "<goal-loop", "<goal-continuation", "<goal-retry", "<goal-checkin"] as const

/** True when any text content part of the message carries a goal-instruction tag — checkpoints included. */
const carriesGoalTag = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null) return false
  const content = (message as NoteMessageLike).content
  if (!Array.isArray(content)) return false
  return content.some((part) => {
    if (typeof part !== "object" || part === null) return false
    const { type, text } = part as { type?: unknown; text?: unknown }
    return type === "text" && typeof text === "string" && INSTRUCTION_TAGS.some((tag) => text.includes(tag))
  })
}
/** True when any text content part carries one of the goal-instruction tags. Unknown shapes never match, and a compaction checkpoint (which may quote a tag in its `<recent-context>`) is history, never an instruction. */
export const isGoalInstructionMessage = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null) return false
  const content = (message as NoteMessageLike).content
  if (!Array.isArray(content)) return false
  if (isCompactionCheckpoint(content)) return false
  return carriesGoalTag(message)
}
/**
 * True when the model-bound messages still carry goal-grammar TEXT anywhere, checkpoint quotes included.
 * `stripGoalContext` removes the plugin's own goal messages, but a compaction checkpoint it deliberately
 * keeps can quote an expired `<goal>` kickoff, and the strict-provider repair can keep a trailing user turn
 * whose text names the goal. This is the predicate the `context` hook uses to decide whether the terminal
 * ground-truth line has anything left to counter: with no goal text in the request, that line is stale
 * boilerplate and is not injected.
 */
export const carriesGoalGrammar = (messages: ReadonlyArray<unknown>): boolean => messages.some(carriesGoalTag)

/**
 * Drop every goal-grammar message (notes AND instructions) from a model-bound message list. Applied by the
 * `context` hook only when the session has no live goal: a finished goal's kickoff/continuation text must
 * leave context entirely, so neither an ordinary request nor a post-compaction summary can re-establish it.
 * Same splice-back contract as {@link stripGoalNotes}.
 *
 * A `<goal-evaluation>` request is never goal grammar, even when the armed condition it quotes contains a
 * literal `<goal>`/`<goal-continuation>` kickoff (users paste rendered directives into `/goal`). Without this
 * exemption `isGoalInstructionMessage` matches that embedded tag, strips the judge's own prompt from its
 * child session, and the judge answers not_met claiming no `<condition>` or `<parent-summary>` was supplied.
 * The evaluation request is reaped separately by {@link stripGoalEvaluations}, so this exemption does not let
 * stale rubrics ride a worker's context.
 */
export const stripGoalContext = <T>(messages: ReadonlyArray<T>): T[] =>
  messages.filter((m) => !isGoalNoteMessage(m) && (!isGoalInstructionMessage(m) || isGoalEvaluationMessage(m)))

/**
 * While a goal is live, only the newest goal directive is state. Every older `<goal>` / `<goal-loop>` /
 * `<goal-continuation>` has been superseded: each arm re-states the armed condition and, for `/goal-loop`,
 * carries the previous summary plus a bounded version ledger. Keeping all of them makes long loops bloat the
 * worker's context with stale evaluator reasons. Keep the newest instruction, drop the older ones; all other
 * messages (including compaction checkpoints) are untouched. Notes are stripped separately by the hook.
 */
export const compactGoalInstructions = <T>(messages: ReadonlyArray<T>): T[] => {
  let last = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isGoalInstructionMessage(messages[i])) {
      last = i
      break
    }
  }
  if (last < 0) return messages.slice()
  return messages.filter((m, i) => i === last || !isGoalInstructionMessage(m))
}

/**
 * One ground-truth line for a session whose goal ended in this process. Injected by the `context` hook into
 * the SYSTEM part on every model request while no live goal exists and a terminal record is held in memory.
 * It is not a reminder to do anything — it is the counter-instruction to the compaction summary, which may
 * quote the original `<goal>` kickoff and its "work autonomously … do not stop" mandate.
 */
export const TERMINAL_REMINDER =
  "A /goal was set earlier in this session and it has ended (achieved, impossible, cleared or failed). Do not resume work toward it and do not re-arm it; await the user's next instruction."
