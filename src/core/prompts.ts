import { formatDuration, formatSpend, truncate } from "./format.ts"
import { stripReasoningControl } from "./sanitize.ts"
import { isOpencodeCliCondition, opencodeCliGuide } from "./opencode-cli.ts"
import type { CommitPolicy, LoopEntry, UsageSnapshot } from "./types.ts"

/** Marks every message this plugin writes, so hooks and digests can recognize them. */
export const MARKER = "goal"

const escape = (text: string) => text.replace(/<\/(goal[\w-]*)>/gi, "<\\/$1>")

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
  return `Commit rule: the working directory is a git repository. Before the goal counts as done, commit the finished work to the \`${policy.branch}\` branch and show the commit output: the commit hash and the branch it landed on, or a \`git status\` on that branch with no uncommitted changes. Work that is done but uncommitted is not done work, and the evaluator will not mark the goal met without a visible commit on \`${policy.branch}\`.`
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

/** The coordinator flow injected into every /goal prompt in a coordinator repo. */
function coordinatorFlow(policy: CommitPolicy): string {
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
  `equivalent). What these show is the ground truth; the summary is only a hint.`,
]

/** Audit-and-stop lines, shared by every prompt that arms or re-arms a loop iteration. Kept byte-identical. */
const AUDIT_AND_STOP: ReadonlyArray<string> = [
  `Before working, audit the armed condition against CURRENT HEAD:`,
  `(i) enumerate what the condition requires — files, tests, gates, docs;`,
  `(ii) check each requirement against the tree at current HEAD using only fresh command output produced this turn — never summaries;`,
  `(iii) if every requirement already holds, respond exactly: Already satisfied at HEAD <sha>. Evidence: <fresh command output>. No new work is produced by this iteration. — and stop; do not redo or fake the work.`,
  `If something is missing, proceed and show evidence.`,
]

/** Loop preamble for `directive()`; callers pass it only for `/goal-loop` goals. */
function loopPreamble(loop: LoopPreamble): string[] {
  return [
    `Loop context: this is iteration ${loop.iteration} of at most ${loop.maxLoops} in a continuous improvement loop.`,
    `Objective (constant): ${escape(loop.objective)}`,
    `Prior iterations:\n${historyBlock(loop.history)}`,
    `When this iteration is met, the loop summarizes it and arms the next one; you do not need to decide that. Keep the objective in mind, not just this condition.`,
  ]
}

/** First turn: the condition itself is the directive. `loop` is set only for `/goal-loop` goals. */
export function directive(condition: string, policy: CommitPolicy, loop?: LoopPreamble): string {
  const lines = [
    `<goal>`,
    ...(loop ? [`<loop iteration="${loop.iteration}" max="${loop.maxLoops}">`, ...loopPreamble(loop), `</loop>`] : []),
    escape(condition),
    `</goal>`,
    ``,
    // One line per paragraph: clients wrap prose themselves, hard breaks render as ragged lines.
    `Work autonomously toward this goal until the condition holds. After each of your turns an independent evaluator checks the condition using only what is visible in this conversation; it cannot run commands or read files.`,
    ``,
    `Prove progress with evidence: run the checks the condition implies and let their output show. Do not stop to ask for confirmation unless you are truly blocked.`,
  ]
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
  return lines.join("\n")
}

/** Synthetic prompt arming iteration N+1 after iteration N was met. */
export function loopContinuation(
  input: { iteration: number; maxLoops: number; condition: string; previousSummary: string; reason: string },
  policy: CommitPolicy,
): string {
  return [
    `<goal-loop iteration="${input.iteration}" max="${input.maxLoops}">`,
    `The previous iteration was achieved (${escape(input.reason || "met")}). The loop armed this condition:`,
    escape(input.condition),
    ``,
    `Summary of iteration ${input.iteration - 1} (what is already done; do not redo). Treat it as stale until you re-read the tree:`,
    escape(input.previousSummary),
    ``,
    ...TREE_TRUTH,
    ``,
    ...AUDIT_AND_STOP,
    ``,
    `Work autonomously toward this condition under the same rules: after each of your turns an independent evaluator checks it; when it is met, the loop summarizes this iteration and arms the next. Prove progress with evidence.`,
    policy.required ? `Before you call it done, ${commitStatusSuffix(policy)}.` : ``,
    `</goal-loop>`,
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
    `The compaction cut the thread, not the loop: keep working toward the armed condition. After each of your turns an independent evaluator checks it; when it is met, the loop summarizes this iteration and arms the next. Do not wait for a user message.`,
    `</goal-loop-reanchor>`,
  ].join("\n")
}

