import { beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig } from "../src/core/config.ts"
import * as Prompt from "../src/core/prompts.ts"
import type { CommitPolicy, GoalSnapshot, LoopEntry, Notice, UsageSnapshot } from "../src/core/types.ts"
import { GoalController } from "../src/runtime/controller.ts"
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

function harness(options: Record<string, unknown> = {}, storage = new MemoryStorage()) {
  const clock = new FakeClock()
  const calls = { prompts: [] as any[], synthetic: [] as any[] }
  const verdicts: Array<EvaluationResult | Error> = []
  const summaries: string[] = []
  const nextGoals: string[] = []
  const summaryRequests: LoopSummaryRequest[] = []
  const nextGoalRequests: NextGoalRequest[] = []
  // Test hook: when set, the next-goal generator awaits this gate before replying (simulates an in-flight planner).
  const gate: { nextGoal?: Promise<void>; evaluate?: Promise<void> } = {}
  // Test hook: when set, the first matching synthetic call awaits this gate before delivering (simulates a slow steer round-trip).
  const syntheticGate: { promise?: Promise<void>; match?: string } = {}
  // Test hook: when set, every synthetic call throws (simulates the host rejecting the dispatch).
  const syntheticFail: { error?: Error } = {}
  const notices: Notice[] = []
  const changed: Array<{ sessionID: string; goal: GoalSnapshot | null }> = []
  const logs: Array<{ level: string; message: string }> = []
  const testLog = {
    info: (message: unknown) => void logs.push({ level: "info", message: String(message) }),
    warn: (message: unknown) => void logs.push({ level: "warn", message: String(message) }),
    error: (message: unknown) => void logs.push({ level: "error", message: String(message) }),
  }
  const work = { subagents: 0, shells: 0 }
  const compactCalls: Array<{ sessionID: string; opts?: { force?: boolean } }> = []
  let compactOutcome: BoundaryCompactResult = { requested: true, estimatedTokens: 250_000 }
  let contextSize: number | undefined = 250_000
  let usageValue: UsageSnapshot | undefined = { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  const commit: CommitPolicy = { required: false, branch: "dev", reason: "test" }
  const controller = new GoalController({
    config: resolveConfig(options),
    directory: typeof options.directory === "string" ? options.directory : DIR,
    commit,
    clock,
    log: testLog,
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
      usage: async () => usageValue,
      compact: async () => {},
    },
    evaluator: {
      evaluate: async (_request: EvaluationRequest) => {
        if (gate.evaluate) await gate.evaluate
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
    emitter: { changed: (sessionID: string, goal: GoalSnapshot | null) => void changed.push({ sessionID, goal }), notice: (n) => void notices.push(n) },
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
    notices,
    logs,
    changed,
    verdicts,
    summaries,
    nextGoals,
    summaryRequests,
    nextGoalRequests,
    gate,
    syntheticGate,
    setWork: (next: BackgroundWork) => Object.assign(work, next),
    compactCalls,
    setCompactOutcome: (outcome: BoundaryCompactResult) => void (compactOutcome = outcome),
    setSyntheticError: (error?: Error) => void (syntheticFail.error = error),
    setContextSize: (size: number | undefined) => void (contextSize = size),
    setUsage: (usage: UsageSnapshot | undefined) => void (usageValue = usage),
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

  test("an entry is stamped with the context size measured at its arm; v1 has none", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"), met("fuzz done"))
    h.summaries.push("parser rewritten and tests green", "fuzz done")
    h.nextGoals.push("add fuzz coverage for the parser", "add property tests")
    h.setCompactOutcome({ requested: true, estimatedTokens: 91_000 })
    await h.turn()
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.loopHistory).toHaveLength(2)
    expect(record.loopHistory![0]!.contextTokens).toBeUndefined()
    expect(record.loopHistory![1]!.contextTokens).toBe(91_000)
  })

  test("an entry is stamped with the sha HEAD had landed on when the iteration was recorded", async () => {
    const root = mkdtempSync(join(tmpdir(), "goal-loop-repo-"))
    process.on("exit", () => rmSync(root, { recursive: true, force: true }))
    const git = join(root, ".git")
    mkdirSync(join(git, "refs", "heads"), { recursive: true })
    writeFileSync(join(git, "refs", "heads", "dev"), "a".repeat(40) + "\n")
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/dev\n")
    const repoHarness = harness({ directory: root })
    await repoHarness.setLoop("improve the parser")
    repoHarness.verdicts.push(met("parser done"))
    repoHarness.summaries.push("parser rewritten and tests green")
    repoHarness.nextGoals.push("add fuzz coverage for the parser")
    await repoHarness.turn()
    expect(repoHarness.controller.get(SID)!.loopHistory![0]!.sha).toBe("a".repeat(40))
  })

  test("an unmeasurable arm stamps nothing — the entry records the gap honestly", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"), met("fuzz done"))
    h.summaries.push("parser rewritten and tests green", "fuzz done")
    h.nextGoals.push("add fuzz coverage for the parser", "add property tests")
    h.setCompactOutcome({ requested: true }) // no estimatedTokens — the host could not measure the context
    await h.turn()
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.loopHistory).toHaveLength(2)
    expect(record.loopHistory!.every((entry) => entry.contextTokens === undefined)).toBe(true)
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
    // The outcome note is a terminal note: it stays on the terminal, not in later context.
    const note = h.calls.synthetic.find((s) => String(s.description).startsWith("Loop 1 of"))
    expect(note).toBeDefined()
    expect(String(note!.text)).toContain("<goal-note final>")
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

  test("a planner retry persists the met turn's verdict to storage before the arm lands", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("the summary")
    // No nextGoal queued → the planner throws → the retry branch runs. Before the fix this path
    // persisted nothing: the turn verdict (and its evidence) only reached storage when a later
    // arm landed, or never on a crash.
    await h.turn()
    expect(h.logs.some((l) => l.level === "error" && l.message.includes("loop next-goal generation failed"))).toBe(true)
    expect(h.controller.get(SID)!.loopIteration).toBe(1)

    await h.controller.dispose()
    const h2 = harness({}, h.storage)
    expect(await h2.controller.restore()).toBe(1)
    const restored = h2.controller.get(SID)!
    expect(restored.history).toHaveLength(1)
    expect(restored.history[0]!.verdict).toBe("met")
    expect(restored.history[0]!.reason).toBe("v1 done")
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
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "warning" && /did not land/i.test(n.message))).toBe(true)
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

  test("two quick landings within 2 minutes arm one re-anchor; one after 2 minutes arms another", async () => {
    await h.setLoop("improve the parser")
    h.setContextSize(90_000)
    await h.controller.onCompactionLanded(SID)
    expect(h.controller.get(SID)!.reanchorCount).toBe(1)
    await h.controller.onCompactionLanded(SID) // coalesced: no second arm inside the window
    expect(h.controller.get(SID)!.reanchorCount).toBe(1)
    expect(h.controller.consumeAnchor(SID)).toBeDefined()
    expect(h.controller.consumeAnchor(SID)).toBeUndefined()
    await h.clock.advance(130_000)
    await h.controller.onCompactionLanded(SID)
    expect(h.controller.get(SID)!.reanchorCount).toBe(2)
  })

  test("a restore requests no compaction even with an unlanded pending request", async () => {
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
    // Adopt-only: a restore never asks the host to compact, for any session. Compaction is per-session.
    expect(h2.compactCalls).toHaveLength(0)
    // The pending request stays recorded; the arm-time settle re-requests at 2 misses.
    expect(h2.controller.get(SID)!.loopCompact!.landedAt).toBeUndefined()
  })

  test("a restore requests no compaction right after a landing either", async () => {
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

  test("a landed compaction arms a one-shot re-anchor injection restating the armed loop ground truth — never a transcript message", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("parser rewritten and tests green")
    h.nextGoals.push("add fuzz coverage for the parser")
    await h.turn(1)
    h.setContextSize(90_000)
    await h.controller.onCompactionLanded(SID)
    // No synthetic message reaches the transcript — the re-anchor rides the SYSTEM part instead.
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)
    expect(h.controller.get(SID)!.reanchorCount).toBe(1)
    const anchor = h.controller.consumeAnchor(SID)
    expect(anchor).toBeDefined()
    expect(anchor).toContain('<goal-loop-reanchor iteration="2" max="5">')
    expect(anchor).toContain("improve the parser") // the constant objective
    expect(anchor).toContain("add fuzz coverage for the parser") // the armed condition
    expect(anchor).toContain("- v1:") // the completed iteration survives the cut
    expect(anchor).toContain("git log --oneline -5")
    expect(anchor).toContain("Do not wait for a user message.")
    // One-shot: consumed by the next model request, gone after that.
    expect(h.controller.consumeAnchor(SID)).toBeUndefined()
  })

  test("an ended-compaction event is authoritative: it lands a pending request even with no size drop", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    // No drop (context still at the ~estimated size), but the host reported compaction ended: landed.
    await h.controller.onCompactionLanded(SID)
    const record = h.controller.get(SID)!
    expect(record.loopCompact!.landedAt).toBeNumber()
    expect(record.loopCompact!.misses).toBe(0)
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "success")).toBe(true)
    // The landing re-anchors the live loop immediately: a one-shot system injection, consumed by the next model request.
    expect(h.controller.get(SID)!.reanchorCount).toBe(1)
    expect(h.controller.consumeAnchor(SID)).toBeDefined()
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
    const anchor = h.controller.consumeAnchor(SID)
    expect(anchor).toBeDefined()
    expect(anchor).toContain('iteration="2"')
  })

  test("two arms with no landing and no drop push the miss count to 2 and the second force re-requests", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1) // miss 1: silent
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(1)
    h.verdicts.push(met("v3 done"))
    h.summaries.push("s3")
    h.nextGoals.push("v4 condition")
    await h.turn(1) // miss 2: one warning, then forced re-request
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(2)
    expect(h.compactCalls).toHaveLength(2)
    expect(h.compactCalls[1]).toEqual({ sessionID: SID, opts: { force: true } })
  })

  test("an ended-event landing resets the record; the next arm starts from a clean slate with a fresh request", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    await h.controller.onCompactionLanded(SID) // authoritative landing
    expect(h.controller.get(SID)!.loopCompact!.landedAt).toBeNumber()
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(0)
    // The landed record is not pending; the next arm requests a fresh boundary compaction (not forced).
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    expect(h.compactCalls).toHaveLength(2)
    expect(h.compactCalls[1]).toEqual({ sessionID: SID })
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(0)
    expect(h.controller.get(SID)!.loopCompact!.iteration).toBe(3)
  })

  test("an ended-compaction event lands even when the context size is unestimable", async () => {
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    h.setContextSize(undefined)
    await h.controller.onCompactionLanded(SID)
    const record = h.controller.get(SID)!
    expect(record.loopCompact!.landedAt).toBeNumber()
    expect(record.loopCompact!.misses).toBe(0)
  })

  test("a pending request that never lands: one warning at 2 arms, trickle every 3rd arm, cap is backstop only", async () => {
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
    await arm() // miss 2: ONE warning (exact text), forced re-request
    expect(h4.compactCalls).toHaveLength(2)
    expect(h4.compactCalls[1]).toEqual({ sessionID: SID, opts: { force: true } })
    const hostUnwilling = h4.notices.filter((n2) => n2.kind === "compact" && n2.level === "warning" && n2.message === "compaction did not land; loop is running hot; consider /compact manually")
    expect(hostUnwilling).toHaveLength(1)
    await arm() // miss 3: trickle (3 % 3 === 0), no new warning
    expect(h4.compactCalls).toHaveLength(3)
    expect(h4.compactCalls[2]).toEqual({ sessionID: SID, opts: { force: true } })
    expect(h4.notices.filter((n2) => n2.message === "compaction did not land; loop is running hot; consider /compact manually")).toHaveLength(1)
    await arm() // miss 4: backstop final warning, no request (4 % 3 !== 0)
    expect(h4.compactCalls).toHaveLength(3)
    expect(h4.notices.filter((n2) => n2.title === "Compaction not landing" && /trickle every 3rd arm/.test(n2.message))).toHaveLength(1)
    await arm() // miss 5: silent, no request
    expect(h4.compactCalls).toHaveLength(3)
    await arm() // miss 6: trickle re-request — never permanent silence
    expect(h4.compactCalls).toHaveLength(4)
    expect(h4.compactCalls[3]).toEqual({ sessionID: SID, opts: { force: true } })
    expect(h4.controller.get(SID)?.status).toBe("active")
  })

  test("repeated unmeasurable arms never reach the 4-miss terminal state: staleness unknown, trickle every 2 arms", async () => {
    const h7 = harness({ maxLoops: 50 })
    await h7.setLoop("improve the parser")
    let n = 0
    const arm = async () => {
      h7.verdicts.push(met("step done"))
      h7.summaries.push("s")
      h7.nextGoals.push(`iter-${++n}`)
      await h7.turn(1)
    }
    h7.setContextSize(undefined) // the host cannot show us a number at all
    await arm() // fresh boundary request (estimate unknown at request time)
    expect(h7.compactCalls).toEqual([{ sessionID: SID }])
    await arm() // unmeasurable tick 1: one forced re-request past cooldown, misses untouched
    expect(h7.controller.get(SID)!.loopCompact!.misses).toBe(0)
    expect(h7.compactCalls).toHaveLength(2)
    expect(h7.compactCalls[1]).toEqual({ sessionID: SID, opts: { force: true } })
    await arm() // tick 2: staleness unknown (one warning), forced re-request (2 % 2 === 0)
    expect(h7.controller.get(SID)!.loopCompact!.misses).toBe(0)
    expect(h7.controller.get(SID)!.loopCompact!.stalenessUnknown).toBe(true)
    expect(h7.compactCalls).toHaveLength(3)
    await arm() // tick 3: no re-request (odd tick under unknown staleness)
    expect(h7.compactCalls).toHaveLength(3)
    expect(h7.controller.get(SID)!.loopCompact!.misses).toBe(0)
    await arm() // tick 4: re-request again — never a terminal suspension
    expect(h7.compactCalls).toHaveLength(4)
    expect(h7.controller.get(SID)!.loopCompact!.misses).toBe(0)
    const landingUnknown = h7.notices.filter((n2) => n2.kind === "compact" && n2.level === "warning" && n2.title === "Compaction landing unknown")
    expect(landingUnknown).toHaveLength(1) // one transition warning, not one per arm
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
    await arm() // miss 4: backstop — final warning, trickle re-requests continue (Workstream BV)
    expect(h5.compactCalls).toHaveLength(3)
    h5.setContextSize(90_000)
    await h5.controller.onCompactionLanded(SID) // landing observed via the ended event
    expect(h5.controller.get(SID)!.loopCompact!.landedAt).toBeNumber()
    await arm() // fresh request resumes from misses 0
    expect(h5.compactCalls).toHaveLength(4)
    expect(h5.compactCalls[3]).toEqual({ sessionID: SID })
    expect(h5.controller.get(SID)!.loopCompact!.misses).toBe(0)
  })

  test("re-anchor is armed even with no pending boundary request (the host compacted on its own)", async () => {
    await h.setLoop("improve the parser")
    await h.controller.onCompactionLanded(SID)
    const anchor = h.controller.consumeAnchor(SID)
    expect(anchor).toBeDefined()
    expect(anchor).toContain('iteration="1"')
  })

  test("no re-anchor for a plain goal, or for a terminal loop", async () => {
    await h.setGoal("all tests pass")
    await h.controller.onCompactionLanded(SID)
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)
    expect(h.controller.consumeAnchor(SID)).toBeUndefined()
    expect(h.controller.get(SID)?.reanchorCount).toBeUndefined()

    const h2 = harness()
    await h2.setLoop("improve the parser")
    h2.controller.clear(SID)
    await h2.controller.onCompactionLanded(SID)
    expect(h2.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)
    expect(h2.controller.consumeAnchor(SID)).toBeUndefined()
  })

  test("a paused loop is not re-anchored", async () => {
    const h3 = harness()
    await h3.setLoop("improve the parser")
    h3.controller.onExecutionInterrupted(SID, "user")
    expect(h3.controller.get(SID)?.status).toBe("paused")
    await h3.controller.onCompactionLanded(SID)
    expect(h3.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)
    expect(h3.controller.consumeAnchor(SID)).toBeUndefined()
    expect(h3.controller.get(SID)?.reanchorCount).toBeUndefined()
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

  test("the cap-freeze warning fires once per pause, not on every prompt (a24)", async () => {
    const capped = harness({ maxTurns: 2 })
    await capped.setGoal("all tests pass")
    capped.verdicts.push(notMet(), notMet())
    await capped.turn()
    await capped.turn()
    expect(capped.controller.get(SID)?.status).toBe("paused")
    capped.controller.onUserPrompt(SID)
    capped.controller.onUserPrompt(SID)
    const freezeNotices = capped.notices.filter((n) => n.title === "Goal paused at turn cap")
    expect(freezeNotices).toHaveLength(1)
  })

  test("a message resumes an armed loop even past the cap", async () => {
    const h3 = harness({ maxTurns: 1 })
    await h3.setLoop("improve the parser")
    h3.controller.onExecutionInterrupted(SID, "user")
    expect(h3.controller.get(SID)?.status).toBe("paused")
    h3.controller.onUserPrompt(SID)
    expect(h3.controller.get(SID)?.status).toBe("active")
  })

  test("a failing re-anchor path does not break compaction landing", async () => {
    // The re-anchor is a local mutation + record commit, never a host call: even a host that rejects
    // every synthetic dispatch cannot break the landing bookkeeping (there is nothing to reject).
    await h.setLoop("improve the parser")
    h.setSyntheticError(new Error("host busy"))
    await expect(h.controller.onCompactionLanded(SID)).resolves.toBeUndefined()
    expect(h.controller.get(SID)!.reanchorCount).toBe(1)
    expect(h.controller.consumeAnchor(SID)).toBeDefined()
  })
})

