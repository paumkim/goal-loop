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
   * (`.term/coordinator/`, `packages/coordinator/bin/coordinator`, `.opencode/rules/project-safety.md`)
   * and switch normal agents to `wt/<slug>` + submit. When `true` force coordinator mode, when `false`
   * disable it. See `resolveCommitPolicy`.
   */
  readonly coordinator?: "auto" | boolean
}

/** Commit routing mode. `direct` commits to the target branch; `coordinator` uses `wt/<slug>` + submit/merge. */
export type CommitMode = "direct" | "coordinator"

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
  /** Coordinator wrapper path, e.g. `packages/coordinator/bin/coordinator`. */
  readonly coordinatorBin?: string
  /** Worktree directory, e.g. `worktrees`. */
  readonly worktreeDir?: string
}

/** The commit rule is off: nothing in the session's directory is a git repository. */
export const NO_COMMIT: CommitPolicy = { required: false, branch: "dev", mode: "direct", reason: "not a git repository" }

/** Live (resumable) statuses. `failed` and `cleared` are both terminal but distinct: `failed` means an unrecoverable error ended the goal, `cleared` means the user ended it. Neither is resumable. */
export const LIVE_STATUSES: ReadonlySet<GoalStatus> = new Set(["active", "paused"])

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

/** Persisted goal state. Plain JSON so it round-trips through plugin storage. */
export interface GoalRecord {
  readonly version: 1
  readonly id: string
  readonly sessionID: string
  readonly directory: string
  readonly condition: string
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

export type NoticeKind = "set" | "status" | "cleared" | "achieved" | "impossible" | "paused" | "resumed" | "retry" | "failed" | "checkin" | "error"

export interface Notice {
  readonly sessionID: string
  readonly kind: NoticeKind
  readonly level: NoticeLevel
  readonly title: string
  readonly message: string
}
