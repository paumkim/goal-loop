import { beforeEach, describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/core/config.ts"
import * as Prompt from "../src/core/prompts.ts"
import type { CommitPolicy, GoalSnapshot, LoopEntry, Notice, UsageSnapshot } from "../src/core/types.ts"
import { BackgroundTracker } from "../src/runtime/background.ts"
import { GoalController } from "../src/runtime/controller.ts"
import { AutoCompactor } from "../src/runtime/compactor.ts"
import type { BoundaryCompactResult } from "../src/runtime/compactor.ts"
import type { BackgroundWork, Clock, EvaluationRequest, EvaluationResult, LoopSummaryRequest, NextGoalRequest, StoragePort } from "../src/runtime/ports.ts"
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

function harness(options: Record<string, unknown> = {}, storage = new MemoryStorage()) {
  const clock = new FakeClock()
  const calls = { prompts: [] as any[], synthetic: [] as any[] }
  const verdicts: Array<EvaluationResult | Error> = []
  const summaries: string[] = []
  const nextGoals: string[] = []
  const summaryRequests: LoopSummaryRequest[] = []
  const nextGoalRequests: NextGoalRequest[] = []
  // Test hook: when set, the next-goal generator awaits this gate before replying (simulates an in-flight planner).
  const gate: { nextGoal?: Promise<void> } = {}
  // Test hook: when set, the first matching synthetic call awaits this gate before delivering (simulates a slow steer round-trip).
  const syntheticGate: { promise?: Promise<void>; match?: string } = {}
  // Test hook: when set, every synthetic call throws (simulates the host rejecting the dispatch).
  const syntheticFail: { error?: Error } = {}
  const notices: Notice[] = []
  const work = { subagents: 0, shells: 0 }
  const compactCalls: Array<{ sessionID: string; opts?: { force?: boolean } }> = []
  let compactOutcome: BoundaryCompactResult = { requested: true, estimatedTokens: 250_000 }
  let contextSize: number | undefined = 250_000
  const commit: CommitPolicy = { required: false, branch: "dev", reason: "test" }
  const controller = new GoalController({
    config: resolveConfig(options),
    directory: DIR,
    commit,
    clock,
    log: silentLog,
    newId: (() => {
      let n = 0
      return () => `goal_${++n}`
    })(),
    store: new GoalStore(storage, (e) => {
      throw e
    }),
    session: {
      prompt: async (input) => void calls.prompts.push(input),
      synthetic: async (input) => {
        if (syntheticFail.error) throw syntheticFail.error
        if (syntheticGate.promise && (!syntheticGate.match || String(input.description).includes(syntheticGate.match))) {
          const gatePromise = syntheticGate.promise
          syntheticGate.promise = undefined
          await gatePromise
        }
        void calls.synthetic.push(input)
      },
      usage: async () => ({ cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
      compact: async () => {},
    },
    evaluator: {
      evaluate: async (_request: EvaluationRequest) => {
        const next = verdicts.shift()
        if (!next) throw new Error("no verdict queued")
        if (next instanceof Error) throw next
        return next
      },
      summarize: async (request: LoopSummaryRequest) => {
        summaryRequests.push(request)
        const next = summaries.shift()
        if (next === undefined) throw new Error("no summary queued")
        return next
      },
      nextGoal: async (request: NextGoalRequest) => {
        nextGoalRequests.push(request)
        if (gate.nextGoal) await gate.nextGoal
        const next = nextGoals.shift()
        if (next === undefined) throw new Error("no next goal queued")
        return next
      },
    },
    background: { busy: async (): Promise<BackgroundWork> => ({ ...work }) },
    emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
    compactAtBoundary: async (sessionID, opts) => {
      compactCalls.push(opts ? { sessionID, opts } : { sessionID })
      return compactOutcome
    },
    estimateContext: async () => contextSize,
  })
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
    summaries,
    nextGoals,
    summaryRequests,
    nextGoalRequests,
    gate,
    syntheticGate,
    setWork: (next: BackgroundWork) => Object.assign(work, next),
    notices,
    compactCalls,
    setCompactOutcome: (outcome: BoundaryCompactResult) => void (compactOutcome = outcome),
    setSyntheticError: (error?: Error) => void (syntheticFail.error = error),
    setContextSize: (size: number | undefined) => void (contextSize = size),
    controller,
    storage,
    turn,
    setLoop: (condition = "objective: improve the repo") =>
      controller.command({ sessionID: SID, text: condition, delivery: "steer", loop: true }),
    setGoal: (condition = "all tests pass") => controller.command({ sessionID: SID, text: condition, delivery: "steer" }),
  }
}

const met = (reason = "done"): EvaluationResult => ({ verdict: "met", reason })
const notMet = (reason = "not yet"): EvaluationResult => ({ verdict: "not_met", reason })
const impossible = (reason = "cannot be done"): EvaluationResult => ({ verdict: "impossible", reason })

describe("/goal-loop", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  test("met → summarize → v2 armed under the same /goal rules", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("parser rewritten and tests green")
    h.nextGoals.push("add fuzz coverage for the parser")
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.condition).toBe("add fuzz coverage for the parser")
    expect(record.loopIteration).toBe(2)
    expect(record.status).toBe("active")
    expect(record.turns).toBe(0)
    expect(record.loopHistory).toHaveLength(1)
    expect(record.loopHistory![0]).toMatchObject({ version: 1, condition: "improve the parser", summary: "parser rewritten and tests green", turns: 1 })
    // The arming steer mentions the new iteration and does not re-inject the transcript.
    const arming = h.calls.synthetic.find((s) => String(s.text).includes('iteration="2"'))
    expect(arming).toBeDefined()
    expect(String(arming.text)).toContain("add fuzz coverage for the parser")
    // One info toast for the achieved iteration, no attention-seeking achieved kind.
    const loopToast = h.notices.find((n) => n.kind === "loop")
    expect(loopToast).toBeDefined()
    expect(h.notices.some((n) => n.kind === "achieved")).toBe(false)
    // The summary stayed within budget framing (one compact block, not the transcript).
    expect(h.summaryRequests[0]!.maxSummaryTokens).toBe(400)
  })

  test("loop directive mentions the iteration and the objective on v1", async () => {
    await h.setLoop("improve the parser")
    const prompt = String(h.calls.prompts[0]?.text ?? "")
    expect(prompt).toContain('iteration="1"')
    expect(prompt).toContain("improve the parser")
  })

  test("maxLoops cap ends the loop cleanly as achieved", async () => {
    h = harness({ maxLoops: 1 })
    await h.setLoop("objective")
    h.verdicts.push(met("done"))
    h.summaries.push("summary")
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.loopHistory).toHaveLength(1)
    expect(h.nextGoals.length).toBe(0)
    expect(h.notices.some((n) => n.kind === "achieved" && /cap/.test(n.message))).toBe(true)
  })

  test("LOOP_COMPLETE ends the loop cleanly as achieved", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("done"))
    h.summaries.push("summary")
    h.nextGoals.push("LOOP_COMPLETE")
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/nothing worth improving/i)
    expect(record.loopIteration).toBe(1)
    expect(h.notices.some((n) => n.kind === "achieved")).toBe(true)
  })

  test("planner-armed conditions respect maxConditionChars (a2)", async () => {
    const limited = harness({ maxConditionChars: 100 })
    await limited.setLoop("objective")
    limited.verdicts.push(met("done"))
    limited.summaries.push("summary")
    // 150 chars: under the library default (2000) but over the configured 100.
    limited.nextGoals.push("x".repeat(150))
    await limited.turn()
    const record = limited.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/nothing usable/i)
  })

  test("unusable next-goal generation ends the loop cleanly", async () => {
    const capped = harness({ maxConditionChars: 2_000 })
    await capped.setLoop("objective")
    capped.verdicts.push(met("done"))
    capped.summaries.push("summary")
    capped.nextGoals.push("x".repeat(3_000))
    await capped.turn()
    const record = capped.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/nothing usable/i)
  })

  test("impossible verdict ends the loop without summarizing", async () => {
    await h.setLoop("objective")
    h.verdicts.push(impossible("cannot ever"))
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("impossible")
    expect(h.summaryRequests).toHaveLength(0)
    expect(h.nextGoalRequests).toHaveLength(0)
    expect(record.loopHistory ?? []).toHaveLength(0)
  })

  test("two consecutive zero-tool-call iterations keep the loop alive (never pause)", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(0)
    expect(h.controller.get(SID)!.status).toBe("active")
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(0)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopIteration).toBe(3)
    expect(record.loopNotProgress).toBe(2)
    expect(record.loopHistory).toHaveLength(2)
    const v3Arming = h.calls.synthetic.find((s) => String(s.description).includes("arming v3"))
    expect(v3Arming).toBeDefined()
  })

  test("zero-progress is counted by the harness, not by the model's report", async () => {
    // The evaluator claims lots of work happened; the harness counted zero tool calls.
    // The not-progress count must follow the harness count; the loop keeps running either way.
    await h.setLoop("objective")
    h.verdicts.push(met("did tons of work, verified thoroughly"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(0)
    h.verdicts.push(met("did even more work"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(0)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopIteration).toBe(3)
    expect(record.loopNotProgress).toBe(2)
    expect(record.loopHistory?.map((e) => e.toolCalls)).toEqual([0, 0])
  })

  test("user prompt during next-goal generation drops the half-advanced state", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    let release!: () => void
    h.gate.nextGoal = new Promise<void>((resolve) => (release = resolve))
    const turnPromise = h.turn(1)
    await flush() // evaluation finished; the loop is now awaiting the gated next-goal generation
    h.controller.onUserPrompt(SID) // user keystroke supersedes the in-flight loop step
    release()
    await turnPromise
    await flush()
    const record = h.controller.get(SID)!
    expect(record.condition).toBe("objective")
    expect(record.loopIteration ?? 1).toBe(1)
    expect(record.loopHistory ?? []).toHaveLength(0)
    expect(record.status).toBe("active")
  })

  test("summary failure is recorded and the loop advances anyway", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    // No summary queued: the evaluator throws, and the loop must record the failure and keep going.
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopIteration).toBe(2)
    expect(record.loopHistory).toHaveLength(1)
    expect(record.loopHistory![0]!.summary).toMatch(/summary failed/i)
    const v2Arming = h.calls.synthetic.find((s) => String(s.description).includes("arming v2"))
    expect(v2Arming).toBeDefined()
  })

  test("next-goal failure retries the planner with backoff and then advances", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    // No next goal queued: the planner throws, and the achieved iteration must survive in history.
    // The failed step persists no loop state; the retry recomputes and records the entry.
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopIteration).toBe(1)
    expect(record.loopHistory).toHaveLength(0)
    expect(h.notices.some((n) => n.kind === "retry" && /could not plan/i.test(n.message))).toBe(true)
    // Push a planner reply; the whole loop step retries after the backoff and arms v2.
    h.nextGoals.push("v2 condition")
    h.summaries.push("s1 (retried)")
    await h.clock.advance(15_000)
    const after = h.controller.get(SID)!
    expect(after.loopIteration).toBe(2)
    expect(after.status).toBe("active")
    expect(after.loopHistory).toHaveLength(1)
    expect(after.loopHistory![0]!.summary).toBe("s1 (retried)")
    const v2Arming = h.calls.synthetic.find((s) => String(s.description).includes("arming v2"))
    expect(v2Arming).toBeDefined()
  })

  test("resumed loop resets the zero-tool not-progress count", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(0)
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(0)
    expect(h.controller.get(SID)!.status).toBe("active")
    expect(h.controller.get(SID)!.loopNotProgress).toBe(2)
    h.controller.onExecutionInterrupted(SID, "user")
    expect(h.controller.get(SID)!.status).toBe("paused")
    h.controller.onUserPrompt(SID)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopNotProgress).toBe(0)
  })

  test("not_met never advances the loop", async () => {
    await h.setLoop("objective")
    h.verdicts.push(notMet("tests failing"))
    await h.turn(2)
    const record = h.controller.get(SID)!
    expect(record.loopIteration).toBe(1)
    expect(record.loopHistory ?? []).toHaveLength(0)
    expect(h.summaryRequests).toHaveLength(0)
    // Normal /goal continuation fired instead.
    expect(h.calls.synthetic.some((s) => String(s.text).includes("goal-continuation"))).toBe(true)
  })

  test("a zero-tool-call iteration followed by real work resets the not-progress counter", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1"))
    h.summaries.push("s1")
    h.nextGoals.push("v2")
    await h.turn(0)
    h.verdicts.push(met("v2"))
    h.summaries.push("s2")
    h.nextGoals.push("v3")
    await h.turn(3)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopIteration).toBe(3)
    expect(record.loopNotProgress).toBe(0)
  })

  test("a restored loop counts tool calls before the first execution-end", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("the summary")
    h.nextGoals.push("v2 condition")
    await h.turn(4)
    await h.controller.dispose()

    const storage2 = h.storage
    const h2 = harness({}, storage2)
    expect(await h2.controller.restore()).toBe(1)
    // Tool events arrive for the restored session before any execution ends; they must be counted.
    h2.verdicts.push(met("v2 done"))
    h2.summaries.push("the summary 2")
    h2.nextGoals.push("v3 condition")
    await h2.turn(5)
    const record = h2.controller.get(SID)!
    expect(record.loopHistory!.at(-1)!.toolCalls).toBe(5)
  })

  test("restore keeps loop state across a restart", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("the summary")
    h.nextGoals.push("v2 condition")
    await h.turn()
    await h.controller.dispose()

    const storage2 = h.storage
    const h2 = harness({}, storage2)
    const restored = await h2.controller.restore()
    expect(restored).toBe(1)
    const record = h2.controller.get(SID)!
    expect(record.loopEnabled).toBe(true)
    expect(record.loopIteration).toBe(2)
    expect(record.condition).toBe("v2 condition")
    expect(record.loopHistory).toHaveLength(1)
    expect(record.loopHistory![0]!.summary).toBe("the summary")
    expect(record.loopObjective).toBe("objective")
  })

  test("snapshot exposes loop state for the TUI", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("done"))
    h.summaries.push("summary")
    h.nextGoals.push("v2 condition")
    await h.turn()
    const snapshot = h.controller.snapshot(SID) as GoalSnapshot
    expect(snapshot.loopEnabled).toBe(true)
    expect(snapshot.loopIteration).toBe(2)
    expect(snapshot.loopHistory![0]!.condition).toBe("objective")
    expect(snapshot.loopMaxLoops).toBe(5)
  })

  test("clear ends a looped goal and stops further loop steps", async () => {
    await h.setLoop("objective")
    expect(h.controller.clear(SID)).toBe(true)
    expect(h.controller.get(SID)!.status).toBe("cleared")
    expect(h.notices.some((n) => n.kind === "cleared")).toBe(true)
  })
  test("arming a loop records a pending boundary compaction on the record", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.loopCompact).toMatchObject({ iteration: 2, misses: 0, estimatedTokens: 250_000 })
    expect(record.loopCompact!.landedAt).toBeUndefined()
    expect(h.compactCalls).toEqual([{ sessionID: SID }])
  })

  test("onCompactionLanded marks the pending request landed and emits a success notice", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    h.setContextSize(90_000)
    await h.controller.onCompactionLanded(SID)
    const record = h.controller.get(SID)!
    expect(record.loopCompact!.landedAt).toBeNumber()
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "success")).toBe(true)
    // A landed request stays landed; a later arm re-requests from scratch instead of settling it.
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    const armed = h.controller.get(SID)!
    expect(armed.loopCompact).toMatchObject({ iteration: 3, misses: 0 })
    expect(armed.loopCompact!.landedAt).toBeUndefined()
  })

  test("a context-size drop at the next arm counts as the compaction landing", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    // The host compacted between arms: the context is now a fraction of what it was.
    h.setContextSize(90_000)
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "success" && /dropped/i.test(n.message))).toBe(true)
  })

  test("two armed iterations without a landing force the next re-request", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(1)
    // No re-request at one miss: only the settle counts it.
    expect(h.compactCalls).toHaveLength(1)
    h.verdicts.push(met("v3 done"))
    h.summaries.push("s3")
    h.nextGoals.push("v4 condition")
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.loopCompact).toMatchObject({ iteration: 4, misses: 2 })
    expect(h.compactCalls).toHaveLength(2)
    expect(h.compactCalls[1]).toEqual({ sessionID: SID, opts: { force: true } })
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "warning" && /not landed/i.test(n.message))).toBe(true)
  })

  test("a busy deferral counts as a miss but is never forced through", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    h.setCompactOutcome({ requested: false, reason: "busy" })
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(1)
    h.verdicts.push(met("v3 done"))
    h.summaries.push("s3")
    h.nextGoals.push("v4 condition")
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.loopCompact!.misses).toBe(2)
    // Force was requested at the wiring level, but the outcome stayed a busy denial:
    // the record keeps pointing at the original unlanded request.
    expect(h.compactCalls[1]).toEqual({ sessionID: SID, opts: { force: true } })
    expect(record.loopCompact!.iteration).toBe(2)
  })

  test("a compaction that lands at an arm skips the fresh boundary request at that arm", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    expect(h.compactCalls).toHaveLength(1)
    h.setContextSize(90_000) // the host compacted between arms: a fraction of the ~estimated size
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "success" && /dropped/i.test(n.message))).toBe(true)
    // The arm that observed the landing does not ask the host for another compaction.
    expect(h.compactCalls).toHaveLength(1)
    expect(h.controller.get(SID)!.loopCompact!.landedAt).toBeNumber()
  })

  test("two quick landings within 2 minutes queue one re-anchor; one after 2 minutes queues another", async () => {
    await h.setLoop("improve the parser")
    h.setContextSize(90_000)
    await h.controller.onCompactionLanded(SID)
    await h.controller.onCompactionLanded(SID)
    let reanchors = h.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))
    expect(reanchors).toHaveLength(1)
    await h.clock.advance(130_000)
    await h.controller.onCompactionLanded(SID)
    reanchors = h.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))
    expect(reanchors).toHaveLength(2)
  })

  test("restore does not stack a compaction on top of an unlanded pending request", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    expect(h.compactCalls).toHaveLength(1)
    await h.controller.dispose()

    const h2 = harness({}, h.storage)
    const restored = await h2.controller.restore()
    expect(restored).toBe(1)
    expect(h2.compactCalls).toHaveLength(0)
    // The pending request stays recorded; the arm-time settle re-requests at 2 misses.
    expect(h2.controller.get(SID)!.loopCompact!.landedAt).toBeUndefined()
  })

  test("restore does not compact again right after a landing", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1) // records the pending boundary request
    expect(h.compactCalls).toHaveLength(1)
    h.setContextSize(90_000)
    await h.controller.onCompactionLanded(SID) // marks the pending request landed
    expect(h.controller.get(SID)!.loopCompact!.landedAt).toBeNumber()
    await h.controller.dispose()

    const h2 = harness({}, h.storage)
    const restored = await h2.controller.restore()
    expect(restored).toBe(1)
    expect(h2.compactCalls).toHaveLength(0)
  })

  test("onCompactionLanded with no pending request is a no-op", async () => {
    await h.setGoal("all tests pass")
    await h.controller.onCompactionLanded(SID)
    expect(h.notices.filter((n) => n.kind === "compact")).toHaveLength(0)
  })

  test("a landed compaction queues a re-anchor restating the armed loop ground truth", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("parser rewritten and tests green")
    h.nextGoals.push("add fuzz coverage for the parser")
    await h.turn(1)
    h.setContextSize(90_000)
    await h.controller.onCompactionLanded(SID)
    const reanchor = h.calls.synthetic.find((s) => String(s.description).includes("re-anchor"))
    expect(reanchor).toBeDefined()
    expect(reanchor.delivery).toBe("queue")
    expect(reanchor.resume).toBe(false)
    expect(reanchor.metadata?.anchor).toBe(true)
    expect(reanchor.text).toContain("<goal-loop-reanchor iteration=\"2\" max=\"5\">")
    expect(reanchor.text).toContain("improve the parser") // the constant objective
    expect(reanchor.text).toContain("add fuzz coverage for the parser") // the armed condition
    expect(reanchor.text).toContain("- v1:") // the completed iteration survives the cut
    expect(reanchor.text).toContain("git log --oneline -5")
    expect(reanchor.text).toContain("Do not wait for a user message.")
  })

  test("a no-op compaction counts as a miss, not a landing", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    // No drop: the context is still at the ~estimated size.
    await h.controller.onCompactionLanded(SID)
    let record = h.controller.get(SID)!
    expect(record.loopCompact!.landedAt).toBeUndefined()
    expect(record.loopCompact!.misses).toBe(1)
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "success")).toBe(false)
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)
    await h.controller.onCompactionLanded(SID)
    record = h.controller.get(SID)!
    expect(record.loopCompact!.misses).toBe(2)
    expect(record.loopCompact!.landedAt).toBeUndefined()
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "warning" && n.title === "Compaction pending")).toBe(true)
  })

  test("an evidence-based landing records and re-anchors", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    h.setContextSize(90_000)
    await h.controller.onCompactionLanded(SID)
    const record = h.controller.get(SID)!
    expect(record.loopCompact!.landedAt).toBeNumber()
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "success")).toBe(true)
    const reanchor = h.calls.synthetic.find((s) => String(s.description).includes("re-anchor"))
    expect(reanchor).toBeDefined()
    expect(reanchor.text).toContain('iteration="2"')
  })

  test("a no-op landing pushes the miss count to 2 and the next arm force re-requests", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    await h.controller.onCompactionLanded(SID)
    await h.controller.onCompactionLanded(SID)
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(2)
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    expect(h.compactCalls).toHaveLength(2)
    expect(h.compactCalls[1]).toEqual({ sessionID: SID, opts: { force: true } })
  })

  test("one no-op ended event plus one arm counts exactly one miss (a1)", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    // No-op compaction reported via the ended event: one miss, counted at the event.
    await h.controller.onCompactionLanded(SID)
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(1)
    // The arm observes the same unlanded request; it must not count a second miss.
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(1)
    expect(h.compactCalls).toHaveLength(1)
    // The flag was consumed by that arm; a still-unlanded request counts normally at the next one.
    h.verdicts.push(met("v3 done"))
    h.summaries.push("s3")
    h.nextGoals.push("v4 condition")
    await h.turn(1)
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(2)
    expect(h.compactCalls).toHaveLength(2)
    expect(h.compactCalls[1]).toEqual({ sessionID: SID, opts: { force: true } })
  })

  test("an unestimable context counts as a miss, not a landing", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    h.setContextSize(undefined)
    await h.controller.onCompactionLanded(SID)
    const record = h.controller.get(SID)!
    expect(record.loopCompact!.landedAt).toBeUndefined()
    expect(record.loopCompact!.misses).toBe(1)
  })

  test("forced re-requests stop at the 4-miss cap; one final warning, then silence", async () => {
    const h4 = harness({ maxLoops: 50 })
    await h4.setLoop("improve the parser")
    let n = 0
    const arm = async () => {
      h4.verdicts.push(met("step done"))
      h4.summaries.push("s")
      h4.nextGoals.push(`iter-${++n}`)
      await h4.turn(1)
    }
    await arm() // fresh boundary request
    expect(h4.compactCalls).toEqual([{ sessionID: SID }])
    await arm() // miss 1: silent skip, no request
    expect(h4.compactCalls).toHaveLength(1)
    await arm() // miss 2: forced re-request
    expect(h4.compactCalls).toHaveLength(2)
    expect(h4.compactCalls[1]).toEqual({ sessionID: SID, opts: { force: true } })
    expect(h4.notices.filter((n2) => n2.kind === "compact" && n2.title === "Compaction pending")).toHaveLength(1)
    await arm() // miss 3: forced re-request
    expect(h4.compactCalls).toHaveLength(3)
    expect(h4.compactCalls[2]).toEqual({ sessionID: SID, opts: { force: true } })
    await arm() // miss 4: cap — no host request, one final warning
    expect(h4.compactCalls).toHaveLength(3)
    expect(h4.notices.filter((n2) => n2.title === "Compaction not landing")).toHaveLength(1)
    await arm() // miss 5: suspended and silent
    expect(h4.compactCalls).toHaveLength(3)
    expect(h4.notices.filter((n2) => n2.title === "Compaction not landing")).toHaveLength(1)
    expect(h4.notices.filter((n2) => n2.title === "Compaction pending")).toHaveLength(2)
    expect(h4.controller.get(SID)?.status).toBe("active")
  })

  test("compaction-ended misses respect the 4-miss cap with one final warning", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    await h.controller.onCompactionLanded(SID) // miss 1
    await h.controller.onCompactionLanded(SID) // miss 2: pending warning
    await h.controller.onCompactionLanded(SID) // miss 3: pending warning
    await h.controller.onCompactionLanded(SID) // miss 4: final warning
    await h.controller.onCompactionLanded(SID) // miss 5: silent
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(5)
    expect(h.controller.get(SID)!.loopCompact!.landedAt).toBeUndefined()
    expect(h.notices.filter((n2) => n2.title === "Compaction not landing")).toHaveLength(1)
    expect(h.notices.filter((n2) => n2.title === "Compaction pending")).toHaveLength(2)
  })

  test("a landing clears the suspension: a fresh request resumes on a later arm", async () => {
    const h5 = harness({ maxLoops: 50 })
    await h5.setLoop("improve the parser")
    let n = 0
    const arm = async () => {
      h5.verdicts.push(met("step done"))
      h5.summaries.push("s")
      h5.nextGoals.push(`iter-${++n}`)
      await h5.turn(1)
    }
    await arm() // fresh boundary request
    await arm() // miss 1
    await arm() // miss 2 (forced)
    await arm() // miss 3 (forced)
    await arm() // miss 4: capped
    expect(h5.compactCalls).toHaveLength(3)
    h5.setContextSize(90_000)
    await h5.controller.onCompactionLanded(SID) // landing observed via the ended event
    expect(h5.controller.get(SID)!.loopCompact!.landedAt).toBeNumber()
    await arm() // fresh request resumes from misses 0
    expect(h5.compactCalls).toHaveLength(4)
    expect(h5.compactCalls[3]).toEqual({ sessionID: SID })
    expect(h5.controller.get(SID)!.loopCompact!.misses).toBe(0)
  })

  test("re-anchor is queued even with no pending boundary request (the host compacted on its own)", async () => {
    await h.setLoop("improve the parser")
    await h.controller.onCompactionLanded(SID)
    const reanchor = h.calls.synthetic.find((s) => String(s.description).includes("re-anchor"))
    expect(reanchor).toBeDefined()
    expect(reanchor.text).toContain('iteration="1"')
  })

  test("no re-anchor for a plain goal, or for a terminal loop", async () => {
    await h.setGoal("all tests pass")
    await h.controller.onCompactionLanded(SID)
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)

    const h2 = harness()
    await h2.setLoop("improve the parser")
    h2.controller.clear(SID)
    await h2.controller.onCompactionLanded(SID)
    expect(h2.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)
  })

  test("a paused loop is not re-anchored", async () => {
    const h3 = harness()
    await h3.setLoop("improve the parser")
    h3.controller.onExecutionInterrupted(SID, "user")
    expect(h3.controller.get(SID)?.status).toBe("paused")
    await h3.controller.onCompactionLanded(SID)
    expect(h3.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)
  })

  test("an armed loop never pauses at the turn cap; it notifies once and keeps arming", async () => {
    const h3 = harness({ maxTurns: 1 })
    await h3.setLoop("improve the parser")
    h3.verdicts.push(notMet("not yet"), notMet("not yet"), notMet("not yet"))
    await h3.turn()
    await h3.turn()
    await h3.turn()
    expect(h3.controller.get(SID)?.status).toBe("active")
    const capNotices = h3.notices.filter((n) => n.kind === "loop" && n.title.includes("Turn cap"))
    expect(capNotices).toHaveLength(1)
  })

  test("an armed loop never pauses at the stall guard; it notifies once and keeps running", async () => {
    const h3 = harness({ stallTurns: 2 })
    await h3.setLoop("improve the parser")
    h3.verdicts.push(notMet("not yet"), notMet("not yet"), notMet("not yet"))
    await h3.turn(0)
    await h3.turn(0)
    await h3.turn(0)
    expect(h3.controller.get(SID)?.status).toBe("active")
    const stallNotices = h3.notices.filter((n) => n.kind === "loop" && n.title.includes("No progress"))
    expect(stallNotices).toHaveLength(1)
  })

  test("a message resumes an armed loop even past the cap", async () => {
    const h3 = harness({ maxTurns: 1 })
    await h3.setLoop("improve the parser")
    h3.controller.onExecutionInterrupted(SID, "user")
    expect(h3.controller.get(SID)?.status).toBe("paused")
    h3.controller.onUserPrompt(SID)
    expect(h3.controller.get(SID)?.status).toBe("active")
  })

  test("a failing re-anchor does not break compaction landing", async () => {
    await h.setLoop("improve the parser")
    h.setSyntheticError(new Error("host busy"))
    await expect(h.controller.onCompactionLanded(SID)).resolves.toBeUndefined()
  })
})

