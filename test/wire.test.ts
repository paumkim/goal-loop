import { describe, expect, test } from "bun:test"
import type { GoalSnapshot, Notice } from "../src/core/types.ts"
import {
  isGoalSnapshot,
  isRecord,
  parseChangedEvent,
  parseGetGoalOutput,
  parseGoalSnapshot,
  parseNotice,
} from "../src/core/wire.ts"

const snapshot = (): GoalSnapshot => ({
  version: 1,
  id: "goal-1",
  sessionID: "ses_test",
  directory: "/work/project",
  condition: "tests pass",
  status: "active",
  setAt: 1_000,
  startedAt: 1_000,
  turns: 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0.5, input: 10, output: 20, reasoning: 5, cacheRead: 1, cacheWrite: 2 },
  history: [{ turn: 1, verdict: "not_met", reason: "close", at: 900 }],
  elapsedMs: 60_000,
  evaluating: false,
  waiting: false,
})

const loopedSnapshot = (): GoalSnapshot => ({
  ...snapshot(),
  loopEnabled: true,
  loopIteration: 2,
  loopObjective: "ship it",
  loopMaxLoops: 5,
  loopNotProgress: 1,
  loopHistory: [{ version: 1, condition: "v1 done", summary: "s", reason: "r", turns: 3, toolCalls: 7, endedAt: 800 }],
  loopCompact: { requestedAt: 700, estimatedTokens: 1234, iteration: 2, misses: 2, landedAt: 750, unmeasurableTicks: 1, stalenessUnknown: true, unwillingWarned: true },
  spend: { cost: 1, input: 2, output: 3, reasoning: 4, cacheRead: 5, cacheWrite: 6 },
})

const notice = (): Notice => ({ sessionID: "ses_test", kind: "achieved", level: "success", title: "Goal achieved", message: "done" })

/** Deep-clone and break one named top-level field, so each rejection case is explicit. */
const broken = (mutate: (draft: Record<string, unknown>) => void): Record<string, unknown> => {
  const draft: Record<string, unknown> = JSON.parse(JSON.stringify(snapshot()))
  mutate(draft)
  return draft
}

describe("isRecord", () => {
  test("accepts plain objects, rejects arrays, null and primitives", () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord("goal")).toBe(false)
    expect(isRecord(1)).toBe(false)
  })
})

describe("parseGoalSnapshot", () => {
  test("accepts a valid snapshot and one with the full loop read model", () => {
    expect(parseGoalSnapshot(snapshot())?.sessionID).toBe("ses_test")
    expect(parseGoalSnapshot(loopedSnapshot())?.loopIteration).toBe(2)
  })

  test("accepts omitted optional fields (legacy records)", () => {
    expect(parseGoalSnapshot(snapshot())?.reason).toBeUndefined()
    expect(parseGoalSnapshot(snapshot())?.loopHistory).toBeUndefined()
  })

  test("rejects each broken required field", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["not a record", {}],
      ["wrong version", broken((d) => void (d.version = 2))],
      ["missing id", broken((d) => void delete d.id)],
      ["empty sessionID", broken((d) => void (d.sessionID = ""))],
      ["missing directory", broken((d) => void delete d.directory)],
      ["missing condition", broken((d) => void delete d.condition)],
      ["unknown status", broken((d) => void (d.status = "running"))],
      ["non-numeric setAt", broken((d) => void (d.setAt = "1000"))],
      ["non-numeric turns", broken((d) => void (d.turns = "2"))],
      ["missing baseline", broken((d) => void delete d.baseline)],
      ["baseline with a string cost", broken((d) => void ((d.baseline as Record<string, unknown>).cost = "0.5"))],
      ["history entry with an unknown verdict", broken((d) => void (d.history = [{ turn: 1, verdict: "done", reason: "r", at: 1 }]))],
      ["history entry with a non-numeric turn", broken((d) => void (d.history = [{ turn: "1", verdict: "met", reason: "r", at: 1 }]))],
      ["missing elapsedMs", broken((d) => void delete d.elapsedMs)],
      ["NaN elapsedMs", broken((d) => void (d.elapsedMs = Number.NaN))],
      ["non-boolean evaluating", broken((d) => void (d.evaluating = "no"))],
      ["non-boolean waiting", broken((d) => void (d.waiting = 1))],
    ]
    for (const [, value] of cases) expect(parseGoalSnapshot(value)).toBeUndefined()
  })

  test("rejects broken optional fields when present", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["loopEnabled as string", broken((d) => void (d.loopEnabled = "yes"))],
      ["loopIteration as string", broken((d) => void (d.loopIteration = "2"))],
      ["loopObjective as number", broken((d) => void (d.loopObjective = 7))],
      ["loopMaxLoops as string", broken((d) => void (d.loopMaxLoops = "5"))],
      ["loopHistory with a broken entry", broken((d) => void (d.loopHistory = [{ version: 1, condition: "c", summary: "s", reason: "r", turns: 1 }]))],
      ["loopCompact without misses", broken((d) => void (d.loopCompact = { requestedAt: 1, iteration: 1 }))],
      ["spend with a string output", broken((d) => void (d.spend = { cost: 0, input: 0, output: "0", reasoning: 0, cacheRead: 0, cacheWrite: 0 }))],
      ["unknown reason type", broken((d) => void (d.reason = 42))],
      ["unknown verdict", broken((d) => void (d.verdict = "sure"))],
    ]
    for (const [, value] of cases) expect(parseGoalSnapshot(value)).toBeUndefined()
  })

  test("isGoalSnapshot agrees with parseGoalSnapshot", () => {
    expect(isGoalSnapshot(loopedSnapshot())).toBe(true)
    expect(isGoalSnapshot(broken((d) => void (d.status = "nope")))).toBe(false)
  })
})

