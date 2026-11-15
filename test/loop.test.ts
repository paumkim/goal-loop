import { beforeEach, describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/core/config.ts"
import * as Prompt from "../src/core/prompts.ts"
import type { CommitPolicy, GoalSnapshot, LoopEntry, Notice, UsageSnapshot } from "../src/core/types.ts"
import { BackgroundTracker } from "../src/runtime/background.ts"
import { GoalController } from "../src/runtime/controller.ts"
import { AutoCompactor } from "../src/runtime/compactor.ts"
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
  const notices: Notice[] = []
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
      synthetic: async (input) => void calls.synthetic.push(input),
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
    background: { busy: async (): Promise<BackgroundWork> => ({ subagents: 0, shells: 0 }) },
    emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
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
    notices,
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

  test("unusable next-goal generation ends the loop cleanly", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("done"))
    h.summaries.push("summary")
    h.nextGoals.push("x".repeat(3_000))
    await h.turn()
    const record = h.controller.get(SID)!
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

  test("two consecutive zero-tool-call iterations pause the loop", async () => {
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
    expect(record.status).toBe("paused")
    expect(record.reason).toMatch(/zero tool use|without tool use/i)
    expect(h.notices.some((n) => n.kind === "paused")).toBe(true)
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

  test("summary failure pauses the loop and records the achieved iteration", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    // No summary queued: the evaluator throws, and the loop must pause rather than lose the achieved iteration.
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("paused")
    expect(record.reason).toMatch(/summary failed/i)
    expect(record.loopHistory).toHaveLength(1)
    expect(record.loopHistory![0]!.summary).toMatch(/summary failed/i)
  })

  test("next-goal failure pauses the loop and keeps the achieved iteration", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    // No next goal queued: the planner throws, and the achieved iteration must survive in history.
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("paused")
    expect(record.reason).toMatch(/next-goal generator failed/i)
    expect(record.loopHistory).toHaveLength(1)
    expect(record.loopHistory![0]!.summary).toBe("s1")
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
