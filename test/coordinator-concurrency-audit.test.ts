import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
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

const run = (dir: string, args: string[], extraEnv?: Record<string, string>) =>
  spawnSync(SCRIPT, args, { cwd: dir, encoding: "utf8", env: { ...GIT_ENV, ...(extraEnv ?? {}) } })

const runAsync = (dir: string, args: string[], extraEnv?: Record<string, string>) => {
  const child = spawn(SCRIPT, args, { cwd: dir, env: { ...GIT_ENV, ...(extraEnv ?? {}) } })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => (stdout += String(chunk)))
  child.stderr.on("data", (chunk) => (stderr += String(chunk)))
  const done = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on("close", (status) => resolve({ status, stdout, stderr }))
  })
  return { child, done }
}

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const setup = (withState = true) => {
  dir = mkdtempSync(join(tmpdir(), "coordinator-audit-"))
  git(dir, ["init", "-q", "-b", "dev"])
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { check: "true" } }) + "\n")
  writeFileSync(join(dir, "tracked.txt"), "base\n")
  mkdirSync(join(dir, ".term", "coordinator"), { recursive: true })
  writeFileSync(join(dir, ".term/coordinator/config.json"), JSON.stringify({ devBranch: "dev", worktreeDir: "worktree" }) + "\n")
  if (withState) writeFileSync(join(dir, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}\n')
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-q", "-m", "initial"], "2026-11-01T10:00:00+00:00")
}

const claimCommitSubmit = (slug: string, files: Record<string, string>) => {
  expect(run(dir, ["claim", slug, "--agent", "t", "--paths", "."]).status).toBe(0)
  const wt = join(dir, "worktree", `wt-${slug}`)
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(wt, rel), content)
  git(wt, ["add", "-A"])
  git(wt, ["commit", "-q", "-m", `work for ${slug}`], "2026-11-02T10:00:00+00:00")
  expect(run(wt, ["submit"]).status).toBe(0)
  return wt
}

const lease = (slug: string) =>
  JSON.parse(readFileSync(join(dir, ".term", "coordinator", "state.json"), "utf8")).leases[slug]

const dataDir = () => join(dir, ".term", "coordinator")

describe("concurrency audit: merge lock lifecycle", () => {
  test("merge-status dead-pid recommendation and merge-next reclaim use the same staleness predicate", () => {
    setup()
    const started = new Date(Date.now() - 10_000).toISOString()
    const holder = `slug=dead-merge branch=wt/dead-merge pid=999999 started=${started}\n`
    mkdirSync(join(dataDir(), ".merge-lock"), { recursive: true })
    writeFileSync(join(dataDir(), ".merge-lock", "holder"), holder)
    writeFileSync(join(dataDir(), ".merge-lock-file"), holder)
    // The lock dir is fresh but the holder pid is dead: status must say "safe to retry".
    const status = JSON.parse(run(dir, ["merge-status"]).stdout)
    expect(status.recommendation).toContain("dead pid")
    const wt = claimCommitSubmit("reclaim-dead", { "x.txt": "x\n" })
    const result = run(wt, ["merge-next"])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain("reclaiming stale merge lock")
    expect(result.stderr).toContain("dead-merge")
    expect(lease("reclaim-dead").status).toBe("done")
  })

  test("the flock target keeps its inode across a merge (no unlink -> no split-brain lock)", () => {
    setup()
    const lockFile = join(dataDir(), ".merge-lock-file")
    writeFileSync(lockFile, "")
    const before = statSync(lockFile).ino
    const wt = claimCommitSubmit("inode-stable", { "f.txt": "f\n" })
    const result = run(wt, ["merge-next"])
    expect(result.status).toBe(0)
    // Unlinking and recreating the file gives followers a different inode to flock on.
    expect(statSync(lockFile).ino).toBe(before)
  })

  test("concurrent merge-status never reads a torn holder line", async () => {
    setup()
    const holderFile = join(dataDir(), ".merge-lock", "holder")
    const wt = claimCommitSubmit("atomic-holder", { "h.txt": "h\n" })
    const running = runAsync(wt, ["merge-next"], { COORDINATOR_TEST_HOLDER_WRITE_SLEEP: "1" })
    // Wait for the holder write to start, then sample it while the holder process is paused.
    const lockDir = join(dataDir(), ".merge-lock")
    const writeStarted = () => existsSync(holderFile) || (existsSync(lockDir) && readdirSync(lockDir).some((n) => n.startsWith(".holder.")))
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline && !writeStarted()) await new Promise((r) => setTimeout(r, 10))
    const samples: string[] = []
    for (let i = 0; i < 20; i++) {
      if (existsSync(holderFile)) samples.push(readFileSync(holderFile, "utf8"))
      await new Promise((r) => setTimeout(r, 10))
    }
    const result = await running.done
    expect(result.status).toBe(0)
    expect(samples.length).toBeGreaterThan(0)
    for (const sample of samples) {
      // An empty or partial line is a torn read: merge-status would misreport the holder.
      expect(sample).toContain("slug=atomic-holder")
      expect(sample).toContain("pid=")
      expect(sample.trim().split("\n")).toHaveLength(1)
    }
  })
})

describe("concurrency audit: first-time state initialization", () => {
  test("a stalled initializer cannot clobber a lease created after its emptiness check", async () => {
    setup(false)
    const slow = runAsync(dir, ["status"], { COORDINATOR_TEST_STATE_INIT_SLEEP: "1" })
    // Wait until the first process has created its temp file and entered the widened window.
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline && !readdirSync(dataDir()).some((n) => n.startsWith(".state."))) {
      await new Promise((r) => setTimeout(r, 10))
    }
    const claimed = run(dir, ["claim", "first-init", "--agent", "t", "--paths", "f"])
    expect(claimed.status).toBe(0)
    expect((await slow.done).status).toBe(0)
    expect(lease("first-init").agent).toBe("t")
  })
})
