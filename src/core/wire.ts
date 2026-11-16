/**
 * Validated narrows for data crossing the RPC/TUI boundary. The shared contract (src/rpc.ts) uses plain
 * JSON Schema, so client-side method outputs arrive typed `unknown` and event payloads as untracked records.
 * The guards here check the shape at runtime and hand back the precise type (or drop the payload), which is
 * what the call sites were doing with trust-casts. Pure functions; no I/O. A payload that fails validation
 * is dropped by the caller (the previous entry stays displayed), never partially applied.
 */
import type {
  GoalSnapshot,
  GoalStatus,
  LoopCompactState,
  LoopEntry,
  Notice,
  NoticeKind,
  NoticeLevel,
  UsageSnapshot,
  Verdict,
  VerdictEntry,
} from "./types.ts"

/** Plain (non-array) object check; the base narrow every other guard is built on. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean"
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

const GOAL_STATUSES: ReadonlySet<string> = new Set(["active", "paused", "achieved", "impossible", "cleared", "failed"])
const isGoalStatus = (value: unknown): value is GoalStatus => isString(value) && GOAL_STATUSES.has(value)

const VERDICTS: ReadonlySet<string> = new Set(["met", "not_met", "impossible"])
const isVerdict = (value: unknown): value is Verdict => isString(value) && VERDICTS.has(value)

const NOTICE_KINDS: ReadonlySet<string> = new Set([
  "set",
  "status",
  "cleared",
  "achieved",
  "impossible",
  "paused",
  "resumed",
  "retry",
  "failed",
  "checkin",
  "error",
  "compact",
  "loop",
])
const isNoticeKind = (value: unknown): value is NoticeKind => isString(value) && NOTICE_KINDS.has(value)

const NOTICE_LEVELS: ReadonlySet<string> = new Set(["info", "success", "warning", "error"])
const isNoticeLevel = (value: unknown): value is NoticeLevel => isString(value) && NOTICE_LEVELS.has(value)

const isUsageSnapshot = (value: unknown): value is UsageSnapshot =>
  isRecord(value) &&
  isFiniteNumber(value.cost) &&
  isFiniteNumber(value.input) &&
  isFiniteNumber(value.output) &&
  isFiniteNumber(value.reasoning) &&
  isFiniteNumber(value.cacheRead) &&
  isFiniteNumber(value.cacheWrite)

const isVerdictEntry = (value: unknown): value is VerdictEntry =>
  isRecord(value) && isFiniteNumber(value.turn) && isVerdict(value.verdict) && isString(value.reason) && isFiniteNumber(value.at)

const isLoopEntry = (value: unknown): value is LoopEntry =>
  isRecord(value) &&
  isFiniteNumber(value.version) &&
  isString(value.condition) &&
  isString(value.summary) &&
  isString(value.reason) &&
  isFiniteNumber(value.turns) &&
  isFiniteNumber(value.toolCalls) &&
  isFiniteNumber(value.endedAt)

const isLoopCompact = (value: unknown): value is LoopCompactState =>
  isRecord(value) &&
  isFiniteNumber(value.requestedAt) &&
  isFiniteNumber(value.iteration) &&
  isFiniteNumber(value.misses) &&
  (value.estimatedTokens === undefined || isFiniteNumber(value.estimatedTokens)) &&
  (value.landedAt === undefined || isFiniteNumber(value.landedAt)) &&
  (value.unmeasurableTicks === undefined || isFiniteNumber(value.unmeasurableTicks)) &&
  (value.stalenessUnknown === undefined || isBoolean(value.stalenessUnknown)) &&
  (value.unwillingWarned === undefined || isBoolean(value.unwillingWarned))

/**
 * Structural check for the read model our own server emits over RPC. Optional additive fields (loop state,
 * spend, imported reason/verdict) are validated when present; unknown extra fields are tolerated so older
 * clients keep working against newer servers.
 */