describe("completed-condition ledger", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness({ maxLoops: 150 })
  })

  test("a planner repeat of a condition that completed long before the retained window ends the loop", async () => {
    h = harness({ maxLoops: 100 })
    await h.setLoop("objective")
    for (let i = 1; i <= 55; i++) {
      h.verdicts.push(met(`v${i} done`))
      h.summaries.push(`summary ${i}`)
      h.nextGoals.push(i < 55 ? `step ${i + 1}` : "Step 2!")
    }
    for (let i = 0; i < 55; i++) await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/already-completed/i)
    // v2's condition fell out of the retained 50-entry iteration window long before this proposal.
    expect(record.loopHistory).toHaveLength(50)
    expect(record.loopHistory!.some((e) => e.condition === "step 2")).toBe(false)
    // The ledger is what still knows about it.
    expect(record.completedConditions).toContain("step 2")
    expect(record.completedConditions).toHaveLength(55)
    expect(record.completedConditionsDropped).toBeUndefined()
  })

  test("a near-duplicate proposal of a pre-window completed condition ends the loop", async () => {
    h = harness({ maxLoops: 100 })
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("tighten the widget")
    await h.turn() // arms v2 = "tighten the widget"
    for (let i = 2; i <= 55; i++) {
      h.verdicts.push(met(`v${i} done`))
      h.summaries.push(`summary ${i}`)
      h.nextGoals.push(i < 55 ? `step ${i + 1}` : "tighten the widget extra")
    }
    for (let i = 0; i < 54; i++) await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/already-completed/i)
    expect(record.loopHistory!.some((e) => e.condition === "tighten the widget")).toBe(false)
    expect(record.completedConditions).toContain("tighten the widget")
  })

  test("the ledger is bounded: the cap keeps the newest conditions and counts the drops", async () => {
    await h.setLoop("objective")
    for (let i = 1; i <= 105; i++) {
      h.verdicts.push(met(`v${i} done`))
      h.summaries.push(`summary ${i}`)
      h.nextGoals.push(`step ${i + 1}`)
    }
    for (let i = 0; i < 105; i++) await h.turn()
    const record = h.controller.get(SID)!
    expect(record.completedConditions).toHaveLength(100)
    expect(record.completedConditions![0]).toBe("step 6")
    expect(record.completedConditionsDropped).toBe(5)
  })

  test("the ledger survives a dispose + restore round trip", async () => {
    h = harness({ maxLoops: 100 })
    await h.setLoop("objective")
    for (let i = 1; i <= 3; i++) {
      h.verdicts.push(met(`v${i} done`))
      h.summaries.push(`summary ${i}`)
      h.nextGoals.push(`step ${i + 1}`)
    }
    for (let i = 0; i < 3; i++) await h.turn()
    await h.controller.dispose()
    const h2 = harness({}, h.storage)
    expect(await h2.controller.restore()).toBe(1)
    const restored = h2.controller.get(SID)!
    expect(restored.completedConditions).toEqual(["objective", "step 2", "step 3"])
  })
})

