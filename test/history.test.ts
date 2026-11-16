import { describe, expect, test } from "bun:test"
import { BAR_CELLS, CONTEXT_BAR_CELLS, SPARK_MAX_CELLS, contextMeter, contextSparkline, barCaption, currentIterationVerdict, durationShares, iterationDurations, iterationVerdictMix, lastVerdict, localTime, loopTotals, paceEstimate, pauseDiagnostics, relativeTime, renderBar, renderPips, trailWindow, turnsSinceVerdict, verdictCounts, verdictGlyph, verdictStreak } from "../src/core/history.ts"
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

describe("verdictCounts", () => {
  test("tallies each verdict kind and the total", () => {
    const counts = verdictCounts([verdict(1, "not_met"), verdict(2, "met"), verdict(3, "not_met"), verdict(4, "impossible")])
    expect(counts).toEqual({ met: 1, not_met: 2, impossible: 1, total: 4 })
  })

  test("empty history yields all zeros", () => {
    expect(verdictCounts([])).toEqual({ met: 0, not_met: 0, impossible: 0, total: 0 })
  })
})

describe("lastVerdict", () => {
  test("returns the newest entry (history is oldest first)", () => {
    expect(lastVerdict([verdict(1, "not_met"), verdict(2, "met")])?.turn).toBe(2)
  })

  test("returns undefined for an empty history", () => {
    expect(lastVerdict([])).toBeUndefined()
  })
})

describe("renderPips", () => {
  test("renders filled and empty pips up to the cap", () => {
    expect(renderPips(2, 5)).toBe("●●○○○")
  })

  test("all completed renders all filled", () => {
    expect(renderPips(5, 5)).toBe("●●●●●")
  })

  test("done beyond the cap clamps", () => {
    expect(renderPips(9, 5)).toBe("●●●●●")
  })

  test("missing, zero, negative, NaN or oversized caps render nothing", () => {
    expect(renderPips(1, undefined)).toBe("")
    expect(renderPips(1, 0)).toBe("")
    expect(renderPips(1, -2)).toBe("")
    expect(renderPips(1, Number.NaN)).toBe("")
    expect(renderPips(1, 9)).toBe("")
  })

  test("zero done renders all empty", () => {
    expect(renderPips(0, 3)).toBe("○○○")
  })
})

describe("paceEstimate", () => {
  test("mean duration and remaining extrapolation", () => {
    expect(paceEstimate([10_000, 20_000], 4)).toEqual({ perIteration: 15_000, remaining: 30_000 })
  })

  test("no completed iterations yields undefined", () => {
    expect(paceEstimate([], 4)).toBeUndefined()
  })

  test("unknown or exhausted cap yields undefined", () => {
    expect(paceEstimate([10_000], undefined)).toBeUndefined()
    expect(paceEstimate([10_000], 0)).toBeUndefined()
    expect(paceEstimate([10_000], 1)).toBeUndefined()
  })
})

describe("iterationVerdictMix", () => {
  const setAt = 1_000
  const entries = [entry(1, 11_000), entry(2, 21_000)]

  test("assigns verdicts to their (from, to] windows, first anchored at setAt", () => {
    const history = [{ ...verdict(1, "not_met"), at: 5_000 }, { ...verdict(2, "met"), at: 9_000 }, { ...verdict(3, "not_met"), at: 10_000 }, { ...verdict(4, "met"), at: 20_000 }]
    const mixes = iterationVerdictMix(history, entries, setAt)
    expect(mixes[0]).toEqual({ met: 1, not_met: 2, impossible: 0, total: 3 })
    expect(mixes[1]).toEqual({ met: 1, not_met: 0, impossible: 0, total: 1 })
  })

  test("boundary verdict at exactly endedAt belongs to that iteration", () => {
    const history = [{ ...verdict(1, "met"), at: 11_000 }]
    expect(iterationVerdictMix(history, entries, setAt)[0]?.met).toBe(1)
  })

  test("iterations with no verdicts yield undefined", () => {
    const history = [{ ...verdict(1, "met"), at: 9_000 }]
    const mixes = iterationVerdictMix(history, entries, setAt)
    expect(mixes[0]?.total).toBe(1)
    expect(mixes[1]).toBeUndefined()
  })
})