export const isGoalSnapshot = (value: unknown): value is GoalSnapshot => {
  if (!isRecord(value)) return false
  if (value.version !== 1) return false
  if (!isString(value.id) || value.id === "" || !isString(value.sessionID) || value.sessionID === "" || !isString(value.directory) || !isString(value.condition)) return false
  if (!isGoalStatus(value.status)) return false
  if (value.reason !== undefined && !isString(value.reason)) return false
  if (value.verdict !== undefined && !isVerdict(value.verdict)) return false
  if (!isFiniteNumber(value.setAt) || !isFiniteNumber(value.startedAt)) return false
  if (value.endedAt !== undefined && !isFiniteNumber(value.endedAt)) return false
  if (!isFiniteNumber(value.turns) || !isFiniteNumber(value.stall) || !isFiniteNumber(value.retries) || !isFiniteNumber(value.checkins)) return false
  if (!isUsageSnapshot(value.baseline)) return false
  if (value.final !== undefined && !isUsageSnapshot(value.final)) return false
  if (!Array.isArray(value.history) || !value.history.every(isVerdictEntry)) return false
  if (!isFiniteNumber(value.elapsedMs) || !isBoolean(value.evaluating) || !isBoolean(value.waiting)) return false
  if (value.spend !== undefined && !isUsageSnapshot(value.spend)) return false
  if (value.loopEnabled !== undefined && !isBoolean(value.loopEnabled)) return false
  if (value.loopIteration !== undefined && !isFiniteNumber(value.loopIteration)) return false
  if (value.loopObjective !== undefined && !isString(value.loopObjective)) return false
  if (value.loopMaxLoops !== undefined && !isFiniteNumber(value.loopMaxLoops)) return false
  if (value.loopNotProgress !== undefined && !isFiniteNumber(value.loopNotProgress)) return false
  if (value.loopHistory !== undefined && (!Array.isArray(value.loopHistory) || !value.loopHistory.every(isLoopEntry))) return false
  if (value.loopCompact !== undefined && !isLoopCompact(value.loopCompact)) return false
  return true
}

export const parseGoalSnapshot = (value: unknown): GoalSnapshot | undefined => (isGoalSnapshot(value) ? value : undefined)

/**
 * Narrows the `goal` RPC's result. `undefined` means the payload was unusable — the caller keeps the
 * previously cached entry (the same posture as a failed fetch) instead of displaying or caching garbage.
 */
export const parseGetGoalOutput = (value: unknown): { readonly goal: GoalSnapshot | null } | undefined => {
  if (!isRecord(value)) return undefined
  const goal = value.goal
  if (goal === null) return { goal: null }
  const parsed = parseGoalSnapshot(goal)
  return parsed ? { goal: parsed } : undefined
}

/**
 * Narrows a `changed` event payload. `undefined` means drop the event. An explicitly null goal narrows to
 * null (the session's goal was cleared); a present-but-malformed snapshot drops the event rather than
 * blanking a live entry.
 */
export const parseChangedEvent = (value: unknown): { readonly sessionID: string; readonly goal: GoalSnapshot | null } | undefined => {
  if (!isRecord(value)) return undefined
  const sessionID = value.sessionID
  if (!isString(sessionID) || sessionID === "") return undefined
  const goal = value.goal
  if (goal === null || goal === undefined) return { sessionID, goal: null }
  const parsed = parseGoalSnapshot(goal)
  return parsed ? { sessionID, goal: parsed } : undefined
}

/** Narrows a `notice` event payload; `undefined` means drop the notice. */
export const parseNotice = (value: unknown): Notice | undefined => {
  if (!isRecord(value)) return undefined
  const { sessionID, kind, level, title, message } = value
  if (!isString(sessionID) || sessionID === "") return undefined
  if (!isNoticeKind(kind) || !isNoticeLevel(level)) return undefined
  if (!isString(title) || !isString(message)) return undefined
  return { sessionID, kind, level, title, message }
}
