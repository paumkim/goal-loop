import { describe, expect, test } from "bun:test"
import type { GoalSnapshot, UsageSnapshot } from "../src/core/types.ts"
import type { RpcGoalController } from "../src/rpc-handlers.ts"
import { createRpcHandlers } from "../src/rpc-handlers.ts"

const silentLog = { info() {}, warn() {}, error() {} }

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
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [],
  elapsedMs: 60_000,
  evaluating: false,
  waiting: false,
})

interface Stub extends RpcGoalController {
  explode: Record<string, boolean>
  restored: boolean
}

function stub(overrides: Partial<Stub> = {}): Stub {
  const s: Stub = {
    explode: {},
    restored: false,
    peekSnapshot: async () => {
      if (s.explode.peekSnapshot) throw new Error("peek exploded")
      return s.restored ? snapshot() : null
    },
    peekList: async () => {
      if (s.explode.peekList) throw new Error("peek list exploded")
      return s.restored ? [snapshot()] : []
    },
    spend: async (): Promise<UsageSnapshot | undefined> => {
      if (s.explode.spend) throw new Error("usage down")
      return undefined
    },
    status: async () => {
      if (s.explode.status) throw new Error("status exploded")
    },
    clear: () => {
      if (s.explode.clear) throw new Error("clear exploded")
      return true
    },
    ...overrides,
  }
  return s
}

const handlers = (s: Stub) => createRpcHandlers({ controller: s, log: silentLog })

describe("goal RPC handlers", () => {
  test("get never throws for missing or malformed input — returns goal: null", async () => {
    const s = stub({ restored: true })
    const h = handlers(s)
    for (const input of [undefined, null, {}, { sessionID: "" }, { sessionID: 42 }, { sessionID: null }, "garbage"]) {
      const out = await h.get(input)
      expect(out).toEqual({ goal: null })
    }
  })

  test("get returns the snapshot the controller peeks", async () => {
    const s = stub({ restored: true })
    expect(await handlers(s).get({ sessionID: "ses_test" })).toEqual({ goal: snapshot() })
  })

  test("get returns goal: null when peek throws", async () => {
    const s = stub()
    s.explode.peekSnapshot = true
    expect(await handlers(s).get({ sessionID: "ses_test" })).toEqual({ goal: null })
  })

  test("get returns goal: null when the storage read inside peek fails AND spend fails — the double failure path", async () => {
    const s = stub({ restored: true })
    s.explode.spend = true
    s.explode.peekSnapshot = true
    expect(await handlers(s).get({ sessionID: "ses_test" })).toEqual({ goal: null })
  })

  test("get returns goal: null even if the peek computation explodes; spend failure alone still yields a goal", async () => {
    const s = stub({ restored: true })
    s.explode.peekSnapshot = true
    expect(await handlers(s).get({ sessionID: "ses_test" })).toEqual({ goal: null })
    const spendOnly = stub({ restored: true })
    spendOnly.explode.spend = true
    expect(await handlers(spendOnly).get({ sessionID: "ses_test" })).toEqual({ goal: snapshot() })
  })

  test("list returns the peeked goals, [] on failure, [] when empty — without any restore call", async () => {
    const s = stub({ restored: true })
    expect(await handlers(s).list()).toEqual({ goals: [snapshot()] })
    const broken = stub()
    broken.explode.peekList = true
    expect(await handlers(broken).list()).toEqual({ goals: [] })
    const empty = stub()
    expect(await handlers(empty).list()).toEqual({ goals: [] })
  })

  test("list issues no storage restore and adopts nothing", async () => {
    // The stub carries no restore/restoreOne/snapshot/list surface at all — a handler that tried to
    // read-through or adopt would TypeError straight into the outer catch's { goals: [] }.
    const s = stub({ restored: true })
    expect("restoreOne" in s).toBe(false)
    expect("restore" in s).toBe(false)
    expect("snapshot" in s).toBe(false)
    expect("list" in s).toBe(false)
    expect(await handlers(s).list()).toEqual({ goals: [snapshot()] })
  })

  test("status resolves {} even when controller.status throws", async () => {
    const s = stub()
    s.explode.status = true
    await expect(handlers(s).status({ sessionID: "ses_test" })).resolves.toEqual({})
    await expect(handlers(s).status({})).resolves.toEqual({})
  })

  test("clear reports cleared:false on controller failure, true on success", async () => {
    const s = stub()
    expect(await handlers(s).clear({ sessionID: "ses_test" })).toEqual({ cleared: true })
    s.explode.clear = true
    expect(await handlers(s).clear({ sessionID: "ses_test" })).toEqual({ cleared: false })
    expect(await handlers(s).clear({})).toEqual({ cleared: false })
  })

  test("the wire output matches the GoalRpc contract (goal object|null, goals array, cleared boolean)", async () => {
    const s = stub({ restored: true })
    const h = handlers(s)
    const { goal } = await h.get({ sessionID: "ses_test" })
    expect(goal === null || goal?.sessionID === "ses_test").toBe(true)
    const { goals } = await h.list()
    expect(Array.isArray(goals)).toBe(true)
    const { cleared } = await h.clear({ sessionID: "ses_test" })
    expect(typeof cleared).toBe("boolean")
  })
})

describe("contextSize over RPC", () => {
  test("get passes the controller-provided estimate into the peek; a missing implementation passes none", async () => {
    const calls: Array<[string, unknown, unknown]> = []
    const withCtx: Stub = {
      ...stub({ restored: true }),
      contextSize: async () => 95_000,
      peekSnapshot: (async (sessionID: string, spend?: UsageSnapshot, contextSize?: number) => {
        calls.push([sessionID, spend, contextSize])
        return { ...snapshot(), ...(contextSize !== undefined ? { contextSize } : {}) }
      }) as Stub["peekSnapshot"],
    }
    const handlers = createRpcHandlers({ controller: withCtx, log: silentLog })
    const out = await handlers.get({ sessionID: "ses_test" })
    expect(calls[0]?.[2]).toBe(95_000)
    expect(out.goal?.contextSize).toBe(95_000)

    const bare = stub({ restored: true })
    const handlers2 = createRpcHandlers({ controller: bare, log: silentLog })
    const out2 = await handlers2.get({ sessionID: "ses_test" })
    expect(out2.goal?.contextSize).toBeUndefined()
  })

  test("a failing context estimate still yields the snapshot (never a 500)", async () => {
    const failing: Stub = {
      ...stub({ restored: true }),
      contextSize: async () => {
        throw new Error("context read exploded")
      },
    }
    const handlers = createRpcHandlers({ controller: failing, log: silentLog })
    const out = await handlers.get({ sessionID: "ses_test" })
    expect(out.goal?.sessionID).toBe("ses_test")
    expect(out.goal?.contextSize).toBeUndefined()
  })
})
