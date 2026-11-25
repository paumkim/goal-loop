import { BOUNDARY_DROP_FACTOR, BOUNDARY_MIN_TOKENS, COMPACT_COOLDOWN_MS } from "../core/constants.ts"
import type { GoalConfig } from "../core/config.ts"
import { MAX_BUSY_RETRIES } from "../core/config.ts"
import { classifyChangeRisk, collectChangeSetPaths, formatStrictGateNotice, STRICT_GATE_NOTICE_TITLE } from "../core/change-risk.ts"
import { classifyFailure, errorMessage, isNotFoundError, isUsageLimitError } from "../core/errors.ts"
import { ABSTENTION_REASON, evaluationAbstention } from "../core/evaluation-gate.ts"
import { diffUsage, elideAtWordBoundary, formatDuration, formatStatus, normalizeConditionText as normalizeCondition, outcomeStory, statusLabel, stripControls, truncate } from "../core/format.ts"
import { parseGoalCommand } from "../core/parse.ts"
import { isAlreadySatisfiedLanding } from "../core/verdict.ts"
import * as Prompt from "../core/prompts.ts"
import { renderTranscript } from "../core/transcript.ts"
import { artifactEvidenceSatisfied, checkReuseKey, computeScopePolicy, currentHead, evaluateCoveragePolicy, resolveVerifyChecks } from "../core/verify-matrix.ts"
import {
  EMPTY_USAGE, MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES,
  isLive,
  type CommitPolicy,
  type FailureInfo,
  type GoalRecord,
  type GoalSnapshot,
  type GoalStatus,
  type LoopEntry,
  COMPACT_MISS_CAP, boundLoopHistory, boundVerdictHistory, boundCompletedConditions, completedIterationCount, planningSnapshotId,
  type LoopCompactState,
  type Notice,
  type NoticeKind,
  type NoticeLevel, type PauseCause, // may not become its own line: docs cite controller.ts:68 for the epoch field
  type UsageSnapshot,
  type VerdictEntry,
  type VerdictVerificationMatrix,
  type VerifyCheckEvidence,
} from "../core/types.ts"
import type { BackgroundPort, BackgroundWork, Clock, Delivery, EmitterPort, EvaluationResult, EvaluatorPort, Logger, PromptAttachments, SessionPort, VerifierPort } from "./ports.ts"
import { EvaluatorVerdictError } from "./evaluator.ts"
import type { BoundaryCompactResult } from "./compactor.ts"
import { readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { appendLearningEntry, buildGoalArmedLearningEntry, buildGoalTerminalLearningEntry, buildLoopIterationLearningEntry, buildSessionOutcomeLearningEntry, buildTurnVerdictLearningEntry, readLearningEntriesTail, type LearningEntry } from "../core/learning-log.ts"
import { formatLearningsForPrompt } from "../core/outcome-telemetry.ts"
import { FAILURE_SIGNATURE_REPEAT_THRESHOLD, failureEscalationReason, persistFailureDiagnosticArtifact, recognizeNoProgress, strategyForRepeat } from "../core/failure-signature.ts"
import { resolveProjectRoot } from "../core/git.ts"
import { isWindowsDrivePathOnPosix } from "../core/wire.ts"
import { sameDirectory, type GoalStore } from "./store.ts"; import { stripUndefined } from "../core/wire.ts"
import {
  inspectImprovementBacklog,
  normalizeDedupeKey,
  selectNextBacklogItem,
} from "../core/improvement-backlog.ts"

/**
 * Minimum gap between two re-anchors armed for the same session. A compaction can land for several
 * reasons at once (host auto-compact, a boundary request, a restart restore); each used to push its own
 * re-anchor line and the "goal-loop · re-anchor after compaction" entries stacked up in the transcript.
 * One re-anchor carries the same ground truth for all of them.
 */
// Re-anchor coalescing shares the compaction cooldown window (same "don't hammer the host" budget).
const REANCHOR_MIN_INTERVAL_MS = COMPACT_COOLDOWN_MS
// Conditions that name production of a thing: tests/files/merges/commits/artifacts. Used by the zero-tool
// met-rejection in evaluate(); "all tests pass" included — met with zero tool use is never accepted for these.
const PRODUCING_CONDITION = /\b(tests?|files?|merge|merged|commit|create|created|implement|write|fix|build|refactor)\b/i
// Consecutive measurable arms without a landing at which the plugin emits the one host-unwilling warning (2).
// Past that, re-requests drop to a trickle (every 3rd arm) and COMPACT_MISS_CAP stays as a backstop final warning.
// Applies to armed loops only; plain goals never request boundary compaction at all.
const COMPACT_MISS_RETRY = 2

/**
 * The one host-unwilling warning, shared with its acceptance pins so code and tests cannot drift. States the
 * trickle contract in plain words: the loop keeps running, and re-requests slow down after the forced retry.
 */
export const COMPACT_MISS_NOTICE =
  "The boundary compaction has not landed after 2 armed iterations; re-requests drop to a trickle every 3rd arm. The loop keeps running. Run /compact manually if you want it now."

interface ControllerDeps {
  readonly config: GoalConfig
  readonly directory: string
  /** The commit rule that applies to this session's directory. */
  readonly commit: CommitPolicy
  /**
   * Recomputes the commit rule for a directory a session has moved into. Optional so existing callers (tests,
   * probes) keep the fixed `commit`; the host wires it from `resolveCommitPolicy` so a session that leaves one
   * repository for another gets the new repository's rule in its prompts.
   */
  readonly commitFor?: (directory: string) => CommitPolicy
  readonly session: SessionPort
  readonly evaluator: EvaluatorPort
  readonly background: BackgroundPort
  readonly store: GoalStore
  readonly emitter: EmitterPort
  /** Optional harness-side verifier for `evaluator.verifyCommand`. Required only when the command is configured; a `met` verdict is downgraded to `not_met` without one (fail closed). */
  readonly verifier?: VerifierPort
  /**
   * Asks the host to compact the session at a loop-iteration boundary so the next iteration arms with a fresh
   * context. Optional so tests/probes can omit it; awaiting only waits for the host's acceptance of the request.
   * `force` skips the cooldown (never the in-flight/busy gate): used to re-request a compaction that never landed.
   * `cold` makes that compaction replay as no conversation — this is a new goal version, so the worker starts from
   * the freshly armed condition rather than the previous version's transcript.
   */
  readonly compactAtBoundary?: (sessionID: string, opts?: { force?: boolean; cold?: boolean }) => Promise<BoundaryCompactResult>
  /** Estimated model-visible context size in tokens, or undefined when unknown. Used to detect a landed boundary compaction. */
  readonly estimateContext?: (sessionID: string) => Promise<number | undefined>
  /** Session context/messages for scoped transcript/artifact evidence checks (best-effort). */
  readonly context?: (sessionID: string) => Promise<readonly unknown[]>
  readonly clock: Clock
  readonly log: Logger
  readonly newId?: () => string
}

/** Volatile per-session state that never needs persisting. */
interface Runtime {
  /** Owning session — lets invalidate() emit the evaluating:false flip it causes (the in-flight evaluate() would otherwise return silently into the 30s stale window). */
  readonly sessionID: string
  /** Bumped by anything that invalidates in-flight async work (new turn, prompt, clear, replace). */
  epoch: number
  toolCalls: number
  /** Tool calls accumulated across the whole current loop iteration (resets when the iteration is armed). */
  iterationToolCalls: number
  /** Tool calls from turns whose evaluation was deferred by background work. */
  carriedToolCalls: number
  evaluating: boolean
  /** Set when a synthetic steer was dispatched (continuation, retry, check-in, loop arm): the next execution's succeeded event evaluates; any succeeded delivered before the next started is a straggler and is ignored. */
  awaitingExecution: boolean
  /** Ignore a duplicated succeeded event from the execution that just ended until a new execution starts. */
  dropStragglerSucceeded: boolean
  /** Set when this iteration deferred an evaluation because background work was running: background work is real work for the zero-tool not-progress guard. */
  iterationDeferred: boolean
  /** True while the arm-time planner is distilling a fresh /goal. No new record exists yet, so a leftover wake timer must not fire into the parent while planning runs. */
  planning?: boolean
  abort?: AbortController
  timer?: unknown
  deferredSince?: number
  /** True while the main session is heartbeating (an execution started or a tool was called): the pill paints
   *  `active`, not `waiting`, while the agent is actually working — even when a background deferral is pending. */
  heartbeating?: boolean
  /** Last `waiting` value pushed to the TUI; the heartbeat sync emits only when the computed paint actually flips. */
  waitingPaint?: boolean
  lastCheckinAt?: number
  /** Backoff counter for retrying a failed loop-planner step. */
  loopRetries?: number
  /** Backoff counter for retrying a failed busy/background-state check. */
  busyRetries?: number
  /** One-shot notice flags for caps an armed loop runs past without pausing (never re-fired; anti-stacking). */
  capNotified?: boolean
  stallNotified?: boolean
  /** One-shot: the "paused at turn cap" courtesy warning already fired for this freeze. */
  capFreezeNotified?: boolean
  /** Cumulative usage snapshot captured when the current loop iteration was armed (arm / advance). Runtime-local like iterationToolCalls; a restored runtime drops it, so the next recorded iteration carries no spend — never estimated. */
  armUsage?: UsageSnapshot
  /** Cumulative usage reading from the previous evaluation turn (arm-time reading seeds it). Runtime-local like armUsage; a restored runtime drops it, so the first recorded verdict after a restore carries no turn spend — never estimated. */
  turnUsage?: UsageSnapshot
  /** Last host-measured figures, computed at evaluation time: spend vs the record baseline and the estimated prompt-context size. Carried by every `changed` snapshot this session emits until recomputed (compaction landing drops or replaces the context half — it describes a context the host just replaced). Runtime-local like armUsage; a restored runtime drops it. */
  figures?: { readonly spend?: UsageSnapshot; readonly contextSize?: number }
  /** Reuse cache for identical fresh verification-command results within the same evaluated turn/HEAD. */
  verifyCache?: { head?: string; turn: number; results: Map<string, import("../core/types.ts").VerifyCheckEvidence> }
}

const RETRY_BASE_MS = 15_000
const RETRY_MAX_MS = 5 * 60_000
const REEVALUATE_BASE_MS = 10_000
/**
 * Exponential backoff with a cap. Two growth curves, intentionally different: evaluator retries use
 * `REEVALUATE_BASE_MS × 3ⁿ` (10s → 30s → 90s; evaluator failures are usually transient and cheap to retry),
 * planner/continue retries use `RETRY_BASE_MS × 4ⁿ` (15s → 60s → 240s; a failing planner or dispatch
 * burns a full model round-trip, so back off harder). Both are capped at RETRY_MAX_MS.
 */
const backoffMs = (base: number, growth: number, exponent: number) => Math.min(base * growth ** exponent, RETRY_MAX_MS)
/** Fixed backoff for rate/usage-limit-class failures; these windows clear on their own. */
const PAUSE_RETRY_MS = 15 * 60_000
/** Backoff for a failed synthetic-continue dispatch. */
const CONTINUE_RETRY_MS = 60_000
/** Token sets of a normalized string, deduplicated; input must already be normalized (lowercase, one space per separator run). */
const tokensOf = (normalized: string): Set<string> => new Set(normalized.split(" ").filter(Boolean))
/**
 * Near-duplicate test between two normalized token sets: containment (|A ∩ B| / min(|A|, |B|)) >= 0.7
 * or Jaccard >= 0.6. Empty token sets never match. Shared by the loop planner gate (scan bounded by
 * MAX_VERDICT_HISTORY_ENTRIES <= 20 / MAX_LOOP_HISTORY_ENTRIES) and the arming-side no-new-gap gate (XLV),
 * where the scanned ledger is bounded by MAX_COMPLETED_CONDITION_ENTRIES (100).
 */
const isNearDuplicate = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size === 0 || b.size === 0) return false
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  const containment = intersection / Math.min(a.size, b.size)
  const union = a.size + b.size - intersection
  const jaccard = union === 0 ? 0 : intersection / union
  return containment >= 0.7 || jaccard >= 0.6
}

/**
 * The completed-condition ledger of one record, as raw condition strings (deduped by exact match): the persisted
 * `completedConditions` (harness-measured completed iterations), the retained iteration conditions that verdicts met,
 * and — only when the record reached `achieved` — its own condition. A cleared or failed arm never completed its
 * condition, so re-arming the same objective must not be refused on that account. The loop objective is NOT
 * included: it is the constant target of a run, not demonstrated work, and its iteration-1 condition already
 * covers the re-arm question. Matching normalizes at comparison time — same posture as the loop advance gate,
 * which scans the persisted ledger verbatim rather than at write time.
 */
const ledgerOf = (record: GoalRecord): Set<string> => {
  const set = new Set<string>()
  const add = (value: string | undefined) => {
    if (value && normalizeCondition(value)) set.add(value)
  }
  for (const entry of record.completedConditions ?? []) add(entry)
  if (record.status === "achieved") add(record.condition)
  for (const entry of record.loopHistory ?? []) add(entry.condition)
  return set
}
/**
 * Load the repo's improvement backlog and select the highest-priority unblocked open item
 * for loop planning, de-duplicated against completed conditions/history. Returns undefined
 * when the ledger is missing, unreadable, invalid, or yields no selectable item (fallback).
 */
const selectBacklogSuggestion = (
  directory: string,
  record: GoalRecord,
  history: ReadonlyArray<LoopEntry>,
): Prompt.BacklogSuggestion | undefined => {
  let text: string
  try {
    text = readFileSync(join(directory, "docs", "improvement-backlog.json"), "utf8")
  } catch {
    return undefined
  }

  let inspected
  try {
    inspected = inspectImprovementBacklog(text)
  } catch {
    return undefined
  }
  if (!inspected.validation.ok || inspected.backlog.items.length === 0) return undefined

  // Build completed text corpus for de-dup: ledger, history conditions/summaries/reasons, and current condition/objective.
  const completedTexts: string[] = []
  const pushText = (value: string | undefined) => {
    if (value && value.trim()) completedTexts.push(value)
  }
  for (const entry of record.completedConditions ?? []) pushText(entry)
  pushText(record.condition)
  pushText(record.loopObjective)
  for (const entry of record.loopHistory ?? []) {
    pushText(entry.condition)
    pushText(entry.summary)
    pushText(entry.reason)
  }
  for (const entry of history) {
    pushText(entry.condition)
    pushText(entry.summary)
    pushText(entry.reason)
  }

  const completedNormalized = completedTexts.map((value) => normalizeCondition(value)).filter(Boolean)
  const completedHaystacks = completedNormalized.flatMap((value) => [value, normalizeDedupeKey(value)]).filter(Boolean)
  const completedDedupeKeys = new Set<string>(completedNormalized.map(normalizeDedupeKey).filter(Boolean))

  // Treat a backlog item as completed when any of its normalized id/dedupe keys appears in
  // completed conditions/history text (substring match), not only on exact key equality.
  const completedIds = new Set<string>()
  for (const item of inspected.backlog.items) {
    const keys = [item.id, ...(item.dedupeKeys ?? [])].map(normalizeDedupeKey).filter(Boolean)
    if (keys.some((key) => completedHaystacks.some((text) => text.includes(key)))) {
      completedIds.add(item.id)
      for (const key of keys) completedDedupeKeys.add(key)
    }
  }

  const selected = selectNextBacklogItem(inspected.backlog.items, {
    completedIds: [...completedIds],
    completedDedupeKeys: [...completedDedupeKeys],
  })
  if (!selected) return undefined

  return {
    id: selected.id,
    title: selected.title,
    category: selected.category,
    priority: selected.priority,
    impact: selected.impact,
    risk: selected.risk,
    finding: selected.finding,
    improvement: selected.improvement,
    evidence: [...selected.evidence],
  }
}


/**
 * Workstream XLV — the arming-side no-new-gap gate, shared by the planner re-arm boundary (loopAdvance) and the
 * initial /goal-loop arm (arm()). Returns the matched ledger entry on a hit (exact normalized repeat, or token
 * containment >= 0.7 / Jaccard >= 0.6 against the normalized candidate), undefined otherwise. Never throws; the
 * empty candidate or an empty ledger can never match.
 */
const completedLedgerHit = (candidate: string, ledger: ReadonlySet<string>): string | undefined => {
  const normalized = normalizeCondition(candidate)
  if (!normalized) return undefined
  const candidateTokens = tokensOf(normalized)
  for (const entry of ledger) {
    const entryNormalized = normalizeCondition(entry)
    if (!entryNormalized) continue
    if (entryNormalized === normalized) return entry
    if (candidateTokens.size > 0 && isNearDuplicate(candidateTokens, tokensOf(entryNormalized))) return entry
  }
  return undefined
}

type InterruptReason = "user" | "shutdown" | "superseded" | "inactivity" | (string & {})

/**
 * The /goal state machine. Event-driven, one record per session:
 *
 *   set -> active --turn ends--> evaluate --not_met--> continue (synthetic turn) --> ...
 *                                         --met/impossible--> terminal
 *   active --interrupt | explicit opt-in cap (maxTurns/stallTurns)--> paused --user prompt--> active
 *   active --fatal provider error--> failed       any --clear--> cleared
 *   retryable failures are retried forever with capped backoff; the loop never pauses on its own.
 *
 * Async work is guarded by an epoch per session: whenever the world moves on (a new execution starts, the user
 * prompts, the goal is cleared or replaced), stale evaluations and timers drop their results instead of racing.
 */
export class GoalController {
  private readonly goals = new Map<string, GoalRecord>()
  private readonly runtimes = new Map<string, Runtime>()
  private readonly running = new Set<string>()
  /**
   * sessionID -> the directory the host last reported for that session. A goal follows its session, so this
   * per-session view (not the fixed `deps.directory`) is the directory every session-scoped operation uses.
   */
  private readonly directories = new Map<string, string>()
  private readonly commitPolicies = new Map<string, CommitPolicy>()
  /** Last applied host sequence per session; a late event carrying an older directory cannot undo a move. */
  private readonly directorySeq = new Map<string, number>()
  /** Sessions that reported an explicit `session.moved`; a seq-less generic event cannot override that move. */
  private readonly explicitMoves = new Set<string>()
  private readonly newId: () => string
  /** sessionID -> serialized record as of the last store write; lets commit() skip no-op saves and emissions. */
  private readonly lastCommit = new Map<string, string>()
  private readonly lastReanchorAt = new Map<string, number>()
  private disposed = false

