/**
 * Unit pins for src/core/attestation.ts — the quotable tallies. Paint and copy share this
 * one builder, so the copy can never quote numbers the paint disagrees with.
 */
import { describe, expect, test } from "bun:test"
import { iterationAttestation, finalTallyLine, quoteSha } from "../src/core/attestation.ts"
import type { LoopEntry } from "../src/core/types.ts"

const entry = (overrides: Partial<LoopEntry> = {}): LoopEntry => ({
  version: 2,
  condition: "make the loop visible",
  summary: "Rendered the rail.",
  reason: "met",
  turns: 6,
  toolCalls: 23,
  endedAt: 1_800_000_000_000,
  ...overrides,
})

describe("quoteSha", () => {
  test("slices the leading seven cells off the record's own stamp", () => {
    expect(quoteSha("a1b2c3d4e5f6")).toBe("a1b2c3d")
  })
  test("a short sha passes through whole", () => {
    expect(quoteSha("abc123")).toBe("abc123")
  })
  test("absent, blank or non-string input yields undefined — never guessed", () => {
    expect(quoteSha(undefined)).toBeUndefined()
    expect(quoteSha("")).toBeUndefined()
    expect(quoteSha("   ")).toBeUndefined()
  })
})

describe("iterationAttestation", () => {
  test("the full receipt: version, verdict, turns, tools, duration, sha, cost", () => {
    const line = iterationAttestation(entry({ sha: "a1b2c3d4e5f6", spend: { cost: 0.42, input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }), 900_000)
    expect(line).toBe("v2 · met · 6 turns · 23 tools · 15m 00s · a1b2c3d · $0.42")
  })
  test("singular forms hold at one turn and one tool", () => {
    expect(iterationAttestation(entry({ turns: 1, toolCalls: 1 }), 30_000)).toBe("v2 · met · 1 turn · 1 tool · 30s")
  })
  test("an hour-long iteration renders the h/mm form", () => {
    expect(iterationAttestation(entry(), 5_400_000)).toBe("v2 · met · 6 turns · 23 tools · 1h 30m")
  })
  test("zero tools keeps the already-satisfied-at-HEAD tag — the quote explains itself", () => {
    expect(iterationAttestation(entry({ toolCalls: 0 }), 60_000)).toBe("v2 · met · 6 turns · 0 tools · 1m 00s · already satisfied at HEAD")
  })
  test("a non-finite or zero duration is omitted, never a 0s that lies about being measured", () => {
    expect(iterationAttestation(entry(), 0)).toBe("v2 · met · 6 turns · 23 tools")
    expect(iterationAttestation(entry(), Number.NaN)).toBe("v2 · met · 6 turns · 23 tools")
    expect(iterationAttestation(entry(), -5)).toBe("v2 · met · 6 turns · 23 tools")
  })
  test("an absent or blank sha is omitted", () => {
    expect(iterationAttestation(entry(), 60_000)).not.toContain("· undefined")
    expect(iterationAttestation(entry({ sha: "" }), 60_000)).not.toContain("·  ·")
  })
  test("a zero cost is omitted, not painted as $0", () => {
    const line = iterationAttestation(entry({ spend: { cost: 0, input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }), 60_000)
    expect(line).not.toContain("$0")
  })
  test("a non-finite cost is omitted, not painted as NaN", () => {
    const line = iterationAttestation(entry({ spend: { cost: Number.NaN, input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }), 60_000)
    expect(line).not.toContain("NaN")
  })
  test("non-finite turns and tools clamp to zero rather than paint garbage", () => {
    expect(iterationAttestation(entry({ turns: Number.NaN, toolCalls: Number.NaN }), 60_000)).toBe("v2 · met · 0 turns · 0 tools · 1m 00s · already satisfied at HEAD")
  })
})

describe("finalTallyLine", () => {
  const totals = (overrides: Partial<{ iterations: number; turns: number; tools: number; spanMs: number; spend?: { total: number; measured: number } }> = {}) => ({
    iterations: 5,
    turns: 84,
    tools: 301,
    spanMs: 47 * 60_000,
    ...overrides,
  })

  test("the full tally: status, iterations, turns, tools, wall, cost", () => {
    expect(finalTallyLine("achieved", totals({ spend: { total: 12.34, measured: 5 } }))).toBe("loop achieved · 5 iterations · 84 turns · 301 tools · 47m wall · $12.34")
  })
  test("an hour-scale loop renders the h/mm wall form", () => {
    expect(finalTallyLine("impossible", totals({ spanMs: 47 * 3_600_000 }))).toBe("loop impossible · 5 iterations · 84 turns · 301 tools · 47h00m wall")
  })
  test("a sub-minute loop says <1m wall", () => {
    expect(finalTallyLine("achieved", totals({ spanMs: 30_000 }))).toBe("loop achieved · 5 iterations · 84 turns · 301 tools · <1m wall")
  })
  test("partial spend measurement is never presented as complete", () => {
    expect(finalTallyLine("achieved", totals({ spend: { total: 12.34, measured: 3 } }))).toBe("loop achieved · 5 iterations · 84 turns · 301 tools · 47m wall · $12.34 across 3/5 measured")
  })
  test("no spend measurement at all paints no cost — never a fabricated $0", () => {
    expect(finalTallyLine("failed", totals())).not.toContain("$")
  })
  test("singular iteration form holds at one", () => {
    expect(finalTallyLine("achieved", totals({ iterations: 1 }))).toContain("1 iteration ·")
  })
  test("a non-finite wall clamps to zero — never NaNhNaNm", () => {
    expect(finalTallyLine("achieved", totals({ spanMs: Number.NaN }))).toBe("loop achieved · 5 iterations · 84 turns · 301 tools · <1m wall")
  })
})
