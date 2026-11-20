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
  PauseCause,
  LoopCompactState,
  LoopEntry,
  Notice,
  NoticeKind,
  NoticeLevel,
  UsageSnapshot,
  Verdict,
  VerdictEntry,
} from "./types.ts"

/** Normalizes paths for cross-platform equality (case-insensitive drive letters, separators). */
export const sameDirectory = (a: string, b: string) => {
  const norm = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/$/, "")
  const left = norm(a)
  const right = norm(b)
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** True for Windows drive-letter paths when running on a non-Windows host (test-fixture/foreign path guard). */
export const isWindowsDrivePathOnPosix = (path: string): boolean =>
  process.platform !== "win32" && /^[A-Za-z]:[\\/]/.test(path)

/** Plain (non-array) object check; the base narrow every other guard is built on. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean"
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/**
 * Recursively drops keys whose value is `undefined`, rebuilding plain objects and mapping arrays. `null`
 * is a JSON value and passes through; class instances and non-plain objects pass through untouched (they
 * are not JSON-representable anyway, and rebuilding them would silently change their identity).
 *
 * Why this exists: an RPC payload must be strict JSON by the time it reaches the host. A write like
 * `record.pauseCause = undefined` leaves the key PRESENT with an undefined value, which survives
 * `structuredClone` and which the host rejects anywhere in the payload with
 * `SchemaError(Expected JSON value at …)` — the mechanism behind every `goal/get` HTTP 500 and every dropped
 * `changed` event observed on opencode 2.3.2 (2026-11-17/2026-11-18). Central sanitizing at the emit
 * choke point means no future `= undefined` write can reintroduce the defect.
 */
export const stripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (isRecord(value) && value.constructor === Object) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue
      out[key] = stripUndefined(entry)
    }
    return out
  }
  return value
}

const GOAL_STATUSES: ReadonlySet<string> = new Set(["active", "paused", "achieved", "impossible", "cleared", "failed"])
const PAUSE_CAUSES: ReadonlySet<string> = new Set(["cap", "stall", "user", "repeated_failure"])
const isPauseCause = (value: unknown): value is PauseCause => isString(value) && PAUSE_CAUSES.has(value)
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

const VERIFY_CHECK_TYPES: ReadonlySet<string> = new Set(["typecheck", "tests", "lint", "build", "smoke", "custom", "goal-declared"])
const VERIFY_SOURCES: ReadonlySet<string> = new Set(["configured", "legacy", "goal-declared"])
const VERIFY_EVIDENCE_MODES: ReadonlySet<string> = new Set(["command", "artifact", "either"])
const VERIFY_RUN_STATES: ReadonlySet<string> = new Set(["executed", "artifact", "reused", "skipped"])
const VERIFY_EXECUTION_MODES: ReadonlySet<string> = new Set(["command", "artifact", "reused-command", "reused-artifact", "skipped"])

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

const isVerifyCheckType = (value: unknown): value is NonNullable<VerdictEntry["verification"]>["checks"][number]["type"] =>
  isString(value) && VERIFY_CHECK_TYPES.has(value)

const isVerifyCheckEvidence = (value: unknown): value is NonNullable<VerdictEntry["verification"]>["checks"][number] =>
  isRecord(value) &&
  isString(value.id) &&
  isVerifyCheckType(value.type) &&
  isString(value.command) &&
  isBoolean(value.required) &&
  isBoolean(value.scoped) &&
  isBoolean(value.pass) &&
  (value.code === null || isFiniteNumber(value.code)) &&
  (value.label === undefined || isString(value.label)) &&
  (value.timedOut === undefined || isBoolean(value.timedOut)) &&
  (value.tail === undefined || isString(value.tail)) &&
  (value.reason === undefined || isString(value.reason)) &&
  (value.source === undefined || (isString(value.source) && VERIFY_SOURCES.has(value.source))) &&
  (value.evidenceMode === undefined || (isString(value.evidenceMode) && VERIFY_EVIDENCE_MODES.has(value.evidenceMode))) &&
  (value.runState === undefined || (isString(value.runState) && VERIFY_RUN_STATES.has(value.runState))) &&
  (value.scopeDecision === undefined || isString(value.scopeDecision)) &&
  (value.nextAction === undefined || isString(value.nextAction)) &&
  (value.durationMs === undefined || isFiniteNumber(value.durationMs)) &&
  (value.reused === undefined || isBoolean(value.reused)) &&
  (value.reusedFrom === undefined || isString(value.reusedFrom)) &&
  (value.parallel === undefined || isBoolean(value.parallel)) &&
  (value.concurrency === undefined || isFiniteNumber(value.concurrency)) &&
  (value.skipped === undefined || isBoolean(value.skipped)) &&
  (value.artifactPatterns === undefined || isStringArray(value.artifactPatterns)) &&
  (value.artifactMatched === undefined || isStringArray(value.artifactMatched)) &&
  (value.artifactMissing === undefined || isStringArray(value.artifactMissing)) &&
  (value.executionMode === undefined || (isString(value.executionMode) && VERIFY_EXECUTION_MODES.has(value.executionMode)))