describe("loop prompts", () => {
  const entry: LoopEntry = { version: 1, condition: "c", summary: "s", reason: "r", turns: 2, toolCalls: 5, endedAt: 1 }

  test("directive carries the loop preamble only when loop options are given", () => {
    const plain = Prompt.directive("do it", { required: false, branch: "dev", reason: "t" })
    expect(plain).not.toContain("<loop")
    const looped = Prompt.directive("do it", { required: false, branch: "dev", reason: "t" }, { iteration: 2, maxLoops: 5, objective: "the object", history: [entry] })
    expect(looped).toContain('<loop iteration="2" max="5">')
    expect(looped).toContain("the object")
    expect(looped).toContain("- v1: c — s")
  })

  test("loopContinuation names the new iteration and the previous summary", () => {
    const text = Prompt.loopContinuation({ iteration: 3, maxLoops: 5, condition: "next thing", previousSummary: "prev summary", reason: "r" }, { required: false, branch: "dev", reason: "t" })
    expect(text).toContain('iteration="3"')
    expect(text).toContain("next thing")
    expect(text).toContain("prev summary")
  })

  test("loopReanchor restates the loop ground truth after a compaction", () => {
    const text = Prompt.loopReanchor({ iteration: 3, maxLoops: 5, objective: "the object", condition: "next thing", history: [entry] })
    expect(text).toContain('<goal-loop-reanchor iteration="3" max="5">')
    expect(text).toContain("the object")
    expect(text).toContain("next thing")
    expect(text).toContain("- v1: c — s")
    expect(text).toContain("git log --oneline -5")
    expect(text).toContain("git status --short")
    expect(text).toContain("Do not wait for a user message.")
    expect(text).toContain("</goal-loop-reanchor>")
  })

  test("loopReanchor history block is shared with the loop directive format", () => {
    const text = Prompt.loopReanchor({ iteration: 1, maxLoops: 5, objective: "o", condition: "c", history: [] })
    expect(text).toContain("(none — this is the first iteration)")
  })

  test("loopContinuation tells the armed iteration to re-read repo state before trusting the armed summary", () => {
    const text = Prompt.loopContinuation({ iteration: 3, maxLoops: 5, condition: "next thing", previousSummary: "prev summary", reason: "r" }, { required: false, branch: "dev", reason: "t" })
    // Re-arm hygiene: ground truth is the tree (log/status/worktree), not the summary.
    expect(text).toContain("git log --oneline -5")
    expect(text).toContain("git status --short")
    expect(text).toContain("coordinator status --json")
    expect(text).toContain("stale")
  })

  test("the evaluator rubric demands fresh evidence at the current HEAD, not prior summaries", () => {
    const text = Prompt.evaluateInSession("do it", { turn: 2, elapsedMs: 1000 }, { required: false, branch: "dev", reason: "t" })
    expect(text).toContain("current HEAD")
    expect(text).toContain("fresh")
  })

  test("summarizer asks for a bounded machine-consumable block", () => {
    const text = Prompt.summarizeInSession({ objective: "o", condition: "c", reason: "r", turn: 2, elapsedMs: 1000, toolCalls: 3, history: [], maxSummaryTokens: 400 })
    expect(text).toContain("~400 tokens")
    expect(text).toContain("machine-consumable")
  })

  test("next-goal generator carries the LOOP_COMPLETE contract", () => {
    for (const text of [
      Prompt.nextGoalInSession({ objective: "o", history: [entry], latestSummary: "s" }),
      Prompt.nextGoalIndependently({ objective: "o", history: [entry], latestSummary: "s" }),
    ]) {
      expect(text).toContain("LOOP_COMPLETE")
      expect(text).toContain("EXACTLY ONE")
    }
  })

  test("isLoopComplete tolerates quotes and case", () => {
    expect(Prompt.isLoopComplete("LOOP_COMPLETE")).toBe(true)
    expect(Prompt.isLoopComplete('  "loop_complete"  ')).toBe(true)
    expect(Prompt.isLoopComplete("LOOP_COMPLETE.")).toBe(false)
    expect(Prompt.isLoopComplete("improve the tests")).toBe(false)
  })

  test("parseNextCondition normalizes one line and rejects junk", () => {
    expect(Prompt.parseNextCondition("  add tests  ")).toBe("add tests")
    expect(Prompt.parseNextCondition("add\ntests\nnow")).toBe("add tests now")
    expect(Prompt.parseNextCondition('"quoted condition"')).toBe("quoted condition")
    expect(Prompt.parseNextCondition("")).toBeUndefined()
    expect(Prompt.parseNextCondition("x".repeat(2_001))).toBeUndefined()
    expect(Prompt.parseNextCondition("LOOP_COMPLETE")).toBeUndefined()
  })
})

