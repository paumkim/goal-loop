import { afterEach, describe, expect, test } from "bun:test"
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
  GIT_EDITOR: "true",
}

const git = (dir: string, args: string[], date?: string) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", "-C", dir, ...args], {
    env: date ? { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : GIT_ENV,
    encoding: "utf8",
  })

const gitAllowFail = (dir: string, args: string[]) =>
  spawnSync("git", ["-c", "commit.gpgsign=false", "-C", dir, ...args], { env: GIT_ENV, encoding: "utf8" })

const run = (dir: string, args: string[], extraEnv?: Record<string, string>) =>
  spawnSync(SCRIPT, args, { cwd: dir, encoding: "utf8", env: { ...GIT_ENV, ...(extraEnv ?? {}) } })

let dir: string

const setup = (checkScript: string, extraConfig: Record<string, string> = {}) => {
  dir = mkdtempSync(join(tmpdir(), "coordinator-safety-"))
  git(dir, ["init", "-q", "-b", "dev"])
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { check: checkScript } }) + "\n")
  writeFileSync(join(dir, "tracked.txt"), "base\n")
  mkdirSync(join(dir, ".term", "coordinator"), { recursive: true })
  writeFileSync(
    join(dir, ".term/coordinator/config.json"),
    JSON.stringify({ devBranch: "dev", worktreeDir: "worktrees", ...extraConfig }) + "\n",
  )
  writeFileSync(join(dir, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}\n')
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-q", "-m", "initial"], "2026-11-01T10:00:00+00:00")
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** Claim, write files in the wt worktree, commit, submit. Returns the worktree path. */
const claimCommitSubmit = (slug: string, files: Record<string, string>, date: string, paths = ".") => {
  expect(run(dir, ["claim", slug, "--agent", "t", "--paths", paths]).status).toBe(0)
  const wt = join(dir, "worktrees", `wt-${slug}`)
  for (const [rel, content] of Object.entries(files)) {
    const target = join(wt, rel)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, content)
  }
  git(wt, ["add", "-A"])
  git(wt, ["commit", "-q", "-m", `work for ${slug}`], date)
  expect(run(wt, ["submit"]).status).toBe(0)
  return wt
}

const lease = (slug: string) =>
  JSON.parse(readFileSync(join(dir, ".term/coordinator/state.json"), "utf8")).leases[slug]

const savedRefs = () =>
  git(dir, ["for-each-ref", "--format=%(refname)", "refs/coordinator/saved/"]).trim().split("\n").filter(Boolean)

describe("never destroy uncommitted work (requirement 1)", () => {
  test("merge-next stashes uncommitted bytes into a named ref and prints recovery", () => {
    setup("true")
    const wt = claimCommitSubmit("preserve", { committed: "in\n" }, "2026-11-02T10:00:00+00:00")
    // uncommitted: one untracked file and one modification to a tracked file
    writeFileSync(join(wt, "untracked.txt"), "precious\n")
    writeFileSync(join(wt, "tracked.txt"), "modified\n")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    // the worktree is gone, but the bytes are recoverable from the named ref
    expect(savedRefs().length).toBe(1)
    const ref = savedRefs()[0]!
    // untracked file content lives in the third parent of the stash commit
    expect(git(dir, ["show", `${ref}^3:untracked.txt`])).toBe("precious\n")
    // tracked modification is stashed as the diff between the stash base and index commit
    expect(git(dir, ["diff", `${ref}^1`, `${ref}`, "--", "tracked.txt"])).toContain("+modified")
    // and a real stash apply of the named ref restores both
    git(dir, ["stash", "apply", ref])
    expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("precious\n")
    expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("modified\n")
    // stdin restore: leave main clean for the afterEach cleanup
    git(dir, ["reset", "--hard", "HEAD"])
    rmSync(join(dir, "untracked.txt"), { force: true })
    // recovery instructions were printed
    expect(result.stderr + result.stdout).toMatch(/refs\/coordinator\/saved\/preserve-/)
  })

  test("a failed gate never touches the submitted worktree's uncommitted bytes", () => {
    setup("false")
    const wt = claimCommitSubmit("failed-gate", { other: "x\n" }, "2026-11-02T10:00:00+00:00")
    writeFileSync(join(wt, "still-here.txt"), "bytes\n")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(1)
    expect(readFileSync(join(wt, "still-here.txt"), "utf8")).toBe("bytes\n")
  })

  test("state.json-only dirt is the sanctioned exemption and does not block worktree removal", () => {
    setup("true")
    claimCommitSubmit("exempt", { committed: "y\n" }, "2026-11-02T10:00:00+00:00")
    // dirty the worktree's state.json copy (claim/submit do this by design)
    const wt = join(dir, "worktrees", "wt-exempt")
    writeFileSync(join(wt, ".term/coordinator/state.json"), '{"version":1,"leases":{"exempt":{"agent":"t"}},"mergeLock":null}\n')
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    expect(savedRefs()).toEqual([])
    expect(readdirSync(join(dir, "worktrees")).filter((f) => f === "wt-exempt")).toEqual([])
  })
})