describe("parseGetGoalOutput", () => {
  test("narrows { goal: snapshot } and { goal: null }", () => {
    expect(parseGetGoalOutput({ goal: snapshot() })?.goal).toEqual(snapshot())
    expect(parseGetGoalOutput({ goal: null })).toEqual({ goal: null })
    expect(parseGetGoalOutput({ goal: snapshot(), extra: "tolerated" })?.goal).toEqual(snapshot())
  })

  test("drops unusable payloads instead of caching garbage", () => {
    expect(parseGetGoalOutput(null)).toBeUndefined()
    expect(parseGetGoalOutput(undefined)).toBeUndefined()
    expect(parseGetGoalOutput("goal")).toBeUndefined()
    expect(parseGetGoalOutput([])).toBeUndefined()
    expect(parseGetGoalOutput({})).toBeUndefined()
    expect(parseGetGoalOutput({ goal: "garbage" })).toBeUndefined()
    expect(parseGetGoalOutput({ goal: { version: 1 } })).toBeUndefined()
  })
})

describe("parseChangedEvent", () => {
  test("narrows sessionID and goal", () => {
    expect(parseChangedEvent({ sessionID: "ses_a", goal: snapshot() })).toEqual({ sessionID: "ses_a", goal: snapshot() })
    expect(parseChangedEvent({ sessionID: "ses_a", goal: null })).toEqual({ sessionID: "ses_a", goal: null })
    // An absent goal key means the goal was cleared (parity with the previous `?? null` behavior).
    expect(parseChangedEvent({ sessionID: "ses_a" })).toEqual({ sessionID: "ses_a", goal: null })
  })

  test("drops the event when sessionID is missing or malformed", () => {
    expect(parseChangedEvent(null)).toBeUndefined()
    expect(parseChangedEvent({})).toBeUndefined()
    expect(parseChangedEvent({ sessionID: 7, goal: null })).toBeUndefined()
    expect(parseChangedEvent({ sessionID: "", goal: null })).toBeUndefined()
  })

  test("drops a present-but-malformed snapshot rather than blanking the entry", () => {
    expect(parseChangedEvent({ sessionID: "ses_a", goal: { version: 1 } })).toBeUndefined()
    expect(parseChangedEvent({ sessionID: "ses_a", goal: "active" })).toBeUndefined()
    expect(parseChangedEvent({ sessionID: "ses_a", goal: 0 })).toBeUndefined()
  })
})

describe("parseNotice", () => {
  test("narrows a valid notice of every level", () => {
    for (const level of ["info", "success", "warning", "error"] as const) {
      const parsed = parseNotice({ ...notice(), level })
      expect(parsed?.level).toBe(level)
    }
    expect(parseNotice(notice())).toEqual(notice())
  })

  test("accepts every notice kind the server emits", () => {
    for (const kind of ["set", "status", "cleared", "achieved", "impossible", "paused", "resumed", "retry", "failed", "checkin", "error", "compact", "loop"] as const) {
      expect(parseNotice({ ...notice(), kind })?.kind).toBe(kind)
    }
  })

  test("drops malformed notices", () => {
    expect(parseNotice(null)).toBeUndefined()
    expect(parseNotice("notice")).toBeUndefined()
    expect(parseNotice({ ...notice(), sessionID: "" })).toBeUndefined()
    expect(parseNotice({ ...notice(), sessionID: 42 })).toBeUndefined()
    expect(parseNotice({ ...notice(), kind: "exploded" })).toBeUndefined()
    expect(parseNotice({ ...notice(), level: "critical" })).toBeUndefined()
    expect(parseNotice({ ...notice(), title: 7 })).toBeUndefined()
    expect(parseNotice({ ...notice(), message: null })).toBeUndefined()
  })
})

describe("contextSize / compactAtTokens", () => {
  test("pass through the snapshot parser unchanged", () => {
    const parsed = parseGoalSnapshot({ ...snapshot(), contextSize: 95_000, compactAtTokens: 150_000 })
    expect(parsed?.contextSize).toBe(95_000)
    expect(parsed?.compactAtTokens).toBe(150_000)
  })

  test("absent fields stay absent", () => {
    const parsed = parseGoalSnapshot(snapshot())
    expect(parsed?.contextSize).toBeUndefined()
    expect(parsed?.compactAtTokens).toBeUndefined()
  })

  test("non-numeric values are rejected", () => {
    expect(parseGoalSnapshot({ ...snapshot(), contextSize: "95k" })).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), compactAtTokens: true })).toBeUndefined()
  })
})