  constructor(private readonly deps: ControllerDeps) {
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  // ---------------------------------------------------------------- session location

  /** The directory the host last reported for `sessionID`, falling back to the goal record then the setup directory. */
  private directoryFor(sessionID: string): string {
    return this.directories.get(sessionID) ?? this.goals.get(sessionID)?.directory ?? this.deps.directory
  }

  /** The commit rule currently in force for a session — re-resolved when the session moves checkout. Public so
   *  the host-side prompt/context hooks can render the same rule the controller uses instead of the setup-time
   *  one, which goes stale the moment a session is moved. */
  commitForSession(sessionID: string): CommitPolicy {
    return this.commitPolicies.get(sessionID) ?? this.deps.commit
  }

  /**
   * Reconcile a session's directory from a host event. Idempotent: an event reporting the directory we already
   * have changes nothing — no write, no snapshot, no log. On a real change the goal (live or terminal) travels
   * with the session: the persisted record's `directory` is updated, the verify cache is dropped (a new
   * checkout has a new HEAD), and one `changed` snapshot carries the new location.
   */
  noteSessionDirectory(sessionID: string, directory: string, reason: "event" | "move" = "event", seq?: number): void {
    if (!directory) return
    const lastSeq = this.directorySeq.get(sessionID)
    // Stale by host ordering: a replay or a late event must not drag the goal back to the old checkout.
    if (seq !== undefined && lastSeq !== undefined && seq <= lastSeq) return
    // Without a sequence to compare, an explicit move is authoritative over later generic reports.
    if (seq === undefined && reason === "event" && this.explicitMoves.has(sessionID)) return
    const from = this.directoryFor(sessionID)
    if (sameDirectory(from, directory)) {
      if (seq !== undefined) this.directorySeq.set(sessionID, seq)
      if (reason === "move") this.explicitMoves.add(sessionID)
      return
    }
    if (seq !== undefined) this.directorySeq.set(sessionID, seq)
    if (reason === "move") this.explicitMoves.add(sessionID)
    this.directories.set(sessionID, directory)
    if (this.deps.commitFor) this.commitPolicies.set(sessionID, this.deps.commitFor(directory))
    const runtime = this.runtimes.get(sessionID)
    if (runtime) {
      // Drop cached verification results and invalidate any evaluation in flight: its HEAD/commit-rule evidence
      // belongs to the old checkout and must not land after the move. A bare epoch bump is not enough — the
      // judge keeps running (up to its full timeout) in stale context and its `finally` clears `evaluating`
      // without an emit, leaving the TUI painting "checking" for a verdict that can never land. Abort it and
      // publish the off state now; the persisted pendingEvaluation stays for restart recovery.
      runtime.verifyCache = undefined
      if (runtime.evaluating) {
        runtime.abort?.abort()
        runtime.abort = undefined
        runtime.evaluating = false
        const live = this.goals.get(sessionID)
        if (live) this.emit(live)
      }
      runtime.epoch++
    }
    const record = this.goals.get(sessionID)
    if (record) {
      record.directory = directory
      void this.commit(record).catch((error) => this.deps.log.warn("goal move record write failed", { sessionID, error: errorMessage(error) }))
    }
    this.deps.log.info(
      reason === "move" ? "goal followed session to a new directory" : "goal directory reconciled from session event",
      { sessionID, from, to: directory, ...(seq !== undefined ? { seq } : {}), ...(record ? { status: record.status } : {}) },
    )
  }

  /** The explicit `session.moved` path; the generic event reconciliation covers hosts that report moves otherwise. */
  onSessionMoved(sessionID: string, directory: string, seq?: number): void {
    this.noteSessionDirectory(sessionID, directory, "move", seq)
  }

  /** Live records this instance owns: its setup directory plus sessions the host has since moved. */
  private async liveRecordsVisibleHere(): Promise<GoalRecord[]> {
    const all = await this.deps.store.loadLiveAll().catch(() => [])
    return all.filter((record) => {
      if (sameDirectory(record.directory, this.deps.directory)) return true
      const current = this.directories.get(record.sessionID)
      return current !== undefined && sameDirectory(record.directory, current)
    })
  }

  // ---------------------------------------------------------------- queries

  get(sessionID: string): GoalRecord | undefined {
    return this.goals.get(sessionID)
  }

  /** The active or paused goal, if any. */
  live(sessionID: string): GoalRecord | undefined {
    const record = this.goals.get(sessionID)
    return record && isLive(record.status) ? record : undefined
  }

  /**
   * True when this process adopted/created a terminal (achieved/impossible/cleared/failed) record for
   * the session: the goal ended here and must not re-establish itself. Used by the `context` hook to
   * decide whether a session with no live goal gets the terminal ground-truth line. Volatile — a
   * plugin reload adopts no terminal records, so this reads false until the next terminal transition
   * in this process (instruction stripping still applies; only the reminder line is gated on it).
   */
  hasTerminalRecord(sessionID: string): boolean {
    const record = this.goals.get(sessionID)
    return record !== undefined && !isLive(record.status)
  }

  activeCondition(sessionID: string): string | undefined {
    const record = this.goals.get(sessionID)
    return record?.status === "active" ? record.condition : undefined
  }

  /** Builds a snapshot from a record the caller already holds. Freshness is the record's; runtime may be undefined (a foreign-snapshot read serves no runtime truth). */
  private snapshotRecord(record: GoalRecord, runtime: Runtime | undefined, spend?: UsageSnapshot, contextSize?: number): GoalSnapshot {
    // The auto-compact threshold is constant per session, so it rides every snapshot — cheap, and it lets
    // the dialog render the context meter without knowing anything about the server's configuration.
    const compactAtTokens = this.deps.config.compactAtTokens
    // Every outgoing snapshot must be strict JSON: the host rejects an explicit-undefined key ANYWHERE in
    // the payload with a SchemaError, which surfaced to clients as HTTP 500 on the goal/get RPC and as
    // silently dropped `changed` events. `= undefined` writes elsewhere in the state machine are cleaned at
    // their sites (delete, never assign); this deep pass is the single choke point that makes no future
    // un-cleaned write visible to the host again.
    return stripUndefined({
      ...structuredClone(record),
      elapsedMs: (record.endedAt ?? this.deps.clock.now()) - record.startedAt,
      evaluating: runtime?.evaluating ?? false,
      // Runtime truth wins when present (fresh); the persisted `waitingSince` covers restored waits whose
      // runtime was rebuilt empty by a restart/plugin reload. A deferral holds the *evaluation*, but the pill
      // follows the session's heartbeats: while the main agent is working (execution/tool events) it reads
      // `active`, flipping to `waiting` only once the main session goes quiet with the deferral still pending.
      // The event handlers push that flip as an immediate `changed` event — no 15s mirror tick needed.
      waiting: runtime?.heartbeating !== true && (runtime?.deferredSince !== undefined || record.waitingSince !== undefined),
      // Arm→execution transition visibility (Workstream LX): true from the moment the kickoff steer is
      // dispatched until the host reports the execution started. Absence on records adopted before this
      // field landed — never coerced. Only meaningful on a live record; terminal/paused records say false.
      queued: record.status === "active" ? (runtime?.awaitingExecution ?? false) : false,
      ...(spend ? { spend } : {}),
      ...(typeof compactAtTokens === "number" && compactAtTokens > 0 ? { compactAtTokens } : {}),
      ...(contextSize !== undefined && Number.isFinite(contextSize) && contextSize >= 0 ? { contextSize } : {}),
    }) as GoalSnapshot
  }

  snapshot(sessionID: string, spend?: UsageSnapshot, contextSize?: number): GoalSnapshot | null {
    const record = this.goals.get(sessionID)
    if (!record) return null
    return this.snapshotRecord(record, this.runtimes.get(sessionID), spend, contextSize)
  }

  /**
   * Read-only peek: serves a snapshot without adopting anything. A record in memory is served with its
   * runtime truth; otherwise storage is read fresh and the stored record is served as-is (terminal
   * records included — a `changed` event that never arrived converges through the next pull). Never
   * writes, never adopts, never resets turns/baseline. Returns null for missing records and for
   * records owned by another directory.
   */
  async peekSnapshot(sessionID: string, spend?: UsageSnapshot, contextSize?: number): Promise<GoalSnapshot | null> {
    const inMemory = this.goals.get(sessionID)
    if (inMemory) return this.snapshotRecord(inMemory, this.runtimes.get(sessionID), spend, contextSize)
    const stored = await this.deps.store.load(sessionID).catch(() => undefined)
    if (!stored) return null
    if (!sameDirectory(stored.directory, this.directoryFor(sessionID))) return null
    return this.snapshotRecord(stored, undefined, spend, contextSize)
  }

  /**
   * Read-only list: stored live records merged with in-memory ones (the in-memory copy wins for the same
   * sessionID — this instance's copy is newer than the stored one). Never adopts, never writes.
   */
  async peekList(): Promise<GoalSnapshot[]> {
    const stored = await this.liveRecordsVisibleHere()
    const merged = new Map<string, GoalRecord>()
    for (const record of stored) merged.set(record.sessionID, this.goals.get(record.sessionID) ?? record)
    for (const record of this.goals.values()) if (isLive(record.status) && !merged.has(record.sessionID)) merged.set(record.sessionID, record)
    return [...merged.values()].map((record) => this.snapshotRecord(record, this.runtimes.get(record.sessionID)))
  }

  list(): GoalSnapshot[] {
    return [...this.goals.keys()].map((id) => this.snapshot(id)).filter((s): s is GoalSnapshot => s !== null)
  }

  /** True while a turn is executing for the session. Used to defer mid-work compaction. */
  isExecuting(sessionID: string): boolean {
    return this.running.has(sessionID)
  }

  /**
   * True while subagent/shell sessions are still active for the goal owner, or when the busy check itself fails.
   * This is the in-repo "active sessions visible" signal the verdict gate needs; a failed check counts as active
   * so an incomplete request can never be judged on a guess (fail closed, like the compactor's busy guard).
   */
  async isActive(sessionID: string): Promise<boolean> {
    const work = await this.deps.background.busy(sessionID).catch(() => undefined)
    return work === undefined || work.subagents + work.shells > 0
  }

  /**
   * Shared drop heuristic: true when the estimated context has dropped at least 10% from what it was when the
   * boundary request was made (or below an absolute floor when no estimate was recorded). An unknown/unestimable
   * size is not a drop. Used by the arm-time settle; the ended event is authoritative and needs no estimate.
   * Heuristic, not proof: a landed compaction whose context restores large history is invisible to this test,
   * which is why the ended-event path is preferred.
   */
  private contextDropped(pending: LoopCompactState, size: number | undefined): boolean {
    return size !== undefined && (pending.estimatedTokens === undefined ? size < BOUNDARY_MIN_TOKENS : size <= Math.max(BOUNDARY_MIN_TOKENS, Math.floor(pending.estimatedTokens * BOUNDARY_DROP_FACTOR)))
  }

  /** Reset a pending boundary request to its just-landed form: bookkeeping cleared, misses reset, fresh requests re-enabled. */
  private landPending(record: GoalRecord, pending: LoopCompactState, freshContextSize?: number): void {
    // Bookkeeping cleared for a fresh boundary: absence, never explicit undefined keys (the host rejects them).
    const landed: LoopCompactState = {
      ...pending,
      landedAt: this.deps.clock.now(),
      misses: 0,
    }
    delete landed.unmeasurableTicks
    delete landed.stalenessUnknown
    delete landed.unwillingWarned
    record.loopCompact = landed
    // The cached context figure described the pre-compaction context the host just replaced. Replace it
    // with the fresh post-landing estimate when the caller has one, else drop it — the meter renders
    // nothing until the next evaluation measures the new context instead of painting a lie.
    const runtime = this.runtimes.get(record.sessionID)
    if (!runtime?.figures) return
    const figures = runtime.figures
    runtime.figures =
      freshContextSize !== undefined && Number.isFinite(freshContextSize) && freshContextSize >= 0
        ? { ...figures, contextSize: freshContextSize }
        : { ...(figures.spend !== undefined ? { spend: figures.spend } : {}) }
  }

  /**
   * The host reported a compaction ended for the session. An ended event is authoritative — it means the host
   * compacted, so any pending boundary-compaction request is recorded as landed (misses reset, fresh requests
   * re-enabled, one success notice), regardless of what the size estimate says. The landing also re-anchors
   * a live loop immediately: the re-stated ground truth rides the SYSTEM part of the next model request
   * (one-shot injection via the `context` hook), never the transcript. A landing is never silent. Plain
   * goals are re-anchored nowhere: they carry no loop ground truth to restore, and plain (non-loop) records
   * never arm boundary requests at all.
   */
  async onCompactionLanded(sessionID: string): Promise<void> {
    const record = this.goals.get(sessionID)
    // Terminal records are inert: a landed compaction must not land boundary state, re-commit the
    // finished record, or re-state ground truth for a goal that already reached met/cleared/... —
    // the model-bound re-anchor would tell it to keep working on a finished goal.
    if (record && !isLive(record.status)) return
    const pending = record?.loopCompact
    if (record && pending && !pending.landedAt) {
      this.landPending(record, pending)
      try {
        await this.commit(record)
      } catch (error) {
        this.deps.log.warn("compaction-landed record failed to persist", { sessionID, error: errorMessage(error) })
      }
      this.deps.log.info("compaction landed via the compaction-ended event", { sessionID })
      this.notify(sessionID, "compact", "success", "Compaction landed", "The host compacted the session (compaction-ended event); loop boundary state reset.")
    }
    // The await above can span a `session.deleted` event: the record would have been removed from the
    // map and storage, and re-anchoring now would re-create it. Only continue for the adopted record.
    if (this.goals.get(sessionID) !== record) return
    // A landed compaction replaces history with a lossy summary; a live loop re-states its ground truth
    // so the armed condition, the objective and the completed iterations survive the cut. Queued
    // (resume: false): never wakes the session, never interrupts an in-flight turn — the arm/continuation
    // steers that keep the loop moving carry it into the model's view.
    if (record && record.loopEnabled && record.status === "active") this.reanchor(record)
  }

  /** Final-usage snapshots in flight; dispose() awaits them so the last record write is durable before flush. */
  private readonly pendingUsage = new Set<Promise<void>>()
  /** Fire-and-forget terminal-record prunes kicked off by `finish()`; awaited by `dispose()` so flush sees their removals. */
  private readonly pendingPrunes = new Set<Promise<void>>()

  /** Re-anchor texts awaiting the next model request; one-shot, volatile (a restart drops a pending one — the next landing re-arms it). */
  private readonly pendingAnchors = new Map<string, string>()

  /**
   * The re-anchor the host never sees as a message: after a landed compaction the ground truth is
   * one-shot-injected into the SYSTEM part on the next model request (via the `context` hook in the
   * plugin's wiring), so the transcript stays clean and the model still gets the full re-statement.
   * Consumed on read — the text fires exactly once. Volatile by design.
   */
  consumeAnchor(sessionID: string): string | undefined {
    const text = this.pendingAnchors.get(sessionID)
    if (text !== undefined) this.pendingAnchors.delete(sessionID)
    // A re-anchor armed while the loop was live must never ride a model request after the goal
    // reached a terminal status: the text tells the model to keep working on a finished goal.
    // finish() drops pending anchors, but a landing that armed one before the finish (or a record
    // evicted outside finish's reach) must fail closed here too.
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") return undefined
    return text
  }

  /** Arm the post-compaction ground-truth re-anchor; fire-and-forget. Coalesced: at most one per session per {@link REANCHOR_MIN_INTERVAL_MS}. */
  private reanchor(record: GoalRecord) {
    // Never arm (or commit) for a record that is no longer the adopted one — deleted mid-flight above.
    if (this.goals.get(record.sessionID) !== record) return
    const now = this.deps.clock.now()
    const last = this.lastReanchorAt.get(record.sessionID)
    if (last !== undefined && now - last < REANCHOR_MIN_INTERVAL_MS) {
      this.deps.log.info("loop re-anchor coalesced: one was armed recently", { sessionID: record.sessionID })
      return
    }
    this.lastReanchorAt.set(record.sessionID, now)
    this.pendingAnchors.set(
      record.sessionID,
      Prompt.loopReanchor({
        iteration: record.loopIteration ?? 1,
        maxLoops: record.loopMaxLoops ?? this.deps.config.maxLoops,
        objective: record.loopObjective ?? record.condition,
        condition: record.condition,
        history: record.loopHistory ?? [],
      }),
    )
    // The card counts these; the transcript does not. One quiet number instead of one notice per landing.
    record.reanchorCount = (record.reanchorCount ?? 0) + 1
    void this.commit(record).catch((error) => this.deps.log.warn("re-anchor record update failed", { sessionID: record.sessionID, error: errorMessage(error) }))
  }

  async spend(sessionID: string): Promise<UsageSnapshot | undefined> {
    // In-memory first; an unadopted session (a second window's goal on the same directory, or this instance
    // post-reload) falls back to the stored record so the ledger still answers — storage reads are cheap.
    const record = this.goals.get(sessionID) ?? await this.deps.store.load(sessionID).catch(() => undefined)
    if (!record) return undefined
    if (record.final) return diffUsage(record.final, record.baseline)
    const usage = await this.deps.session.usage(sessionID).catch(() => undefined)
    return usage && diffUsage(usage, record.baseline)
  }

  /**
   * Absolute estimated prompt tokens; undefined when unestimable. Pure passthrough — never estimated on the hot path.
   * Memory-gated on purpose: a foreign session must not trigger the expensive context estimate (a host round-trip per poll).
   */
  async contextSize(sessionID: string): Promise<number | undefined> {
    if (!this.goals.has(sessionID)) return undefined
    if (!this.deps.estimateContext) return undefined
    const size = await this.deps.estimateContext(sessionID).catch(() => undefined)
    return size !== undefined && Number.isFinite(size) && size >= 0 ? size : undefined
  }

  // ---------------------------------------------------------------- commands

  /** Entry point for `/goal <args>` and `/goal-loop <args>`. */
  async command(input: { sessionID: string; text: string; delivery: Delivery; loop?: boolean; planned?: boolean } & PromptAttachments): Promise<void> {
    const parsed = parseGoalCommand(input.text, this.deps.config.maxConditionChars)
    switch (parsed.type) {
      case "status":
        return this.status(input.sessionID)
      case "clear":
        this.clear(input.sessionID)
        return
      case "invalid":
        this.notify(input.sessionID, "error", "error", `${input.loop ? "Loop" : "Goal"} not set`, parsed.message)
        return
      case "set":
        return this.set({ ...input, condition: parsed.condition, ...(input.loop ? { loop: true } : {}), ...(input.planned ? { planned: true } : {}) })
    }
  }

  /**
   * Create, persist and announce a goal/loop record. Shared by the command path (`set()`, which then asks the host
   * to admit a synthetic directive message) and the prompt-hook path (`armFromPrompt()`, where the host admits the
   * user's own directive-carrying prompt as the kickoff, so no synthetic message is sent). Returns the record.
   */
  private async arm(input: { sessionID: string; condition: string; loop: boolean; maxLoops?: number }): Promise<GoalRecord> {
    const { sessionID, condition } = input
    // Capture BEFORE finishing/replacing: this object may be the in-memory copy of the persisted completed-condition
    // ledger that finish() is about to write through — after goals.set() below it is gone.
    const inMemoryPrior = this.goals.get(sessionID)
    const previous = this.live(sessionID)
    if (previous) this.finish(previous, "cleared", "Replaced by a new goal.")
    const now = this.deps.clock.now()
    const measured = await this.deps.session.usage(sessionID).catch(() => undefined)
    const baseline = measured ?? EMPTY_USAGE
    const loop = input.loop
    // Per-run override only: this never touches config.maxLoops, so a later /goal-loop-<N> applies to that run alone.
    const maxLoops = input.maxLoops ?? this.deps.config.maxLoops
    if (loop) {
      // Workstream XLV — the arming-side no-new-gap gate. The planner re-arm boundary in loopAdvance has run the
      // anti-repeat and near-duplicate gates against the record's persisted completedConditions ledger since XXXVII;
      // the initial /goal-loop arm did not, so re-issuing an objective this session already completed could spend
      // iteration 1 on duplicate work. Collect the ledger from the record being replaced (in memory, the freshest
      // copy) and from durable storage (cross-restart; restore() only adopts live records, terminal ones stay here),
      // run the same exact-repeat / containment >= 0.7 / Jaccard >= 0.6 test, and on a hit do NOT arm: persist a
      // terminal record carrying the ledger forward (nothing the prior runs recorded is lost), notify and log with
      // the explicit "no new gap" reason, and end as achieved without spending an iteration.
      const durable = await this.deps.store.load(sessionID).catch(() => {
        this.deps.log.warn("no-new-gap gate: prior record unreadable; arming with the in-memory ledger only", { sessionID })
        return undefined
      })
      const ledger = new Set<string>()
      let dropped = 0
      const seen = new Set<string>()
      for (const source of [inMemoryPrior, durable]) {
        if (!source || seen.has(source.id)) continue
        seen.add(source.id)
        dropped += source.completedConditionsDropped ?? 0
        for (const entry of ledgerOf(source)) ledger.add(entry)
      }
      const hit = completedLedgerHit(condition, ledger)
      if (hit !== undefined) {
        const capped = boundCompletedConditions([...ledger])
        const totalDropped = dropped + capped.dropped
        const refusalReason = `no new gap: the proposed objective near-duplicates the already-completed "${truncate(normalizeCondition(hit), 140)}" recorded for this session; the loop was not armed.`
        const refusal: GoalRecord = {
          version: 1,
          id: this.newId(),
          sessionID,
          directory: this.directoryFor(sessionID),
          condition,
          status: "achieved",
          setAt: now,
          startedAt: now,
          endedAt: now,
          reason: refusalReason,
          turns: 0,
          stall: 0,
          retries: 0,
          checkins: 0,
          baseline,
          history: [],
          loopEnabled: true,
          loopIteration: 1,
          loopObjective: condition,
          loopMaxLoops: maxLoops,
          loopHistory: [],
          loopNotProgress: 1,
          completedConditions: capped.retained,
          ...(totalDropped > 0 ? { completedConditionsDropped: totalDropped } : {}),
        }
        this.goals.set(sessionID, refusal)
        this.reset(sessionID)
        await this.commit(refusal)
        this.evictTerminalGoalsBeyondRetention()
        this.notify(sessionID, "loop", "warning", "Loop not armed: no new gap", refusalReason)
        this.deps.log.warn("loop arm refused: no new gap", { sessionID, matched: truncate(normalizeCondition(hit), 120) })
        return refusal
      }
    }
    const record: GoalRecord = {
      version: 1,
      id: this.newId(),
      sessionID,
      directory: this.directoryFor(sessionID),
      condition,
      status: "active",
      setAt: now,
      startedAt: now,
      turns: 0,
      stall: 0,
      retries: 0,
      checkins: 0,
      baseline,
      history: [],
      ...(loop
        ? { loopEnabled: true, loopIteration: 1, loopObjective: condition, loopMaxLoops: maxLoops, loopHistory: [], loopNotProgress: 0 }
        : {}),
    }
    this.goals.set(sessionID, record)
    this.reset(sessionID)
    const armRuntime = this.runtimes.get(sessionID)
    if (armRuntime && measured) {
      if (loop) armRuntime.armUsage = measured
      armRuntime.turnUsage = measured
    }
    // Await the initial write: a crash between arm() returning and the record landing would silently un-set the goal.
    await this.commit(record)
    if (record.status === "active") this.writeLearningGoalArmed(record)
    this.surfaceChangeRiskStrictGate(sessionID, this.directoryFor(sessionID))
    const loopLabel = loop ? "Loop" : "Goal"
    const detail = loop ? `iteration="1" max="${maxLoops}" · ${condition}` : condition
    this.notify(sessionID, "set", "info", previous ? `${loopLabel} replaced` : `${loopLabel} set`, detail)
    return record
  }

  async set(input: { sessionID: string; condition: string; delivery: Delivery; loop?: boolean; maxLoops?: number; planned?: boolean } & PromptAttachments): Promise<void> {
    const { sessionID, condition } = input
    const loop = input.loop === true
    const maxLoops = input.maxLoops ?? this.deps.config.maxLoops
    const record = await this.arm({ sessionID, condition, loop, ...(input.maxLoops !== undefined ? { maxLoops: input.maxLoops } : {}) })
    if (record.status !== "active") return // Workstream XLV: the arming-side no-new-gap gate refused; the notice already told the user why.
    const loopLabel = loop ? "Loop" : "Goal"
    try {
      await this.deps.session.prompt({
        sessionID,
        text: Prompt.directive(
          condition,
          this.commitForSession(sessionID),
          loop ? { iteration: 1, maxLoops, objective: condition, history: [] } : undefined,
          input.planned === true,
        ),
        delivery: input.delivery,
        ...(input.files?.length ? { files: input.files } : {}),
        ...(input.agents?.length ? { agents: input.agents } : {}),
        ...(input.skills?.length ? { skills: input.skills } : {}),
      })
    } catch (error) {
      if (this.goals.get(sessionID) === record) this.finish(record, "failed", `Could not start the ${loopLabel.toLowerCase()}: ${errorMessage(error)}`)
      throw error
    }
  }

  /**
   * Paint a transient goal bar while the arm-time planner distils the raw `/goal` body. The controller has no
   * record yet (arming happens after planning), so this snapshot is emitted straight to the ports and never
   * stored: the real `arm()` commit immediately replaces it with the authoritative condition. `queued` is the
   * existing "work in flight" face, so no new status, field or TUI change is needed for the first arm to be visible.
   */
  showPlanning(sessionID: string, condition: string): void {
    const now = this.deps.clock.now()
    // A /goal arm runs this planner before arm() creates the new record. If the session already has a
    // waiting goal, its idle check-in is still armed: clear it so it cannot fire into the parent while
    // the planner is working. endPlanning() restores it if no replacement was armed.
    const runtime = this.runtimes.get(sessionID)
    if (runtime) {
      runtime.planning = true
      if (runtime.timer !== undefined) {
        this.deps.clock.clearTimeout(runtime.timer)
        runtime.timer = undefined
      }
    }
    const snapshot: GoalSnapshot = {
      version: 1,
      id: planningSnapshotId(sessionID),
      sessionID,
      directory: this.directoryFor(sessionID),
      condition,
      status: "active",
      setAt: now,
      startedAt: now,
      turns: 0,
      stall: 0,
      retries: 0,
      checkins: 0,
      baseline: EMPTY_USAGE,
      history: [],
      elapsedMs: 0,
      evaluating: false,
      waiting: false,
      queued: true,
    }
    this.deps.emitter.changed(sessionID, snapshot)
  }

  /**
   * The arm-time planner finished, failed or was aborted: lift the check-in suppression set by showPlanning().
   * A successful arm resets the runtime, so this only restores a wait that was left live by a failed plan.
   */
  endPlanning(sessionID: string): void {
    const runtime = this.runtimes.get(sessionID)
    if (!runtime || runtime.planning !== true) return
    runtime.planning = false
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") return
    if (runtime.deferredSince === undefined && record.waitingSince === undefined) return
    runtime.lastCheckinAt = this.deps.clock.now()
    this.armCheckin(record, runtime, { subagents: 0, shells: 0 })
  }

  /** Fresh read of the planning window: async paths must re-check rather than trust a flag sampled before an await. */
  private isPlanning(sessionID: string): boolean {
    return this.runtimes.get(sessionID)?.planning === true
  }

  /** User-visible notice for a present-but-invalid loop count suffix. Stated, never guessed; the default applies. */
  noteInvalidLoopCount(sessionID: string, invalidCount: string): void {
    const shown = sanitizeCountEcho(invalidCount)
    const reason =
      shown === "" ? "nothing was provided after `/goal-loop-` or `/goal-loop=`" : `"${shown}" is not a valid loop count (an integer from 1 to 1000)`
    this.notify(sessionID, "set", "warning", "Loop count ignored", `${reason}; using the default limit of ${this.deps.config.maxLoops}.`)
  }

  /** Report an objective that exceeds the configured condition limit. Called before the directive is rewritten; nothing is armed and the prompt is left untouched. */
  noteConditionTooLong(sessionID: string, length: number, limit: number): void {
    this.notify(sessionID, "error", "error", "Loop not set", `Goal condition is ${length} characters; the limit is ${limit}.`)
  }

  /**
   * Arm a loop from a raw user prompt that carried the `/goal-loop[-N|=N]` directive (the unknown-slash-command
   * path). The host admits the rewritten prompt as the kickoff message, so unlike `set()` this does not ask the host
   * to send a synthetic directive — it only creates the record. `maxLoops` is a per-run cap; config.maxLoops is untouched.
   */
  async armFromPrompt(input: { sessionID: string; condition: string; maxLoops?: number; invalidCount?: string }): Promise<GoalRecord> {
    if (input.invalidCount !== undefined) this.noteInvalidLoopCount(input.sessionID, input.invalidCount)
    return this.arm({ sessionID: input.sessionID, condition: input.condition, loop: true, ...(input.maxLoops !== undefined ? { maxLoops: input.maxLoops } : {}) })
  }

  clear(sessionID: string): boolean {
    const record = this.live(sessionID)
    if (!record) {
      this.notify(sessionID, "cleared", "info", "No goal set", "There is no active goal in this session.")
      return false
    }
    this.finish(record, "cleared")
    this.notify(sessionID, "cleared", "info", "Goal cleared", record.condition)
    return true
  }

  async status(sessionID: string): Promise<void> {
    const record = this.goals.get(sessionID)
    if (!record) {
      this.notify(sessionID, "status", "info", "No goal set", "Set one with /goal <condition>.")
      return
    }
    const spend = await this.spend(sessionID)
    const text = formatStatus(record, this.deps.clock.now(), spend, this.deps.config.maxLoops)
    const title = isLive(record.status) ? `Goal ${statusLabel(record.status)}` : record.status === "achieved" ? "No goal set \u00B7 last goal achieved" : "No goal set"
    this.notify(sessionID, "status", "info", title, text)
  }

  /**
   * Best-effort change-risk classification for the session's working directory. When the change set
   * touches high-risk sensitive surfaces (deps, auth, migrations, CI/release, data paths), surface a
   * strict-gate notice so stricter gates/review are explicit before landing.
   */
  private surfaceChangeRiskStrictGate(sessionID: string, directory: string): void {
    try {
      const paths = collectChangeSetPaths(directory)
      if (paths.length === 0) return
      const assessment = classifyChangeRisk(paths)
      if (!assessment.highRisk) return
      this.notify(sessionID, "set", "warning", STRICT_GATE_NOTICE_TITLE, formatStrictGateNotice(assessment))
      this.deps.log.info("change-risk strict gate surfaced", {
        sessionID,
        tier: assessment.tier,
        surfaces: [...assessment.surfaces],
        files: paths.length,
      })
    } catch (error) {
      this.deps.log.warn("change-risk classification failed", { sessionID, error: errorMessage(error) })
    }
  }

  // ---------------------------------------------------------------- session events

  onExecutionStarted(sessionID: string) {
    this.running.add(sessionID)
    // Lazy-create the runtime when a goal exists: after a restart/plugin reload the runtime map is empty,
    // and every tool event before the first execution-end would otherwise be dropped.
    const runtime = this.goals.has(sessionID) ? this.runtime(sessionID) : this.runtimes.get(sessionID)
    if (!runtime) return
    runtime.heartbeating = true
    const wasQueued = runtime.awaitingExecution
    this.invalidate(runtime)
    runtime.toolCalls = 0
    runtime.awaitingExecution = false
    runtime.dropStragglerSucceeded = false
    if (wasQueued) {
      // The execution is in flight; the kickoff is no longer in the host's inbox. Emit so the pill
      // clears "queued" instead of holding it until an unrelated event flushes the mirror.
      const live = this.goals.get(sessionID)
      if (live) this.emit(live)
    }
    // The session is working again: flip `waiting` -> `active` now, not at the next execution boundary.
    this.syncWaitingPaint(sessionID)
  }

  onToolCalled(sessionID: string) {
    // Same lazy-create as onExecutionStarted: a session with a live goal must never silently drop tool events.
    if (!this.goals.has(sessionID)) return
    const runtime = this.runtime(sessionID)
    runtime.toolCalls++
    // Counted eagerly so a turn whose evaluation is later superseded or dropped still counts as work for the loop.
    runtime.iterationToolCalls++
    // A tool call is a heartbeat too: even if the execution-started event was missed (restart/reconnect), the
    // pill flips back to `active` immediately. syncWaitingPaint dedupes a turn's many calls into one event.
    runtime.heartbeating = true
    this.syncWaitingPaint(sessionID)
  }

  /** A user prompt was admitted (not synthetic). Resumes a paused goal and re-arms idle check-ins. */
  onUserPrompt(sessionID: string) {
    const record = this.live(sessionID)
    if (!record) return
    const runtime = this.runtime(sessionID)
    this.invalidate(runtime)
    record.checkins = 0
    runtime.lastCheckinAt = undefined
    if (record.status === "paused") {
      // Turn-cap freeze (plain goals only): a message does not extend the cap, so resume would re-pause
      // after one turn. An armed /goal-loop resumes on a message even past the cap.
      // Stay paused; the user must clear or set a new goal (a restart resets the turn counter).
      if (!record.loopEnabled && this.deps.config.maxTurns > 0 && record.turns >= this.deps.config.maxTurns) {
        this.clearDeferred(runtime, record)
        // One courtesy warning per freeze; later prompts in the same pause stay silent.
        if (!runtime.capFreezeNotified) {
          runtime.capFreezeNotified = true
          this.notify(sessionID, "paused", "warning", "Goal paused at turn cap", `${record.reason ?? "Reached the turn limit."} A message will not extend the cap; run /goal clear or set a new goal.`)
        }
        this.commit(record)
        return
      }
      this.clearDeferred(runtime, record)
      record.status = "active"
      // Absence, not explicit undefined: the host rejects explicit-undefined keys in any RPC payload.
      delete record.reason
      delete record.pauseCause
      record.stall = 0
      record.retries = 0
      // A resumed /goal-loop starts the not-progress count fresh, so a benign zero-tool iteration cannot instantly re-pause it.
      if (record.loopEnabled) record.loopNotProgress = 0
      this.notify(sessionID, "resumed", "info", "Goal resumed", record.condition)
    } else {
      this.clearDeferred(runtime, record)
    }
    this.commit(record)
  }

  async onExecutionSucceeded(sessionID: string): Promise<void> {
    this.running.delete(sessionID)
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") {
      // The evaluator judges the goal-owning parent, never a descendant. A subagent's completion only ends
      // its own execution; the harness injects its report back into the parent, which wakes the parent's turn
      // and lets its evaluation read the parent's work plus the bundled Planner's distilled condition. Judging
      // the child here spawned a verdict (and a continuation steer) against every worker subagent regardless
      // of the goal, which stole turns from the parent and made the goal pill follow subagents.
      return
    }
    const runtime = this.runtime(sessionID)
    // The main session went quiet: if a background deferral is still pending, the pill flips straight back
    // to `waiting` on this event — it no longer rides a check-in or the 15s mirror tick. A succeeded means
    // the execution ended even when it is a straggler that must not be evaluated, so clear the heartbeat
    // before the drop guard: a missed execution-start would otherwise strand the pill on `active` forever.
    runtime.heartbeating = false
    this.syncWaitingPaint(sessionID)
    if (runtime.awaitingExecution || runtime.dropStragglerSucceeded) {
      // Straggler duplicate of the previous turn or of a turn whose retry steer has not started yet.
      this.deps.log.info("goal evaluation straggler dropped", { sessionID, awaitingExecution: runtime.awaitingExecution, dropStragglerSucceeded: runtime.dropStragglerSucceeded })
      return
    }
    // This success is consumed. A second `succeeded` for the same execution (distinct event id, so
    // the router's dedupe cannot catch it) must not bump the epoch again and supersede this turn.
    // The marker is cleared by the next execution.started, exactly like the failure/interrupt paths.
    runtime.dropStragglerSucceeded = true
    const epoch = ++runtime.epoch
    const tools = runtime.toolCalls
    runtime.toolCalls = 0
    await this.resolveBackgroundAndEvaluate(record, runtime, epoch, tools)
  }

