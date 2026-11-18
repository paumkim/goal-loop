/**
 * The loop-history retention cap, unit level: the bounding helper itself, the cap-aware count the
 * displays use, and the two artifact builders (spend ledger, dossier) saying so honestly when the
 * record was trimmed. The controller-level behavior is exercised end to end in test/loop.test.ts.
 */
import { describe, expect, test } from "bun:test"
import type { GoalSnapshot, LoopEntry, UsageSnapshot } from "../src/core/types.ts"
import { boundLoopHistory, completedIterationCount, MAX_LOOP_HISTORY_ENTRIES } from "../src/core/types.ts"
import { buildLoopDossier } from "../src/core/dossier.ts"
import { buildSpendLedger } from "../src/core/spend-ledger.ts"

const entry = (version: number): LoopEntry => ({
  version,
  condition: `condition ${version}`,
  summary: `summary ${version}`,
  reason: "met",
  turns: 3,
  toolCalls: 5,
  endedAt: 1_700_000_000_000 + version * 1000,
  sha: "a".repeat(40),
})
const entries = (from: number, to: number): LoopEntry[] => Array.from({ length: to - from + 1 }, (_, i) => entry(from + i))

const zero: UsageSnapshot = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

const goal = (loopHistory: LoopEntry[], loopHistoryDropped?: number): GoalSnapshot => ({
  version: 1,
  id: "goal-retention",
  sessionID: "ses_secret_session_id",
  directory: "/tmp/retention",
  condition: "ship it",
  status: "achieved",
  setAt: now - 1000 * 60 * 90,
  startedAt: now - 1000 * 60 * 90,
  endedAt: now,
  turns: 10,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: zero,
  history: [],
  loopEnabled: true,
  loopIteration: (loopHistoryDropped ?? 0) + loopHistory.length,
  loopObjective: "objective",
  loopMaxLoops: 100,
  loopHistory,
  ...(loopHistoryDropped !== undefined ? { loopHistoryDropped } : {}),
  loopNotProgress: 0,
  elapsedMs: 1000 * 60 * 90,
  evaluating: false,
  waiting: false,
  spend: zero,
})

const now = 1_800_000_000_000

describe("boundLoopHistory", () => {
  test("keeps everything at or below the cap and reports zero drops", () => {
    expect(boundLoopHistory([])).toEqual({ retained: [], dropped: 0 })
    const atCap = entries(1, MAX_LOOP_HISTORY_ENTRIES)
    const bound = boundLoopHistory(atCap)
    expect(bound.dropped).toBe(0)
    expect(bound.retained.map((e) => e.version)).toEqual(atCap.map((e) => e.version))
  })

  test("drops the oldest entries beyond the cap and keeps the newest", () => {
    const all = entries(1, MAX_LOOP_HISTORY_ENTRIES + 7)
    const bound = boundLoopHistory(all)
    expect(bound.dropped).toBe(7)
    expect(bound.retained).toHaveLength(MAX_LOOP_HISTORY_ENTRIES)
    expect(bound.retained[0]!.version).toBe(8)
    expect(bound.retained.at(-1)!.version).toBe(MAX_LOOP_HISTORY_ENTRIES + 7)
  })
})

describe("completedIterationCount", () => {
  test("is retained length when nothing was dropped (and 0 for empty/absent)", () => {
    expect(completedIterationCount({})).toBe(0)
    expect(completedIterationCount({ loopHistory: entries(1, 4) })).toBe(4)
  })

  test("adds the dropped count to the retained length", () => {
    expect(completedIterationCount({ loopHistory: entries(6, 10), loopHistoryDropped: 5 })).toBe(10)
  })
})

describe("artifacts say so when the record was trimmed", () => {
  test("spend ledger heading names retained vs landed and totals state the retained-only scope", () => {
    const ledger = buildSpendLedger(goal(entries(6, 10), 5), now)
    expect(ledger.markdown).toContain("## Per-iteration spend (5 most recent of 10 landed iterations)")
    expect(ledger.markdown).toContain("5 earlier iteration records dropped by the loop-history retention cap")
    expect(ledger.markdown).toContain("- Iterations recorded: 5 (+ 5 dropped by the retention cap; totals cover the retained iterations only)")
  })

  test("spend ledger is byte-identical in shape when nothing was dropped", () => {
    const ledger = buildSpendLedger(goal(entries(1, 3)), now)
    expect(ledger.markdown).toContain("## Per-iteration spend (3 landed iterations)")
    expect(ledger.markdown).not.toContain("retention cap")
    expect(ledger.markdown).toContain("- Iterations recorded: 3")
  })

  test("dossier heading names retained vs landed and carries the unknown-not-$0.00 note", () => {
    const doc = buildLoopDossier(goal(entries(6, 10), 5), now)
    expect(doc).toContain("## Completed iterations (5 most recent of 10)")
    expect(doc).toContain("5 earlier iteration records dropped by the loop-history retention cap")
    expect(doc).toContain("they are unknown")
  })

  test("dossier is unchanged in shape when nothing was dropped", () => {
    const doc = buildLoopDossier(goal(entries(1, 3)), now)
    expect(doc).toContain("## Completed iterations (3)")
    expect(doc).not.toContain("retention cap")
  })
})
