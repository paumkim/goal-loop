/** The prompter state journal is append-only and survives crashes: a torn tail must never hide earlier records. */
import { describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { appendState, byStatus, loadState } from "../src/prompter/state.ts"
import type { TaskState } from "../src/prompter/types.ts"

const state = (id: string, status: TaskState["status"], extra: Partial<TaskState> = {}): TaskState => ({
  id,
  objective: `do ${id}`,
  status,
  repo: "/repo",
  branch: `wt/${id}`,
  worktree: `/repo/worktree/${id}`,
  requestedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
})

const tempFile = (name = "state.jsonl") => path.join(mkdtempSync(path.join(tmpdir(), "prompter-state-")), name)

describe("prompter state journal", () => {
  test("a missing journal loads as an empty map", () => {
    expect([...loadState(tempFile("missing.jsonl"))]).toEqual([])
  })

  test("append keeps the latest record per id and a torn tail cannot hide it", () => {
    const file = tempFile()
    appendState(file, state("a", "running"))
    appendState(file, state("a", "in_review", { commit: "abcdef123456" }))
    appendState(file, state("b", "merged"))
    appendFileSync(file, '{"id":"c","status":"running"', "utf8") // crash mid-write

    const loaded = loadState(file)
    expect([...loaded.keys()].sort()).toEqual(["a", "b"])
    expect(loaded.get("a")?.status).toBe("in_review")
    expect(loaded.get("a")?.commit).toBe("abcdef123456")
    expect(byStatus(loaded, "in_review").map((s) => s.id)).toEqual(["a"])
    expect(byStatus(loaded, "running")).toEqual([])
  })

  test("malformed and schema-invalid lines are skipped without losing good records", () => {
    const file = tempFile()
    writeFileSync(file, [
      JSON.stringify(state("good", "running")),
      "not json at all",
      JSON.stringify({ id: 7, status: "running" }),
      JSON.stringify({ id: "no-status" }),
      "",
      JSON.stringify(state("good", "rejected", { reason: "later decision" })),
    ].join("\n"), "utf8")

    const loaded = loadState(file)
    expect([...loaded.keys()]).toEqual(["good"])
    expect(loaded.get("good")?.status).toBe("rejected")
    expect(loaded.get("good")?.reason).toBe("later decision")
  })
})
