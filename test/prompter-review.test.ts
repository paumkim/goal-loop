/** Approval is the gate that decides a task really landed: every refusal guard is pinned here. */
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { approve, cleanupWorktree, reject, reviewLines } from "../src/prompter/review.ts"
import { DEFAULT_CONFIG } from "../src/prompter/defaults.ts"
import { loadState } from "../src/prompter/state.ts"
import type { Config, TaskState, TaskStatus } from "../src/prompter/types.ts"

const git = (cwd: string, ...args: string[]): string => spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim()

const tempRepo = (): { repo: string; sha: string; config: Config; stateFile: string } => {
  const repo = mkdtempSync(path.join(tmpdir(), "prompter-review-"))
  git(repo, "init", "-q", "-b", "dev")
  git(repo, "config", "user.email", "test@local")
  git(repo, "config", "user.name", "test")
  writeFileSync(path.join(repo, "BACKLOG.md"), "- [ ] t1 do the thing\n")
  writeFileSync(path.join(repo, "f.txt"), "one\n")
  git(repo, "add", "f.txt")
  git(repo, "commit", "-q", "-m", "init")
  return {
    repo,
    sha: git(repo, "rev-parse", "HEAD"),
    config: { ...DEFAULT_CONFIG, backlog: "BACKLOG.md", verifyCommand: "", baseBranch: "dev" },
    stateFile: path.join(repo, "state.jsonl"),
  }
}

const task = (repo: string, sha: string, status: TaskStatus = "in_review"): TaskState => ({
  id: "t1",
  objective: "do the thing",
  status,
  repo,
  branch: "autonomy/t1",
  worktree: path.join(repo, "worktree", "t1"),
  commit: sha,
  requestedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
})

const deps = { exists: () => false, env: {} }

describe("reviewLines", () => {
  test("lists only in-review tasks and says so when none are waiting", () => {
    const { repo, sha } = tempRepo()
    expect(reviewLines([])).toBe("(no tasks awaiting review)")
    const a = task(repo, sha)
    const b = { ...task(repo, sha), id: "t2", status: "merged" as const }
    const lines = reviewLines([a, b])
    expect(lines).toContain("- t1")
    expect(lines).toContain(sha.slice(0, 12))
    expect(lines).toContain(a.worktree)
    expect(lines).not.toContain("- t2")
  })
})

describe("approve", () => {
  test("refuses a task that is not in review", () => {
    const { repo, sha, config, stateFile } = tempRepo()
    expect(approve(task(repo, sha, "running"), config, repo, stateFile, deps)).toEqual({
      ok: false,
      message: "task t1 is 'running', not 'in_review'",
    })
  })

  test("honors the kill switch before touching git", () => {
    const { repo, sha, config, stateFile } = tempRepo()
    const result = approve(task(repo, sha), config, repo, stateFile, { exists: () => false, env: { PROMPTER_STOP: "1" } })
    expect(result.ok).toBe(false)
    expect(result.message).toContain("kill switch: PROMPTER_STOP=1")
  })

  test("refuses a missing or nonexistent commit", () => {
    const { repo, config, stateFile } = tempRepo()
    const noCommit = approve({ ...task(repo, ""), commit: undefined }, config, repo, stateFile, deps)
    expect(noCommit.message).toBe("commit (none) not found in " + repo)
    const bogus = approve({ ...task(repo, ""), commit: "deadbeefdeadbeef" }, config, repo, stateFile, deps)
    expect(bogus.message).toContain("not found in")
  })

  test("refuses a commit that has not landed on the base branch", () => {
    const { repo, sha, config, stateFile } = tempRepo()
    git(repo, "checkout", "-q", "-b", "autonomy/t1")
    writeFileSync(path.join(repo, "f.txt"), "two\n")
    git(repo, "add", "f.txt")
    git(repo, "commit", "-q", "-m", "task work")
    const topic = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "dev")
    expect(sha).not.toBe(topic)

    const result = approve(task(repo, topic), config, repo, stateFile, deps)
    expect(result.ok).toBe(false)
    expect(result.message).toContain(`commit ${topic.slice(0, 12)} is not on dev yet`)
    expect(result.message).toContain("git merge --no-ff autonomy/t1")
    expect(result.message).toContain("Then re-run: prompter approve t1")
  })

  test("runs the configured verify command only when asked, and refuses on failure", () => {
    const { repo, sha, config, stateFile } = tempRepo()
    const failing = { ...config, verifyCommand: "echo verifier-said-no >&2; exit 7" }
    const result = approve(task(repo, sha), failing, repo, stateFile, deps, { runVerify: true })
    expect(result.ok).toBe(false)
    expect(result.message).toContain("verification failed")
    expect(result.message).toContain("verifier-said-no")
    // Not requested: the same config must not block a plain approval.
    expect(approve(task(repo, sha), failing, repo, stateFile, deps).ok).toBe(true)
  })

  test("approves a landed commit and records the merged outcome", () => {
    const { repo, sha, config, stateFile } = tempRepo()
    const result = approve(task(repo, sha), config, repo, stateFile, deps)
    expect(result.ok).toBe(true)
    expect(result.message).toBe(`approved t1 — merged ${sha.slice(0, 12)} into dev`)
    expect(loadState(stateFile).get("t1")?.status).toBe("merged")
    expect(loadState(stateFile).get("t1")?.reason).toBe("approved by reviewer")
  })
})

describe("reject and cleanupWorktree", () => {
  test("reject records the reviewer reason and keeps the task for a retry", () => {
    const { repo, sha, config, stateFile } = tempRepo()
    const result = reject(task(repo, sha), config, repo, stateFile, "needs a regression test")
    expect(result.ok).toBe(true)
    expect(result.message).toContain("rejected t1")
    const record = loadState(stateFile).get("t1")!
    expect(record.status).toBe("rejected")
    expect(record.reason).toBe("needs a regression test")
    expect(record.commit).toBeUndefined()
  })

  test("reject refuses a task outside review, and cleanup is a safe no-op", () => {
    const { repo, sha, config, stateFile } = tempRepo()
    expect(reject(task(repo, sha, "merged"), config, repo, stateFile, "x").ok).toBe(false)
    expect(cleanupWorktree(repo, task(repo, sha))).toEqual([])
  })
})