describe("verdictStreak", () => {
  test("counts the trailing run of identical verdicts", () => {
    const history = [verdict(1, "met"), verdict(2, "not_met"), verdict(3, "not_met"), verdict(4, "not_met")]
    expect(verdictStreak(history)).toEqual({ verdict: "not_met", count: 3 })
  })

  test("a single trailing verdict has count 1", () => {
    expect(verdictStreak([verdict(1, "met")])).toEqual({ verdict: "met", count: 1 })
  })

  test("empty history yields verdict undefined and count 0", () => {
    expect(verdictStreak([])).toEqual({ verdict: undefined, count: 0 })
  })
})

describe("relativeTime", () => {
  const now = 100_000_000_000

  test("under a minute reads just now", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now")
  })

  test("minutes under an hour", () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago")
  })

  test("hours and remaining minutes under a day", () => {
    expect(relativeTime(now - (3 * 60 + 20) * 60_000, now)).toBe("3h 20m ago")
  })

  test("days and remaining hours beyond a day", () => {
    expect(relativeTime(now - (2 * 24 * 60 + 3 * 60) * 60_000, now)).toBe("2d 3h ago")
  })

  test("future timestamps clamp to just now", () => {
    expect(relativeTime(now + 60_000, now)).toBe("just now")
  })

  test("non-finite input yields just now", () => {
    expect(relativeTime(Number.NaN, now)).toBe("just now")
  })
})

describe("pauseDiagnostics", () => {
  test("renders floor-clamped stall and retries", () => {
    expect(pauseDiagnostics(3, 2)).toBe("stall 3 · retries 2")
    expect(pauseDiagnostics(2.9, -1)).toBe("stall 2 · retries 0")
    expect(pauseDiagnostics(Number.NaN, Number.NaN)).toBe("stall 0 · retries 0")
  })
})

describe("loopTotals", () => {
  const setAt = 1_000

  test("aggregates turns, tools and span from setAt to last endedAt", () => {
    const entries = [entry(1, 11_000, 10, 3), entry(2, 31_000, 20, 4)]
    expect(loopTotals(entries, setAt)).toEqual({ iterations: 2, turns: 7, tools: 30, spanMs: 30_000 })
  })

  test("empty history yields zeros and span 0", () => {
    expect(loopTotals([], setAt)).toEqual({ iterations: 0, turns: 0, tools: 0, spanMs: 0 })
  })

  test("last endedAt out of order cannot shrink the span below zero", () => {
    const entries = [entry(1, 500), entry(2, 2_000)]
    expect(loopTotals(entries, setAt).spanMs).toBe(1_000)
  })

  test("non-finite entry fields degrade to zero", () => {
    const entries = [{ ...entry(1, Number.NaN), turns: Number.NaN, toolCalls: Number.NaN }]
    expect(loopTotals(entries, setAt)).toEqual({ iterations: 1, turns: 0, tools: 0, spanMs: 0 })
  })
})

describe("localTime", () => {
  test("formats HH:MM zero-padded in local time", () => {
    const ms = new Date(2026, 10, 15, 9, 5).getTime()
    expect(localTime(ms)).toBe("09:05")
  })

  test("non-finite input yields --:--", () => {
    expect(localTime(Number.NaN)).toBe("--:--")
    expect(localTime(Number.POSITIVE_INFINITY)).toBe("--:--")
  })
})

