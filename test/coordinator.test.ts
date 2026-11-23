import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"
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
  writeFileSync(join(dir, ".term/coordinator/config.json"), '{"devBranch":"dev","worktreeDir":"worktree"}\n')
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
  const wt = join(dir, "worktree", `wt-${slug}`)
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
    const wt = claimCommitSubmit("fix-gate", { FIXED: "yes\n" }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(wt, ["merge-next"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("merged into dev")
    expect(git(dir, ["rev-parse", "dev"]).trim()).not.toBe(devBefore)
    expect(fileOnDev("FIXED").stdout.trim()).toBe("yes")
    expect(lease("fix-gate").status).toBe("done")
  })

  test("a merged result that fails the check aborts; dev and the lease are untouched", () => {
    setup("test -f FIXED")
    const wt = claimCommitSubmit("no-fix", { OTHER: "x\n" }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(wt, ["merge-next"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("merged result fails the check")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    expect(fileOnDev("OTHER").status).not.toBe(0)
    expect(lease("no-fix").status).toBe("submitted")
  })

  test("a normal green merge still lands and the lease is marked done", () => {
    setup("true")
    const wt = claimCommitSubmit("good", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    const result = run(wt, ["merge-next"])
    expect(result.status).toBe(0)
    expect(fileOnDev("FILE").stdout.trim()).toBe("y")
    expect(lease("good").status).toBe("done")
  })

  test("the main worktree must be clean before merging", () => {
    setup("true")
    const wt = claimCommitSubmit("dirty", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    writeFileSync(join(dir, "package.json"), '{"name":"dirty","scripts":{"check":"true"}}\n')
    const result = run(wt, ["merge-next"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("uncommitted changes")
    expect(fileOnDev("FILE").status).not.toBe(0)
  })

  test("a fast-forward failure leaves dev untouched, keeps the verified scratch branch, and prints the recovery command", () => {
    // The verify-then-fast-forward split is explicit: when the fast-forward cannot happen,
    // the merged result stays on merge-check-* and dev never moves. Simulated deterministically
    // with the documented COORDINATOR_TEST_FF_FAIL hook (the old "check dirties a file" scenario
    // cannot strand the main checkout anymore — the gate runs in a dedicated merge worktree).
    setup("true")
    const wt = claimCommitSubmit("stuck", { FILE: "from-wt\n" }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = spawnSync(SCRIPT, ["merge-next"], {
      cwd: wt,
      encoding: "utf8",
      env: { ...GIT_ENV, COORDINATOR_TEST_FF_FAIL: "1" },
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("cannot fast-forward dev")
    expect(result.stderr).toContain("recovery:")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    // HEAD never left dev (merge work happens in a dedicated worktree now).
    expect(git(dir, ["branch", "--show-current"]).trim()).toBe("dev")
    // The verified-green merged result is kept on the scratch branch for manual recovery.
    expect(git(dir, ["branch", "--list", "--format=%(refname:short)", "merge-check-stuck-*"]).trim()).toMatch(/^merge-check-stuck-/)
    expect(lease("stuck").status).toBe("submitted")
    // finishing by hand works: fast-forward dev, then merge-done records the lease
    const scratch = git(dir, ["branch", "--format=%(refname:short)", "--list", "merge-check-stuck-*"]).trim()
    git(dir, ["merge", "--ff-only", scratch])
    const done = run(dir, ["merge-done", "stuck"])
    expect(done.status).toBe(0)
    expect(lease("stuck").status).toBe("done")
    expect(fileOnDev("FILE").stdout.trim()).toBe("from-wt")
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

    const wtGreen = claimCommitSubmit("green", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    const result = run(wtGreen, ["merge-next"])
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
    committed.leases["old-record"] = { agent: "t", paths: ".", branch: "wt/old-record", worktree: "worktree/wt-old-record", status: "done", mergedInto: "dev" }
    const wtRc = claimCommitSubmit("record-clean", { ".term/coordinator/state.json": JSON.stringify(committed, null, 2) }, "2026-11-02T10:00:00+00:00")
    const result = run(wtRc, ["merge-next"])
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
    const wtBk = claimCommitSubmit("bookkeep", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    const result = run(wtBk, ["merge-next"])
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
    committed.leases["old-record"] = { agent: "t", paths: ".", branch: "wt/old-record", worktree: "worktree/wt-old-record", status: "done", mergedInto: "dev" }
    const wtRf = claimCommitSubmit("record-fail", { ".term/coordinator/state.json": JSON.stringify(committed, null, 2) }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(wtRf, ["merge-next"])
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
    const wtNf2 = claimCommitSubmit("no-fix-2", { OTHER: "x\n" }, "2026-11-02T10:00:00+00:00")
    run(wtNf2, ["merge-next"])
    const branches = git(dir, ["branch", "--list", "merge-check-*"]).trim()
    expect(branches).toBe("")
    expect(git(dir, ["branch", "--show-current"]).trim()).toBe("dev")
  })
})

describe("coordinator scope parsing and scratch selection", () => {
  test("claim canonicalizes whitespace-separated --paths to comma-joined", () => {
    setup("true")
    expect(run(dir, ["claim", "canon", "--agent", "t", "--paths", "src/**   test/**"]).status).toBe(0)
    expect(lease("canon").paths).toBe("src/**,test/**")
  })

  test("submit enforces whitespace-separated claimed scopes (space-separated paths in state.json)", () => {
    setup("true")
    expect(run(dir, ["claim", "spaced", "--agent", "t", "--paths", "src/** test/**"]).status).toBe(0)
    const wt = join(dir, "worktree", "wt-spaced")
    mkdirSync(join(wt, "src"), { recursive: true })
    mkdirSync(join(wt, "test"), { recursive: true })
    writeFileSync(join(wt, "src", "a.ts"), "export const a = 1\n")
    writeFileSync(join(wt, "test", "b.test.ts"), "export const b = 1\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "in scope work"], "2026-11-02T10:00:00+00:00")
    expect(run(wt, ["submit"]).status).toBe(0)
    expect(lease("spaced").status).toBe("submitted")
  })

  test("submit detects out-of-scope files in a multi-root repo with no dev branch", () => {
    dir = mkdtempSync(join(tmpdir(), "coordinator-multiroot-"))
    git(dir, ["init", "-q", "-b", "main"])
    writeFileSync(join(dir, "root-one.txt"), "one\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "root one"], "2026-11-01T10:00:00+00:00")
    git(dir, ["checkout", "-q", "--orphan", "other"])
    git(dir, ["rm", "-q", "-r", "-f", "."])
    writeFileSync(join(dir, "root-two.txt"), "two\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "root two"], "2026-11-02T10:00:00+00:00")
    git(dir, ["checkout", "-q", "main"])
    git(dir, ["merge", "-q", "--no-edit", "--allow-unrelated-histories", "-m", "merge two roots", "other"])
    mkdirSync(join(dir, ".term", "coordinator"), { recursive: true })
    writeFileSync(join(dir, ".term/coordinator/config.json"), '{"devBranch":"dev","worktreeDir":"worktree"}\n')
    writeFileSync(join(dir, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}\n')
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "unrelated-history merge fixture"], "2026-11-03T10:00:00+00:00")
    expect(run(dir, ["claim", "multiroot", "--agent", "t", "--paths", "SPEC.md"]).status).toBe(0)
    const wt = join(dir, "worktree", "wt-multiroot")
    writeFileSync(join(wt, "totally-out-of-scope.ts"), "export const x = 1\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "out of scope work"], "2026-11-04T10:00:00+00:00")
    const result = run(wt, ["submit"])
    expect(result.status).toBe(1)
    expect(`${result.stderr}${result.stdout}`).toContain("outside the claimed paths")
  })

  test("merge-done accepts a newer scratch branch, not only the oldest leftover", () => {
    setup("true")
    const wtMulti = claimCommitSubmit("multi", { FILE: "x\n" }, "2026-11-02T10:00:00+00:00")
    expect(run(wtMulti, ["merge-next", "--review"]).status).toBe(0)
    expect(run(wtMulti, ["merge-next", "--review"]).status).toBe(0) // second pass: lease still submitted, a newer scratch is created
    const scratches = git(dir, ["branch", "--list", "merge-check-multi-*", "--sort=-committerdate"])
      .trim().split("\n").map((l) => l.trim()).filter(Boolean)
    expect(scratches.length).toBe(2)
    git(dir, ["merge", "-q", "--ff-only", scratches[0] as string]) // dev fast-forwards onto the NEWEST scratch
    const done = run(dir, ["merge-done", "multi"])
    expect(done.status).toBe(0)
    expect(lease("multi").status).toBe("done")
  })
})

describe("coordinator release", () => {
  test("releasing an idle claim unblocks an overlapping claim", () => {
    setup("true")
    expect(run(dir, ["claim", "idle", "--agent", "t", "--paths", "src"]).status).toBe(0)
    const blocked = run(dir, ["claim", "other", "--agent", "t", "--paths", "src"])
    expect(blocked.status).toBe(1)
    expect(blocked.stderr).toContain("path overlap with idle")

    const released = run(dir, ["release", "idle"])
    expect(released.status).toBe(0)
    expect(released.stdout).toContain("released idle")
    const idle = lease("idle")
    expect(idle.status).toBe("done")
    expect(idle.releaseReason).toBe("released")
    expect(idle.releasedAt).toBeTruthy()
    expect(existsSync(join(dir, "worktree", "wt-idle"))).toBe(false)
    expect(git(dir, ["branch", "--list", "wt/idle"]).trim()).toBe("")

    // the same claim that was rejected now succeeds without --force
    expect(run(dir, ["claim", "other", "--agent", "t", "--paths", "src"]).status).toBe(0)
  })

  test("uncommitted work is refused without --force and preserved in a ref with it", () => {
    setup("true")
    expect(run(dir, ["claim", "busy", "--agent", "t", "--paths", "."]).status).toBe(0)
    const wt = join(dir, "worktree", "wt-busy")
    writeFileSync(join(wt, "half-done.ts"), "export const half = 1\n")

    const refused = run(dir, ["release", "busy"])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain("unsubmitted work")
    expect(lease("busy").status).toBe("claimed")
    expect(existsSync(wt)).toBe(true)

    const forced = run(dir, ["release", "busy", "--force"])
    expect(forced.status).toBe(0)
    expect(lease("busy").status).toBe("done")
    expect(existsSync(wt)).toBe(false)
    const saved = git(dir, ["for-each-ref", "--format=%(refname)", "refs/coordinator/saved/"]).trim()
    expect(saved).toContain("refs/coordinator/saved/busy-")
    expect(git(dir, ["stash", "list"])).toContain("coordinator: uncommitted work for lease busy")
  })

  test("a branch with unique commits is kept and the recovery command printed", () => {
    setup("true")
    expect(run(dir, ["claim", "wip", "--agent", "t", "--paths", "."]).status).toBe(0)
    const wt = join(dir, "worktree", "wt-wip")
    writeFileSync(join(wt, "wip.txt"), "wip\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "wip"], "2026-11-02T10:00:00+00:00")

    expect(run(dir, ["release", "wip"]).status).toBe(1)
    const forced = run(dir, ["release", "wip", "--force"])
    expect(forced.status).toBe(0)
    expect(forced.stdout).toContain("kept branch wt/wip")
    expect(forced.stdout).toContain("worktree add")
    expect(git(dir, ["branch", "--list", "wt/wip"]).trim()).toContain("wt/wip")
    expect(existsSync(wt)).toBe(false)
    expect(lease("wip").status).toBe("done")
  })

  test("a submitted lease is refused (merge-next or merge-abort owns it)", () => {
    setup("true")
    claimCommitSubmit("done-work", { FILE: "y\n" }, "2026-11-02T10:00:00+00:00")
    const result = run(dir, ["release", "done-work"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("is submitted")
    expect(lease("done-work").status).toBe("submitted")
  })

  test("releasing again is idempotent, wt/<slug> is accepted, and an unknown slug errors", () => {
    setup("true")
    expect(run(dir, ["claim", "idle-2", "--agent", "t", "--paths", "."]).status).toBe(0)
    expect(run(dir, ["release", "wt/idle-2"]).status).toBe(0)
    const again = run(dir, ["release", "idle-2"])
    expect(again.status).toBe(0)
    expect(again.stdout).toContain("already done")
    expect(run(dir, ["release", "nope"]).status).toBe(1)
  })

  test("a claimed lease whose worktree is missing is still releasable", () => {
    setup("true")
    expect(run(dir, ["claim", "ghost", "--agent", "t", "--paths", "."]).status).toBe(0)
    git(dir, ["worktree", "remove", join(dir, "worktree", "wt-ghost")])
    const result = run(dir, ["release", "ghost"])
    expect(result.status).toBe(0)
    expect(lease("ghost").status).toBe("done")
  })

  test("a released idle claim leaves doctor green", () => {
    setup("true")
    expect(run(dir, ["claim", "idle-3", "--agent", "t", "--paths", "."]).status).toBe(0)
    expect(run(dir, ["doctor"]).status).toBe(0)
    expect(run(dir, ["release", "idle-3"]).status).toBe(0)
    const doc = run(dir, ["doctor"])
    expect(doc.status).toBe(0)
    expect(doc.stdout).not.toContain("done lease idle-3")
  })
})

describe("coordinator help discoverability", () => {
  test("top-level help advertises merge-next --target", () => {
    setup("true")
    const help = run(dir, ["--help"])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain("merge-next [<slug>|--target <slug>] [--review]")
    expect(help.stdout).toContain("--target names a lease from the main repo")
  })
})
