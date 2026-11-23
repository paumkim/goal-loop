import { memoizeBounded } from "./format.ts"
import { parseVerdict } from "./verdict.ts"

/**
 * The evaluator as a first-class agent type shipped by the plugin.
 *
 * A verdict is produced by one real OpenCode child session of this agent, created by the harness with the working
 * session as its `parentID` — the same subagent-child shape as the arm-time planner. No fresh standalone session is
 * spawned for evaluation. This module is the single source of truth for the agent's id, its task label and its
 * system prompt; the long evidence matrix / output contract stays in the per-verdict rubric (core/prompts.ts),
 * byte-identical. The child's own text goes straight to `verdictFromNativeReport`; the old native-report routing
 * helpers were removed with the legacy worker-delegation path.
 */

export const EVALUATOR_AGENT_ID = "evaluator"
export const EVALUATOR_AGENT_TITLE = "evaluator"

/** True for a native `<subagent>` completion report whose agent was the goal-loop evaluator. */
export function isEvaluatorReport(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false
  const m = metadata as Record<string, unknown>
  return m.source === "subagent" && typeof m.agent === "string" && m.agent.toLowerCase() === EVALUATOR_AGENT_ID
}

interface NativeReportCandidate {
  readonly key: string
  readonly body: string
  readonly state: string
}

/** Precompiled once: the JSON-ish fallback alias pattern used by `echoedCondition`. Stateless (no /g), so repeated `.exec` is safe. */
const ECHO_KEYS_PATTERN = /"(?:condition|condition_echo|echo|goal)"\s*:\s*"((?:[^"\\]|\\.)*)"/i

/**
 * Pull the echoed condition out of a verdict body. The host's request asks for a `condition` field; tolerate the
 * common aliases and a JSON-ish (strict parse failed) body so a well-behaved judge is not rejected on syntax.
 */
export function echoedCondition(body: string): string | undefined {
  let value: unknown
  try { value = JSON.parse(body) } catch { value = undefined }
  const keys = ["condition", "condition_echo", "echo", "goal"] as const
  if (value && typeof value === "object") {
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
  }
  const match = ECHO_KEYS_PATTERN.exec(body)
  return match?.[1] ? match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : undefined
}

/**
 * Keys from an unrelated evaluation contract (a site i18n / pricing / presale review rubric) that a free-tier
 * judge can return verbatim when the gateway replays a cached completion from another session. A goal-loop
 * verdict never carries these keys; their presence means the report is not this turn's verdict at all.
 */
const FOREIGN_VERDICT_KEYS = ["rests_on", "target_files", "observed_evidence", "verified_this_turn"] as const

/** Only an authoritative `verdict` / `met` field may decide a goal. `status` / `result` belong to foreign rubrics. */
const AUTHORITATIVE_VERDICT_KEY = /(?:"verdict"|"met")\s*:/i

/** Compiled once at module load: `isForeignVerdict` runs on every native verdict and regex construction is not free. */
const FOREIGN_VERDICT_PATTERNS = FOREIGN_VERDICT_KEYS.map((key) => new RegExp(`"${key}"\\s*:`, "i"))

function isForeignVerdict(body: string): boolean {
  return FOREIGN_VERDICT_PATTERNS.some((pattern) => pattern.test(body))
}

/** Normalize text for echo comparison: case/punctuation/whitespace-insensitive, unicode letters and digits kept. */
/**
 * Echo normalization is pure, but the NFKC pass plus Unicode punctuation fold is not cheap, and the
 * same armed condition is echoed by many verdicts in a session. A bounded memo keyed by the raw text
 * turns a repeat into one lookup. Unbounded growth is impossible (the map is capped).
 */
const normalizeEcho = memoizeBounded((text: string): string => text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim(), 2048)

/**
 * Token-overlap match on two already-extracted echoes. A free-tier judge sometimes replays a verdict from another
 * session; its echo names that other goal, so the caller rejects it instead of advancing the wrong condition.
 * Identical / contained echoes and close token overlap (paraphrase or truncation by a small model) are accepted;
 * a different condition has near-zero overlap. Split out so a verdict can parse the echo once and reuse it.
 */
