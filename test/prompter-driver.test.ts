import { describe, expect, test } from "bun:test"
import { extractResult, isTerminal } from "../src/prompter/driver.ts"
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