describe("loop config", () => {
  test("defaults: maxLoops 5, maxLoopSummaryTokens 400", () => {
    const config = resolveConfig({})
    expect(config.maxLoops).toBe(5)
    expect(config.maxLoopSummaryTokens).toBe(400)
  })

  test("options and env overrides are honoured", () => {
    expect(resolveConfig({ maxLoops: 3, maxLoopSummaryTokens: 123 }).maxLoops).toBe(3)
    expect(resolveConfig({ maxLoops: 3, maxLoopSummaryTokens: 123 }).maxLoopSummaryTokens).toBe(123)
    const env = resolveConfig({}, { OPENCODE_GOAL_MAX_LOOPS: "2", OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS: "77" })
    expect(env.maxLoops).toBe(2)
    expect(env.maxLoopSummaryTokens).toBe(77)
  })
})

describe("/goal-loop idempotent arming", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  const armingSteers = () => h.calls.synthetic.filter((s) => String(s.description).includes("arming v"))

  test("a met verdict drives exactly one arm: one summary, one steer, one history entry", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn()
    expect(armingSteers()).toHaveLength(1)
    expect(armingSteers()[0]!.text).toContain('iteration="2"')
    expect(h.summaryRequests).toHaveLength(1)
    expect(h.controller.get(SID)!.loopIteration).toBe(2)
    expect(h.controller.get(SID)!.loopHistory).toHaveLength(1)
  })

  test("a replayed execution.succeeded after the arm arms nothing new", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    h.controller.onExecutionStarted(SID)
    h.controller.onToolCalled(SID)
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    const armed = h.controller.get(SID)!
    expect(armed.loopIteration).toBe(2)
    // The same execution's succeeded event replays (fresh event id): no verdict is consumed, nothing re-arms.
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("arming v2"))).toHaveLength(1)
    expect(h.summaryRequests).toHaveLength(1)
    expect(h.controller.get(SID)!.loopIteration).toBe(2)
    expect(h.controller.get(SID)!.loopHistory).toHaveLength(1)
  })

  test("a met verdict delivered twice produces one summary entry and one synthetic arm", async () => {
    await h.setLoop("objective")
    // Both deliveries are backed by a queued verdict, so a missing guard shows up as a second arm/summary.
    h.verdicts.push(met("v1 done"), met("v1 done again"))
    h.summaries.push("s1", "s1 again")
    h.nextGoals.push("v2 condition", "v2 condition")
    h.controller.onExecutionStarted(SID)
    h.controller.onToolCalled(SID)
    const first = h.controller.onExecutionSucceeded(SID)
    const second = h.controller.onExecutionSucceeded(SID)
    await Promise.all([first, second])
    await flush()
    // The same logical met advances the loop once: one history entry, at most one armed objective.
    expect(h.controller.get(SID)!.loopHistory).toHaveLength(1)
    expect(armingSteers().length).toBeLessThanOrEqual(1)
  })

  test("restart mid-loop keeps loopIteration and does not re-arm the current objective", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn()
    // Simulate a restart before the fire-and-forget save landed is not deterministic; flush + restore from disk.
    await h.controller.dispose()
    const h2 = harness({}, h.storage)
    expect(await h2.controller.restore()).toBe(1)
    const record = h2.controller.get(SID)!
    expect(record.loopIteration).toBe(2)
    expect(record.condition).toBe("v2 condition")
    expect(record.loopHistory).toHaveLength(1)
    expect(record.loopHistory![0]!.version).toBe(1)
  })
})

