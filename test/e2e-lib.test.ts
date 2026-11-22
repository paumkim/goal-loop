/**
 * Unit tests for the pure decision points of scripts/e2e.ts (extracted to scripts/e2e-lib.ts so
 * they can be pinned without spawning a server). The executable's failure paths that stop before
 * any spawn are covered in test/e2e.test.ts; this file covers the logic they both use.
 * Not shipped (scripts/ and test/ are not in package.json `files`); this file lives in test/ only.
 */
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_MODEL,
  parseModelArg,
  resolveModel,
  buildIntendedConfig,
  decideConfigAction,
  refuseConfigMessage,
  goalExitCode,
} from "../scripts/e2e-lib.ts"

describe("resolveModel", () => {
  test("prefers the positional argument over E2E_MODEL and the built-in default", () => {
    expect(resolveModel("a/b", "c/d")).toBe("a/b")
  })
  test("falls back to E2E_MODEL when no argument is given", () => {
    expect(resolveModel(undefined, "c/d")).toBe("c/d")
  })
  test("falls back to the built-in default when neither is set", () => {
    expect(resolveModel(undefined, undefined)).toBe(DEFAULT_MODEL)
    expect(resolveModel(undefined, undefined)).toContain("/")
  })
})

describe("parseModelArg", () => {
  test("splits provider/model at the first slash", () => {
    expect(parseModelArg("opencode/deepseek-v4.1-flash-free")).toEqual({ providerID: "opencode", modelID: "deepseek-v4.1-flash-free" })
  })
  test("keeps slashes inside the model id (openrouter/org/model)", () => {
    expect(parseModelArg("openrouter/anthropic/claude-3")).toEqual({ providerID: "openrouter", modelID: "anthropic/claude-3" })
  })
  test.each([
    ["bare word", "openrouter"],
    ["leading slash", "/deepseek"],
    ["trailing slash", "opencode/"],
    ["double slash after provider", "opencode//"],
    ["empty string", ""],
    ["whitespace in provider", "open code/model"],
    ["whitespace in model id", "opencode/my model"],
    ["leading space", " opencode/model"],
    ["trailing space", "opencode/model "],
  ])("rejects %s with the documented error", (_label, input) => {
    expect(() => parseModelArg(input)).toThrow('model must be "provider/model"')
    expect(() => parseModelArg("openrouter")).toThrow('model must be "provider/model" (got "openrouter")')
  })
})

describe("buildIntendedConfig", () => {
  test("produces the exact two-space-indented payload with the plugin path", () => {
    expect(buildIntendedConfig("/repo/plugin")).toBe(JSON.stringify({ plugins: ["/repo/plugin"] }, null, 2))
    expect(JSON.parse(buildIntendedConfig("/repo/plugin"))).toEqual({ plugins: ["/repo/plugin"] })
  })
})

describe("decideConfigAction", () => {
  const intended = buildIntendedConfig("/repo/plugin")
  test("writes when no config exists", () => {
    expect(decideConfigAction(null, intended)).toBe("write")
  })
  test("skips when the existing config is byte-identical (idempotent rerun, no EACCES on read-only files)", () => {
    expect(decideConfigAction(intended, intended)).toBe("skip")
  })
  test("refuses when the existing config differs", () => {
    expect(decideConfigAction('{"plugins":["other"]}', intended)).toBe("refuse")
  })
})

describe("refuseConfigMessage", () => {
  test("names the offending path and points at the empty-directory contract", () => {
    const message = refuseConfigMessage("/tmp/proj/.opencode/opencode.json")
    expect(message).toContain("refusing to overwrite")
    expect(message).toContain("/tmp/proj/.opencode/opencode.json")
    expect(message).toContain("empty directory")
  })
})

describe("goalExitCode", () => {
  test("0 only for achieved", () => {
    expect(goalExitCode("achieved")).toBe(0)
  })
  test.each([["failed"], ["active"], ["interrupted"], ["impossible"], [undefined]])("1 for %s", (status) => {
    expect(goalExitCode(status as string | undefined)).toBe(1)
  })
})

describe("e2e.ts spawn guards", () => {
  const SCRIPT = join(import.meta.dir, "..", "scripts", "e2e.ts")
  test("fails fast on a missing project directory instead of creating it", () => {
    const base = mkdtempSync(join(tmpdir(), "e2e-lib-test-"))
    try {
      const missing = join(base, "does-not-exist")
      const result = spawnSync("bun", [SCRIPT, missing, "opencode/deepseek-v4.1-flash-free"], {
        encoding: "utf8",
        env: { ...process.env },
      })
      expect(result.status).not.toBe(0)
      expect(`${result.stderr}${result.stdout}`).toContain("project directory does not exist")
      expect(existsSync(missing)).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
