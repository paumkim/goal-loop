import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveConfig } from "../src/core/config.ts"
import { isUsageLimitError } from "../src/core/errors.ts"
import type { CommitPolicy, GoalSnapshot, Notice, UsageSnapshot } from "../src/core/types.ts"
import { BackgroundTracker } from "../src/runtime/background.ts"
import { GoalController } from "../src/runtime/controller.ts"
import { createRouter } from "../src/runtime/events.ts"
import { AutoCompactor } from "../src/runtime/compactor.ts"
import type { BackgroundWork, Clock, EvaluationRequest, EvaluationResult, LoopSummaryRequest, NextGoalRequest, StoragePort } from "../src/runtime/ports.ts"
import { EvaluationTimeoutError, EvaluatorVerdictError } from "../src/runtime/evaluator.ts"
import { GoalStore } from "../src/runtime/store.ts"
import { MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES, MAX_TERMINAL_RECORD_ENTRIES, type GoalRecord, type GoalStatus } from "../src/core/types.ts"

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
  directory = DIR,
) {
  const clock = new FakeClock()
  const calls = { prompts: [] as any[], synthetic: [] as any[] }
  const verdicts: Array<EvaluationResult | Error | (() => Promise<EvaluationResult>)> = []
  const requests: EvaluationRequest[] = []
  const notices: Notice[] = []
  const changes: Array<GoalSnapshot | null> = []
  let work: BackgroundWork = { subagents: 0, shells: 0 }
  let busyError: Error | undefined
  let usage: UsageSnapshot | undefined = { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  let usageFn: (() => Promise<UsageSnapshot | undefined>) | undefined
  let estimateContext: (() => Promise<number | undefined>) | undefined
  const store = new GoalStore(storage, (e) => {
    throw e
  })
  const logs: Array<{ level: string; message: string; extra?: unknown }> = []
  const silent = { info() {}, warn() {}, error() {} }
  const log = typeof options.log === "object" && options.log !== null
    ? (options.log as { info(m: string, e?: unknown): void; warn(m: string, e?: unknown): void; error(m: string, e?: unknown): void })
    : silent
  const controller = new GoalController({
    config: resolveConfig({ learning: { enabled: false }, ...options }),
    directory,
    commit,
    clock,
    store,
    log,
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
    background: { busy: async () => { if (busyError) throw busyError; return work } },
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
    logs,
    turn,
    setWork: (w: BackgroundWork) => void (work = w),
    setBusyError: (e: Error | undefined) => void (busyError = e),
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

  test("showPlanning paints a transient queued bar before the record exists", () => {
    h.controller.showPlanning(SID, "  replay: hi.  ")
    const snapshot = h.changes.at(-1)
    expect(snapshot?.condition).toBe("  replay: hi.  ")
    expect(snapshot?.status).toBe("active")
    expect(snapshot?.queued).toBe(true)
    expect(snapshot?.evaluating).toBe(false)
    expect(snapshot?.turns).toBe(0)
    // Transient: no live record is created, so a later arm is the authoritative snapshot.
    expect(h.controller.get(SID)).toBeUndefined()
    expect(h.calls.prompts).toHaveLength(0)
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
    expect(h.calls.synthetic[0].resume).toBe(true)
    expect(h.controller.get(SID)?.turns).toBe(1)

    h.verdicts.push(met("all 40 tests pass"))
    await h.turn()
    const goal = h.controller.get(SID)!
    expect(goal.status).toBe("achieved")
    expect(goal.turns).toBe(2)
    expect(goal.endedAt).toBeDefined()
    // Regression: a met verdict on a plain goal is terminal — evaluate() must not fall through to the
    // continuation dispatch and re-arm the achieved goal (turn 3 steer seen before the fix).
    expect(h.calls.synthetic).toHaveLength(1)
    // The verdict outcome note is retired (LXVII): the steer resumes the goal, and no synthetic note rides the achievement.
    expect(h.calls.synthetic.some((synthetic) => String(synthetic.description ?? "").startsWith("Goal achieved"))).toBe(false)
    expect(h.notices.some((n) => n.kind === "achieved")).toBeTrue()
  })
  test("an impossible verdict is terminal: it does not re-arm the goal", async () => {
    await h.set()
    h.verdicts.push({ verdict: "impossible", reason: "the target cannot be built here" })
    await h.turn()
    const goal = h.controller.get(SID)!
    expect(goal.status).toBe("impossible")
    // Regression: like met, an impossible verdict must not fall through to the continuation dispatch.
    expect(h.calls.synthetic).toHaveLength(0)
    expect(h.notices.some((n) => n.kind === "impossible")).toBeTrue()
  })
  test("terminal settle: exactly one outcome-story notice per terminal path", async () => {
    // Every terminal path now routes through the single settleTerminal helper (finish -> outcome story ->
    // one notice). Pin the achieved message shape so a future split cannot double-announce or drop the story.
    await h.set()
    h.verdicts.push(met("all 40 tests pass"))
    await h.turn()
    const achieved = h.notices.filter((n) => n.kind === "achieved")
    expect(achieved).toHaveLength(1)
    expect(achieved[0]!.title).toBe("Goal achieved in 1 turn")
    expect(achieved[0]!.message).toContain("1 turn")
    expect(achieved[0]!.message).toContain("all 40 tests pass")

    // Fatal failure is the fourth caller of the same helper: one `failed` notice, story body carrying the reason.
    h = harness()
    await h.set()
    h.controller.onExecutionFailed(SID, { status: 401, message: "invalid api key" })
    const failed = h.notices.filter((n) => n.kind === "failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]!.title).toBe("Goal failed")
    expect(failed[0]!.message).toContain("Run /goal again")
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

  test("a deferred goal flips to active on session heartbeats and back to waiting when the session goes quiet — instantly, with no clock tick", async () => {
    await h.set()
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn() // turn ends with the subagent still busy: deferral set, pill waiting
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    expect(h.changes.at(-1)?.waiting).toBeTrue()

    // A new user turn / synthetic continuation starts: the main session is working again. The indicator
    // flips to active ON THIS EVENT — no clock advance, no evaluation, no background drain.
    const before = h.changes.length
    h.controller.onExecutionStarted(SID)
    expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
    expect(h.changes.length).toBe(before + 1)
    expect(h.changes.at(-1)?.waiting).toBeFalse()
    // The deferral is untouched: evaluation is still held back and the persisted twin is still there.
    expect(h.requests).toHaveLength(0)
    expect(typeof h.controller.get(SID)?.waitingSince).toBe("number")

    // Many tool calls are many heartbeats but only one paint flip — no changed-event spam per call.
    h.controller.onToolCalled(SID)
    h.controller.onToolCalled(SID)
    expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
    expect(h.changes.length).toBe(before + 1)

    // The turn ends with the subagent still busy: the pill flips straight back to waiting on this event.
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    expect(h.changes.at(-1)?.waiting).toBeTrue()
    expect(h.requests).toHaveLength(0)
  })

  test("a tool call alone flips a deferred pill to active even when the execution-start event was missed", async () => {
    await h.set()
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn()
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    const before = h.changes.length
    // No execution-started event — simulate a restart/reconnect that swallowed it. The tool event is still
    // a heartbeat proving the main session is active, so the pill must not stay stuck on `waiting`.
    h.controller.onToolCalled(SID)
    expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
    expect(h.changes.at(-1)?.waiting).toBeFalse()
    expect(h.changes.length).toBe(before + 1)
  })

  test("retries evaluation when the busy check errors instead of skipping permanently", async () => {
    await h.set()
    h.setBusyError(new Error("busy check failed"))
    await h.turn()
    expect(h.requests).toHaveLength(0)
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    expect(h.notices.some((n) => n.kind === "retry" && n.message.includes("Could not check background work state"))).toBeTrue()

    h.setBusyError(undefined)
    h.verdicts.push(notMet("recovered"))
    await h.clock.advance(15_000)
    expect(h.requests).toHaveLength(1)
    expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
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

  test("transient failures retry with capped backoff and fail at maxRetries", async () => {
    h = harness({ maxRetries: 5 })
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
    // Two more transient failures exhaust the cap (retries 4 and 5).
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionFailed(SID, { message: "connection reset" })
    await h.clock.advance(5 * 60_000)
    expect(h.controller.get(SID)?.status).toBe("active")
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionFailed(SID, { message: "connection reset again" })
    expect(h.controller.get(SID)?.status).toBe("failed")
    expect(h.controller.get(SID)?.failureLabel).toBe("execution retries exhausted")
  })

  test("queued stays false during retry backoff and flips only when the retry continuation is dispatched", async () => {
    await h.set()
    expect(h.controller.snapshot(SID)?.queued).toBe(false)
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionFailed(SID, { status: 529, message: "Overloaded" })
    // No steer dispatched during backoff.
    expect(h.controller.snapshot(SID)?.queued).toBe(false)
    expect(h.calls.synthetic).toHaveLength(0)
    await h.clock.advance(14_999)
    expect(h.controller.snapshot(SID)?.queued).toBe(false)
    expect(h.calls.synthetic).toHaveLength(0)
    await h.clock.advance(1)
    await flush()
    expect(h.calls.synthetic).toHaveLength(1)
    expect(h.controller.snapshot(SID)?.queued).toBe(true)
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
    expect(h.controller.snapshot(SID)?.queued).toBe(false)
    h.controller.onExecutionInterrupted(SID, "user")
    expect(h.controller.get(SID)?.status).toBe("paused")
  })

  test("inactivity interruption keeps queued false during backoff and flips only at retry dispatch", async () => {
    await h.set()
    h.controller.onExecutionStarted(SID)
    h.controller.onExecutionInterrupted(SID, "inactivity")
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(h.controller.snapshot(SID)?.queued).toBe(false)
    expect(h.calls.synthetic).toHaveLength(0)
    await h.clock.advance(14_999)
    expect(h.controller.snapshot(SID)?.queued).toBe(false)
    await h.clock.advance(1)
    await flush()
    expect(h.calls.synthetic).toHaveLength(1)
    expect(h.controller.snapshot(SID)?.queued).toBe(true)
  })

  test("evaluator errors fail the goal at maxRetries", async () => {
    h = harness({ maxRetries: 1 })
    await h.set()
    h.verdicts.push(new Error("boom"))
    await h.turn()
    expect(h.controller.get(SID)?.retries).toBe(1)
    expect(h.controller.get(SID)?.status).toBe("failed")
    expect(h.controller.get(SID)?.failureLabel).toBe("evaluator retries exhausted")
  })
  test("an evaluator timeout surfaces as a named timeout in the notice and retries with bounded backoff", async () => {
    await h.set()
    h.verdicts.push(new EvaluationTimeoutError("evaluator timed out after 120s (attempt 1/3)"))
    await h.turn()
    expect(h.controller.get(SID)?.retries).toBe(1)
    expect(h.controller.get(SID)?.status).toBe("active")
    const notice = h.notices.at(-1)
    expect(notice?.title).toBe("Goal still active")
    expect(notice?.message).toContain("Evaluator failed")
    expect(notice?.message).toContain("evaluator timed out after 120s")
    expect(notice?.message).toContain("retrying in 10s")
    // Bounded backoff: the next failure backs off to 30s, and no unreadable-verdict loop with no progress.
    h.verdicts.push(new EvaluationTimeoutError("evaluator timed out after 120s (attempt 1/3)"))
    await h.clock.advance(10_000)
    expect(h.controller.get(SID)?.retries).toBe(2)
    expect(h.notices.at(-1)?.message).toContain("retrying in 30s")
  })

  test("an unreadable native verdict pauses the goal instead of re-arming the worker into a loop", async () => {
    h = harness({ maxRetries: 3 })
    await h.set()
    h.verdicts.push(new EvaluatorVerdictError("no usable evaluator subagent verdict: unreadable verdict: evaluator subagent returned no authoritative verdict/met field"))
    await h.turn()
    const paused = h.controller.get(SID)
    expect(paused?.status).toBe("paused")
    expect(paused?.pauseCause).toBe("repeated_failure")
    expect(paused?.reason).toContain("no usable evaluator subagent verdict")
    const notice = h.notices.at(-1)
    expect(notice?.title).toBe("Goal paused")
    expect(notice?.kind).toBe("paused")
    // No continuation steer on this turn, and no retry timer: the wake→delegate→garbage loop is broken.
    expect(h.requests.length).toBe(1)
    expect(h.clock.pending).toBe(0)
    // A user message resumes; a real verdict then completes the goal.
    h.controller.onUserPrompt(SID)
    expect(h.controller.get(SID)?.status).toBe("active")
    h.verdicts.push(met("recovered on a fresh verdict"))
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("achieved")
  })

  test("an evaluator free-usage limit pauses the goal and waits for a message instead of retrying forever", async () => {
    h = harness({ maxRetries: 1 })
    await h.set()
    h.verdicts.push(new Error("Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going"))
    await h.turn()
    // Even with maxRetries=1, a self-clearing usage limit must never exhaust the cap or fail the goal.
    // It pauses outright — like the upstream plugin — rather than spinning on a 15m retry timer forever.
    const paused = h.controller.get(SID)
    expect(paused?.status).toBe("paused")
    expect(paused?.pauseCause).toBe("usage_limit")
    expect(paused?.retries).toBe(1)
    const notice = h.notices.at(-1)
    expect(notice?.title).toBe("Goal paused")
    expect(notice?.kind).toBe("paused")
    expect(notice?.message).toContain("Free usage limit reached")
    expect(notice?.message).toContain("evaluator.model")
    expect(notice?.message).toContain("send a message to resume")
    // No retry timer is armed: advancing the clock never re-evaluates on its own.
    const requestsBefore = h.requests.length
    await h.clock.advance(2 * 60 * 60_000)
    expect(h.requests.length).toBe(requestsBefore)
    expect(h.controller.get(SID)?.status).toBe("paused")
    // A user message resumes; once the quota window clears the next verdict lands.
    h.controller.onUserPrompt(SID)
    expect(h.controller.get(SID)?.status).toBe("active")
    expect(h.controller.get(SID)?.pauseCause).toBeUndefined()
    h.verdicts.push(met("recovered after the quota window reset"))
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("achieved")
  })

  test("isUsageLimitError is narrowly scoped to usage/rate limits", () => {
    expect(isUsageLimitError(new Error("Free usage limit reached"))).toBe(true)
    expect(isUsageLimitError(new Error("rate limit exceeded"))).toBe(true)
    expect(isUsageLimitError({ status: 429, message: "too many requests" })).toBe(true)
    expect(isUsageLimitError("usage limit reached")).toBe(true)
    expect(isUsageLimitError(new Error("boom"))).toBe(false)
    expect(isUsageLimitError(new Error("insufficient credit balance"))).toBe(false)
    expect(isUsageLimitError(new Error("evaluator timed out after 120s"))).toBe(false)
  })

  test("isUsageLimitError ignores non-quota errors that merely mention a limit", () => {
    // A bare "rate/usage/free usage limit" phrase is not a quota signal. The old detector matched the phrase
    // anywhere, so these ordinary evaluator failures paused the goal as a fake free-usage limit.
    const nonQuota = [
      "KiloCode-Free usage is available on this key",
      "no rate limit is configured for this model",
      "rate limit settings are documented at example.com",
      "usage limit was not reached",
      "no usage limit reached",
      "free usage is permitted for this account",
      "evaluator child failed (evaluator timed out after 120s)",
    ]
    for (const message of nonQuota) expect(isUsageLimitError(new Error(message))).toBe(false)

    // Genuine code/status signals still fire, including in a plain object thrown by a provider.
    expect(isUsageLimitError({ type: "rate_limit_error", message: "provider rejected the request" })).toBe(true)
    expect(isUsageLimitError({ code: "tpm_rate_limit_exceeded", message: "Provider returned error" })).toBe(true)
    expect(isUsageLimitError({ status: "429", message: "quota" })).toBe(true)
    expect(isUsageLimitError({ status: 500, message: "Free usage limit reached" })).toBe(true)
  })

  test("a non-quota evaluator error mentioning limits retries instead of pausing with usage_limit", async () => {
    h = harness({ maxRetries: 3 })
    await h.set()
    h.verdicts.push(new Error("evaluator child failed: rate limit settings are documented in the provider docs"))
    await h.turn()
    const record = h.controller.get(SID)
    expect(record?.status).toBe("active")
    expect(record?.pauseCause).toBeUndefined()
    expect(h.notices.at(-1)?.title).toBe("Goal still active")
    expect(h.notices.at(-1)?.message).not.toContain("usage limit")
    h.controller.onUserPrompt(SID)
    h.verdicts.push(met("recovered after the transient evaluator failure"))
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("achieved")
  })

  test("hasTerminalRecord is true only for a record that went terminal in this process (LXVII)", async () => {
    const first = harness()
    expect(first.controller.hasTerminalRecord(SID)).toBe(false)
    await first.set("all tests pass")
    expect(first.controller.hasTerminalRecord(SID)).toBe(false)
    first.verdicts.push(met("done"))
    await first.turn()
    expect(first.controller.get(SID)?.status).toBe("achieved")
    expect(first.controller.hasTerminalRecord(SID)).toBe(true)

    const second = harness()
    expect(second.controller.hasTerminalRecord(SID)).toBe(false)
    await second.set("another condition")
    second.controller.clear(SID)
    expect(second.controller.hasTerminalRecord(SID)).toBe(true)
    // A fresh live goal for the same session disarms the terminal signal.
    await second.set("yet another condition")
    expect(second.controller.hasTerminalRecord(SID)).toBe(false)
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

  test("shell.created reads the id/owner at the top level too, not only under info", async () => {
    const h = harness()
    const background = new BackgroundTracker({ parentOf: async () => undefined })
    const route = createRouter({ controller: h.controller, background, log: { info() {}, warn() {}, error() {} }, compactor: testCompactor([]) })
    await h.set()
    // The created event carries id/status/metadata at the top level, no `info` wrapper.
    route({ type: "shell.created", data: { id: "sh-top", status: "running", metadata: { sessionID: SID } } })
    expect((await background.busy(SID)).shells).toBe(1)
    // A present-but-empty `info` must not mask the top-level id or owner.
    route({ type: "shell.created", data: { id: "sh-top2", status: "running", info: {}, metadata: { sessionID: SID } } })
    expect((await background.busy(SID)).shells).toBe(2)
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

describe("background wait persists across a restart (Workstream XXVII)", () => {
  test("a deferred wait is persisted on the record and painted again after restore", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore me")
    first.setWork({ subagents: 1, shells: 0 })
    await first.turn()
    expect(first.controller.snapshot(SID)?.waiting).toBeTrue()
    await first.store.flush()
    const stored = storage.data.get(`goal/v1/${SID}`) as Record<string, unknown>
    expect(typeof stored.waitingSince).toBe("number")

    // A fresh process: runtime state is gone, so only the record can paint the wait.
    const second = harness({}, storage)
    expect(await second.controller.restore()).toBe(1)
    expect(second.controller.snapshot(SID)?.waiting).toBeTrue()
  })

  test("a restored wait flips to active on the first post-reload heartbeat, pushed as an immediate changed event", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore me")
    first.setWork({ subagents: 1, shells: 0 })
    await first.turn()
    await first.store.flush()

    const second = harness({}, storage)
    expect(await second.controller.restore()).toBe(1)
    expect(second.controller.snapshot(SID)?.waiting).toBeTrue()
    const before = second.changes.length
    // The mirror still paints `waiting` from before the reload; the first heartbeat must push the flip
    // as a changed event instead of leaving the TUI to discover it on its 15s tick.
    second.controller.onExecutionStarted(SID)
    expect(second.controller.snapshot(SID)?.waiting).toBeFalse()
    expect(second.changes.length).toBe(before + 1)
    expect(second.changes.at(-1)?.waiting).toBeFalse()
  })

  test("the background-drain path clears a restored wait and drops the persisted twin", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore me")
    first.setWork({ subagents: 1, shells: 0 })
    await first.turn()
    await first.store.flush()

    const second = harness({}, storage)
    expect(await second.controller.restore()).toBe(1)
    second.setWork({ subagents: 0, shells: 0 })
    second.verdicts.push(notMet())
    // The child's end event routes here: the drain must find the restored deferral, clear it and evaluate.
    await second.controller.onBackgroundDrained()
    expect(second.requests).toHaveLength(1)
    expect(second.controller.snapshot(SID)?.waiting).toBeFalse()
    await second.store.flush()
    const stored = storage.data.get(`goal/v1/${SID}`) as Record<string, unknown>
    expect(stored.waitingSince).toBeUndefined()
    // A third process sees no wait.
    const third = harness({}, storage)
    expect(await third.controller.restore()).toBe(1)
    expect(third.controller.snapshot(SID)?.waiting).toBeFalse()
  })

  test("a busy-check rejection during drain is logged, kept waiting, and retried until it can evaluate", async () => {
    const warns: Array<{ message: string; extra?: unknown }> = []
    const log = {
      info() {},
      warn(message: string, extra?: unknown) {
        warns.push({ message, extra })
      },
      error() {},
    }
    const h = harness({ log })
    await h.set()
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn()
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    h.setWork({ subagents: 0, shells: 0 })
    h.setBusyError(new Error("busy check failed"))
    h.verdicts.push(notMet("recovered"))
    await h.controller.onBackgroundDrained()
    expect(h.requests).toHaveLength(0)
    expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
    expect(warns.some((e) => e.message === "goal busy check failed; will retry")).toBeTrue()
    expect(h.notices.some((n) => n.kind === "retry" && n.message.includes("Could not check background work state"))).toBeTrue()

    h.setBusyError(undefined)
    await h.clock.advance(15_000)
    expect(h.requests).toHaveLength(1)
    expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
  })
})

describe("an interrupted evaluation resumes after restart (CXVI)", () => {
  const KEY = (sessionID: string) => `goal/v1/${sessionID}`
  const deferred = <T>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
  }

  test("shutdown mid-evaluation persists an evaluate marker that store.flush() lands", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    await h.set("restore the check")
    const gate = deferred<EvaluationResult>()
    h.verdicts.push(() => gate.promise)
    const turning = h.turn()
    await flush()
    expect(h.controller.snapshot(SID)?.evaluating).toBeTrue()
    await h.controller.dispose()
    await h.store.flush()
    const stored = storage.data.get(KEY(SID)) as GoalRecord
    expect(stored.pendingEvaluation).toMatchObject({ turn: 1, tools: 1, condition: "restore the check", phase: "evaluate" })
    gate.resolve(notMet("late verdict"))
    await turning
  })

  test("restore re-enters evaluate with the interrupted turn and tools, then clears the marker", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore the check")
    const gate = deferred<EvaluationResult>()
    first.verdicts.push(() => gate.promise)
    const turning = first.turn()
    await flush()
    await first.controller.dispose()
    await first.store.flush()
    gate.resolve(notMet("late verdict"))
    await turning

    const second = harness({}, storage)
    second.verdicts.push(notMet("resumed gap"))
    expect(await second.controller.restore()).toBe(1)
    await flush()
    expect(second.requests).toHaveLength(1)
    expect(second.requests[0]!.turn).toBe(1)
    expect(second.controller.get(SID)?.turns).toBe(1)
    expect(second.calls.synthetic).toHaveLength(1)
    expect(second.calls.synthetic[0].text).toContain("resumed gap")
    expect(second.notices.some((n) => n.kind === "resumed" && n.title.includes("restart"))).toBeTrue()
    await second.store.flush()
    expect((storage.data.get(KEY(SID)) as GoalRecord).pendingEvaluation).toBeUndefined()
  })

  test("a marker for a verdict that already landed is cleared, never re-evaluated", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore the check")
    await first.store.flush()
    const stale = storage.data.get(KEY(SID)) as GoalRecord
    stale.pendingEvaluation = { turn: 1, tools: 1, condition: "restore the check", phase: "evaluate", at: 1 }
    stale.turns = 1 // verdict committed before the crash
    storage.data.set(KEY(SID), stale)

    const second = harness({}, storage)
    expect(await second.controller.restore()).toBe(1)
    await flush()
    expect(second.requests).toHaveLength(0)
    await second.store.flush()
    expect((storage.data.get(KEY(SID)) as GoalRecord).pendingEvaluation).toBeUndefined()
  })

  test("a marker whose condition changed by a loop re-arm is cleared", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("old condition")
    await first.store.flush()
    const stale = storage.data.get(KEY(SID)) as GoalRecord
    stale.pendingEvaluation = { turn: 1, tools: 1, condition: "old condition", phase: "evaluate", at: 1 }
    stale.condition = "new condition"
    storage.data.set(KEY(SID), stale)

    const second = harness({}, storage)
    second.verdicts.push(notMet("should not be used"))
    expect(await second.controller.restore()).toBe(1)
    await flush()
    expect(second.requests).toHaveLength(0)
  })

  test("a continue-phase marker re-sends the continuation steer without a second evaluation", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore the check")
    await first.store.flush()
    const owed = storage.data.get(KEY(SID)) as GoalRecord
    owed.turns = 1
    owed.verdict = "not_met"
    owed.reason = "the previously judged gap"
    owed.pendingEvaluation = { turn: 1, tools: 1, condition: "restore the check", phase: "continue", at: 1 }
    storage.data.set(KEY(SID), owed)

    const second = harness({}, storage)
    expect(await second.controller.restore()).toBe(1)
    await flush()
    expect(second.requests).toHaveLength(0)
    expect(second.calls.synthetic).toHaveLength(1)
    expect(second.calls.synthetic[0].text).toContain("the previously judged gap")
    await second.store.flush()
    expect((storage.data.get(KEY(SID)) as GoalRecord).pendingEvaluation).toBeUndefined()
  })

  test("a paused record's marker is cleared, never resumed", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore the check")
    await first.store.flush()
    const paused = storage.data.get(KEY(SID)) as GoalRecord
    paused.status = "paused"
    paused.pendingEvaluation = { turn: 1, tools: 1, condition: "restore the check", phase: "evaluate", at: 1 }
    storage.data.set(KEY(SID), paused)

    const second = harness({}, storage)
    second.verdicts.push(notMet("should not be used"))
    expect(await second.controller.restore()).toBe(1)
    await flush()
    expect(second.requests).toHaveLength(0)
    expect(second.calls.synthetic).toHaveLength(0)
  })

  test("restore({ resume: false }) adopts the record but dispatches nothing (probe isolation)", async () => {
    const storage = new MemoryStorage()
    const first = harness({}, storage)
    await first.set("restore the check")
    await first.store.flush()
    const stuck = storage.data.get(KEY(SID)) as GoalRecord
    stuck.pendingEvaluation = { turn: 1, tools: 1, condition: "restore the check", phase: "evaluate", at: 1 }
    storage.data.set(KEY(SID), stuck)

    const second = harness({}, storage)
    expect(await second.controller.restore({ resume: false })).toBe(1)
    await flush()
    expect(second.requests).toHaveLength(0)
    expect(second.calls.synthetic).toHaveLength(0)
    // The marker is untouched: a later writable restore can still resume it.
    await second.store.flush()
    expect((storage.data.get(KEY(SID)) as GoalRecord).pendingEvaluation).toBeDefined()
  })

  test("a host 'shutdown' interrupt keeps the marker and a user interrupt clears it", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    await h.set("restore the check")
    const gate = deferred<EvaluationResult>()
    h.verdicts.push(() => gate.promise)
    const turning = h.turn()
    await flush()
    h.controller.onExecutionInterrupted(SID, "shutdown")
    await h.store.flush()
    expect((storage.data.get(KEY(SID)) as GoalRecord).pendingEvaluation?.phase).toBe("evaluate")
    gate.resolve(notMet("late"))
    await turning
    await h.controller.dispose()

    const other = harness({}, storage)
    await other.set("user prompt wins")
    const gate2 = deferred<EvaluationResult>()
    other.verdicts.push(() => gate2.promise)
    const turning2 = other.turn()
    await flush()
    other.controller.onExecutionInterrupted(SID, "user")
    await other.store.flush()
    expect((storage.data.get(KEY(SID)) as GoalRecord).pendingEvaluation).toBeUndefined()
    gate2.resolve(notMet("late"))
    await turning2
    await other.controller.dispose()
  })
})

describe("RPC payload strict-JSON hygiene (host JSONValue gate)", () => {
  // The host rejects an explicit-undefined key ANYWHERE in an RPC payload with
  // `SchemaError(Expected JSON value at …)`; on the wire that surfaced as HTTP 500 on goal/get and as
  // silently dropped `changed` events (opencode 2.3.2 standalone, 2026-11-18). Every snapshot the
  // controller emits must survive a recursive key walk with no undefined-valued key.
  const assertJsonSafe = (value: unknown, path: string): void => {
    if (value === undefined) throw new Error(`explicit undefined at ${path}`)
    if (Array.isArray(value)) {
      value.forEach((entry, i) => assertJsonSafe(entry, `${path}[${i}]`))
      return
    }
    if (typeof value === "object" && value !== null && (value as Record<string, unknown>).constructor === Object) {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        assertJsonSafe(entry, `${path}.${key}`)
      }
    }
  }

  test("emitted and read-back snapshots stay strict JSON across pause/resume/finish and loop advance", async () => {
    const h = harness({ stallTurns: 1 })
    await h.set()
    // A pause (pauseCause set) and a resume (pauseCause cleared via the record's own state machine):
    h.verdicts.push(notMet())
    await h.turn(0)
    expect(h.controller.get(SID)?.status).toBe("paused")
    h.controller.onUserPrompt(SID)
    // A met verdict finishes the goal (finish() historically re-assigned undefined onto the record).
    h.verdicts.push(met())
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("achieved")
    for (const [i, change] of h.changes.entries()) {
      if (change === null) continue
      expect(() => assertJsonSafe(change, `changes[${i}]`)).not.toThrow()
    }
    expect(h.changes.length).toBeGreaterThan(0)
  })
})

describe("in-memory terminal-goal retention", () => {
  const NOW = 2_000_000_000_000
  const DAY = 24 * 60 * 60 * 1000

  const finishFresh = async (h: ReturnType<typeof harness>, sid: string) => {
    await h.controller.command({ sessionID: sid, text: `goal for ${sid}`, delivery: "steer" })
    h.verdicts.push(met())
    h.controller.onExecutionStarted(sid)
    h.controller.onToolCalled(sid)
    await h.controller.onExecutionSucceeded(sid)
    await flush()
  }

  test("the in-memory terminal map is bounded by the retention cap, oldest first; live records never evicted; storage untouched", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    h.clock.t = NOW
    const total = MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES + 1
    const sids = Array.from({ length: total }, (_, i) => `ses_mem_${i}`)
    for (const sid of sids) {
      await finishFresh(h, sid)
      h.clock.t += DAY
    }
    // live record stays in memory regardless of the cap
    await h.controller.command({ sessionID: "ses_mem_live", text: "live thing", delivery: "steer" })
    expect(h.controller.get("ses_mem_live")?.status).toBe("active")
    // oldest terminal record evicted from memory
    expect(h.controller.get("ses_mem_0")).toBeUndefined()
    // the newest MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES terminal records stay in memory
    for (const sid of sids.slice(1)) expect(h.controller.get(sid)?.status).toBe("achieved")
    expect(h.controller.list().filter((s) => s.status === "achieved")).toHaveLength(MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES)
    // durable storage is the source of truth — the evicted record is still stored, count caps untouched
    expect(sids.every((sid) => storage.data.has(`goal/v1/${sid}`))).toBe(true)
    // peek serves the evicted terminal record from storage (same record, no fabrication)
    const peeked = await h.controller.peekSnapshot("ses_mem_0")
    expect(peeked?.status).toBe("achieved")
    expect(peeked?.turns).toBe(1)
    expect(peeked?.sessionID).toBe("ses_mem_0")
  })

  test("live records are never evicted, even when the terminal cap is exceeded", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    h.clock.t = NOW
    await h.controller.command({ sessionID: "ses_live_only", text: "live thing", delivery: "steer" })
    const total = MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES + 5
    for (let i = 0; i < total; i++) {
      await finishFresh(h, `ses_mem_pad_${i}`)
      h.clock.t += DAY
    }
    expect(h.controller.get("ses_live_only")?.status).toBe("active")
    expect(h.controller.list().map((s) => s.sessionID)).toContain("ses_live_only")
    // the live record is also served by peek from memory
    const peeked = await h.controller.peekSnapshot("ses_live_only")
    expect(peeked?.status).toBe("active")
  })

  test("no terminal records are evicted at or below the cap", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    h.clock.t = NOW
    const total = MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES
    for (let i = 0; i < total; i++) {
      await finishFresh(h, `ses_mem_under_${i}`)
      h.clock.t += DAY
    }
    for (let i = 0; i < total; i++) expect(h.controller.get(`ses_mem_under_${i}`)?.status).toBe("achieved")
  })
})