describe("/goal-loop durable arming", () => {
  test("the armed record is durably written before the arm is announced", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    await h.setLoop("objective")
    // Block storage writes from this point on: the arm's save must not be declared durable until it lands.
    const realSet = storage.set.bind(storage)
    let gate: Promise<void> | undefined
    let release: (() => void) | undefined
    storage.set = async (key: string, value: unknown) => {
      if (gate) await gate
      return realSet(key, value)
    }
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    gate = new Promise<void>((resolve) => (release = resolve))
    const turn = h.turn()
    await flush()
    // Everything that can proceed without the blocked write has proceeded; the arm must not be announced yet.
    const announced = () => h.calls.synthetic.filter((s) => String(s.description).includes("arming v")).length
    expect(announced()).toBe(0)
    release!()
    await turn
    await flush()
    // The persisted record is the armed one: a restart from here cannot re-arm v2.
    const persisted = storage.data.get("goal/v1/ses_1") as { loopIteration?: number; condition: string } | undefined
    expect(persisted?.loopIteration).toBe(2)
    expect(persisted?.condition).toBe("v2 condition")
    const h2 = harness({}, storage)
    expect(await h2.controller.restore()).toBe(1)
    expect(h2.controller.get(SID)!.loopIteration).toBe(2)
    expect(h2.controller.get(SID)!.condition).toBe("v2 condition")
  })
})

