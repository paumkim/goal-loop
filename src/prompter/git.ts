import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

export interface GitResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

/** Read-only by default: callers pass explicit flags. Never throws. */
export const git = (cwd: string, args: readonly string[]): GitResult => {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  if (r.error) return { ok: false, stdout: "", stderr: r.error.message }
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() }
}

export const isRepo = (cwd: string): boolean => git(cwd, ["rev-parse", "--is-inside-work-tree"]).ok

export const trackedDirty = (cwd: string): string => {
  const staged = git(cwd, ["diff", "--cached", "--quiet"])
  const unstaged = git(cwd, ["diff", "--quiet"])
  const parts: string[] = []
  if (!staged.ok) parts.push("staged changes")
  if (!unstaged.ok) parts.push("unstaged changes")
  return parts.join(" and ")
}

export const branchExists = (cwd: string, branch: string): boolean => git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok

export const commitExists = (cwd: string, sha: string): boolean => git(cwd, ["cat-file", "-e", `${sha}^{commit}`]).ok

export const isAncestor = (cwd: string, sha: string, ref: string): boolean =>
  git(cwd, ["merge-base", "--is-ancestor", sha, ref]).ok

/** Newest commit on `branch` that is not on `base`. */
export const tipAheadOf = (cwd: string, base: string, branch: string): string | undefined => {
  const r = git(cwd, ["rev-list", `${base}..${branch}`])
  if (!r.ok || !r.stdout) return undefined
  return (r.stdout.split("\n")[0] ?? "").trim() || undefined
}

export const aheadCount = (cwd: string, base: string, branch: string): number => {
  const r = git(cwd, ["rev-list", "--count", `${base}..${branch}`])
  const n = Number.parseInt(r.stdout, 10)
  return r.ok && Number.isFinite(n) ? n : 0
}

export const addWorktree = (cwd: string, worktree: string, branch: string, base: string): GitResult =>
  git(cwd, ["worktree", "add", "-b", branch, path.resolve(worktree), base])

export const removeWorktree = (cwd: string, worktree: string): GitResult =>
  git(cwd, ["worktree", "remove", "--force", path.resolve(worktree)])

export const deleteBranch = (cwd: string, branch: string): GitResult => git(cwd, ["branch", "-D", branch])

/** Best-effort merge command for the human reviewer, respecting the coordinator when present. */
export const suggestedMergeCommand = (cwd: string, base: string, branch: string): string => {
  const coordinator = path.join(cwd, "packages", "coordinator", "bin", "coordinator")
  if (existsSync(coordinator)) return `cd ${cwd} && ./packages/coordinator/bin/coordinator merge-next   # task branch: ${branch}`
  return `cd ${cwd} && git merge --no-ff ${branch}   # into ${base}`
}
