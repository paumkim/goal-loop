/**
 * Unit tests for `scripts/invariant-sweep.ts` pure helpers and CLI behavior.
 * Helpers are side-effect free; the CLI test runs the script in a temp git repo.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  behaviorChanges,
  diagnose,
  formatFailures,
  formatOk,
  isBehaviorPath,
  pathsOf,
} from "../scripts/invariant-sweep.ts"

const SCRIPT = join(import.meta.dir, "..", "scripts", "invariant-sweep.ts")

describe("pathsOf", () => {
  test("parses porcelain status lines including renames and untracked", () => {
    expect(pathsOf([" M src/core/a.ts", "A  docs/changelog.html", "?? src/runtime/new.ts", "R  old -> src/core/renamed.ts", ""]).sort()).toEqual([
      "docs/changelog.html",
      "src/core/a.ts",
      "src/core/renamed.ts",
      "src/runtime/new.ts",
    ])
  })

  test("accepts plain diff --name-only lines and de-duplicates", () => {
    expect(pathsOf(["src/core/a.ts", "SPEC.md", "src/core/a.ts"])).toEqual(["SPEC.md", "src/core/a.ts"])
  })
})

describe("behavior change detection", () => {
  test("flags src/core and src/runtime paths only", () => {
    expect(isBehaviorPath("src/core/prompts.ts")).toBe(true)
    expect(isBehaviorPath("src/runtime/controller.ts")).toBe(true)
    expect(isBehaviorPath("src/core")).toBe(false)
    expect(isBehaviorPath("src/index.ts")).toBe(false)
    expect(isBehaviorPath("scripts/invariant-sweep.ts")).toBe(false)
    expect(isBehaviorPath("test/core.test.ts")).toBe(false)
  })

  test("extracts behavior changes in stable order", () => {
    expect(behaviorChanges(["SPEC.md", "src/runtime/a.ts", "src/core/b.ts", "README.md"])).toEqual([
      "src/core/b.ts",
      "src/runtime/a.ts",
    ])
  })
})

describe("diagnose", () => {
  test("passes when there are no src/core or src/runtime changes", () => {
    expect(diagnose(["README.md", "docs/changelog.html", "scripts/x.ts"])).toEqual([])
    expect(diagnose([])).toEqual([])
  })

  test("passes when behavior changes include both SPEC.md and docs/changelog.html", () => {
    expect(diagnose(["src/core/prompts.ts", "SPEC.md", "docs/changelog.html"])).toEqual([])
    expect(diagnose(["src/runtime/controller.ts", "test/x.test.ts", "SPEC.md", "docs/changelog.html"])).toEqual([])
  })

  test("fails listing missing companions and the behavior changes", () => {
    expect(diagnose(["src/core/prompts.ts"])).toEqual([
      "SPEC.md not updated for src/core|src/runtime behavior changes",
      "docs/changelog.html not updated for src/core|src/runtime behavior changes",
      "behavior changes: src/core/prompts.ts",
    ])
  })

  test("fails when only SPEC.md is missing", () => {
    expect(diagnose(["src/runtime/controller.ts", "docs/changelog.html"])).toEqual([
      "SPEC.md not updated for src/core|src/runtime behavior changes",
      "behavior changes: src/runtime/controller.ts",
    ])
  })

  test("fails when only docs/changelog.html is missing", () => {
    expect(diagnose(["src/core/types.ts", "SPEC.md"])).toEqual([
      "docs/changelog.html not updated for src/core|src/runtime behavior changes",
      "behavior changes: src/core/types.ts",
    ])
  })
})

describe("formatting", () => {
  test("formatFailures prefixes each failure line", () => {
    expect(formatFailures(["a", "b"])).toBe(
      "invariant-sweep: behavior changes missing required doc updates:\n  - a\n  - b",
    )
  })

  test("formatOk reports the passing invariant", () => {
    expect(formatOk()).toContain("invariant-sweep: ok")
    expect(formatOk()).toContain("SPEC.md")
    expect(formatOk()).toContain("docs/changelog.html")
  })
})

describe("CLI integration (temp git repo)", () => {
  const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  }
  let dir: string
  const git = (args: string[]) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, env: GIT_ENV, encoding: "utf8" })
  const run = () => spawnSync("bun", [SCRIPT], { cwd: dir, encoding: "utf8", env: GIT_ENV })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "invariant-sweep-test-"))
    git(["init", "-q", "-b", "dev"])
    mkdirSync(join(dir, "src", "core"), { recursive: true })
    mkdirSync(join(dir, "src", "runtime"), { recursive: true })
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(join(dir, "SPEC.md"), "spec\n")
    writeFileSync(join(dir, "docs", "changelog.html"), "log\n")
    writeFileSync(join(dir, "src", "core", "a.ts"), "export const a = 1\n")
    git(["add", "-A"])
    git(["commit", "-q", "-m", "init"])
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("passes on a clean tree with no behavior changes", () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(`${result.stdout}`).toContain("invariant-sweep: ok")
  })

  test("fails when core behavior changes without SPEC.md and changelog", () => {
    writeFileSync(join(dir, "src", "core", "a.ts"), "export const a = 2\n")
    const result = run()
    expect(result.status).toBe(1)
    const out = `${result.stdout}\n${result.stderr}`
    expect(out).toContain("SPEC.md not updated")
    expect(out).toContain("docs/changelog.html not updated")
    expect(out).toContain("src/core/a.ts")
  })

  test("passes when core behavior changes include SPEC.md and docs/changelog.html", () => {
    writeFileSync(join(dir, "src", "core", "a.ts"), "export const a = 2\n")
    writeFileSync(join(dir, "SPEC.md"), "spec v2\n")
    writeFileSync(join(dir, "docs", "changelog.html"), "log v2\n")
    const result = run()
    expect(result.status).toBe(0)
    expect(`${result.stdout}`).toContain("invariant-sweep: ok")
  })

  test("fails for staged runtime behavior changes missing companions", () => {
    writeFileSync(join(dir, "src", "runtime", "r.ts"), "export const r = 1\n")
    git(["add", "src/runtime/r.ts"])
    const result = run()
    expect(result.status).toBe(1)
    const out = `${result.stdout}\n${result.stderr}`
    expect(out).toContain("src/runtime/r.ts")
    expect(out).toContain("SPEC.md not updated")
  })
})