describe("/goal-loop completion invariants", () => {
  test("LOOP_COMPLETE notifies achieved exactly once", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("done"))
    h.summaries.push("summary")
    h.nextGoals.push("LOOP_COMPLETE")
    await h.turn()
    expect(h.notices.filter((n) => n.kind === "achieved")).toHaveLength(1)
    // No further loop steps after completion: injecting another execution does not revive the loop.
    await h.turn()
    expect(h.notices.filter((n) => n.kind === "achieved")).toHaveLength(1)
  })
})

describe("/goal-loop failure modes", () => {
  test("the arm is one durable write: no snapshot pairs the recorded history with the pre-arm iteration", async () => {
    const storage = new MemoryStorage()
    const writes: Array<Record<string, unknown>> = []
    const realSet = storage.set.bind(storage)
    storage.set = async (key: string, value: unknown) => {
      writes.push(structuredClone(value) as Record<string, unknown>)
      return realSet(key, value)
    }
    const h = harness({}, storage)
    await h.setLoop("objective")
    h.verdicts.push(met("done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn()
    // The achieved iteration must never be persisted as "in history, but not yet armed":
    // a restore from that snapshot would re-advance the same iteration.
    const halfArmed = writes.filter(
      (w) =>
        Array.isArray(w.loopHistory) &&
        (w.loopHistory as unknown[]).length > 0 &&
        w.status === "active" &&
        w.condition === "objective" &&
        w.loopIteration === 1,
    )
    expect(halfArmed).toHaveLength(0)
  })

  test("a user prompt landing during the arm's persist suppresses the arm announcement", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    await h.setLoop("objective")
    const realSet = storage.set.bind(storage)
    let gate: Promise<void> | undefined
    let release: (() => void) | undefined
    storage.set = async (key: string, value: unknown) => {
      if (gate) await gate
      return realSet(key, value)
    }
    h.verdicts.push(met("done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    gate = new Promise<void>((resolve) => (release = resolve))
    const turn = h.turn()
    await flush()
    // The arm's persist is blocked; the user prompt lands while the write is in flight.
    h.controller.onUserPrompt(SID)
    release!()
    await turn
    await flush()
    const record = h.controller.get(SID)!
    // The superseded loop step must not announce the arm into a world that moved on.
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("arming"))).toHaveLength(0)
    expect(h.notices.filter((n) => n.kind === "loop")).toHaveLength(0)
    // The armed state itself is still durably written; a restore lands on v2.
    expect(record.condition).toBe("v2 condition")
    expect(record.loopIteration).toBe(2)
  })

  test("a duplicated execution.succeeded after an arm is ignored until the next execution starts", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"), met("v2 done"), met("v3 done"))
    h.summaries.push("s1", "s2")
    h.nextGoals.push("v2 condition", "v3 condition")
    await h.turn()
    expect(h.controller.get(SID)!.loopIteration).toBe(2)
    const retries = h.controller.get(SID)!.retries
    // Same execution, re-delivered with a fresh id and no intervening started: must not evaluate.
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    const record = h.controller.get(SID)!
    expect(record.loopIteration).toBe(2)
    expect(record.retries).toBe(retries)
    expect(h.summaryRequests).toHaveLength(1)
    expect(h.verdicts).toHaveLength(2)
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("arming v3"))).toHaveLength(0)
  })

  test("a duplicated execution.succeeded after a not_met continuation does not re-evaluate", async () => {
    const h = harness()
    await h.setGoal("all tests pass")
    h.verdicts.push(notMet("nope"))
    await h.turn(1)
    expect(h.controller.get(SID)!.turns).toBe(1)
    const retries = h.controller.get(SID)!.retries
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    const record = h.controller.get(SID)!
    expect(record.turns).toBe(1)
    expect(record.retries).toBe(retries)
    expect(h.notices.some((n) => n.kind === "retry")).toBe(false)
  })

  test("a planner that repeats the current condition ends the loop cleanly instead of spinning", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("done"))
    h.summaries.push("s1")
    h.nextGoals.push("   OBJECTIVE  ") // normalized repeat of the v1 condition/objective
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/already-completed/i)
    expect(record.loopIteration).toBe(1)
    expect(record.loopHistory).toHaveLength(1)
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("arming"))).toHaveLength(0)
    expect(h.notices.some((n) => n.kind === "achieved" && n.title === "Loop complete")).toBe(true)
  })

  test("a planner that repeats an earlier iteration's condition ends the loop cleanly", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"), met("v2 done"))
    h.summaries.push("s1", "s2")
    h.nextGoals.push("tighten the widget", "objective")
    await h.turn() // arms v2 = "tighten the widget"
    expect(h.controller.get(SID)!.loopIteration).toBe(2)
    await h.turn() // v2 met; the planner repeats v1's condition verbatim
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/already-completed/i)
    expect(record.loopIteration).toBe(2)
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("arming v3"))).toHaveLength(0)
    expect(h.notices.some((n) => n.kind === "achieved" && n.title === "Loop complete")).toBe(true)
  })
})

