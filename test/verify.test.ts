import { describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/core/config.ts"
import type { CommitPolicy, Notice, UsageSnapshot } from "../src/core/types.ts"
import { GoalController } from "../src/runtime/controller.ts"
import type { BackgroundWork, Clock, EvaluationResult, StoragePort, VerifyRequest, VerifyResult } from "../src/runtime/ports.ts"
import { GoalStore } from "../src/runtime/store.ts"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

function harness(
  options: Record<string, unknown>,
  {
    withVerifier = true,
    directory = DIR,
    contextMessages,
  }: { withVerifier?: boolean; directory?: string; contextMessages?: readonly unknown[] } = {},
): Harness & { clock: FakeClock } {
  const clock = new FakeClock()
  const calls = { prompts: [] as any[], synthetic: [] as Array<{ text: string; description: string }> }
  const verdicts: EvaluationResult[] = []
  const notices: Notice[] = []
  const verifyCalls: VerifyRequest[] = []
  const verifyResults: Array<VerifyResult | Error> = []
  const commit: CommitPolicy = { required: false, branch: "dev", reason: "test" }
  const deps: ConstructorParameters<typeof GoalController>[0] = {
    config: resolveConfig({ learning: { enabled: false }, ...options }),
    directory,
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
    context: async () => contextMessages ?? [],
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
    clock,
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
    expect(record.reason).toMatch(/Verification/i)
    expect(record.reason).toContain("bun run check")
    expect(record.reason).toContain("1 fail")
    expect(record.reason).toContain("verify-command")
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
    expect(h.controller.get(SID)!.reason).toMatch(/no verifier port|fail closed/i)
    expect(h.controller.get(SID)!.reason).toContain("verify-command")
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
    const entry = record.history.at(-1)!
    expect(entry.verdict).toBe("met")
    expect(entry.verify).toEqual({ command: "bun run check", code: 0, tail: "42 pass\n0 fail" })
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
    const entry = record.history.at(-1)!
    expect(entry.verdict).toBe("not_met")
    expect(entry.verify).toEqual({ command: "bun run check", code: 1, tail: "1 fail\nerror: expected true" })
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
    const entry = record.history.at(-1)!
    expect(entry.verify).toEqual({ command: "bun run check", code: null, timedOut: true })
  })
})

describe("commit sha on ledger entries (the verdict lands on a commit the reader can inspect)", () => {
  const SHA = "a3f5c8e91d4b6f7061728394a5b6c7d8e9f0a1b2"
  const repoDir = (() => {
    const dir = mkdtempSync(join(tmpdir(), "goalv2-sha-repo-"))
    const gitDir = join(dir, ".git")
    mkdirSync(join(gitDir, "refs", "heads"), { recursive: true })
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(join(gitDir, "refs", "heads", "main"), SHA + "\n")
    return dir
  })()

  test("an evaluated turn stamps HEAD's sha on the per-verdict history entry", async () => {
    const h = harness({}, { directory: repoDir })
    await h.set()
    h.verdicts.push(met())
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.history.at(-1)!.sha).toBe(SHA)
  })

  test("outside a repository the sha is absent — never guessed, never fabricated", async () => {
    // A bare temp dir is outside any repository on every platform (the harness's C:/work/project
    // sentinel resolves inside this checkout on Linux and would trip findRepository's walk-up).
    const h = harness({}, { directory: mkdtempSync(join(tmpdir(), "goalv2-sha-nonrepo-")) })
    await h.set()
    h.verdicts.push(met())
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.history.at(-1)!.sha).toBeUndefined()
  })
})

