/**
 * Regression test for the "stuck on checking" symptom: the evaluator returns a verdict, the backend commits
 * and emits `changed` with the flag flipped, and the TUI's intake must store the flip so every chrome
 * reading the entries cache (the ambient pill, the jump row, the dialog) leaves the "checking" state without
 * a harness restart. The pipeline under test is the exact one the live TUI runs: the RPC payload through
 * parseChangedEvent, then the entries-store transition, then the pill's tone/text.
 */
import { describe, expect, test } from "bun:test"
import { applySnapshot, type GoalSnapshotCacheEntry } from "../src/core/entries.ts"
import { isGoalSnapshot, parseChangedEvent } from "../src/core/wire.ts"
import { pillModel } from "../src/core/hud.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const now = 1_800_000_000_000
const baseline = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

const snapshot = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_ws",
  sessionID: "ses_ws",
  directory: "/tmp/ws",
  condition: "ship it",
  status: "active",
  setAt: now - 100_000,
  startedAt: now - 100_000,
  turns: 0,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline,
  history: [],
  elapsedMs: 10_000,
  evaluating: false,
  waiting: false,
  ...overrides,
})

const entriesOf = (goal: GoalSnapshot): Readonly<Record<string, GoalSnapshotCacheEntry>> => ({
  ses_ws: { goal, receivedAt: now - 20_000 },
})

describe("verdict -> entries-store transition", () => {
  test("an evaluating snapshot paints the pill in the checking state", () => {
    const goal = snapshot({ evaluating: true })
    expect(isGoalSnapshot(goal)).toBe(true)
    const pill = pillModel(goal, 60_000)
    expect(pill.tone).toBe("evaluating")
    expect(pill.text).toContain("checking")
  })

  test("a verdict-shaped changed event clears evaluating and the pill leaves checking", () => {
    const inFlight = snapshot({ evaluating: true, turns: 3, history: [{ turn: 3, verdict: "not_met", reason: "not yet", at: now - 5_000, toolCalls: 7 }] })
    const entries = entriesOf(inFlight)
    const verdict = snapshot({
      evaluating: false,
      turns: 3,
      verdict: "not_met",
      reason: "keep going",
      history: [{ turn: 3, verdict: "not_met", reason: "keep going", at: now, toolCalls: 7 }],
    })
    // The backend commits the verdict and emits it over the bus; the payload arrives as published.
    const parsed = parseChangedEvent({ sessionID: "ses_ws", goal: verdict })
    expect(parsed?.goal?.evaluating).toBe(false)
    const next = applySnapshot(entries, "ses_ws", parsed?.goal ?? null, now, undefined)
    expect(next.ses_ws?.goal?.evaluating).toBe(false)
    expect(next.ses_ws?.goal?.reason).toBe("keep going")
    const pill = pillModel(next.ses_ws?.goal as GoalSnapshot, 60_000)
    expect(pill.tone).not.toBe("evaluating")
    expect(pill.text).not.toContain("checking")
  })

  test("a met verdict landing terminal flips the pill to the achieved state, not checking", () => {
    const inFlight = snapshot({ evaluating: true, loopEnabled: true, loopIteration: 2, loopMaxLoops: 5, loopHistory: [] })
    const entries = entriesOf(inFlight)
    const done = snapshot({
      status: "achieved",
      evaluating: false,
      endedAt: now,
      turns: 4,
      loopEnabled: true,
      loopIteration: 3,
      loopMaxLoops: 5,
      loopHistory: [{ version: 2, condition: "ship it", summary: "shipped", reason: "verified", turns: 4, toolCalls: 9, endedAt: now }],
      loopNotProgress: 0,
    })
    const parsed = parseChangedEvent({ sessionID: "ses_ws", goal: done })
    const next = applySnapshot(entries, "ses_ws", parsed?.goal ?? null, now, undefined)
    expect(next.ses_ws?.goal?.status).toBe("achieved")
    expect(next.ses_ws?.goal?.evaluating).toBe(false)
  })

  test("an unchanged snapshot re-stamps receivedAt and keeps the goal reference (no spurious re-render)", () => {
    const goal = snapshot({ evaluating: false })
    const entries = entriesOf(goal)
    const same = snapshot({ evaluating: false, elapsedMs: 999_000 })
    const next = applySnapshot(entries, "ses_ws", same, now, undefined)
    expect(next.ses_ws?.goal).toBe(goal)
    expect(next.ses_ws?.receivedAt).toBe(now)
  })

  test("a malformed changed payload is rejected by the wire narrow — the cached entry survives untouched", () => {
    const inFlight = snapshot({ evaluating: true })
    const entries = entriesOf(inFlight)
    expect(parseChangedEvent({ sessionID: "ses_ws", goal: { ...inFlight, evaluating: "yes" } })).toBeUndefined()
    // What the intake does with a dropped event: nothing.
    expect(entries.ses_ws?.goal?.evaluating).toBe(true)
  })

  test("an explicit null (goal cleared elsewhere) clears the cached pill target", () => {
    const inFlight = snapshot({ evaluating: true })
    const entries = entriesOf(inFlight)
    const parsed = parseChangedEvent({ sessionID: "ses_ws", goal: null })
    expect(parsed?.goal).toBeNull()
    const next = applySnapshot(entries, "ses_ws", parsed?.goal ?? null, now, undefined)
    expect(next.ses_ws?.goal).toBeNull()
  })
})
