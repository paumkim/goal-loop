import { describe, expect, test } from "bun:test"
import { makeGoalRefresh } from "../src/core/repull.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const liveSnapshot = (): GoalSnapshot =>
  ({
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
    evaluating: true,
    waiting: false,
  }) as unknown as GoalSnapshot

const achievedSnapshot = (): GoalSnapshot => ({
  ...liveSnapshot(),
  status: "achieved",
  evaluating: false,
  waiting: false,
  endedAt: 61_000,
  elapsedMs: 60_000,
  reason: "the condition is met",
  final: { cost: 0.75, input: 15, output: 25, reasoning: 5, cacheRead: 1, cacheWrite: 2 },
})

describe("makeGoalRefresh — the stale-chrome guard's re-pull", () => {
  test("a call-time (synchronous) throw from the fetch never escapes at call time — it rejects the promise", async () => {
    const refresh = makeGoalRefresh({
      get: () => {
        // The pre-fix `refresh` arrow evaluated `rpc.get(..., at(sessionID))` at CALL time: when the
        // host's session lookup threw, the exception escaped synchronously — before `.catch` existed —
        // and the tick's re-pull for-loop broke at this session, stranding the ambient pill on
        // "goal checking" forever with zero diagnostics.
        throw new Error("host session lookup exploded")
      },
      put: () => {
        throw new Error("put must not run when the fetch throws")
      },
    })
    // If refresh threw at CALL time (the pre-fix shape), this line throws and fails the test.
    const pending = refresh("ses_test")
    await expect(pending).rejects.toThrow("host session lookup exploded")
  })

  test("an RPC rejection folds into a rejected promise — the caller's .catch is the real boundary", async () => {
    const refresh = makeGoalRefresh({
      get: () => Promise.reject(new Error("rpc unavailable")),
      put: () => {
        throw new Error("put must not run on a rejected fetch")
      },
    })
    await expect(refresh("ses_test")).rejects.toThrow("rpc unavailable")
  })

  test("a malformed payload resolves false and never reaches put — stale chrome never passes as fresh", async () => {
    let putCalls = 0
    const refresh = makeGoalRefresh({
      get: () => Promise.resolve({ goal: { ...achievedSnapshot(), turns: Number.NaN } }),
      put: () => void putCalls++,
    })
    expect(await refresh("ses_test")).toBe(false)
    expect(putCalls).toBe(0)
  })

  test("the terminal re-pull feeds the intake: achieved snapshot is parsed and handed to put", async () => {
    const seen: { sessionID?: string; status?: string } = {}
    const refresh = makeGoalRefresh({
      get: () => Promise.resolve({ goal: achievedSnapshot() }),
      put: (sessionID, goal) => {
        seen.sessionID = sessionID
        seen.status = goal?.status
      },
    })
    expect(await refresh("ses_test")).toBe(true)
    expect(seen).toEqual({ sessionID: "ses_test", status: "achieved" })
  })

  test("an explicit null goal (cleared server-side) reaches put as null — the entry is droppable", async () => {
    let seen: unknown = "unset"
    const refresh = makeGoalRefresh({
      get: () => Promise.resolve({ goal: null }),
      put: (_sessionID, goal) => {
        seen = goal
      },
    })
    expect(await refresh("ses_test")).toBe(true)
    expect(seen).toBeNull()
  })

  test("a live re-pull reaches put unchanged — a genuinely live goal keeps the pill (it IS live)", async () => {
    let seen: unknown = "unset"
    const refresh = makeGoalRefresh({
      get: () => Promise.resolve({ goal: liveSnapshot() }),
      put: (_sessionID, goal) => {
        seen = (goal as GoalSnapshot | null)?.status
      },
    })
    expect(await refresh("ses_test")).toBe(true)
    expect(seen).toBe("active")
  })

  test("the put side of the intake may throw — it surfaces in the promise, never at call time", async () => {
    const refresh = makeGoalRefresh({
      get: () => Promise.resolve({ goal: achievedSnapshot() }),
      put: () => {
        throw new Error("signal write failed")
      },
    })
    const pending = refresh("ses_test")
    await expect(pending).rejects.toThrow("signal write failed")
  })
})