  /** Resolve background/busy state and evaluate (or defer) the completed turn's tool work. Tools not yet added to carriedToolCalls. */
  private async resolveBackgroundAndEvaluate(record: GoalRecord, runtime: Runtime, epoch: number, tools: number): Promise<void> {
    const sessionID = record.sessionID
    const work = await this.deps.background.busy(sessionID).catch((error): BackgroundWork | undefined => {
      this.deps.log.warn("goal busy check failed; will retry", { sessionID, error: errorMessage(error) })
      return undefined
    })
    if (this.stale(record, runtime, epoch)) {
      this.preserveToolsOnStaleDrop(record, runtime, tools, "after busy check")
      return
    }
    if (!work) {
      runtime.carriedToolCalls += tools
      runtime.iterationDeferred = true
      this.ensureDeferredState(record, runtime)
      this.scheduleBusyRetry(record, runtime)
      return
    }
    runtime.busyRetries = undefined
    if (work.subagents + work.shells > 0) return this.defer(record, runtime, work, tools)
    const carried = runtime.carriedToolCalls
    runtime.carriedToolCalls = 0
    this.clearDeferred(runtime, record)
    await this.evaluate(record, runtime, epoch, tools + carried)
  }

  /** Ensure deferred/waiting state is persisted and emitted when a turn must wait. */
  private ensureDeferredState(record: GoalRecord, runtime: Runtime): void {
    if (runtime.deferredSince === undefined) {
      runtime.deferredSince = this.deps.clock.now()
      record.waitingSince = runtime.deferredSince
      void this.commit(record)
    } else if (record.waitingSince === undefined) {
      record.waitingSince = runtime.deferredSince
      void this.commit(record)
    } else {
      this.emit(record)
    }
  }

  /** Retry background-state resolution with bounded backoff when a busy check fails. */
  private scheduleBusyRetry(record: GoalRecord, runtime: Runtime): void {
    const sessionID = record.sessionID
    const attempt = runtime.busyRetries ?? 0
    if (attempt >= MAX_BUSY_RETRIES) {
      this.deps.log.warn("busy-check retries exhausted; evaluating with carried tools", { sessionID })
      runtime.busyRetries = undefined
      // Fall through to evaluate with whatever tools we have — better than hanging forever.
      const carried = runtime.carriedToolCalls
      runtime.carriedToolCalls = 0
      this.clearDeferred(runtime, record)
      void this.evaluate(record, runtime, ++runtime.epoch, carried).catch((e) => this.deps.log.error("fallback evaluation failed", { error: errorMessage(e) }))
      return
    }
    const delay = backoffMs(RETRY_BASE_MS, 4, attempt)
    runtime.busyRetries = attempt + 1
    this.notify(sessionID, "retry", "warning", "Goal still active", `Could not check background work state; retrying in ${formatDuration(delay)}.`)
    this.schedule(runtime, delay, () => {
      void this.retryDeferredBackgroundCheck(record, runtime).catch((error) => {
        this.deps.log.error("busy-check retry failed", { sessionID, error: errorMessage(error) })
      })
    })
  }

  /** Re-attempt busy/background resolution for a deferred turn (busy-check failure or drain retry). */
  private async retryDeferredBackgroundCheck(record: GoalRecord, runtime: Runtime): Promise<void> {
    const sessionID = record.sessionID
    if (this.disposed) return
    if (this.goals.get(sessionID) !== record || record.status !== "active") return
    if (runtime.evaluating || this.running.has(sessionID)) return
    const epoch = ++runtime.epoch
    const work = await this.deps.background.busy(sessionID).catch((error): BackgroundWork | undefined => {
      this.deps.log.warn("goal busy check failed; will retry", { sessionID, error: errorMessage(error) })
      return undefined
    })
    if (this.stale(record, runtime, epoch)) {
      this.logStaleDrop(record, runtime, epoch, "busy-check retry")
      return
    }
    if (!work) {
      runtime.iterationDeferred = true
      this.ensureDeferredState(record, runtime)
      this.scheduleBusyRetry(record, runtime)
      return
    }
    runtime.busyRetries = undefined
    if (work.subagents + work.shells > 0) {
      // Still busy: keep deferred state and arm a normal check-in schedule.
      runtime.iterationDeferred = true
      this.ensureDeferredState(record, runtime)
      this.defer(record, runtime, work, 0)
      return
    }
    const carried = runtime.carriedToolCalls
    runtime.carriedToolCalls = 0
    this.clearDeferred(runtime, record)
    await this.evaluate(record, runtime, epoch, carried)
  }

  /** Preserve turn tool work when an async evaluation step becomes stale, so the turn is not silently lost. */
  private preserveToolsOnStaleDrop(record: GoalRecord, runtime: Runtime, tools: number, phase: string): void {
    const sessionID = record.sessionID
    if (tools > 0) runtime.carriedToolCalls += tools
    const stillOurs = this.goals.get(sessionID) === record && record.status === "active"
    this.deps.log.warn("goal evaluation step dropped as stale", { sessionID, phase, tools, stillOurs, epoch: runtime.epoch })
    if (!stillOurs || this.disposed) return
    // The record is still active but this attempt's epoch is stale (superseded by another event).
    // Preserve carried work and schedule a recovery pass so the turn is not permanently skipped.
    runtime.iterationDeferred = true
    this.ensureDeferredState(record, runtime)
    const delay = RETRY_BASE_MS
    this.schedule(runtime, delay, () => {
      void this.retryDeferredBackgroundCheck(record, runtime).catch((error) => {
        this.deps.log.error("stale-drop recovery failed", { sessionID, error: errorMessage(error) })
      })
    })
  }


  /** If a loop-advance step was superseded but the same active iteration still needs advancing, retry it so progress is not lost. */
  private recoverLoopAdvanceIfActive(
    record: GoalRecord,
    runtime: Runtime,
    iteration: number,
    result: EvaluationResult,
    turn: number,
    phase: string,
  ): void {
    const sessionID = record.sessionID
    const stillActive = !this.disposed && this.goals.get(sessionID) === record && record.status === "active"
    this.deps.log.warn("goal evaluation step dropped as stale", {
      sessionID,
      phase,
      iteration,
      runtimeEpoch: runtime.epoch,
      active: stillActive,
      willRecover: stillActive && record.loopIteration === iteration,
    })
    if (!stillActive) return
    // Iteration already advanced/finished by another path: nothing to recover for this step.
    if ((record.loopIteration ?? 1) !== iteration) return
    this.schedule(runtime, RETRY_BASE_MS, () => {
      if (this.disposed) return
      if (this.goals.get(sessionID) !== record || record.status !== "active") return
      if ((record.loopIteration ?? 1) !== iteration) return
      void this.loopAdvance(record, runtime, ++runtime.epoch, result, turn).catch((error) => {
        this.deps.log.error("loop advance recovery failed", { sessionID, iteration, error: errorMessage(error) })
      })
    })
  }
  private logStaleDrop(record: GoalRecord, runtime: Runtime, epoch: number, phase: string): void {
    this.deps.log.warn("goal evaluation step dropped as stale", {
      sessionID: record.sessionID,
      phase,
      epoch,
      runtimeEpoch: runtime.epoch,
      active: this.goals.get(record.sessionID) === record && record.status === "active",
    })
  }

