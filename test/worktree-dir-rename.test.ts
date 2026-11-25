/**
 * Workstream: worktrees/ -> worktree/. Two guarantees are pinned here:
 *  (a) no stale `worktrees` default/path survives in shipped code, config, docs or scripts;
 *  (b) the coordinator still honours an old config/lease path with a one-time warning, and
 *      `migrate-worktree-dir` moves the physical directory with `git worktree repair`
 *      while refusing to touch any live lease's worktree.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const SCRIPT = join(ROOT, "packages", "coordinator", "bin", "coordinator")
const readRepo = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_EDITOR: "true",
}

const git = (cwd: string, args: string[], date?: string) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", "-C", cwd, ...args], {
    env: date ? { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : GIT_ENV,
    encoding: "utf8",
  })

let dir: string

const run = (cwd: string, args: string[]) => spawnSync(SCRIPT, args, { cwd, encoding: "utf8", env: GIT_ENV })
const state = () => JSON.parse(readFileSync(join(dir, ".term", "coordinator", "state.json"), "utf8"))
const writeState = (value: unknown) =>
  writeFileSync(join(dir, ".term", "coordinator", "state.json"), JSON.stringify(value) + "\n")

const setup = (worktreeDir = "worktree") => {
  dir = mkdtempSync(join(tmpdir(), "coordinator-wt-dir-"))
  git(dir, ["init", "-q", "-b", "dev"])
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { check: "true" } }) + "\n")
  mkdirSync(join(dir, ".term", "coordinator"), { recursive: true })
  writeFileSync(join(dir, ".term/coordinator/config.json"), JSON.stringify({ devBranch: "dev", worktreeDir }) + "\n")
  writeFileSync(join(dir, ".term/coordinator/state.json"), '{"version":1,"leases":{},"mergeLock":null}\n')
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-q", "-m", "initial"], "2026-11-01T10:00:00+00:00")
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** Seed a lease plus a real linked worktree at a chosen relative path. */
const seedWorktree = (slug: string, rel: string, status: "claimed" | "done") => {
  mkdirSync(join(dir, rel, ".."), { recursive: true })
  git(dir, ["worktree", "add", "-q", "-b", `wt/${slug}`, join(dir, rel), "dev"])
  const value = state()
  value.leases[slug] = {
    agent: "t",
    branch: `wt/${slug}`,
    worktree: rel,
    status,
    paths: ".",
    createdAt: "2026-11-01T10:00:00Z",
    ...(status === "done" ? { mergedAt: "2026-11-01T10:01:00Z", mergedInto: "dev" } : {}),
  }
  writeState(value)
}

