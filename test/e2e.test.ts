/**
 * Spawn-based tests for the failure paths of `scripts/e2e.ts` — the parts that must stop before
 * any server is spawned. The happy path drives a real `opencode serve` and is intentionally not
 * run here (see `bun run e2e`). Not shipped (scripts/ is not in package.json `files`); this file
 * lives in test/ only.
 */
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "..", "scripts", "e2e.ts")

const run = (dir: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("bun", [SCRIPT, dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

const withTmp = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-test-"))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("e2e argument and config guards", () => {
  test("refuses to overwrite a differing .opencode/opencode.json in the target dir", () => {
    withTmp((dir) => {
      mkdirSync(join(dir, ".opencode"), { recursive: true })
      const existing = JSON.stringify({ plugins: ["somebody-elses-plugin"], model: "keep-me" }, null, 2)
      writeFileSync(join(dir, ".opencode", "opencode.json"), existing)
      const result = run(dir, ["opencode/deepseek-v4.1-flash-free"])
      expect(result.status).not.toBe(0)
      expect(`${result.stderr}${result.stdout}`).toContain("refusing to overwrite")
      // the pre-existing bytes were not touched
      expect(readFileSync(join(dir, ".opencode", "opencode.json"), "utf8")).toBe(existing)
    })
  })

  test("rejects a model argument without provider/model shape before spawning anything", () => {
    withTmp((dir) => {
      const result = run(dir, [], { E2E_MODEL: "openrouter" })
      expect(result.status).not.toBe(0)
      expect(`${result.stderr}${result.stdout}`).toContain('model must be "provider/model"')
      // and the config was never written (validation happens first)
      expect(() => readFileSync(join(dir, ".opencode", "opencode.json"), "utf8")).toThrow()
    })
  })

  test("rejects a trailing-slash model (empty id)", () => {
    withTmp((dir) => {
      const result = run(dir, [], { E2E_MODEL: "openrouter/" })
      expect(result.status).not.toBe(0)
      expect(`${result.stderr}${result.stdout}`).toContain('model must be "provider/model"')
    })
  })
})
