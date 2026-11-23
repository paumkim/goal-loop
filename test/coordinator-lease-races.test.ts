import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
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

const run = (dir: string, args: string[], extraEnv?: Record<string, string>) =>
  spawnSync(SCRIPT, args, { cwd: dir, encoding: "utf8", env: { ...GIT_ENV, ...(extraEnv ?? {}) } })

let dir: string

const setup = (checkScript = "true") => {
  dir = mkdtempSync(join(tmpdir(), "coordinator-races-"))
  git(dir, ["init", "-q", "-b", "dev"])
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { check: checkScript } }) + "\n")
  mkdirSync(join(dir, ".term", "coordinator"), { recursive: true })
  writeFileSync(join(dir, ".term/coordinator/config.json"), '{"devBranch":"dev","worktreeDir":"worktree"}\n')
  writeFileSync(join(dir, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}\n')
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-q", "-m", "initial"], "2026-11-01T10:00:00+00:00")
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const claimCommitSubmit = (slug: string, files: Record<string, string>, date: string, paths = ".") => {
  expect(run(dir, ["claim", slug, "--agent", "t", "--paths", paths]).status).toBe(0)
  const wt = join(dir, "worktree", `wt-${slug}`)
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(wt, rel), content)
  git(wt, ["add", "-A"])
  git(wt, ["commit", "-q", "-m", `work for ${slug}`], date)
  expect(run(wt, ["submit"]).status).toBe(0)
  return wt
}

const lease = (slug: string) =>
  JSON.parse(readFileSync(join(dir, ".term/coordinator/state.json"), "utf8")).leases[slug]