export function continuation(input: { condition: string; turn: number; reason: string }, policy: CommitPolicy): string {
  return [
    `<goal-continuation turn="${input.turn}">`,
    `The goal is not met yet. Keep working toward it.`,
    ``,
    `Goal: ${escape(input.condition)}`,
    `Evaluator: ${escape(input.reason || "No reason given.")}`,
    ``,
    `Take the next concrete step, then show the evidence (command output, test results) that demonstrates the condition. If a turn or time limit in the goal applies, report progress against it.`,
    policy.required ? `Before you call the goal done, ${commitStatusSuffix(policy)}.` : ``,
    `</goal-continuation>`,
  ].join("\n")
}

export function retry(input: { condition: string; label: string }, policy: CommitPolicy): string {
  return [
    `<goal-retry>`,
    `The previous turn failed (${input.label}). The goal is still active; continue from where you left off.`,
    `Goal: ${escape(input.condition)}`,
    policy.required ? commitRuleSentence(policy, "prompt") : ``,
    `</goal-retry>`,
  ].join("\n")
}

export function checkin(
  input: { condition: string; waitedMs: number; subagents: number; shells: number },
  policy: CommitPolicy,
): string {
  const running = input.subagents + input.shells > 0
  const work = [
    input.subagents ? `${input.subagents} subagent${input.subagents === 1 ? "" : "s"}` : "",
    input.shells ? `${input.shells} background shell${input.shells === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" and ")
  return [
    `<goal-checkin>`,
    running
      ? `Background work (${work}) has kept the goal waiting for ${formatDuration(input.waitedMs)}. Read their output: keep waiting if they are progressing, and fix or stop any that are stuck.`
      : `Background work stopped without reporting a result. Continue toward the goal.`,
    `Goal: ${escape(input.condition)}`,
    policy.required ? commitRuleSentence(policy, "checkin") : ``,
    `</goal-checkin>`,
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

/** True when any text content part carries a goal note of either kind (`<goal-note` prefix). Unknown shapes never match. */
export const isGoalNoteMessage = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null) return false
  const content = (message as NoteMessageLike).content
  if (!Array.isArray(content)) return false
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

export function systemReminder(condition: string, policy: CommitPolicy): string {
  const lines = [
    `An active /goal is set for this session: ${escape(condition)}`,
    `An independent evaluator checks it after every turn from visible evidence only. Keep working until it holds and surface proof (command output, test results) in the conversation.`,
  ]
  if (policy.required) {
    if (policy.mode === "coordinator") lines.push(coordinatorFlow(policy))
    lines.push(commitRuleSentence(policy, "system"))
  }
  return lines.join("\n")
}

interface EvaluationFacts {
  /** The turn being evaluated (1-based). */
  readonly turn: number
  readonly elapsedMs: number
  readonly spend?: UsageSnapshot
}

const VERDICTS = [
  `Decide with these verdicts:`,
  `- "met": every part of the condition is demonstrated by evidence in the conversation (tool output, command`,
  `  results, file contents shown), or an explicit stop clause in the condition (turn, time, or budget limit) has`,
  `  been reached according to the harness facts below.`,
  `- "not_met": not demonstrated yet but still achievable. The reason must name what is missing and the`,
  `  single next concrete step, phrased so a fresh worker can execute it without re-deriving the problem;`,
  `  name the evidence that would settle it.`,
  `- "impossible": can never be satisfied (self-contradictory, or depends on something verifiably unavailable).`,
  `  Use only with strong evidence; difficulty or slow progress is "not_met".`,
]

const RULES = [
  `Rules: claims without evidence do not count; if the agent says tests pass but no test output is visible, the`,
  `condition is not met. Evidence must be fresh: command output produced at the current HEAD, after the last`,
  `change, not earlier turns' claims, the agent's summary of what it did, or a prior verdict. Judge the current`,
  `state, not intentions. Constraints in the condition (things that must not change) are part of it.`,
  `If the armed condition was already satisfied at HEAD before the turn began (fresh evidence this turn shows the`,
  `work landed and gates green): judge met, and state exactly that in the reason — "Already satisfied at HEAD`,
  `<sha>. No new work is produced by this iteration." Do not credit narration of effort, and do not produce`,
  `theater (re-verification-only turns still satisfy the condition, but a planner that re-proposes an identical`,
  `or materially equivalent condition must not be armed; the loop completes).`,
  `Condition fit: the reason must name which clause(s) of the armed condition the in-turn evidence satisfies,`,
  `and the evidence must come from this turn's output at the post-change HEAD. Narration, earlier turns' claims,`,
  `a previous verdict, and the absence of failure are not evidence.`,
  `Novelty / no-duplicate: if the armed condition is a near-duplicate of a condition completed earlier in this`,
  `loop's retained history window (token containment >= 0.7 or Jaccard >= 0.6, case/punctuation ignored), the`,
  `already-satisfied met above is accepted only together with the next concrete gap it leaves on a "next:" line.`,
  `A bare "Already satisfied" with no named next concrete gap verdicts "not_met" with reason`,
  `"duplicate-without-forward-pointer" — even when the underlying work was genuinely already done.`,
  `A met verdict on duplicate work must state in the reason that it is a duplicate pass, not new advancement.`,
  `Honest next gap: reasons claiming "Already satisfied" or "no work needed" must name a specific next gap drawn`,
  `from this turn's audit — a file, symbol, or workstream (e.g. "docs/core.html stale cards"). A vague`,
  `"could improve X" names nothing and verdicts "not_met".`,
  `Defensive audit (applies in addition to the condition): before deciding, scan the visible evidence for`,
  `state that is stale, weakened or self-contradictory — tests skipped, deleted or relaxed to make a check`,
  `pass; evidence produced before the last change; SPEC or docs contradicting the visible tree; generated`,
  `artifacts never committed; half-landed work from an earlier turn; a claim contradicted by fresher output.`,
  `If any of these is visible and bears on the condition, or on the evidence used to support it, the verdict is`,
  `"not_met" and the reason names the item. A green gate bought by weakening a test is not green.`,
  `Proactive duty: when the condition genuinely holds, end the reason with one line prefixed "next:" naming`,
  `the highest-value improvement you saw that remains — stale files, missing tests, drift, speed, friction.`,
  `This line is a hint for the loop planner; it never downgrades a met verdict. If nothing remains, omit it.`,
]

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
  const lines = [...VERDICTS]
  if (policy.required) {
    if (policy.mode === "coordinator") {
      lines.push(
        ``,
        `Commit rule (coordinator): the finished work has to be committed on the agent's own \`wt/<slug>\` branch and submitted. Evidence is a commit hash on \`wt/<slug>\` plus a \`submit\` or \`merge-next\` output showing it merged into \`${policy.branch}\`. Uncommitted work, a \`wt/<slug>\` commit never submitted, or a direct commit on \`${policy.branch}\` by a normal agent means "not_met"; only a direct commit shown by the \`coordinator\` agent itself counts.`,
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

const OUTPUT = `Reply with ONLY one JSON object and nothing else: {"verdict": "met" | "not_met" | "impossible", "reason": "<one or two sentences, under 300 characters>"}`

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

/** Appended to the live session transcript by `session.generate` (session evaluator). */
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

interface NextGoalInput {
  readonly objective: string
  /** Completed iterations, oldest first (including the one that just ended). */
  readonly history: ReadonlyArray<LoopEntry>
  readonly latestSummary: string
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

/** Appended to the live session transcript by `session.generate` (session summarizer). */
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
  `2. The exact token LOOP_COMPLETE — only if nothing meaningful remains to improve toward the objective.`,
  `You are the loop's defensive auditor, not just a planner. Audit in this order and arm the highest entry on which work is genuinely ABSENT at HEAD:`,
  `a. Failing, weakened or unwired gates (tests skipped, deleted or relaxed; checks detached from the build) — broken truth outranks all cosmetic work.`,
  `b. Stale or contradictory state (docs or SPEC vs the tree, artifacts older than their source, half-landed work, uncommitted leftovers).`,
  `c. Behavior that shipped without tests or gates.`,
  `d. Gaps in the constant objective not yet closed.`,
  `e. Speed and friction (repeated expensive work, slow checks, redundant steps).`,
  `Before proposing, audit the candidate against CURRENT HEAD via the completed history above: enumerate what it would require, and only propose a condition whose required work is ABSENT at HEAD.`,
  `Carry forward any "next:" hint the evaluator attached to the latest met verdict — it is a first-class candidate, subject to the same ABSENT-at-HEAD audit.`,
  `If every meaningful improvement under the objective is already complete, reply LOOP_COMPLETE. Do not propose a near-duplicate of a completed condition (case/punctuation/whitespace/wording ignored).`,
  `Pick concrete, finishable goals over open-ended polish. Do not restate the previous condition. Do not invent new objectives beyond the constant objective above.`,
]

/** Appended to the live session transcript by `session.generate` (session generator). */
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

const nextGoalFacts = (input: NextGoalInput) => [
  `Objective (constant): ${escape(input.objective)}`,
  `Completed iterations (oldest first):`,
  historyBlock(input.history),
  `Latest iteration summary:`,
  escape(stripReasoningControl(input.latestSummary)),
]

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

/**
 * The instruction grammar the plugin writes into the transcript: the `<goal>` kickoff, the `<goal-loop>`
 * arming/ continuation steers, `<goal-continuation>`, `<goal-retry>`, `<goal-checkin>`. Every one of these
 * carries "keep working until the condition holds" semantics. While a goal is live they are the state
 * carrier and must ride context; once no live goal exists for the session they are history that invites
 * the model to resume a finished goal — the exact post-compaction re-activation class. Suffixes are matched
 * on the opening tag only, so unknown shapes never match.
 */
const INSTRUCTION_TAGS = ["<goal>", "<goal-loop", "<goal-continuation", "<goal-retry", "<goal-checkin"] as const

/** True when any text content part carries one of the goal-instruction tags. Unknown shapes never match. */
export const isGoalInstructionMessage = (message: unknown): boolean => {
  if (typeof message !== "object" || message === null) return false
  const content = (message as NoteMessageLike).content
  if (!Array.isArray(content)) return false
  return content.some((part) => {
    if (typeof part !== "object" || part === null) return false
    const { type, text } = part as { type?: unknown; text?: unknown }
    return type === "text" && typeof text === "string" && INSTRUCTION_TAGS.some((tag) => text.includes(tag))
  })
}

/**
 * Drop every goal-grammar message (notes AND instructions) from a model-bound message list. Applied by the
 * `context` hook only when the session has no live goal: a finished goal's kickoff/continuation text must
 * leave context entirely, so neither an ordinary request nor a post-compaction summary can re-establish it.
 * Same splice-back contract as {@link stripGoalNotes}.
 */
export const stripGoalContext = <T>(messages: ReadonlyArray<T>): T[] =>
  messages.filter((m) => !isGoalNoteMessage(m) && !isGoalInstructionMessage(m))

/**
 * One ground-truth line for a session whose goal ended in this process. Injected by the `context` hook into
 * the SYSTEM part on every model request while no live goal exists and a terminal record is held in memory.
 * It is not a reminder to do anything — it is the counter-instruction to the compaction summary, which may
 * quote the original `<goal>` kickoff and its "work autonomously … do not stop" mandate.
 */
export const TERMINAL_REMINDER =
  "A /goal was set earlier in this session and it has ended (achieved, impossible, cleared or failed). Do not resume work toward it and do not re-arm it; await the user's next instruction."
