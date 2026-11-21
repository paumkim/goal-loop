import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { writeLineStatus } from "./backlog.ts"
import { appendState } from "./state.ts"
import type { BacklogLine, Config, TaskState, TaskStatus } from "./types.ts"
import { nowIso } from "./util.ts"

export interface OutcomeInput {
  readonly id: string
  readonly objective: string
  readonly status: TaskStatus
  readonly repo: string
  readonly branch: string
  readonly worktree: string
  readonly reason?: string
  readonly commit?: string
  readonly goalStatus?: string
  readonly turns?: number
  readonly costUsd?: number
  readonly tokens?: number
}

/** Append a state record and return the full record. */
export const recordOutcome = (stateFile: string, input: OutcomeInput): TaskState => {
  const record: TaskState = {
    id: input.id,
    objective: input.objective,
    status: input.status,
    repo: input.repo,
    branch: input.branch,
    worktree: input.worktree,
    requestedAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: input.status === "running" || input.status === "interrupted" ? undefined : nowIso(),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.commit ? { commit: input.commit } : {}),
    ...(input.goalStatus ? { goalStatus: input.goalStatus } : {}),
    ...(input.turns !== undefined ? { turns: input.turns } : {}),
    ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
    ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
  }
  appendState(stateFile, record)
  return record
}

/** Write the status marker back onto the backlog line. */
export const markBacklog = (repo: string, config: Config, line: BacklogLine, status: string, id: string, done: boolean): void => {
  const file = path.resolve(repo, config.backlog)
  const text = readFileSync(file, "utf8")
  writeFileSync(file, writeLineStatus(text, line, status, id, done), "utf8")
}
