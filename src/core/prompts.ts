import { formatDuration, formatSpend } from "./format.ts"
import type { CommitPolicy, UsageSnapshot } from "./types.ts"

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

/** The coordinator flow injected into every /goal prompt in a coordinator repo. */
export function coordinatorFlow(policy: CommitPolicy): string {
  const rawBin = policy.coordinatorBin ?? "packages/coordinator/bin/coordinator"
  const bin = /\s/.test(rawBin) ? `"${rawBin}"` : rawBin
  const target = policy.branch
  return [
    `Coordinator repo. Before editing: claim first — run \`${bin} claim <goal-slug> --agent <you> --paths <scope>\`.`,
    `Derive the slug from the goal, then \`cd <worktree>\` and work only there, commit on your wt/<slug> branch. When done, run \`submit\`.`,
    `Never commit to ${target}/main directly.`,
  ].join("\n")
}

export function commitStatusSuffix(policy: CommitPolicy): string {
  if (!policy.required) return ""
  if (policy.mode === "coordinator") {
    return `Commit on your wt/<slug> branch and submit before the goal counts as done.`
  }
  return `commit the finished work to the \`${policy.branch}\` branch and show the commit output: the commit hash and the branch it landed on`
}

/** True when the goal has no hard evidence token or reads as vague. */
export function isFuzzyCondition(condition: string): boolean {
  const text = condition.toLowerCase()
  const vague = ["look like", "like a rabbit", "pretty", "nice", "better", "improve", "redesign", "rework", "rabbit"]
  if (vague.some((word) => text.includes(word))) return true
  const hard = /\b(test|tests|build|lint|file|exists|passes|pass|exits|exit|commit|committed)\b/.test(text) || /\d/.test(text)
  return !hard
}

/** First turn: the condition itself is the directive. */
export function directive(condition: string, policy: CommitPolicy): string {
  const lines = [
    `<goal>`,
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
  if (policy.required) lines.push(``, commitRule(policy))
  return lines.join("\n")
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
    policy.required ? `${policy.mode === "coordinator" ? `Commit on your wt/<slug> branch and submit before the goal counts as done.` : `Commit the finished work to the \`${policy.branch}\` branch before the goal counts as done.`}` : ``,
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
    policy.required
      ? policy.mode === "coordinator"
        ? `Commit on your wt/<slug> branch and submit before the goal counts as done.`
        : `Commit the finished work to the \`${policy.branch}\` branch before the goal counts as done, and show the commit output.`
      : ``,
    `</goal-checkin>`,
  ].join("\n")
}

export function note(input: { title: string; body: string }): string {
  return `<goal-note>\n${input.title}\n${escape(input.body)}\n</goal-note>`
}

export function systemReminder(condition: string, policy: CommitPolicy): string {
  const lines = [
    `An active /goal is set for this session: ${escape(condition)}`,
    `An independent evaluator checks it after every turn from visible evidence only. Keep working until it holds and surface proof (command output, test results) in the conversation.`,
  ]
  if (policy.required) {
    if (policy.mode === "coordinator") lines.push(coordinatorFlow(policy), `Finished work has to be committed on your wt/<slug> branch and submitted before the goal counts as met.`)
    else lines.push(`Finished work has to be committed to the \`${policy.branch}\` branch before the goal counts as met.`)
  }
  return lines.join("\n")
}

export interface EvaluationFacts {
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
  `- "not_met": not demonstrated yet but still achievable. The reason must name what is missing or the next step.`,
  `- "impossible": can never be satisfied (self-contradictory, or depends on something verifiably unavailable).`,
  `  Use only with strong evidence; difficulty or slow progress is "not_met".`,
]

const RULES = [
  `Rules: claims without evidence do not count; if the agent says tests pass but no test output is visible, the`,
  `condition is not met. Judge the current state, not intentions. Constraints in the condition (things that must`,
  `not change) are part of it.`,
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
    if (policy.mode === "coordinator")
      lines.push(
        `- This session runs inside a git repository managed by the coordinator. Finished work has to be committed on the agent's own \`wt/<slug>\` branch and submitted (merge into \`${policy.branch}\` by the coordinator) before the goal counts as met.`,
      )
    else
      lines.push(
        `- This session runs inside a git repository. Finished work has to be committed to the \`${policy.branch}\` branch before the goal counts as met.`,
      )
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

export const REPAIR = `Your previous reply was not valid. ${OUTPUT}`
