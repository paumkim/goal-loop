/**
 * Pins the ambient pill's time-tracking contract:
 *
 *  1. The elapsed timer anchors to the goal record's ORIGINAL `startedAt` — the arm stamp of the
 *     first iteration. A `/goal-loop` re-arm (v1 -> v2 -> ...) must never move it, and neither may a
 *     restore after a restart while the record is still live.
 *  2. The TUI intake is keyed per session everywhere: one session's goal activity (an arm, a re-arm,
 *     a terminal transition, a stale re-pull) cannot disturb, overlap or bleed into another session's
 *     pill, cache entry or acknowledgment state.
 *
 * Evidence layers: controller-level tests pin the record semantics; pure intake tests pin the cache;
 * the tail of the file headless-renders the pill line for two sessions side by side (and across a
 * loop iteration boundary) and asserts on the captured character grid.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "@opentui/solid"
import { resolveConfig } from "../src/core/config.ts"
import type { CommitPolicy, GoalSnapshot, Notice, UsageSnapshot } from "../src/core/types.ts"
import { GoalController } from "../src/runtime/controller.ts"
import type { BoundaryCompactResult } from "../src/runtime/compactor.ts"
import type { BackgroundWork, Clock, EvaluationRequest, EvaluationResult, LoopSummaryRequest, NextGoalRequest, StoragePort } from "../src/runtime/ports.ts"
import { GoalStore } from "../src/runtime/store.ts"
import { applySnapshot, bumpReceivedAt, type GoalSnapshotCacheEntry } from "../src/core/entries.ts"
import { pillModel, staleUnprovenSessionIDs, staleRecentlyTerminalSessionIDs } from "../src/core/hud.ts"

// ------------------------------------------------------------- clock + storage doubles

class FakeClock implements Clock {
  t = 1_000_000
  private timers = new Map<number, { at: number; fn: () => void }>()
  private next = 1
  now = () => this.t
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++
    this.timers.set(id, { at: this.t + ms, fn })
    return id
  }
  clearTimeout = (id: unknown) => void this.timers.delete(id as number)
  async advance(ms: number) {
    this.t += ms
    for (const [id, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > this.t) continue
      this.timers.delete(id)
      timer.fn()
    }
    await flush()
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

class MemoryStorage implements StoragePort {
  data = new Map<string, unknown>()
  get = async (key: string) => structuredClone(this.data.get(key))
  set = async (key: string, value: unknown) => void this.data.set(key, structuredClone(value))
  remove = async (key: string) => void this.data.delete(key)
  scan = async ({ prefix }: { prefix: string }) => ({
    entries: [...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })),
  })
}

const SES_A = "ses_A"
const SES_B = "ses_B"
const DIR = "C:/work/project"
const met = (reason = "done"): EvaluationResult => ({ verdict: "met", reason })

function harness(storage = new MemoryStorage()) {
  const clock = new FakeClock()
  const verdicts: EvaluationResult[] = []
  const summaries: string[] = []
  const nextGoals: string[] = []
  const notices: Notice[] = []
  const usageValue: UsageSnapshot | undefined = { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  const commit: CommitPolicy = { required: false, branch: "dev", reason: "test" }
  const controller = new GoalController({
    config: resolveConfig({}),
    directory: DIR,
    commit,
    clock,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    newId: (() => {
      let n = 0
      return () => `goal_${++n}`
    })(),
    store: new GoalStore(storage, (e) => {
      throw e
    }),
    session: {
      prompt: async () => {},
      synthetic: async () => {},
      usage: async () => usageValue,
      compact: async () => {},
    },
    evaluator: {
      evaluate: async (_request: EvaluationRequest) => {
        const next = verdicts.shift()
        if (!next) throw new Error("no verdict queued")
        return next
      },
      summarize: async (_request: LoopSummaryRequest) => {
        const next = summaries.shift()
        if (next === undefined) throw new Error("no summary queued")
        return next
      },
      nextGoal: async (_request: NextGoalRequest) => {
        const next = nextGoals.shift()
        if (next === undefined) throw new Error("no next goal queued")
        return next
      },
    },
    background: { busy: async (): Promise<BackgroundWork> => ({ subagents: 0, shells: 0 }) },
    emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
    compactAtBoundary: async (_sessionID: string, _opts?: { force?: boolean }): Promise<BoundaryCompactResult> => ({ requested: true, estimatedTokens: 250_000 }),
    estimateContext: async () => 250_000,
  })
  const turn = async (sessionID: string, tools = 1) => {
    controller.onExecutionStarted(sessionID)
    for (let i = 0; i < tools; i++) controller.onToolCalled(sessionID)
    await controller.onExecutionSucceeded(sessionID)
    await flush()
  }
  return { clock, controller, storage, notices, verdicts, summaries, nextGoals, turn }
}

// ------------------------------------------------- 1. timer continuity across arm + restore

describe("pill timer continuity", () => {
  test("a loop re-arm (v1 -> v2) never moves startedAt; elapsed keeps counting from first arm", async () => {
    const h = harness()
    await h.controller.command({ sessionID: SES_A, text: "objective", delivery: "steer", loop: true })
    const armed = h.controller.get(SES_A)!
    const origin = armed.startedAt
    expect(origin).toBe(h.clock.t)

    await h.clock.advance(10 * 60_000)
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(SES_A, 3)

    const v2 = h.controller.get(SES_A)!
    expect(v2.loopIteration).toBe(2)
    expect(v2.startedAt).toBe(origin) // the arm advanced the iteration, NOT the timer
    const snapshot = h.controller.snapshot(SES_A)!
    expect(snapshot.elapsedMs).toBe(h.clock.t - origin)

    await h.clock.advance(5 * 60_000)
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(SES_A, 2)
    const v3 = h.controller.get(SES_A)!
    expect(v3.loopIteration).toBe(3)
    expect(v3.startedAt).toBe(origin)
    expect(h.controller.snapshot(SES_A)!.elapsedMs).toBe(h.clock.t - origin)
  })

  test("a restore after restart keeps the original startedAt while the loop record is live", async () => {
    const h = harness()
    await h.controller.command({ sessionID: SES_A, text: "objective", delivery: "steer", loop: true })
    const origin = h.controller.get(SES_A)!.startedAt
    await h.clock.advance(10 * 60_000)
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(SES_A, 3)
    expect(h.controller.get(SES_A)!.startedAt).toBe(origin)
    await h.controller.dispose()

    const h2 = harness(h.storage)
    expect(await h2.controller.restore()).toBe(1)
    const restored = h2.controller.get(SES_A)!
    expect(restored.loopIteration).toBe(2)
    expect(restored.startedAt).toBe(origin) // restore re-anchors turns/baseline, never the timer
    await h2.clock.advance(7 * 60_000)
    expect(h2.controller.snapshot(SES_A)!.elapsedMs).toBe(h2.clock.t - origin)
  })
})

// ------------------------------------------------- 2. per-session isolation

describe("per-session isolation", () => {
  test("a v1 -> v2 arm in session A never touches session B's record or snapshot", async () => {
    const h = harness()
    await h.controller.command({ sessionID: SES_A, text: "A objective", delivery: "steer", loop: true })
    await h.clock.advance(2 * 60_000)
    await h.controller.command({ sessionID: SES_B, text: "B tests green", delivery: "steer" })
    const bOrigin = h.controller.get(SES_B)!.startedAt
    const bSet = h.controller.get(SES_B)!.setAt

    await h.clock.advance(10 * 60_000)
    h.verdicts.push(met("A v1 done"))
    h.summaries.push("A s1")
    h.nextGoals.push("A v2 condition")
    await h.turn(SES_A, 2)

    const b = h.controller.get(SES_B)!
    expect(b.condition).toBe("B tests green")
    expect(b.startedAt).toBe(bOrigin)
    expect(b.setAt).toBe(bSet)
    expect(b.turns).toBe(0)
    expect(b.loopIteration).toBeUndefined()

    const snapB = h.controller.snapshot(SES_B)!
    expect(snapB.sessionID).toBe(SES_B)
    expect(snapB.elapsedMs).toBe(h.clock.t - bOrigin)
    const snapA = h.controller.snapshot(SES_A)!
    expect(snapA.loopIteration).toBe(2)
    expect(snapA.elapsedMs).toBe(h.clock.t - h.controller.get(SES_A)!.startedAt)
  })

  test("the entries cache applies one session's snapshot without disturbing another's", () => {
    const base: GoalSnapshotCacheEntry = { goal: null, receivedAt: 1_000 }
    let entries: Readonly<Record<string, GoalSnapshotCacheEntry>> = { [SES_A]: { ...base }, [SES_B]: { ...base, receivedAt: 2_000 } }
    const snapA: GoalSnapshot = {
      version: 1, id: "gA", sessionID: SES_A, directory: DIR, condition: "A", status: "active",
      setAt: 5_000, startedAt: 5_000, turns: 0, stall: 0, retries: 0, checkins: 0,
      baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      history: [], elapsedMs: 60_000, evaluating: false, waiting: false,
    }
    entries = applySnapshot(entries, SES_A, snapA, 10_000, undefined)
    expect(entries[SES_A]!.goal?.id).toBe("gA")
    expect(entries[SES_A]!.receivedAt).toBe(10_000)
    expect(entries[SES_B]!.receivedAt).toBe(2_000) // untouched
    expect(entries[SES_B]!.goal).toBeNull()

    entries = bumpReceivedAt(entries, SES_A, 20_000)
    expect(entries[SES_B]!.receivedAt).toBe(2_000) // still untouched

    // A re-pulled (receivedAt=20_000) so it reads fresh; B (receivedAt=2_000) crossed the cadence — per-session freshness.
    expect(staleUnprovenSessionIDs(entries, 40_000, 30_000)).toEqual([SES_B])
    expect(staleRecentlyTerminalSessionIDs(entries, 40_000)).toEqual([])
  })
})

// ------------------------------------------------- 3. headless frames: two sessions, one boundary

const NOW = 1_800_000_000_000
const baseline = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const looped = (sessionID: string, iteration: number, startedAt: number): GoalSnapshot => ({
  version: 1, id: `g-${sessionID}`, sessionID, directory: DIR,
  condition: sessionID === SES_A ? "A: migrate the parser" : "B: green tests on main",
  status: "active",
  setAt: startedAt, startedAt,
  turns: iteration, stall: 0, retries: 0, checkins: 0, baseline,
  history: [],
  loopEnabled: true, loopIteration: iteration, loopObjective: "objective", loopMaxLoops: 5,
  loopHistory: Array.from({ length: iteration - 1 }, (_, i) => ({ version: i + 1, condition: `pass ${i + 1}`, summary: "done", reason: "met", turns: 3, toolCalls: 12, endedAt: startedAt + (i + 1) * 60_000 })),
  loopNotProgress: 0,
  elapsedMs: NOW - startedAt,
  evaluating: false, waiting: false,
})

// Same formula the TUI uses (src/tui.tsx · elapsedOf): snapshot elapsed + idle extrapolation, live only.
const elapsedOf = (g: GoalSnapshot, receivedAt: number, nowMs: number) =>
  g.status === "active" ? g.elapsedMs + Math.max(0, nowMs - receivedAt) : g.elapsedMs

/** The ambient pill line for one session, exactly the segments tui.tsx composes (the breath dot leads, no caret). */
const pillLine = (g: GoalSnapshot) => pillModel(g, elapsedOf(g, NOW, NOW), false).text