describe("coordinator lease race fixes", () => {
  test("N parallel claims all survive in state.json (no dropped lease)", async () => {
    setup("true")
    const N = 8
    const procs = Array.from({ length: N }, (_, i) =>
      Bun.spawn([SCRIPT, "claim", `slug-${i}`, "--agent", `a${i}`, "--paths", `p${i}/**`], {
        cwd: dir,
        env: GIT_ENV,
        stdout: "pipe",
        stderr: "pipe",
      }),
    )
    const codes = await Promise.all(procs.map((p) => p.exited))
    for (const c of codes) expect(c).toBe(0)
    const state = JSON.parse(readFileSync(join(dir, ".term/coordinator/state.json"), "utf8"))
    for (let i = 0; i < N; i++) {
      expect(state.leases[`slug-${i}`]).toBeTruthy()
      expect(state.leases[`slug-${i}`].status).toBe("claimed")
    }
  })

  test("interleaved claim/submit leaves no writes lost", async () => {
    setup("true")
    for (let i = 0; i < 4; i++) {
      expect(run(dir, ["claim", `a${i}`, "--agent", "t", "--paths", `pa${i}/**`]).status).toBe(0)
    }
    for (let i = 0; i < 4; i++) {
      const wt = join(dir, "worktree", `wt-a${i}`)
      mkdirSync(join(wt, `pa${i}`), { recursive: true })
      writeFileSync(join(wt, `pa${i}`, `f${i}.txt`), "x\n")
      git(wt, ["add", "-A"])
      git(wt, ["commit", "-q", "-m", "c"])
    }
    const ops = [
      ...Array.from({ length: 4 }, (_, i) =>
        Bun.spawn([SCRIPT, "submit"], {
          cwd: join(dir, "worktree", `wt-a${i}`),
          env: GIT_ENV,
          stdout: "pipe",
          stderr: "pipe",
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        Bun.spawn([SCRIPT, "claim", `b${i}`, "--agent", "t", "--paths", `pb${i}/**`], {
          cwd: dir,
          env: GIT_ENV,
          stdout: "pipe",
          stderr: "pipe",
        }),
      ),
    ]
    const codes = await Promise.all(ops.map((p) => p.exited))
    for (const c of codes) expect(c).toBe(0)
    const state = JSON.parse(readFileSync(join(dir, ".term/coordinator/state.json"), "utf8"))
    for (let i = 0; i < 4; i++) {
      expect(state.leases[`a${i}`]?.status).toBe("submitted")
      expect(state.leases[`b${i}`]?.status).toBe("claimed")
    }
  })

  test("a claim racing a submit never erases the other's write (injected write-path sleep)", async () => {
    setup("true")
    expect(run(dir, ["claim", "s", "--agent", "t", "--paths", "ps/**"]).status).toBe(0)
    const wts = join(dir, "worktree", "wt-s")
    mkdirSync(join(wts, "ps"), { recursive: true })
    writeFileSync(join(wts, "ps", "f.txt"), "x\n")
    git(wts, ["add", "-A"])
    git(wts, ["commit", "-q", "-m", "c"])

    const slow = { ...GIT_ENV, COORDINATOR_TEST_STATE_WRITE_SLEEP: "0.2" }
    const claim = Bun.spawn([SCRIPT, "claim", "c", "--agent", "t", "--paths", "pc/**"], {
      cwd: dir,
      env: slow,
      stdout: "pipe",
      stderr: "pipe",
    })
    const submit = Bun.spawn([SCRIPT, "submit"], { cwd: wts, env: slow, stdout: "pipe", stderr: "pipe" })
    const [c1, c2] = await Promise.all([claim.exited, submit.exited])
    expect(c1).toBe(0)
    expect(c2).toBe(0)
    const state = JSON.parse(readFileSync(join(dir, ".term/coordinator/state.json"), "utf8"))
    expect(state.leases["c"]?.status).toBe("claimed")
    expect(state.leases["s"]?.status).toBe("submitted")
  })

  test("merge-next lands caller's lease, not the oldest, unless --target names the other", () => {
    setup("true")
    // older submitted lease
    expect(run(dir, ["claim", "old", "--agent", "t", "--paths", "old.txt"]).status).toBe(0)
    const wtOld = join(dir, "worktree", "wt-old")
    writeFileSync(join(wtOld, "old.txt"), "o\n")
    git(wtOld, ["add", "-A"])
    git(wtOld, ["commit", "-q", "-m", "old"], "2026-11-02T10:00:00+00:00")
    expect(run(wtOld, ["submit"]).status).toBe(0)
    // newer submitted lease
    expect(run(dir, ["claim", "new", "--agent", "t", "--paths", "new.txt"]).status).toBe(0)
    const wtNew = join(dir, "worktree", "wt-new")
    writeFileSync(join(wtNew, "new.txt"), "n\n")
    git(wtNew, ["add", "-A"])
    git(wtNew, ["commit", "-q", "-m", "new"], "2026-11-02T10:01:00+00:00")
    expect(run(wtNew, ["submit"]).status).toBe(0)

    // from caller's (new) context: lands caller, not oldest
    const r1 = run(wtNew, ["merge-next"])
    expect(r1.status).toBe(0)
    expect(lease("new").status).toBe("done")
    expect(lease("old").status).toBe("submitted")

    // explicit --target lands the named other (separate setup: not stale)
    rmSync(dir, { recursive: true, force: true })
    setup("true")
    expect(run(dir, ["claim", "old", "--agent", "t", "--paths", "old.txt"]).status).toBe(0)
    const wtOld2 = join(dir, "worktree", "wt-old")
    writeFileSync(join(wtOld2, "old.txt"), "o\n")
    git(wtOld2, ["add", "-A"])
    git(wtOld2, ["commit", "-q", "-m", "old"], "2026-11-02T10:00:00+00:00")
    expect(run(wtOld2, ["submit"]).status).toBe(0)
    expect(run(dir, ["claim", "new", "--agent", "t", "--paths", "new.txt"]).status).toBe(0)
    const wtNew2 = join(dir, "worktree", "wt-new")
    writeFileSync(join(wtNew2, "new.txt"), "n\n")
    git(wtNew2, ["add", "-A"])
    git(wtNew2, ["commit", "-q", "-m", "new"], "2026-11-02T10:01:00+00:00")
    expect(run(wtNew2, ["submit"]).status).toBe(0)
    const r2 = run(wtNew2, ["merge-next", "--target", "old"])
    expect(r2.status).toBe(0)
    expect(lease("old").status).toBe("done")
    expect(lease("new").status).toBe("submitted")
  })

  test("a stale-base lease aborts with a rebase hint without a half-merge; dev untouched", () => {
    setup("true")
    expect(run(dir, ["claim", "a", "--agent", "t", "--paths", "a.txt"]).status).toBe(0)
    expect(run(dir, ["claim", "b", "--agent", "t", "--paths", "b.txt"]).status).toBe(0)
    const wtA = join(dir, "worktree", "wt-a")
    const wtB = join(dir, "worktree", "wt-b")

    writeFileSync(join(wtA, "a.txt"), "a\n")
    git(wtA, ["add", "-A"])
    git(wtA, ["commit", "-q", "-m", "a"], "2026-11-02T10:00:00+00:00")
    expect(run(wtA, ["submit"]).status).toBe(0)
    expect(run(wtA, ["merge-next"]).status).toBe(0) // dev advances

    writeFileSync(join(wtB, "b.txt"), "b\n")
    git(wtB, ["add", "-A"])
    git(wtB, ["commit", "-q", "-m", "b"], "2026-11-02T10:01:00+00:00")
    expect(run(wtB, ["submit"]).status).toBe(0)

    const devBefore = git(dir, ["rev-parse", "dev"]).trim()
    const r = run(wtB, ["merge-next"])
    expect(r.status).toBe(1)
    expect(`${r.stderr}${r.stdout}`).toContain("rebase")
    expect(`${r.stderr}${r.stdout}`).toMatch(/stale|rebase/i)
    expect(git(dir, ["rev-parse", "dev"]).trim()).toBe(devBefore)
    expect(git(dir, ["branch", "--list", "merge-check-*"]).trim()).toBe("")
    expect(lease("b").status).toBe("submitted")
  })

  test("after any merge, a previously deleted committed key does not reappear in state.json", () => {
    setup("true")
    // Commit state.json on dev with a dead key present.
    const sf = join(dir, ".term", "coordinator", "state.json")
    const st = JSON.parse(readFileSync(sf, "utf8"))
    st.leases["dead"] = {
      agent: "x",
      paths: "x/**",
      branch: "wt/dead",
      worktree: "worktree/wt-dead",
      status: "claimed",
      createdAt: "2026-01-01T00:00:00Z",
    }
    writeFileSync(sf, JSON.stringify(st, null, 2) + "\n")
    git(dir, ["add", ".term/coordinator/state.json"])
    git(dir, ["commit", "-q", "-m", "commit dead key"])

    // Remove dead key from live state (no branch exists, so it must not be resurrected).
    const live = JSON.parse(readFileSync(sf, "utf8"))
    delete live.leases["dead"]
    writeFileSync(sf, JSON.stringify(live, null, 2) + "\n")

    const wt = claimCommitSubmit("real", { f: "x\n" }, "2026-11-02T10:00:00+00:00")
    expect(run(wt, ["merge-next"]).status).toBe(0)
    const after = JSON.parse(readFileSync(sf, "utf8"))
    expect(after.leases["dead"]).toBeUndefined()
    expect(after.leases["real"]?.status).toBe("done")
  })
})
