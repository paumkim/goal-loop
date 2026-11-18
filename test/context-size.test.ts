/**
 * The context estimate is read from the post-compaction window of the session context payload.
 * After a compaction the host returns [compaction(completed), ...later messages]; the estimate must
 * come from the first/last assistant step inside that window, never from a pre-compaction assistant
 * and never from the stale cached total. Before any post-compaction assistant step lands the honest
 * answer is `undefined` — the "context size unknown" state — and the suite pins the transition back
 * to a known, finite number the moment a post-compaction step exists.
 */
import { describe, expect, test } from "bun:test"
import { estimateContextTokens } from "../src/core/context-size.ts"
import { preserveCarriedFields } from "../src/core/entries.ts"
import type { GoalSnapshot, GoalStatus } from "../src/core/types.ts"

const assistant = (input: number, cacheRead = 0, cacheWrite = 0) => ({
  type: "assistant",
  tokens: { input, output: 50, reasoning: 0, cache: { read: cacheRead, write: cacheWrite } },
})

const compaction = () => ({ type: "compaction", status: "completed", reason: "auto", summary: "lossy summary" })

const snap = (status: GoalStatus): GoalSnapshot =>
  ({ version: 1, status, sessionID: "ses", condition: "c", setAt: 0, startedAt: 0, turns: 0, stall: 0, retries: 0, checkins: 0, baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, history: [], elapsedMs: 0 }) as unknown as GoalSnapshot

describe("estimateContextTokens", () => {
  test("returns the last assistant's input + cache read/write when no compaction is present", () => {
    expect(estimateContextTokens([assistant(1_000), assistant(2_000, 300, 100)])).toBe(2_400)
  })

  test("assistant messages without usable token figures are skipped, not fatal", () => {
    const tokenless = { type: "assistant" }
    expect(estimateContextTokens([assistant(1_000), tokenless])).toBe(1_000)
    const emptyFigures = { type: "assistant", tokens: {} }
    expect(estimateContextTokens([assistant(1_000), emptyFigures])).toBe(1_000)
  })

  test("a tokenless last assistant does not hide an earlier measurable one", () => {
    const weird = { type: "assistant", tokens: { input: Number.NaN } }
    expect(estimateContextTokens([assistant(1_000), weird])).toBe(1_000)
  })

  test("after a compaction, only the post-compaction window is read", () => {
    const payload = [assistant(180_000, 5_000), compaction(), assistant(9_000, 500)]
    expect(estimateContextTokens(payload)).toBe(9_500)
  })

  test("a pre-compaction assistant is never reported once a compaction bounds the window", () => {
    // No assistant after the compaction yet: honest unknown, not the stale 185k.
    expect(estimateContextTokens([assistant(180_000, 5_000), compaction()])).toBeUndefined()
  })

  test("a running or failed compaction is not a boundary", () => {
    const running = { type: "compaction", status: "running", reason: "auto", summary: "s" }
    expect(estimateContextTokens([assistant(180_000), running])).toBe(180_000)
    const failed = { type: "compaction", status: "failed", reason: "auto", summary: "s", error: { message: "x" } }
    expect(estimateContextTokens([assistant(180_000), failed])).toBe(180_000)
  })

  test("the most recent completed compaction is the boundary, not an earlier one", () => {
    const payload = [assistant(1_000), compaction(), assistant(2_000), compaction(), assistant(3_000, 100)]
    expect(estimateContextTokens(payload)).toBe(3_100)
  })

  test("a non-array-ish payload entry is tolerated", () => {
    expect(estimateContextTokens([null, "junk", assistant(42)])).toBe(42)
    expect(estimateContextTokens([])).toBeUndefined()
  })
})

describe("after a simulated compaction", () => {
  test("the cached pre-compaction total no longer paints; a finite post-compaction count does", () => {
    const stale = { ...snap("active"), contextSize: 185_000 } as GoalSnapshot
    const landed = {
      ...snap("active"),
      loopCompact: { requestedAt: 1, iteration: 2, misses: 0, landedAt: 2 },
    } as unknown as GoalSnapshot
    // The landing flip drops the stale total — nothing paints as current until the server sends a count.
    const afterLanding = preserveCarriedFields(stale, landed)
    expect(afterLanding?.contextSize).toBeUndefined()
    // The server then re-derives the count from the post-compaction window: known and finite.
    const post = estimateContextTokens([assistant(180_000, 5_000), compaction(), assistant(9_000, 500)])
    expect(post).toBeDefined()
    expect(Number.isFinite(post)).toBe(true)
    expect(post as number).toBeLessThan(185_000)
    // And the fresh count flows through the snapshot unchanged.
    const fresh = preserveCarriedFields(afterLanding, { ...landed, contextSize: post } as GoalSnapshot)
    expect(fresh?.contextSize).toBe(9_500)
  })
})
