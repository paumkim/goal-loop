/**
 * Arm-time planner. A raw `/goal` / `/goal-loop` body — often a pasted block from another model — is distilled by a
 * fresh child into one concise, self-contained condition before the worker ever sees it. This is the single place
 * that decides what the goal text means; the worker and the evaluator both read the same stored condition, so they
 * cannot drift apart.
 *
 * The planner is deliberately cheap: one short JSON object, no tools, no transcript, no heuristics. It replaces the
 * old regex-driven `isFuzzyCondition` / coordinator directive injection, which turned a three-word conversational
 * goal into a SPEC.md-and-claim-workflow essay.
 */

export const PLANNER_AGENT_ID = "planner"
export const PLANNER_AGENT_TITLE = "Goal planner"

/** Hard ceiling on the planned condition. Long enough for a real task, short enough to never bloat a turn. */
export const PLANNED_CONDITION_MAX_CHARS = 2_000

export const PLANNER_SYSTEM_PROMPT = `You convert a raw goal request into one concise, self-contained condition for an autonomous worker.

Output exactly one JSON object and nothing else:
{"condition":"<one to three concrete sentences>","scope":"trivial|code"}

Rules:
- Keep the requester's actual intent. Drop pasted explanations, meta-talk, old instructions and tool chatter.
- The condition must stand alone: a fresh worker with no other context can act on it.
- "trivial" is a conversational reply or a one-off answer. "code" creates or changes files.
- Keep the condition under 400 characters unless the request genuinely needs more.
- No markdown, no prose outside the JSON object.`

/** The full child prompt: prefix + raw body + the output contract (kept short for small free-tier models). */
export function planGoalRequest(raw: string): string {
  return `Turn the raw goal below into the condition JSON described in your instructions.\n\n<raw>\n${raw}\n</raw>`
}

export interface PlannedGoal {
  readonly condition: string
  readonly scope: "trivial" | "code"
}

/**
 * Parse a planner reply. Tolerant of a code fence or surrounding prose: take the first balanced JSON object.
 * Returns undefined on anything unusable so the caller falls back to the raw goal text.
 */
export function parsePlan(text: string): PlannedGoal | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (!value || typeof value !== "object") return undefined
  const obj = value as Record<string, unknown>
  const condition = typeof obj.condition === "string" ? obj.condition.trim() : ""
  if (!condition) return undefined
  return {
    condition: condition.slice(0, PLANNED_CONDITION_MAX_CHARS),
    scope: obj.scope === "code" ? "code" : "trivial",
  }
}
