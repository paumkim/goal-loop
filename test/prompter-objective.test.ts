import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_CONFIG } from "../src/prompter/defaults.ts"
import { buildObjective, readPromptBodies } from "../src/prompter/objective.ts"

describe("objective", () => {
  test("includes the objective, branch, guardrails, and a verifiable condition", () => {
    const text = buildObjective({
      objective: "Add a parser regression test",
      branch: "autonomy/abc123",
      baseBranch: "dev",
      worktree: "/wt/abc123",
      promptBodies: ["PROMPT BODY"],
    })
    expect(text).toContain("Add a parser regression test")
    expect(text).toContain("PROMPT BODY")
    expect(text).toContain("autonomy/abc123")
    expect(text).toContain("NEVER merge")
    expect(text).toContain("<condition>")
    expect(text).toContain("commit hash is")
  })

  test("readPromptBodies reports missing files but keeps found ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompter-prompts-"))
    mkdirSync(join(dir, "maintenance"), { recursive: true })
    writeFileSync(join(dir, "maintenance", "ok.md"), "BODY")
    const config = { ...DEFAULT_CONFIG, promptLibrary: dir, prompts: ["maintenance/ok.md", "maintenance/nope.md"] }
    const { bodies, missing } = readPromptBodies(config)
    expect(bodies).toEqual(["BODY"])
    expect(missing.length).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })
})