  onExecutionFailed(sessionID: string, error: FailureInfo | undefined) {
    this.running.delete(sessionID)
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") return
    const runtime = this.runtime(sessionID)
    runtime.heartbeating = false
    this.invalidate(runtime)
    this.clearDeferred(runtime, record)
    runtime.toolCalls = 0
    runtime.dropStragglerSucceeded = true
    // Queued flips only when continueWith dispatches the retry steer, not during backoff while no continuation is in flight.
    this.handleFailure(record, runtime, classifyFailure(error))
  }

  onExecutionInterrupted(sessionID: string, reason: InterruptReason) {
    this.running.delete(sessionID)
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") return
    const runtime = this.runtime(sessionID)
    runtime.heartbeating = false
    // A host 'shutdown' interrupt is the graceful-cancel twin of dispose(): keep the resume breadcrumb.
    this.invalidate(runtime, reason === "shutdown")
    this.clearDeferred(runtime, record)
    if (reason === "user") return this.pause(record, "Interrupted.", "user")
    if (reason === "inactivity") {
      runtime.dropStragglerSucceeded = true
      // Recovery is scheduled; queued flips only when continueWith dispatches the retry steer.
      return this.handleFailure(record, runtime, { kind: "transient", label: "inactivity timeout" })
    }
    // shutdown: the goal persists and is restored with no continuation dispatched; superseded: a newer execution owns the turn.
    if (reason !== "superseded") runtime.dropStragglerSucceeded = true
  }