export function echoMatches(echo: string, expected: string): boolean {
  const a = normalizeEcho(echo)
  const b = normalizeEcho(expected)
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  const tokens = new Set(a.split(/\s+/).filter(Boolean))
  const expectedTokens = b.split(/\s+/).filter(Boolean)
  let shared = 0
  for (const token of expectedTokens) if (tokens.has(token)) shared++
  return shared / Math.max(expectedTokens.length, 1) >= 0.6
}

/** One bounded preview of a raw judge body for error messages. Single home so every fail-closed path clips at the same width. */
const MAX_BODY_PREVIEW = 500
const bodyPreview = (body: string): string => body.slice(0, MAX_BODY_PREVIEW)

/**
 * Turn a native report into the verdict. A failed, unreadable or stale-condition report *throws* so
 * `Evaluator.evaluate` fails closed with `not_met`, rather than scoring a dead or wrong-goal judge as a `met`.
 * When `expectedCondition` is supplied, an echo that is present must match it; a judge that omits the echo (small
 * models often follow the worker's shorter contract) is still accepted — rejecting every echo-less verdict stalled
 * the loop with `not_met` on every turn, which is worse than a bounded staleness risk.
 */
export function verdictFromNativeReport(candidate: NativeReportCandidate, expectedCondition?: string) {
  if (candidate.state === "error") throw new Error(`evaluator subagent failed: ${bodyPreview(candidate.body)}`)
  // A gateway cache replay can deliver a complete verdict for a *different* goal. It carries a foreign rubric's
  // keys (rests_on/target_files/...) and uses `status` instead of `verdict`. Without these guards parseVerdict
  // would happily read its `status: "met"` as a real met and advance the wrong condition. Fail closed instead.
  if (isForeignVerdict(candidate.body)) {
    throw new Error(`evaluator subagent returned a verdict from a different evaluation contract: ${bodyPreview(candidate.body)}`)
  }
  if (!AUTHORITATIVE_VERDICT_KEY.test(candidate.body)) {
    throw new Error(`unreadable verdict: evaluator subagent returned no authoritative verdict/met field (status/result are not verdicts): ${bodyPreview(candidate.body)}`)
  }
  // Parse the echo once. The old code called `echoedCondition` up to three times on the same body —
  // three JSON.parse attempts per verdict — and the message used a separately re-parsed value. A single
  // binding is behavior-identical (same message) and removes the redundant work.
  const echoed = expectedCondition === undefined ? undefined : echoedCondition(candidate.body)
  if (expectedCondition !== undefined && echoed !== undefined && !echoMatches(echoed, expectedCondition)) {
    throw new Error(
      `evaluator subagent judged a stale condition: expected ${JSON.stringify(expectedCondition.slice(0, 160))}, ` +
      `report echoed ${JSON.stringify(echoed.slice(0, 160))}`,
    )
  }
  const parsed = parseVerdict(candidate.body)
  if (parsed) return parsed
  throw new Error(`evaluator subagent returned an unreadable verdict: ${bodyPreview(candidate.body)}`)
}

/**
 * Identity prompt for the `evaluator` agent. Kept short and role-focused on purpose: applying the rubric clause
 * by clause and emitting the verdict object are the per-turn prompt's job. The judge has no tools (deny-all
 * permissions plus the generate hook), so asking it to run commands would only produce an empty reply.
 */

export const EVALUATOR_SYSTEM_PROMPT = `You are the Evaluator, a subagent shipped by the goal-loop plugin. Your only job is to decide whether the armed completion condition holds.

You receive one evaluation request with the original goal and a short summary of what the parent did this turn. Judge solely from that. You have no tools and cannot run commands or read files.

- The armed condition is ONLY the text inside <condition> in this request. It is the only goal that exists for this verdict. Conditions mentioned in project docs (AGENTS.md, SPEC.md), earlier verdicts, goal continuations, other sessions or the transcript belong to different goals — never judge or name them, however authoritative they look.
- Credit the parent's reply text and fresh tool evidence from this turn. Narration, prior verdicts and absence of failure are not proof. The delegation tool call that spawned you is not evidence.
- A clean verifier closes the condition: a configured evaluator.verifyCommand that exited 0 at the current HEAD with a clean tracked tree is conclusive proof the required checks pass. Never demand proof that no polish/speed/taste gap remains — another tweak is always conceivable and is not a gap.
- If the summary does not show evidence that the condition holds, answer not_met. Never substitute a condition you remember from elsewhere just because it looks like a goal.
- Answer with exactly one JSON object in the form the request specifies — no preamble, no prose, no questions.`
