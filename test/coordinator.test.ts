import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "..", "packages", "coordinator", "bin", "coordinator")

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

const git = (dir: string, args: string[], date?: string) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", "-C", dir, ...args], {
    env: date ? { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : GIT_ENV,
    encoding: "utf8",
  })

const run = (dir: string, args: string[]) =>
  spawnSync(SCRIPT, args, { cwd: dir, encoding: "utf8", env: GIT_ENV })

let dir: string

const setup = (checkScript: string) => {
  dir = mkdtempSync(join(tmpdir(), "coordinator-test-"))
  git(dir, ["init", "-q", "-b", "dev"])
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { check: checkScript } }) + "\n")
  mkdirSync(join(dir, ".term", "coordinator"), { recursive: true })
  writeFileSync(join(dir, ".term/coordinator/config.json"), '{"devBranch":"dev","worktreeDir":"worktrees"}\n')
  writeFileSync(join(dir, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}\n')
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-q", "-m", "initial"], "2026-11-01T10:00:00+00:00")
}

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Claim, commit in the wt worktree, submit. Returns the worktree path. */
const claimCommitSubmit = (slug: string, files: Record<string, string>, date: string) => {
  expect(run(dir, ["claim", slug, "--agent", "t", "--paths", "."]).status).toBe(0)
  const wt = join(dir, "worktrees", `wt-${slug}`)
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(wt, rel), content)
  git(wt, ["add", "-A"])
  git(wt, ["commit", "-q", "-m", `work for ${slug}`], date)
  expect(run(wt, ["submit"]).status).toBe(0)
  return wt
}

const lease = (slug: string) =>
  JSON.parse(readFileSync(join(dir, ".term/coordinator/state.json"), "utf8")).leases[slug]

const fileOnDev = (path: string) => spawnSync("git", ["-C", dir, "show", `dev:${path}`], { encoding: "utf8" })