  onSessionDeleted(sessionID: string) {
    this.running.delete(sessionID)
    const runtime = this.runtimes.get(sessionID)
    if (runtime) this.invalidate(runtime)
    this.runtimes.delete(sessionID)
    // Finished goals are not kept in memory after a restart, so always drop the stored record.
    void this.deps.store.remove(sessionID)
    this.lastCommit.delete(sessionID)
    this.lastReanchorAt.delete(sessionID)
    this.pendingAnchors.delete(sessionID)
    // A deleted session's location must not outlive it (a reused ID would otherwise inherit a stale directory).
    this.directories.delete(sessionID)
    this.commitPolicies.delete(sessionID)
    this.directorySeq.delete(sessionID)
    this.explicitMoves.delete(sessionID)
    if (this.goals.delete(sessionID)) this.deps.emitter.changed(sessionID, null)
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Adopts one live record from storage into memory, resetting turn count and spend baseline. The record's
   * `startedAt` is kept: it is the goal's original arm stamp and the TUI pill's time-tracking anchor, so
   * an elapsed timer must survive a restore unchanged.
   * Returns true when the record was adopted. Used by the bulk restore only.
   */
  private async adoptRestored(record: GoalRecord): Promise<boolean> {
    if (this.goals.has(record.sessionID)) return true
    let usage: UsageSnapshot | undefined
    let notFound = false
    try {
      usage = await this.deps.session.usage(record.sessionID)
    } catch (error) {
      if (isNotFoundError(error)) notFound = true
      else this.deps.log.warn("restore kept goal after transient usage failure", { sessionID: record.sessionID, error: errorMessage(error) })
    }
    if (notFound) {
      // Definitive not-found only: the session no longer exists, drop the stale goal.
      void this.deps.store.remove(record.sessionID)
      return false
    }
    // Transient failure or unavailable usage (undefined) is not proof the session is gone: keep the goal
    // with its previous baseline rather than deleting it.
    // A legacy record missing `history` would throw on the first `record.history.push(...)` in
    // evaluate() — after the bookkeeping mutations but before the commit, so the goal wedged
    // silently, forever. Normalize on adoption instead.
    if (!Array.isArray(record.history)) record.history = []
    // A live goal that has already been evaluated owns its turn counter. Resetting it to 0 on every
    // restore made each post-continuation reload look like turn 1 again, which re-tripped the turn-1
    // zero-tool downgrade forever ("no evidence of work ... zero tool calls this turn") even when the
    // judge had seen real evidence. Preserve the counter whenever an active goal has verdict history;
    // only a genuinely fresh goal (no verdicts yet) keeps the Claude-Code-parity reset.
    const evaluated = Array.isArray(record.history) && record.history.length > 0
    const resuming = record.status === "active" && (record.pendingEvaluation !== undefined || evaluated)
    Object.assign(record, {
      ...(resuming ? {} : { turns: 0, stall: 0, retries: 0, checkins: 0 }),
      baseline: usage ?? record.baseline ?? EMPTY_USAGE,
    })
    this.goals.set(record.sessionID, record)
    // Create the runtime up front so tool events that arrive before the first execution-end are counted.
    const runtime = this.runtime(record.sessionID)
    // Revive the persisted deferral so a restart/plugin reload mid-wait paints `waiting` again (and the
    // drain path, check-in math and `waitedMs` all see the original start) instead of forgetting the wait.
    if (record.waitingSince !== undefined) {
      runtime.deferredSince = record.waitingSince
      // The mirror already paints `waiting`; seed the dedupe cache so the first post-reload heartbeat pushes
      // the flip to `active` as an immediate `changed` event instead of waiting for a mirror tick.
      runtime.waitingPaint = true
    }
    // Adoption normalizes in memory only; no commit here. Writing the stored record on a read/adopt path is
    // what zeroed turns/baseline for other processes sharing the storage; the next real commit persists the
    // normalized state (the record's JSON differs from the no-op cache marker anyway, since adopt mutates
    // the record before returning).
    return true
  }

  /**
   * Restores live goals after a restart, resetting turn count and spend baseline (Claude Code parity). The
   * goal's original `startedAt` is kept so the elapsed timer tracks from first arm across restores.
   * Adopt-only by design: a restore never asks the host to compact. Compaction is strictly per session — it is
   * requested for the specific session whose context crosses `compactAtTokens` (threshold path) or whose
   * `/goal-loop` arm boundary asks for one (arm-time path). A plugin (re)load must not compact every live
   * goal session at once, and a restore cannot know which session needs a fresh context next.
   */
  async restore(options: { readonly resume?: boolean } = {}): Promise<number> {
    // Restore-time hygiene: prune terminal records past the explicit age/count cap before adopting live ones.
    // Covers every directory at plugin storage (per-directory caps), not just this controller's own — a restart
    // anywhere cleans up after every project. Best-effort — a prune failure must never block a restore. The
    // report is a log line with counts only; the dropped records are gone by design and are never implied retained.
    const prune = await this.deps.store.pruneAllDirectories(this.deps.clock.now()).catch((error) => {
      this.deps.log.warn("terminal goal record prune failed", { error: errorMessage(error) })
      return undefined
    })
    if (prune && prune.scanned > 0)
      this.deps.log.info("terminal goal records at plugin storage", {
        scanned: prune.scanned,
        pruned: prune.pruned,
        kept: prune.scanned - prune.pruned,
        droppedAged: prune.droppedAged,
        droppedBeyondCap: prune.droppedBeyondCap,
        unstampedKept: prune.unstampedKept,
        ...(prune.readOnly ? { readOnly: true } : {}),
        directories: prune.directories,
      })
    const records = await this.liveRecordsVisibleHere()
    await Promise.all(records.map((record) => this.adoptRestored(record)))
    if (this.goals.size) this.deps.log.info("restored goals", { count: this.goals.size })
    // Probe servers adopt live records read-only; they must never start real evaluations from a marker.
    if (options.resume !== false) this.resumePendingEvaluations()
    return this.goals.size
  }

  /**
   * Re-dispatch the exactly one post-turn step a restored marker owes. The marker is deleted before any
   * dispatch so a second restore (or a concurrent adopt) cannot double-fire; every guard is read-only and
   * fails closed to "clear and do nothing" when a newer execution or a changed goal owns the turn now.
   */
  private resumePendingEvaluations(): void {
    for (const record of this.goals.values()) {
      const pending = record.pendingEvaluation
      if (!pending) continue
      delete record.pendingEvaluation // single-dispatch guard
      const sessionID = record.sessionID
      const stale =
        record.status !== "active" ||
        this.running.has(sessionID) ||
        record.condition !== pending.condition ||
        (pending.phase === "evaluate" && record.turns >= pending.turn)
      if (stale) {
        void this.commit(record)
        continue
      }
      void this.commit(record)
      const runtime = this.runtime(sessionID)
      if (runtime.evaluating) continue
      this.deps.log.info("resuming interrupted goal step after restart", { sessionID, phase: pending.phase, turn: pending.turn })
      this.notify(sessionID, "resumed", "info", "Goal resumed after restart", pending.phase === "evaluate" ? "Re-checking the interrupted turn from fresh evidence." : "Re-sending the continuation for the judged turn.")
      if (pending.phase === "continue") {
        const turn = record.turns + 1
        void this.continueWith(record, {
          text: Prompt.continuation({ condition: record.condition, turn, reason: record.reason ?? "evaluation was interrupted by a restart", learnings: this.recentLearningsForPrompt(record) }, this.commitForSession(sessionID)),
          description: `goal · turn ${turn} · ${truncate(record.reason || "resumed after restart", 90)}`,
          turn,
        }).catch((error) => this.deps.log.error("resumed continuation failed", { sessionID, error: errorMessage(error) }))
      } else {
        const epoch = ++runtime.epoch
        void this.evaluate(record, runtime, epoch, pending.tools).catch((error) => this.deps.log.error("resumed evaluation failed", { sessionID, error: errorMessage(error) }))
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    // Keep each pending marker: it is the only breadcrumb a restart has for an interrupted evaluation.
    for (const runtime of this.runtimes.values()) this.invalidate(runtime, true)
    // Let final-usage snapshots land first; their commits enqueue store writes that flush() must see.
    await Promise.allSettled([...this.pendingUsage, ...this.pendingPrunes])
    await this.deps.store.flush()
  }

  // ---------------------------------------------------------------- turn evaluation

  private async evaluate(record: GoalRecord, runtime: Runtime, epoch: number, tools: number): Promise<void> {
    const { clock, session } = this.deps
    // A check-in armed while the turn was deferred on background work must not survive into evaluation: when it
    // fires mid-judge it sends a "still waiting" steer that wakes the parent before the verdict lands (and before
    // the loop planner that follows it has armed the next iteration). Disarm it on every evaluation path — turn
    // end, busy-check fallback, background drain, restore — so no stale wake timer outlives the deferral.
    this.disarmEvaluationTimer(runtime)
    const sessionID = record.sessionID
    // No verdict may settle a goal while its background work is still in flight. The turn-end gate can be
    // bypassed (busy-check retries exhaust, events land late, a restore resumes a pending evaluation), so
    // re-check at the acceptance boundary: a `met` waits here until every subagent/shell has drained.
    const work = await this.deps.background.busy(sessionID).catch((error): BackgroundWork | undefined => {
      this.deps.log.warn("goal busy check failed; will retry", { sessionID, error: errorMessage(error) })
      return undefined
    })
    if (this.stale(record, runtime, epoch)) {
      this.preserveToolsOnStaleDrop(record, runtime, tools, "before evaluation busy check")
      return
    }
    if (!work) {
      runtime.carriedToolCalls += tools
      runtime.iterationDeferred = true
      this.ensureDeferredState(record, runtime)
      this.scheduleBusyRetry(record, runtime)
      return
    }
    if (work.subagents + work.shells > 0) return this.defer(record, runtime, work, tools)
    // Earliest in-repo guard. An incomplete request (empty condition, sessions still active) must not even
    // write the pending marker, let alone settle a turn: this runs before the marker below. Fresh evidence
    // is judged authoritatively later, in nativeVerdict, from the finished turn's digest — not available here.
    const earlyAbstention = evaluationAbstention({ condition: record.condition, activeSessions: false })
    if (earlyAbstention) {
      this.deps.log.info("goal evaluation deferred", { sessionID, abstention: earlyAbstention, reason: ABSTENTION_REASON[earlyAbstention] })
      this.emit(record)
      return
    }
    const turn = record.turns + 1
    const stall = tools > 0 ? 0 : record.stall + 1
    // Persist the owed step BEFORE any await or generation: a shutdown mid-evaluation aborts the in-memory
    // controller and leaves no runtime state to resume. This additive marker survives store.flush() on dispose.
    record.pendingEvaluation = { turn, tools, condition: record.condition, phase: "evaluate", at: clock.now() }
    void this.commit(record)
    const [usage, contextSize] = await Promise.all([
      session.usage(sessionID).catch(() => undefined),
      this.contextSize(sessionID),
    ])
    // Per-turn spend: the delta against the previous reading (the arm-time reading seeds the first turn). Runtime-local — after a restore there is no previous reading, so the verdict carries no spend rather than a cumulative-since-set number.
    const turnSpend = usage && runtime.turnUsage ? diffUsage(usage, runtime.turnUsage) : undefined
    if (usage) runtime.turnUsage = usage
    if (this.stale(record, runtime, epoch)) {
      delete record.pendingEvaluation
      void this.commit(record)
      this.logStaleDrop(record, runtime, epoch, "before evaluation")
      return
    }
    const spendSinceBaseline = usage ? diffUsage(usage, record.baseline) : undefined
    runtime.figures = {
      ...(spendSinceBaseline !== undefined ? { spend: spendSinceBaseline } : {}),
      ...(contextSize !== undefined ? { contextSize } : {}),
    }
    const abort = new AbortController()
    runtime.abort = abort
    runtime.evaluating = true
    this.emit(record)
    let result
    try {
      result = await this.deps.evaluator.evaluate({
        sessionID,
        condition: record.condition,
        turn,
        elapsedMs: clock.now() - record.startedAt,
        ...(spendSinceBaseline !== undefined ? { spend: spendSinceBaseline } : {}),
        commit: this.commitForSession(sessionID),
        signal: abort.signal,
      })
    } catch (error) {
      if (abort.signal.aborted || this.stale(record, runtime, epoch)) {
        if (!abort.signal.aborted) {
          // Superseded by a newer execution: that turn's own evaluate() will stamp a fresh marker.
          delete record.pendingEvaluation
          void this.commit(record)
          this.logStaleDrop(record, runtime, epoch, "evaluator failed but stale")
        }
        // Aborted (shutdown / interrupt): keep the marker. dispose() flushes it and restore() resumes it.
        return
      }
      runtime.evaluating = false
      return this.evaluationFailed(record, runtime, tools, error)
    } finally {
      if (runtime.abort === abort) {
        runtime.abort = undefined
        runtime.evaluating = false
      }
    }
    if (this.stale(record, runtime, epoch)) {
      this.logStaleDrop(record, runtime, epoch, "after evaluation verdict")
      return
    }

    // The gate abstained: no judge child was spawned and no verdict text exists. Drop the marker written before
    // the evaluator call so the goal's durable state is byte-for-byte unchanged, and wait for the next
    // finished-turn boundary where condition + fresh evidence are present. No turn, history, verdict, terminal
    // state or continuation steer is mutated on this path.
    if (result.abstain) {
      delete record.pendingEvaluation
      void this.commit(record)
      this.deps.log.info("goal evaluation deferred", { sessionID, abstention: result.abstain, reason: ABSTENTION_REASON[result.abstain] })
      this.emit(record)
      // The judge was withheld because workers are still running. Arm the same deferral the busy gate uses, so
      // their drain re-runs THIS turn's evaluation; otherwise the turn is dropped and the goal waits for a new
      // parent prompt that may never arrive. Other abstentions have no work to drain and keep the old behavior.
      if (result.abstain === "active-sessions") {
        const work = await this.deps.background.busy(sessionID).catch(() => undefined)
        if (this.stale(record, runtime, epoch)) return
        if (!work) {
          runtime.carriedToolCalls += tools
          this.ensureDeferredState(record, runtime)
          this.scheduleBusyRetry(record, runtime)
        } else if (work.subagents + work.shells > 0) {
          this.defer(record, runtime, work, tools)
        } else {
          // They drained between the gate and this check: judge the same turn now instead of waiting.
          await this.evaluate(record, runtime, ++runtime.epoch, tools)
        }
      }
      return
    }

    const gated = await this.gateCandidateVerdict(record, runtime, epoch, tools, turn, result)
    if (!gated) return
    result = gated.result
    const verificationMatrix = gated.matrix

    record.turns = turn
    record.stall = stall
    record.retries = 0
    record.verdict = result.verdict
    record.reason = result.reason || undefined
    // iterationToolCalls is maintained eagerly in onToolCalled; this evaluation only reads it (loop arming).
    // The why ledger stamps the same HEAD sha the loop rail stamps at advance — the verdict lands on a commit the reader can inspect. Guarded like headAtAdvance: outside a repository or when HEAD cannot be read, the sha is absent, never guessed.
    const shaAtEvaluation = currentHead(this.directoryFor(sessionID))
    // Legacy single-check evidence remains for compatibility; matrix evidence records every required check.
    const verifyEvidence = verificationMatrix && record.lastVerify
      ? { command: record.lastVerify.command, code: record.lastVerify.code, ...(record.lastVerify.timedOut ? { timedOut: true } : {}), ...(record.lastVerify.tail ? { tail: record.lastVerify.tail } : {}) }
      : undefined
    const verdictEntry = { turn, verdict: result.verdict, reason: result.reason, at: clock.now(), toolCalls: tools, ...(turnSpend ? { spend: turnSpend } : {}), ...(shaAtEvaluation ? { sha: shaAtEvaluation } : {}), ...(verifyEvidence ? { verify: verifyEvidence } : {}), ...(verificationMatrix ? { verification: verificationMatrix } : {}) }
    record.history.push(verdictEntry)
    // Verdict-trail retention cap: the persisted record (and the changed-snapshot clone of it) stays bounded no matter how many turns a long session evaluates. The drop delta accumulates onto `historyDropped` so displays can say "N most recent of M evaluated turns" instead of silently showing a 20-turn window.
    const historyBound = boundVerdictHistory(record.history)
    if (historyBound.dropped > 0) {
      record.history = historyBound.retained
      record.historyDropped = (record.historyDropped ?? 0) + historyBound.dropped
      this.deps.log.info("verdict trail retention cap: dropped oldest evaluated-turn records", { sessionID, dropped: historyBound.dropped, retained: historyBound.retained.length, totalDropped: record.historyDropped })
    }
    this.writeLearningTurnVerdict(record, verdictEntry)

    await this.dispatchPostVerdict(record, runtime, epoch, tools, turn, stall, result, verdictEntry)
  }

  /** Clear a check-in timer left armed by a deferral before the verdict can land. */
  private disarmEvaluationTimer(runtime: Runtime): void {
    const { clock } = this.deps
    if (runtime.timer !== undefined) {
      clock.clearTimeout(runtime.timer)
      runtime.timer = undefined
    }
  }

  /** Apply the zero-tool downgrade and the verification gate to a candidate verdict. */
  private async gateCandidateVerdict(
    record: GoalRecord,
    runtime: Runtime,
    epoch: number,
    tools: number,
    turn: number,
    result: EvaluationResult,
  ): Promise<{ result: EvaluationResult; matrix?: VerdictVerificationMatrix } | undefined> {
    // A met verdict on a turn with zero tool calls, where the condition names production of a thing, is not a
    // verdict — it is state inspection. Downgrade to not_met; the next turn re-attempts with tools in hand.
    // Scoped to the first evaluated turn: on later turns prior evidence may already satisfy the condition and
    // the evaluator judges from the full visible conversation, so a 0-tool-call reporting turn is legitimate.
    // An already-satisfied landing that names a concrete `next:` gap is the sanctioned forward-pointer path
    // (core/verdict.ts · applyForwardPointerGate), not state inspection posing as work — exempt it from the
    // zero-tool downgrade so it can proceed to the verifier matrix and loop advance. A bare already-satisfied
    // claim without a pointer is still rejected upstream by the forward-pointer gate.
    // The guard is for a fresh goal's very first evaluation: this runs before the verdict is pushed, so
    // an empty history means no prior verdicts. A restored/evaluated goal keeps its counter now, but the
    // history check is a second line of defence against any other path that renumbers a live goal to turn 1.
    if (result.verdict === "met" && tools === 0 && turn === 1 && record.history.length === 0 && PRODUCING_CONDITION.test(record.condition) && !isAlreadySatisfiedLanding(result.reason)) {
      result = {
        verdict: "not_met" as const,
        reason: "no evidence of work toward the condition, only state inspection (zero tool calls this turn; the condition names production of a thing).",
      }
    }

    // Verifier, not transcriber: a candidate met verdict is accepted only when the applicable
    // verification matrix (legacy verifyCommand or configured checks/profile) passes with fresh,
    // scoped command evidence. Missing/unscoped required verification for broad goals downgrades to not_met.
    let verificationMatrix: VerdictVerificationMatrix | undefined
    if (result.verdict === "met") {
      const verified = await this.verifyMet(record, runtime, result)
      result = verified.result
      verificationMatrix = verified.matrix
      if (this.stale(record, runtime, epoch)) return undefined
    }
    return { result, matrix: verificationMatrix }
  }

  /** Settle the durable verdict and dispatch its terminal, guard or continuation step. */
  private async dispatchPostVerdict(
    record: GoalRecord,
    runtime: Runtime,
    epoch: number,
    tools: number,
    turn: number,
    stall: number,
    result: EvaluationResult,
    verdictEntry: VerdictEntry,
  ): Promise<void> {
    const { config, clock } = this.deps
    const sessionID = record.sessionID
    if (result.verdict === "met") {
      if (record.loopEnabled) return this.loopAdvance(record, runtime, epoch, result, turn)
      void this.settleTerminal(record, "achieved", {
        kind: "achieved",
        level: "success",
        title: `Goal achieved in ${turn} turn${turn === 1 ? "" : "s"}`,
        reason: result.reason,
      })
      this.deps.log.info("goal achieved", { sessionID, turn, elapsedMs: clock.now() - record.startedAt })
      // Terminal: a met verdict on a plain goal ends the run. Returning here is load-bearing — without it control
      // falls through to the continuation dispatch at the bottom of evaluate(), which would re-arm an achieved goal.
      return
    }
    if (result.verdict === "impossible") {
      void this.settleTerminal(record, "impossible", {
        kind: "impossible",
        level: "error",
        title: "Goal judged impossible",
        reason: result.reason,
      })
      this.deps.log.info("goal impossible", { sessionID, turn })
      // Terminal: same fall-through hazard as the met branch above — an impossible goal must not be re-armed.
      return
    }
    if (config.maxTurns > 0 && turn >= config.maxTurns && !record.loopEnabled) {
      return this.pause(record, `Reached the ${config.maxTurns}-turn safety limit.`, "cap")
    }
    if (config.maxTurns > 0 && turn >= config.maxTurns && record.loopEnabled && !runtime.capNotified) {
      // Armed loops never pause at the turn cap: one notice, then the loop keeps running.
      runtime.capNotified = true
      this.notify(sessionID, "loop", "warning", "Turn cap passed — loop keeps running", `Reached the ${config.maxTurns}-turn safety limit; an armed /goal-loop does not pause. Run /goal clear to stop it.`)
    }
    if (stall >= config.stallTurns && config.stallTurns > 0 && !record.loopEnabled) {
      return this.pause(record, `No progress: ${stall} turns in a row without tool use.`, "stall")
    }
    if (stall >= config.stallTurns && config.stallTurns > 0 && record.loopEnabled && !runtime.stallNotified) {
      // Armed loops never pause at the stall guard: one notice, then the loop keeps running.
      runtime.stallNotified = true
      this.notify(sessionID, "loop", "warning", "No progress — loop keeps running", `${stall} turns in a row without tool use; an armed /goal-loop does not pause. Run /goal clear to stop it.`)
    }
    if (result.verdict === "not_met" && record.status === "active") {
      const detected = recognizeNoProgress({
        info: { ...verdictEntry, verdict: "not_met" as const },
        history: record.history.slice(0, -1),
        tools,
        retries: record.retries,
        stall,
        loopNotProgress: record.loopNotProgress ?? 0,
      })
      if (detected) {
        const escalation = failureEscalationReason(detected)
        const diagnostic = persistFailureDiagnosticArtifact({
          // Same anchoring rule as the learning journal: repo root for a subfolder, directory itself outside a repo.
          directory: resolveProjectRoot(this.directoryFor(sessionID)),
          detected,
          escalationReason: escalation,
          info: { ...verdictEntry, verdict: "not_met" as const },
          turn,
          sessionID,
          goalID: record.id,
          condition: record.condition,
        })
        const rotation = strategyForRepeat(detected)
        this.deps.log.warn("repeated failure signature escalated", { sessionID, turn, count: detected.count, kind: detected.kind, signature: detected.signature, strategy: rotation.strategy, ...(diagnostic ? { diagnostic } : {}) })
        // A recurring failure means the last approach did not close the gap. Keep the goal active and steer the
        // worker onto a different strategy instead of pausing — the same proactive path for loops and plain goals,
        // every signature kind, and every repetition. The diagnostic artifact stays as the durable evidence trail.
        if (detected.count === FAILURE_SIGNATURE_REPEAT_THRESHOLD) {
          this.notify(sessionID, "loop", "warning", "Repeated failure — rotating strategy", `${detected.summary} The goal keeps running with a different approach; see the diagnostic artifact for the evidence.`)
        }
        record.pendingEvaluation = { turn, tools, condition: record.condition, phase: "continue", at: clock.now() }
        this.commit(record)
        // A user turn already started: it gets evaluated when it ends, so don't stack a continuation on it.
        if (this.running.has(sessionID)) return
        if (record.status !== "active") return
        await this.continueWith(record, {
          text: Prompt.strategyEscalation({
            condition: record.condition,
            turn: turn + 1,
            reason: result.reason,
            count: detected.count,
            kind: detected.kind,
            summary: detected.summary,
            strategy: rotation.strategy,
            signals: detected.signals,
            ...(diagnostic ? { diagnostic } : {}),
            learnings: this.recentLearningsForPrompt(record),
          }, this.commitForSession(sessionID)),
          description: `goal · turn ${turn + 1} · rotate strategy · ${truncate(detected.summary, 70)}`,
          turn: turn + 1,
        })
        return
      }
    }
    // The verdict is durable; the post-turn steer is still owed. Flip the resume marker to "continue" in
    // the same commit so a restart between here and the synthetic dispatch re-sends the steer, not a
    // second evaluation. Terminal/paused/loop paths above clear the marker through invalidate()/the guard.
    record.pendingEvaluation = { turn, tools, condition: record.condition, phase: "continue", at: clock.now() }
    this.commit(record)
    // A user turn already started: it gets evaluated when it ends, so don't stack a continuation on it.
    if (this.running.has(sessionID)) return
    if (record.status !== "active") return
    await this.continueWith(record, {
      text: Prompt.continuation({ condition: record.condition, turn: turn + 1, reason: result.reason, learnings: this.recentLearningsForPrompt(record) }, this.commitForSession(sessionID)),
      description: `goal \u00B7 turn ${turn + 1} \u00B7 ${truncate(result.reason || "not met yet", 90)}`,
      turn: turn + 1,
    })
  }


  /**
   * Runs the applicable verification matrix for a candidate met verdict and returns the (possibly downgraded) verdict
   * plus matrix evidence. Legacy `verifyCommand` is represented as a synthesized matrix check. Missing verifier or
   * required checks/evidence for the active profile (including broad-goal scoping) fail closed to not_met.
   */
  private async verifyMet(
    record: GoalRecord,
    runtime: Runtime,
    result: EvaluationResult,
  ): Promise<{ result: EvaluationResult; matrix?: VerdictVerificationMatrix }> {
    const { config, log } = this.deps
    const sessionID = record.sessionID

    const { checks: resolvedChecks, malformed } = resolveVerifyChecks({
      configured: config.evaluator.verifyChecks ?? [],
      condition: record.condition,
    })
    if (resolvedChecks.length === 0) {
      // malformed goal-declared directives alone do not create a matrix, but record/report if present? no checks to gate.
      return { result }
    }

    const head = currentHead(this.directoryFor(sessionID))
    const turn = record.turns
    if (!runtime.verifyCache || runtime.verifyCache.turn !== turn || runtime.verifyCache.head !== head) {
      runtime.verifyCache = { head, turn, results: new Map() }
    }
    const cache = runtime.verifyCache.results

    // One scope policy per gate: the coverage precheck below shares this object instead of recomputing it.
    const policyOpts = { condition: record.condition, profile: config.evaluator.verifyProfile || "default", checks: resolvedChecks }
    const policy = computeScopePolicy(policyOpts)
    const broadGoal = policy.broadGoal
    const profile = policy.profile
    const legacySingle = resolvedChecks.length === 1 && resolvedChecks[0]?.id === "verify-command" && resolvedChecks[0]?.source === "legacy"

    // Fresh transcript/artifact corpus for evidence-mode checks (best-effort, scoped to current evaluation context).
    let transcriptText = ""
    const needsTranscript = resolvedChecks.some((c) => c.evidence === "artifact" || c.evidence === "either")
    if (needsTranscript && this.deps.context) {
      try {
        const messages = await this.deps.context(sessionID)
        transcriptText = renderTranscript(messages as readonly any[], { maxChars: Math.max(20_000, config.evaluator.maxTranscriptChars) })
      } catch (error) {
        log.warn("goal verification transcript read failed; artifact evidence unavailable", { sessionID, error: errorMessage(error) })
        transcriptText = ""
      }
    }

    const applicable = resolvedChecks.map((def) => {
      const requiredNow = def.required && (def.when === "broad" ? broadGoal : true)
      const inScope = def.when === "broad" ? broadGoal : true
      return { def, requiredNow, inScope }
    })
    const requiredNow = applicable.filter((x) => x.requiredNow)

    const fail = (reason: string, matrix: VerdictVerificationMatrix): { result: EvaluationResult; matrix: VerdictVerificationMatrix } => {
      log.warn("goal verification gate downgraded met verdict", { sessionID, reason, profile, broadGoal })
      this.notify(sessionID, "retry", "warning", legacySingle ? "Verification failed" : "Verification matrix did not pass", truncate(reason, 180))
      record.lastVerification = { ...matrix, at: this.deps.clock.now() }
      return { result: { verdict: "not_met", reason }, matrix }
    }

    // Deterministic coverage precheck (independent of evaluator rubric): broad goals require scoped typed coverage.
    const coverage = evaluateCoveragePolicy(policyOpts, policy)
    if (!coverage.ok) {
      const evidence: VerifyCheckEvidence[] = requiredNow.map((x) => ({
        id: x.def.id,
        type: x.def.type,
        ...(x.def.label ? { label: x.def.label } : {}),
        command: x.def.command,
        source: x.def.source,
        evidenceMode: x.def.evidence,
        runState: "skipped" as const,
        executionMode: "skipped" as const,
        required: true,
        scoped: false,
        scopeDecision: "unscoped by deterministic coverage policy",
        pass: false,
        code: null,
        skipped: true,
        durationMs: 0,
        ...(x.def.artifactPatterns.length ? { artifactPatterns: [...x.def.artifactPatterns] } : {}),
        reason: coverage.reasons.join("; ") || "missing/unscoped required coverage",
        nextAction: `Configure scoped required verification checks/profile (typecheck, targeted tests, lint/build as applicable, goal-declared) so each required type has fresh scoped evidence.`,
      }))
      // if no required checks, still report malformed/policy issue
      const checksEvidence = evidence.length ? evidence : applicable.map((x) => ({
        id: x.def.id,
        type: x.def.type,
        ...(x.def.label ? { label: x.def.label } : {}),
        command: x.def.command,
        source: x.def.source,
        evidenceMode: x.def.evidence,
        runState: "skipped" as const,
        executionMode: "skipped" as const,
        required: x.requiredNow,
        scoped: false,
        scopeDecision: "coverage policy not satisfied",
        pass: false,
        code: null,
        skipped: true,
        durationMs: 0,
        ...(x.def.artifactPatterns.length ? { artifactPatterns: [...x.def.artifactPatterns] } : {}),
        reason: coverage.reasons.join("; "),
      }))
      const missingIds = checksEvidence.filter((e) => e.required).map((e) => e.id)
      const matrix: VerdictVerificationMatrix = {
        profile,
        broadGoal,
        pass: false,
        checks: checksEvidence,
        missing: missingIds,
        coverageReasons: coverage.reasons,
        timing: { totalMs: 0, concurrency: config.evaluator.verifyConcurrency, parallel: false, reused: 0, executed: 0, skipped: checksEvidence.length },
        ...(malformed.length ? { malformedGoalChecks: malformed.map((m) => ({ raw: m.raw, reason: m.reason })) } : {}),
      }
      const primary = checksEvidence.find((e) => e.required) ?? checksEvidence[0]
      if (primary) record.lastVerify = { command: primary.command, code: primary.code, at: this.deps.clock.now() }
      const next = [
        "  1. [high/risk] Satisfy deterministic required verification coverage for this goal/profile — evidence gap/finding: " + (coverage.reasons.join("; ") || "required scoped coverage missing") + " — required proof: fresh scoped executed command or allowed artifact evidence for each required check type (typecheck, targeted tests, lint/build as applicable, goal-declared).",
      ]
      if (malformed.length) next.push("  2. [medium] Fix malformed goal-declared verify directives (ignored, never executed): " + malformed.map((m) => `${m.raw} (${m.reason})`).join("; ") + " — required proof: valid `verify: type=... cmd=\"...\" ...` directives.")
      return fail(`Verification matrix coverage not satisfied for ${broadGoal ? "broad" : "scoped"} goal (profile ${profile}): ${coverage.reasons.join("; ") || "missing/unscoped required coverage"}.\nnext:\n${next.join("\n")}`, matrix)
    }

    if (requiredNow.length === 0) {
      // nothing required now; still record applicability/malformed for observability
      const checksEvidence: VerifyCheckEvidence[] = applicable.map((x) => ({
        id: x.def.id,
        type: x.def.type,
        ...(x.def.label ? { label: x.def.label } : {}),
        command: x.def.command,
        source: x.def.source,
        evidenceMode: x.def.evidence,
        runState: "skipped" as const,
        executionMode: "skipped" as const,
        required: false,
        scoped: x.inScope,
        scopeDecision: x.inScope ? "not required (applicable)" : "not applicable for this scope",
        pass: true,
        code: null,
        skipped: true,
        durationMs: 0,
        ...(x.def.artifactPatterns.length ? { artifactPatterns: [...x.def.artifactPatterns] } : {}),
        reason: x.inScope ? "not required" : "not applicable",
      }))
      const matrix: VerdictVerificationMatrix = {
        profile, broadGoal, pass: true, checks: checksEvidence, missing: [], coverageReasons: [],
        timing: { totalMs: 0, concurrency: config.evaluator.verifyConcurrency, parallel: false, reused: 0, executed: 0, skipped: checksEvidence.length },
        ...(malformed.length ? { malformedGoalChecks: malformed.map((m) => ({ raw: m.raw, reason: m.reason })) } : {}),
      }
      return { result, matrix }
    }

    const startedAt = this.deps.clock.now()
    const verifier = this.deps.verifier
    const evidenceByIndex = new Array<VerifyCheckEvidence | undefined>(applicable.length)
    let reusedCount = 0
    let executedCount = 0
    let skippedCount = 0

    runtime.evaluating = true
    this.emit(record)
    try {
      // First pass: resolve non-required and artifact/either satisfaction without command execution where possible.
      const commandTasks: Array<{ idx: number; item: (typeof applicable)[number]; key: string }> = []
      const pendingByKey = new Map<string, Promise<VerifyCheckEvidence>>()
      const pendingWaiters: Array<{ idx: number; item: (typeof applicable)[number]; key: string }> = []
      for (let idx = 0; idx < applicable.length; idx++) {
        const item = applicable[idx]!
        const base = {
          id: item.def.id,
          type: item.def.type,
          ...(item.def.label ? { label: item.def.label } : {}),
          command: item.def.command,
          source: item.def.source,
          evidenceMode: item.def.evidence,
          required: item.requiredNow,
          scoped: item.inScope,
          ...(item.def.artifactPatterns.length ? { artifactPatterns: [...item.def.artifactPatterns] } : {}),
        }

        if (!item.requiredNow) {
          evidenceByIndex[idx] = {
            ...base,
            runState: "skipped",
            executionMode: "skipped",
            scopeDecision: item.inScope ? "not required for this scope" : "not applicable (when/profile)",
            pass: true,
            code: null,
            skipped: true,
            durationMs: 0,
            reason: item.inScope ? "not required" : "not applicable",
          }
          skippedCount++
          continue
        }

        // Artifact satisfaction (fresh scoped transcript/artifact evidence) when allowed.
        if (item.def.evidence === "artifact" || item.def.evidence === "either") {
          const t0 = this.deps.clock.now()
          const art = artifactEvidenceSatisfied(transcriptText, item.def.artifactPatterns)
          const artOk = art.ok
          if (artOk) {
            evidenceByIndex[idx] = {
              ...base,
              runState: "artifact",
              executionMode: "artifact",
              scopeDecision: "satisfied by fresh scoped transcript/artifact evidence",
              pass: true,
              code: null,
              durationMs: Math.max(0, this.deps.clock.now() - t0),
              parallel: false,
              artifactMatched: art.matched,
              artifactMissing: art.missing,
              tail: truncate(art.matched.join(" || "), 400),
              reason: "fresh scoped transcript/artifact evidence matched required patterns",
            }
            executedCount++
            continue
          }
          if (item.def.evidence === "artifact") {
            evidenceByIndex[idx] = {
              ...base,
              runState: "artifact",
              executionMode: "artifact",
              scopeDecision: item.inScope ? "artifact evidence required but not satisfied/scoped" : "not applicable",
              pass: false,
              code: null,
              durationMs: Math.max(0, this.deps.clock.now() - t0),
              parallel: false,
              artifactMatched: art.matched,
              artifactMissing: art.missing,
              reason: art.missing.length ? `missing required artifact patterns in fresh scoped transcript evidence: ${art.missing.join(", ")}` : "artifact evidence not satisfied",
              nextAction: `Provide fresh scoped transcript/artifact evidence containing required patterns (${item.def.artifactPatterns.join(" || ")}) for check ${item.def.id}.`,
            }
            executedCount++
            continue
          }
          // evidence=either: fall through to command execution if verifier available
        }

        // Command execution path (required command checks default; either-mode fallback)
        const key = checkReuseKey(item.def) + "|head:" + (head ?? "none")
        const cached = cache.get(key)
        if (cached) {
          const reused: VerifyCheckEvidence = {
            ...cached,
            id: item.def.id,
            type: item.def.type,
            ...(item.def.label ? { label: item.def.label } : {}),
            command: item.def.command,
            source: item.def.source,
            evidenceMode: item.def.evidence,
            required: item.requiredNow,
            ...(item.def.artifactPatterns.length ? { artifactPatterns: [...item.def.artifactPatterns] } : {}),
            runState: "reused",
            executionMode: cached.executionMode === "artifact" ? "reused-artifact" : "reused-command",
            reused: true,
            reusedFrom: `${cached.id}@turn${runtime.verifyCache!.turn}`,
            durationMs: 0,
            parallel: false,
          }
          evidenceByIndex[idx] = reused
          reusedCount++
          continue
        }
        if (pendingByKey.has(key)) {
          pendingWaiters.push({ idx, item, key })
          continue
        }

        if (!verifier) {
          const noVerifier: VerifyCheckEvidence = {
            ...base,
            runState: "skipped",
            executionMode: "skipped",
            scopeDecision: "no verifier available (fail closed)",
            pass: false,
            code: null,
            skipped: true,
            durationMs: 0,
            reason: "no verifier port is wired for this plugin instance (fail closed)",
            nextAction: `Run ${JSON.stringify(item.def.command)} and provide fresh scoped exit-0 evidence for check ${item.def.id} (verifier unavailable).`,
          }
          evidenceByIndex[idx] = noVerifier
          skippedCount++
          continue
        }

        // mark as pending now so identical checks later in this matrix reuse the in-flight result
        pendingByKey.set(key, Promise.resolve(undefined as unknown as VerifyCheckEvidence))
        commandTasks.push({ idx, item, key })
      }

      // Execute command checks concurrently with a cap; coalesce identical keys within this run.
      const cap = Math.max(1, Math.min(8, Math.floor(config.evaluator.verifyConcurrency || 2)))
      let cursor = 0
      const runOne = async (slot: number) => {
        while (cursor < commandTasks.length) {
          const my = cursor++
          const task = commandTasks[my]!
          const item = task.item
          const def = item.def
          const key = task.key
          const timeoutMs = def.timeoutMs ?? config.evaluator.verifyTimeoutMs
          const started = this.deps.clock.now()
          const verification = new AbortController()
          runtime.abort = verification
          let resolvePending!: (v: VerifyCheckEvidence) => void
          const pending = new Promise<VerifyCheckEvidence>((r) => { resolvePending = r })
          pendingByKey.set(key, pending)
          let ev: VerifyCheckEvidence
          try {
            const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), verification.signal])
            const run = await verifier!.verify({ command: def.command, cwd: this.directoryFor(sessionID), timeoutMs, signal })
            const cleaned = run.output ? stripControls(run.output).trim() : ""
            const tail = cleaned ? cleaned.split("\n").slice(-12).join("\n").slice(-1200) : undefined
            const pass = run.code === 0 && !run.timedOut
            ev = {
              id: def.id,
              type: def.type,
              ...(def.label ? { label: def.label } : {}),
              command: def.command,
              source: def.source,
              evidenceMode: def.evidence,
              runState: "executed",
              executionMode: "command",
              required: true,
              scoped: item.inScope,
              scopeDecision: pass && item.inScope ? "fresh executed command evidence scoped to current checkout/HEAD" : item.inScope ? "executed but not satisfied" : "unscoped for this goal/profile",
              pass: pass && item.inScope,
              code: run.code ?? null,
              ...(run.timedOut ? { timedOut: true } : {}),
              ...(tail ? { tail } : {}),
              durationMs: Math.max(0, this.deps.clock.now() - started),
              parallel: cap > 1 && commandTasks.length > 1,
              concurrency: slot,
              ...(def.artifactPatterns.length ? { artifactPatterns: [...def.artifactPatterns] } : {}),
              ...(pass && item.inScope ? {} : {
                reason: !item.inScope
                  ? "unscoped for this goal/profile"
                  : run.timedOut
                    ? `timed out after ${formatDuration(timeoutMs)}`
                    : `exit ${run.code ?? "unknown"}`,
                nextAction: `Satisfy required verification check ${def.id} (${def.type}) with a fresh scoped command: run ${JSON.stringify(def.command)} at current HEAD and fix failures until exit 0.`,
              }),
            }
          } catch (error) {
            if (verification.signal.aborted) throw error
            ev = {
              id: def.id,
              type: def.type,
              ...(def.label ? { label: def.label } : {}),
              command: def.command,
              source: def.source,
              evidenceMode: def.evidence,
              runState: "executed",
              executionMode: "command",
              required: true,
              scoped: item.inScope,
              scopeDecision: "command execution failed (fail closed)",
              pass: false,
              code: null,
              durationMs: Math.max(0, this.deps.clock.now() - started),
              parallel: cap > 1 && commandTasks.length > 1,
              concurrency: slot,
              ...(def.artifactPatterns.length ? { artifactPatterns: [...def.artifactPatterns] } : {}),
              reason: `verification failed to run: ${errorMessage(error)}`,
              nextAction: `Run ${JSON.stringify(def.command)} successfully at current HEAD and provide fresh scoped exit-0 evidence for check ${def.id}.`,
            }
          } finally {
            if (runtime.abort === verification) runtime.abort = undefined
          }
          cache.set(key, ev)
          evidenceByIndex[task.idx] = ev
          resolvePending!(ev)
          executedCount++
        }
      }
      if (commandTasks.length > 0) {
        const workers = Array.from({ length: Math.min(cap, commandTasks.length) }, (_, slot) => runOne(slot + 1))
        await Promise.all(workers)
      }
      if (pendingWaiters.length > 0) {
        for (const waiter of pendingWaiters) {
          const baseEv = await (pendingByKey.get(waiter.key) ?? Promise.resolve(cache.get(waiter.key)!))
          const reused: VerifyCheckEvidence = {
            ...baseEv,
            id: waiter.item.def.id,
            type: waiter.item.def.type,
            ...(waiter.item.def.label ? { label: waiter.item.def.label } : {}),
            command: waiter.item.def.command,
            source: waiter.item.def.source,
            evidenceMode: waiter.item.def.evidence,
            required: waiter.item.requiredNow,
            ...(waiter.item.def.artifactPatterns.length ? { artifactPatterns: [...waiter.item.def.artifactPatterns] } : {}),
            runState: "reused",
            executionMode: baseEv.executionMode === "artifact" ? "reused-artifact" : "reused-command",
            reused: true,
            reusedFrom: `${baseEv.id}@turn${runtime.verifyCache!.turn}`,
            durationMs: 0,
            parallel: false,
          }
          evidenceByIndex[waiter.idx] = reused
          reusedCount++
        }
      }
    } finally {
      runtime.evaluating = false
    }

    const evidence = evidenceByIndex.map((e, i) => e ?? ({
      id: applicable[i]!.def.id,
      type: applicable[i]!.def.type,
      command: applicable[i]!.def.command,
      source: applicable[i]!.def.source,
      evidenceMode: applicable[i]!.def.evidence,
      runState: "skipped" as const,
      executionMode: "skipped" as const,
      required: applicable[i]!.requiredNow,
      scoped: false,
      scopeDecision: "missing evaluation result",
      pass: false,
      code: null,
      skipped: true,
      durationMs: 0,
      reason: "internal: no evidence produced",
      nextAction: `Re-run required verification for check ${applicable[i]!.def.id}.`,
    }))

    // recompute counts from evidence for accuracy
    reusedCount = evidence.filter((e) => e.reused).length
    executedCount = evidence.filter((e) => e.runState === "executed" || e.runState === "artifact").length
    skippedCount = evidence.filter((e) => e.runState === "skipped").length

    const missing = evidence.filter((e) => e.required && (!e.pass || !e.scoped)).map((e) => e.id)
    const totalMs = Math.max(0, this.deps.clock.now() - startedAt)
    const timing = {
      totalMs,
      concurrency: Math.max(1, Math.min(8, Math.floor(config.evaluator.verifyConcurrency || 2))),
      parallel: evidence.some((e) => e.parallel),
      reused: reusedCount,
      executed: executedCount,
      skipped: skippedCount,
    }
    const matrix: VerdictVerificationMatrix = {
      profile,
      broadGoal,
      pass: missing.length === 0,
      checks: evidence,
      missing,
      coverageReasons: coverage.reasons,
      timing,
      ...(malformed.length ? { malformedGoalChecks: malformed.map((m) => ({ raw: m.raw, reason: m.reason })) } : {}),
    }

    const primary = evidence.find((e) => e.required) ?? evidence[0]
    if (primary) {
      record.lastVerify = {
        command: primary.command,
        code: primary.code,
        ...(primary.timedOut ? { timedOut: true } : {}),
        ...(primary.tail ? { tail: primary.tail } : {}),
        at: this.deps.clock.now(),
      }
    }
    record.lastVerification = { ...matrix, at: this.deps.clock.now() }
    if (missing.length === 0) return { result, matrix }

    const problems = evidence.filter((e) => e.required && (!e.pass || !e.scoped))
    const lines = problems.map((e, i) => {
      const detail = e.reason ?? (e.pass ? "scoping insufficient" : "not satisfied")
      const mode = e.executionMode ?? e.runState
      const src = e.source ?? "configured"
      const timingInfo = e.durationMs !== undefined ? `, ${e.durationMs}ms` : ""
      const reuseInfo = e.reused ? " reused" : e.parallel ? " parallel" : ""
      const out = e.tail ? `; output/evidence: ${truncate(e.tail, 160)}` : ""
      const action = e.nextAction ?? `Provide fresh scoped ${e.evidenceMode === "artifact" ? "transcript/artifact" : "command"} evidence for check ${e.id}.`
      return `  ${i + 1}. [high/risk] ${e.id} (${e.type}, source=${src}, mode=${mode}${reuseInfo}${timingInfo}) — evidence gap/finding: ${detail}${e.scoped ? "" : ", unscoped"}; scope: ${e.scopeDecision ?? "n/a"}; command ${JSON.stringify(e.command)}${out} — required proof: ${e.evidenceMode === "artifact" ? "fresh scoped transcript/artifact evidence matching required patterns" : "fresh executed command with exit 0 and scoped output at current HEAD"}; next action: ${action}`
    })
    if (malformed.length) {
      lines.push(`  ${lines.length + 1}. [medium] malformed goal-declared verify directives ignored (never executed): ${malformed.map((m) => `${m.raw} (${m.reason})`).join("; ")} — next action: fix directive syntax so checks can be merged deterministically.`)
    }
    const reason = `Verification matrix did not pass for ${broadGoal ? "broad" : "scoped"} goal (profile ${profile}); missing/unscoped/failed required checks: ${missing.join(", ")}. Deterministic coverage enforced (rubric-independent).\nnext:\n${lines.join("\n")}`
    return fail(reason, matrix)
  }

