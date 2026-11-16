import { describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/core/config.ts"
import type { CommitPolicy, Notice, UsageSnapshot } from "../src/core/types.ts"
import { GoalController } from "../src/runtime/controller.ts"
import type { BackgroundWork, Clock, EvaluationResult, StoragePort, VerifyRequest, VerifyResult } from "../src/runtime/ports.ts"
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

interface Harness {
  controller: GoalController
  calls: { prompts: unknown[]; synthetic: Array<{ text: string; description: string }> }
  notices: Notice[]
  verdicts: EvaluationResult[]
  verifyCalls: VerifyRequest[]
  verifyResults: Array<VerifyResult | Error>
  turn: (tools?: number) => Promise<void>
  set: (condition?: string) => Promise<void>
}

function harness(options: Record<string, unknown>, { withVerifier = true }: { withVerifier?: boolean } = {}): Harness {
  const clock = new FakeClock()
  const calls = { prompts: [] as any[], synthetic: [] as Array<{ text: string; description: string }> }
  const verdicts: EvaluationResult[] = []
  const notices: Notice[] = []
  const verifyCalls: VerifyRequest[] = []
  const verifyResults: Array<VerifyResult | Error> = []
  const commit: CommitPolicy = { required: false, branch: "dev", reason: "test" }
  const deps: ConstructorParameters<typeof GoalController>[0] = {
    config: resolveConfig(options),
    directory: DIR,
    commit,
    clock,
    log: silentLog,
    newId: (() => {
      let n = 0
      return () => `goal_${++n}`
    })(),
    store: new GoalStore(new MemoryStorage(), () => {}),
    session: {
      prompt: async (input: any) => void calls.prompts.push(input),
      synthetic: async (input: any) => void calls.synthetic.push(input),
      usage: async (): Promise<UsageSnapshot | undefined> => ({ cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
      compact: async () => {},
    },
    evaluator: {
      evaluate: async () => {
        const next = verdicts.shift()
        if (!next) throw new Error("no verdict queued")
        return next
      },
      summarize: async () => "summary",
      nextGoal: async () => "LOOP_COMPLETE",
    },
    background: { busy: async (): Promise<BackgroundWork> => ({ subagents: 0, shells: 0 }) },
    emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
    ...(withVerifier
      ? {
          verifier: {
            verify: async (request: VerifyRequest): Promise<VerifyResult> => {
              verifyCalls.push(request)
              const next = verifyResults.shift()
              if (next === undefined) return { code: 0, output: "ok", timedOut: false }
              if (next instanceof Error) throw next
              return next
            },
          },
        }
      : {}),
  }
  const controller = new GoalController(deps)
  const turn = async (tools = 1) => {
    controller.onExecutionStarted(SID)
    for (let i = 0; i < tools; i++) controller.onToolCalled(SID)
    await controller.onExecutionSucceeded(SID)
    await flush()
  }
  return {
    controller,
    calls,
    notices,
    verdicts,
    verifyCalls,
    verifyResults,
    turn,
    set: (condition = "all tests pass") => controller.command({ sessionID: SID, text: condition, delivery: "steer" }),
  }
}

const met = (reason = "done"): EvaluationResult => ({ verdict: "met", reason })
const pass: VerifyResult = { code: 0, output: "42 pass\n0 fail", timedOut: false }
const fail: VerifyResult = { code: 1, output: "1 fail\nerror: expected true", timedOut: false }

describe("verification gate (verifier, not transcriber)", () => {
  test("met verdict is accepted when the verification command exits 0", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check" } })
    await h.set()
    h.verdicts.push(met())
    h.verifyResults.push(pass)
    await h.turn(3)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(h.verifyCalls).toHaveLength(1)
    expect(h.verifyCalls[0]!.command).toBe("bun run check")
    expect(h.verifyCalls[0]!.cwd).toBe(DIR)
  })

  test("met verdict is downgraded to not_met when the verification command fails; the output tail rides the reason", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check" } })
    await h.set()
    h.verdicts.push(met())
    h.verifyResults.push(fail)
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.verdict).toBe("not_met")
    expect(record.reason).toContain("Verification")
    expect(record.reason).toContain("bun run check")
    expect(record.reason).toContain("1 fail")
    // The failure is pushed into the transcript as a continuation, so the agent sees what to fix.
    expect(h.calls.synthetic.some((s) => s.text.includes("1 fail"))).toBe(true)
    expect(h.notices.some((n) => n.title === "Verification failed")).toBe(true)
  })

  test("a verification timeout is a failure, not a pass", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check", verifyTimeoutMs: 5_000 } })
    await h.set()
    h.verdicts.push(met())
    h.verifyResults.push({ code: null, output: "", timedOut: true })
    await h.turn(1)
    expect(h.controller.get(SID)!.status).toBe("active")
    expect(h.controller.get(SID)!.verdict).toBe("not_met")
    expect(h.controller.get(SID)!.reason).toMatch(/timed out/i)
  })

  test("a verifier error is a failure, not a pass", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check" } })
    await h.set()
    h.verdicts.push(met())
    h.verifyResults.push(new Error("spawn blew up"))
    await h.turn(1)
    expect(h.controller.get(SID)!.status).toBe("active")
    expect(h.controller.get(SID)!.verdict).toBe("not_met")
    expect(h.controller.get(SID)!.reason).toContain("spawn blew up")
  })

  test("fail closed: a verifyCommand with no verifier wired is not_met, never met", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check" } }, { withVerifier: false })
    await h.set()
    h.verdicts.push(met())
    await h.turn(1)
    expect(h.controller.get(SID)!.status).toBe("active")
    expect(h.controller.get(SID)!.verdict).toBe("not_met")
    expect(h.controller.get(SID)!.reason).toMatch(/no verifier port/i)
  })

  test("backward compatible: no verifyCommand configured, verifier never called, met accepted as before", async () => {
    const h = harness({})
    await h.set()
    h.verdicts.push(met())
    await h.turn(1)
    expect(h.controller.get(SID)!.status).toBe("achieved")
    expect(h.verifyCalls).toHaveLength(0)
  })

  test("a failing verification on a loop goal blocks the advance: no summary, no next iteration", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check" } })
    await h.set("improve the docs")
    // arm a loop by setting loop via command
    // /goal-loop with a loop-enabled record: use command with loop: true
    // (the harness set() helper uses /goal; use controller.command directly)
    // NB: set() above already created a non-loop goal; create the loop goal instead.
    h.controller.clear(SID)
    await h.controller.command({ sessionID: SID, text: "improve the docs", delivery: "steer", loop: true })
    h.verdicts.push(met())
    h.verifyResults.push(fail)
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.loopIteration).toBe(1)
    expect(record.status).toBe("active")
    expect(record.verdict).toBe("not_met")
  })
})

