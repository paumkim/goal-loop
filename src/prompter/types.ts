/** Task lifecycle in `prompter status` display order. Single source for the type and CLI listings. */
export const TASK_STATUSES = ["running", "in_review", "merged", "rejected", "failed", "interrupted"] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Statuses that still own a backlog line or block task selection. */
export const ACTIVE_TASK_STATUSES: ReadonlySet<string> = new Set(["running", "in_review"])

/** Finished statuses whose worktree and branches `prompter cleanup` removes. */
export const FINISHED_TASK_STATUSES: readonly TaskStatus[] = TASK_STATUSES.filter((s) => !ACTIVE_TASK_STATUSES.has(s))

/** Append-only state record. The last record for an id is the current state. */
export interface TaskState {
  readonly id: string
  readonly objective: string
  readonly status: TaskStatus
  readonly repo: string
  readonly branch: string
  readonly worktree: string
  readonly requestedAt: string
  readonly updatedAt: string
  readonly finishedAt?: string
  readonly reason?: string
  readonly commit?: string
  readonly goalStatus?: string
  readonly turns?: number
  readonly costUsd?: number
  readonly tokens?: number
}

/** Resolved, validated runtime configuration. */
export interface Config {
  /** Backlog markdown file, relative to the repo. */
  readonly backlog: string
  /** Per-repo config file, relative to the repo. */
  readonly configFile: string
  /** State journal override (defaults to $PROMPTER_HOME/state/<repo-hash>.jsonl). */
  readonly stateFile?: string
  /** Integration branch tasks branch off from and are reviewed against. */
  readonly baseBranch: string
  /** Task branch prefix; the short task id is appended. */
  readonly branchPrefix: string
  /** Absolute path to the prompt library root (the `prompts/` directory). */
  readonly promptLibrary: string
  /** Prompt files under promptLibrary used as workflow guidance. */
  readonly prompts: readonly string[]
  /** goal-loop plugin path/module spec. Empty means rely on global opencode config. */
  readonly plugin: string
  /** Optional "provider/model" for autonomous sessions. */
  readonly model?: string
  readonly maxTasksPerTick: number
  /** Dollar cap per tick. 0 means unlimited. */
  readonly maxSpendUsd: number
  /** Token cap per tick (input + output). 0 means unlimited. */
  readonly maxTokens: number
  readonly maxWallMsPerTick: number
  readonly maxWallMsPerTask: number
  readonly pollMs: number
  /** Forwarded to goal-loop as OPENCODE_GOAL_VERIFY_COMMAND. */
  readonly verifyCommand: string
  /** Extra kill-switch paths. */
  readonly stopFiles: readonly string[]
  /** If non-empty, `tick` refuses repos outside this list. */
  readonly allowedRepos: readonly string[]
  /** Fail closed when tracked files are modified/staged in the main checkout. */
  readonly requireCleanTree: boolean
}

/** Outcome of one headless goal session. */
export interface TaskResult {
  readonly status: string
  readonly reason: string
  readonly turns: number
  readonly costUsd: number
  readonly tokens: number
  readonly commit?: string
}

/** One parsed backlog checkbox line. */
export interface BacklogLine {
  readonly index: number
  readonly raw: string
  readonly indent: string
  readonly checked: boolean
  readonly objective: string
  readonly id: string
  readonly marker?: TaskMarker
}

export interface TaskMarker {
  readonly status: string
  readonly id: string
}

/** A budget window shared across a tick. */
export interface BudgetState {
  tasks: number
  costUsd: number
  tokens: number
  startedAt: number
}