  /**
   * Loop step, run only on a `met` verdict for a looped goal. Summarizes the achieved iteration into a compact
   * machine-consumable block, then asks the evaluator for the next condition (or LOOP_COMPLETE). Arms the next
   * iteration under the same /goal rules, or ends the loop cleanly. Never runs on not_met/impossible/pause/retry.
   *
   * Loop bookkeeping is on the record: `loopHistory` carries completed iterations, `loopNotProgress` counts
   * consecutive iterations with zero tool calls (recorded, never a pause). Every await is epoch-guarded; a superseded
   * loop step drops its result without saving.
   */
  private async loopAdvance(
    record: GoalRecord,
    runtime: Runtime,
    epoch: number,
    result: EvaluationResult,
    turn: number,
  ): Promise<void> {
    const { config, clock, log } = this.deps
    const sessionID = record.sessionID
    // Cumulative usage at the advance (met verdict). The delta against armUsage is this iteration's
    // spend; one extra usage() call per advance, same posture as the context estimate. Best-effort.
    const advanceUsage = await this.deps.session.usage(sessionID).catch(() => undefined)
    const iteration = record.loopIteration ?? 1
    const maxLoops = record.loopMaxLoops ?? config.maxLoops
    const objective = record.loopObjective ?? record.condition
    // A resumed loop can re-enter advance for the same iteration; never record it twice.
    const history: LoopEntry[] = (record.loopHistory ?? []).filter((e) => e.version !== iteration)
    const now = clock.now()
    const iterationTools = runtime.iterationToolCalls
    const notProgress = iterationTools === 0 && !runtime.iterationDeferred ? (record.loopNotProgress ?? 0) + 1 : 0
    // Stamp the arm-time context estimate (measured when this iteration was armed, tagged with its number by the boundary-compaction settle/restore writes) onto the entry. Only a matching iteration tag with a finite estimate qualifies; anything else stays absent — the row renders the gap honestly.
    const armedEstimate =
      record.loopCompact && record.loopCompact.iteration === iteration && typeof record.loopCompact.estimatedTokens === "number" && Number.isFinite(record.loopCompact.estimatedTokens)
        ? record.loopCompact.estimatedTokens
        : undefined
    // Stamp the commit HEAD had landed on when this iteration was recorded. Read once per advance; outside a repository (or on any read failure) the field stays absent — the ledger never fabricates a sha.
    const headAtAdvance = record.directory ? currentHead(record.directory) : undefined
    // Spend attribution: the diff between the arm-time cumulative and the advance-time cumulative is
    // this iteration's cost. Absent when the arm never saw a stamp (restored runtime) or the advance
    // could not measure — never estimated, never fabricated. Clamped at zero per field (diffUsage).
    const armDelta = advanceUsage && runtime.armUsage ? diffUsage(advanceUsage, runtime.armUsage) : undefined
    const makeEntry = (summary: string): LoopEntry => ({
      version: iteration,
      condition: record.condition,
      summary,
      reason: result.reason,
      turns: turn,
      toolCalls: iterationTools,
      endedAt: clock.now(),
      ...(armDelta !== undefined ? { spend: armDelta } : {}),
      ...(armedEstimate !== undefined ? { contextTokens: armedEstimate } : {}),
      ...(headAtAdvance !== undefined ? { sha: headAtAdvance } : {}),
    })
    // Loop bookkeeping lives only in locals until every await is behind us; a superseded loop step drops without saving.
    // The armed/terminal record is built in one shot and persisted with a single commit so a restart mid-loop
    // restores either the pre-step or the fully-advanced state, never a half-advanced one.
    const logIteration = (entry: LoopEntry | undefined) => {
      if (!entry || entry.version !== iteration) return
      this.writeLearningLoopIteration(record, entry)
    }
    const assignLoopState = () => {
      // Retention cap: persisted records and (via structuredClone) outbound snapshots stay bounded no matter how many
      // iterations a long-running loop lands. The local `history` keeps everything — messages and the maxLoops guard read it —
      // only the record's copy is trimmed, newest first. The drop count rides the record so displays/ledgers can stay honest.
      const bound = boundLoopHistory(history)
      record.loopHistory = bound.retained
      if (bound.dropped > 0) {
        record.loopHistoryDropped = (record.loopHistoryDropped ?? 0) + bound.dropped
        log.info("loop history retention cap: dropped oldest iteration records", { sessionID, dropped: bound.dropped, retained: bound.retained.length, totalDropped: record.loopHistoryDropped })
      }
      record.loopNotProgress = notProgress
      // Completed-condition ledger: the anti-repeat and near-duplicate gates below must catch a planner
      // re-offering a condition that completed before the retained 50-entry iteration window. record.condition
      // is the just-achieved condition at both call sites (endClean and the normal advance, before re-arming).
      const ledgerBound = boundCompletedConditions([...(record.completedConditions ?? []), record.condition])
      record.completedConditions = ledgerBound.retained
      if (ledgerBound.dropped > 0) {
        record.completedConditionsDropped = (record.completedConditionsDropped ?? 0) + ledgerBound.dropped
        log.info("completed-condition ledger cap: dropped oldest entries", { sessionID, dropped: ledgerBound.dropped, retained: ledgerBound.retained.length, totalDropped: record.completedConditionsDropped })
      }
      let landed: LoopEntry | undefined
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i]?.version === iteration) {
          landed = history[i]
          break
        }
      }
      logIteration(landed)
    }

    const endClean = async (reason: string) => {
      assignLoopState()
      await this.settleTerminal(record, "achieved", { kind: "achieved", level: "success", title: "Loop complete", reason, iterations: history.length })
      return void this.deps.log.info("loop complete", { sessionID, iterations: history.length, reason })
    }

    if (!this.deps.evaluator.summarize && !this.deps.evaluator.nextGoal) {
      log.error("loop step unavailable", { sessionID })
      history.push(makeEntry("(loop advance unavailable: this evaluator cannot summarize or plan)"))
      return endClean("Loop complete: this evaluator cannot summarize or plan the next iteration.")
    }

    let summary: string
    if (this.deps.evaluator.summarize) {
      const summarize = new AbortController()
      runtime.abort = summarize
      try {
        const summarized = await this.deps.evaluator.summarize({
          sessionID,
          objective,
          condition: record.condition,
          reason: result.reason,
          turn,
          elapsedMs: now - record.startedAt,
          toolCalls: iterationTools,
          history,
          maxSummaryTokens: config.maxLoopSummaryTokens,
          signal: summarize.signal,
        })
        // The planner reasons over this summary verbatim. A raw character slice can end mid-word
        // (and split a surrogate pair) with no marker — the armed kickoff then carries a cut the
        // planner reads as the whole story. Cap at the same budget, elide at a word boundary, and
        // mark the cut with the same ellipsis the truncate helpers use.
        summary = elideAtWordBoundary(summarized, Math.max(200, config.maxLoopSummaryTokens) * 4)
      } catch (error) {
        if (runtime.abort === summarize) runtime.abort = undefined
        if (this.stale(record, runtime, epoch)) {
          this.recoverLoopAdvanceIfActive(record, runtime, iteration, result, turn, "loop summary aborted/stale")
          return
        }
        log.error("loop summary failed", { sessionID, error: errorMessage(error) })
        summary = `(summary failed: ${truncate(errorMessage(error), 80)})`
      } finally {
        if (runtime.abort === summarize) runtime.abort = undefined
      }
    } else {
      // A planner without a summarizer still works: carry a placeholder instead of pausing.
      log.warn("loop summary unavailable: this evaluator cannot summarize", { sessionID })
      summary = "(summary unavailable: this evaluator cannot summarize)"
    }
    if (this.stale(record, runtime, epoch)) {
      this.recoverLoopAdvanceIfActive(record, runtime, iteration, result, turn, "after loop summary")
      return
    }

    const entry = makeEntry(summary.trim())
    history.push(entry)
    log.info("loop iteration met", { sessionID, iteration, toolCalls: iterationTools, history: history.length })

    // The cap counts total achieved iterations — retained history plus the entries the retention cap
    // dropped plus this one — not the saturated retained slice: `history` alone tops out at
    // MAX_LOOP_HISTORY_ENTRIES + 1, so `history.length >= maxLoops` is unreachable for maxLoops > 51.
    const completedCount = completedIterationCount(record) + history.length - (record.loopHistory?.length ?? 0)
    if (completedCount >= maxLoops) {
      return endClean(`Loop complete: reached the ${maxLoops}-iteration cap after ${completedCount} achieved iteration${completedCount === 1 ? "" : "s"}.`)
    }

    if (!this.deps.evaluator.nextGoal) {
      log.error("loop next-goal generation unavailable", { sessionID })
      return endClean("Loop complete: this evaluator cannot plan the next iteration.")
    }
    const generate = new AbortController()
    runtime.abort = generate
    const backlogSuggestion = selectBacklogSuggestion(this.directoryFor(sessionID), record, history)
    if (backlogSuggestion) {
      log.info("loop planner backlog suggestion", {
        sessionID,
        id: backlogSuggestion.id,
        title: truncate(backlogSuggestion.title, 80),
        priority: backlogSuggestion.priority,
      })
    }
    let reply: string
    // Read the learning journal once: the same string feeds the presence check and the payload, and the
    // read is a synchronous file read (two reads was pure waste on the advance hot path).
    const recentLearnings = this.recentLearningsForPrompt(record)
    try {
      reply = await this.deps.evaluator.nextGoal({
        sessionID,
        objective,
        history,
        latestSummary: entry.summary,
        signal: generate.signal,
        ...(backlogSuggestion ? { backlogSuggestion } : {}),
        ...(recentLearnings ? { recentLearnings } : {}),
      })
    } catch (error) {
      if (runtime.abort === generate) runtime.abort = undefined
      if (this.stale(record, runtime, epoch)) {
        this.recoverLoopAdvanceIfActive(record, runtime, iteration, result, turn, "loop next-goal aborted/stale")
        return
      }
      log.error("loop next-goal generation failed", { sessionID, error: errorMessage(error) })
      // The summary and history stay local until the arm lands, so a retry recomputes them identically;
      // record.loopNotProgress is untouched here on purpose. The turn verdict and its spend are NOT local:
      // persist them now, or storage and other clients stay blind until the arm lands (forever, on a crash).
      await this.commit(record)
      const attempt = runtime.loopRetries ?? 0
      const delay = backoffMs(RETRY_BASE_MS, 4, attempt)
      runtime.loopRetries = attempt + 1
      this.notify(
        sessionID,
        "retry",
        "warning",
        "Loop still active",
        `Could not plan the next iteration (${truncate(errorMessage(error), 160)}); retrying in ${formatDuration(delay)}.`,
      )
      this.schedule(runtime, delay, () => {
        if (this.goals.get(record.sessionID) !== record || record.status !== "active") return
        void this.loopAdvance(record, runtime, ++runtime.epoch, result, turn).catch((e) => log.error("loop retry failed", { error: errorMessage(e) }))
      })
      return
    } finally {
      if (runtime.abort === generate) runtime.abort = undefined
    }
    if (this.stale(record, runtime, epoch)) {
      this.recoverLoopAdvanceIfActive(record, runtime, iteration, result, turn, "after next-goal generation")
      return
    }
    // A met verdict advances the loop exactly once: if this iteration was already armed while we awaited
    // (duplicate delivery), drop the step instead of re-arming the same objective.
    if (record.loopIteration !== iteration) {
      log.warn("loop arm dropped: iteration already advanced", { sessionID, iteration, armed: record.loopIteration })
      return
    }

    if (Prompt.isLoopComplete(reply)) {
      return endClean(`Loop complete after ${history.length} iteration${history.length === 1 ? "" : "s"}: the evaluator found nothing worth improving.`)
    }
    const condition = Prompt.parseNextCondition(reply, Math.max(1, Math.floor(this.deps.config.maxConditionChars)))
    if (!condition) {
      return endClean("Loop complete: the next-goal generator returned nothing usable.")
    }
    // A planner that re-offers an already-completed condition — an exact (case/punctuation-insensitive) repeat,
    // or a near-duplicate (token containment >= 0.7 / Jaccard >= 0.6) — would spin the loop on the same work;
    // end instead. The scan reuses completedLedgerHit, the one gate the initial /goal-loop arm runs (XLV).
    // The ledger is the record's current condition, its loop objective, the retained iteration window and the
    // completed-condition ledger; the last outlives the window, so a condition dropped by the cap is gone by
    // design (counted on the record) and only what is still held is scanned here.
    const completedLedger = new Set<string>([
      record.condition,
      ...(record.loopObjective ? [record.loopObjective] : []),
      ...history.map((entry) => entry.condition),
      ...(record.completedConditions ?? []),
    ])
    const repeat = completedLedgerHit(condition, completedLedger)
    if (repeat !== undefined) {
      // Exact-repeat vs near-duplicate differ only in the refusal wording; both speak the grep-target
      // vocabulary (/^no new gap/, "already-completed") the arming-side refusal documents.
      const exact = normalizeCondition(repeat) === normalizeCondition(condition)
      log.warn(exact ? "loop next-goal generator repeated a completed condition" : "loop next-goal generator offered a near-duplicate of an already-completed condition", { sessionID, iteration })
      return endClean(exact
        ? `no new gap: the planner keeps offering the already-completed condition "${truncate(condition, 80)}"; ending instead of arming.`
        : `no new gap: the planner keeps offering a near-duplicate of an already-completed condition ("${truncate(condition, 80)}"); ending instead of arming.`)
    }

    const nextIteration = iteration + 1
    runtime.loopRetries = 0
    assignLoopState()
    record.condition = condition
    record.loopIteration = nextIteration
    record.turns = 0
    record.stall = 0
    record.retries = 0
    record.checkins = 0
    // Absence, not explicit undefined: the host rejects explicit-undefined keys in any RPC payload.
    delete record.verdict
    delete record.reason
    // `startedAt` is deliberately NOT advanced: it is the goal's original arm stamp. The pill's elapsed
    // timer tracks start-to-end across every loop iteration; only the iteration counter advances.
    this.clearDeferred(runtime, record)
    runtime.iterationToolCalls = 0
    runtime.iterationDeferred = false
    runtime.armUsage = advanceUsage
    // Single durable write: the achieved history and the armed iteration land together or not at all.
    // a restart from here restores either the pre-arm or the armed state, never a half-advanced one.
    await this.commit(record)
    const recoverPostArmContinuation = () => {
      // Post-commit arm tail: a stale/supersession race (epoch bumped, but this record is still the active
      // one and was already durably advanced to nextIteration) must not drop the kickoff for the armed
      // iteration. Dispatch continuation idempotently: skip if a turn is running or a steer is already
      // queued/dispatched, never re-run the prior-iteration advance.
      if (this.goals.get(sessionID) !== record || record.status !== "active" || record.loopIteration !== nextIteration) return false
      if (this.running.has(sessionID) || runtime.awaitingExecution) {
        this.deps.log.info("loop arm continuation already pending after post-commit stale race", { sessionID, iteration: nextIteration, running: this.running.has(sessionID), awaitingExecution: runtime.awaitingExecution })
        return true
      }
      this.deps.log.info("recovering loop arm continuation after post-commit stale race", { sessionID, iteration: nextIteration })
      void this.continueWith(record, {
        text: Prompt.loopContinuation({ iteration: nextIteration, maxLoops, condition, previousSummary: entry.summary, reason: result.reason, learnings: this.recentLearningsForPrompt(record) }, this.commitForSession(sessionID)),
        description: `goal-loop · arming v${nextIteration}`,
        turn: 1,
      }).catch((error) => this.deps.log.error("loop arm continuation recovery failed", { sessionID, error: errorMessage(error) }))
      return true
    }
    const staleAfterArmCommit = (phase?: string) => {
      if (!this.stale(record, runtime, epoch)) return false
      if (!recoverPostArmContinuation()) {
        if (phase) this.logStaleDrop(record, runtime, epoch, phase)
      }
      return true
    }
    if (staleAfterArmCommit("after loop arm commit")) return
    this.notify(sessionID, "loop", "info", `Loop ${iteration} of ${maxLoops} achieved`, `→ v${nextIteration}: ${truncate(condition, 160)}`)
    // A stale step (the record was superseded by a clear/replace during the commit await) must not
    // reach the compaction request or the arming steer.
    if (staleAfterArmCommit("before loop compaction/steer")) return
    // Queue a boundary compaction BEFORE the armed iteration's synthetic steer, so the next version arms
    // with a fresh context. Awaiting only waits for the host's acceptance of the request. Any request made at
    // an earlier arm is settled first, here, before any other bookkeeping: a landed compaction is recorded as
    // such (success notice, misses reset, fresh requests re-enabled); an unmeasurable context never counts as
    // a miss nor a landing (one forced re-request at the first unmeasurable tick, then staleness-unknown with
    // a trickle of at most one forced re-request per 2 arms — never a full suspension); a measurable no-drop
    // counts a miss — the host-unwilling warning fires once at 2 misses, re-requests drop to a trickle every
    // 3rd arm, and COMPACT_MISS_CAP stays as a backstop final warning rather than the only signal.
    // An unlanded pending request is NOT re-issued on every arm, and a fresh request is not made on the arm
    // that just observed the landing: every arm stacking a request is what piled up "Nothing to compact yet"
    // dividers and their re-anchor notes. The loop keeps running throughout.
    if (this.deps.compactAtBoundary) {
      const pending = record.loopCompact && !record.loopCompact.landedAt ? record.loopCompact : undefined
      let force = false
      let misses = 0
      let staleness = pending?.stalenessUnknown === true
      let skipRequest: "landed" | "pending" | undefined
      if (pending) {
        const size = this.deps.estimateContext ? await this.deps.estimateContext(sessionID).catch(() => undefined) : undefined
        if (staleAfterArmCommit()) return
        if (this.contextDropped(pending, size)) {
          this.landPending(record, pending, size)
          skipRequest = "landed"
          await this.commit(record)
          this.notify(sessionID, "compact", "success", "Compaction landed", `Context dropped to ~${size} tokens at the loop boundary.`)
        } else if (size === undefined) {
          // Unmeasurable is not a miss and never a landing. Track the streak; the first tick forces one
          // re-request past cooldown, repeated ticks mark the pending request staleness-unknown — never a
          // full suspension while the armed iteration is below maxLoops.
          const unmeasurableTicks = (pending.unmeasurableTicks ?? 0) + 1
          if (unmeasurableTicks === 1) {
            record.loopCompact = { ...pending, unmeasurableTicks }
            force = true
            log.info("loop boundary compact: context unestimable; one forced re-request past cooldown", { sessionID })
          } else {
            if (!staleness) {
              staleness = true
              this.notify(sessionID, "compact", "warning", "Compaction landing unknown", "The context size is unavailable, so the boundary compaction cannot be confirmed landed or missed; the loop keeps running with at most one forced re-request per 2 arms.")
            }
            record.loopCompact = { ...pending, unmeasurableTicks, stalenessUnknown: true }
            // At most one forced re-request per 2 arms under unknown staleness; never the hard cap.
            force = unmeasurableTicks % 2 === 0
            log.info("loop boundary compact: staleness unknown; re-requesting on the 2-arm trickle", { sessionID, unmeasurableTicks, force })
          }
          await this.commit(record)
        } else {
          misses = pending.misses + 1
          const unwillingWarned = pending.unwillingWarned === true || misses >= COMPACT_MISS_RETRY
          const measurableLoopState = { ...pending, misses, unwillingWarned }
          // A measurable arm CLEARS the unmeasurable/staleness streaks: absence, not explicit undefined keys.
          delete measurableLoopState.unmeasurableTicks
          delete measurableLoopState.stalenessUnknown
          record.loopCompact = measurableLoopState
          if (misses === COMPACT_MISS_RETRY && pending.unwillingWarned !== true) {
            // The host will not compact (2 measurable arms, no landing): say it once, exactly.
            this.notify(sessionID, "compact", "warning", "Compaction not landing", COMPACT_MISS_NOTICE)
          } else if (misses === COMPACT_MISS_CAP) {
            // Backstop only: one final warning at the cap crossing; re-requests continue as a trickle.
            this.notify(sessionID, "compact", "warning", "Compaction not landing", `The boundary compaction has not landed after ${COMPACT_MISS_CAP} armed iterations; re-requests drop to a trickle every 3rd arm. The loop keeps running.`)
          }
          // misses 1: silent count. misses 2: forced re-request (just warned). misses >= 3: trickle every 3rd arm.
          force = misses === COMPACT_MISS_RETRY || misses % 3 === 0
          log.info("loop boundary compact miss counted at arm", { sessionID, misses, force })
          await this.commit(record)
        }
        if (staleAfterArmCommit()) return
      }
      if (pending && !skipRequest && !force) skipRequest = "pending"
      if (skipRequest) {
        log.info("loop boundary compact skipped at this arm", { sessionID, reason: skipRequest })
      }
      const result: BoundaryCompactResult =
        skipRequest !== undefined
          ? { requested: false, reason: skipRequest === "landed" ? "too-small" : "cooldown" }
          : await this.deps
              .compactAtBoundary(sessionID, { ...(force ? { force: true } : {}), cold: true })
              .catch((error): BoundaryCompactResult => {
                log.warn("loop boundary compact failed", { sessionID, error: errorMessage(error) })
                return { requested: false, reason: "read-failed" }
              })
      if (staleAfterArmCommit()) return
      if (result.requested) {
        // Carry the miss count forward until a compaction actually lands: re-requesting is not evidence of landing.
        // Reads the post-settle record, not the pre-settle pending: spread it so misses, the once-per-pending
        // warning flag, and the unmeasurable/staleness state survive the rewrite. The stale estimate is dropped
        // when the fresh request carries none (it would anchor the drop heuristic to an old number).
        const settled = record.loopCompact && !record.loopCompact.landedAt ? record.loopCompact : undefined
        const { estimatedTokens: _staleEstimate, ...carried } = settled ?? {}
        record.loopCompact = {
          ...carried,
          requestedAt: clock.now(),
          ...(result.estimatedTokens !== undefined ? { estimatedTokens: result.estimatedTokens } : {}),
          iteration: nextIteration,
          misses,
        }
        await this.commit(record)
        if (staleAfterArmCommit()) return
      }
      // A denied request stays as-is: the settle step already counted this arm as a miss when a pending request exists,
      // and a busy deferral never forces an unsafe compact.
    }
    await this.continueWith(record, {
      text: Prompt.loopContinuation({ iteration: nextIteration, maxLoops, condition, previousSummary: entry.summary, reason: result.reason, learnings: this.recentLearningsForPrompt(record) }, this.commitForSession(sessionID)),
      description: `goal-loop · arming v${nextIteration}`,
      turn: 1,
    })
  }

  private evaluationFailed(record: GoalRecord, runtime: Runtime, tools: number, error: unknown) {
    const { log } = this.deps
    log.warn("goal evaluation failed", { sessionID: record.sessionID, error: errorMessage(error) })
    // An unreadable/foreign/failed native verdict is not a `not_met` to continue from — the worker cannot repair
    // the judge's output by taking another turn, and the old fail-closed path bounced wake→delegate→garbage forever.
    // Pause with the diagnostic; a user message resumes, and /goal clear or a fresh /goal starts over.
    if (error instanceof EvaluatorVerdictError) {
      void this.pause(record, error.message, "repeated_failure")
      return
    }
    const usageLimit = isUsageLimitError(error)
    record.retries++
    // A free-tier usage/rate limit is provider/account state, not a fault another retry from this session can
    // clear. The judge rides the session's own model/fingerprint, so it shares that session's free-usage bucket;
    // when the gateway answers 429 there is nothing this plugin can do but wait for the window to reset or for
    // the user to point the judge at a separate model. Retrying every 15m forever left the card stuck on
    // "Goal still active ... retrying in 15m" with no exit. Match the upstream plugin: PAUSE the goal and wait
    // for a user message to resume. A message re-arms evaluation; clearing or setting a separate judge model
    // are the other ways out.
    if (usageLimit) {
      const reason = `Free usage limit reached — the judge child hit the provider's quota. Set a separate evaluator.model or wait for the quota window to reset, then send a message to resume.`
      void this.pause(record, reason, "usage_limit")
      return
    }
    if (this.deps.config.maxRetries > 0 && record.retries >= this.deps.config.maxRetries) {
      const reason = `Goal failed after ${record.retries} consecutive evaluator failures (last: ${truncate(errorMessage(error), 120)}). Lower evaluator.timeoutMs, check provider connectivity, or raise maxRetries.`
      record.failureLabel = "evaluator retries exhausted"
      void this.settleTerminal(record, "failed", { kind: "failed", level: "error", title: "Goal failed", reason })
      return
    }
    const delay = backoffMs(REEVALUATE_BASE_MS, 3, record.retries - 1)
    this.commit(record)
    this.notify(record.sessionID, "retry", "warning", "Goal still active", `Evaluator failed (${truncate(errorMessage(error), 120)}); retrying in ${formatDuration(delay)}.`)
    this.schedule(runtime, delay, () => {
      if (this.goals.get(record.sessionID) !== record || record.status !== "active" || this.running.has(record.sessionID)) return
      void this.evaluate(record, runtime, ++runtime.epoch, tools).catch((e) => log.error("re-evaluation failed", { error: errorMessage(e) }))
    })
  }

  private handleFailure(record: GoalRecord, runtime: Runtime, failure: ReturnType<typeof classifyFailure>) {
    if (failure.kind === "fatal") {
      const reason = `Goal failed after an unrecoverable error: ${failure.label}. Run /goal again to continue.`
      record.failureLabel = failure.label
      void this.settleTerminal(record, "failed", { kind: "failed", level: "error", title: "Goal failed", reason })
      return
    }
    record.retries++
    if (failure.kind !== "pause" && this.deps.config.maxRetries > 0 && record.retries >= this.deps.config.maxRetries) {
      const reason = `Goal failed after ${record.retries} consecutive execution failures (last: ${failure.label}). Check provider status or raise maxRetries.`
      record.failureLabel = "execution retries exhausted"
      void this.settleTerminal(record, "failed", { kind: "failed", level: "error", title: "Goal failed", reason })
      return
    }
    // Rate/usage-limit windows clear on their own, so a fixed long backoff beats burning evaluations;
    // transient errors use capped exponential backoff. Both retry forever.
    const delay = failure.kind === "pause" ? PAUSE_RETRY_MS : backoffMs(RETRY_BASE_MS, 4, record.retries - 1)
    this.commit(record)
    this.notify(record.sessionID, "retry", "warning", "Goal still active", `Turn failed (${failure.label}); retrying in ${formatDuration(delay)}.`)
    this.schedule(runtime, delay, () => {
      if (this.goals.get(record.sessionID) !== record || record.status !== "active" || this.running.has(record.sessionID)) return
      void this.continueWith(record, {
        text: Prompt.retry({ condition: record.condition, label: failure.label, learnings: this.recentLearningsForPrompt(record) }, this.commitForSession(record.sessionID)),
        description: `goal \u00B7 retry ${record.retries}`,
        turn: record.turns + 1,
      }).catch((e) => this.deps.log.error("retry continuation failed", { error: errorMessage(e) }))
    })
  }

  /** Background work is running: skip this evaluation and arm an idle check-in (30m, then x2 up to x4). */
  private defer(record: GoalRecord, runtime: Runtime, work: BackgroundWork, tools: number) {
    const { clock } = this.deps
    runtime.carriedToolCalls += tools
    runtime.iterationDeferred = true
    const firstDefer = runtime.deferredSince === undefined
    runtime.deferredSince ??= clock.now()
    if (firstDefer) {
      // Persist the deferral on the record so a restart/plugin reload restores the `waiting` paint instead of
      // forgetting it mid-wait; commit also emits the snapshot the pill and mirror paint from.
      record.waitingSince = runtime.deferredSince
    }
    // The pill names what the parent is waiting on. Set the twin BEFORE commit/emit: both snapshot the record
    // synchronously, so assigning afterwards would persist and paint a count-less wait. A later deferral can
    // see a different worker count (one child finished, another started) — push that change too.
    const countChanged = record.waitingSubagents !== work.subagents
    if (countChanged) record.waitingSubagents = work.subagents
    if (firstDefer || countChanged) void this.commit(record)
    this.armCheckin(record, runtime, work)
  }

  /**
   * Arm the next idle check-in for a deferred turn. `defer()` uses it for the first check-in; `checkin()` re-arms
   * through it while a judge/planner is still in flight, so the check waits for completion instead of firing
   * prematurely on a long-running task. Falls back to `now` when the deferral has already been cleared.
   */
  private armCheckin(record: GoalRecord, runtime: Runtime, previous: BackgroundWork) {
    const { config, clock } = this.deps
    if (config.checkinMinutes === 0 || record.checkins >= config.maxIdleCheckins) return
    const interval = config.checkinMinutes * 60_000 * Math.min(2 ** record.checkins, 4)
    const due = (runtime.lastCheckinAt ?? runtime.deferredSince ?? clock.now()) + interval
    this.schedule(runtime, Math.max(0, due - clock.now()), () => void this.checkin(record, runtime, previous).catch((e) => this.deps.log.error("goal check-in failed", { error: errorMessage(e) })))
  }

  private async checkin(record: GoalRecord, runtime: Runtime, previous: BackgroundWork) {
    const { config, clock, background } = this.deps
    if (this.goals.get(record.sessionID) !== record || record.status !== "active" || this.running.has(record.sessionID)) return
    // A deferral's check-in must not wake the parent while the turn's judge/verifier (or the loop planner that
    // follows a met verdict) is still running: the verdict's own continuation is about to deliver the result.
    // No live deferral means the check is obsolete (evaluation already started) — drop it. Still deferred but
    // evaluating means a straggler timer caught the judge mid-flight — re-arm so it waits for completion.
    if (runtime.deferredSince === undefined && record.waitingSince === undefined) return
    if (runtime.evaluating) {
      this.armCheckin(record, runtime, previous)
      return
    }
    // An arm-time planner may have armed a check-in after showPlanning() cleared the previous one (a turn
    // event landing mid-plan). Even then the wake must wait for the planner: push the check out by a full
    // interval rather than consuming it, so the parent is never steered while its goal is being distilled.
    if (runtime.planning === true) {
      runtime.lastCheckinAt = clock.now()
      this.armCheckin(record, runtime, previous)
      return
    }
    const epoch = runtime.epoch
    const work = await background.busy(record.sessionID).catch(() => previous)
    if (this.stale(record, runtime, epoch)) return
    // A /goal planning window can open while the busy check is in flight. The top-of-function guard above saw
    // planning=false; re-check before dispatching so a check-in resolved after the window opened is pushed out
    // instead of steering the parent with the old (raw) goal while its replacement is being distilled.
    if (this.isPlanning(record.sessionID)) {
      runtime.lastCheckinAt = clock.now()
      this.armCheckin(record, runtime, previous)
      return
    }
    record.checkins++
    runtime.lastCheckinAt = clock.now()
    const waitedMs = clock.now() - (runtime.deferredSince ?? clock.now())
    const last = record.checkins >= config.maxIdleCheckins
    this.commit(record)
    this.notify(
      record.sessionID,
      "checkin",
      "info",
      "Goal check-in",
      `Background work has kept the goal waiting ${formatDuration(waitedMs)}.${last ? " Idle check-ins are paused until you send another prompt." : ""}`,
    )
    await this.continueWith(record, {
      text: Prompt.checkin({ condition: record.condition, waitedMs, ...work, learnings: this.recentLearningsForPrompt(record) }, this.commitForSession(record.sessionID)),
      description: `goal \u00B7 check-in ${record.checkins}`,
      turn: record.turns + 1,
    })
  }

  /**
   * Background work ended (an execution or a shell completed). The deferral that painted `waiting`
   * clears as soon as no background work remains for the session: re-runs the deferred evaluation
   * now instead of at the next idle check-in — which may be 30+ minutes away, or never, when
   * check-ins are disabled. No-op for sessions that never deferred.
   */
  async onBackgroundDrained(): Promise<void> {
    for (const [sessionID, runtime] of this.runtimes) {
      if (this.disposed) return
      if (runtime.deferredSince === undefined) continue
      if (runtime.evaluating || this.running.has(sessionID)) continue
      const record = this.goals.get(sessionID)
      if (!record || record.status !== "active") continue
      const epoch = ++runtime.epoch
      const work = await this.deps.background.busy(sessionID).catch((error): BackgroundWork | undefined => {
        this.deps.log.warn("goal busy check failed; will retry", { sessionID, error: errorMessage(error) })
        return undefined
      })
      if (this.stale(record, runtime, epoch)) {
        this.logStaleDrop(record, runtime, epoch, "background drain busy check")
        continue
      }
      if (!work) {
        this.scheduleBusyRetry(record, runtime)
        continue
      }
      runtime.busyRetries = undefined
      if (work.subagents + work.shells > 0) continue
      const carried = runtime.carriedToolCalls
      runtime.carriedToolCalls = 0
      this.clearDeferred(runtime, record)
      try {
        await this.evaluate(record, runtime, epoch, carried)
      } catch (error) {
        this.deps.log.error("background drain evaluation failed", { error: errorMessage(error) })
      }
    }
  }

  // ---------------------------------------------------------------- transitions

  private async continueWith(record: GoalRecord, input: { text: string; description: string; turn: number }) {
    const runtime = this.runtime(record.sessionID)
    // No steer of any kind may land in the parent while the arm-time planner owns the window. A new /goal will
    // arm and deliver its own kickoff after planning ends; an older record's pending wake must not race it.
    if (runtime.planning === true) return
    // Every completion event after this dispatch belongs to the execution the steer starts; a succeeded delivered
    // before its started is a straggler from the previous turn. Marked before the dispatch (not after) so a user
    // turn started during the dispatch wins the flag via onExecutionStarted and its succeeded is evaluated.
    runtime.awaitingExecution = true
    runtime.dropStragglerSucceeded = false
    if (this.goals.get(record.sessionID) === record) this.emit(record)
    try {
      await this.deps.session.synthetic({
        sessionID: record.sessionID,
        text: input.text,
        description: input.description,
        metadata: { source: Prompt.MARKER, goal: record.id, turn: input.turn },
        delivery: "steer",
        // Explicit `resume: true` (Workstream LX): the kickoff must wake the session. The host contract
        // (session.synthetic) admits with `resume` omitted/true → `SessionExecution.wake` is scheduled;
        // `false` records the input with no wake. Omitting it left the arm's fate to the host default,
        // and the armed loop could park with the pill reading "active" — indistinguishable from stuck.
        resume: true,
      })
      // The owed steer is admitted; no restart recovery is needed for this turn any more.
      if (record.pendingEvaluation?.phase === "continue") {
        delete record.pendingEvaluation
        void this.commit(record)
      }
    } catch (error) {
      // A synthetic steer that fails to land must not stop the goal: drop the queued/dispatched flag and retry the dispatch.
      // onUserPrompt/clear/isDisposed all call invalidate(runtime), which clears runtime.timer, so a user prompt
      // cancels the pending retry.
      runtime.awaitingExecution = false
      if (this.goals.get(record.sessionID) === record) this.emit(record)
      if (this.goals.get(record.sessionID) === record && record.status === "active") {
        this.notify(record.sessionID, "retry", "warning", "Goal still active", `Could not continue (${truncate(errorMessage(error), 160)}); retrying in ${formatDuration(CONTINUE_RETRY_MS)}.`)
        this.schedule(runtime, CONTINUE_RETRY_MS, () => {
          if (this.goals.get(record.sessionID) !== record || record.status !== "active") return
          void this.continueWith(record, input).catch((e) => this.deps.log.error("continuation retry failed", { error: errorMessage(e) }))
        })
      }
    }
  }

  /**
   * One terminal settle for every terminal path: persist the status, then announce it with a single outcome
   * story. Plain met/impossible, loop completion, and fatal failure all route through here, so the
   * finish→story→notify sequence is written once instead of copied per branch. `reason` is stored on the
   * record and echoed in the notice body (falling back to the condition, exactly as the plain-goal paths did).
   * Callers keep any path-specific log line; the returned promise is the durable `finish` write, so loop
   * callers await it and plain-goal/terminal callers fire-and-forget, unchanged.
   */
  private settleTerminal(
    record: GoalRecord,
    status: Exclude<GoalStatus, "active" | "paused">,
    input: { kind: NoticeKind; level: NoticeLevel; title: string; reason?: string; iterations?: number },
  ): Promise<void> {
    const saved = this.finish(record, status, input.reason)
    const story = outcomeStory({
      turns: record.turns,
      elapsedMs: (record.endedAt ?? this.deps.clock.now()) - record.startedAt,
      ...(input.iterations !== undefined ? { iterations: input.iterations } : {}),
    })
    this.notify(record.sessionID, input.kind, input.level, input.title, `${story} · ${input.reason || record.condition}`)
    return saved
  }
  /**
   * Persists the paused record before returning; the returned promise resolves once the durable write lands.
   * Non-loop callers may ignore it (fire-and-forget, as before); loop call sites await it so a restart
   * cannot restore the pre-pause state.
   */
  private pause(record: GoalRecord, reason: string, cause: PauseCause): Promise<void> {
    const runtime = this.runtime(record.sessionID)
    this.invalidate(runtime)
    this.clearDeferred(runtime, record)
    record.status = "paused"
    record.reason = reason
    record.pauseCause = cause
    const saved = this.commit(record)
    const atCap = this.deps.config.maxTurns > 0 && record.turns >= this.deps.config.maxTurns
    this.notify(
      record.sessionID,
      "paused",
      "warning",
      "Goal paused",
      atCap
        ? `${reason} It stays paused at the turn cap until you /goal clear or set a new goal; a message will not extend the cap.`
        : `${reason} Send a message to resume, or /goal clear.`,
    )
    return saved
  }

  /**
   * Persists the terminal status before returning; the returned promise resolves once the durable write lands.
   * Non-loop callers may ignore it (fire-and-forget, as before); the goal-loop end path awaits it so a crash
   * between the loop's last met verdict and the write cannot restore an active loop and re-evaluate the condition.
   * The final spend snapshot still resolves in the background and re-saves the record.
   */
  private finish(record: GoalRecord, status: Exclude<GoalStatus, "active" | "paused">, reason?: string): Promise<void> {
    // Absence, not explicit undefined: the host rejects explicit-undefined keys in any RPC payload.
    delete record.pauseCause
    const runtime = this.runtimes.get(record.sessionID)
    if (runtime) {
      this.invalidate(runtime)
      this.clearDeferred(runtime, record)
    }
    record.status = status
    if (reason) record.reason = reason
    record.endedAt = this.deps.clock.now()
    this.writeLearningGoalTerminal(record)
    // Terminal records are inert: drop any one-shot re-anchor armed before the finish so it cannot
    // ride a later model request (a compaction landing between the arm and the finish would
    // otherwise inject "keep working" ground truth for a finished goal).
    this.pendingAnchors.delete(record.sessionID)
    this.lastReanchorAt.delete(record.sessionID)
    // Bound the in-memory map before committing: the just-finished record is the newest, so it is never evicted here.
    this.evictTerminalGoalsBeyondRetention()
    const saved = this.commit(record)
    // Opportunistic storage hygiene: once the just-finished record is durable, prune terminal records
    // across every directory at plugin storage under the same per-directory age/count caps the restore
    // path applies (`pruneAllDirectories`, exactly as `restore()`) — no restart required, and the two
    // paths no longer disagree about scope. Workstream XLIII.
    // Fire-and-forget: the finish path never waits on the prune (the returned promise is exactly `saved`).
    // Best-effort: a prune failure is logged with the session id and changes nothing. Live records are
    // never touched, in any directory; each directory's cap is applied independently. The report is counts only.
    const prune = saved.then(() => this.deps.store.pruneAllDirectories(this.deps.clock.now()))
    const settle = prune.then((report) => {
      if (report.scanned > 0)
        this.deps.log.info("terminal goal records at plugin storage", {
          scanned: report.scanned,
          pruned: report.pruned,
          kept: report.scanned - report.pruned,
          droppedAged: report.droppedAged,
          droppedBeyondCap: report.droppedBeyondCap,
          unstampedKept: report.unstampedKept,
          ...(report.readOnly ? { readOnly: true } : {}),
          directories: report.directories,
        })
    }).catch((error) => this.deps.log.warn("terminal goal record prune failed", { sessionID: record.sessionID, error: errorMessage(error) }))
    this.pendingPrunes.add(settle)
    void settle.finally(() => this.pendingPrunes.delete(settle))
    const usageSnapshot = this.deps.session
      .usage(record.sessionID)
      .then((usage) => {
        if (this.goals.get(record.sessionID) !== record) return
        if (!usage) {
          this.deps.log.warn("final spend snapshot unavailable", { sessionID: record.sessionID })
          return
        }
        record.final = usage
        // Route the final snapshot through commit so the no-op cache mirrors the stored record exactly;
        // a direct store.save left lastCommit holding the pre-`final` serialized string.
        void this.commit(record)
        // The commit-path `changed` event carries no spend (a usage() call per event is not affordable on the
        // hot path), and terminal goals are never re-pulled by the TUI's stale-chrome guard. Emit one more
        // snapshot with the settled spend so an open card/dialog shows the final figure immediately. The
        // context figure rides along from the runtime (the last measured estimate — the authoritative fresh
        // number for the finished record); absent a runtime it is simply omitted, never fabricated.
        const figures = this.runtimes.get(record.sessionID)?.figures
        this.deps.emitter.changed(record.sessionID, this.snapshot(record.sessionID, diffUsage(usage, record.baseline), figures?.contextSize))
      })
      .catch((error) => this.deps.log.warn("final spend snapshot failed", { sessionID: record.sessionID, error: errorMessage(error) }))
      .finally(() => this.pendingUsage.delete(usageSnapshot))
    this.pendingUsage.add(usageSnapshot)
    return saved
  }

  /**
   * Bounds the in-memory map for very long plugin-lifetimes: once more than
   * {@link MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES} terminal records accumulate, the oldest (by `endedAt`,
   * falling back to `startedAt`) are dropped from `goals` — durable storage stays the source of truth, so
   * a dropped record is still served by `peekSnapshot`/`spend` via a fresh storage read, exactly like after
   * a restart. Live records (active/paused) are never dropped, whatever the cap. The just-finished record is
   * by construction the newest, so it is never a victim. Dropping is silent on purpose: the terminal snapshot
   * was already announced at finish time, and re-announcing an eviction would flash a stale card. Best-effort,
   * synchronous, no durable writes: a failure here can never break the finish path.
   */
  private evictTerminalGoalsBeyondRetention(): void {
    const terminals: Array<{ sessionID: string; at: number }> = []
    for (const record of this.goals.values()) {
      if (isLive(record.status)) continue
      const at = typeof record.endedAt === "number" && Number.isFinite(record.endedAt)
        ? record.endedAt
        : typeof record.startedAt === "number" && Number.isFinite(record.startedAt)
          ? record.startedAt
          : 0
      terminals.push({ sessionID: record.sessionID, at })
    }
    if (terminals.length <= MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES) return
    terminals.sort((a, b) => a.at - b.at)
    const victims = terminals.slice(0, terminals.length - MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES)
    for (const { sessionID } of victims) {
      this.goals.delete(sessionID)
      this.lastCommit.delete(sessionID)
      this.lastReanchorAt.delete(sessionID)
      this.pendingAnchors.delete(sessionID)
    }
  }

  // ---------------------------------------------------------------- plumbing

  private learningLogFile(directory: string | undefined): string | undefined {
    const learning = this.deps.config.learning
    if (!learning?.enabled) return undefined
    const base = directory ?? this.deps.directory
    const raw = typeof learning.path === "string" ? learning.path.trim() : ""
    const path = raw || learning.path
    if (isAbsolute(path)) return path
    if (!base) return undefined
    // Avoid creating literal "C:" directories on POSIX when tests pass Windows-style fixture paths.
    if (isWindowsDrivePathOnPosix(base)) return undefined
    // Anchor the journal at the repository root so a goal armed from a subfolder never leaves a
    // .term/ in that subfolder. Outside a repo, resolveProjectRoot returns `base` unchanged.
    return join(resolveProjectRoot(base), path)
  }

  /**
   * One learning-log write: resolve the log file, build the entry (or entries) for this record, and append.
   * Shared by the four writers so file resolution, the single clock read and the swallowed-warn failure mode
   * live in one place. The build thunk receives the same `now`, so an entry pair (goal terminal + session
   * outcome) still shares one timestamp.
   */
  private appendLearning(record: GoalRecord, label: string, context: { iteration?: number; turn?: number }, build: (now: number) => LearningEntry[]): void {
    try {
      const file = this.learningLogFile(this.directoryFor(record.sessionID))
      if (!file) return
      const now = this.deps.clock.now()
      for (const entry of build(now)) appendLearningEntry(file, entry)
    } catch (error) {
      this.deps.log.warn(`learning log (${label}) write failed`, { sessionID: record.sessionID, ...context, error: errorMessage(error) })
    }
  }

  private writeLearningGoalTerminal(record: GoalRecord): void {
    this.appendLearning(record, "goal terminal/session outcome", {}, (now) => [
      buildGoalTerminalLearningEntry(record, now),
      buildSessionOutcomeLearningEntry(record, now),
    ])
  }

  private writeLearningLoopIteration(record: GoalRecord, entry: LoopEntry): void {
    this.appendLearning(record, "loop iteration", { iteration: entry.version }, (now) => [buildLoopIterationLearningEntry(record, entry, now)])
  }

  private writeLearningTurnVerdict(record: GoalRecord, entry: VerdictEntry): void {
    this.appendLearning(record, "turn verdict", { turn: entry.turn }, (now) => [buildTurnVerdictLearningEntry(record, entry, now)])
  }

  private recentLearningsForPrompt(record: GoalRecord): string | undefined {
    try {
      const file = this.learningLogFile(this.directoryFor(record.sessionID))
      if (!file) return undefined
      // One bounded tail read feeds one bounded, focused block. Both the I/O window and the injected string are
      // capped so a long session with many goal versions cannot bloat the evaluator's context turn after turn.
      return formatLearningsForPrompt(readLearningEntriesTail(file)) || undefined
    } catch {
      return undefined
    }
  }

  private writeLearningGoalArmed(record: GoalRecord): void {
    this.appendLearning(record, "goal armed", {}, (now) => [buildGoalArmedLearningEntry(record, now)])
  }

  private runtime(sessionID: string): Runtime {
    let runtime = this.runtimes.get(sessionID)
    if (!runtime) {
      runtime = { sessionID, epoch: 0, toolCalls: 0, iterationToolCalls: 0, carriedToolCalls: 0, evaluating: false, awaitingExecution: false, dropStragglerSucceeded: false, iterationDeferred: false, planning: false, heartbeating: false, waitingPaint: false }
      this.runtimes.set(sessionID, runtime)
    }
    return runtime
  }

  /** Fresh runtime for a new goal; keeps the tool counter of a turn already in flight. */
  private reset(sessionID: string) {
    const previous = this.runtimes.get(sessionID)
    if (previous) this.invalidate(previous)
    this.runtimes.set(sessionID, {
      sessionID,
      epoch: (previous?.epoch ?? 0) + 1,
      toolCalls: previous?.toolCalls ?? 0,
      iterationToolCalls: 0,
      carriedToolCalls: 0,
      evaluating: false,
      awaitingExecution: false,
      dropStragglerSucceeded: false,
      iterationDeferred: false,
      planning: false,
      heartbeating: previous?.heartbeating ?? false,
      waitingPaint: false,
    })
  }

  /**
   * Deferred background-wait state must not survive resume, failure, interrupt, pause or finish.
   * `waiting` rides the snapshot off the runtime `deferredSince` and its persisted twin `waitingSince`;
   * several interrupt paths flip it with no record mutation, so drop the twin and announce the flip when
   * one actually happened.
   */
  private clearDeferred(runtime: Runtime, record?: GoalRecord) {
    const wasWaiting = runtime.deferredSince !== undefined || record?.waitingSince !== undefined
    runtime.deferredSince = undefined
    runtime.carriedToolCalls = 0
    runtime.lastCheckinAt = undefined
    runtime.busyRetries = undefined
    if (!wasWaiting) return
    const ours = record !== undefined && this.goals.get(record.sessionID) === record
    if (record && record.waitingSince !== undefined) delete record.waitingSince
    if (record && record.waitingSubagents !== undefined) delete record.waitingSubagents
    if (ours) void this.commit(record)
  }

  private invalidate(runtime: Runtime, keepPending = false) {
    runtime.epoch++
    runtime.abort?.abort()
    runtime.abort = undefined
    const wasEvaluating = runtime.evaluating
    runtime.evaluating = false
    if (!keepPending) {
      // A user prompt or a newer execution owns this turn: its own evaluate() will stamp a fresh marker.
      // Shutdown/interrupt keep the breadcrumb so restore() can resume the interrupted step.
      const record = this.goals.get(runtime.sessionID)
      if (record?.pendingEvaluation) {
        delete record.pendingEvaluation
        void this.commit(record)
      }
    }
    if (runtime.timer !== undefined) this.deps.clock.clearTimeout(runtime.timer)
    runtime.timer = undefined
    if (wasEvaluating) {
      // The in-flight evaluate() will epoch-guard into a silent early return; without this emit the TUI
      // keeps painting "checking" until the stale re-pull. emit() no-ops when the record is no longer ours.
      const record = this.goals.get(runtime.sessionID)
      if (record) this.emit(record)
    }
  }

  private schedule(runtime: Runtime, ms: number, callback: () => void) {
    if (runtime.timer !== undefined) this.deps.clock.clearTimeout(runtime.timer)
    runtime.timer = this.deps.clock.setTimeout(() => {
      runtime.timer = undefined
      if (!this.disposed) callback()
    }, ms)
  }

  private stale(record: GoalRecord, runtime: Runtime, epoch: number) {
    return this.disposed || runtime.epoch !== epoch || this.goals.get(record.sessionID) !== record || record.status !== "active"
  }

  /**
   * Resolves once the write has been attempted; a rejecting durable write is normalized to "did not land"
   * (and logged), so the promise never rejects and fire-and-forget call sites are safe by construction.
   * Most callers ignore the result; the loop arm awaits it so a restart cannot restore the pre-arm state.
   * A failed write drops the record from the no-op cache so the next identical commit retries the durable write instead of assuming it landed.
   */
  private commit(record: GoalRecord): Promise<void> {
    let serialized: string
    try {
      serialized = JSON.stringify(record)
    } catch {
      serialized = "" // Unserializable record: never skip the save.
    }
    if (serialized && this.lastCommit.get(record.sessionID) === serialized) return Promise.resolve()
    this.lastCommit.set(record.sessionID, serialized)
    const saved = this.deps.store.save(record).catch((error: unknown) => {
      // The store's own contract is "resolves with whether it landed", but a save() that itself rejects
      // (storage fault at the port boundary) would otherwise propagate: every un-awaited this.commit call site
      // in the state machine would become an unhandled rejection, and the no-op marker would keep claiming
      // the write landed. Treat it as unwritten: drop the marker (below), retry on the next identical commit.
      this.deps.log.warn("goal record save failed; treated as unwritten", { sessionID: record.sessionID, error: errorMessage(error) })
      return false
    })
    this.emit(record)
    return saved.then((ok) => {
      // Keep the marker only when the write landed; otherwise the next identical commit retries.
      if (serialized && !ok) this.lastCommit.delete(record.sessionID)
    })
  }

  /**
   * Push the `waiting` ⇄ `active` pill flip as an immediate `changed` event on session heartbeats. The
   * deferral itself is untouched — evaluation still waits for background work to drain — but the indicator
   * follows the main session: an execution start or a tool call paints `active` at once, and the turn end
   * paints `waiting` again only while the deferral is still pending. `waitingPaint` dedupes a turn's many
   * tool calls into one event; `emit()` re-syncs it so every emission path (commit, clearDeferred, verdict)
   * keeps the cache honest.
   */
  private syncWaitingPaint(sessionID: string): void {
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") return
    const runtime = this.runtimes.get(sessionID)
    const deferred = runtime?.deferredSince !== undefined || record.waitingSince !== undefined
    const waiting = deferred && runtime?.heartbeating !== true
    if (runtime?.waitingPaint === waiting) return
    if (runtime) runtime.waitingPaint = waiting
    this.emit(record)
  }

  private emit(record: GoalRecord) {
    if (this.goals.get(record.sessionID) !== record) return
    const runtime = this.runtimes.get(record.sessionID)
    const figures = runtime?.figures
    const snapshot = this.snapshot(record.sessionID, figures?.spend, figures?.contextSize)
    if (runtime && snapshot) runtime.waitingPaint = snapshot.waiting
    this.deps.emitter.changed(record.sessionID, snapshot)
  }

  private notify(sessionID: string, kind: NoticeKind, level: NoticeLevel, title: string, body: string) {
    const notice: Notice = { sessionID, kind, level, title, message: body }
    this.deps.log.info(`${title}: ${truncate(body, 200)}`, { sessionID, kind })
    this.deps.emitter.notice(notice)
  }
}

/** Sanitize an invalid count suffix before it is echoed into a notice: printable ASCII only, capped. */
function sanitizeCountEcho(value: string): string {
  let out = ""
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (out.length >= 32) return `${out}…`
    out += code >= 32 && code <= 126 ? ch : "?"
  }
  return out
}
