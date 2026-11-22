import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { markBacklog, recordOutcome } from "./apply.ts"
import { parseBacklog } from "./backlog.ts"
import type { Config, TaskState } from "./types.ts"
import { branchExists, commitExists, deleteBranch, isAncestor, removeWorktree, suggestedMergeCommand } from "./git.ts"
import { killSwitch } from "./safety.ts"
import { short } from "./util.ts"

interface ReviewDeps {
  readonly exists: (p: string) => boolean
  readonly env: NodeJS.ProcessEnv
}

interface ReviewResult {
  readonly ok: boolean
  readonly message: string
}

/** Human-facing list of tasks waiting for a decision. */
export const reviewLines = (states: readonly TaskState[]): string => {
  const pending = states.filter((s) => s.status === "in_review")
  if (pending.length === 0) return "(no tasks awaiting review)"
  return pending.map((s) => [
    `- ${s.id}  ${short(s.objective)}`,
    `    branch: ${s.branch}${s.commit ? `  commit: ${s.commit.slice(0, 12)}` : ""}`,
    `    worktree: ${s.worktree}`,
  ].join("\n")).join("\n")
}

/** Mark a task merged — but only after proving its commit landed on the base branch. */
export const approve = (
  state: TaskState,
  config: Config,
  repo: string,
  stateFile: string,
  deps: ReviewDeps,
  opts: { readonly runVerify?: boolean } = {},
): ReviewResult => {
  if (state.status !== "in_review") return { ok: false, message: `task ${state.id} is '${state.status}', not 'in_review'` }
  const stopped = killSwitch(config, repo, deps)
  if (stopped) return { ok: false, message: `refusing to approve: ${stopped}` }

  if (!state.commit || !commitExists(repo, state.commit)) {
    return { ok: false, message: `commit ${state.commit ?? "(none)"} not found in ${repo}` }
  }
  if (!isAncestor(repo, state.commit, config.baseBranch)) {
    return {
      ok: false,
      message: `commit ${state.commit.slice(0, 12)} is not on ${config.baseBranch} yet. Merge it first:\n  ${suggestedMergeCommand(repo, config.baseBranch, state.branch)}\nThen re-run: prompter approve ${state.id}`,
    }
  }

  if (opts.runVerify && config.verifyCommand) {
    const check = spawnSync("bash", ["-c", config.verifyCommand], { cwd: repo, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
    if (check.status !== 0) {
      return { ok: false, message: `verification failed (${config.verifyCommand}):\n${(check.stderr || check.stdout).trim()}` }
    }
  }

  const line = parseBacklog(readBacklog(repo, config)).find((l) => l.id === state.id)
  if (line) markBacklog(repo, config, line, "merged", state.id, true)
  recordOutcome(stateFile, {
    id: state.id, objective: state.objective, status: "merged", repo, branch: state.branch,
    worktree: state.worktree, commit: state.commit, reason: "approved by reviewer",
  })
  cleanupWorktree(repo, state)
  return { ok: true, message: `approved ${state.id} — merged ${state.commit.slice(0, 12)} into ${config.baseBranch}` }
}

/** Reject a reviewed task; keep the objective in the backlog for a later retry. */
export const reject = (
  state: TaskState,
  config: Config,
  repo: string,
  stateFile: string,
  reason: string,
): ReviewResult => {
  if (state.status !== "in_review") return { ok: false, message: `task ${state.id} is '${state.status}', not 'in_review'` }
  const line = parseBacklog(readBacklog(repo, config)).find((l) => l.id === state.id)
  if (line) markBacklog(repo, config, line, "rejected", state.id, false)
  recordOutcome(stateFile, {
    id: state.id, objective: state.objective, status: "rejected", repo, branch: state.branch,
    worktree: state.worktree, reason: reason || "rejected by reviewer",
  })
  cleanupWorktree(repo, state)
  return { ok: true, message: `rejected ${state.id}; run 'prompter cleanup ${repo}', then remove its marker in ${config.backlog} to retry` }
}

/** Remove a task's worktree and branch. Best effort: git diagnostics are returned for reporting. */
export const cleanupWorktree = (repo: string, state: TaskState): string[] => {
  const notes: string[] = []
  if (existsSync(state.worktree)) {
    const r = removeWorktree(repo, state.worktree)
    if (!r.ok) notes.push(`worktree removal: ${short(r.stderr || r.stdout)}`)
  }
  if (branchExists(repo, state.branch)) {
    const r = deleteBranch(repo, state.branch)
    if (!r.ok) notes.push(`branch deletion: ${short(r.stderr || r.stdout)}`)
  }
  return notes
}

const readBacklog = (repo: string, config: Config): string => readFileSync(path.resolve(repo, config.backlog), "utf8")