describe("two-phase merge, no silent force (requirement 2)", () => {
  test("--review stops before the fast-forward; merge-done finishes it; merge-abort discards it", () => {
    setup("true")
    claimCommitSubmit("reviewed", { "review.txt": "green\n" }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const review = run(dir, ["merge-next", "--review"])
    expect(review.status).toBe(0)
    expect(review.stdout).toContain("finish:")
    expect(review.stdout).toContain("merge-done reviewed")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    const scratch = git(dir, ["branch", "--format=%(refname:short)", "--list", "merge-check-reviewed-*"]).trim()
    expect(scratch).toMatch(/^merge-check-reviewed-/)
    // lease stays submitted until the human finishes
    expect(lease("reviewed").status).toBe("submitted")
    // the human fast-forwards dev by hand, then merge-done records the lease
    git(dir, ["merge", "--ff-only", scratch])
    const done = run(dir, ["merge-done", "reviewed"])
    expect(done.status).toBe(0)
    expect(lease("reviewed").status).toBe("done")
    expect(git(dir, ["rev-parse", "dev"]).trim()).not.toBe(devBefore)

    // abort path on a fresh lease
    claimCommitSubmit("discarded", { "discard.txt": "x\n" }, "2026-11-03T10:00:00+00:00")
    const review2 = run(dir, ["merge-next", "--review"])
    expect(review2.status).toBe(0)
    expect(review2.stdout).toContain("merge-abort discarded")
    const abort = run(dir, ["merge-abort", "discarded"])
    expect(abort.status).toBe(0)
    expect(lease("discarded").status).toBe("submitted")
    expect(git(dir, ["branch", "--list", "merge-check-discarded-*"]).trim()).toBe("")
  })

  test("any failure leaves dev untouched and prints the exact recovery command", () => {
    setup("test -f FIXED")
    claimCommitSubmit("red-gate", { OTHER: "x\n" }, "2026-11-02T10:00:00+00:00")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("recovery:")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    expect(lease("red-gate").status).toBe("submitted")
  })
})

describe("lease-scoped paths, enforced at submit (requirement 3)", () => {
  test("submit fails when a commit touches files outside the claimed paths", () => {
    setup("true")
    const claim = run(dir, ["claim", "scoped", "--agent", "t", "--paths", "src/only.ts"])
    expect(claim.status).toBe(0)
    const wt = join(dir, "worktrees", "wt-scoped")
    mkdirSync(join(wt, "src"), { recursive: true })
    writeFileSync(join(wt, "src", "only.ts"), "claimed\n")
    writeFileSync(join(wt, "escaped.ts"), "not claimed\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "oops"], "2026-11-02T10:00:00+00:00")
    const submit = run(wt, ["submit"])
    expect(submit.status).toBe(1)
    expect(submit.stderr).toContain("escaped.ts")
    expect(submit.stderr).toContain("submit --force")
    expect(lease("scoped").status).toBe("claimed")
  })

  test("submit --force overrides and logs the override to the lease record", () => {
    setup("true")
    const claim = run(dir, ["claim", "forced", "--agent", "t", "--paths", "src/only.ts"])
    expect(claim.status).toBe(0)
    const wt = join(dir, "worktrees", "wt-forced")
    mkdirSync(join(wt, "src"), { recursive: true })
    writeFileSync(join(wt, "src", "only.ts"), "claimed\n")
    writeFileSync(join(wt, "escaped.ts"), "not claimed\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "oops"], "2026-11-02T10:00:00+00:00")
    const submit = run(wt, ["submit", "--force"])
    expect(submit.status).toBe(0)
    expect(lease("forced").status).toBe("submitted")
    expect(lease("forced").forcedScope).toBe(true)
    expect(lease("forced").forcedScopeFiles).toContain("escaped.ts")
  })

  test("configured shared scopes are allowed for everyone", () => {
    setup("true", { sharedPaths: "SPEC.md,docs/shared/" })
    const claim = run(dir, ["claim", "shared-user", "--agent", "t", "--paths", "src/only.ts"])
    expect(claim.status).toBe(0)
    const wt = join(dir, "worktrees", "wt-shared-user")
    mkdirSync(join(wt, "src"), { recursive: true })
    writeFileSync(join(wt, "src", "only.ts"), "claimed\n")
    writeFileSync(join(wt, "SPEC.md"), "marker\n")
    mkdirSync(join(wt, "docs", "shared"), { recursive: true })
    writeFileSync(join(wt, "docs", "shared", "pool.md"), "shared\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "shared work"], "2026-11-02T10:00:00+00:00")
    const submit = run(wt, ["submit"])
    expect(submit.status).toBe(0)
  })

  test("the default shared scopes include docs/changelog.html (no claim needed, no race)", () => {
    setup("true")
    const claim = run(dir, ["claim", "changelog-touch", "--agent", "t", "--paths", "src/only.ts"])
    expect(claim.status).toBe(0)
    const wt = join(dir, "worktrees", "wt-changelog-touch")
    mkdirSync(join(wt, "src"), { recursive: true })
    writeFileSync(join(wt, "src", "only.ts"), "claimed\n")
    mkdirSync(join(wt, "docs"), { recursive: true })
    writeFileSync(join(wt, "docs", "changelog.html"), "<p>new row</p>\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "changelog row"], "2026-11-02T10:00:00+00:00")
    const submit = run(wt, ["submit"])
    expect(submit.status).toBe(0)
  })

  test("a glob scope matches its subtree and exact files", () => {
    setup("true")
    const claim = run(dir, ["claim", "globbed", "--agent", "t", "--paths", "src/**"])
    expect(claim.status).toBe(0)
    const wt = join(dir, "worktrees", "wt-globbed")
    mkdirSync(join(wt, "src", "deep", "deeper"), { recursive: true })
    writeFileSync(join(wt, "src", "deep", "deeper", "file.ts"), "deep\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "deep"], "2026-11-02T10:00:00+00:00")
    const submit = run(wt, ["submit"])
    expect(submit.status).toBe(0)
  })

  test("submit warns about uncommitted files (they never travel)", () => {
    setup("true")
    const claim = run(dir, ["claim", "warn-uncommitted", "--agent", "t", "--paths", "."])
    expect(claim.status).toBe(0)
    const wt = join(dir, "worktrees", "wt-warn-uncommitted")
    writeFileSync(join(wt, "committed.txt"), "in\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "c"], "2026-11-02T10:00:00+00:00")
    writeFileSync(join(wt, "loose.txt"), "loose\n")
    const submit = run(wt, ["submit"])
    expect(submit.status).toBe(0)
    expect(submit.stderr).toContain("uncommitted")
  })

  test("done leases do not block a fresh claim's path overlap check", () => {
    setup("true")
    claimCommitSubmit("done-already", { "shared.ts": "a\n" }, "2026-11-02T10:00:00+00:00")
    expect(run(dir, ["merge-next"]).status).toBe(0)
    expect(lease("done-already").status).toBe("done")
    const claim = run(dir, ["claim", "next-up", "--agent", "t", "--paths", "shared.ts"])
    expect(claim.status).toBe(0)
  })
})

describe("merge-owned SPEC marker (requirement 4)", () => {
  const specFixture = (reality: { files: number; tests: number }, marker: string) => {
    mkdirSync(join(dir, "scripts"), { recursive: true })
    writeFileSync(
      join(dir, "scripts", "spec-check.ts"),
      `#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(import.meta.dir, "..");
const reality = JSON.parse(readFileSync(join(ROOT, ".reality.json"), "utf8"));
const spec = readFileSync(join(ROOT, "SPEC.md"), "utf8");
const m = spec.match(/<!--\\s*spec-check\\s+files=(\\d+)\\s+tests=(\\d+)\\s*-->/);
const ok = m && Number(m[1]) === reality.files && Number(m[2]) === reality.tests;
if (process.argv.includes("--write")) {
  if (reality.tests < 0) process.exit(1);
  const next = spec.replace(/<!--\\s*spec-check\\s+files=\\d+\\s+tests=\\d+\\s*-->/, \`<!-- spec-check files=\${reality.files} tests=\${reality.tests} -->\`);
  writeFileSync(join(ROOT, "SPEC.md"), next);
  process.exit(0);
}
process.exit(ok ? 0 : 1);
`,
    )
    writeFileSync(join(dir, "SPEC.md"), `# fixture\n\n${marker}\n`)
    writeFileSync(join(dir, ".reality.json"), JSON.stringify(reality) + "\n")
  }

  test("merge-next re-counts the marker on the merged tree; no agent hand-bump; gate goes green", () => {
    setup("bun scripts/spec-check.ts")
    specFixture({ files: 2, tests: 3 }, "<!-- spec-check files=1 tests=1 -->")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "add stale marker + fake spec-check"])
    claimCommitSubmit("marker-flow", { "src/new.ts": "export {}\n" }, "2026-11-02T10:00:00+00:00", "src/**,SPEC.md,scripts/**,.reality.json")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    const devSpec = git(dir, ["show", "dev:SPEC.md"])
    expect(devSpec).toContain("<!-- spec-check files=2 tests=3 -->")
    expect(lease("marker-flow").status).toBe("done")
  })

  test("a red suite in the merged tree aborts before the gate; dev untouched; lease stays submitted", () => {
    setup("bun scripts/spec-check.ts")
    specFixture({ files: 2, tests: -1 }, "<!-- spec-check files=1 tests=1 -->")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "red suite"])
    claimCommitSubmit("marker-red", { "src/new.ts": "export {}\n" }, "2026-11-02T10:00:00+00:00", "src/**,SPEC.md,scripts/**,.reality.json")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("spec-check --write failed")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    expect(lease("marker-red").status).toBe("submitted")
  })
})

describe("merge-owned changelog (parallel docs cannot race)", () => {
  test("merge-next regenerates the changelog on the merged tree and commits it on the scratch branch", () => {
    setup("true")
    mkdirSync(join(dir, "scripts"), { recursive: true })
    writeFileSync(
      join(dir, "scripts", "docs-watch.ts"),
      `#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(import.meta.dir, "..");
const f = join(ROOT, "docs", "changelog.html");
const c = readFileSync(f, "utf8");
writeFileSync(f, c.replace("<!-- changes:end -->", "<tr><td>merged-row</td></tr><!-- changes:end -->"));
`,
    )
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(join(dir, "docs", "changelog.html"), "<!-- changes:start -->\n<!-- changes:end -->\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "docs fixture"])
    claimCommitSubmit("changelog-flow", { "docs/note.md": "x\n" }, "2026-11-02T10:00:00+00:00", "docs/**")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    expect(git(dir, ["show", "dev:docs/changelog.html"])).toContain("merged-row")
    expect(lease("changelog-flow").status).toBe("done")
  })

  test("docs-watch failures abort the merge; dev untouched", () => {
    setup("true")
    mkdirSync(join(dir, "scripts"), { recursive: true })
    writeFileSync(join(dir, "scripts", "docs-watch.ts"), "process.exit(1)\n")
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(join(dir, "docs", "changelog.html"), "<!-- changes:start -->\n<!-- changes:end -->\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "docs fixture broken"])
    claimCommitSubmit("changelog-red", { "docs/note.md": "x\n" }, "2026-11-02T10:00:00+00:00", "docs/**")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("docs-watch once failed")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    expect(lease("changelog-red").status).toBe("submitted")
  })
})

describe("merge locking that survives crashes (requirement 6)", () => {
  test("stale lock reclamation prints the reclaimed holder instead of silently deleting it", () => {
    setup("true")
    mkdirSync(join(dir, ".term", "coordinator", ".merge-lock"), { recursive: true })
    writeFileSync(join(dir, ".term", "coordinator", ".merge-lock-file"), "slug=stuck-merge branch=wt/stuck-merge pid=999 started=2026-11-01T00:00:00Z\n")
    // backdate the lock dir beyond the 60-minute stale window
    execFileSync("touch", ["-d", "3 hours ago", join(dir, ".term", "coordinator", ".merge-lock")])
    claimCommitSubmit("stale-lock-work", { f: "x\n" }, "2026-11-02T10:00:00+00:00", "f")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain("reclaiming stale merge lock")
    expect(result.stderr).toContain("stuck-merge")
    expect(result.stdout).toContain("merged into dev")
  })

  test("a live lock held by another merge is reported with its holder", () => {
    setup("true")
    mkdirSync(join(dir, ".term", "coordinator", ".merge-lock"), { recursive: true })
    writeFileSync(join(dir, ".term", "coordinator", ".merge-lock-file"), "slug=other-merge branch=wt/other-merge pid=123 started=2026-11-16T10:00:00Z\n")
    const result = run(dir, ["claim", "lock-check", "--agent", "t", "--paths", "lock-a"])
    expect(result.status).toBe(0)
    claimCommitSubmit("lock-check-next", { f: "x\n" }, "2026-11-02T10:00:00+00:00", "f")
    const merge = run(dir, ["merge-next"])
    expect(merge.status).toBe(1)
    expect(merge.stderr).toContain("merge lock held")
    expect(merge.stderr).toContain("other-merge")
  })
})

describe("visibility: status, queue, doctor (requirement 7)", () => {
  test("status --json includes per-lease worktree path, uncommitted count and merge flag", () => {
    setup("true")
    claimCommitSubmit("visible", { v: "y\n" }, "2026-11-02T10:00:00+00:00")
    const wt = join(dir, "worktrees", "wt-visible")
    writeFileSync(join(wt, "loose.txt"), "loose\n")
    const result = run(dir, ["status", "--json"])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.leases["visible"].worktreePath).toBe(wt)
    expect(parsed.leases["visible"].uncommitted).toBe(1)
    expect(parsed.leases["visible"].mergeInProgress).toBe(false)
  })

  test("queue is FIFO with position and ETA", () => {
    setup("true")
    claimCommitSubmit("queue-a", { a: "1\n" }, "2026-11-02T10:00:00+00:00", "a")
    claimCommitSubmit("queue-b", { b: "2\n" }, "2026-11-02T11:00:00+00:00", "b")
    const result = run(dir, ["queue", "--json"])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.queue.map((e: { slug: string }) => e.slug)).toEqual(["queue-a", "queue-b"])
    expect(parsed.queue[0].position).toBe(1)
    expect(parsed.queue[1].position).toBe(2)
    expect(parsed.queue[1].etaSeconds).toBeGreaterThan(parsed.queue[0].etaSeconds)
    // human output names the FIFO order too
    const human = run(dir, ["queue"])
    expect(human.stdout).toContain("merge queue")
  })

  test("doctor passes on a healthy repo and fails on a dirty main checkout", () => {
    setup("true")
    const healthy = run(dir, ["doctor"])
    expect(healthy.status).toBe(0)
    // dirty the main checkout's tracked file
    writeFileSync(join(dir, "tracked.txt"), "tampered\n")
    const sick = run(dir, ["doctor"])
    expect(sick.status).toBe(1)
    expect(sick.stdout).toContain("FAIL")
  })

  test("doctor fails when a done lease leaves a worktree behind", () => {
    setup("true")
    claimCommitSubmit("doctor-done", { d: "y\n" }, "2026-11-02T10:00:00+00:00")
    // simulate a leftover: flip the lease to done by hand without removing the worktree
    const stateFile = join(dir, ".term", "coordinator", "state.json")
    const state = JSON.parse(readFileSync(stateFile, "utf8"))
    state.leases["doctor-done"].status = "done"
    writeFileSync(stateFile, JSON.stringify(state) + "\n")
    const sick = run(dir, ["doctor"])
    expect(sick.status).toBe(1)
    expect(sick.stdout).toContain("done lease doctor-done")
  })
})

describe("scratch-branch cleanup (merge-next)", () => {
  test("a green merge leaves no merge-check-* scratch branch behind (worktree is removed first)", () => {
    setup("true")
    claimCommitSubmit("scratch-cleanup", { f: "x\n" }, "2026-11-02T10:00:00+00:00")
    const result = run(dir, ["merge-next"])
    expect(result.status).toBe(0)
    expect(git(dir, ["branch", "--format=%(refname:short)", "--list", "merge-check-*"]).trim()).toBe("")
    expect(readdirSync(join(dir, "worktrees")).filter((f) => f.startsWith("wt-merge-check-"))).toEqual([])
  })
})

describe("two agents, overlapping scopes, conflicting edits (requirement 8)", () => {
  test("no red merge, no lost bytes, loser gets a rebase path, winner lands green", () => {
    // released shared file both agents edit; the gate only passes once it contains "good"
    setup("grep -q good src/shared.txt")
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "src/shared.txt"), "good\nbase\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "shared base"], "2026-11-01T12:00:00+00:00")

    // agent A claims the shared scope and makes a green change
    expect(run(dir, ["claim", "agent-a", "--agent", "agent-a", "--paths", "src/**,SPEC.md"]).status).toBe(0)
    const wtA = join(dir, "worktrees", "wt-agent-a")
    writeFileSync(join(wtA, "src/shared.txt"), "good\nalpha\n")
    git(wtA, ["add", "-A"])
    git(wtA, ["commit", "-q", "-m", "alpha"], "2026-11-02T09:00:00+00:00")

    // agent B claims the same shared scope (forced: paths overlap) and makes a conflicting change
    expect(run(dir, ["claim", "agent-b", "--agent", "agent-b", "--paths", "src/**,SPEC.md", "--force"]).status).toBe(0)
    const wtB = join(dir, "worktrees", "wt-agent-b")
    writeFileSync(join(wtB, "src/shared.txt"), "good\nbeta\n")
    git(wtB, ["add", "-A"])
    git(wtB, ["commit", "-q", "-m", "beta"], "2026-11-02T10:00:00+00:00")
    // B also has uncommitted work in flight — the incident's exact scenario
    writeFileSync(join(wtB, "uncommitted-b.txt"), "half-finished redesign\n")

    // A submits and merges; lands green
    expect(run(wtA, ["submit"]).status).toBe(0)
    const mergeA = run(dir, ["merge-next"])
    expect(mergeA.status).toBe(0)
    expect(git(dir, ["show", "dev:src/shared.txt"])).toContain("alpha")

    // B submits; the merge conflicts (same file, same region); dev untouched; B's bytes intact
    expect(run(wtB, ["submit"]).status).toBe(0)
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const mergeB = run(dir, ["merge-next"])
    expect(mergeB.status).toBe(1)
    expect(mergeB.stderr).toContain("merge conflict")
    expect(mergeB.stderr).toContain("rebase")
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    expect(readFileSync(join(wtB, "uncommitted-b.txt"), "utf8")).toBe("half-finished redesign\n")
    expect(lease("agent-b").status).toBe("submitted")

    // B follows the printed recovery: rebase onto dev, resolve, re-run the gate, merge again
    const rebase = gitAllowFail(wtB, ["rebase", "dev"])
    expect(rebase.status).not.toBe(0) // conflicts, as expected
    writeFileSync(join(wtB, "src/shared.txt"), "good\nalpha-and-beta\n")
    git(wtB, ["add", "src/shared.txt"])
    git(wtB, ["-c", "core.editor=true", "rebase", "--continue"])
    // the gate in B's worktree passes before the re-merge
    expect(spawnSync("grep", ["-q", "good", join(wtB, "src/shared.txt")]).status).toBe(0)
    const mergeB2 = run(dir, ["merge-next"])
    expect(mergeB2.status).toBe(0)
    expect(git(dir, ["show", "dev:src/shared.txt"])).toContain("alpha-and-beta")
    expect(lease("agent-b").status).toBe("done")
    // B's half-finished redesign survived the whole pipeline, recoverable from the named ref
    expect(savedRefs().some((r) => r.includes("agent-b-"))).toBe(true)
    const ref = savedRefs().find((r) => r.includes("agent-b-"))!
    expect(git(dir, ["show", `${ref}^3:uncommitted-b.txt`])).toBe("half-finished redesign\n")
  })

  test("a red-gate merge from a conflicting agent never moves dev", () => {
    setup("grep -q good src/red.txt")
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "src/red.txt"), "good\nbase\n")
    git(dir, ["add", "-A"])
    git(dir, ["commit", "-q", "-m", "base"], "2026-11-01T12:00:00+00:00")
    claimCommitSubmit("red-agent", { "src/red.txt": "bad work\n" }, "2026-11-02T10:00:00+00:00", "src/**")
    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const merge = run(dir, ["merge-next"])
    expect(merge.status).toBe(1)
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    expect(lease("red-agent").status).toBe("submitted")
    // and a follow-up good merge lands after the red one is fixed on the branch
    const wt = join(dir, "worktrees", "wt-red-agent")
    writeFileSync(join(wt, "src/red.txt"), "good\nfixed\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "fix to green"], "2026-11-02T11:00:00+00:00")
    const merge2 = run(dir, ["merge-next"])
    expect(merge2.status).toBe(0)
    expect(lease("red-agent").status).toBe("done")
    expect(git(dir, ["show", "dev:src/red.txt"])).toContain("fixed")
  })
})
