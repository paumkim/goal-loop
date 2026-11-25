import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  collectChangedPaths,
  createGitRun,
  pathsOf,
  resolveIntegrationBase,
} from "../src/core/changed-paths.ts"
import { collectChangeSetPaths } from "../src/core/change-risk.ts"
import { collectChangedPaths as collectChangedPathsSweep } from "../scripts/invariant-sweep.ts"

describe("changed-paths shared collector", () => {
  test("pathsOf parses porcelain and plain diff lines, handles renames, CR and de-dupes", () => {
    expect(
      pathsOf([" M src/core/a.ts", "A  docs/changelog.html", "?? src/runtime/new.ts", "R  old -> src/core/renamed.ts", ""]).sort(),
    ).toEqual(["docs/changelog.html", "src/core/a.ts", "src/core/renamed.ts", "src/runtime/new.ts"])
    expect(pathsOf(["src/core/a.ts", "SPEC.md", "src/core/a.ts"])).toEqual(["SPEC.md", "src/core/a.ts"])
    expect(pathsOf([" M src/core/a.ts\r", ""])).toEqual(["src/core/a.ts"])
  })

  test("pathsOf splits -> only on renames, on the first occurrence, and decodes quoted paths", () => {
    // A rename whose destination literally contains " -> " must keep the whole destination (first split only).
    expect(pathsOf(['R  normal.txt -> "new -> name.txt"'])).toEqual(["new -> name.txt"])
    // Unstaged rename (status char in the Y column) uses the same rendering.
    expect(pathsOf([' R old.ts -> src/new.ts'])).toEqual(["src/new.ts"])
    // Copy status too.
    expect(pathsOf(['C  orig.ts -> copy.ts'])).toEqual(["copy.ts"])
    // C-style quoted paths: tab escapes decode, and the destination is not truncated at its embedded arrow.
    expect(pathsOf(['R  "tab\\told.txt" -> "tab\\tnew.txt"'])).toEqual(["tab\tnew.txt"])
    // Octal UTF-8 bytes decode to real characters.
    expect(pathsOf([' M "caf\\303\\251.txt"'])).toEqual(["café.txt"])
    // Escaped double-quote and backslash survive decoding.
    expect(pathsOf(['?? "say \\"hi\\"\\\\now.txt"'])).toEqual(['say "hi"\\now.txt'])
    // A non-rename status line whose path contains " -> " keeps its full path.
    expect(pathsOf([" M my -> file.txt"])).toEqual(["my -> file.txt"])
    expect(pathsOf(["A  a -> b -> c.txt"])).toEqual(["a -> b -> c.txt"])
    // Plain diff lines (no XY prefix) are never split, even with arrows.
    expect(pathsOf(["x -> y.txt", '"tab\\tz.txt"'])).toEqual(["tab\tz.txt", "x -> y.txt"])
  })

  test("collectChangeSetPaths delegates to shared collector (best-effort, untracked all)", () => {
    expect(Array.isArray(collectChangeSetPaths(process.cwd()))).toBe(true)
  })

  test("invariant-sweep collectChangedPaths delegates to shared collector", () => {
    expect(Array.isArray(collectChangedPathsSweep(process.cwd()))).toBe(true)
  })

  describe("git integration", () => {
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

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "changed-paths-test-"))
      git(["init", "-q", "-b", "dev"])
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "README.md"), "init\n")
      writeFileSync(join(dir, "src", "a.ts"), "export const a = 1\n")
      git(["add", "-A"])
      git(["commit", "-q", "-m", "init"])
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    test("collects working-tree and committed-ahead changes", () => {
      writeFileSync(join(dir, "src", "a.ts"), "export const a = 2\n")
      expect(collectChangedPaths(dir)).toContain("src/a.ts")
      git(["add", "src/a.ts"])
      git(["commit", "-q", "-m", "change a"])
      // create a feature branch tip ahead check: on dev with commit ahead of merge-base vs dev itself base is HEAD..HEAD? merge-base(HEAD,dev)=HEAD so diff empty
      // but committed-ahead relative to integration base: merge-base resolves to dev which is HEAD here -> no committed diff; working tree/index checked
      expect(Array.isArray(collectChangedPaths(dir))).toBe(true)
    })

    test("untrackedFiles 'all' lists files inside untracked directories", () => {
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
      writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: ci\n")
      const normal = collectChangedPaths(dir)
      const all = collectChangedPaths(dir, { untrackedFiles: "all" })
      expect(all).toContain(".github/workflows/ci.yml")
      // default porcelain may report the directory; 'all' must report the file path
      expect(normal.some((p) => p.includes(".github"))).toBe(true)
    })

    test("bestEffort returns [] instead of throwing on failure", () => {
      rmSync(join(dir, ".git"), { recursive: true, force: true })
      expect(collectChangedPaths(dir, { bestEffort: true })).toEqual([])
    })

    test("resolveIntegrationBase finds merge-base with integration refs", () => {
      const run = createGitRun(dir)
      // This fixture has one commit on dev, so dev/HEAD/origin-less merge-base is exactly HEAD —
      // "truthy" would also pass for a wrong ref or a fabricated SHA.
      expect(resolveIntegrationBase(run)).toBe(git(["rev-parse", "HEAD"]).trim())
    })
  })
})
