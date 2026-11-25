/**
 * The pre-verdict abstention gate.
 *
 * A verdict is only actionable when the request names a condition, carries fresh evidence from the finished turn,
 * and no session work is still active. The empty-request trigger is harness-owned: the repo cannot arm an empty
 * condition (see core/parse.ts and GoalController.command), and the host assembles the judge's model request.
 * Judging a bare request would emit a verdict the worker cannot act on and move goal state on evidence that does
 * not exist, so every abstention is a defer — never a met, never a not_met, never an impossible.
 *
 * The gate is applied at the earliest in-repo point where all three signals coexist: `nativeVerdict`
 * (src/index.ts) before the judge child is spawned, so no verdict text is ever generated for an incomplete
 * request. GoalController.evaluate repeats the cheap signals before its pending marker is written, so an
 * empty-condition/active-session defer moves no goal state at all.
 */

export type EvaluationAbstention = "empty-condition" | "no-fresh-evidence" | "active-sessions" | "nested-headless"

export interface EvaluationGateInput {
  /**
   * The text inside <condition>; the only goal a verdict may judge. A harness-injected bare request can omit the
   * field entirely, so it is optional: a missing condition abstains exactly like an empty one instead of throwing.
   */
  readonly condition?: string
  /**
   * Fresh evidence from the just-finished turn: a non-empty parent summary. Omitted by the controller's
   * early guard, where the digest is not yet available; only the explicit `false` from nativeVerdict abstains.
   */
  readonly hasFreshEvidence?: boolean
  /** True while subagent/shell sessions are still running for this goal. */
  readonly activeSessions: boolean
}

/** One operator-facing reason per abstention. Single home so the gate and the controller log cannot drift. */
export const ABSTENTION_REASON: Readonly<Record<EvaluationAbstention, string>> = {
  "empty-condition": "evaluation deferred: request has no <condition> text",
  "no-fresh-evidence": "evaluation deferred: no fresh evidence from a finished turn",
  "active-sessions": "evaluation deferred: sessions are still active",
  "nested-headless": "evaluation deferred: nested headless worker leaves the verdict to the goal owner",
}

/**
 * The exact guard predicate. Order is deliberate: an empty condition is reported first even when the request is
 * also empty of evidence or active, because it is the root cause of a harness-injected bare request.
 */
export function evaluationAbstention(input: EvaluationGateInput): EvaluationAbstention | undefined {
  if (!input.condition?.trim()) return "empty-condition"
  if (input.hasFreshEvidence === false) return "no-fresh-evidence"
  if (input.activeSessions) return "active-sessions"
  return undefined
}
