import { describe, expect, test } from "bun:test"
import type { GoalSnapshot, Notice } from "../src/core/types.ts"
import {
  isGoalSnapshot,
  isRecord,
  parseChangedEvent,
  parseGetGoalOutput,
  parseGoalSnapshot,
  parseNotice,
  stripUndefined,
} from "../src/core/wire.ts"
import { isLive, VERIFY_EVIDENCE_MODES, VERIFY_CHECK_SOURCES, VERIFY_RUN_STATES, VERIFY_CHECK_TYPES } from "../src/core/types.ts"
import { preserveCarriedFields, pruneSnapshotEntries } from "../src/core/entries.ts"
import { staleUnprovenSessionIDs, STALE_LIVE_ENTRY_MS } from "../src/core/hud.ts"

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

  test("accepts a persisted failureLabel and tolerates its absence", () => {
    expect(parseGoalSnapshot({ ...snapshot(), status: "failed", failureLabel: "authentication failure" })?.failureLabel).toBe("authentication failure")
    expect(parseGoalSnapshot(snapshot())?.failureLabel).toBeUndefined()
  })

  test("accepts a persisted pauseCause (cap / stall / user / repeated_failure / usage_limit) and tolerates its absence", () => {
    for (const cause of ["cap", "stall", "user", "repeated_failure", "usage_limit"] as const) {
      expect(parseGoalSnapshot({ ...snapshot(), status: "paused", pauseCause: cause })?.pauseCause).toBe(cause)
    }
    expect(parseGoalSnapshot(snapshot())?.pauseCause).toBeUndefined()
  })

  test("accepts omitted optional fields (legacy records)", () => {
    expect(parseGoalSnapshot(snapshot())?.reason).toBeUndefined()
    expect(parseGoalSnapshot(snapshot())?.loopHistory).toBeUndefined()
  })

  test("accepts an additive LoopEntry sha and rejects non-string values when present", () => {
    const entry = (sha?: unknown) => [{ version: 1, condition: "c", summary: "s", reason: "r", turns: 1, toolCalls: 2, endedAt: 800, ...(sha === undefined ? {} : { sha }) }]
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry("a".repeat(40)) })?.loopHistory?.[0]?.sha).toBe("a".repeat(40))
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry(undefined) })?.loopHistory?.[0]?.sha).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry(91000) })).toBeUndefined()
  })

  test("accepts an additive VerdictEntry sha and rejects non-string values when present", () => {
    const verdict = (sha?: unknown) => [{ turn: 1, verdict: "not_met" as const, reason: "r", at: 900, ...(sha === undefined ? {} : { sha }) }]
    expect(parseGoalSnapshot({ ...snapshot(), history: verdict("b".repeat(40)) })?.history[0]?.sha).toBe("b".repeat(40))
    expect(parseGoalSnapshot({ ...snapshot(), history: verdict(undefined) })?.history[0]?.sha).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), history: verdict(91000) })).toBeUndefined()
  })

  test("accepts an additive LoopEntry spend delta and rejects broken values when present", () => {
    const spend = { cost: 0.42, input: 1000, output: 200, reasoning: 50, cacheRead: 800, cacheWrite: 10 }
    const entry = (value?: unknown) => [{ version: 1, condition: "c", summary: "s", reason: "r", turns: 1, toolCalls: 2, endedAt: 800, ...(value === undefined ? {} : { spend: value }) }]
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry(spend) })?.loopHistory?.[0]?.spend).toEqual(spend)
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry(undefined) })?.loopHistory?.[0]?.spend).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry({ ...spend, cost: Number.NaN }) })).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry("0.42") })).toBeUndefined()
  })

  test("accepts an additive LoopEntry contextTokens and rejects broken values when present", () => {
    const entry = (contextTokens?: unknown) => [{ version: 1, condition: "c", summary: "s", reason: "r", turns: 1, toolCalls: 2, endedAt: 800, ...(contextTokens === undefined ? {} : { contextTokens }) }]
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry(91_000) })?.loopHistory?.[0]?.contextTokens).toBe(91_000)
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry(undefined) })?.loopHistory?.[0]?.contextTokens).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry(Number.NaN) })).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), loopHistory: entry("91000") })).toBeUndefined()
  })

  test("accepts optional queued boolean and rejects malformed queued values", () => {
    expect(parseGoalSnapshot({ ...snapshot(), queued: true })?.queued).toBe(true)
    expect(parseGoalSnapshot({ ...snapshot(), queued: false })?.queued).toBe(false)
    expect(parseGoalSnapshot(snapshot())?.queued).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), queued: "yes" })).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), queued: 1 })).toBeUndefined()
    expect(parseGoalSnapshot({ ...snapshot(), queued: null })).toBeUndefined()
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
      ["unknown pauseCause", broken((d) => void (d.pauseCause = "forever"))],
      ["non-string pauseCause", broken((d) => void (d.pauseCause = 3))],
      ["non-string failureLabel", broken((d) => void (d.failureLabel = 3))],
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
    // An absent goal key is dropped with the event (an explicit null is the only clear signal);
    // narrowing undefined to null here would blank a live entry on a malformed payload.
    expect(parseChangedEvent({ sessionID: "ses_a" })).toBeUndefined()
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