describe("verification gate config", () => {
  test("defaults: no verifyCommand, timeout 600_000", () => {
    const config = resolveConfig({})
    expect(config.evaluator.verifyCommand).toBe("")
    expect(config.evaluator.verifyTimeoutMs).toBe(600_000)
  })

  test("plugin options are honored", () => {
    const config = resolveConfig({ evaluator: { verifyCommand: "bun run check", verifyTimeoutMs: 30_000 } })
    expect(config.evaluator.verifyCommand).toBe("bun run check")
    expect(config.evaluator.verifyTimeoutMs).toBe(30_000)
  })

  test("env overrides plugin options", () => {
    const config = resolveConfig(
      { evaluator: { verifyCommand: "from-options", verifyTimeoutMs: 30_000 } },
      { OPENCODE_GOAL_VERIFY_COMMAND: "from-env", OPENCODE_GOAL_VERIFY_TIMEOUT_MS: "120000" },
    )
    expect(config.evaluator.verifyCommand).toBe("from-env")
    expect(config.evaluator.verifyTimeoutMs).toBe(120_000)
  })

  test("whitespace-only verifyCommand is treated as disabled", () => {
    const config = resolveConfig({ evaluator: { verifyCommand: "   " } })
    expect(config.evaluator.verifyCommand).toBe("")
  })
})

describe("verification tail on the record (dashboard evidence)", () => {
  test("a passing gate persists the exit code and the stripped tail on the record", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check" } })
    await h.set()
    h.verdicts.push(met())
    h.verifyResults.push({ code: 0, output: "\u001b[32m42 pass\u001b[0m\n0 fail", timedOut: false })
    await h.turn(3)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(record.lastVerify).toBeDefined()
    expect(record.lastVerify!.command).toBe("bun run check")
    expect(record.lastVerify!.code).toBe(0)
    expect(record.lastVerify!.tail).toBe("42 pass\n0 fail")
    expect(record.lastVerify!.tail).not.toContain("\u001b")
    expect(typeof record.lastVerify!.at).toBe("number")
  })

  test("a failing gate persists the stripped tail and exit code; the reason contract is unchanged", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check" } })
    await h.set()
    h.verdicts.push(met())
    h.verifyResults.push({ code: 1, output: "\u001b[31m1 fail\u001b[0m\nerror: expected true", timedOut: false })
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.verdict).toBe("not_met")
    expect(record.lastVerify!.code).toBe(1)
    expect(record.lastVerify!.tail).toBe("1 fail\nerror: expected true")
    expect(record.reason).toContain("1 fail")
  })

  test("a timeout persists timedOut with a null exit code and no tail", async () => {
    const h = harness({ evaluator: { verifyCommand: "bun run check", verifyTimeoutMs: 5_000 } })
    await h.set()
    h.verdicts.push(met())
    h.verifyResults.push({ code: null, output: "", timedOut: true })
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.lastVerify!.timedOut).toBe(true)
    expect(record.lastVerify!.code).toBeNull()
    expect(record.lastVerify!.tail).toBeUndefined()
  })
})