describe("loop history retention", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  test("a 60-iteration loop keeps the newest 50 entries, records 10 drops, and the persisted record is bounded too", async () => {
    h = harness({ maxLoops: 100 })
    await h.setLoop("objective")
    for (let i = 1; i <= 60; i++) {
      h.verdicts.push(met(`v${i} done`))
      h.summaries.push(`summary ${i}`)
      h.nextGoals.push(`step ${i + 1}`)
    }
    for (let i = 0; i < 60; i++) await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopHistory).toHaveLength(50)
    expect(record.loopHistory![0]!.version).toBe(11)
    expect(record.loopHistory!.at(-1)!.version).toBe(60)
    expect(record.loopHistoryDropped).toBe(10)
    // Outbound snapshots clone the record — the cap must hold there too.
    const snapshot = h.controller.snapshot(SID) as GoalSnapshot
    expect(snapshot.loopHistory).toHaveLength(50)
    expect(snapshot.loopHistoryDropped).toBe(10)
    // The persisted bytes are bounded: restore into a fresh controller and read the stored record.
    await h.controller.dispose()
    const h2 = harness({}, h.storage)
    expect(await h2.controller.restore()).toBe(1)
    const restored = h2.controller.get(SID)!
    expect(restored.loopHistory).toHaveLength(50)
    expect(restored.loopHistory![0]!.version).toBe(11)
    expect(restored.loopHistoryDropped).toBe(10)
  })

  test("the cap-reached end also bounds the final record", async () => {
    h = harness({ maxLoops: 51 })
    await h.setLoop("objective")
    for (let i = 1; i <= 51; i++) {
      h.verdicts.push(met(`v${i} done`))
      h.summaries.push(`summary ${i}`)
      if (i < 51) h.nextGoals.push(`step ${i + 1}`)
    }
    for (let i = 0; i < 51; i++) await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.loopHistory).toHaveLength(50)
    expect(record.loopHistory![0]!.version).toBe(2)
    expect(record.loopHistoryDropped).toBe(1)
  })

  test("at or below the cap nothing is dropped and the dropped counter stays absent", async () => {
    await h.setLoop("objective")
    for (let i = 1; i <= 3; i++) {
      h.verdicts.push(met(`v${i} done`))
      h.summaries.push(`summary ${i}`)
      h.nextGoals.push(`step ${i + 1}`)
    }
    for (let i = 0; i < 3; i++) await h.turn()
    const record = h.controller.get(SID)!
    expect(record.loopHistory).toHaveLength(3)
    expect(record.loopHistoryDropped).toBeUndefined()
  })
})

