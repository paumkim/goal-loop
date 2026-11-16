import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { branchExists, currentBranch, detectCoordinator, findRepository, headSha, resolveCommitPolicy } from "../src/core/git.ts"

/** A throwaway directory that is removed when the test ends. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "goal-git-"))
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A repository with the given branches and a HEAD pointing at `head`. */
function repo(branches: string[], head: string): string {
  const dir = scratch()
  const git = join(dir, ".git")
  mkdirSync(join(git, "refs", "heads"), { recursive: true })
  for (const branch of branches) writeFileSync(join(git, "refs", "heads", branch), "0".repeat(40))
  writeFileSync(join(git, "HEAD"), `ref: refs/heads/${head}\n`)
  return dir
}

describe("findRepository", () => {
  test("finds the repository from a nested directory", () => {
    const root = repo(["dev"], "dev")
    const nested = join(root, "packages", "app")
    mkdirSync(nested, { recursive: true })
    expect(findRepository(nested)?.root).toBe(root)
  })
  test("no repository outside one", () => {
    expect(findRepository(scratch())).toBeUndefined()
  })
  test("a worktree pointer file resolves to the real git directory", () => {
    const root = scratch()
    const real = join(root, "real-git")
    mkdirSync(join(real, "refs", "heads"), { recursive: true })
    writeFileSync(join(real, "refs", "heads", "dev"), "0".repeat(40))
    writeFileSync(join(real, "HEAD"), "ref: refs/heads/dev\n")
    const worktree = join(root, "worktree")
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, ".git"), `gitdir: ${real}\n`)
    expect(findRepository(worktree)?.gitDir).toBe(real)
  })
})

describe("currentBranch", () => {
  test("reads the branch HEAD points at", () => {
    expect(currentBranch(join(repo(["main"], "main"), ".git"))).toBe("main")
  })
  test("undefined when HEAD is detached", () => {
    const root = repo(["main"], "main")
    writeFileSync(join(root, ".git", "HEAD"), "0".repeat(40) + "\n")
    expect(currentBranch(join(root, ".git"))).toBeUndefined()
  })
})

describe("branchExists", () => {
  test("finds a loose branch", () => {
    expect(branchExists(join(repo(["dev"], "dev"), ".git"), "dev")).toBe(true)
    expect(branchExists(join(repo(["dev"], "dev"), ".git"), "main")).toBe(false)
  })
  test("finds a packed branch", () => {
    const root = repo([], "main")
    writeFileSync(join(root, ".git", "packed-refs"), `${"0".repeat(40)} refs/heads/dev\n`)
    expect(branchExists(join(root, ".git"), "dev")).toBe(true)
  })
})

describe("resolveCommitPolicy", () => {
  test("the rule applies inside a repository that has the branch", () => {
    const root = repo(["dev", "main"], "main")
    const policy = resolveCommitPolicy({ enabled: true, branch: "dev" }, root)
    expect(policy.required).toBe(true)
    expect(policy.branch).toBe("dev")
  })
  test("the rule is off outside a repository", () => {
    const policy = resolveCommitPolicy({ enabled: true, branch: "dev" }, scratch())
    expect(policy.required).toBe(false)
    expect(policy.reason).toBe("not a git repository")
  })
  test("the rule is off when it is turned off", () => {
    const root = repo(["dev"], "dev")
    const policy = resolveCommitPolicy({ enabled: false, branch: "dev" }, root)
    expect(policy.required).toBe(false)
    expect(policy.reason).toBe("disabled by configuration")
  })
  test("a branch the repository does not have falls back to the checked out one", () => {
    const root = repo(["main"], "main")
    const policy = resolveCommitPolicy({ enabled: true, branch: "dev" }, root)
    expect(policy.required).toBe(true)
    expect(policy.branch).toBe("main")
  })
  test("a coordinator repo resolves to coordinator mode on auto", () => {
    const root = repo(["dev", "main"], "dev")
    mkdirSync(join(root, ".term", "coordinator"), { recursive: true })
    writeFileSync(join(root, ".term/coordinator/config.json"), '{"devBranch":"dev","worktreeDir":"worktrees"}')
    writeFileSync(join(root, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}')
    mkdirSync(join(root, "packages/coordinator/bin"), { recursive: true })
    writeFileSync(join(root, "packages/coordinator/bin/coordinator"), "#!/bin/sh\n")
    const policy = resolveCommitPolicy({ enabled: true, branch: "dev", coordinator: "auto" }, root)
    expect(policy.required).toBe(true)
    expect(policy.mode).toBe("coordinator")
    expect(policy.branch).toBe("dev")
    expect(policy.coordinatorBin?.endsWith("packages/coordinator/bin/coordinator")).toBe(true)
    expect(policy.coordinatorBin).toBe(join(root, "packages/coordinator/bin/coordinator"))
    expect(policy.worktreeDir).toBe("worktrees")
  })
  test("detectCoordinator needs two markers", () => {
    const root = repo(["dev"], "dev")
    mkdirSync(join(root, ".term/coordinator"), { recursive: true })
    writeFileSync(join(root, ".term/coordinator/config.json"), '{"devBranch":"dev"}')
    expect(detectCoordinator(root)).toBeUndefined()
    writeFileSync(join(root, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}')
    expect(detectCoordinator(root)?.devBranch).toBe("dev")
    expect(dirname(root)).not.toBe(root)
  })
  test("coordinator: false disables coordinator mode even with markers", () => {
    const root = repo(["dev", "main"], "dev")
    mkdirSync(join(root, ".term/coordinator"), { recursive: true })
    writeFileSync(join(root, ".term/coordinator/config.json"), '{"devBranch":"dev"}')
    writeFileSync(join(root, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}')
    const policy = resolveCommitPolicy({ enabled: true, branch: "dev", coordinator: false }, root)
    expect(policy.mode).toBe("direct")
    expect(policy.branch).toBe("dev")
  })
  test("coordinator: true forces coordinator mode without markers", () => {
    const root = repo(["dev"], "dev")
    const policy = resolveCommitPolicy({ enabled: true, branch: "dev", coordinator: true }, root)
    expect(policy.mode).toBe("coordinator")
    expect(policy.branch).toBe("dev")
  })
})
describe("headSha", () => {
  test("resolves attached (loose then packed), detached and missing HEADs; never throws", () => {
    // attached with a loose ref
    const loose = repo(["dev"], "dev")
    writeFileSync(join(loose, ".git", "refs", "heads", "dev"), "a".repeat(40) + "\n")
    expect(headSha(join(loose, ".git"))).toBe("a".repeat(40))
    // attached with a packed ref only
    const packed = repo([], "dev")
    writeFileSync(join(packed, ".git", "packed-refs"), "# pack-refs with: peeled fully-peeled sorted\n" + "b".repeat(40) + " refs/heads/dev\n")
    expect(headSha(join(packed, ".git"))).toBe("b".repeat(40))
    // detached HEAD
    const detached = repo(["main"], "main")
    writeFileSync(join(detached, ".git", "HEAD"), "c".repeat(40) + "\n")
    expect(headSha(join(detached, ".git"))).toBe("c".repeat(40))
    // HEAD points at a ref that exists nowhere -> undefined (never a guess)
    expect(headSha(join(repo(["other"], "missing"), ".git"))).toBeUndefined()
    // unreadable directory -> undefined, not a throw
    expect(headSha(join(scratch(), ".git"))).toBeUndefined()
  })
})