describe("currentIterationVerdict", () => {
  const setAt = 1_000
  const entries = [entry(1, 11_000), entry(2, 21_000)]

  test("returns the newest verdict inside the current iteration window", () => {
    const history = [
      { ...verdict(8, "met"), at: 9_000 },
      { ...verdict(9, "not_met"), at: 15_000 },
      { ...verdict(10, "not_met"), at: 25_000 },
    ]
    expect(currentIterationVerdict(history, entries, setAt)?.turn).toBe(10)
  })

  test("window opens at setAt for a loop that has completed nothing", () => {
    const history = [{ ...verdict(1, "not_met"), at: 5_000 }]
    expect(currentIterationVerdict(history, [], setAt)?.turn).toBe(1)
  })

  test("verdicts at or before the last iteration's endedAt belong to the previous iteration", () => {
    const history = [{ ...verdict(3, "met"), at: 21_000 }]
    expect(currentIterationVerdict(history, entries, setAt)).toBeUndefined()
  })

  test("empty history yields undefined", () => {
    expect(currentIterationVerdict([], entries, setAt)).toBeUndefined()
  })
})

describe("turnsSinceVerdict", () => {
  test("difference clamped to >= 0", () => {
    expect(turnsSinceVerdict(4, 3)).toBe(1)
    expect(turnsSinceVerdict(3, 3)).toBe(0)
    expect(turnsSinceVerdict(2, 3)).toBe(0)
  })

  test("non-finite input yields 0", () => {
    expect(turnsSinceVerdict(Number.NaN, 3)).toBe(0)
    expect(turnsSinceVerdict(4, Number.NaN)).toBe(0)
  })
})

describe("durationShares", () => {
  test("even split sums to ~100", () => {
    expect(durationShares([10_000, 10_000])).toEqual([50, 50])
  })

  test("uneven split rounds to integers", () => {
    expect(durationShares([1_000, 3_000])).toEqual([25, 75])
  })

  test("zero-sum input yields all zeros", () => {
    expect(durationShares([0, 0, 0])).toEqual([0, 0, 0])
  })

  test("single iteration takes 100", () => {
    expect(durationShares([42_000])).toEqual([100])
  })

  test("non-finite spans degrade to zero", () => {
    expect(durationShares([Number.NaN, 8_000])).toEqual([0, 100])
  })
})

describe("contextSparkline", () => {
  test("returns undefined when no entry carries a finite non-negative estimate — the row is omitted", () => {
    expect(contextSparkline([])).toBeUndefined()
    expect(contextSparkline([{}, {}])).toBeUndefined()
    expect(contextSparkline([{ contextTokens: Number.NaN }, { contextTokens: Number.POSITIVE_INFINITY }, { contextTokens: -1 }, { contextTokens: "41k" as unknown as number }])).toBeUndefined()
  })

  test("renders one glyph per entry, gaps as ·, peak-relative heights, newest present as latest", () => {
    const spark = contextSparkline([{ contextTokens: 10_000 }, {}, { contextTokens: 40_000 }, { contextTokens: 80_000 }])!
    expect(spark.bars).toBe("▂·▅█")
    expect(spark.peak).toBe(80_000)
    expect(spark.latest).toBe(80_000)
    expect(spark.shown).toBe(3)
    expect(spark.truncated).toBe(false)
  })

  test("a present-but-tiny estimate still renders ▁ (present data is not a gap); peak 0 renders all ▁", () => {
    expect(contextSparkline([{ contextTokens: 0 }, { contextTokens: 0 }])!.bars).toBe("▁▁")
    expect(contextSparkline([{ contextTokens: 1 }, { contextTokens: 80_000 }])!.bars).toBe("▁█")
  })

  test("latest skips trailing gaps; middle gaps do not collapse the timeline", () => {
    const spark = contextSparkline([{ contextTokens: 5_000 }, {}, {}])!
    expect(spark.latest).toBe(5_000)
    expect(spark.bars).toBe("█··")
  })

  test("past SPARK_MAX_CELLS the window keeps the newest entries behind a leading …", () => {
    const entries = Array.from({ length: SPARK_MAX_CELLS + 4 }, (_, index) => ({ contextTokens: 1_000 * (index + 1) }))
    const spark = contextSparkline(entries)!
    expect(spark.truncated).toBe(true)
    expect(spark.bars.startsWith("…")).toBe(true)
    expect([...spark.bars.slice(1)]).toHaveLength(SPARK_MAX_CELLS)
    expect(spark.peak).toBe(1_000 * (SPARK_MAX_CELLS + 4))
  })
})