describe("verdict trail retention", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  test("25 evaluated turns retain the newest 20 with an explicit dropped counter on the record and the snapshot clone", async () => {
    await h.setGoal("all tests pass")
    for (let turn = 1; turn <= 25; turn++) h.verdicts.push(notMet(`turn ${turn} still failing`))
    for (let turn = 0; turn < 25; turn++) await h.turn()
    const record = h.controller.get(SID)!
    expect(record.history).toHaveLength(20)
    expect(record.history![0]!.turn).toBe(6)
    expect(record.history![19]!.turn).toBe(25)
    expect(record.historyDropped).toBe(5)
    const snapshot = h.controller.snapshot(SID) as GoalSnapshot
    expect(snapshot.history).toHaveLength(20)
    expect(snapshot.historyDropped).toBe(5)
  })

  test("at or below the cap nothing is dropped and the counter stays absent", async () => {
    await h.setGoal("all tests pass")
    for (let turn = 1; turn <= 20; turn++) h.verdicts.push(notMet(`turn ${turn} still failing`))
    for (let turn = 0; turn < 20; turn++) await h.turn()
    const record = h.controller.get(SID)!
    expect(record.history).toHaveLength(20)
    expect(record.historyDropped).toBeUndefined()
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

  test("next-goal planner is pinned to audit the candidate against CURRENT HEAD (ABSENT at HEAD)", () => {
    const text = Prompt.nextGoalInSession({ objective: "o", history: [entry], latestSummary: "s" })
    expect(text).toContain("LOOP_COMPLETE")
    expect(text).toContain("ABSENT at HEAD")
  })

  test("loopContinuation requires the already-satisfied audit before working", () => {
    const text = Prompt.loopContinuation({ iteration: 3, maxLoops: 5, condition: "next thing", previousSummary: "prev summary", reason: "r" }, { required: false, branch: "dev", reason: "t" })
    expect(text).toContain("Already satisfied at HEAD")
  })

  test("the evaluator rubric states the already-satisfied-at-HEAD verdict wording", () => {
    const text = Prompt.evaluateInSession("do it", { turn: 2, elapsedMs: 1000 }, { required: false, branch: "dev", reason: "t" })
    expect(text).toContain("Already satisfied at HEAD")
  })

  test("evaluator rubric is a defensive auditor: stale/weakened state forces not_met, met reasons carry a next: hint", () => {
    for (const text of [
      Prompt.evaluateInSession("do it", { turn: 2, elapsedMs: 1000 }, { required: false, branch: "dev", reason: "t" }),
      Prompt.evaluateIndependently("do it", { turn: 2, elapsedMs: 1000 }, "transcript", { required: false, branch: "dev", reason: "t" }),
    ]) {
      expect(text).toContain("Defensive audit")
      expect(text).toContain("weakened")
      expect(text).toContain("contradicted by fresher output")
      expect(text).toContain("bought by weakening a test")
      expect(text).toContain('prefixed "next:"')
      expect(text).toContain("single next concrete step")
    }
  })

  test("next-goal planner audits in defensive order and carries forward the evaluator's next: hint", () => {
    for (const text of [
      Prompt.nextGoalInSession({ objective: "o", history: [entry], latestSummary: "s" }),
      Prompt.nextGoalIndependently({ objective: "o", history: [entry], latestSummary: "s" }),
    ]) {
      expect(text).toContain("defensive auditor")
      expect(text).toContain("a. Failing, weakened or unwired gates")
      expect(text).toContain("b. Stale or contradictory state")
      expect(text).toContain("e. Speed and friction")
      expect(text).toContain('"next:" hint')
      expect(text).toContain("first-class candidate")
    }
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

  test("a plain (non-loop) goal gets no boundary compaction at restore (a4)", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    await h.setGoal("all tests pass")
    await h.controller.dispose()
    const h2 = harness({}, storage)
    expect(await h2.controller.restore()).toBe(1)
    expect(h2.compactCalls).toHaveLength(0)
  })

  test("the final spend re-save goes through commit's no-op cache (a9)", async () => {
    const h = harness()
    await h.setGoal("all tests pass")
    h.verdicts.push(met("done"))
    await h.turn()
    // Let the fire-and-forget final usage snapshot land.
    await flush()
    await flush()
    const record = h.controller.get(SID)!
    expect(record.final).toBeDefined()
    // The cache that guards redundant saves must mirror what was persisted, including `final`.
    const marker = (h.controller as any).lastCommit.get(SID) as string | undefined
    expect(marker).toBe(JSON.stringify(record))
  })

  test("restore adopts live records without requesting any host compaction (adopt-only)", async () => {
    const storage = new MemoryStorage()
    const h = harness({}, storage)
    await h.setLoop("improve the parser") // armed v1, no boundary request yet
    await h.controller.dispose()
    const restored = harness({}, storage)
    expect(await restored.controller.restore()).toBe(1)
    // No per-session exception, no fan-out: a restore compacts nothing, not even armed loops.
    expect(restored.compactCalls).toHaveLength(0)
  })

  test("a restore of many live loop sessions compacts none of them (no all-at-once fan-out)", async () => {
    const storage = new MemoryStorage()
    const hA = harness({}, storage)
    const hB = harness({}, storage)
    await hA.controller.command({ sessionID: "ses_a", text: "objective a", delivery: "steer", loop: true })
    await hB.controller.command({ sessionID: "ses_b", text: "objective b", delivery: "steer", loop: true })
    await hA.controller.dispose()
    await hB.controller.dispose()
    const restored = harness({}, storage)
    expect(await restored.controller.restore()).toBe(2)
    expect(restored.compactCalls).toHaveLength(0)
  })

  test("set() awaits the initial record write before returning (a8)", async () => {
    const storage = new MemoryStorage()
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const originalSet = storage.set
    storage.set = async (key: string, value: unknown) => {
      await gate
      return originalSet(key, value)
    }
    const h = harness({}, storage)
    let settled = false
    const pending = h.setGoal("all tests pass").then(() => {
      settled = true
    })
    // The storage write is blocked on the gate: the goal prompt must not be issued and set() must not
    // resolve before the record is durable.
    await flush()
    expect(h.calls.prompts).toHaveLength(0)
    expect(settled).toBe(false)
    releaseGate()
    await pending
    expect(settled).toBe(true)
    expect(h.calls.prompts).toHaveLength(1)
    expect(h.controller.get(SID)!.condition).toBe("all tests pass")
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

  test("a planner that re-proposes a near-duplicate of a completed condition ends the loop cleanly", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("tighten the widget")
    await h.turn() // arms v2 = "tighten the widget"
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("tighten the widgets in the widget suite") // token containment 1.0 vs the completed v2 condition
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/already-completed/i)
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("arming v3"))).toHaveLength(0)
    expect(h.notices.some((n) => n.kind === "achieved" && n.title === "Loop complete")).toBe(true)
  })

  test("a planner's genuinely new proposal still arms v3", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("tighten the widget")
    await h.turn() // arms v2 = "tighten the widget"
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("rewrite the installer checksum validation") // near-zero overlap with the completed work
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.condition).toBe("rewrite the installer checksum validation")
    expect(record.loopIteration).toBe(3)
    expect(record.status).toBe("active")
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("arming v3"))).toHaveLength(1)
  })

  test("a planner's punctuation-drifted repeat of a completed condition ends the loop cleanly (a5)", async () => {
    const h = harness()
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("fix the flaky test")
    await h.turn() // arms v2 = "fix the flaky test"
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("Fix the flaky test.") // punctuation drift of the completed v2 condition
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toMatch(/already-completed/i)
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
  test("peekSnapshot serves a stored live record without adopting it", async () => {
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
    const key = "goal/v1/ses_1"
    const storedBefore = structuredClone(h1.storage.data.get(key))
    const s = await h2.controller.peekSnapshot(SID)
    expect(s).not.toBeNull()
    expect(s!.loopIteration).toBe(2)
    expect(s!.condition).toBe("v2 condition")
    expect(s!.loopEnabled).toBe(true)
    // The arm reset per-iteration turns in storage; the peek must serve exactly what storage holds.
    expect(s!.turns).toBe(0)
    expect(s!.status).toBe("active")
    // Still nothing adopted: the peek never writes the record back (no turns/baseline reset).
    expect(h2.controller.get(SID)).toBeUndefined()
    expect(h1.storage.data.get(key)).toEqual(storedBefore)
  })

  test("peekSnapshot serves terminal records as stored truth", async () => {
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
    const s = await h2.controller.peekSnapshot(SID)
    expect(s).not.toBeNull()
    expect(s!.status).toBe("cleared")
    expect(h2.controller.get(SID)).toBeUndefined()
    expect(await h2.controller.peekSnapshot("ses_missing")).toBeNull()
  })

  test("peekSnapshot returns null for missing records and for records from another directory", async () => {
    const h1 = harness()
    await h1.setLoop("objective")
    await h1.controller.dispose()
    expect(await h1.controller.peekSnapshot("ses_missing")).toBeNull()
    // Simulate a record written by another plugin instance for the same storage.
    const key = "goal/v1/ses_1"
    const stored = structuredClone(h1.storage.data.get(key)) as { directory: string }
    stored.directory = "D:/elsewhere/project"
    h1.storage.data.set(key, stored)

    const h2 = harness({}, h1.storage)
    expect(await h2.controller.peekSnapshot(SID)).toBeNull()
    expect(h2.controller.get(SID)).toBeUndefined()
  })

  test("peekList serves stored live records without adopting anything", async () => {
    const h1 = harness()
    await h1.setLoop("objective")
    await h1.controller.dispose()

    const h2 = harness({}, h1.storage)
    const listed = await h2.controller.peekList()
    expect(listed.map((s) => s.sessionID)).toEqual([SID])
    expect(listed[0]!.status).toBe("active")
    // A peek adopts nothing: the in-memory map stays empty.
    expect(h2.controller.get(SID)).toBeUndefined()
  })

  test("peekList omits terminal records", async () => {
    const h1 = harness()
    await h1.setLoop("objective")
    h1.controller.clear(SID)
    await h1.controller.dispose()

    const h2 = harness({}, h1.storage)
    expect(await h2.controller.peekList()).toEqual([])
  })

  test("spend falls back to the stored record for sessions this instance never adopted", async () => {
    const h1 = harness()
    await h1.setGoal("all tests pass")
    await h1.controller.dispose()

    const h2 = harness({}, h1.storage)
    expect(h2.controller.get(SID)).toBeUndefined()
    const spend = await h2.controller.spend(SID)
    expect(spend).toBeDefined()
    // Default usage (input 100) minus the arm-time baseline (input 100): a zero diff, not undefined.
    expect(spend!.input).toBe(0)
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

describe("background drain", () => {
  test("a deferred turn evaluates as soon as the background work drains", async () => {
    const h = harness()
    await h.setGoal("all tests pass")
    h.verdicts.push(notMet("keep going"))
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn(1)        // defers evaluation; verdict NOT consumed
    expect(h.verdicts).toHaveLength(1)
    h.setWork({ subagents: 0, shells: 0 })
    await h.controller.onBackgroundDrained()
    expect(h.verdicts).toHaveLength(0)   // the queued verdict was consumed now, not at the check-in
    expect(h.controller.get(SID)!.turns).toBe(1)
  })

  test("onBackgroundDrained is a no-op when nothing deferred", async () => {
    const h = harness()
    await h.setGoal("all tests pass")
    await h.controller.onBackgroundDrained()  // must not consume verdicts nor throw
    h.verdicts.push(notMet())
    await h.controller.onBackgroundDrained()
    expect(h.verdicts).toHaveLength(1)
  })

  test("onBackgroundDrained waits for remaining work", async () => {
    const h = harness()
    await h.setGoal("all tests pass")
    h.verdicts.push(notMet())
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn(1)
    await h.controller.onBackgroundDrained()  // still busy: verdict not consumed
    expect(h.verdicts).toHaveLength(1)
  })
})

describe("snapshot convergence (epoch-invalidated work must not strand the TUI chrome)", () => {
  test("an epoch-invalidated in-flight evaluation emits changed(evaluating:false)", async () => {
    const h = harness()
    await h.setGoal("all tests pass")
    let release!: () => void
    h.gate.evaluate = new Promise<void>((resolve) => { release = resolve })
    h.verdicts.push(notMet("keep going"))
    const turnPromise = h.turn()
    await flush()
    await flush()
    expect(h.changed.some((e) => e.goal?.evaluating === true)).toBe(true)
    h.controller.onUserPrompt(SID) // supersedes the in-flight evaluation: epoch++, abort, flag flip
    expect(h.changed.findLast((e) => e.goal?.evaluating === false)).toBeDefined()
    release()
    await turnPromise // must resolve cleanly: the stale verdict is discarded, nothing throws
  })

  test("an execution interrupted while a turn defers on background work emits changed(waiting:false)", async () => {
    const h = harness()
    await h.setGoal("all tests pass")
    h.verdicts.push(notMet("keep going"))
    h.setWork({ subagents: 1, shells: 0 })
    await h.turn(0) // evaluation deferred on background work; firstDefer emits waiting:true
    expect(h.changed.some((e) => e.goal?.waiting === true)).toBe(true)
    h.controller.onExecutionInterrupted(SID, "superseded")
    expect(h.changed.findLast((e) => e.goal?.waiting === false)).toBeDefined()
  })
})

describe("goal-loop command syntax (/goal-loop-<N>)", () => {
  test("an explicit per-run maxLoops is recorded and does not touch the configured default", async () => {
    const h = harness()
    await h.controller.armFromPrompt({ sessionID: SID, condition: "fix the whole release pipeline", maxLoops: 188 })
    const record = h.controller.get(SID)!
    expect(record.loopEnabled).toBe(true)
    expect(record.loopIteration).toBe(1)
    expect(record.loopMaxLoops).toBe(188)
    expect(record.condition).toBe("fix the whole release pipeline")
    expect(record.loopObjective).toBe("fix the whole release pipeline")
    // No synthetic prompt: the admitted user message is the kickoff.
    expect(h.calls.prompts).toHaveLength(0)
    // The armed record announces the effective limit in the iteration="k" max="N" shape.
    const set = h.notices.findLast((n) => n.kind === "set")
    expect(set).toBeDefined()
    expect(set!.message).toContain('iteration="1" max="188"')
  })

  test("the per-run override caps completed iterations", async () => {
    const h = harness()
    await h.controller.armFromPrompt({ sessionID: SID, condition: "ship it", maxLoops: 1 })
    h.verdicts.push(met("done"))
    h.summaries.push("first and only iteration")
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.loopMaxLoops).toBe(1)
    expect(h.nextGoals).toHaveLength(0)
  })

  test("an armed loop anchored on v2 shows the per-run limit, not the configured default", async () => {
    const h = harness()
    await h.controller.armFromPrompt({ sessionID: SID, condition: "improve the parser", maxLoops: 188 })
    h.verdicts.push(met("v1 done"))
    h.summaries.push("v1 summary")
    h.nextGoals.push("v2 condition")
    await h.turn()
    const arming = h.calls.synthetic.find((s) => String(s.text).includes('iteration="2"'))
    expect(arming).toBeDefined()
    expect(String(arming.text)).toContain('max="188"')
    // The next armed record keeps the per-run limit.
    expect(h.controller.get(SID)!.loopMaxLoops).toBe(188)
  })

  test("a later unparameterized loop uses the configured default (rule 10)", async () => {
    const h = harness()
    await h.controller.armFromPrompt({ sessionID: SID, condition: "first loop", maxLoops: 12 })
    expect(h.controller.get(SID)!.loopMaxLoops).toBe(12)
    await h.setLoop("second loop")
    expect(h.controller.get(SID)!.loopMaxLoops).toBe(5)
  })

  test("an invalid count falls back to the default, with a warning notice", async () => {
    const h = harness()
    await h.controller.armFromPrompt({ sessionID: SID, condition: "fix it", maxLoops: undefined, invalidCount: "abc" })
    const record = h.controller.get(SID)!
    expect(record.loopMaxLoops).toBe(5)
    const warning = h.notices.find((n) => n.kind === "set" && /Loop count ignored/.test(n.title))
    expect(warning).toBeDefined()
    expect(warning!.message).toContain('"abc"')
    expect(warning!.message).toContain("5")
  })

  test("an empty invalid count is stated as missing, never echoed as empty quotes", async () => {
    const h = harness()
    await h.controller.armFromPrompt({ sessionID: SID, condition: "fix it", maxLoops: undefined, invalidCount: "" })
    const warning = h.notices.find((n) => n.kind === "set" && /Loop count ignored/.test(n.title))
    expect(warning).toBeDefined()
    expect(warning!.message).toContain("nothing was provided")
    expect(warning!.message).not.toContain('""')
  })

  test("a control-laden invalid count is sanitized before it is echoed", async () => {
    const h = harness()
    await h.controller.armFromPrompt({ sessionID: SID, condition: "fix it", maxLoops: undefined, invalidCount: "\u001b[2Jabc" })
    const warning = h.notices.find((n) => n.kind === "set" && /Loop count ignored/.test(n.title))
    expect(warning).toBeDefined()
    for (const ch of warning!.message as string) expect(ch.charCodeAt(0)).toBeGreaterThanOrEqual(32)
  })

  test("out-of-range counts (0 and 1001) are treated as invalid, not clamped", async () => {
    const h = harness()
    for (const bad of ["0", "1001"]) {
      await h.controller.armFromPrompt({ sessionID: SID, condition: "fix it", maxLoops: undefined, invalidCount: bad })
      expect(h.controller.get(SID)!.loopMaxLoops).toBe(5)
      h.controller.clear(SID)
    }
  })

  test("the record set carries the effective limit for the status line", async () => {
    const h = harness()
    await h.controller.armFromPrompt({ sessionID: SID, condition: "fix it", maxLoops: 42 })
    const set = h.notices.findLast((n) => n.kind === "set")!
    expect(set.message).toBe('iteration="1" max="42" · fix it')
  })
})

describe("compaction landing detection + evaluator hardening — acceptance", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  test("(i) a pending request that never lands yields the one warning within 2 arms — not silence", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"), met("v2 done"))
    h.summaries.push("s1", "s2")
    h.nextGoals.push("v2 condition", "v3 condition")
    await h.turn(1) // request made; no landing observed yet
    await h.turn(1) // miss 1: silent count, no warning yet
    expect(h.notices.filter((n) => n.message === "compaction did not land; loop is running hot; consider /compact manually")).toHaveLength(0)
    h.verdicts.push(met("v3 done"))
    h.summaries.push("s3")
    h.nextGoals.push("v4 condition")
    await h.turn(1) // miss 2: the warning must fire now
    const hostUnwilling = h.notices.filter((n) => n.kind === "compact" && n.level === "warning" && n.message === "compaction did not land; loop is running hot; consider /compact manually")
    expect(hostUnwilling).toHaveLength(1)
  })

  test("(ii) a drop of exactly 10% lands: success notice, pending cleared, misses reset, fresh requests re-enabled", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1) // pending: estimatedTokens 250_000
    h.setContextSize(225_000) // exactly 10% below the estimate
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.loopCompact!.landedAt).toBeNumber() // pending cleared (landed form)
    expect(record.loopCompact!.misses).toBe(0)
    expect(record.loopCompact!.stalenessUnknown).toBeUndefined()
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "success" && /dropped to ~225000 tokens/.test(n.message))).toBe(true)
    // Fresh requests re-enabled: the next arm requests from scratch, not a forced re-request.
    h.verdicts.push(met("v3 done"))
    h.summaries.push("s3")
    h.nextGoals.push("v4 condition")
    h.setContextSize(250_000)
    await h.turn(1)
    expect(h.compactCalls[h.compactCalls.length - 1]).toEqual({ sessionID: SID })
  })

  test("(ii-b) a drop under 10% is not a landing", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1) // pending: estimatedTokens 250_000
    h.setContextSize(237_500) // 5% below the estimate
    h.verdicts.push(met("v2 done"))
    h.summaries.push("s2")
    h.nextGoals.push("v3 condition")
    await h.turn(1)
    expect(h.controller.get(SID)!.loopCompact!.landedAt).toBeUndefined()
    expect(h.controller.get(SID)!.loopCompact!.misses).toBe(1)
    expect(h.notices.some((n) => n.kind === "compact" && n.level === "success")).toBe(false)
  })

  test("(iii) estimateContext === undefined never lands by silence and never reaches the 4-miss terminal state", async () => {
    const hu = harness({ maxLoops: 50 })
    await hu.setLoop("objective")
    let n = 0
    hu.setContextSize(undefined)
    for (let i = 0; i < 8; i++) {
      hu.verdicts.push(met("step done"))
      hu.summaries.push("s")
      hu.nextGoals.push(`iter-${++n}`)
      await hu.turn(1)
      const pending = hu.controller.get(SID)!.loopCompact!
      expect(pending.landedAt).toBeUndefined() // never a landing-by-silence
      expect(pending.misses).toBe(0) // never counted as a miss, at any point
    }
    // And the loop is still active with no terminal suspension.
    expect(hu.controller.get(SID)?.status).toBe("active")
  })

  test("(iv) an ended-compaction event mid-turn logs the landing and arms the re-anchor inject (never a transcript message)", async () => {
    await h.setLoop("objective")
    h.verdicts.push(met("v1 done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    h.setContextSize(undefined) // size unknown — the event alone must be able to land it
    await h.controller.onCompactionLanded(SID)
    expect(h.logs.some((l) => l.level === "info" && /compaction landed/i.test(l.message))).toBe(true)
    expect(h.calls.synthetic.filter((s) => String(s.description).includes("re-anchor"))).toHaveLength(0)
    expect(h.controller.consumeAnchor(SID)).toBeDefined()
    expect(h.controller.get(SID)!.loopCompact!.landedAt).toBeNumber()
  })

  test("(v) restore() with a plain (non-loop) record arms no loopCompact", async () => {
    await h.setGoal("all tests pass")
    await h.controller.dispose()
    const h2 = harness({}, h.storage)
    const restored = await h2.controller.restore() // adopt-only: a restore compacts nothing
    expect(restored).toBe(1)
    expect(h2.compactCalls).toHaveLength(0)
    expect(h2.controller.get(SID)!.loopCompact).toBeUndefined()
  })

  test("(vii) a zero-tool-call producing-condition turn is rejected as not_met with the named reason", async () => {
    await h.setLoop("add a failing test for the parser")
    h.verdicts.push(met("parser work is done")) // evaluator over-claims; zero tool calls this turn
    await h.turn(0)
    const record = h.controller.get(SID)!
    expect(record.verdict).toBe("not_met")
    expect(record.reason).toContain("no evidence of work toward the condition, only state inspection")
    expect(record.condition).toBe("add a failing test for the parser") // the loop did not advance
    expect(record.loopIteration).toBe(1)
  })

  test("(vii-b) the already-satisfied-at-HEAD met is exempt from the zero-tool rejection", async () => {
    await h.setLoop("add a failing test for the parser")
    h.verdicts.push(met("Already satisfied at HEAD deadbee. No new work is produced by this iteration."))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(0) // zero tool calls, but the met is the already-satisfied landing
    const record = h.controller.get(SID)!
    expect(record.loopIteration).toBe(2) // the loop advanced
    expect(record.condition).toBe("v2 condition")
  })
})

