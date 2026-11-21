import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addWorktree, aheadCount, branchExists, isAncestor, isRepo, removeWorktree, tipAheadOf, trackedDirty } from "../src/prompter/git.ts"

const run = (cwd: string, args: string[]): void => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
}

const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), "prompter-git-"))
  run(repo, ["init", "-q", "-b", "dev"])
  run(repo, ["config", "user.email", "test@example.com"])
  run(repo, ["config", "user.name", "Test"])
  writeFileSync(join(repo, "base.txt"), "base\n")
  run(repo, ["add", "base.txt"])
  run(repo, ["commit", "-q", "-m", "init"])
  return repo
}

describe("git helpers", () => {
  test("detects repos and tracked dirt", () => {
    const repo = makeRepo()
    expect(isRepo(repo)).toBe(true)
    expect(trackedDirty(repo)).toBe("")
    writeFileSync(join(repo, "base.txt"), "changed\n")
    expect(trackedDirty(repo)).toContain("unstaged")
    rmSync(repo, { recursive: true, force: true })
  })

  test("creates an isolated worktree and tracks commits ahead of base", () => {
    const repo = makeRepo()
    const worktree = join(repo, "..", `${repo.split("/").at(-1)}-wt`)
    const branch = "autonomy/test123"
    const added = addWorktree(repo, worktree, branch, "dev")
    expect(added.ok).toBe(true)
    expect(existsSync(join(worktree, "base.txt"))).toBe(true)
    expect(branchExists(repo, branch)).toBe(true)

    writeFileSync(join(worktree, "feature.txt"), "feature\n")
    run(worktree, ["add", "feature.txt"])
    run(worktree, ["commit", "-q", "-m", "feat: add feature"])
    const commit = tipAheadOf(repo, "dev", branch)
    expect(commit).toBeTruthy()
    expect(aheadCount(repo, "dev", branch)).toBe(1)
    expect(isAncestor(repo, commit!, "dev")).toBe(false)

    run(repo, ["merge", "-q", "--no-ff", branch, "-m", "merge test123"])
    expect(isAncestor(repo, commit!, "dev")).toBe(true)
    expect(aheadCount(repo, "dev", branch)).toBe(0)

    removeWorktree(repo, worktree)
    expect(existsSync(worktree)).toBe(false)
    rmSync(repo, { recursive: true, force: true })
  })
})