describe("/goal-loop straggler completions after failure", () => {
  test("a duplicated execution.succeeded after a failing turn does not evaluate the failed turn", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("spurious"))
    h.controller.onExecutionStarted(SID)
    h.controller.onToolCalled(SID)
    h.controller.onExecutionFailed(SID, { message: "socket hang up" })
    // The failed turn is over; a duplicate succeeded delivered before the retry's started must not evaluate.
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    const record = h.controller.get(SID)!
    expect(h.verdicts).toHaveLength(1) // the queued verdict was not consumed
    expect(record.turns).toBe(0)
    expect(h.summaryRequests).toHaveLength(0)
  })

  test("a duplicated execution.succeeded after a non-superseded interrupt does not evaluate", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("spurious"))
    h.controller.onExecutionStarted(SID)
    h.controller.onToolCalled(SID)
    h.controller.onExecutionInterrupted(SID, "inactivity")
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    const record = h.controller.get(SID)!
    expect(h.verdicts).toHaveLength(1)
    expect(record.turns).toBe(0)
    expect(h.summaryRequests).toHaveLength(0)
  })
})

describe("/goal-loop storage failure recovery", () => {
  test("a failed durable write is retried by the next commit of the same record", async () => {
    const storage = new MemoryStorage()
    const realSet = storage.set.bind(storage)
    let failing = true
    storage.set = async (key: string, value: unknown) => {
      if (failing) throw new Error("storage down")
      return realSet(key, value)
    }
    const h = harness({}, storage) // the harness store logs errors by throwing; they must not break the loop
    await h.setLoop("objective")
    h.verdicts.push(met("done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn()
    // All durable writes failed; the in-memory record is still armed, and storage never saw it.
    expect(h.controller.get(SID)!.loopIteration).toBe(2)
    expect(storage.data.has("goal/v1/ses_1")).toBe(false)
    failing = false
    h.controller.onUserPrompt(SID)
    await flush()
    const persisted = storage.data.get("goal/v1/ses_1") as { loopIteration?: number; condition: string } | undefined
    expect(persisted?.loopIteration).toBe(2)
    expect(persisted?.condition).toBe("v2 condition")
  })
})

describe("/goal-loop racing user turn", () => {
  test("a user turn started during the arming steer is evaluated, not swallowed by the straggler guard", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"), met("v2 not done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    let release!: () => void
    h.syntheticGate.promise = new Promise<void>((resolve) => (release = resolve))
    h.syntheticGate.match = "arming"
    const turn = h.turn()
    await flush() // the loop is now inside the gated arming steer
    // The user races ahead: their turn starts now, during the steer dispatch.
    h.controller.onExecutionStarted(SID)
    h.controller.onToolCalled(SID)
    release!()
    await turn
    await flush()
    // The user's turn ends; its succeeded event must be evaluated, not dropped as a straggler.
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    const record = h.controller.get(SID)!
    expect(record.turns).toBe(1)
    expect(h.verdicts).toHaveLength(0)
  })
})

describe("/goal-loop zero-tool accounting", () => {
  test("tool use on a superseded, dropped turn still counts toward the iteration", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"), met("v2 met"))
    h.summaries.push("s1", "s2")
    h.nextGoals.push("v2 condition", "v3 condition")
    await h.turn(1) // arms v2
    expect(h.controller.get(SID)!.loopIteration).toBe(2)
    // v2 turn: real work happens, but the evaluation is superseded mid-flight by a user prompt.
    h.controller.onExecutionStarted(SID)
    h.controller.onToolCalled(SID)
    h.controller.onToolCalled(SID)
    h.controller.onToolCalled(SID)
    const succeeded = h.controller.onExecutionSucceeded(SID)
    h.controller.onUserPrompt(SID)
    await succeeded
    await flush()
    // resumed user turn: zero tools, evaluator says v2 met → armed v3
    h.controller.onExecutionStarted(SID)
    await h.controller.onExecutionSucceeded(SID)
    await flush()
    const record = h.controller.get(SID)!
    expect(record.loopHistory!.at(-1)!.toolCalls).toBe(3)
    expect(record.loopNotProgress).toBe(0)
  })
})