describe("worktree/ rename: no stale worktrees defaults or paths", () => {
  test("coordinator, config and core defaults use worktree/", () => {
    const bin = readRepo("packages/coordinator/bin/coordinator")
    expect(bin).toContain('WORKTREE_DIR="worktree"')
    // Line-anchored: the migration code legitimately names the legacy value, but the
    // live default and its config fallback must never select "worktrees".
    expect(bin).not.toMatch(/(^|\n)WORKTREE_DIR="worktrees"/)
    expect(bin).not.toMatch(/\.worktreeDir \/\/ "worktrees"/)
    expect(bin).not.toContain('"worktrees/wt-')
    expect(bin).not.toContain('"$MAIN_ROOT/worktrees/')

    const config = JSON.parse(readRepo(".term/coordinator/config.json"))
    expect(config.worktreeDir).toBe("worktree")

    const gitSource = readRepo("src/core/git.ts")
    expect(gitSource).toContain('worktreeDir = "worktree"')
    expect(gitSource).toContain('worktreeDir: "worktree"')
    expect(gitSource).not.toContain('worktreeDir = "worktrees"')
    expect(gitSource).not.toContain('worktreeDir: "worktrees"')

    const workflow = readRepo("src/core/workflow.ts")
    expect(workflow).toContain('join(projectRoot, "worktree")')
    expect(workflow).not.toContain('join(projectRoot, "worktrees")')
    expect(workflow).toContain('"worktree/"')

    expect(readRepo(".gitignore")).toContain("worktree/")
  })

  test("docs and scripts carry worktree/ paths, never worktrees/wt- paths", () => {
    for (const rel of [
      "AGENTS.md",
      "docs/parallel-work.md",
      "packages/coordinator/README.md",
      "README.md",
      "MAINTAINER.md",
      "RELEASE-CHECKLIST.md",
      "docs/core.html",
      "docs/index.html",
      "docs/install.html",
      "scripts/spec-check.ts",
    ]) {
      const text = readRepo(rel)
      expect(text).not.toContain("worktrees/wt-")
      expect(text).not.toMatch(/(WORKTREE_DIR|worktreeDir)\s*[=:]\s*["']worktrees["']/)
    }
  })
})

describe("legacy fallback and migration", () => {
  test("a new config creates worktree/wt-<slug>", () => {
    setup()
    expect(run(dir, ["claim", "fresh", "--agent", "t", "--paths", "."]).status).toBe(0)
    expect(existsSync(join(dir, "worktree", "wt-fresh"))).toBe(true)
    expect(existsSync(join(dir, "worktrees", "wt-fresh"))).toBe(false)
  })

  test("a legacy config still works and warns exactly once", () => {
    setup("worktrees")
    const first = run(dir, ["claim", "legacy", "--agent", "t", "--paths", "."])
    expect(first.status).toBe(0)
    expect(existsSync(join(dir, "worktrees", "wt-legacy"))).toBe(true)
    expect(first.stderr + first.stdout).toContain("legacy worktree dir")

    const second = run(dir, ["status", "--json"])
    expect(second.status).toBe(0)
    expect(second.stderr + second.stdout).not.toContain("legacy worktree dir")
  })

  test("an old lease path stays valid after the default flips to worktree/", () => {
    setup("worktrees")
    expect(run(dir, ["claim", "oldpath", "--agent", "t", "--paths", "."]).status).toBe(0)
    const wt = join(dir, "worktrees", "wt-oldpath")
    writeFileSync(join(wt, "work.txt"), "kept\n")
    git(wt, ["add", "-A"])
    git(wt, ["commit", "-q", "-m", "work"], "2026-11-02T10:00:00+00:00")
    // Simulate the code upgrade: config now selects the new dir, the lease still lives in the old one.
    writeFileSync(join(dir, ".term/coordinator/config.json"), '{"devBranch":"dev","worktreeDir":"worktree"}\n')
    const sub = run(wt, ["submit"])
    expect(sub.status).toBe(0)
    expect(state().leases["oldpath"].worktree).toBe("worktrees/wt-oldpath")
    expect(existsSync(join(wt, "work.txt"))).toBe(true)
  })

  test("migrate-worktree-dir moves the directory, repairs git records and rewrites paths", () => {
    setup()
    seedWorktree("migrated", "worktrees/wt-migrated", "done")
    const result = run(dir, ["migrate-worktree-dir"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("migrated worktree dir: worktrees -> worktree")
    expect(existsSync(join(dir, "worktree", "wt-migrated"))).toBe(true)
    expect(existsSync(join(dir, "worktrees", "wt-migrated"))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, ".term/coordinator/config.json"), "utf8")).worktreeDir).toBe("worktree")
    expect(state().leases["migrated"].worktree).toBe("worktree/wt-migrated")
    expect(git(dir, ["worktree", "list", "--porcelain"])).toContain(`worktree ${join(dir, "worktree", "wt-migrated")}`)
  })

  test("migration refuses while an active lease still uses the legacy directory", () => {
    setup()
    seedWorktree("active", "worktrees/wt-active", "claimed")
    const result = run(dir, ["migrate-worktree-dir"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("active leases still use worktrees/")
    expect(existsSync(join(dir, "worktrees", "wt-active"))).toBe(true)
    expect(existsSync(join(dir, "worktree"))).toBe(false)
  })

  test("migration --with-live-leases moves the dir but keeps live lease paths valid via a symlink", () => {
    setup()
    seedWorktree("blocked", "worktrees/wt-blocked", "claimed")
    seedWorktree("migrated", "worktrees/wt-migrated", "done")
    const result = run(dir, ["migrate-worktree-dir", "--with-live-leases"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("migrated worktree dir: worktrees -> worktree")
    expect(result.stdout).toContain("compat: worktrees -> worktree symlink kept")
    expect(readlinkSync(join(dir, "worktrees"))).toBe("worktree")
    // Both paths resolve to the same physical worktree.
    expect(existsSync(join(dir, "worktree", "wt-blocked", ".git"))).toBe(true)
    expect(existsSync(join(dir, "worktrees", "wt-blocked", ".git"))).toBe(true)
    // The live lease keeps its old path; the done lease is rewritten.
    expect(state().leases["blocked"].worktree).toBe("worktrees/wt-blocked")
    expect(state().leases["migrated"].worktree).toBe("worktree/wt-migrated")
    expect(git(dir, ["worktree", "list", "--porcelain"])).toContain(`worktree ${join(dir, "worktree", "wt-blocked")}`)
  })

  test("migration --dry-run reports the move without touching anything", () => {
    setup()
    seedWorktree("dry", "worktrees/wt-dry", "done")
    const result = run(dir, ["migrate-worktree-dir", "--dry-run"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("dry-run: would move")
    expect(existsSync(join(dir, "worktrees", "wt-dry"))).toBe(true)
    expect(existsSync(join(dir, "worktree"))).toBe(false)
  })
})
