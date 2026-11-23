/** Outcome records carry a finish time only for terminal statuses; optional fields are omitted, not faked. */
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { recordOutcome } from "../src/prompter/apply.ts"
import { loadState } from "../src/prompter/state.ts"
import type { TaskStatus } from "../src/prompter/types.ts"

const tempFile = () => path.join(mkdtempSync(path.join(tmpdir(), "prompter-apply-")), "state.jsonl")
const input = (status: TaskStatus) => ({
  id: "task-1",
  objective: "fix the parser",
  status,
  repo: "/repo",
  branch: "wt/task-1",
  worktree: "/repo/worktree/task-1",
})

describe("recordOutcome", () => {
  test("running and interrupted records have no finishedAt, even after persistence", () => {
    for (const status of ["running", "interrupted"] as const) {
      const file = tempFile()
      const record = recordOutcome(file, input(status))
      expect(record.finishedAt).toBeUndefined()
      const persisted = loadState(file).get("task-1")!
      expect("finishedAt" in persisted).toBe(false)
      expect(persisted.status).toBe(status)
    }
  })

  test("terminal records get an ISO finishedAt and are the latest journal entry", () => {
    const file = tempFile()
    recordOutcome(file, input("in_review"))
    const merged = recordOutcome(file, { ...input("merged"), reason: "approved by reviewer", commit: "abc123", turns: 0 })
    expect(merged.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(merged.reason).toBe("approved by reviewer")
    expect(merged.commit).toBe("abc123")
    expect(merged.turns).toBe(0) // a real zero must survive the optional-field filter
    const persisted = loadState(file).get("task-1")!
    expect(persisted.status).toBe("merged")
    expect(persisted.finishedAt).toBe(merged.finishedAt)
  })

  test("empty optional strings are omitted rather than written as empty markers", () => {
    const file = tempFile()
    const record = recordOutcome(file, { ...input("rejected"), reason: "", goalStatus: "" })
    expect("reason" in record).toBe(false)
    expect("goalStatus" in record).toBe(false)
    expect("turns" in record).toBe(false)
    expect("costUsd" in record).toBe(false)
    expect("tokens" in record).toBe(false)
  })
})
