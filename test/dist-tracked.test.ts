/**
 * Regression guard from the session-history audit: a past cleanup goal deleted the shipped TUI artifact
 * (`dist/tui.js`, 8506 lines) from a submitted lease. The freshness gate checks the bytes on disk, which a
 * local build can satisfy even after the artifact is dropped from git. Pin the tracked state explicitly so
 * an accidental removal cannot land while a developer happens to have an untracked build in place.
 */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

describe("shipped TUI artifact stays tracked", () => {
  test("dist/tui.js and dist/tui.d.ts are committed, not just present locally", () => {
    for (const file of ["dist/tui.js", "dist/tui.d.ts"]) {
      expect(existsSync(join(root, file)), `${file} missing on disk`).toBe(true)
      const result = Bun.spawnSync(["git", "ls-files", "--error-unmatch", "--", file], { cwd: root })
      expect(result.exitCode, `${file} is no longer tracked in git`).toBe(0)
      expect(result.stdout.toString().trim()).toBe(file)
    }
  })
})