describe("/goal-loop background work counting", () => {
  test("an iteration spent waiting on background work is not a zero-tool iteration", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"), met("v2 met"), met("v3 met"))
    h.summaries.push("s1", "s2", "s3")
    h.nextGoals.push("v2 condition", "v3 condition", "v4 condition")
    await h.turn(1) // arms v2
    // v2 iteration: the session does nothing itself; a subagent builds the feature, then the met verdict lands.
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn(0) // defers evaluation; no verdict consumed
    h.setWork({ subagents: 0, shells: 0 })
    await h.turn(0) // evaluated met with zero own tools
    expect(h.controller.get(SID)!.loopIteration).toBe(3)
    // v3 iteration: same shape; two consecutive background-only iterations must not pause the loop.
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn(0)
    h.setWork({ subagents: 0, shells: 0 })
    await h.turn(0)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopNotProgress).toBe(0)
  })
})

describe("RPC read-through after a reload", () => {
  test("restoreOne adopts a live record from storage with an empty in-memory map", async () => {
    const h1 = harness()
    await h1.setLoop("objective")
    h1.verdicts.push(met("v1 done"))
    h1.summaries.push("the summary")
    h1.nextGoals.push("v2 condition")
    await h1.turn(3)
    await h1.controller.dispose()

    // Fresh controller with an empty goals map — exactly the post-reload state.
    const h2 = harness({}, h1.storage)
    expect(h2.controller.get(SID)).toBeUndefined()
    expect(await h2.controller.restoreOne(SID)).toBe(true)
    const record = h2.controller.get(SID)!
    expect(record.loopIteration).toBe(2)
    expect(record.condition).toBe("v2 condition")
    expect(record.loopEnabled).toBe(true)
    expect(h2.controller.snapshot(SID)?.status).toBe("active")
  })

  test("restoreOne leaves finished records un-restored and missing ones alone", async () => {
    const h1 = harness()
    await h1.setLoop("objective")
    h1.verdicts.push(met("v1 done"))
    h1.summaries.push("the summary")
    h1.nextGoals.push("v2 condition")
    await h1.turn(1)
    // Finish the looped goal so the persisted record is terminal.
    h1.controller.clear(SID)
    await h1.controller.dispose()

    const h2 = harness({}, h1.storage)
    expect(await h2.controller.restoreOne(SID)).toBe(false)
    expect(h2.controller.get(SID)).toBeUndefined()
    expect(await h2.controller.restoreOne("ses_missing")).toBe(false)
  })

  test("restoreOne does not adopt a record owned by another directory", async () => {
    const h1 = harness()
    await h1.setLoop("objective")
    await h1.controller.dispose()
    // Simulate a record written by another plugin instance for the same storage.
    const key = "goal/v1/ses_1"
    const stored = structuredClone(h1.storage.data.get(key)) as { directory: string }
    stored.directory = "D:/elsewhere/project"
    h1.storage.data.set(key, stored)

    const h2 = harness({}, h1.storage)
    expect(await h2.controller.restoreOne(SID)).toBe(false)
    expect(h2.controller.get(SID)).toBeUndefined()
  })

  test("list() falls back to a storage restore when memory is empty", async () => {
    const h1 = harness()
    await h1.setLoop("objective")
    await h1.controller.dispose()

    const h2 = harness({}, h1.storage)
    expect(h2.controller.list()).toEqual([])
    expect(await h2.controller.restore()).toBe(1)
    const listed = h2.controller.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]!.sessionID).toBe(SID)
  })

})
