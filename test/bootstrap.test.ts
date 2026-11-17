import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureCoordinatorLayout, pluginRootFromMeta, resolveCoordinatorBin } from "../src/core/bootstrap.ts"
import { isFuzzyCondition } from "../src/core/prompts.ts"

/** A throwaway directory that is removed when the test ends. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "goal-bootstrap-"))
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A minimal coordinator repository: the `.git` directory and the coordinator binary the bootstrap looks for. */
function repo(): string {
  const dir = scratch()
  mkdirSync(join(dir, ".git"), { recursive: true })
  mkdirSync(join(dir, "packages/coordinator/bin"), { recursive: true })
  writeFileSync(join(dir, "packages/coordinator/bin/coordinator"), "#!/bin/sh\n")
  return dir
}
/** A plain git repository that does not ship the coordinator. */
function plainRepo(): string {
  const dir = scratch()
  mkdirSync(join(dir, ".git"), { recursive: true })
  return dir
}

describe("ensureCoordinatorLayout", () => {
  test("creates the coordinator layout", () => {
    const root = repo()
    const result = ensureCoordinatorLayout(root)
    expect(result.created).toContain(".term/coordinator")
    expect(result.created).toContain("worktrees")
    expect(result.created).toContain(".term/coordinator/config.json")
    expect(result.created).toContain(".term/coordinator/state.json")
    expect(JSON.parse(readFileSync(join(root, ".term/coordinator/config.json"), "utf8"))).toEqual({
      devBranch: "dev",
      worktreeDir: "worktrees",
    })
    expect(JSON.parse(readFileSync(join(root, ".term/coordinator/state.json"), "utf8"))).toEqual({
      version: 1,
      leases: {},
      mergeLock: null,
    })
  })
  test("is idempotent and never overwrites existing files", () => {
    const root = repo()
    ensureCoordinatorLayout(root)
    const configPath = join(root, ".term/coordinator/config.json")
    const statePath = join(root, ".term/coordinator/state.json")
    writeFileSync(configPath, '{"devBranch":"custom","worktreeDir":"custom-wt"}')
    writeFileSync(statePath, '{"version":1,"leases":{},"mergeLock":null,"extra":true}')
    const second = ensureCoordinatorLayout(root)
    expect(second.created).toEqual([])
    expect(second.skipped).toContain(".term/coordinator/config.json")
    expect(second.skipped).toContain(".term/coordinator/state.json")
    expect(readFileSync(configPath, "utf8")).toBe('{"devBranch":"custom","worktreeDir":"custom-wt"}')
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({ extra: true })
  })
  test("is a no-op outside a git repository", () => {
    const root = scratch()
    const result = ensureCoordinatorLayout(root)
    expect(result).toEqual({ created: [], skipped: ["not a git repository"] })
  })
  test("leaves an unrelated repository untouched", () => {
    const root = plainRepo()
    writeFileSync(join(root, ".gitignore"), "node_modules\n")
    const result = ensureCoordinatorLayout(root)
    expect(result).toEqual({ created: [], skipped: ["not a coordinator repository"] })
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("node_modules\n")
    expect(() => readFileSync(join(root, ".term/coordinator/config.json"), "utf8")).toThrow()
  })
  test("appends to .gitignore once", () => {
    const root = repo()
    writeFileSync(join(root, ".gitignore"), "node_modules\n")
    ensureCoordinatorLayout(root)
    const once = readFileSync(join(root, ".gitignore"), "utf8")
    expect(once).toContain("worktrees/")
    expect(once).toContain(".term/coordinator/*.lock")
    ensureCoordinatorLayout(root)
    const twice = readFileSync(join(root, ".gitignore"), "utf8")
    expect(twice).toBe(once)
    expect(twice.match(/worktrees\//g)).toHaveLength(1)
    expect(twice.match(/\.term\/coordinator\/\*\.lock/g)).toHaveLength(1)
  })
  test("does not create .gitignore when missing", () => {
    const root = repo()
    ensureCoordinatorLayout(root)
    expect(() => readFileSync(join(root, ".gitignore"), "utf8")).toThrow()
  })
})

describe("resolveCoordinatorBin", () => {
  test("prefers the plugin binary and falls back to the project one", () => {
    const plugin = scratch()
    const project = scratch()
    mkdirSync(join(plugin, "packages/coordinator/bin"), { recursive: true })
    writeFileSync(join(plugin, "packages/coordinator/bin/coordinator"), "#!/bin/sh\n")
    mkdirSync(join(project, "packages/coordinator/bin"), { recursive: true })
    writeFileSync(join(project, "packages/coordinator/bin/coordinator"), "#!/bin/sh\n")
    expect(resolveCoordinatorBin(plugin, project)).toBe(join(plugin, "packages/coordinator/bin/coordinator"))
    expect(resolveCoordinatorBin(undefined, project)).toBe(join(project, "packages/coordinator/bin/coordinator"))
    expect(resolveCoordinatorBin(undefined, scratch())).toBeUndefined()
  })
  test("finds the plugin root from meta dirs", () => {
    const root = scratch()
    mkdirSync(join(root, "packages/coordinator/bin"), { recursive: true })
    writeFileSync(join(root, "packages/coordinator/bin/coordinator"), "#!/bin/sh\n")
    mkdirSync(join(root, "src/core"), { recursive: true })
    expect(pluginRootFromMeta(join(root, "src/core"))).toBe(root)
    expect(pluginRootFromMeta(join(root, "src"))).toBe(root)
  })
})

describe("isFuzzyCondition", () => {
  test("vague requests are fuzzy", () => {
    expect(isFuzzyCondition("make it look like a rabbit")).toBe(true)
    expect(isFuzzyCondition("make it pretty")).toBe(true)
  })
  test("hard evidence is not fuzzy", () => {
    expect(isFuzzyCondition("bun test passes")).toBe(false)
    expect(isFuzzyCondition("all 3 tests pass with 0 failures")).toBe(false)
  })
})
