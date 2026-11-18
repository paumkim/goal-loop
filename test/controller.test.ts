import { beforeEach, describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/core/config.ts"
import type { CommitPolicy, GoalSnapshot, Notice, UsageSnapshot } from "../src/core/types.ts"
import { BackgroundTracker } from "../src/runtime/background.ts"
import { GoalController } from "../src/runtime/controller.ts"
import { createRouter } from "../src/runtime/events.ts"
import { AutoCompactor } from "../src/runtime/compactor.ts"
import type { BackgroundWork, Clock, EvaluationRequest, EvaluationResult, StoragePort } from "../src/runtime/ports.ts"
import { GoalStore } from "../src/runtime/store.ts"

const SID = "ses_1"
const DIR = "C:/work/project"

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
  get pending() {
    return this.timers.size
  }
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

const silentLog = { info() {}, warn() {}, error() {} }
const testCompactor = (notices: Notice[]) =>
  new AutoCompactor({
    config: resolveConfig({}),
    compact: async () => {},
    context: async () => [],
    emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
    clock: new FakeClock() as Clock,
    log: silentLog,
  })

function harness(
  options: Record<string, unknown> = {},
  storage = new MemoryStorage(),
  commit: CommitPolicy = { required: false, branch: "dev", reason: "test" },
) {
  const clock = new FakeClock()
  const calls = { prompts: [] as any[], synthetic: [] as any[] }
  const verdicts: Array<EvaluationResult | Error | (() => Promise<EvaluationResult>)> = []
  const requests: EvaluationRequest[] = []
  const notices: Notice[] = []
  const changes: Array<GoalSnapshot | null> = []
  let work: BackgroundWork = { subagents: 0, shells: 0 }
  let usage: UsageSnapshot | undefined = { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  let usageFn: (() => Promise<UsageSnapshot | undefined>) | undefined
  let estimateContext: (() => Promise<number | undefined>) | undefined
  const store = new GoalStore(storage, (e) => {
    throw e
  })
  const silent = { info() {}, warn() {}, error() {} }
  const controller = new GoalController({
    config: resolveConfig(options),
    directory: DIR,
    commit,
    clock,
    store,
    log: silent,
    newId: (() => {
      let n = 0
      return () => `goal_${++n}`
    })(),
    session: {
      prompt: async (input) => void calls.prompts.push(input),
      synthetic: async (input) => void calls.synthetic.push(input),
      usage: async () => (usageFn ? usageFn() : usage),
      compact: async () => {},
    },
    estimateContext: async () => estimateContext?.(),
    evaluator: {
      evaluate: async (request) => {
        requests.push(request)
        const next = verdicts.shift()
        if (!next) throw new Error("no verdict queued")
        if (next instanceof Error) throw next
        return typeof next === "function" ? next() : next
      },
    },
    background: { busy: async () => work },
    emitter: { changed: (_, goal) => void changes.push(goal), notice: (n) => void notices.push(n) },
  })
  /** Simulates one complete agent turn. */
  const turn = async (tools = 1) => {
    controller.onExecutionStarted(SID)
    for (let i = 0; i < tools; i++) controller.onToolCalled(SID)
    await controller.onExecutionSucceeded(SID)
    await flush()
  }
  return {
    clock,
    calls,
    verdicts,
    requests,
    notices,
    changes,
    controller,
    storage,
    store,
    turn,
    setWork: (w: BackgroundWork) => void (work = w),
    setUsage: (u: UsageSnapshot | undefined) => void (usage = u),
    setUsageFn: (fn: (() => Promise<UsageSnapshot | undefined>) | undefined) => void (usageFn = fn),
    setEstimateContext: (fn: (() => Promise<number | undefined>) | undefined) => void (estimateContext = fn),
    set: (condition = "all tests pass") => controller.command({ sessionID: SID, text: condition, delivery: "steer" }),
  }
}

const met = (reason = "done"): EvaluationResult => ({ verdict: "met", reason })
const notMet = (reason = "tests failing"): EvaluationResult => ({ verdict: "not_met", reason })

describe("GoalController", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  test("setting a goal starts a turn with the condition as the directive", async () => {
    await h.set("lint is clean")
    expect(h.calls.prompts).toHaveLength(1)
    expect(h.calls.prompts[0].text).toContain("lint is clean")
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(h.notices.at(-1)?.kind).toBe("set")
  })

  test("the commit rule reaches the agent on the first turn and on every continuation", async () => {
    h = harness({}, new MemoryStorage(), { required: true, branch: "dev", reason: "test" })
    await h.set("lint is clean")
    expect(h.calls.prompts[0].text).toContain("`dev` branch")
    h.verdicts.push(notMet("lint still fails"))
    await h.turn()
    expect(h.calls.synthetic[0].text).toContain("`dev` branch")
  })

  test("no commit rule when the session is not in a repository", async () => {
    await h.set("lint is clean")
    expect(h.calls.prompts[0].text).not.toContain("commit")
  })

  test("not met -> continuation turn carrying the evaluator reason; met -> achieved", async () => {
    await h.set()
    h.verdicts.push(notMet("2 tests still fail"))
    await h.turn()
    expect(h.calls.synthetic).toHaveLength(1)
    expect(h.calls.synthetic[0].text).toContain("2 tests still fail")
    expect(h.calls.synthetic[0].resume).toBeUndefined()
    expect(h.controller.get(SID)?.turns).toBe(1)

    h.verdicts.push(met("all 40 tests pass"))
    await h.turn()
    const goal = h.controller.get(SID)!
    expect(goal.status).toBe("achieved")
    expect(goal.turns).toBe(2)
    expect(goal.endedAt).toBeDefined()
    // The verdict note is recorded without waking the session.
    expect(h.calls.synthetic.at(-1).resume).toBe(false)
    // End-of-record notes carry the terminal tag so the context hook strips them from later model requests.
    expect(h.calls.synthetic.at(-1).text).toContain("<goal-note final>")
    expect(h.notices.some((n) => n.kind === "achieved")).toBeTrue()
  })

  test("the outcome toast carries the story: turns · wall time · reason", async () => {
    h = harness()
    await h.set()
    h.clock.t += 125_000
    h.verdicts.push(met("all 40 tests pass"))
    await h.turn()
    const notice = h.notices.at(-1)
    expect(notice?.kind).toBe("achieved")
    expect(notice?.message).toContain("1 turn · 2m 05s")
    expect(notice?.message).toContain("all 40 tests pass")
  })

  test("evaluator receives turn number, elapsed time and spend since the goal was set", async () => {
    await h.set()
    h.clock.t += 90_000
    h.setUsage({ cost: 3, input: 600, output: 60, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
    h.verdicts.push(notMet())
    await h.turn()
    expect(h.requests[0]).toMatchObject({ turn: 1, elapsedMs: 90_000, spend: { cost: 2, input: 500, output: 50 } })
  })

  test("verdict entries carry the per-turn spend delta — arm-seeded, then against the previous reading", async () => {
    h = harness()
    await h.set()
    h.setUsage({ cost: 3, input: 600, output: 60, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
    h.verdicts.push(notMet("first"))
    await h.turn()
    h.setUsage({ cost: 6, input: 900, output: 90, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
    h.verdicts.push(met("done"))
    await h.turn()
    const goal = h.controller.get(SID)!
    // Turn 1 diffs against the arm-time reading (the default fixture: cost 1, input 100).
    expect(goal.history[0]?.spend).toMatchObject({ cost: 2, input: 500, output: 50 })
    // Turn 2 diffs against turn 1 — not against the arm — never cumulative-since-set.
    expect(goal.history[1]?.spend).toMatchObject({ cost: 3, input: 300, output: 30 })
  })

  test("a verdict entry records no spend when the host cannot measure it", async () => {
    h = harness()
    await h.set()
    h.setUsageFn(async () => {
      throw new Error("usage unavailable")
    })
    h.verdicts.push(notMet("no numbers this turn"))
    await h.turn()
    expect(h.controller.get(SID)?.history[0]?.spend).toBeUndefined()
  })

  test("impossible clears the goal", async () => {
    await h.set()
    h.verdicts.push({ verdict: "impossible", reason: "the API does not exist" })
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("impossible")
    expect(h.controller.live(SID)).toBeUndefined()
  })

  test("stall guard pauses after N turns without tool use, and a user prompt resumes", async () => {
    h = harness({ stallTurns: 3 })
    await h.set()
    for (let i = 0; i < 3; i++) {
      h.verdicts.push(notMet())
      await h.turn(0)
    }
    expect(h.controller.get(SID)?.status).toBe("paused")
    expect(h.calls.synthetic).toHaveLength(2)
    h.controller.onUserPrompt(SID)
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(h.controller.get(SID)?.stall).toBe(0)
  })

  test("a no-op commit is not saved or emitted twice", async () => {
    const storage = new MemoryStorage()
    let sets = 0
    const originalSet = storage.set
    storage.set = async (key: string, value: unknown) => {
      sets += 1
      return originalSet(key, value)
    }
    h = harness({}, storage)
    await h.set()
    expect(sets).toBe(1)
    expect(h.changes).toHaveLength(1)
    // User prompt on an already-active goal changes nothing in the record: no write, no re-render.
    h.controller.onUserPrompt(SID)
    expect(sets).toBe(1)
    expect(h.changes).toHaveLength(1)
    // A real change (a turn evaluated) still persists and emits.
    h.verdicts.push(notMet())
    await h.turn()
    expect(sets).toBeGreaterThan(1)
    expect(h.changes.length).toBeGreaterThan(1)
  })

  test("pause causes persist on the record and clear on resume", async () => {
    h = harness({ stallTurns: 2 })
    await h.set()
    h.verdicts.push(notMet(), notMet())
    await h.turn(0)
    await h.turn(0)
    expect(h.controller.get(SID)?.status).toBe("paused")
    expect(h.controller.get(SID)?.pauseCause).toBe("stall")
    h.controller.onUserPrompt(SID)
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(h.controller.get(SID)?.pauseCause).toBeUndefined()

    h = harness({ maxTurns: 1 })
    await h.set()
    h.verdicts.push(notMet())
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("paused")
    expect(h.controller.get(SID)?.pauseCause).toBe("cap")
  })

  test("user interrupt records the user cause; resume clears it", async () => {
    await h.set()
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionInterrupted(SID, "user")
    expect(h.controller.get(SID)?.status).toBe("paused")
    expect(h.controller.get(SID)?.pauseCause).toBe("user")
    h.controller.onUserPrompt(SID)
    expect(h.controller.get(SID)?.pauseCause).toBeUndefined()
  })

  test("hard turn limit pauses", async () => {
    h = harness({ maxTurns: 2 })
    await h.set()
    h.verdicts.push(notMet(), notMet())
    await h.turn()
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("paused")
    expect(h.controller.get(SID)?.reason).toContain("2-turn")
  })

  test("clear and aliases; status reports", async () => {
    await h.controller.command({ sessionID: SID, text: "", delivery: "steer" })
    expect(h.notices.at(-1)?.title).toBe("No goal set")
    await h.set()
    await h.controller.command({ sessionID: SID, text: "cancel", delivery: "steer" })
    expect(h.controller.get(SID)?.status).toBe("cleared")
    expect(h.notices.at(-1)?.message).toBe("all tests pass")
    await h.controller.command({ sessionID: SID, text: "off", delivery: "steer" })
    expect(h.notices.at(-1)?.title).toBe("No goal set")
  })

  test("a new goal replaces the active one", async () => {
    await h.set("first")
    await h.set("second")
    expect(h.controller.get(SID)?.condition).toBe("second")
    expect(h.notices.at(-1)?.title).toBe("Goal replaced")
  })

  test("clearing during evaluation drops the stale verdict", async () => {
    await h.set()
    let release!: (r: EvaluationResult) => void
    h.verdicts.push(() => new Promise((resolve) => (release = resolve)))
    h.controller.onExecutionStarted(SID)
    const ending = h.controller.onExecutionSucceeded(SID)
    await flush()
    expect(h.controller.snapshot(SID)?.evaluating).toBeTrue()
    h.controller.clear(SID)
    release(notMet())
    await ending
    expect(h.calls.synthetic).toHaveLength(0)
    expect(h.controller.get(SID)?.status).toBe("cleared")
  })

  test("a user turn starting mid-evaluation supersedes it", async () => {
    await h.set()
    let release!: (r: EvaluationResult) => void
    h.verdicts.push(() => new Promise((resolve) => (release = resolve)))
    const ending = h.controller.onExecutionSucceeded(SID)
    await flush()
    h.controller.onExecutionStarted(SID)
    release(notMet())
    await ending
    expect(h.calls.synthetic).toHaveLength(0)
    expect(h.controller.get(SID)?.turns).toBe(0)
  })

  test("background work defers evaluation and arms check-ins with backoff", async () => {
    await h.set()
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn()
    expect(h.requests).toHaveLength(0)
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    await h.clock.advance(29 * 60_000)
    expect(h.calls.synthetic).toHaveLength(0)
    await h.clock.advance(60_000)
    expect(h.calls.synthetic).toHaveLength(1)
    expect(h.calls.synthetic[0].text).toContain("1 subagent")
    // The check-in turn ends with work still running: next check-in after 2x the interval.
    await h.turn(0)
    await h.clock.advance(59 * 60_000)
    expect(h.calls.synthetic).toHaveLength(1)
    await h.clock.advance(60_000)
    expect(h.calls.synthetic).toHaveLength(2)
    // Background finished: the next turn is evaluated, carrying earlier tool use.
    h.setWork({ subagents: 0, shells: 0 })
    h.verdicts.push(notMet())
    await h.turn(0)
    expect(h.requests).toHaveLength(1)
    expect(h.controller.get(SID)?.stall).toBe(0)
  })

  test("idle check-ins stop after the cap until the user prompts", async () => {
    h = harness({ maxIdleCheckins: 1 })
    await h.set()
    h.setWork({ subagents: 0, shells: 1 })
    await h.turn()
    await h.clock.advance(30 * 60_000)
    expect(h.calls.synthetic).toHaveLength(1)
    expect(h.notices.at(-1)?.message).toContain("paused until you send another prompt")
    await h.turn()
    await h.clock.advance(10 * 60 * 60_000)
    expect(h.calls.synthetic).toHaveLength(1)
  })

  test("transient failures retry with capped backoff, forever", async () => {
    h = harness({ maxRetries: 2 })
    await h.set()
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionFailed(SID, { status: 529, message: "Overloaded" })
    expect(h.notices.at(-1)?.title).toBe("Goal still active")
    await h.clock.advance(15_000)
    expect(h.calls.synthetic).toHaveLength(1)
    expect(h.calls.synthetic[0].text).toContain("<goal-retry>")
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionFailed(SID, { message: "socket hang up, network error" })
    await h.clock.advance(60_000)
    expect(h.calls.synthetic).toHaveLength(2)
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionFailed(SID, { status: 503, message: "unavailable" })
    expect(h.controller.get(SID)?.status).toBe("active")
    await h.clock.advance(5 * 60_000)
    expect(h.calls.synthetic).toHaveLength(3)
    expect(h.controller.get(SID)?.status).toBe("active")
  })

  test("fatal failures clear the goal; rate limits retry with long backoff and never pause", async () => {
    await h.set()
    h.controller.onExecutionFailed(SID, { status: 401, message: "invalid api key" })
    expect(h.controller.get(SID)?.status).toBe("failed")
    expect(h.controller.get(SID)?.reason).toContain("Run /goal again")
    expect(h.controller.get(SID)?.failureLabel).toBe("authentication failure")

    await h.set()
    h.controller.onExecutionFailed(SID, { status: 429, message: "slow down" })
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(h.notices.at(-1)?.title).toBe("Goal still active")
    const before = h.calls.synthetic.length
    await h.clock.advance(15 * 60_000)
    expect(h.calls.synthetic.length).toBeGreaterThan(before)
    expect(h.controller.get(SID)?.status).toBe("active")
  })

  test("checkinMinutes 0 disables idle check-in nudges, not retries", async () => {
    h = harness({ checkinMinutes: 0 })
    await h.set()
    h.controller.onExecutionFailed(SID, { status: 529, message: "Overloaded" })
    expect(h.controller.get(SID)?.status).toBe("active")
    await h.clock.advance(15_000)
    expect(h.calls.synthetic).toHaveLength(1)
  })

  test("user interrupt pauses; shutdown keeps the goal active", async () => {
    await h.set()
    h.controller.onExecutionInterrupted(SID, "shutdown")
    expect(h.controller.get(SID)?.status).toBe("active")
    h.controller.onExecutionInterrupted(SID, "user")
    expect(h.controller.get(SID)?.status).toBe("paused")
  })

  test("evaluator errors retry forever with capped backoff", async () => {
    h = harness({ maxRetries: 1 })
    await h.set()
    h.verdicts.push(new Error("boom"))
    await h.turn()
    expect(h.controller.get(SID)?.retries).toBe(1)
    expect(h.controller.get(SID)?.status).toBe("active")
    h.verdicts.push(new Error("boom again"))
    await h.clock.advance(10_000)
    expect(h.controller.get(SID)?.retries).toBe(2)
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(h.controller.get(SID)?.reason).toBeUndefined()
  })

  test("goals persist and restore with reset counters; finished goals are not restored", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore me")
    first.verdicts.push(notMet())
    await first.turn()
    await first.store.flush()
    const second = harness({}, storage)
    expect(await second.controller.restore()).toBe(1)
    const goal = second.controller.get(SID)!
    expect(goal).toMatchObject({ condition: "restore me", status: "active", turns: 0 })

    second.controller.clear(SID)
    await second.store.flush()
    expect(await harness({}, storage).controller.restore()).toBe(0)
  })

  test("goals of deleted sessions are dropped on restore", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set()
    await first.store.flush()
    const second = harness({}, storage)
    second.setUsageFn(async () => {
      throw Object.assign(new Error("session not found"), { status: 404 })
    })
    expect(await second.controller.restore()).toBe(0)
    // Storage entry was removed, so a third restore also finds nothing.
    expect(await harness({}, storage).controller.restore()).toBe(0)
  })

  test("restore keeps goals on transient usage failure or unavailable usage", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("keep me")
    await first.store.flush()
    const second = harness({}, storage)
    second.setUsageFn(async () => {
      throw new Error("ECONNRESET socket hang up")
    })
    expect(await second.controller.restore()).toBe(1)
    expect(second.controller.get(SID)?.condition).toBe("keep me")
    expect(second.controller.get(SID)?.status).toBe("active")

    const third = harness({}, storage)
    third.setUsage(undefined)
    expect(await third.controller.restore()).toBe(1)
  })

  test("resume at turn cap stays paused (message does not extend cap)", async () => {
    h = harness({ maxTurns: 2 })
    await h.set()
    h.verdicts.push(notMet(), notMet())
    await h.turn()
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("paused")
    h.controller.onUserPrompt(SID)
    expect(h.controller.get(SID)?.status).toBe("paused")
    expect(h.notices.at(-1)?.message).toContain("will not extend the cap")
  })

  test("deferred state is cleared on failure, interrupt and resume", async () => {
    await h.set()
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn()
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    // Failure clears deferred/carried.
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionFailed(SID, { status: 401, message: "invalid api key" })
    expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
    // Deferred again, then interrupt clears it.
    await h.set()
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn()
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionInterrupted(SID, "user")
    expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
    expect(h.controller.get(SID)?.status).toBe("paused")
    // Resume clears any deferred state as well.
    h.controller.onUserPrompt(SID)
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
  })

  test("the final spend re-save emits a changed snapshot carrying the settled spend", async () => {
    await h.set()
    h.setUsage({ cost: 5, input: 500, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
    h.verdicts.push(met("done"))
    await h.turn()
    await flush()
    expect(h.controller.get(SID)?.status).toBe("achieved")
    // The last changed event must carry the settled spend vs baseline — terminal goals are never
    // re-pulled by the TUI's stale-chrome guard, so this event is the only push they get.
    const last = h.changes.at(-1)
    expect(last?.spend).toBeDefined()
    expect(last?.spend?.cost).toBe(4)
  })

  test("terminal spend snapshot failure is handled, goal still finishes", async () => {
    await h.set()
    h.verdicts.push(met("done"))
    h.setUsageFn(async () => {
      throw new Error("usage unavailable")
    })
    await h.turn()
    await flush()
    expect(h.controller.get(SID)?.status).toBe("achieved")
    expect(h.controller.get(SID)?.final).toBeUndefined()
  })

  test("session deletion forgets the goal", async () => {
    await h.set()
    h.controller.onSessionDeleted(SID)
    expect(h.controller.get(SID)).toBeUndefined()
    expect(h.changes.at(-1)).toBeNull()
  })
})

describe("event router", () => {
  test("dedupes replayed events and routes shells/subagents to the tracker", async () => {
    const h = harness()
    const background = new BackgroundTracker({ parentOf: async () => undefined })
    const route = createRouter({ controller: h.controller, background, log: { info() {}, warn() {}, error() {} }, compactor: testCompactor([]) })
    await h.set()
    route({ type: "session.created", data: { sessionID: "child", parentID: SID } })
    route({ type: "session.execution.started", data: { sessionID: "child" } })
    route({ type: "shell.created", data: { info: { id: "sh1", status: "running", metadata: { sessionID: SID } } } })
    expect(await background.busy(SID)).toEqual({ subagents: 1, shells: 1 })
    route({ type: "shell.exited", data: { id: "sh1", status: "exited" } })
    route({ id: "e1", type: "session.execution.succeeded", data: { sessionID: "child" } })
    expect(await background.busy(SID)).toEqual({ subagents: 0, shells: 0 })

    h.verdicts.push(notMet())
    route({ id: "e2", type: "session.execution.succeeded", data: { sessionID: SID } })
    route({ id: "e2", type: "session.execution.succeeded", data: { sessionID: SID } })
    await flush()
    expect(h.requests).toHaveLength(1)
  })

  test("shell.updated and shell.exited (even without running status) update the tracker", async () => {
    const h = harness()
    const background = new BackgroundTracker({ parentOf: async () => undefined })
    const route = createRouter({ controller: h.controller, background, log: { info() {}, warn() {}, error() {} }, compactor: testCompactor([]) })
    await h.set()
    route({ type: "shell.created", data: { info: { id: "sh1", status: "running", metadata: { sessionID: SID } } } })
    expect((await background.busy(SID)).shells).toBe(1)
    // Updated to a non-running status ends it.
    route({ type: "shell.updated", data: { info: { id: "sh1", status: "exited", metadata: { sessionID: SID } } } })
    expect((await background.busy(SID)).shells).toBe(0)
    // Updated to running with an owner tracks it again.
    route({ type: "shell.updated", data: { info: { id: "sh1", status: "running", metadata: { sessionID: SID } } } })
    expect((await background.busy(SID)).shells).toBe(1)
    // shell.exited without any status field still ends it.
    route({ type: "shell.exited", data: { id: "sh1" } })
    expect((await background.busy(SID)).shells).toBe(0)
  })

  test("settled handlers throwing do not crash the router", () => {
    const background = new BackgroundTracker({ parentOf: async () => undefined })
    const throwing = {
      onExecutionStarted: () => {
        throw new Error("boom started")
      },
      onToolCalled: () => {
        throw new Error("boom tool")
      },
      onExecutionSucceeded: async () => {
        throw new Error("boom succeeded")
      },
      onExecutionFailed: () => {
        throw new Error("boom failed")
      },
      onExecutionInterrupted: () => {
        throw new Error("boom interrupted")
      },
      onBackgroundDrained: () => {
        throw new Error("boom drain")
      },
      onSessionDeleted: () => {
        throw new Error("boom deleted")
      },
    } as any
    const errors: unknown[] = []
    const route = createRouter({ controller: throwing, background, log: { info() {}, warn() {}, error: (_m: string, e?: any) => void errors.push(e) }, compactor: testCompactor([]) })
    expect(() => route({ type: "session.execution.started", data: { sessionID: SID } })).not.toThrow()
    expect(() => route({ type: "session.execution.failed", data: { sessionID: SID, error: { message: "x" } } })).not.toThrow()
    expect(() => route({ type: "session.execution.interrupted", data: { sessionID: SID, reason: "user" } })).not.toThrow()
    expect(() => route({ type: "session.tool.called", data: { sessionID: SID } })).not.toThrow()
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })

  test("async handlers that reject are reported, never escaping the router", async () => {
    const background = new BackgroundTracker({ parentOf: async () => undefined })
    const rejecting = {
      onExecutionSucceeded: async () => {
        throw new Error("boom succeeded")
      },
      onCompactionLanded: async () => {
        throw new Error("boom landing")
      },
      onBackgroundDrained: async () => {
        throw new Error("boom drain")
      },
    } as any
    const failingCompactor = (() => {
      const inner = testCompactor([]) as any
      inner.maybeCompact = async () => {
        throw new Error("boom compact")
      }
      return inner
    })()
    const errors: unknown[] = []
    const route = createRouter({
      controller: rejecting,
      background,
      log: { info() {}, warn() {}, error: (_m: string, e?: any) => void errors.push(e) },
      compactor: failingCompactor,
    })
    route({ id: "a1", type: "session.execution.succeeded", data: { sessionID: SID } })
    route({ id: "a2", type: "session.compaction.ended", data: { sessionID: SID } })
    await flush()
    // 4 reports: the succeeded rejection, the compaction rejection, the landing rejection, and the drain hook's own rejection — the drain is wired and its failures are reported, never escaping the router.
    expect(errors.length).toBe(4)
  })

  test("grandchildren count as background work", async () => {
    const parents: Record<string, string> = { grandchild: "child", child: SID }
    const background = new BackgroundTracker({ parentOf: async (id) => parents[id] })
    background.executionStarted("grandchild")
    expect((await background.busy(SID)).subagents).toBe(1)
  })
})

describe("GoalController async holes", () => {
  test("a rejecting durable write is treated as unwritten: set() resolves, the no-op marker drops, the next identical commit retries", async () => {
    const h = harness()
    // Storage fault at the port boundary: save() itself rejects (distinct from a swallowed fallible set()).
    let saveCalls = 0
    h.store.save = async (): Promise<boolean> => {
      saveCalls++
      throw new Error("pin: save rejects")
    }
    await h.set("all tests pass")
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(saveCalls).toBe(1)
    // The record state is identical, so the commit only lands if the no-op marker was dropped with the failed write.
    h.controller.onUserPrompt(SID)
    await flush()
    expect(saveCalls).toBe(2)
  })

  test("an evaluator fault under a storage fault still arms the retry and persists nothing durable", async () => {
    const h = harness()
    let saveCalls = 0
    h.store.save = async (): Promise<boolean> => {
      saveCalls++
      throw new Error("pin: save rejects")
    }
    await h.set("all tests pass")
    const baseline = saveCalls
    h.verdicts.push(new Error("evaluator down"))
    await h.turn()
    await flush()
    expect(h.notices.some((n) => n.kind === "retry")).toBe(true)
    const afterFailure = saveCalls
    expect(afterFailure).toBeGreaterThan(baseline)
    await h.clock.advance(10_500)
    await flush()
    // The retry fired (second evaluation attempt) and its failed write was attempted, not skipped on the stale marker.
    expect(h.requests.length).toBe(2)
    expect(saveCalls).toBeGreaterThanOrEqual(afterFailure + 1)
  })

  test("a healthy store still short-circuits identical commits on the no-op marker", async () => {
    const h = harness()
    let saveCalls = 0
    const original = h.store.save.bind(h.store)
    h.store.save = async (record) => {
      saveCalls++
      return original(record)
    }
    await h.set("all tests pass")
    expect(saveCalls).toBe(1)
    h.controller.onUserPrompt(SID)
    await flush()
    // Identical record: no second durable write.
    expect(saveCalls).toBe(1)
  })
})

describe("context meter snapshot fields", () => {
  test("snapshot carries compactAtTokens when the auto-compact threshold is enabled; omits it when disabled", async () => {
    const withThreshold = harness({ compactAtTokens: 150_000 })
    await withThreshold.set()
    expect(withThreshold.controller.snapshot(SID)?.compactAtTokens).toBe(150_000)

    const without = harness()
    await without.set()
    expect(without.controller.snapshot(SID)?.compactAtTokens).toBeUndefined()
  })

  test("snapshot attaches a caller-provided context estimate; non-finite or negative estimates are dropped", async () => {
    const h = harness()
    await h.set()
    expect(h.controller.snapshot(SID, undefined, 95_000)?.contextSize).toBe(95_000)
    expect(h.controller.snapshot(SID, undefined, Number.NaN)?.contextSize).toBeUndefined()
    expect(h.controller.snapshot(SID, undefined, -1)?.contextSize).toBeUndefined()
    expect(h.controller.snapshot(SID)?.contextSize).toBeUndefined()
  })

  test("contextSize() returns undefined when the estimateContext dependency is absent (never fabricates a number)", async () => {
    const h = harness()
    await h.set()
    expect(await h.controller.contextSize(SID)).toBeUndefined()
  })

  test("the turn's changed events carry the measured spend and context figures (per-turn refresh)", async () => {
    const h = harness()
    h.setEstimateContext(async () => 432_100)
    await h.set()
    h.changes.length = 0
    h.setUsage({ cost: 7, input: 700, output: 70, reasoning: 0, cacheRead: 5, cacheWrite: 0 })
    h.verdicts.push(notMet("keep going"))
    await h.turn()
    const withFigures = h.changes.filter((c) => c?.contextSize === 432_100)
    expect(withFigures.length).toBeGreaterThan(0)
    expect(withFigures[0]?.spend?.cost).toBe(6) // 7 vs the arm-time baseline of 1
  })

  test("the terminal achieved snapshot carries the settled spend AND the last measured context figure", async () => {
    const h = harness()
    h.setEstimateContext(async () => 99_001)
    await h.set()
    h.setUsage({ cost: 8, input: 800, output: 80, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
    h.verdicts.push(met("done"))
    await h.turn()
    await flush()
    expect(h.controller.get(SID)?.status).toBe("achieved")
    const terminal = h.changes.at(-1)
    expect(terminal?.spend?.cost).toBe(7)
    expect(terminal?.contextSize).toBe(99_001)
  })
})

describe("restore of under-validated records regression", () => {
  test("a legacy record missing `history` is normalized and evaluates without wedging", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("legacy record")
    await first.store.flush()
    const key = `goal/v1/${SID}`
    const raw = structuredClone(storage.data.get(key)) as Record<string, unknown>
    delete raw.history
    storage.data.set(key, raw)
    const second = harness({}, storage)
    expect(await second.controller.restore()).toBe(1)
    second.verdicts.push(notMet())
    await second.turn()
    expect(second.controller.get(SID)?.status).toBe("active")
    expect(second.controller.get(SID)?.history).toHaveLength(1)
  })

  test("dispose awaits the final spend snapshot and flushes it to storage", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    await h.set()
    h.verdicts.push(met("done"))
    const usageNow = { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    let parked: ((value: typeof usageNow) => void) | undefined
    let call = 0
    h.setUsageFn(() => {
      call += 1
      if (call === 1) return Promise.resolve(usageNow) // the per-turn measurement
      return new Promise((resolve) => {
        parked = resolve as (value: typeof usageNow) => void // the final snapshot, parked by the test
      })
    })
    await h.turn()
    const disposing = h.controller.dispose()
    await flush()
    parked!({ cost: 7, input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
    await disposing
    const stored = storage.data.get(`goal/v1/${SID}`) as Record<string, unknown>
    expect(stored.status).toBe("achieved")
    expect((stored.final as { cost: number }).cost).toBe(7)
  })
})

describe("event router status-less shell.updated regression", () => {
  test("a shell.updated with no status anywhere keeps tracking the shell; shell.exited ends it", async () => {
    const h = harness()
    const background = new BackgroundTracker({ parentOf: async () => undefined })
    const route = createRouter({ controller: h.controller, background, log: silentLog, compactor: testCompactor([]) })
    await h.set()
    route({ type: "shell.created", data: { info: { id: "sh1", status: "running", metadata: { sessionID: SID } } } })
    expect((await background.busy(SID)).shells).toBe(1)
    route({ type: "shell.updated", data: { info: { id: "sh1" } } })
    expect((await background.busy(SID)).shells).toBe(1)
    route({ type: "shell.exited", data: { id: "sh1" } })
    expect((await background.busy(SID)).shells).toBe(0)
  })
})
