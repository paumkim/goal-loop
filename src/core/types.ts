/** Lifecycle of a goal. `active` and `paused` are live; the rest are terminal. */
export type GoalStatus = "active" | "paused" | "achieved" | "impossible" | "cleared" | "failed"

export type Verdict = "met" | "not_met" | "impossible"

/** What the user asked for: finished work has to be committed before the goal counts as met. */
export interface CommitRequest {
  /** The user wants the commit rule. */
  readonly enabled: boolean
  /** Branch the finished work has to land on. */
  readonly branch: string
  /**
   * Coordinator mode: when `"auto"` (default) detect coordinator repositories from the working tree
   * (`.term/coordinator/config.json` + `state.json`, or the coordinator bin plus one of them)
   * and switch normal agents to `wt/<slug>` + submit. When `true` force coordinator mode, when `false`
   * disable it. See `resolveCommitPolicy` and `detectCoordinator`.
   */
  readonly coordinator?: "auto" | boolean
}

/** Commit routing mode. `direct` commits to the target branch; `coordinator` uses `wt/<slug>` + submit/merge. */
type CommitMode = "direct" | "coordinator"

/** The commit rule as it applies to one session, after the repository was inspected. */
export interface CommitPolicy {
  /** Finished work has to be committed before the goal counts as met. */
  readonly required: boolean
  /** Branch the finished work has to land on (target branch in coordinator mode). */
  readonly branch: string
  /** Why the rule is on or off. Shown in the plugin log. */
  readonly reason: string
  /** Commit routing mode; omitted means `direct`. */
  readonly mode?: CommitMode
  /** Absolute path to the coordinator wrapper; omitted when no binary can be located (never repo-relative). */
  readonly coordinatorBin?: string
  /** Worktree directory, e.g. `worktrees`. */
  readonly worktreeDir?: string
}

/** The commit rule is off: nothing in the session's directory is a git repository. */
export const NO_COMMIT: CommitPolicy = { required: false, branch: "dev", mode: "direct", reason: "not a git repository" }

/** Live (resumable) statuses. `failed` and `cleared` are both terminal but distinct: `failed` means an unrecoverable error ended the goal, `cleared` means the user ended it. Neither is resumable. */
const LIVE_STATUSES: ReadonlySet<GoalStatus> = new Set(["active", "paused"])

export const isLive = (status: GoalStatus) => LIVE_STATUSES.has(status)

