/**
 * The evaluator as a first-class agent type shipped by the plugin.
 *
 * A verdict is produced by a real OpenCode child session of this agent, created with `parentID` so it shows up
 * in the terminal like any other delegated subagent. This module is the single source of truth for the agent's
 * id, its task label and its system prompt; the long evidence matrix / output contract stays in the per-verdict
 * rubric (core/prompts.ts), byte-identical.
 */

export const EVALUATOR_AGENT_ID = "evaluator"
export const EVALUATOR_AGENT_TITLE = "evaluator"

/** The exact prefix the host's own `subagent` tool prepends to every delegated prompt. */
export const SUBAGENT_PROMPT_PREFIX = "You are a subagent spawned by another session.\n"

/** True for a native `<subagent>` completion report whose agent was the goal-loop evaluator. */
export function isEvaluatorReport(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false
  const m = metadata as Record<string, unknown>
  return m.source === "subagent" && typeof m.agent === "string" && m.agent.toLowerCase() === EVALUATOR_AGENT_ID
}

export interface NativeReportCandidate {
  readonly key: string
  readonly body: string
  readonly state: string
}

/**
 * Pick the newest unconsumed native evaluator report for a turn. Two guards keep a verdict tied to the turn that
 * produced it: plugin-judge reports (delivered by the fallback `spawnJudge`) are excluded by their childID so a
 * previous turn's verdict is never replayed, and reports still `running` (the child has background work) are left
 * alone until the host delivers its final one. `consumed`/`pluginJudgeIDs` are owned by the caller so a duplicate
 * turn-end cannot re-arm from the same report.
 */
export function findNativeReport(
  messages: readonly unknown[],
  consumed: ReadonlySet<string>,
  pluginJudgeIDs: ReadonlySet<string>,
): NativeReportCandidate | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || typeof message !== "object") continue
    const m = message as Record<string, unknown>
    if (m.type !== "synthetic" || !isEvaluatorReport(m.metadata)) continue
    const metadata = m.metadata as Record<string, unknown>
    if (typeof metadata.childID === "string" && pluginJudgeIDs.has(metadata.childID)) continue
    const key = String(m.id ?? (m.time as Record<string, unknown> | undefined)?.created ?? m.text)
    if (consumed.has(key)) continue
    const report = parseSubagentReport(String(m.text ?? ""))
    if (!report || report.state === "running") continue
    return { key, body: report.body, state: report.state }
  }
  return undefined
}

/**
 * Extract the body of a native `<subagent …>body</subagent>` completion. Both the host's own reports and the
 * plugin's queued reports use this exact wrapper, so the verdict parser can stay agnostic about who produced it.
 */
export function parseSubagentReport(text: string): { body: string; state: string; childID?: string } | undefined {
  const open = /<subagent\b([^>]*)>/.exec(text)
  if (!open) return undefined
  const close = text.lastIndexOf("</subagent>")
  if (close <= (open.index ?? 0)) return undefined
  const attrs = open[1] ?? ""
  const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1]
  return {
    body: text.slice((open.index ?? 0) + open[0].length, close).trim(),
    state: attr("state") ?? "completed",
    ...(attr("sessionID") ? { childID: attr("sessionID") } : {}),
  }
}

/**
 * Identity prompt for the `evaluator` agent. Kept short and role-focused on purpose: applying the rubric clause
 * by clause and emitting the verdict object are the per-turn prompt's job. The judge has no tools (deny-all
 * permissions plus the generate hook), so asking it to run commands would only produce an empty reply.
 */
export const EVALUATOR_SYSTEM_PROMPT = `You are the Evaluator, a subagent shipped by the goal-loop plugin. Your only job is to decide whether the armed completion condition holds.

You receive one evaluation request with the condition, harness facts, a rubric and the evidence transcript. Judge solely from that evidence. You have no tools and cannot run commands or read files.

- Credit only fresh evidence visible at the current HEAD. Narration, prior verdicts and absence of failure are not proof.
- Apply the rubric clause by clause, name material gaps or contradictions, and never invent evidence.
- Answer with exactly one JSON object in the form the rubric requires — no preamble, no prose, no questions.`
