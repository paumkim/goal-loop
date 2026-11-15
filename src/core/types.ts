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
}

/** Consecutive unlanded boundary compactions after which the plugin suspends further requests until a landing is observed. 2 misses arm a forced re-request; 4 suspends. Lives here so core formatters can display it. */
export const COMPACT_MISS_CAP = 4

/** Persisted goal state. Plain JSON so it round-trips through plugin storage. */
/** Plugin-tracked state of a boundary-compaction request at a loop iteration boundary. Plain JSON so it round-trips through plugin storage. */
export interface LoopCompactState {
  /** When the plugin asked the host to compact (ms since epoch). */
  readonly requestedAt: number
  /** Context size in tokens at the time the request was made; absent when the estimate was unknown. */
  readonly estimatedTokens?: number
  /** The loop iteration that armed when the request was made (1-based). */
  readonly iteration: number
  /** Set when the compaction was observed to land (compaction-ended event, or the context-size drop). */
  landedAt?: number
  /** Consecutive observations in which a pending request did not land. Two force a re-request; at COMPACT_MISS_CAP (4) requests suspend until a landing is observed. */
  misses: number
  /** Set when the latest miss was counted by the compaction-ended event path; the next arm-time settle skips it once, so one physical no-op compaction is never counted twice. */
  missesCountedAtEvent?: boolean
}

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
  /** Timer origin. Reset when a goal is restored after a restart. */
  startedAt: number
  endedAt?: number
  /** Evaluated turns. */
  turns: number
  /** Consecutive evaluated turns without tool use. */
  stall: number
  /** Automatic retries since the last successful turn. */
  retries: number
  /** Idle check-ins since the last user prompt. */
  checkins: number
  baseline: UsageSnapshot
  final?: UsageSnapshot
  history: VerdictEntry[]
  /** Loop fields (additive; absent on records written before `/goal-loop`). */
  /** True when this goal was armed by `/goal-loop`; the loop advances only on a `met` verdict. */
  loopEnabled?: boolean
  /** 1-based iteration; 1 is the goal set by `/goal-loop` itself. */
  loopIteration?: number
  /** The objective passed to `/goal-loop`; constant across iterations. */
  loopObjective?: string
  /** The loop cap captured when the loop was set (from config at that time). */
  loopMaxLoops?: number
  /** Completed iterations, oldest first. */
  loopHistory?: LoopEntry[]
  /** Consecutive iterations with zero tool calls. Recorded and surfaced (TUI); armed loops never pause on it — an armed /goal-loop keeps arming, with at most one notice per stall event. */
  loopNotProgress?: number
  /** Pending/recent boundary-compaction bookkeeping; absent when no compact was requested at a boundary. */
  loopCompact?: LoopCompactState
}

/** Read model shared with clients over RPC. */
export interface GoalSnapshot extends GoalRecord {
  readonly elapsedMs: number
  /** An evaluation is in flight. */
  readonly evaluating: boolean
  /** Background work is holding evaluation back. */
  readonly waiting: boolean
  readonly spend?: UsageSnapshot
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
