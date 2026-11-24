/**
 * The completed-condition ledger: the bounded memory the loop's anti-repeat and near-duplicate gates scan.
 * Unit level here (the bounding helper); the controller-level gate behavior — including
 * catching a planner re-offering a condition that completed before the retained iteration window —
 * is exercised end to end in test/loop.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { boundCompletedConditions, MAX_COMPLETED_CONDITION_ENTRIES } from "../src/core/types.ts"

describe("boundCompletedConditions", () => {
  test("keeps everything at or below the cap and reports zero drops", () => {
    expect(boundCompletedConditions([])).toEqual({ retained: [], dropped: 0 })
    const atCap = Array.from({ length: MAX_COMPLETED_CONDITION_ENTRIES }, (_, i) => `condition ${i}`)
    const bound = boundCompletedConditions(atCap)
    expect(bound.dropped).toBe(0)
    expect(bound.retained).toEqual(atCap)
  })

  test("drops the oldest entries beyond the cap and keeps the newest", () => {
    const all = Array.from({ length: MAX_COMPLETED_CONDITION_ENTRIES + 13 }, (_, i) => `condition ${i}`)
    const bound = boundCompletedConditions(all)
    expect(bound.dropped).toBe(13)
    expect(bound.retained).toHaveLength(MAX_COMPLETED_CONDITION_ENTRIES)
    expect(bound.retained[0]).toBe("condition 13")
    expect(bound.retained.at(-1)).toBe(`condition ${MAX_COMPLETED_CONDITION_ENTRIES + 12}`)
  })

  test("exact consecutive duplicates (a re-entered advance for the same iteration) collapse to one", () => {
    const bound = boundCompletedConditions(["a", "b", "b", "c"])
    expect(bound.retained).toEqual(["a", "b", "c"])
    expect(bound.dropped).toBe(0)
  })

  test("repeated non-consecutive entries are kept — they are genuinely separate completions", () => {
    const bound = boundCompletedConditions(["a", "b", "a"])
    expect(bound.retained).toEqual(["a", "b", "a"])
  })
})