const renderPills = async (lineA: string, lineB: string): Promise<string> => {
  const node = (): JSX.Element => (
    <box flexDirection="column" width={96}>
      <text>{`ses_A │ ${lineA}`}</text>
      <text>{`ses_B │ ${lineB}`}</text>
    </box>
  )
  const setup = await testRender(node, { width: 96, height: 4 })
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  await setup.renderer.destroy()
  return frame
}

describe("headless pill frames", () => {
  test("two sessions paint independent pills with independent running timers", async () => {
    const a = looped(SES_A, 2, NOW - 72 * 60_000) // session A: 72m elapsed
    const b = looped(SES_B, 1, NOW - 9 * 60_000)  // session B: 9m elapsed
    const frame = await renderPills(pillLine(a), pillLine(b))
    console.log("\n==== FRAME 1 (A in v2 @ 72m, B in v1 @ 9m) ====\n" + frame)
    expect(frame).toContain("ses_A")
    expect(frame).toContain("ses_B")
    expect(frame).toContain("v2/5")
    expect(frame).toContain("v1/5")
    expect(frame).toMatch(/1h|72m/)   // A's own clock
    expect(frame).toMatch(/9m/)       // B's own clock
  })

  test("the timer rides across an iteration boundary: v1 and v2 paint the same continuous elapsed", async () => {
    const startedAt = NOW - 72 * 60_000
    const v1 = looped(SES_A, 1, startedAt)
    const frameV1 = await renderPills(pillLine(v1), pillLine(looped(SES_B, 1, NOW - 9 * 60_000)))
    console.log("\n==== FRAME 2 (before arm: A v1) ====\n" + frameV1)
    // The arm: iteration advances, startedAt does NOT move (pinned by the controller tests above).
    const v2 = looped(SES_A, 2, startedAt)
    const frameV2 = await renderPills(pillLine(v2), pillLine(looped(SES_B, 1, NOW - 9 * 60_000)))
    console.log("\n==== FRAME 3 (after arm: A v2, same startedAt, timer kept) ====\n" + frameV2)
    const elapsedToken = /1h|72m/
    expect(frameV1).toMatch(elapsedToken)
    expect(frameV2).toMatch(elapsedToken) // no reset to 0m/1m after the arm
    expect(frameV2).toContain("v2/5")
    // B's row is byte-identical across the boundary — A's arm never bled into it.
    const rowB = (f: string) => f.split("\n").find((l) => l.includes("ses_B"))!
    expect(rowB(frameV2)).toBe(rowB(frameV1))
  })
})
