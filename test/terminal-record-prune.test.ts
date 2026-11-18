/**
 * Terminal goal records at plugin storage are bounded: restore/startup prunes achieved/impossible/cleared/failed
 * records past an explicit age cap (30 days, by `endedAt` falling back to `startedAt`) and an explicit per-directory
 * count cap (newest 50 kept). Live records (active/paused) are never pruned; other directories' records are never
 * touched; terminal records with no usable stamp are kept and reported, never silently dropped.
 *
 * The pure selection helper is tested here at unit level; the controller-level restore path (prune runs before
 * adoption, active records survive, the log report carries counts) is covered in test/controller.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  MAX_TERMINAL_RECORD_ENTRIES,
  selectTerminalRecordsToPrune,
  TERMINAL_RECORD_MAX_AGE_MS,
  type GoalRecord,
  type GoalStatus,
} from "../src/core/types.ts"

const NOW = 2_000_000_000_000
const DAY = 24 * 60 * 60 * 1000

let seq = 0
const record = (status: GoalStatus, at?: { setAt?: number; startedAt?: number; endedAt?: number }): GoalRecord => ({
  version: 1,
  id: `goal_${++seq}`,
  sessionID: `ses_${seq}`,
  directory: "C:/work/project",
  condition: "improve the parser",
  status,
  setAt: at?.setAt ?? NOW - DAY,
  startedAt: at?.startedAt ?? at?.setAt ?? NOW - DAY,
  ...(at?.endedAt !== undefined ? { endedAt: at.endedAt } : {}),
  turns: 0,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [],
})

describe("selectTerminalRecordsToPrune", () => {
  test("live records are never offered for pruning, whatever their age", () => {
    const ancient = NOW - 400 * DAY
    const records = [
      record("active", { startedAt: ancient, endedAt: ancient }),
      record("paused", { startedAt: ancient, endedAt: ancient }),
    ]
    const selection = selectTerminalRecordsToPrune(records, NOW)
    expect(selection.pruned).toEqual([])
    expect(selection.offered).toBe(0)
  })

  test("terminal records past the age cap are pruned; recent ones are kept", () => {
    const records = [
      record("achieved", { startedAt: NOW - 40 * DAY, endedAt: NOW - 40 * DAY }),
      record("failed", { startedAt: NOW - 29 * DAY, endedAt: NOW - 29 * DAY }),
      record("cleared", { startedAt: NOW - 90 * DAY, endedAt: NOW - 90 * DAY }),
      record("impossible", { startedAt: NOW - 31 * DAY, endedAt: NOW - 31 * DAY }),
    ]
    const selection = selectTerminalRecordsToPrune(records, NOW)
    expect(selection.droppedAged).toBe(3)
    expect(selection.pruned).toHaveLength(3)
    expect(selection.droppedBeyondCap).toBe(0)
  })

  test("a record exactly at the age boundary is kept (the cap is strictly older-than)", () => {
    const records = [record("achieved", { startedAt: NOW - TERMINAL_RECORD_MAX_AGE_MS, endedAt: NOW - TERMINAL_RECORD_MAX_AGE_MS })]
    expect(selectTerminalRecordsToPrune(records, NOW).pruned).toEqual([])
  })

  test("the count cap keeps the newest 50 fresh terminal records and drops the rest", () => {
    const records = Array.from({ length: MAX_TERMINAL_RECORD_ENTRIES + 7 }, (_, i) =>
      record("achieved", { startedAt: NOW - i * 60_000, endedAt: NOW - i * 60_000 }),
    )
    const selection = selectTerminalRecordsToPrune(records, NOW)
    expect(selection.droppedAged).toBe(0)
    expect(selection.droppedBeyondCap).toBe(7)
    expect(selection.pruned).toHaveLength(7)
    // The seven oldest fresh records are dropped; the newest survive.
    const kept = records.length - selection.pruned.length
    expect(kept).toBe(MAX_TERMINAL_RECORD_ENTRIES)
  })

  test("age prunes before the count cap applies, and both counts are reported separately", () => {
    const aged = Array.from({ length: 3 }, () => record("achieved", { startedAt: NOW - 100 * DAY, endedAt: NOW - 100 * DAY }))
    const fresh = Array.from({ length: MAX_TERMINAL_RECORD_ENTRIES + 4 }, (_, i) =>
      record("cleared", { startedAt: NOW - i * 60_000, endedAt: NOW - i * 60_000 }),
    )
    const selection = selectTerminalRecordsToPrune([...aged, ...fresh], NOW)
    expect(selection.droppedAged).toBe(3)
    expect(selection.droppedBeyondCap).toBe(4)
    expect(selection.pruned).toHaveLength(7)
  })

  test("terminal records with no usable stamp are kept and counted, never pruned", () => {
    const unstamped = record("achieved", {})
    delete (unstamped as { startedAt?: number }).startedAt
    delete (unstamped as { setAt?: number }).setAt
    const selection = selectTerminalRecordsToPrune([unstamped], NOW)
    expect(selection.pruned).toEqual([])
    expect(selection.unstampedKept).toBe(1)
  })

  test("endedAt wins over startedAt for the age judgment", () => {
    // Armed long ago but finished recently: fresh, kept.
    const records = [record("achieved", { startedAt: NOW - 100 * DAY, endedAt: NOW - DAY })]
    expect(selectTerminalRecordsToPrune(records, NOW).pruned).toEqual([])
    // Armed recently but endedAt stamped far in the past (legacy/corrupt clock): judged by endedAt.
    const corrupt = [record("achieved", { startedAt: NOW - DAY, endedAt: NOW - 100 * DAY })]
    expect(selectTerminalRecordsToPrune(corrupt, NOW).droppedAged).toBe(1)
  })
})