describe("verification matrix (profile-aware checks)", () => {
test("matrix: all required checks pass records per-check evidence and accepts met", async () => {
  const h = harness({
    evaluator: {
      verifyChecks: [
        { id: "typecheck", type: "typecheck", command: "bunx tsc --noEmit" },
        { id: "tests", type: "tests", command: "bun test" },
      ],
    },
  })
  await h.set("fix the parser bug")
  h.verdicts.push(met("parser fixed"))
  h.verifyResults.push({ code: 0, output: "tsc ok", timedOut: false }, { code: 0, output: "12 pass", timedOut: false })
  await h.turn(1)
  const record = h.controller.get(SID)!
  expect(record.status).toBe("achieved")
  expect(h.verifyCalls.map((c) => c.command)).toEqual(["bunx tsc --noEmit", "bun test"])
  const v = record.history.at(-1)!.verification!
  expect(v.pass).toBe(true)
  expect(v.broadGoal).toBe(false)
  expect(v.checks.map((c) => [c.id, c.type, c.pass, c.code, c.source, c.executionMode])).toEqual([
    ["typecheck", "typecheck", true, 0, "configured", "command"],
    ["tests", "tests", true, 0, "configured", "command"],
  ])
  expect(v.timing).toBeDefined()
  expect(v.timing!.executed).toBe(2)
  expect(record.lastVerification?.pass).toBe(true)
  expect(record.lastVerification?.checks).toHaveLength(2)
})

test("matrix: a failing required check downgrades met to not_met with per-check evidence and next actions", async () => {
  const h = harness({
    evaluator: {
      verifyChecks: [
        { id: "typecheck", type: "typecheck", command: "bunx tsc --noEmit" },
        { id: "tests", type: "tests", command: "bun test targeted" },
      ],
    },
  })
  await h.set("fix the parser bug")
  h.verdicts.push(met())
  h.verifyResults.push({ code: 0, output: "tsc ok", timedOut: false }, { code: 1, output: "1 fail\nexpected 2", timedOut: false })
  await h.turn(1)
  const record = h.controller.get(SID)!
  expect(record.status).toBe("active")
  expect(record.verdict).toBe("not_met")
  expect(record.reason).toContain("tests")
  expect(record.reason).toContain("targeted")
  expect(record.reason).toContain("next:")
  const v = record.history.at(-1)!.verification!
  expect(v.pass).toBe(false)
  expect(v.missing).toEqual(["tests"])
  expect(v.checks[0]!.pass).toBe(true)
  expect(v.checks[1]!.pass).toBe(false)
  expect(v.checks[1]!.tail).toContain("1 fail")
  expect(v.checks[1]!.scopeDecision).toBe("executed but not satisfied")
  expect(v.checks[1]!.nextAction).toBe(
    'Satisfy required verification check tests (tests) with a fresh scoped command: run "bun test targeted" at current HEAD and fix failures until exit 0.',
  )
  expect(record.lastVerification?.missing).toEqual(["tests"])
})

test("matrix: timeout/error in a required check is recorded and downgrades met", async () => {
  const h = harness({ evaluator: { verifyChecks: [{ id: "lint", type: "lint", command: "bun run lint", timeoutMs: 5000 }] } })
  await h.set("cleanup lint")
  h.verdicts.push(met())
  h.verifyResults.push({ code: null, output: "partial", timedOut: true })
  await h.turn(1)
  const record = h.controller.get(SID)!
  expect(record.verdict).toBe("not_met")
  const check = record.history.at(-1)!.verification!.checks[0]!
  expect(check.timedOut).toBe(true)
  expect(check.pass).toBe(false)
  expect(check.reason).toMatch(/timed out/i)
})

test("matrix: broad goal with only generic legacy check is treated as unscoped required verification (deterministic coverage, rubric-independent)", async () => {
  const h = harness({ evaluator: { verifyCommand: "bun run check" } })
  await h.set("improve the entire verification matrix across the codebase and complete the backlog item")
  h.verdicts.push(met())
  h.verifyResults.push({ code: 0, output: "all green", timedOut: false })
  await h.turn(1)
  const record = h.controller.get(SID)!
  expect(record.status).toBe("active")
  expect(record.verdict).toBe("not_met")
  expect(record.reason).toMatch(/coverage not satisfied|unscoped|generic-only/i)
  expect(record.reason).toMatch(/typecheck|targeted tests|goal-declared/i)
  expect(record.reason).toContain("next:")
  expect(record.reason).toMatch(/deterministic|rubric-independent/i)
  expect(h.verifyCalls).toHaveLength(0) // unscoped detected before running generic-only check
  const v = record.history.at(-1)!.verification!
  expect(v.broadGoal).toBe(true)
  expect(v.pass).toBe(false)
  expect(v.missing).toContain("verify-command")
  expect(v.checks[0]!.scoped).toBe(false)
  expect(v.checks[0]!.source).toBe("legacy")
})

test("matrix: broad profile with typed scoped checks can pass", async () => {
  const h = harness({
    evaluator: {
      verifyProfile: "broad",
      verifyChecks: [
        { id: "typecheck", type: "typecheck", command: "bunx tsc --noEmit" },
        { id: "tests", type: "tests", command: "bun test targeted" },
        { id: "build", type: "build", command: "bun run compile" },
      ],
    },
  })
  await h.set("improve the entire verification matrix across the codebase")
  h.verdicts.push(met())
  h.verifyResults.push(
    { code: 0, output: "ok", timedOut: false },
    { code: 0, output: "ok", timedOut: false },
    { code: 0, output: "ok", timedOut: false },
  )
  await h.turn(1)
  const record = h.controller.get(SID)!
  expect(record.status).toBe("achieved")
  expect(record.history.at(-1)!.verification!.broadGoal).toBe(true)
  expect(record.history.at(-1)!.verification!.pass).toBe(true)
})

test("config: verifyChecks and verifyProfile resolve; legacy verifyCommand synthesizes a check", () => {
  const c = resolveConfig({
    evaluator: {
      verifyCommand: "bun run check",
      verifyTimeoutMs: 30000,
      verifyProfile: "broad",
    },
  })
  expect(c.evaluator.verifyProfile).toBe("broad")
  expect(c.evaluator.verifyChecks).toEqual([
    { id: "verify-command", type: "custom", command: "bun run check", timeoutMs: 30000, required: true, when: "always", label: "verifyCommand", evidence: "command" },
  ])
  const explicit = resolveConfig({
    evaluator: {
      verifyChecks: [
        { id: "lint", type: "lint", command: "bun run lint", required: false, when: "broad", label: "Lint" },
      ],
    },
  })
  expect(explicit.evaluator.verifyChecks[0]).toMatchObject({ id: "lint", type: "lint", command: "bun run lint", required: false, when: "broad", label: "Lint" })
})


  test("goal-declared checks from NL condition are parsed/merged, executed as typed command checks, and malformed directives are flagged but never executed", async () => {
    const condition = [
      "fix parser bug and keep checks green",
      'verify: type=typecheck cmd="bunx tsc --noEmit" id=tc',
      'verify: type=tests cmd="bun test parser.test.ts" id=tests',
      'verify: type=lint cmd="bun run lint" id=lint-ok',
      'verify: type=bogus cmd="echo hi" id=bad',
      'verify: type=build cmd=unquoted id=bad2',
    ].join("\n")
    const h = harness({}, { withVerifier: true })
    await h.set(condition)
    h.verdicts.push(met())
    h.verifyResults.push({ code: 0, output: "tsc ok", timedOut: false }, { code: 0, output: "1 pass", timedOut: false }, { code: 0, output: "lint ok", timedOut: false })
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    const v = record.history.at(-1)!.verification!
    expect(v.malformedGoalChecks?.length).toBeGreaterThanOrEqual(2)
    expect(v.malformedGoalChecks?.every((m) => m.reason.length > 0)).toBe(true)
    expect(v.checks.some((c) => c.id === "tc" && c.source === "goal-declared" && c.type === "typecheck" && c.pass)).toBe(true)
    expect(v.checks.some((c) => c.id === "tests" && c.source === "goal-declared" && c.type === "tests" && c.pass)).toBe(true)
    expect(v.checks.some((c) => c.id === "lint-ok" && c.source === "goal-declared" && c.type === "lint" && c.pass)).toBe(true)
    expect(h.verifyCalls.map((c) => c.command)).toEqual(expect.arrayContaining(["bunx tsc --noEmit", "bun test parser.test.ts", "bun run lint"]))
    expect(h.verifyCalls.some((c) => c.command === "echo hi" || c.command === "unquoted")).toBe(false)
  })

  test("deterministic broad-goal rejection without rubric dependence: evaluator met is downgraded when required scoped coverage missing", async () => {
    const condition = [
      "improve verification across the entire repository and complete the backlog item",
      'verify: type=custom cmd="echo ok" id=generic',
    ].join("\n")
    const h = harness({}, { withVerifier: true })
    await h.set(condition)
    h.verdicts.push(met("rubric says looks good"))
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.verdict).toBe("not_met")
    expect(record.reason).toMatch(/coverage not satisfied|generic-only|unscoped|typed coverage/i)
    expect(record.reason).toMatch(/deterministic|rubric-independent/i)
    expect(h.verifyCalls).toHaveLength(0)
  })

  test("artifact evidence mode: satisfied by fresh scoped transcript patterns without command execution (evidence=artifact)", async () => {
    const condition = [
      "fix lint warnings",
      'verify: type=lint cmd="bun run lint" id=lint evidence=artifact artifacts="lint ok||0 problems"',
    ].join("\n")
    const h = harness({}, { contextMessages: [{ type: "assistant", content: [{ type: "text", text: "Ran lint: lint ok\n0 problems found" }] }] as any })
    await h.set(condition)
    h.verdicts.push(met())
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(h.verifyCalls).toHaveLength(0)
    const check = record.history.at(-1)!.verification!.checks.find((c) => c.id === "lint")!
    expect(check.pass).toBe(true)
    expect(check.executionMode).toBe("artifact")
    expect(check.runState).toBe("artifact")
    expect(check.artifactMatched).toEqual(["lint ok", "0 problems"])
    expect(check.code).toBeNull()
  })

  test("artifact evidence mode: missing patterns fails with concrete next action and no silent fallback to narration/command", async () => {
    const condition = [
      "fix lint warnings",
      'verify: type=lint cmd="bun run lint" id=lint evidence=artifact artifacts="lint ok||0 problems"',
    ].join("\n")
    const h = harness({}, { contextMessages: [{ type: "assistant", content: [{ type: "text", text: "I think lint is fine now, trust me." }] }] as any })
    await h.set(condition)
    h.verdicts.push(met())
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("active")
    expect(record.verdict).toBe("not_met")
    expect(h.verifyCalls).toHaveLength(0)
    const check = record.history.at(-1)!.verification!.checks.find((c) => c.id === "lint")!
    expect(check.pass).toBe(false)
    expect(check.executionMode).toBe("artifact")
    expect(check.artifactMissing?.length).toBeGreaterThan(0)
    expect(check.nextAction).toMatch(/fresh scoped transcript|artifact/i)
  })

  test("evidence=either uses fresh artifact evidence when present, otherwise falls back to command execution", async () => {
    const condition = [
      "fix type errors",
      'verify: type=typecheck cmd="bunx tsc --noEmit" id=tc evidence=either artifacts="Found 0 errors"',
    ].join("\n")
    const h1 = harness({}, { contextMessages: [{ type: "assistant", content: [{ type: "text", text: "Typecheck output: Found 0 errors" }] }] as any })
    await h1.set(condition)
    h1.verdicts.push(met())
    await h1.turn(1)
    expect(h1.controller.get(SID)!.status).toBe("achieved")
    expect(h1.verifyCalls).toHaveLength(0)
    expect(h1.controller.get(SID)!.history.at(-1)!.verification!.checks[0]!.executionMode).toBe("artifact")

    const h2 = harness({}, { contextMessages: [{ type: "assistant", content: [{ type: "text", text: "still working" }] }] as any })
    await h2.set(condition)
    h2.verdicts.push(met())
    h2.verifyResults.push({ code: 0, output: "tsc clean", timedOut: false })
    await h2.turn(1)
    expect(h2.controller.get(SID)!.status).toBe("achieved")
    expect(h2.verifyCalls.map((c) => c.command)).toEqual(["bunx tsc --noEmit"])
    expect(h2.controller.get(SID)!.history.at(-1)!.verification!.checks[0]!.executionMode).toBe("command")
  })

  test("command-check reuse/caching: identical fresh command results are reused within same evaluated turn/HEAD and recorded", async () => {
    const h = harness({ evaluator: { verifyChecks: [
      { id: "t1", type: "tests", command: "bun test same" },
      { id: "t2", type: "tests", command: "bun test same" },
    ], verifyConcurrency: 1 } })
    await h.set("fix parser")
    h.verdicts.push(met())
    h.verifyResults.push({ code: 0, output: "same pass", timedOut: false })
    await h.turn(1)
    const record = h.controller.get(SID)!
    expect(record.status).toBe("achieved")
    expect(h.verifyCalls).toHaveLength(1)
    const v = record.history.at(-1)!.verification!
    expect(v.checks).toHaveLength(2)
    expect(v.checks.every((c) => c.pass)).toBe(true)
    const reused = v.checks.filter((c) => c.reused)
    expect(reused.length).toBe(1)
    expect(reused[0]!.executionMode).toMatch(/reused-command/)
    expect(reused[0]!.durationMs).toBe(0)
    expect(v.timing!.reused).toBe(1)
  })

  test("parallel execution runs independent command checks concurrently within cap and records timing/parallel metadata", async () => {
    const clock = new FakeClock()
    let active = 0
    let maxActive = 0
    let started = 0
    const resolvers: Array<(v: any) => void> = []
    const commit: CommitPolicy = { required: false, branch: "dev", reason: "test" }
    const controller = new GoalController({
      config: resolveConfig({ evaluator: { verifyChecks: [
        { id: "a", type: "typecheck", command: "cmd-a" },
        { id: "b", type: "tests", command: "cmd-b" },
        { id: "c", type: "lint", command: "cmd-c" },
      ], verifyConcurrency: 2 } }),
      directory: DIR,
      commit,
      clock,
      log: silentLog,
      newId: () => "goal_p",
      store: new GoalStore(new MemoryStorage(), () => {}),
      session: {
        prompt: async () => {},
        synthetic: async () => {},
        usage: async () => ({ cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
        compact: async () => {},
      },
      evaluator: {
        evaluate: async () => ({ verdict: "met", reason: "done" }),
      },
      background: { busy: async () => ({ subagents: 0, shells: 0 }) },
      emitter: { changed: () => {}, notice: () => {} },
      verifier: {
        verify: async () => {
          active++
          started++
          maxActive = Math.max(maxActive, active)
          return await new Promise((resolve) => resolvers.push((v) => { active--; resolve(v) }))
        },
      },
    })
    await controller.command({ sessionID: SID, text: "fix stuff", delivery: "steer" })
    controller.onExecutionStarted(SID)
    controller.onToolCalled(SID)
    const done = controller.onExecutionSucceeded(SID)
    for (let i = 0; i < 50 && started < 2; i++) await Promise.resolve()
    expect(started).toBe(2)
    expect(maxActive).toBe(2)
    resolvers.shift()!({ code: 0, output: "ok-a", timedOut: false })
    for (let i = 0; i < 50 && started < 3; i++) await Promise.resolve()
    expect(started).toBe(3)
    resolvers.shift()!({ code: 0, output: "ok-b", timedOut: false })
    resolvers.shift()!({ code: 0, output: "ok-c", timedOut: false })
    await done
    await flush()
    const record = controller.get(SID)!
    expect(record.status).toBe("achieved")
    const v = record.history.at(-1)!.verification!
    expect(v.timing!.parallel).toBe(true)
    expect(v.timing!.concurrency).toBe(2)
    expect(v.timing!.executed).toBe(3)
    expect(v.checks.filter((c) => c.executionMode === "command").every((c) => c.parallel)).toBe(true)
  })
})