const isVerifyTiming = (value: unknown): boolean =>
  isRecord(value) &&
  isFiniteNumber(value.totalMs) &&
  isFiniteNumber(value.concurrency) &&
  isBoolean(value.parallel) &&
  isFiniteNumber(value.reused) &&
  isFiniteNumber(value.executed) &&
  isFiniteNumber(value.skipped)

const isMalformedGoalCheck = (value: unknown): boolean =>
  isRecord(value) && isString(value.raw) && isString(value.reason)

const isVerdictVerificationMatrix = (value: unknown): value is NonNullable<VerdictEntry["verification"]> =>
  isRecord(value) &&
  isString(value.profile) &&
  isBoolean(value.broadGoal) &&
  isBoolean(value.pass) &&
  Array.isArray(value.checks) && value.checks.every(isVerifyCheckEvidence) &&
  Array.isArray(value.missing) && value.missing.every(isString) &&
  (value.coverageReasons === undefined || isStringArray(value.coverageReasons)) &&
  (value.timing === undefined || isVerifyTiming(value.timing)) &&
  (value.malformedGoalChecks === undefined || (Array.isArray(value.malformedGoalChecks) && value.malformedGoalChecks.every(isMalformedGoalCheck)))

const isLastVerification = (value: unknown): value is NonNullable<GoalSnapshot["lastVerification"]> =>
  isVerdictVerificationMatrix(value) && isFiniteNumber((value as unknown as Record<string, unknown>).at)

const isVerdictEntry = (value: unknown): value is VerdictEntry =>
  isRecord(value) &&
  isFiniteNumber(value.turn) &&
  isVerdict(value.verdict) &&
  isString(value.reason) &&
  isFiniteNumber(value.at) &&
  (value.toolCalls === undefined || isFiniteNumber(value.toolCalls)) &&
  (value.spend === undefined || isUsageSnapshot(value.spend)) &&
  (value.sha === undefined || isString(value.sha)) &&
  (value.verify === undefined || isVerdictVerify(value.verify)) &&
  (value.verification === undefined || isVerdictVerificationMatrix(value.verification))

const isLoopEntry = (value: unknown): value is LoopEntry =>
  isRecord(value) &&
  isFiniteNumber(value.version) &&
  isString(value.condition) &&
  isString(value.summary) &&
  isString(value.reason) &&
  isFiniteNumber(value.turns) &&
  isFiniteNumber(value.toolCalls) &&
  isFiniteNumber(value.endedAt) &&
  (value.contextTokens === undefined || isFiniteNumber(value.contextTokens)) &&
  (value.sha === undefined || typeof value.sha === "string")
  && (value.spend === undefined || isUsageSnapshot(value.spend))

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

const isLastVerify = (value: unknown): value is NonNullable<GoalSnapshot["lastVerify"]> =>
  isRecord(value) &&
  isString(value.command) &&
  (value.code === null || isFiniteNumber(value.code)) &&
  isFiniteNumber(value.at) &&
  (value.timedOut === undefined || isBoolean(value.timedOut)) &&
  (value.tail === undefined || isString(value.tail))

