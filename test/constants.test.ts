import { describe, expect, test } from "bun:test"
import { BOUNDARY_DROP_FACTOR, BOUNDARY_LANDING_GRACE_MS, BOUNDARY_MIN_TOKENS, COMPACT_COOLDOWN_MS } from "../src/core/constants.ts"

// The boundary-compaction constants are the single source of truth shared by the controller
// (evidence checks, restore grace) and the compactor (request cooldown, minimum size).
// These tests pin the exact values and the relationships the two sides rely on, so an
// edit to one side cannot silently desynchronize the other.

describe("boundary-compaction constants", () => {
  test("pinned values", () => {
    expect(BOUNDARY_MIN_TOKENS).toBe(10_000)
    expect(BOUNDARY_DROP_FACTOR).toBe(0.6)
    expect(COMPACT_COOLDOWN_MS).toBe(120_000)
    expect(BOUNDARY_LANDING_GRACE_MS).toBe(600_000)
  })

  test("drop factor is a fraction the landing check can compare against", () => {
    expect(BOUNDARY_DROP_FACTOR).toBeGreaterThan(0)
    expect(BOUNDARY_DROP_FACTOR).toBeLessThan(1)
  })

  test("landing grace outlasts the request cooldown so a re-anchor cannot fight a fresh boundary request", () => {
    expect(BOUNDARY_LANDING_GRACE_MS).toBeGreaterThan(COMPACT_COOLDOWN_MS)
  })

  test("minimum size is a positive token count", () => {
    expect(Number.isInteger(BOUNDARY_MIN_TOKENS)).toBe(true)
    expect(BOUNDARY_MIN_TOKENS).toBeGreaterThan(0)
  })
})
