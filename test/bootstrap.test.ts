import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendGitignoreRules,
  docsReadmeTemplate,
  ensureCoordinatorLayout,
  ensureGoalRuntimeLayout,
  ensureStartupScaffold,
  ensureWorkflowDocs,
  maintainerTemplate,
  pluginRootFromMeta,
  resolveCoordinatorBin,
  RUNTIME_GITIGNORE_RULES,
  specTemplate,
} from "../src/core/bootstrap.ts"
import { isFuzzyCondition } from "../src/core/prompts.ts"

/** A throwaway directory that is removed when the test ends. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "goal-bootstrap-"))
  process.on("exit", () => rmSync(dir, { recursive: true }))
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
/** A plain git repository that does not ship the coordinator package. */
function plainRepo(): string {
  const dir = scratch()
  mkdirSync(join(dir, ".git"), { recursive: true })
  return dir
}

describe("ensureCoordinatorLayout", () => {
  test("creates the coordinator/workplace layout in a git repo", () => {
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
  test("provisions coordinator/workplace layout in any git repo (idempotent for existing setups)", () => {
    const root = plainRepo()
    const result = ensureCoordinatorLayout(root)
    expect(result.created).toContain(".term/coordinator")
    expect(result.created).toContain("worktrees")
    expect(result.created).toContain(".term/coordinator/config.json")
    expect(result.created).toContain(".term/coordinator/state.json")
    expect(JSON.parse(readFileSync(join(root, ".term/coordinator/config.json"), "utf8"))).toEqual({
      devBranch: "dev",
      worktreeDir: "worktrees",
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
  test("appends missing gitignore rules once and never removes existing ones", () => {
    const root = repo()
    writeFileSync(join(root, ".gitignore"), "node_modules\ncustom-keep/\n")
    ensureCoordinatorLayout(root)
    const once = readFileSync(join(root, ".gitignore"), "utf8")
    expect(once).toContain("node_modules")
    expect(once).toContain("custom-keep/")
    expect(once).toContain("worktrees/")
    expect(once).toContain(".term/coordinator/*.lock")
    expect(once).toContain(".term/goal-loop/")
    ensureCoordinatorLayout(root)
    const twice = readFileSync(join(root, ".gitignore"), "utf8")
    expect(twice).toBe(once)
    expect(twice.match(/worktrees\//g)?.length).toBe(1)
  })
  test("creates .gitignore when missing and runtime rules are needed", () => {
    const root = repo()
    ensureCoordinatorLayout(root)
    const content = readFileSync(join(root, ".gitignore"), "utf8")
    for (const rule of RUNTIME_GITIGNORE_RULES) expect(content).toContain(rule)
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

describe("ensureGoalRuntimeLayout", () => {
  test("creates .term/goal-loop and is idempotent", () => {
    const root = plainRepo()
    const first = ensureGoalRuntimeLayout(root)
    expect(first.created).toContain(".term/goal-loop")
    const second = ensureGoalRuntimeLayout(root)
    expect(second.existing).toContain(".term/goal-loop")
    expect(second.created).not.toContain(".term/goal-loop")
  })
  test("ensures parent dir for custom learning path inside project", () => {
    const root = plainRepo()
    const result = ensureGoalRuntimeLayout(root, ".term/custom/learnings.jsonl")
    expect(result.created).toContain(".term/custom")
    expect(() => readFileSync(join(root, ".term/custom/learnings.jsonl"), "utf8")).toThrow()
  })
})

describe("ensureWorkflowDocs", () => {
  test("seeds workflow docs/templates only when absent and never overwrites", () => {
    const root = plainRepo()
    const first = ensureWorkflowDocs(root)
    expect(first.created).toContain("SPEC.md")
    expect(first.created).toContain("docs/README.md")
    expect(first.created).toContain("MAINTAINER.md")
    expect(readFileSync(join(root, "SPEC.md"), "utf8")).toBe(specTemplate())
    expect(readFileSync(join(root, "docs/README.md"), "utf8")).toBe(docsReadmeTemplate())
    expect(readFileSync(join(root, "MAINTAINER.md"), "utf8")).toBe(maintainerTemplate())

    writeFileSync(join(root, "SPEC.md"), "# My SPEC\n")
    writeFileSync(join(root, "MAINTAINER.md"), "# Custom maintainer\n")
    writeFileSync(join(root, "docs/README.md"), "# Custom docs\n")
    const second = ensureWorkflowDocs(root)
    expect(second.existing).toContain("SPEC.md")
    expect(second.existing).toContain("MAINTAINER.md")
    expect(second.existing).toContain("docs/README.md")
    expect(readFileSync(join(root, "SPEC.md"), "utf8")).toBe("# My SPEC\n")
    expect(readFileSync(join(root, "MAINTAINER.md"), "utf8")).toBe("# Custom maintainer\n")
    expect(readFileSync(join(root, "docs/README.md"), "utf8")).toBe("# Custom docs\n")
  })
})

describe("appendGitignoreRules", () => {
  test("appends only missing rules and never removes existing ones", () => {
    const root = scratch()
    writeFileSync(join(root, ".gitignore"), "node_modules\nworktrees/\n")
    const result = appendGitignoreRules(root, ["worktrees/", ".term/goal-loop/", "node_modules"])
    expect(result.added).toEqual([".term/goal-loop/"])
    const content = readFileSync(join(root, ".gitignore"), "utf8")
    expect(content).toContain("node_modules")
    expect(content).toContain("worktrees/")
    expect(content).toContain(".term/goal-loop/")
    const again = appendGitignoreRules(root, ["worktrees/", ".term/goal-loop/", "node_modules"])
    expect(again.added).toEqual([])
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(content)
  })
  test("creates .gitignore when missing", () => {
    const root = scratch()
    const result = appendGitignoreRules(root, ["worktrees/"])
    expect(result.created).toBe(true)
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("worktrees/")
  })
})

describe("ensureStartupScaffold", () => {
  test("provisions full workflow scaffold in a fresh git repo (idempotent, no overwrites)", () => {
    const root = plainRepo()
    const first = ensureStartupScaffold({ projectRoot: root, learningPath: ".term/goal-loop/learnings.jsonl" })
    expect(first.created).toContain(".term/coordinator/config.json")
    expect(first.created).toContain(".term/coordinator/state.json")
    expect(first.created).toContain("worktrees")
    expect(first.created).toContain(".term/goal-loop")
    expect(first.created).toContain("SPEC.md")
    expect(first.created).toContain("docs/README.md")
    expect(first.created).toContain("MAINTAINER.md")
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".term/goal-loop/")

    writeFileSync(join(root, "SPEC.md"), "# Custom\n")
    writeFileSync(join(root, ".term/coordinator/config.json"), '{"devBranch":"main","worktreeDir":"wt"}')
    const second = ensureStartupScaffold({ projectRoot: root, learningPath: ".term/goal-loop/learnings.jsonl" })
    expect(second.created).toEqual([])
    expect(readFileSync(join(root, "SPEC.md"), "utf8")).toBe("# Custom\n")
    expect(JSON.parse(readFileSync(join(root, ".term/coordinator/config.json"), "utf8")).devBranch).toBe("main")
  })
  test("degrades gracefully outside a git repo (runtime-only setup)", () => {
    const root = scratch()
    const result = ensureStartupScaffold({ projectRoot: root })
    expect(result.notes.join(" ")).toContain("runtime-only")
    expect(result.created).toContain(".term/goal-loop")
    expect(() => readFileSync(join(root, "SPEC.md"), "utf8")).toThrow()
    expect(() => readFileSync(join(root, ".term/coordinator/config.json"), "utf8")).toThrow()
  })
  test("fills gaps in an existing setup without overwriting", () => {
    const root = plainRepo()
    mkdirSync(join(root, ".term/coordinator"), { recursive: true })
    writeFileSync(join(root, ".term/coordinator/config.json"), '{"devBranch":"dev","worktreeDir":"worktrees"}')
    writeFileSync(join(root, "SPEC.md"), "# Existing\n")
    const result = ensureStartupScaffold({ projectRoot: root })
    expect(result.created).toContain(".term/coordinator/state.json")
    expect(result.created).toContain("worktrees")
    expect(result.created).toContain("MAINTAINER.md")
    expect(result.existing).toContain(".term/coordinator/config.json")
    expect(readFileSync(join(root, "SPEC.md"), "utf8")).toBe("# Existing\n")
    expect(JSON.parse(readFileSync(join(root, ".term/coordinator/config.json"), "utf8"))).toEqual({ devBranch: "dev", worktreeDir: "worktrees" })
  })
})