describe("terminal record pruning at restore", () => {
  const NOW = 2_000_000_000_000
  const DAY = 24 * 60 * 60 * 1000

  let seq = 0
  const terminalRecord = (status: GoalStatus, endedAt?: number): GoalRecord => ({
    version: 1,
    id: `goal_t${++seq}`,
    sessionID: `ses_terminal_${seq}`,
    directory: DIR,
    condition: "done thing",
    status,
    setAt: (endedAt ?? NOW) - 2 * DAY,
    startedAt: (endedAt ?? NOW) - 2 * DAY,
    ...(endedAt !== undefined ? { endedAt } : {}),
    turns: 3,
    stall: 0,
    retries: 0,
    checkins: 0,
    baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    history: [],
  })
  const seedTerminal = async (storage: MemoryStorage, records: GoalRecord[]) => {
    for (const r of records) await storage.set(`goal/v1/${r.sessionID}`, structuredClone(r))
  }

  test("restore prunes aged terminal records, keeps fresh and active ones, and reports counts", async () => {
    const logs: Array<{ level: string; message: string; extra?: { scanned?: number; pruned?: number; droppedAged?: number } }> = []
    const capturingLog = {
      info: (message: string, extra?: { scanned?: number; pruned?: number; droppedAged?: number }) => void logs.push({ level: "info", message, extra }),
      warn: () => {},
      error: () => {},
    }
    const storage = new MemoryStorage()
    await seedTerminal(storage, [
      terminalRecord("achieved", NOW - 40 * DAY),
      terminalRecord("failed", NOW - 90 * DAY),
      terminalRecord("cleared", NOW - 2 * DAY),
    ])
    const first = harness({}, storage)
    await first.set("active thing")
    await first.store.flush()
    const second = harness({ log: capturingLog }, storage)
    second.clock.t = NOW
    expect(await second.controller.restore()).toBe(1) // the active record is adopted
    const keys = [...storage.data.keys()]
    expect(keys.filter((k) => k.includes("ses_terminal"))).toHaveLength(1) // only the fresh one survives
    expect(keys.filter((k) => k === "goal/v1/ses_1" || (k.startsWith("goal/v1/ses_") && !k.includes("ses_terminal")))).not.toHaveLength(0)
    const report = logs.find((l) => l.message === "terminal goal records at plugin storage")
    expect(report?.extra).toMatchObject({ scanned: 3, pruned: 2, droppedAged: 2, droppedBeyondCap: 0 })
    // Active goal is intact and adopted:
    expect(second.controller.get("ses_1")?.status).toBe("active")
  })

  test("the count cap drops the oldest fresh terminal records beyond the cap", async () => {
    const storage = new MemoryStorage()
    const records = Array.from({ length: MAX_TERMINAL_RECORD_ENTRIES + 5 }, (_, i) =>
      terminalRecord("achieved", NOW - i * 60_000),
    )
    await seedTerminal(storage, records)
    const h = harness({}, storage)
    h.clock.t = NOW
    expect(await h.controller.restore()).toBe(0) // no live records
    const survivors = [...storage.data.keys()].filter((k) => k.startsWith("goal/v1/"))
    expect(survivors).toHaveLength(MAX_TERMINAL_RECORD_ENTRIES)
    expect(storage.data.has(`goal/v1/${records.at(-1)!.sessionID}`)).toBe(false) // oldest fresh one dropped
    expect(storage.data.has(`goal/v1/${records[0]!.sessionID}`)).toBe(true) // newest kept
  })

  test("restore prunes foreign-directory terminal records under the same caps; foreign live records survive", async () => {
    const storage = new MemoryStorage()
    const foreign = { ...terminalRecord("achieved", NOW - 400 * DAY), directory: "C:/work/elsewhere" }
    const foreignLive = { ...terminalRecord("paused", NOW - 400 * DAY), directory: "C:/work/elsewhere" }
    delete (foreignLive as { endedAt?: number }).endedAt
    const foreignFresh = { ...terminalRecord("cleared", NOW - 2 * DAY), directory: "C:/work/elsewhere" }
    await seedTerminal(storage, [foreign, foreignLive, foreignFresh])
    const h = harness({}, storage)
    h.clock.t = NOW
    expect(await h.controller.restore()).toBe(0)
    expect(storage.data.has(`goal/v1/${foreign.sessionID}`)).toBe(false) // aged foreign terminal record pruned at restore
    expect(storage.data.has(`goal/v1/${foreignLive.sessionID}`)).toBe(true) // live records are never pruned, whatever the directory
    expect(storage.data.has(`goal/v1/${foreignFresh.sessionID}`)).toBe(true) // foreign fresh record kept
  })

  test("the count cap applies per directory independently across the whole store", async () => {
    const storage = new MemoryStorage()
    const dir = "C:/work/elsewhere"
    const local = Array.from({ length: MAX_TERMINAL_RECORD_ENTRIES + 5 }, (_, i) => terminalRecord("achieved", NOW - i * 60_000))
    const foreignDirs = Array.from({ length: 3 }, (_, i) =>
      ({ ...terminalRecord("achieved", NOW - i * 60_000), directory: dir }),
    )
    await seedTerminal(storage, [...local, ...foreignDirs])
    const h = harness({}, storage)
    h.clock.t = NOW
    expect(await h.controller.restore()).toBe(0)
    const localKeys = local.filter((r) => storage.data.has(`goal/v1/${r.sessionID}`))
    const foreignKeys = foreignDirs.filter((r) => storage.data.has(`goal/v1/${r.sessionID}`))
    expect(localKeys).toHaveLength(MAX_TERMINAL_RECORD_ENTRIES) // oldest local fresh records dropped
    expect(foreignKeys).toHaveLength(3) // the other directory keeps all of its own records
    expect(storage.data.has(`goal/v1/${local.at(-1)!.sessionID}`)).toBe(false) // oldest local one dropped
    expect(storage.data.has(`goal/v1/${local[0]!.sessionID}`)).toBe(true) // newest local kept
  })

  test("unstamped terminal records are kept (age can never be judged) and reported, not pruned", async () => {
    const logs: Array<{ level: string; message: string; extra?: { unstampedKept?: number; pruned?: number } }> = []
    const capturingLog = {
      info: (message: string, extra?: { unstampedKept?: number; pruned?: number }) => void logs.push({ level: "info", message, extra }),
      warn: () => {},
      error: () => {},
    }
    const unstamped = terminalRecord("achieved") // endedAt absent
    delete (unstamped as { startedAt?: number }).startedAt
    const storage = new MemoryStorage()
    await seedTerminal(storage, [unstamped])
    const h = harness({ log: capturingLog }, storage)
    h.clock.t = NOW
    expect(await h.controller.restore()).toBe(0)
    expect(storage.data.has(`goal/v1/${unstamped.sessionID}`)).toBe(true)
    const report = logs.find((l) => l.message === "terminal goal records at plugin storage")
    expect(report?.extra).toMatchObject({ pruned: 0, unstampedKept: 1 })
  })

  test("a probe-mode (readOnly) store reports but removes nothing", async () => {
    const storage = new MemoryStorage()
    await seedTerminal(storage, [terminalRecord("achieved", NOW - 400 * DAY)])
    const logs: Array<{ level: string; message: string; extra?: { readOnly?: boolean; pruned?: number; scanned?: number } }> = []
    const capturingLog = {
      info: (message: string, extra?: { readOnly?: boolean; pruned?: number; scanned?: number }) => void logs.push({ level: "info", message, extra }),
      warn: () => {},
      error: () => {},
    }
    const probeStore = new GoalStore(storage, () => {}, { readOnly: true })
    const probe = new GoalController({
      config: resolveConfig({}),
      directory: DIR,
      commit: { required: false, branch: "dev", reason: "test" },
      clock: new (class extends FakeClock {})(),
      store: probeStore,
      log: capturingLog,
      newId: () => "goal_probe",
      session: {
        prompt: async () => {},
        synthetic: async () => {},
        usage: async () => ({ cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
        compact: async () => {},
      },
      evaluator: { evaluate: async () => ({ verdict: "not_met" as const, reason: "x" }) },
      background: { busy: async () => ({ subagents: 0, shells: 0 }) },
      emitter: { changed: () => {}, notice: () => {} },
    })
    await probe.restore()
    expect(storage.data.size).toBe(1) // nothing removed under probe mode
    const report = logs.find((l) => l.message === "terminal goal records at plugin storage")
    expect(report?.extra).toMatchObject({ scanned: 1, pruned: 0, readOnly: true })
  })
})

describe("terminal record pruning after finish (opportunistic)", () => {
  const NOW = 2_000_000_000_000
  const DAY = 24 * 60 * 60 * 1000
  let seq = 10_000
  const terminalRecord = (status: GoalStatus, endedAt?: number): GoalRecord => ({
    version: 1,
    id: `goal_opp_${++seq}`,
    sessionID: `ses_opp_${seq}`,
    directory: DIR,
    condition: "done thing",
    status,
    setAt: (endedAt ?? NOW) - 2 * DAY,
    startedAt: (endedAt ?? NOW) - 2 * DAY,
    ...(endedAt !== undefined ? { endedAt } : {}),
    turns: 3,
    stall: 0,
    retries: 0,
    checkins: 0,
    baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    history: [],
  })
  const seedTerminal = async (storage: MemoryStorage, records: GoalRecord[]) => {
    for (const r of records) await storage.set(`goal/v1/${r.sessionID}`, structuredClone(r))
  }

  test("finish() prunes aged terminal records opportunistically, without a restart", async () => {
    const logs: Array<{ level: string; message: string; extra?: { scanned?: number; pruned?: number; droppedAged?: number } }> = []
    const capturingLog = {
      info: (message: string, extra?: { scanned?: number; pruned?: number; droppedAged?: number }) => void logs.push({ level: "info", message, extra }),
      warn: () => {},
      error: () => {},
    }
    const storage = new MemoryStorage()
    await seedTerminal(storage, [
      terminalRecord("achieved", NOW - 40 * DAY),
      terminalRecord("failed", NOW - 90 * DAY),
      terminalRecord("cleared", NOW - 2 * DAY),
    ])
    const h = harness({ log: capturingLog }, storage)
    h.clock.t = NOW
    await h.set("active thing")
    h.verdicts.push(met())
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("achieved")
    await h.controller.dispose()
    const survivors = [...storage.data.keys()].filter((k) => k.startsWith("goal/v1/ses_opp_"))
    expect(survivors).toHaveLength(1) // only the fresh seeded record survives; both aged ones are pruned
    expect(storage.data.has("goal/v1/ses_1")).toBe(true) // the just-finished record survives (it is the newest)
    const report = logs.find((l) => l.message === "terminal goal records at plugin storage")
    expect(report?.extra).toMatchObject({ scanned: 4, pruned: 2, droppedAged: 2, droppedBeyondCap: 0 })
  })

  test("the finish path drops the oldest fresh records beyond the count cap, newest survive", async () => {
    const logs: Array<{ level: string; message: string; extra?: { pruned?: number; droppedBeyondCap?: number; droppedAged?: number } }> = []
    const capturingLog = {
      info: (message: string, extra?: { pruned?: number; droppedBeyondCap?: number; droppedAged?: number }) => void logs.push({ level: "info", message, extra }),
      warn: () => {},
      error: () => {},
    }
    const storage = new MemoryStorage()
    const records = Array.from({ length: MAX_TERMINAL_RECORD_ENTRIES + 4 }, (_, i) => terminalRecord("achieved", NOW - i * 60_000))
    await seedTerminal(storage, records)
    const h = harness({ log: capturingLog }, storage)
    h.clock.t = NOW
    await h.set("active thing")
    h.verdicts.push(met())
    await h.turn()
    await h.controller.dispose()
    const survivors = [...storage.data.keys()].filter((k) => k.startsWith("goal/v1/"))
    expect(survivors).toHaveLength(MAX_TERMINAL_RECORD_ENTRIES)
    expect(storage.data.has(`goal/v1/${records.at(-1)!.sessionID}`)).toBe(false) // oldest fresh seeded record dropped
    expect(storage.data.has(`goal/v1/${records[0]!.sessionID}`)).toBe(true) // newest seeded record kept
    expect(storage.data.has("goal/v1/ses_1")).toBe(true) // just-finished record kept
    const report = logs.find((l) => l.message === "terminal goal records at plugin storage")
    expect(report?.extra).toMatchObject({ pruned: 5, droppedBeyondCap: 5, droppedAged: 0 })
  })

  test("the finish path never prunes live records", async () => {
    const storage = new MemoryStorage()
    const ancientLive = { ...terminalRecord("active", NOW - 400 * DAY), endedAt: undefined } as GoalRecord
    delete (ancientLive as { endedAt?: number }).endedAt
    const agedTerminal = terminalRecord("achieved", NOW - 400 * DAY)
    await seedTerminal(storage, [ancientLive, agedTerminal])
    const h = harness({}, storage)
    h.clock.t = NOW
    await h.set("active thing")
    h.verdicts.push(met())
    await h.turn()
    await h.controller.dispose()
    expect(storage.data.has(`goal/v1/${ancientLive.sessionID}`)).toBe(true) // live record untouched however old
    expect(storage.data.has(`goal/v1/${agedTerminal.sessionID}`)).toBe(false) // the aged terminal record pruned
  })

  test("a prune failure never breaks the finish path", async () => {
    const logs: Array<{ level: string; message: string; extra?: unknown }> = []
    const capturingLog = {
      info: () => {},
      warn: (message: string, extra?: unknown) => void logs.push({ level: "warn", message, extra }),
      error: () => {},
    }
    const storage = new MemoryStorage()
    const aged = terminalRecord("achieved", NOW - 400 * DAY)
    await seedTerminal(storage, [aged])
    const h = harness({ log: capturingLog }, storage)
    h.clock.t = NOW
    ;(h.storage as { scan: StoragePort["scan"] }).scan = async () => {
      throw new Error("storage boom")
    }
    await h.set("active thing")
    h.verdicts.push(met())
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("achieved") // finish landed despite the prune blowing up
    await h.controller.dispose()
    const warn = logs.find((l) => l.message === "terminal goal record prune failed")
    expect(warn).toBeDefined()
    expect(storage.data.has(`goal/v1/${aged.sessionID}`)).toBe(true) // nothing was removed
  })

  test("an unstamped terminal record is kept, and a probe-mode store removes nothing", async () => {
    const storage = new MemoryStorage()
    const unstamped = terminalRecord("achieved") // endedAt absent: age can never be judged
    delete (unstamped as { startedAt?: number }).startedAt
    await seedTerminal(storage, [unstamped])
    const logs: Array<{ level: string; message: string; extra?: { unstampedKept?: number; pruned?: number; readOnly?: boolean } }> = []
    const capturingLog = {
      info: (message: string, extra?: { unstampedKept?: number; pruned?: number; readOnly?: boolean }) => void logs.push({ level: "info", message, extra }),
      warn: () => {},
      error: () => {},
    }
    const probeStore = new GoalStore(storage, () => {}, { readOnly: true })
    const probe = new GoalController({
      config: resolveConfig({}),
      directory: DIR,
      commit: { required: false, branch: "dev", reason: "test" },
      clock: new (class extends FakeClock {})(),
      store: probeStore,
      log: capturingLog,
      newId: () => "goal_probe_prune",
      session: {
        prompt: async () => {},
        synthetic: async () => {},
        usage: async () => ({ cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
        compact: async () => {},
      },
      evaluator: { evaluate: async () => ({ verdict: "met" as const, reason: "done" }) },
      background: { busy: async () => ({ subagents: 0, shells: 0 }) },
      emitter: { changed: () => {}, notice: () => {} },
    })
    await probe.command({ sessionID: SID, text: "active thing", delivery: "steer" })
    probe.onExecutionStarted(SID)
    await probe.onExecutionSucceeded(SID)
    await probe.dispose()
    expect(storage.data.has(`goal/v1/${unstamped.sessionID}`)).toBe(true) // removed nothing
    const report = logs.find((l) => l.message === "terminal goal records at plugin storage")
    expect(report?.extra).toMatchObject({ scanned: 1, pruned: 0, readOnly: true, unstampedKept: 1 })
  })

  test("the finish path prunes foreign-directory terminal records too (unified with restore scope)", async () => {
    const logs: Array<{ level: string; message: string; extra?: { scanned?: number; pruned?: number; directories?: number } }> = []
    const capturingLog = {
      info: (message: string, extra?: { scanned?: number; pruned?: number; directories?: number }) => void logs.push({ level: "info", message, extra }),
      warn: () => {},
      error: () => {},
    }
    const storage = new MemoryStorage()
    const foreignAged = { ...terminalRecord("achieved", NOW - 400 * DAY), directory: "C:/work/elsewhere" }
    const foreignLive = { ...terminalRecord("paused", NOW - 400 * DAY), directory: "C:/work/elsewhere" }
    delete (foreignLive as { endedAt?: number }).endedAt
    const foreignFresh = { ...terminalRecord("cleared", NOW - 2 * DAY), directory: "C:/work/elsewhere" }
    await seedTerminal(storage, [foreignAged, foreignLive, foreignFresh])
    const h = harness({ log: capturingLog }, storage)
    h.clock.t = NOW
    await h.set("active thing")
    h.verdicts.push(met())
    await h.turn()
    expect(h.controller.get(SID)?.status).toBe("achieved")
    await h.controller.dispose()
    expect(storage.data.has(`goal/v1/${foreignAged.sessionID}`)).toBe(false) // aged foreign terminal record pruned at finish time
    expect(storage.data.has(`goal/v1/${foreignLive.sessionID}`)).toBe(true) // foreign live record never pruned
    expect(storage.data.has(`goal/v1/${foreignFresh.sessionID}`)).toBe(true) // foreign fresh record kept
    const report = logs.find((l) => l.message === "terminal goal records at plugin storage")
    expect(report?.extra).toMatchObject({ pruned: 1, droppedAged: 1, directories: 2 })
  })

  describe("staleness, straggler ordering, and recovery regressions", () => {
    test("busy-check failure preserves carried tool work and recovers evaluation", async () => {
      const h = harness()
      await h.set()
      h.controller.onExecutionStarted(SID)
      h.controller.onToolCalled(SID)
      h.controller.onToolCalled(SID)
      h.setBusyError(new Error("busy check failed"))
      await h.controller.onExecutionSucceeded(SID)
      await flush()
      expect(h.requests).toHaveLength(0)
      expect(h.controller.snapshot(SID)?.waiting).toBeTrue()

      h.setBusyError(undefined)
      h.verdicts.push(notMet())
      await h.clock.advance(15_000)
      expect(h.requests).toHaveLength(1)
      expect(h.controller.get(SID)?.stall).toBe(0)
      expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
    })

    test("straggler succeeded while awaiting retry execution is dropped, then real retry execution is evaluated", async () => {
      const h = harness()
      await h.set()
      // Fail the turn so a retry continuation is scheduled.
      h.controller.onExecutionStarted(SID)
      h.controller.onToolCalled(SID)
      h.controller.onExecutionFailed(SID, { message: "socket hang up" })
      await flush()
      expect(h.controller.snapshot(SID)?.queued).toBeFalse() // retry dispatch not yet sent

      // Retry continuation dispatches now and marks the session awaiting execution.
      await h.clock.advance(15_000)
      expect(h.controller.snapshot(SID)?.queued).toBeTrue()
      expect(h.calls.synthetic).toHaveLength(1)

      // A stale succeeded delivered before the retry execution starts must be dropped.
      h.verdicts.push(notMet("spurious"))
      await h.controller.onExecutionSucceeded(SID)
      await flush()
      expect(h.requests).toHaveLength(0)
      expect(h.controller.get(SID)?.turns).toBe(0)

      // The retry execution starts and completes normally; it must be evaluated.
      h.controller.onExecutionStarted(SID)
      h.controller.onToolCalled(SID)
      h.verdicts[0] = notMet("real")
      await h.controller.onExecutionSucceeded(SID)
      await flush()
      expect(h.requests).toHaveLength(1)
      expect(h.controller.get(SID)?.turns).toBe(1)
      expect(h.controller.snapshot(SID)?.queued).toBeTrue() // continuation after not_met queued
    })

    test("a straggler succeeded while awaiting a continuation still clears the heartbeat paint", async () => {
      const h = harness()
      await h.set()
      h.setWork({ subagents: 1, shells: 0 })
      await h.turn()
      expect(h.controller.snapshot(SID)?.waiting).toBeTrue()

      // An idle check-in dispatches a continuation while the background deferral is still pending.
      await h.clock.advance(30 * 60_000)
      expect(h.calls.synthetic).toHaveLength(1)
      expect(h.controller.snapshot(SID)?.waiting).toBeTrue()

      // The continuation's execution-started is swallowed (restart/reconnect). A tool call and the
      // succeeded still arrive: the succeeded is dropped as a straggler, but the execution ended, so the
      // pill must flip straight back to waiting instead of sticking on active forever.
      h.controller.onToolCalled(SID)
      expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
      const before = h.changes.length
      await h.controller.onExecutionSucceeded(SID)
      await flush()
      expect(h.controller.snapshot(SID)?.waiting).toBeTrue()
      expect(h.changes.at(-1)?.waiting).toBeTrue()
      expect(h.changes.length).toBe(before + 1)
    })

    test("evaluator timeout/failure retries with bounded backoff and keeps snapshots non-stuck", async () => {
      const h = harness()
      await h.set("the sky is blue")
      h.verdicts.push(new EvaluationTimeoutError("evaluator timed out after 120s (attempt 1/3)"))
      h.controller.onExecutionStarted(SID)
      await h.controller.onExecutionSucceeded(SID)
      await flush()
      expect(h.controller.get(SID)?.status).toBe("active")
      expect(h.controller.get(SID)?.retries).toBe(1)
      expect(h.controller.snapshot(SID)?.evaluating).toBeFalse()
      expect(h.controller.snapshot(SID)?.queued).toBeFalse()
      expect(h.controller.snapshot(SID)?.waiting).toBeFalse()
      expect(h.notices.at(-1)?.message).toContain("retrying in 10s")

      h.verdicts.push(new EvaluationTimeoutError("evaluator timed out after 120s (attempt 2/3)"))
      await h.clock.advance(10_000)
      expect(h.controller.get(SID)?.retries).toBe(2)
      expect(h.notices.at(-1)?.message).toContain("retrying in 30s")

      h.verdicts.push(met("recovered"))
      await h.clock.advance(30_000)
      expect(h.controller.get(SID)?.status).toBe("achieved")
      expect(h.controller.snapshot(SID)?.evaluating).toBeFalse()
    })
  })

})

describe("repeated failure-signature escalation", () => {
  test("pauses after consecutive same-signature not_met verdicts instead of re-arming", async () => {
    const h = harness()
    await h.set("fix the failing tests")
    h.verdicts.push(
      { verdict: "not_met", reason: "same missing test evidence" },
      { verdict: "not_met", reason: "same missing test evidence" },
      { verdict: "not_met", reason: "same missing test evidence" },
    )
    await h.turn()
    await h.turn()
    await h.turn()

    const goal = h.controller.get(SID)!
    expect(goal.status).toBe("paused")
    expect(goal.pauseCause).toBe("repeated_failure")
    expect(goal.reason).toContain("Repeated failure signature detected")
    expect(goal.reason).toContain("rotate strategy")
    // Two continuations for turns 2 and 3; escalation blocks turn 4 re-arm.
    expect(h.calls.synthetic).toHaveLength(2)
    expect(h.notices.some((n) => n.kind === "paused" && n.message.includes("Repeated failure signature detected"))).toBe(true)
  })

  test("different failure signatures do not trigger escalation", async () => {
    const h = harness()
    await h.set("fix the failing tests")
    h.verdicts.push(
      { verdict: "not_met", reason: "missing typecheck output" },
      { verdict: "not_met", reason: "missing commit hash" },
      { verdict: "not_met", reason: "missing merge evidence" },
    )
    await h.turn()
    await h.turn()
    await h.turn()

    const goal = h.controller.get(SID)!
    expect(goal.status).toBe("active")
    expect(goal.pauseCause).toBeUndefined()
    expect(h.calls.synthetic).toHaveLength(3)
  })

  test("a met verdict breaks a repeated failure streak", async () => {
    const h = harness()
    await h.set("fix the failing tests")
    h.verdicts.push(
      { verdict: "not_met", reason: "same missing evidence" },
      { verdict: "not_met", reason: "same missing evidence" },
      { verdict: "met", reason: "done" },
    )
    await h.turn()
    await h.turn()
    await h.turn()

    const goal = h.controller.get(SID)!
    expect(goal.status).toBe("achieved")
    expect(h.calls.synthetic).toHaveLength(2)
  })

  test("persists a diagnostic artifact under .term/goal-loop/diagnostics/ on escalation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-loop-ctrl-diag-"))
    try {
      const h = harness({}, new MemoryStorage(), { required: false, branch: "dev", reason: "test" }, dir)
      await h.set("fix the failing tests")
      h.verdicts.push(
        { verdict: "not_met", reason: "same missing test evidence" },
        { verdict: "not_met", reason: "same missing test evidence" },
        { verdict: "not_met", reason: "same missing test evidence" },
      )
      await h.turn()
      await h.turn()
      await h.turn()

      const goal = h.controller.get(SID)!
      expect(goal.status).toBe("paused")
      expect(goal.pauseCause).toBe("repeated_failure")

      const diagDir = join(dir, ".term", "goal-loop", "diagnostics")
      const files = await readdir(diagDir)
      expect(files.length).toBe(1)
      const saved = JSON.parse(await readFile(join(diagDir, files[0]!), "utf8"))
      expect(saved.signature).toBeString()
      expect(saved.count).toBe(3)
      expect(saved.reason).toContain("Repeated failure signature detected")
      expect(saved.reason).toContain("rotate strategy")
      expect(Array.isArray(saved.failingChecks)).toBe(true)
      expect(saved.kind).toBe("reason")
      expect(saved.summary).toContain("repeated not_met gap")
      expect(saved.verdictReason).toContain("same missing test evidence")
      expect(saved.sessionID).toBe(SID)
      expect(saved.goalID).toBe(goal.id)
      expect(saved.turn).toBe(3)
      expect(saved.condition).toBe("fix the failing tests")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("parallel mixed /goal and /goal-loop sessions", () => {
  function parallelHarness(options: Record<string, unknown> = {}, storage = new MemoryStorage()) {
    const clock = new FakeClock()
    const calls = { prompts: [] as any[], synthetic: [] as any[] }
    const verdictQueues = new Map<string, Array<EvaluationResult | Error | (() => Promise<EvaluationResult>)>>()
    const summaryQueues = new Map<string, string[]>()
    const nextGoalQueues = new Map<string, string[]>()
    const notices: Notice[] = []
    const changes: Array<{ sessionID: string; goal: GoalSnapshot | null }> = []
    const logs: Array<{ level: string; message: string; extra?: unknown }> = []
    const log = {
      info: (message: string, extra?: unknown) => void logs.push({ level: "info", message, extra }),
      warn: (message: string, extra?: unknown) => void logs.push({ level: "warn", message, extra }),
      error: (message: string, extra?: unknown) => void logs.push({ level: "error", message, extra }),
    }
    const background = new BackgroundTracker({ parentOf: async () => undefined })
    const store = new GoalStore(storage, (e) => {
      throw e
    })
    const controller = new GoalController({
      config: resolveConfig(options),
      directory: DIR,
      commit: { required: false, branch: "dev", reason: "test" },
      clock,
      store,
      log,
      newId: (() => {
        let n = 0
        return () => `goal_${++n}`
      })(),
      session: {
        prompt: async (input) => void calls.prompts.push(input),
        synthetic: async (input) => void calls.synthetic.push(input),
        usage: async () => ({ cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
        compact: async () => {},
      },
      evaluator: {
        evaluate: async (request: EvaluationRequest) => {
          const queue = verdictQueues.get(request.sessionID) ?? []
          const next = queue.shift()
          if (!next) throw new Error(`no verdict queued for ${request.sessionID} turn ${request.turn}`)
          if (next instanceof Error) throw next
          return typeof next === "function" ? next() : next
        },
        summarize: async (request: LoopSummaryRequest) => {
          const queue = summaryQueues.get(request.sessionID) ?? []
          const next = queue.shift()
          if (next === undefined) throw new Error(`no summary queued for ${request.sessionID}`)
          return next
        },
        nextGoal: async (request: NextGoalRequest) => {
          const queue = nextGoalQueues.get(request.sessionID) ?? []
          const next = queue.shift()
          if (next === undefined) throw new Error(`no next goal queued for ${request.sessionID}`)
          return next
        },
      },
      background,
      emitter: {
        changed: (sessionID, goal) => void changes.push({ sessionID, goal }),
        notice: (n) => void notices.push(n),
      },
    })
    const compactor = new AutoCompactor({
      config: resolveConfig(options),
      compact: async () => {},
      context: async () => [],
      emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
      clock,
      log,
    })
    const route = createRouter({ controller, background, log, compactor })
    let eid = 0
    const ev = (type: string, data: any) => route({ id: `e${++eid}`, type, data })
    const pushVerdict = (sessionID: string, ...items: Array<EvaluationResult | Error | (() => Promise<EvaluationResult>)>) => {
      const queue = verdictQueues.get(sessionID) ?? []
      queue.push(...items)
      verdictQueues.set(sessionID, queue)
    }
    const pushSummary = (sessionID: string, ...items: string[]) => {
      const queue = summaryQueues.get(sessionID) ?? []
      queue.push(...items)
      summaryQueues.set(sessionID, queue)
    }
    const pushNext = (sessionID: string, ...items: string[]) => {
      const queue = nextGoalQueues.get(sessionID) ?? []
      queue.push(...items)
      nextGoalQueues.set(sessionID, queue)
    }
    const turn = async (sessionID: string, tools = 1) => {
      controller.onExecutionStarted(sessionID)
      for (let i = 0; i < tools; i++) controller.onToolCalled(sessionID)
      await controller.onExecutionSucceeded(sessionID)
      await flush()
    }
    return { clock, calls, notices, changes, logs, controller, background, route, ev, pushVerdict, pushSummary, pushNext, turn }
  }

  test("parallel plain goal and goal-loop: interleaved completions apply verdicts to correct sessions and loop re-arms on met", async () => {
    const h = parallelHarness()
    await h.controller.command({ sessionID: "ses_goal", text: "all tests pass", delivery: "steer" })
    await h.controller.command({ sessionID: "ses_loop", text: "improve the repo", delivery: "steer", loop: true })
    await flush()

    h.pushVerdict("ses_goal", { verdict: "not_met", reason: "goal still failing" })
    h.pushVerdict("ses_loop", { verdict: "met", reason: "iteration 1 complete" })
    h.pushSummary("ses_loop", "summary v1")
    h.pushNext("ses_loop", "ship v2 improvement")

    // Near-simultaneous completions routed through the real event router (including background drains).
    h.ev("session.execution.started", { sessionID: "ses_goal" })
    h.ev("session.tool.called", { sessionID: "ses_goal" })
    h.ev("session.execution.started", { sessionID: "ses_loop" })
    h.ev("session.tool.called", { sessionID: "ses_loop" })
    h.ev("session.execution.succeeded", { sessionID: "ses_goal" })
    h.ev("session.execution.succeeded", { sessionID: "ses_loop" })
    await flush()
    await flush()

    const goal = h.controller.get("ses_goal")!
    const loop = h.controller.get("ses_loop")!
    expect(goal.status).toBe("active")
    expect(goal.turns).toBe(1)
    expect(goal.verdict).toBe("not_met")
    expect(loop.status).toBe("active")
    expect(loop.loopEnabled).toBe(true)
    expect(loop.loopIteration).toBe(2)
    expect(loop.condition).toBe("ship v2 improvement")
    expect(loop.loopHistory).toHaveLength(1)

    expect(h.notices.some((n) => n.sessionID === "ses_loop" && n.kind === "loop")).toBe(true)
    expect(h.calls.synthetic.some((s) => String(s.description).includes("goal · turn 2") && String(s.text).includes("goal still failing"))).toBe(true)
    expect(h.calls.synthetic.some((s) => String(s.description).includes("arming v2"))).toBe(true)
    expect(h.logs.filter((l) => l.level === "error")).toHaveLength(0)
  })

  test("slow evaluation in one session does not stall or stale the other session", async () => {
    const h = parallelHarness()
    await h.controller.command({ sessionID: "ses_goal", text: "goal condition", delivery: "steer" })
    await h.controller.command({ sessionID: "ses_loop", text: "loop objective", delivery: "steer", loop: true })
    await flush()

    let resolveGoal: ((v: EvaluationResult) => void) | undefined
    h.pushVerdict("ses_goal", () => new Promise<EvaluationResult>((resolve) => { resolveGoal = resolve }))
    h.pushVerdict("ses_loop", { verdict: "met", reason: "loop met" })
    h.pushSummary("ses_loop", "loop summary")
    h.pushNext("ses_loop", "loop v2")

    h.ev("session.execution.started", { sessionID: "ses_goal" })
    h.ev("session.tool.called", { sessionID: "ses_goal" })
    h.ev("session.execution.succeeded", { sessionID: "ses_goal" })
    await flush()

    await h.turn("ses_loop")
    expect(h.controller.get("ses_loop")!.loopIteration).toBe(2)
    expect(resolveGoal).toBeDefined()

    resolveGoal!({ verdict: "not_met", reason: "goal pending" })
    await flush()
    await flush()

    expect(h.controller.get("ses_goal")!.turns).toBe(1)
    expect(h.controller.get("ses_goal")!.verdict).toBe("not_met")
    expect(h.logs.some((l) => l.level === "warn" && String(l.message).includes("stale"))).toBe(false)
  })

  test("cross-session background-drain events during in-flight evaluations do not drop verdicts or loop re-arm", async () => {
    const h = parallelHarness()
    await h.controller.command({ sessionID: "ses_goal", text: "goal condition", delivery: "steer" })
    await h.controller.command({ sessionID: "ses_loop", text: "loop objective", delivery: "steer", loop: true })
    await flush()

    let resolveGoal: ((v: EvaluationResult) => void) | undefined
    let resolveLoop: ((v: EvaluationResult) => void) | undefined
    h.pushVerdict("ses_goal", () => new Promise<EvaluationResult>((resolve) => { resolveGoal = resolve }))
    h.pushVerdict("ses_loop", () => new Promise<EvaluationResult>((resolve) => { resolveLoop = resolve }))

    h.ev("session.execution.started", { sessionID: "ses_goal" })
    h.ev("session.tool.called", { sessionID: "ses_goal" })
    h.ev("session.execution.started", { sessionID: "ses_loop" })
    h.ev("session.tool.called", { sessionID: "ses_loop" })
    h.ev("session.execution.succeeded", { sessionID: "ses_goal" })
    h.ev("session.execution.succeeded", { sessionID: "ses_loop" })
    await flush()
    await flush()
    expect(resolveGoal).toBeDefined()
    expect(resolveLoop).toBeDefined()

    for (let i = 0; i < 5; i++) {
      h.ev("shell.updated", { info: { id: `sh_${i}`, status: "running", metadata: { sessionID: "other" } } })
      h.ev("shell.exited", { id: `sh_${i}` })
    }
    await flush()

    h.pushSummary("ses_loop", "summary")
    h.pushNext("ses_loop", "v2")
    resolveLoop!({ verdict: "met", reason: "loop done" })
    await flush()
    await flush()
    expect(h.controller.get("ses_loop")!.loopIteration).toBe(2)

    resolveGoal!({ verdict: "not_met", reason: "goal not yet" })
    await flush()
    await flush()
    expect(h.controller.get("ses_goal")!.turns).toBe(1)
    expect(h.controller.get("ses_goal")!.verdict).toBe("not_met")
    expect(h.logs.filter((l) => l.level === "error")).toHaveLength(0)
  })

  test("background work owned by one session does not block or hide the other session's evaluation", async () => {
    const h = parallelHarness()
    await h.controller.command({ sessionID: "ses_loop", text: "loop objective", delivery: "steer", loop: true })
    await h.controller.command({ sessionID: "ses_goal", text: "goal condition", delivery: "steer" })
    await flush()

    h.ev("shell.created", { info: { id: "sh_loop", status: "running", metadata: { sessionID: "ses_loop" } } })
    await flush()

    h.pushVerdict("ses_goal", { verdict: "not_met", reason: "goal progressed" })
    await h.turn("ses_goal")
    expect(h.controller.get("ses_goal")!.turns).toBe(1)
    expect(h.controller.get("ses_goal")!.verdict).toBe("not_met")

    h.ev("session.execution.started", { sessionID: "ses_loop" })
    h.ev("session.tool.called", { sessionID: "ses_loop" })
    h.ev("session.execution.succeeded", { sessionID: "ses_loop" })
    await flush()
    expect(h.controller.get("ses_loop")!.turns).toBe(0)
    expect(h.controller.snapshot("ses_loop")?.waiting).toBe(true)

    h.pushVerdict("ses_loop", { verdict: "met", reason: "loop v1" })
    h.pushSummary("ses_loop", "sum")
    h.pushNext("ses_loop", "loop v2")
    h.ev("shell.exited", { id: "sh_loop" })
    await flush()
    await flush()

    expect(h.controller.get("ses_loop")!.loopIteration).toBe(2)
    expect(h.controller.get("ses_loop")!.condition).toBe("loop v2")
  })
})