describe("coordinator merge-next", () => {
  test("a branch whose merge fixes the gate is merged (gate runs on the merged result)", () => {
    // dev's `check` fails pre-merge (FIXED absent) and passes post-merge (wt branch adds it).
    setup("test -f FIXED")
    claimCommitSubmit("fix-gate", { FIXED: "yes\n" }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("merged into dev")
    expect(git(dir, ["rev-parse", "dev"]).trim()).not.toBe(devBefore)
    expect(fileOnDev("FIXED").stdout.trim()).toBe("yes")
    expect(lease("fix-gate").status).toBe("done")
  })

  test("a merged result that fails the check aborts; dev and the lease are untouched", () => {
    setup("test -f FIXED")
    claimCommitSubmit("no-fix", { OTHER: "x\n" }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("merged result fails the check")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    expect(fileOnDev("OTHER").status).not.toBe(0)
    expect(lease("no-fix").status).toBe("submitted")
  })

  test("a normal green merge still lands and the lease is marked done", () => {
    setup("true")
    claimCommitSubmit("good", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    expect(fileOnDev("FILE").stdout.trim()).toBe("y")
    expect(lease("good").status).toBe("done")
  })

  test("the main worktree must be clean before merging", () => {
    setup("true")
    claimCommitSubmit("dirty", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    writeFileSync(join(dir, "package.json"), '{"name":"dirty","scripts":{"check":"true"}}\n')
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("uncommitted changes")
    expect(fileOnDev("FILE").status).not.toBe(0)
  })

  test("a post-green checkout failure keeps HEAD on the scratch branch and tells the operator how to finish", () => {
    // The merged result's `check` dirties a file the wt branch adds, so `git checkout dev` must refuse.
    setup("echo dirty >> FILE")
    claimCommitSubmit("stuck", { FILE: "from-wt\n" }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("cannot checkout dev")
    expect(result.stderr).toContain("recovery:")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    // HEAD must not be detached; it stays on the scratch branch holding the verified-green merge.
    const head = git(dir, ["branch", "--show-current"]).trim()
    expect(head).toMatch(/^merge-check-stuck-/)
    expect(git(dir, ["branch", "--list", "merge-check-*"]).trim()).toMatch(/^\*?\s*merge-check-stuck-/)
    expect(lease("stuck").status).toBe("submitted")
  })

  test("the merge-check prune keeps fresh scratch branches and drops stale ones", () => {
    setup("true")
    // Stale scratch: tip commit is the 2026-11-01 initial commit, far older than 60 minutes.
    git(dir, ["branch", "merge-check-stale-1", "dev"])
    // Fresh scratch: tip commit dated now.
    git(dir, ["checkout", "-q", "-b", "merge-check-fresh-1"])
    writeFileSync(join(dir, "fresh.txt"), "x\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "fresh scratch"])
    git(dir, ["checkout", "-q", "dev"])

    claimCommitSubmit("green", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    const remaining = git(dir, ["branch", "--format=%(refname:short)", "--list", "merge-check-*"]).trim()
    expect(remaining).toContain("merge-check-fresh-1")
    expect(remaining).not.toContain("merge-check-stale-1")
  })

  test("a branch recording only .term/coordinator/state.json merges cleanly through the gate", () => {
    setup("true")
    // The bookkeeping branch carries a fabricated record for a PREVIOUS merge — never the lease
    // being merged now (exactly like the real-world record-leases branch).
    const committed = JSON.parse(git(dir, ["show", "dev:.term/coordinator/state.json"]))
    committed.leases["old-record"] = { agent: "t", paths: ".", branch: "wt/old-record", worktree: "worktrees/wt-old-record", status: "done", mergedInto: "dev" }
    claimCommitSubmit("record-clean", { ".term/coordinator/state.json": JSON.stringify(committed, null, 2) }, "2026-11-02T10:00:00+00:00")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("merged into dev")
    // dev gained the bookkeeping entry from the branch...
    expect(fileOnDev(".term/coordinator/state.json").stdout).toContain("\"old-record\"")
    // ...and the exempt dirt (this lease's submitted record) survived the merge, now flipped to done.
    const after = JSON.parse(readFileSync(join(dir, ".term/coordinator/state.json"), "utf8"))
    expect(after.leases["record-clean"].status).toBe("done")
    expect(after.leases["record-clean"].mergedInto).toBe("dev")
    expect(after.leases["record-clean"].submittedAt).toBeTruthy()
    // No stash files leak into the coordinator directory.
    expect(readdirSync(join(dir, ".term", "coordinator")).filter((f: string) => f.startsWith(".state-stash."))).toEqual([])
  })

  test("merge-next auto-commits the state.json bookkeeping on dev", () => {
    setup("true")
    claimCommitSubmit("bookkeep", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    // The lease-flip commit lands on dev itself; the main worktree carries no state.json dirt anymore.
    const log = git(dir, ["log", "--oneline", "-3", "dev"])
    expect(log).toContain("chore(coordinator): record bookkeep lease done after merge")
    expect(fileOnDev(".term/coordinator/state.json").stdout).toContain('"bookkeep"')
    expect(fileOnDev(".term/coordinator/state.json").stdout).toContain('"done"')
    const status = spawnSync("git", ["-C", dir, "status", "--porcelain", "--", ".term/coordinator/state.json"], { encoding: "utf8", env: GIT_ENV }).stdout
    expect(status).toBe("")
  })

  test("a failing merged result restores the exempt state.json dirt and keeps the lease submitted", () => {
    setup("false")
    const committed = JSON.parse(git(dir, ["show", "dev:.term/coordinator/state.json"]))
    committed.leases["old-record"] = { agent: "t", paths: ".", branch: "wt/old-record", worktree: "worktrees/wt-old-record", status: "done", mergedInto: "dev" }
    claimCommitSubmit("record-fail", { ".term/coordinator/state.json": JSON.stringify(committed, null, 2) }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(1)
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    const after = JSON.parse(readFileSync(join(dir, ".term/coordinator/state.json"), "utf8"))
    expect(after.leases["record-fail"].status).toBe("submitted")
    expect(after.leases["record-fail"].submittedAt).toBeTruthy()
    expect(fileOnDev(".term/coordinator/state.json").stdout).not.toContain("\"old-record\"")
    expect(readdirSync(join(dir, ".term", "coordinator")).filter((f: string) => f.startsWith(".state-stash."))).toEqual([])
    // and no scratch branches survive the failed gate.
    expect(git(dir, ["branch", "--list", "merge-check-*"]).trim()).toBe("")
  })

  test("a failed gate run leaves no scratch branches behind", () => {
    setup("test -f FIXED")
    claimCommitSubmit("no-fix-2", { OTHER: "x\n" }, "2026-11-02T10:00:00+00:00")
    run(dir, ["merge-next"])
    const branches = git(dir, ["branch", "--list", "merge-check-*"]).trim()
    expect(branches).toBe("")
    expect(git(dir, ["branch", "--show-current"]).trim()).toBe("dev")
  })
})