describe("contextMeter", () => {
  test("renders a proportionate fill against the threshold", () => {
    const meter = contextMeter(75_000, 150_000)
    expect(meter.filled).toBe(8)
    expect(meter.pct).toBe(50)
    expect(meter.hot).toBe(false)
    expect(meter.over).toBe(false)
    expect(meter.text).toBe("█".repeat(8) + "░".repeat(CONTEXT_BAR_CELLS - 8))
  })

  test("clamps to a full bar past the threshold; pct stays honest above 100", () => {
    const meter = contextMeter(180_000, 150_000)
    expect(meter.filled).toBe(CONTEXT_BAR_CELLS)
    expect(meter.pct).toBe(120)
    expect(meter.hot).toBe(true)
    expect(meter.over).toBe(true)
  })

  test("the hot band begins at 80% of the threshold", () => {
    expect(contextMeter(119_000, 150_000).hot).toBe(false)
    expect(contextMeter(120_000, 150_000).hot).toBe(true)
  })

  test("zero or disabled capacity yields no bar and no pct", () => {
    for (const capacity of [undefined, 0, -1, Number.NaN]) {
      const meter = contextMeter(95_000, capacity)
      expect(meter.filled).toBe(0)
      expect(meter.pct).toBeUndefined()
      expect(meter.hot).toBe(false)
      expect(meter.text).toBe("░".repeat(CONTEXT_BAR_CELLS))
    }
  })

  test("non-finite size degrades to an empty bar, never NaN", () => {
    const meter = contextMeter(Number.NaN, 150_000)
    expect(meter.filled).toBe(0)
    expect(meter.pct).toBe(0)
    expect(meter.hot).toBe(false)
  })
})

describe("ASCII demotion (NO_COLOR / TERM=dumb)", () => {
  test("renderBar paints the same shape in ink-density ASCII under ascii=true", () => {
    expect(renderBar(1, 2, 8, true).text).toBe("####----")
    expect(renderBar(0, 5, 8, true).text).toBe("--------")
    expect(renderBar(5, 5, 8, true).text).toBe("########")
    expect(renderBar(99, 5, 8, true).text).toBe("########")
    expect(renderBar(1, 2, 8).text).toBe("████░░░░")
  })

  test("contextSparkline maps levels onto the ASCII ramp, gaps become voids, truncation becomes >", () => {
    // Level = min(7, floor(value / peak * 8)) onto ".", ":", "-", "=", "+", "*", "#", "@"
    const ramp = contextSparkline([{ contextTokens: 10_000 }, {}, { contextTokens: 40_000 }, { contextTokens: 80_000 }], true)!
    // idx 1 = ":" (10k/80k), gap = " " (void), idx 4 = "+" (40k/80k), idx 7 = "@" (peak) — exactly four cells
    expect(ramp.bars).toBe(": +@")
    const truncated = contextSparkline(Array.from({ length: 20 }, (_, index) => ({ contextTokens: (index + 1) * 1_000 })), true)!
    expect(truncated.bars.startsWith(">")).toBe(true)
    expect(truncated.bars).not.toContain("…")
  })

  test("contextSparkline ascii peak-0 renders the lowest ramp glyph, not eighth-blocks", () => {
    const spark = contextSparkline([{ contextTokens: 0 }, { contextTokens: 0 }], true)!
    expect(spark.bars).toBe("..")
    expect(spark.bars).not.toContain("▁")
  })

  test("contextMeter paints the same shape in ink-density ASCII under ascii=true", () => {
    const meter = contextMeter(50_000, 100_000, 10, true)
    expect(meter.text).toBe("#####-----")
    expect(meter.pct).toBe(50)
    expect(contextMeter(0, undefined, 10, true).text).toBe("----------")
  })
})
