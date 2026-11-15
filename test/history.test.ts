import { describe, expect, test } from "bun:test"
import { BAR_CELLS, barCaption, iterationDurations, renderBar, trailWindow, verdictGlyph } from "../src/core/history.ts"
import type { LoopEntry, VerdictEntry } from "../src/core/types.ts"

const entry = (version: number, endedAt: number, toolCalls = 0, turns = 1): LoopEntry => ({
  version,
  condition: `cond ${version}`,
  summary: `summary ${version}`,
  reason: "met",
  turns,
  toolCalls,
  endedAt,
})

const verdict = (turn: number, verdict: VerdictEntry["verdict"]): VerdictEntry => ({ turn, verdict, reason: "", at: turn * 1000 })

describe("renderBar", () => {
  test("zero done renders all empty", () => {
    const bar = renderBar(0, 5)
    expect(bar.filled).toBe(0)
    expect(bar.text).toBe("░".repeat(BAR_CELLS))
  })

  test("full done renders all filled", () => {
    expect(renderBar(5, 5).text).toBe("█".repeat(BAR_CELLS))
  })

  test("half rounds to the nearest cell", () => {
    expect(renderBar(1, 2).filled).toBe(9)
  })

  test("clamps when done exceeds max", () => {
    const bar = renderBar(7, 5)
    expect(bar.filled).toBe(BAR_CELLS)
  })

  test("missing or zero max never divides by zero and renders empty", () => {
    expect(renderBar(2, undefined).filled).toBe(0)
    expect(renderBar(2, 0).filled).toBe(0)
    expect(renderBar(2, Number.NaN).filled).toBe(0)
  })

  test("negative done clamps to zero", () => {
    expect(renderBar(-3, 5).filled).toBe(0)
  })

  test("custom cell count is honored", () => {
    expect(renderBar(1, 2, 10).text).toBe("█████░░░░░")
  })
})

describe("barCaption", () => {
  test("with a max shows the cap and the completion count", () => {
    expect(barCaption(3, 5, 2)).toBe("v3 of at most 5 · 2 complete")
  })

  test("without a max omits the cap", () => {
    expect(barCaption(3, undefined, 2)).toBe("v3 · 2 complete")
    expect(barCaption(3, 0, 2)).toBe("v3 · 2 complete")
  })

  test("degenerate inputs clamp to v1 / zero complete", () => {
    expect(barCaption(0, 5, -1)).toBe("v1 of at most 5 · 0 complete")
    expect(barCaption(Number.NaN, 5, Number.NaN)).toBe("v1 of at most 5 · 0 complete")
  })
})

describe("verdictGlyph", () => {
  test("maps each verdict", () => {
    expect(verdictGlyph("met")).toBe("✓")
    expect(verdictGlyph("not_met")).toBe("✗")
    expect(verdictGlyph("impossible")).toBe("⊘")
  })
})

describe("iterationDurations", () => {
  test("v1 anchors at setAt, later iterations at the previous endedAt", () => {
    const setAt = 1_000
    const entries = [entry(1, 11_000), entry(2, 21_000), entry(3, 31_000)]
    expect(iterationDurations(entries, setAt)).toEqual([10_000, 10_000, 10_000])
  })

  test("negative spans clamp to zero and the anchor does not move backwards", () => {
    const setAt = 1_000
    const entries = [entry(1, 500), entry(2, 4_000)]
    expect(iterationDurations(entries, setAt)).toEqual([0, 3_500])
  })

  test("empty history yields no durations", () => {
    expect(iterationDurations([], 1_000)).toEqual([])
  })
})

describe("trailWindow", () => {
  const history = Array.from({ length: 30 }, (_, index) => verdict(index + 1, index % 3 === 0 ? "met" : "not_met"))

  test("keeps the newest `limit` entries, oldest first", () => {
    const { shown, total } = trailWindow(history, 24)
    expect(total).toBe(30)
    expect(shown).toHaveLength(24)
    expect(shown[0]?.turn).toBe(7)
    expect(shown[shown.length - 1]?.turn).toBe(30)
  })

  test("returns everything when the limit covers the history", () => {
    const { shown, total } = trailWindow(history, 40)
    expect(total).toBe(30)
    expect(shown).toHaveLength(30)
  })

  test("empty history yields an empty window", () => {
    expect(trailWindow([], 24)).toEqual({ shown: [], total: 0 })
  })
})
