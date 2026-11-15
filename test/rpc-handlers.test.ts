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
  restoreCalls: Array<{ boundaryCompact?: boolean } | undefined>
}

function stub(overrides: Partial<Stub> = {}): Stub {
  const s: Stub = {
    explode: {},
    restored: false,
    restoreCalls: [],
    restoreOne: async () => (overrides.restored ?? false),
    restore: async (options) => {
      s.restoreCalls.push(options)
      if (s.explode.restore) throw new Error("storage down")
      s.restored = true
      return 1
    },
    snapshot: () => {
      if (s.explode.snapshot) throw new Error("bad record")
      return s.restored ? snapshot() : null
    },
    spend: async (): Promise<UsageSnapshot | undefined> => {
      if (s.explode.spend) throw new Error("usage down")
      return undefined
    },
    list: () => {
      if (s.explode.list) throw new Error("list exploded")
      return s.restored ? [snapshot()] : []
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

  test("get returns the snapshot when the controller behaves", async () => {
    const s = stub({ restored: true })
    expect(await handlers(s).get({ sessionID: "ses_test" })).toEqual({ goal: snapshot() })
  })

  test("get falls back to a storage restore and returns null when storage is unreadable", async () => {
    const s = stub()
    s.explode.restore = true
    // restoreOne throws inside the handler's own catch; snapshot sees no record -> null, never a 500.
    s.restoreOne = async () => {
      throw new Error("storage gone")
    }
    expect(await handlers(s).get({ sessionID: "ses_test" })).toEqual({ goal: null })
  })

  test("get returns goal: null even if the snapshot computation explodes", async () => {
    const s = stub({ restored: true })
    s.explode.snapshot = true
    expect(await handlers(s).get({ sessionID: "ses_test" })).toEqual({ goal: null })
  })

  test("get returns goal: null when spend fails AND snapshot throws — the double failure path", async () => {
    const s = stub({ restored: true })
    s.explode.spend = true
    s.explode.snapshot = true
    expect(await handlers(s).get({ sessionID: "ses_test" })).toEqual({ goal: null })
  })

  test("list returns the restored goals, and falls back to [] on failure", async () => {
    const s = stub()
    // empty memory; restore populates the list on the fallback path
    expect(await handlers(s).list()).toEqual({ goals: [snapshot()] })
    const broken = stub()
    broken.explode.list = true
    expect(await handlers(broken).list()).toEqual({ goals: [] })
  })

  test("list adopts from storage without asking the host to compact (a3)", async () => {
    const s = stub()
    expect(await handlers(s).list()).toEqual({ goals: [snapshot()] })
    expect(s.restoreCalls).toEqual([{ boundaryCompact: false }])
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