describe("the dropped `changed` event and the terminal re-pull (EU)", () => {
  /** The snapshot the server emits at finish: status flipped to achieved, evaluating cleared, endedAt set, final spend folded in. */
  const achievedSnapshot = (): GoalSnapshot => ({
    ...snapshot(),
    status: "achieved",
    reason: "the condition is met",
    endedAt: 61_000,
    turns: 1,
    elapsedMs: 60_000,
    evaluating: false,
    waiting: false,
    final: { cost: 0.75, input: 15, output: 25, reasoning: 5, cacheRead: 1, cacheWrite: 2 },
  })
  /** The snapshot the TUI caches at the moment the evaluator STARTS: still active, evaluating — the screenshot's strand. */
  const checkingSnapshot = (): GoalSnapshot => ({ ...snapshot(), evaluating: true })
  test("the terminal payload the server emits at finish parses — a lost event, not a malformed one, is what stranded the pill", () => {
    const event = parseChangedEvent({ sessionID: "ses_test", goal: achievedSnapshot() })
    expect(event?.goal?.status).toBe("achieved")
    expect(event?.goal && isLive(event.goal.status)).toBe(false)
  })

  test("the stale guard's re-pull converges the cache: pre-terminal entry replaced, live predicate disarmed", () => {
    const parsed = parseGetGoalOutput({ goal: achievedSnapshot() })
    expect(parsed).toBeDefined()
    const merged = preserveCarriedFields(checkingSnapshot(), parsed!.goal)
    const entries = pruneSnapshotEntries({ ses_test: { goal: merged, receivedAt: 2_000_000 } }, undefined)
    expect(merged && isLive(merged.status)).toBe(false)
    expect(entries["ses_test"]?.goal?.status).toBe("achieved")
    expect(staleUnprovenSessionIDs(entries, 2_000_000 + STALE_LIVE_ENTRY_MS)).toEqual([])
  })

  test("the intake's live→terminal transition fires on a re-pulled terminal snapshot (ack pill arms, live chrome disarms)", () => {
    const previous = checkingSnapshot()
    const merged = preserveCarriedFields(previous, achievedSnapshot())
    expect(isLive(previous.status)).toBe(true)
    expect(merged && !isLive(merged.status) && merged.status !== "cleared").toBe(true)
  })

  test("a malformed terminal payload is dropped whole — and the stale predicate keeps flagging the session for the next tick", () => {
    const broken = { ...achievedSnapshot(), turns: Number.NaN }
    expect(parseChangedEvent({ sessionID: "ses_test", goal: broken })).toBeUndefined()
    const entries = { ses_test: { goal: checkingSnapshot(), receivedAt: 1_000 } }
    expect(staleUnprovenSessionIDs(entries, 1_000 + STALE_LIVE_ENTRY_MS)).toEqual(["ses_test"])
  })

  test("a null re-pull (the server cleared the goal) is retained as a re-pull target — a later cross-process re-arm is still noticed", () => {
    const parsed = parseGetGoalOutput({ goal: null })
    expect(parsed).toEqual({ goal: null })
    const merged = preserveCarriedFields(checkingSnapshot(), parsed!.goal)
    expect(merged).toBeNull()
    const entries = pruneSnapshotEntries({ ses_test: { goal: merged, receivedAt: 2_000_000 } }, undefined)
    expect(entries["ses_test"]?.goal).toBeNull()
    expect(staleUnprovenSessionIDs(entries, 2_000_000 + STALE_LIVE_ENTRY_MS)).toEqual(["ses_test"])
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

describe("zero-work verdict entries", () => {
  const withTools = (value?: unknown) => ({
    ...snapshot(),
    history: [{ turn: 1, verdict: "met" as const, reason: "already held at HEAD", at: 100, ...(value === undefined ? {} : { toolCalls: value }) }],
  })

  test("an additive VerdictEntry toolCalls is accepted when present", () => {
    expect(parseGoalSnapshot(withTools(0))?.history[0]?.toolCalls).toBe(0)
    expect(parseGoalSnapshot(withTools(7))?.history[0]?.toolCalls).toBe(7)
  })

  test("toolCalls may be absent and broken values are rejected", () => {
    expect(parseGoalSnapshot(withTools(undefined))?.history[0]?.toolCalls).toBeUndefined()
    expect(parseGoalSnapshot(withTools(Number.NaN))).toBeUndefined()
    expect(parseGoalSnapshot(withTools("0"))).toBeUndefined()
  })
})

describe("per-turn spend on verdict entries", () => {
  const spendSnapshot = (spend?: unknown) => ({
    ...snapshot(),
    history: [{ turn: 1, verdict: "not_met" as const, reason: "not yet", at: 900, ...(spend === undefined ? {} : { spend }) }],
  })
  const fullSpend = { cost: 0.42, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

  test("an additive VerdictEntry spend is accepted when present", () => {
    expect(parseGoalSnapshot(spendSnapshot(fullSpend as never))?.history[0]?.spend?.cost).toBe(0.42)
  })

  test("a broken or partial spend is rejected", () => {
    expect(parseGoalSnapshot(spendSnapshot("0.42"))).toBeUndefined()
    expect(parseGoalSnapshot(spendSnapshot({ cost: Number.NaN, input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 }))).toBeUndefined()
    expect(parseGoalSnapshot(spendSnapshot({ cost: 1 }))).toBeUndefined()
  })
})

describe("verification evidence on verdict entries", () => {
  const withVerify = (verify?: unknown) => ({
    ...snapshot(),
    history: [{ turn: 1, verdict: "met" as const, reason: "done", at: 900, ...(verify === undefined ? {} : { verify }) }],
  })

  test("an additive VerdictEntry verify record is accepted when present", () => {
    expect(parseGoalSnapshot(withVerify({ command: "bun run check", code: 0, tail: "ok" }))?.history[0]?.verify).toEqual({ command: "bun run check", code: 0, tail: "ok" })
    expect(parseGoalSnapshot(withVerify({ command: "bun run check", code: null, timedOut: true }))?.history[0]?.verify).toEqual({ command: "bun run check", code: null, timedOut: true })
  })

  test("verify may be absent and malformed values are rejected", () => {
    expect(parseGoalSnapshot(withVerify(undefined))?.history[0]?.verify).toBeUndefined()
    expect(parseGoalSnapshot(withVerify("ok"))).toBeUndefined()
    expect(parseGoalSnapshot(withVerify({ command: 1, code: 0 }))).toBeUndefined()
    expect(parseGoalSnapshot(withVerify({ command: "bun run check", code: "0" }))).toBeUndefined()
    expect(parseGoalSnapshot(withVerify({ command: "bun run check", code: 0, timedOut: "yes" }))).toBeUndefined()
    expect(parseGoalSnapshot(withVerify({ command: "bun run check", code: 0, tail: 7 }))).toBeUndefined()
  })
})

describe("optional GoalSnapshot fields (historyDropped, loopHistoryDropped, completedConditions, completedConditionsDropped, lastVerify, waitingSince)", () => {
  test("accepts valid additive fields and tolerates their absence", () => {
    const lastVerify = { command: "bun run check", code: 0, at: 1_234 }
    const parsed = parseGoalSnapshot({
      ...snapshot(),
      historyDropped: 2,
      loopHistoryDropped: 1,
      completedConditions: ["step 1", "step 2"],
      completedConditionsDropped: 3,
      lastVerify,
      waitingSince: 9_999,
    })
    expect(parsed?.historyDropped).toBe(2)
    expect(parsed?.loopHistoryDropped).toBe(1)
    expect(parsed?.completedConditions).toEqual(["step 1", "step 2"])
    expect(parsed?.completedConditionsDropped).toBe(3)
    expect(parsed?.lastVerify).toEqual(lastVerify)
    expect(parsed?.waitingSince).toBe(9_999)

    const bare = parseGoalSnapshot(snapshot())
    expect(bare?.historyDropped).toBeUndefined()
    expect(bare?.loopHistoryDropped).toBeUndefined()
    expect(bare?.completedConditions).toBeUndefined()
    expect(bare?.completedConditionsDropped).toBeUndefined()
    expect(bare?.lastVerify).toBeUndefined()
    expect(bare?.waitingSince).toBeUndefined()
  })

  test("accepts boundary values for dropped counters, completedConditions, and lastVerify", () => {
    expect(parseGoalSnapshot({ ...snapshot(), historyDropped: 0 })?.historyDropped).toBe(0)
    expect(parseGoalSnapshot({ ...snapshot(), loopHistoryDropped: 0 })?.loopHistoryDropped).toBe(0)
    expect(parseGoalSnapshot({ ...snapshot(), completedConditionsDropped: 0 })?.completedConditionsDropped).toBe(0)
    expect(parseGoalSnapshot({ ...snapshot(), completedConditions: [] })?.completedConditions).toEqual([])
    expect(parseGoalSnapshot({
      ...snapshot(),
      lastVerify: { command: "bun test", code: null, timedOut: true, tail: "timed out", at: 42 },
    })?.lastVerify).toEqual({ command: "bun test", code: null, timedOut: true, tail: "timed out", at: 42 })
    expect(parseGoalSnapshot({
      ...snapshot(),
      lastVerify: { command: "bun test", code: 1, timedOut: false, at: 42 },
    })?.lastVerify).toEqual({ command: "bun test", code: 1, timedOut: false, at: 42 })
  })

  test("rejects malformed dropped counters, completedConditions, and waitingSince", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["historyDropped as string", { ...snapshot(), historyDropped: "2" }],
      ["historyDropped as NaN", { ...snapshot(), historyDropped: Number.NaN }],
      ["historyDropped negative", { ...snapshot(), historyDropped: -1 }],
      ["loopHistoryDropped as string", { ...snapshot(), loopHistoryDropped: "1" }],
      ["loopHistoryDropped negative", { ...snapshot(), loopHistoryDropped: -1 }],
      ["completedConditions not array", { ...snapshot(), completedConditions: "step 1" }],
      ["completedConditions with non-string", { ...snapshot(), completedConditions: ["step 1", 2] }],
      ["completedConditionsDropped as string", { ...snapshot(), completedConditionsDropped: "3" }],
      ["completedConditionsDropped negative", { ...snapshot(), completedConditionsDropped: -1 }],
      ["waitingSince as string", { ...snapshot(), waitingSince: "9999" }],
      ["waitingSince NaN", { ...snapshot(), waitingSince: Number.NaN }],
    ]
    for (const [, value] of cases) expect(parseGoalSnapshot(value)).toBeUndefined()
  })

  test("rejects malformed lastVerify values", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["lastVerify not object", { ...snapshot(), lastVerify: "ok" }],
      ["lastVerify missing command", { ...snapshot(), lastVerify: { code: 0, at: 1 } }],
      ["lastVerify non-string command", { ...snapshot(), lastVerify: { command: 1, code: 0, at: 1 } }],
      ["lastVerify missing code", { ...snapshot(), lastVerify: { command: "bun test", at: 1 } }],
      ["lastVerify invalid code type", { ...snapshot(), lastVerify: { command: "bun test", code: "0", at: 1 } }],
      ["lastVerify NaN code", { ...snapshot(), lastVerify: { command: "bun test", code: Number.NaN, at: 1 } }],
      ["lastVerify missing at", { ...snapshot(), lastVerify: { command: "bun test", code: 0 } }],
      ["lastVerify non-numeric at", { ...snapshot(), lastVerify: { command: "bun test", code: 0, at: "1" } }],
      ["lastVerify non-boolean timedOut", { ...snapshot(), lastVerify: { command: "bun test", code: 0, at: 1, timedOut: "yes" } }],
      ["lastVerify non-string tail", { ...snapshot(), lastVerify: { command: "bun test", code: 0, at: 1, tail: 7 } }],
    ]
    for (const [, value] of cases) expect(parseGoalSnapshot(value)).toBeUndefined()
  })
})

describe("stripUndefined (RPC payload strict-JSON hygiene)", () => {
  test("drops explicit-undefined keys recursively and keeps null and real values", () => {
    const dirty = {
      version: 1,
      condition: "work",
      endedAt: undefined,
      pauseCause: undefined,
      verdict: null,
      baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: undefined, cacheWrite: 2 },
      history: [
        { turn: 1, verdict: "met", reason: "done", at: 5, toolCalls: undefined },
        { turn: 2, verdict: "not_met", reason: "close", at: 9 },
      ],
      loopCompact: { requestedAt: 1, iteration: 1, misses: 2, unmeasurableTicks: undefined, stalenessUnknown: undefined, nested: { a: undefined, b: [1, undefined, { c: undefined, d: 4 }] } },
    }
    const clean = stripUndefined(dirty) as Record<string, unknown>
    expect("endedAt" in clean).toBe(false)
    expect("pauseCause" in clean).toBe(false)
    expect("cacheRead" in (clean.baseline as Record<string, unknown>)).toBe(false)
    expect(clean.verdict).toBeNull()
    expect(clean.baseline).toEqual({ cost: 0, input: 0, output: 0, reasoning: 0, cacheWrite: 2 })
    expect((clean.history as unknown[])[0]).toEqual({ turn: 1, verdict: "met", reason: "done", at: 5 })
    expect((clean.history as unknown[])[1]).toEqual({ turn: 2, verdict: "not_met", reason: "close", at: 9 })
    expect("unmeasurableTicks" in (clean.loopCompact as Record<string, unknown>)).toBe(false)
    expect((clean.loopCompact as Record<string, unknown>).nested).toEqual({ b: [1, undefined, { d: 4 }].map((v) => v) })
    expect(JSON.stringify(clean)).not.toContain("undefined")
  })

  test("a snapshot with the exact shapes that produced the 500 survives strict JSON validation", () => {
    const dirty = {
      ...snapshot(),
      pauseCause: undefined,
      waitingSince: undefined,
      loopCompact: { requestedAt: 3, iteration: 2, misses: 1, stalenessUnknown: undefined },
    }
    const clean = stripUndefined(dirty)
    expect(JSON.parse(JSON.stringify(clean))).toEqual(clean as Record<string, unknown>)
    expect(parseGoalSnapshot(clean)).toBeDefined()
  })

  test("non-plain objects pass through and arrays are mapped element-wise", () => {
    const date = new Date(0)
    const out = stripUndefined([undefined, { a: undefined, b: date, c: null }, "x"]) as unknown[]
    expect(out[0]).toBeUndefined()
    expect(out[1]).toEqual({ b: date, c: null })
    expect(out[2]).toBe("x")
  })
})

describe("canonical runtime verify sets", () => {
  test("the shared sets hold exactly the literals the unions allow", () => {
    expect([...VERIFY_CHECK_TYPES].sort()).toEqual(["build", "custom", "goal-declared", "lint", "smoke", "tests", "typecheck"])
    expect([...VERIFY_EVIDENCE_MODES].sort()).toEqual(["artifact", "command", "either"])
    expect([...VERIFY_CHECK_SOURCES].sort()).toEqual(["configured", "goal-declared", "legacy"])
    expect([...VERIFY_RUN_STATES].sort()).toEqual(["artifact", "executed", "reused", "skipped"])
  })
})
