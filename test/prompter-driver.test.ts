import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { extractResult, isTerminal, writeLogLine } from "../src/prompter/driver.ts"
import { GoalRpc } from "../src/prompter/goal-rpc.ts"
import { reviewLines } from "../src/prompter/review.ts"
import type { TaskState } from "../src/prompter/types.ts"

describe("driver result extraction", () => {
  test("reads status, turns, cost, and tokens from a goal record", () => {
    const result = extractResult({
      status: "achieved", reason: "done", turns: 7,
      spend: { cost: 0.42, input: 1000, output: 200, cacheRead: 50, cacheWrite: 10 },
    })
    expect(result.status).toBe("achieved")
    expect(result.turns).toBe(7)
    expect(result.costUsd).toBeCloseTo(0.42)
    expect(result.tokens).toBe(1200)
  })

  test("fails closed on missing or malformed records", () => {
    expect(extractResult(null).status).toBe("failed")
    expect(extractResult({ status: 5, spend: "bad" }).costUsd).toBe(0)
  })

  test("writeLogLine drops writes after the stream ends and never throws", () => {
    const writes: string[] = []
    let writable = true
    const stream = { get writable() { return writable }, write: (line: string) => { writes.push(line) } }
    expect(() => {
      writeLogLine(stream, "one\n")
      writable = false // stream.end() was called by a SIGTERM while the child still had output to flush
      writeLogLine(stream, "two\n")
    }).not.toThrow()
    expect(writes).toEqual(["one\n"])
  })

  test("the RPC contract has no runtime dependency on the optional @opencode/plugin peer", () => {
    const source = readFileSync(new URL("../src/prompter/goal-rpc.ts", import.meta.url), "utf8")
    expect(source).not.toMatch(/import\s*\{[^}]*\}\s*from\s*["']@opencode\/plugin/)
    expect(GoalRpc.id).toBe("goal")
    expect(Object.keys(GoalRpc.methods)).toContain("get")
  })

  test("terminal statuses match goal-loop vocabulary", () => {
    expect(isTerminal("achieved")).toBe(true)
    expect(isTerminal("impossible")).toBe(true)
    expect(isTerminal("cleared")).toBe(true)
    expect(isTerminal("failed")).toBe(true)
    expect(isTerminal("active")).toBe(false)
    expect(isTerminal(undefined)).toBe(false)
  })

  test("reviewLines lists only in-review tasks with branch evidence", () => {
    const base = { id: "abc", repo: "/r", branch: "autonomy/abc", worktree: "/wt/abc", objective: "do the thing", status: "in_review" } as TaskState
    const lines = reviewLines([base, { ...base, id: "def", status: "merged" }])
    expect(lines).toContain("abc")
    expect(lines).toContain("autonomy/abc")
    expect(lines).not.toContain("def")
    expect(reviewLines([{ ...base, status: "merged" }])).toContain("no tasks awaiting review")
  })
})