export interface UsageSnapshot {
  readonly cost: number
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export const EMPTY_USAGE: UsageSnapshot = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

export interface VerdictEntry {
  readonly turn: number
  readonly verdict: Verdict
  readonly reason: string
  readonly at: number
  /** Tool calls the evaluating turn used (0 = the turn produced nothing — at a met verdict that means the condition already held at HEAD). Absent on records written before this field landed; never fabricated. */
  readonly toolCalls?: number
  /** Marginal usage this turn consumed (delta against the previous turn's measurement; the first turn diffs against the arm-time reading). Absent on records written before this field landed or when the host cannot measure — never estimated. */
  readonly spend?: UsageSnapshot
  /** The sha HEAD resolved to when this turn was evaluated (the loop rail stamps it at advance; the per-verdict ledger matches). Absent outside a repository or when HEAD could not be read — never guessed. */
  readonly sha?: string
  /**
   * Verification gate evidence when `evaluator.verifyCommand` ran for this evaluated turn (pass, or a met verdict downgraded to not_met by the gate).
   * Additive; absent when no gate ran for the turn. Records explicit pass/fail evidence in the verdict trail.
   */
  readonly verify?: {
    readonly command: string
    readonly code: number | null
    readonly timedOut?: boolean
    readonly tail?: string
  }
}

/** One completed iteration of a `/goal-loop`. Kept as a compact record — never the transcript. */
export interface LoopEntry {
  /** 1-based iteration number (v1 is 1). */
  readonly version: number
  /** The condition that was achieved. */
  readonly condition: string
  /** Machine-consumable summary produced by the evaluator when the iteration was met. */
  readonly summary: string
  readonly reason: string
  readonly turns: number
  readonly toolCalls: number
  readonly endedAt: number
  /** Estimated context size measured at the arm of this iteration (the boundary-compaction estimate tagged with this iteration). Absent when the arm could not measure the context — never estimated, never fabricated. */
  readonly contextTokens?: number
  /** The sha HEAD resolved to when the iteration was recorded (stamped at loop advance). Absent outside a repository or when HEAD could not be read — never guessed. */
  readonly sha?: string
  /** Usage delta attributed to this iteration alone (diff between the arm-time cumulative usage and the advance-time cumulative usage). Absent when either side could not be measured — never estimated, never fabricated. */
  readonly spend?: UsageSnapshot
}

/** Consecutive unlanded boundary compactions after which the plugin emits one final backstop warning. 2 misses arm a forced re-request; past 4 re-requests drop to a trickle every 3rd arm. Lives here so core formatters can display it. */
export const COMPACT_MISS_CAP = 4

/**
 * Completed-iteration records retained on `loopHistory`. A very long `/goal-loop` would otherwise grow the
 * persisted record — and every outbound snapshot, which `structuredClone`s the record — without bound, one
 * entry per landed iteration. The planner only ever injected the last 10 iterations into the prompt, so
 * retaining the newest 50 loses nothing it used. Oldest entries past the cap are dropped at the single
 * write point (`loopAdvance`). Lives here so core formatters and the controller agree on the bound.
 */
export const MAX_LOOP_HISTORY_ENTRIES = 50

/** Total landed iterations a display should count: the retained entries plus the ones the cap dropped. */
export const completedIterationCount = (goal: { readonly loopHistory?: readonly LoopEntry[]; readonly loopHistoryDropped?: number }): number =>
  (goal.loopHistoryDropped ?? 0) + (goal.loopHistory?.length ?? 0)

/**
 * Bounds a completed-iteration history to the newest `MAX_LOOP_HISTORY_ENTRIES` entries. Returns the retained
 * slice and how many were dropped this call (0 at or below the cap). Callers add the drop count onto the
 * record's `loopHistoryDropped` so displays and ledgers can say "N most recent of M landed" honestly.
 */
export const boundLoopHistory = (entries: readonly LoopEntry[]): { retained: LoopEntry[]; dropped: number } =>
  entries.length <= MAX_LOOP_HISTORY_ENTRIES
    ? { retained: [...entries], dropped: 0 }
    : { retained: entries.slice(-MAX_LOOP_HISTORY_ENTRIES), dropped: entries.length - MAX_LOOP_HISTORY_ENTRIES }

/**
 * Evaluated-turn records (the verdict trail) retained on `history`. The splice was always there
 * (oldest dropped past 20) but silent: no counter, so no display could say how much of the trail
 * is gone. Lives here so the controller and every consumer agree on the bound. Sized so the trail
 * stays useful on screen while the record stays small; a fresh goal needs a few turns before the cap matters.
 */
export const MAX_VERDICT_HISTORY_ENTRIES = 20

/** Total evaluated turns a consumer should count: the retained entries plus the ones the cap dropped. */
export const totalVerdictCount = (goal: { readonly history?: readonly VerdictEntry[]; readonly historyDropped?: number }): number =>
  (goal.historyDropped ?? 0) + (goal.history?.length ?? 0)

/**
 * Bounds a verdict trail to the newest `MAX_VERDICT_HISTORY_ENTRIES` entries. Returns the retained slice
 * and how many were dropped this call (0 at or below the cap). Callers add the drop count onto the
 * record's `historyDropped` so displays can say "N most recent of M evaluated turns" honestly.
 */
export const boundVerdictHistory = (entries: readonly VerdictEntry[]): { retained: VerdictEntry[]; dropped: number } =>
  entries.length <= MAX_VERDICT_HISTORY_ENTRIES
    ? { retained: [...entries], dropped: 0 }
    : { retained: entries.slice(-MAX_VERDICT_HISTORY_ENTRIES), dropped: entries.length - MAX_VERDICT_HISTORY_ENTRIES }

/**
 * Completed-condition strings retained on the record as the anti-repeat/near-duplicate gate ledger. The gates
 * must catch a planner re-offering a condition that completed before the retained 50-entry iteration window;
 * the ledger is the bounded memory that outlives that window. Sized so 100 completed conditions ride the
 * record (a line each, never the summaries) while staying small in storage and snapshots.
 */
export const MAX_COMPLETED_CONDITION_ENTRIES = 100

/** Total completed conditions a consumer should count: retained plus dropped. */
export const completedConditionCount = (goal: { readonly completedConditions?: readonly string[]; readonly completedConditionsDropped?: number }): number =>
  (goal.completedConditionsDropped ?? 0) + (goal.completedConditions?.length ?? 0)

/**
 * Bounds the completed-condition ledger to the newest `MAX_COMPLETED_CONDITION_ENTRIES` strings. Oldest entries
 * past the cap are dropped; exact consecutive duplicates (a re-entered advance for the same iteration) collapse to
 * one. Returns the retained list and how many were dropped this call. Callers add the drop count onto the record's
 * `completedConditionsDropped`.
 */
export const boundCompletedConditions = (entries: readonly string[]): { retained: string[]; dropped: number } => {
  const deduped: string[] = []
  for (const entry of entries) {
    if (deduped[deduped.length - 1] === entry) continue
    deduped.push(entry)
  }
  return deduped.length <= MAX_COMPLETED_CONDITION_ENTRIES
    ? { retained: deduped, dropped: 0 }
    : { retained: deduped.slice(-MAX_COMPLETED_CONDITION_ENTRIES), dropped: deduped.length - MAX_COMPLETED_CONDITION_ENTRIES }
}

/**
 * Bounds the controller's in-memory map of terminal goal records. Durable storage is the source of truth:
 * a record evicted here is still served by `peekSnapshot` from storage, and reappears only on the next commit.
 * Live records (active/paused) are never evicted.
 */
export const MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES = 20

/**
 * Terminal goal records kept at plugin storage per directory. A goal that finished (achieved/impossible/cleared/failed)
 * leaves its record behind for `spend`/`peekSnapshot` to answer about; an unbounded backlog of those is dead weight.
 * Live records (active/paused) are never pruned. See `selectTerminalRecordsToPrune`.
 */
export const MAX_TERMINAL_RECORD_ENTRIES = 50

/** Terminal records whose last-activity stamp (`endedAt`, falling back to `startedAt`) is older than this are pruned. */
export const TERMINAL_RECORD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface TerminalPruneSelection {
  /** sessionIDs of the records to remove. */
  readonly pruned: string[]
  /** How many were pruned by the age cap. */
  readonly droppedAged: number
  /** How many were pruned by the count cap (the newest `MAX_TERMINAL_RECORD_ENTRIES` are kept). */
  readonly droppedBeyondCap: number
  /** How many terminal records were offered to the selector (live records are ignored). */
  readonly offered: number
  /** Terminal records kept because they carry no usable stamp (no `endedAt`/`startedAt`): age can never be judged. */
  readonly unstampedKept: number
}

/**
 * Chooses which terminal records to prune: any terminal record past `TERMINAL_RECORD_MAX_AGE_MS` (by `endedAt`,
 * falling back to `startedAt`), then — from the survivors — all but the newest `MAX_TERMINAL_RECORD_ENTRIES` by the
 * same stamp. Live records are ignored entirely. Terminal records with no usable stamp are kept (their age can never
 * be judged) and are reported via `unstampedKept`, never silently counted as fresh or as pruned.
 */
export const selectTerminalRecordsToPrune = (
  records: readonly GoalRecord[],
  nowMs: number,
): TerminalPruneSelection => {
  const terminal = records.filter((r) => !isLive(r.status))
  const stamped: Array<{ sessionID: string; at: number }> = []
  let unstampedKept = 0
  for (const r of terminal) {
    const at = typeof r.endedAt === "number" && Number.isFinite(r.endedAt) ? r.endedAt
      : typeof r.startedAt === "number" && Number.isFinite(r.startedAt) ? r.startedAt
      : undefined
    if (at === undefined) unstampedKept++
    else stamped.push({ sessionID: r.sessionID, at })
  }
  const fresh = stamped.filter((x) => nowMs - x.at <= TERMINAL_RECORD_MAX_AGE_MS)
  const droppedAged = stamped.length - fresh.length
  const newestFirst = [...fresh].sort((a, b) => b.at - a.at)
  const beyond = newestFirst.slice(MAX_TERMINAL_RECORD_ENTRIES)
  return {
    pruned: [...stamped.filter((x) => nowMs - x.at > TERMINAL_RECORD_MAX_AGE_MS).map((x) => x.sessionID), ...beyond.map((x) => x.sessionID)],
    droppedAged,
    droppedBeyondCap: beyond.length,
    offered: terminal.length,
    unstampedKept,
  }
}

/** Persisted goal state. Plain JSON so it round-trips through plugin storage. */
/**
 * Plugin-tracked state of a boundary-compaction request at a loop iteration boundary. Plain JSON so it round-trips through plugin storage.
 *
 * Landing signals, strongest first: a `session.compaction.ended` event (authoritative — the host compacted),
 * or a >=10% context-size drop observed against `estimatedTokens` at an arm. An unknown/unestimable size is
 * never a landing and never a miss: it ticks `unmeasurableTicks` until the host shows us a number again.
 */
export interface LoopCompactState {
  /** When the plugin asked the host to compact (ms since epoch). */
  readonly requestedAt: number
  /** Context size in tokens at the time the request was made; absent when the estimate was unknown. */
  readonly estimatedTokens?: number
  /** The loop iteration that armed when the request was made (1-based). */
  readonly iteration: number
  /** Set when the compaction was observed to land (compaction-ended event, or the context-size drop). */
  landedAt?: number
  /** Consecutive measurable observations in which a pending request did not land. At COMPACT_MISS_CAP (4) a final backstop warning fires; re-requests drop to a trickle every 3rd arm. The 4-miss cap is never the only signal. */
  misses: number
  /** Consecutive arms in which the context size was unestimable. Never a miss. The first tick forces one re-request past cooldown; repeated ticks mark `stalenessUnknown`. */
  unmeasurableTicks?: number
  /** Set after repeated unmeasurable arms: the landing cannot be ruled out or in. While set, the request is never suspended — at most one forced re-request per 2 arms. */
  stalenessUnknown?: boolean
  /** Set once the host-unwilling warning (2 measurable arms without a landing) has fired for this pending request; the warning fires at most once. */
  unwillingWarned?: boolean
}

/** Why the goal paused. Machine-readable so the HUD can render the exact remedy instead of a generic hint; absent on records persisted before this field existed (restore falls back to the generic line). */
export type PauseCause = "cap" | "stall" | "user"

export interface GoalRecord {
  readonly version: 1
  readonly id: string
  readonly sessionID: string
  readonly directory: string
  /** Mutable: `/goal-loop` re-arms the same record with the next iteration's condition. */
  condition: string
  status: GoalStatus
  /** Latest evaluator reason, pause cause, or end reason. */
  reason?: string
  verdict?: Verdict
  readonly setAt: number
  /** Timer origin — the arm stamp of the FIRST iteration. Stable across loop re-arms and restores; the TUI pill's elapsed timer tracks from here to terminal state. */
  startedAt: number
  endedAt?: number
  /** Evaluated turns. */
  turns: number
  /** Consecutive evaluated turns without tool use. */
  stall: number
  /** Why the goal is paused; set when entering the paused status, cleared on resume/finish. Absent outside paused records and on pre-pauseCause persisted records. */
  pauseCause?: PauseCause
  /** The classifier's short label for the unrecoverable error that failed the goal (e.g. "authentication failure"). Set only on records entering the failed status; absent on legacy records and non-failed goals. */
  failureLabel?: string
  /**
   * The last `evaluator.verifyCommand` gate run against this record (additive; absent on legacy records,
   * on goals with no command configured, and on non-met verdicts — the gate only runs on `met`).
   * Observational only: written by the controller, read by the dashboard. The tail is display-safe
   * (control sequences stripped, last lines, capped) and rides the record so a restart restores it.
   */
  lastVerify?: {
    /** The configured command exactly as run. */
    readonly command: string
    /** Exit code; null when the process never returned one (spawn error or timeout). */
    readonly code: number | null
    /** True when the gate killed the command at evaluator.verifyTimeoutMs. */
    readonly timedOut?: boolean
    /** Last lines of combined output, display-safe, capped at the tail. Absent when the command produced no output. */
    readonly tail?: string
    /** ms since epoch (the shared clock). */
    readonly at: number
  }
  /** Automatic retries since the last successful turn. */
  retries: number
  /** Idle check-ins since the last user prompt. */
  checkins: number
  baseline: UsageSnapshot
  final?: UsageSnapshot
  /** Evaluated turns, oldest first. Retained up to `MAX_VERDICT_HISTORY_ENTRIES` (newest kept); see `historyDropped`. */
  history: VerdictEntry[]
  /**
   * How many evaluated-turn records the retention cap dropped from `history` (oldest first).
   * Additive; absent when the cap never engaged. Total evaluated turns = (this ?? 0) + history.length —
   * use `totalVerdictCount`, never `history.length` alone, when a display means "total evaluated".
   */
  historyDropped?: number
  /** Loop fields (additive; absent on records written before `/goal-loop`). */
  /** True when this goal was armed by `/goal-loop`; the loop advances only on a `met` verdict. */
  loopEnabled?: boolean
  /** 1-based iteration; 1 is the goal set by `/goal-loop` itself. */
  loopIteration?: number
  /** The objective passed to `/goal-loop`; constant across iterations. */
  loopObjective?: string
  /** The loop cap captured when the loop was set (from config at that time). */
  loopMaxLoops?: number
  /** Completed iterations, oldest first. Retained up to `MAX_LOOP_HISTORY_ENTRIES` (newest kept); see `loopHistoryDropped`. */
  loopHistory?: LoopEntry[]
  /**
   * How many completed-iteration records the retention cap dropped from `loopHistory` (oldest first).
   * Additive; absent when the cap never engaged. Total landed iterations = (this ?? 0) + loopHistory.length —
   * use `completedIterationCount`, never `loopHistory.length` alone, when a display means "total landed".
   */
  loopHistoryDropped?: number
  /**
   * Every condition this loop completed, oldest first — the bounded memory the anti-repeat and near-duplicate gates
   * scan so a planner re-offering a pre-window condition is still caught. Retained up to `MAX_COMPLETED_CONDITION_ENTRIES`
   * (newest kept); see `completedConditionsDropped`.
   */
  completedConditions?: string[]
  /**
   * How many completed-condition strings the ledger cap dropped (oldest first). Additive; absent when the cap never
   * engaged. Total completed conditions = (this ?? 0) + completedConditions.length — use `completedConditionCount`.
   */
  completedConditionsDropped?: number
  /** Consecutive iterations with zero tool calls. Recorded and surfaced (TUI); armed loops never pause on it — an armed /goal-loop keeps arming, with at most one notice per stall event. */
  loopNotProgress?: number
  /** Pending/recent boundary-compaction bookkeeping; absent when no compact was requested at a boundary. */
  loopCompact?: LoopCompactState
  /**
   * How many post-compaction re-anchors have been armed for this goal — the count the HUD card shows
   * as `⟲ N` so the re-anchor's existence is one quiet number instead of a transcript notice per landing.
   * Additive; absent on legacy records (treated as 0).
   */
  reanchorCount?: number
  /**
   * Persisted twin of the runtime `deferredSince`: the ms at which the evaluation was deferred because
   * background work (subagents/shells) is in flight. Additive; absent on legacy records and whenever no
   * deferral is in flight. Lets a restart/plugin reload restore the `waiting` pill state the runtime-only
   * flag would otherwise drop mid-wait (observed live: the pill flipped back to `active` after a plugin
   * reload while the background subagent kept running).
   */
  waitingSince?: number
}

/** Read model shared with clients over RPC. */
export interface GoalSnapshot extends GoalRecord {
  readonly elapsedMs: number
  /** An evaluation is in flight. */
  readonly evaluating: boolean
  /** Background work is holding evaluation back. */
  readonly waiting: boolean
  /**
   * A synthetic continuation/arm steer was dispatched and the host has not started the execution yet
   * (the arm→execution transition, or a retry/check-in steer in flight). Runtime-truth: always boolean
   * on snapshots built by this server; absent on mirrors/records written by older builds (never guessed).
   * A live goal with `queued: true` is not stuck and not evaluating — the kickoff is in the host's inbox.
   */
  readonly queued?: boolean
  readonly spend?: UsageSnapshot
  /**
   * Estimated prompt tokens, present when the server could compute them (the `get` RPC does; `changed`
   * event snapshots may not, and the TUI carries the last known value forward). Absent = unknown, never 0.
   */
  readonly contextSize?: number
  /** The configured auto-compact threshold this estimate should be read against; absent when disabled (`compactAtTokens <= 0`). */
  readonly compactAtTokens?: number
}

export interface ModelRef {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

export interface FailureInfo {
  readonly type?: string
  readonly message?: string
  readonly status?: number
}

export type NoticeLevel = "info" | "success" | "warning" | "error"

export type NoticeKind = "set" | "status" | "cleared" | "achieved" | "impossible" | "paused" | "resumed" | "retry" | "failed" | "checkin" | "error" | "compact" | "loop"

export interface Notice {
  readonly sessionID: string
  readonly kind: NoticeKind
  readonly level: NoticeLevel
  readonly title: string
  readonly message: string
}