describe("per-iteration spend attribution", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  test("an entry is stamped with the usage delta against its arm", async () => {
    await h.setLoop("improve the parser")
    h.setUsage({ cost: 5, input: 500, output: 50, reasoning: 1, cacheRead: 40, cacheWrite: 2 })
    h.verdicts.push(met("parser done"), met("fuzz done"))
    h.summaries.push("parser rewritten", "fuzz done")
    h.nextGoals.push("add fuzz coverage", "add property tests")
    await h.turn(3)
    // First advance: delta from the arm-time cumulative {cost: 1, input: 100, output: 10}
    const record1 = h.controller.get(SID)!
    expect(record1.loopHistory).toHaveLength(1)
    expect(record1.loopHistory![0]!.spend).toEqual({ cost: 4, input: 400, output: 40, reasoning: 1, cacheRead: 40, cacheWrite: 2 })
    // Second iteration measures from the first advance, not from the goal arm
    h.setUsage({ cost: 9, input: 900, output: 90, reasoning: 1, cacheRead: 40, cacheWrite: 2 })
    await h.turn(2)
    const record2 = h.controller.get(SID)!
    expect(record2.loopHistory![1]!.spend).toEqual({ cost: 4, input: 400, output: 40, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
  })

  test("an entry records no spend when the host cannot measure usage at the advance", async () => {
    await h.setLoop("improve the parser")
    h.setUsage(undefined)
    h.verdicts.push(met("done"))
    h.summaries.push("work")
    h.nextGoals.push("next steps")
    await h.turn()
    const record = h.controller.get(SID)!
    expect(record.loopHistory![0]!.spend).toBeUndefined()
  })
})

describe("compaction-landed write-after-delete regression", () => {
  test("a landed compaction cannot resurrect a record deleted mid-flight", async () => {
    const h = harness()
    await h.setLoop("improve the parser")
    h.verdicts.push(met("parser done"))
    h.summaries.push("s1")
    h.nextGoals.push("v2 condition")
    await h.turn(1)
    // Boundary compaction is pending on the record. Gate the next storage write so the
    // session can be deleted while onCompactionLanded's commit is parked in flight.
    let release: (() => void) | undefined
    const originalSet = h.storage.set
    h.storage.set = async (key: string, value: unknown) => {
      if (release === undefined)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      return originalSet(key, value)
    }
    const landing = h.controller.onCompactionLanded(SID)
    await flush()
    h.controller.onSessionDeleted(SID)
    release!()
    await landing
    await flush()
    expect(h.storage.data.has(`goal/v1/${SID}`)).toBe(false)
  })
})

describe("arming-side no-new-gap gate (XLV)", () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  /** Run one loop to LOOP_COMPLETE and leave its terminal record with a persisted ledger behind. */
  const completeLoop = async (h: ReturnType<typeof harness>, objective: string) => {
    await h.setLoop(objective)
    h.verdicts.push(met("done"))
    h.summaries.push("work done")
    h.nextGoals.push("LOOP_COMPLETE")
    await h.turn()
    expect(h.controller.get(SID)!.status).toBe("achieved")
  }

  test("a re-issued objective is refused at the initial arm: terminal record, explicit no-new-gap reason, notice, no kickoff prompt", async () => {
    await completeLoop(h, "improve the parser")
    const promptsBefore = h.calls.prompts.length
    const noticesBefore = h.notices.length
    await h.setLoop("improve the parser")
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toContain("no new gap")
    expect(record.reason).toContain("improve the parser")
    // The harness measured the refusal: an armed loop would have loopIteration 1 with an empty history.
    expect(record.loopNotProgress).toBe(1)
    expect(record.loopHistory).toHaveLength(0)
    // The kickoff prompt must NOT be sent — arming was refused.
    expect(h.calls.prompts.length).toBe(promptsBefore)
    // The user is told, on the loop channel, with the same reason.
    const refusal = h.notices.slice(noticesBefore).find((n) => n.kind === "loop")
    expect(refusal?.level).toBe("warning")
    expect(refusal?.title).toBe("Loop not armed: no new gap")
    // The dossier can still see why: the record is terminal and carries the ledger.
    expect(record.completedConditions).toContain("improve the parser")
  })

  test("normalization-insensitive exact repeat is refused (case and punctuation)", async () => {
    await completeLoop(h, "improve the parser")
    await h.setLoop("Improve the PARSER!")
    expect(h.controller.get(SID)!.status).toBe("achieved")
    expect(h.controller.get(SID)!.reason).toContain("no new gap")
  })

  test("a containment >= 0.7 near-duplicate is refused at the initial arm", async () => {
    await completeLoop(h, "improve the parser")
    await h.setLoop("improve the parser and do it again")
    expect(h.controller.get(SID)!.status).toBe("achieved")
    expect(h.controller.get(SID)!.reason).toContain("no new gap")
  })

  test("a genuinely new objective arms normally after a completed loop", async () => {
    await completeLoop(h, "improve the parser")
    const promptsBefore = h.calls.prompts.length
    await h.setLoop("add fuzz coverage for the search index")
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.loopIteration).toBe(1)
    expect(h.calls.prompts.length).toBe(promptsBefore + 1)
  })

  test("the gate is loop-only: a plain /goal with the same completed objective still arms", async () => {
    await completeLoop(h, "improve the parser")
    await h.setGoal("improve the parser")
    expect(h.controller.get(SID)!.status).toBe("active")
    expect(h.controller.get(SID)!.loopEnabled).toBeUndefined()
  })

  test("the refusal persists; the ledger survives storage", async () => {
    await completeLoop(h, "improve the parser")
    await h.setLoop("improve the parser")
    const persisted = h.storage.data.get("goal/v1/ses_1") as { status: string; reason?: string; completedConditions?: string[] } | undefined
    expect(persisted?.status).toBe("achieved")
    expect(persisted?.reason).toContain("no new gap")
    expect(persisted?.completedConditions).toContain("improve the parser")
  })

  test("cross-restart: a fresh controller's arm reads the durable ledger and refuses", async () => {
    const storage = new MemoryStorage()
    const h1 = harness({}, storage)
    await h1.setLoop("improve the parser")
    h1.verdicts.push(met("done"))
    h1.summaries.push("work done")
    h1.nextGoals.push("LOOP_COMPLETE")
    await h1.turn()
    const h2 = harness({}, storage)
    expect(await h2.controller.restore()).toBe(0) // a terminal record is not adopted as a goal
    const promptsBefore = h2.calls.prompts.length
    await h2.setLoop("improve the parser")
    const record = h2.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.reason).toContain("no new gap")
    expect(record.completedConditions).toContain("improve the parser")
    expect(h2.calls.prompts.length).toBe(promptsBefore)
  })

  test("after a refusal, a genuinely new objective still arms (the refusal does not wedge the session)", async () => {
    await completeLoop(h, "improve the parser")
    await h.setLoop("improve the parser")
    expect(h.controller.get(SID)!.status).toBe("achieved")
    await h.setLoop("tidy the changelog generator")
    expect(h.controller.get(SID)!.status).toBe("active")
  })
})