const isVerdictVerify = (value: unknown): value is NonNullable<VerdictEntry["verify"]> =>
  isRecord(value) &&
  isString(value.command) &&
  (value.code === null || isFiniteNumber(value.code)) &&
  (value.timedOut === undefined || isBoolean(value.timedOut)) &&
  (value.tail === undefined || isString(value.tail))

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
  if (value.pauseCause !== undefined && !isPauseCause(value.pauseCause)) return false
  if (value.failureLabel !== undefined && !isString(value.failureLabel)) return false
  if (value.verdict !== undefined && !isVerdict(value.verdict)) return false
  if (!isFiniteNumber(value.setAt) || !isFiniteNumber(value.startedAt)) return false
  if (value.endedAt !== undefined && !isFiniteNumber(value.endedAt)) return false
  if (!isFiniteNumber(value.turns) || !isFiniteNumber(value.stall) || !isFiniteNumber(value.retries) || !isFiniteNumber(value.checkins)) return false
  if (!isUsageSnapshot(value.baseline)) return false
  if (value.final !== undefined && !isUsageSnapshot(value.final)) return false
  if (!Array.isArray(value.history) || !value.history.every(isVerdictEntry)) return false
  if (!isFiniteNumber(value.elapsedMs) || !isBoolean(value.evaluating) || !isBoolean(value.waiting)) return false
  if (value.queued !== undefined && !isBoolean(value.queued)) return false
  if (value.spend !== undefined && !isUsageSnapshot(value.spend)) return false
  if (value.contextSize !== undefined && !isFiniteNumber(value.contextSize)) return false
  if (value.compactAtTokens !== undefined && !isFiniteNumber(value.compactAtTokens)) return false
  if (value.loopEnabled !== undefined && !isBoolean(value.loopEnabled)) return false
  if (value.loopIteration !== undefined && !isFiniteNumber(value.loopIteration)) return false
  if (value.loopObjective !== undefined && !isString(value.loopObjective)) return false
  if (value.loopMaxLoops !== undefined && !isFiniteNumber(value.loopMaxLoops)) return false
  if (value.loopNotProgress !== undefined && !isFiniteNumber(value.loopNotProgress)) return false
  if (value.historyDropped !== undefined && (!isFiniteNumber(value.historyDropped) || value.historyDropped < 0)) return false
  if (value.loopHistory !== undefined && (!Array.isArray(value.loopHistory) || !value.loopHistory.every(isLoopEntry))) return false
  if (value.loopHistoryDropped !== undefined && (!isFiniteNumber(value.loopHistoryDropped) || value.loopHistoryDropped < 0)) return false
  if (value.completedConditions !== undefined && (!Array.isArray(value.completedConditions) || !value.completedConditions.every(isString))) return false
  if (value.completedConditionsDropped !== undefined && (!isFiniteNumber(value.completedConditionsDropped) || value.completedConditionsDropped < 0)) return false
  if (value.loopCompact !== undefined && !isLoopCompact(value.loopCompact)) return false
  if (value.reanchorCount !== undefined && (!isFiniteNumber(value.reanchorCount) || value.reanchorCount < 0)) return false
  if (value.lastVerify !== undefined && !isLastVerify(value.lastVerify)) return false
  if (value.lastVerification !== undefined && !isLastVerification(value.lastVerification)) return false
  if (value.waitingSince !== undefined && !isFiniteNumber(value.waitingSince)) return false
  return true
}

export const parseGoalSnapshot = (value: unknown): GoalSnapshot | undefined => (isGoalSnapshot(value) ? value : undefined)

/**
 * Narrows the `goal` RPC's result. `undefined` means the payload was unusable — the caller keeps the
 * previously cached entry (the same posture as a failed fetch) instead of displaying or caching garbage.
 */
/**
 * Narrows a `list` RPC output to the live goals it carries. Malformed entries are dropped one by one —
 * a single corrupt record must not hide every other live goal. Returns undefined only when the envelope
 * itself is unrecognizable.
 */
export const parseListGoalOutput = (value: unknown): GoalSnapshot[] | undefined => {
  if (!isRecord(value) || !Array.isArray(value.goals)) return undefined
  const out: GoalSnapshot[] = []
  for (const entry of value.goals as unknown[]) {
    const parsed = parseGoalSnapshot(entry)
    if (parsed) out.push(parsed)
  }
  return out
}

export const parseGetGoalOutput = (value: unknown): { readonly goal: GoalSnapshot | null } | undefined => {
  if (!isRecord(value)) return undefined
  const goal = value.goal
  if (goal === null) return { goal: null }
  const parsed = parseGoalSnapshot(goal)
  return parsed ? { goal: parsed } : undefined
}

/**
 * Narrows a `changed` event payload. `undefined` means drop the event. An explicitly null goal narrows to
 * null (the session's goal was cleared); a missing goal key and a present-but-malformed snapshot both drop
 * the event rather than blanking a live entry.
 */
export const parseChangedEvent = (value: unknown): { readonly sessionID: string; readonly goal: GoalSnapshot | null } | undefined => {
  if (!isRecord(value)) return undefined
  const sessionID = value.sessionID
  if (!isString(sessionID) || sessionID === "") return undefined
  const goal = value.goal
  if (goal === undefined) return undefined
  if (goal === null) return { sessionID, goal: null }
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
