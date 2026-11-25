import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveConfig } from "../src/core/config.ts"
import { appendLearningEntry, buildGoalTerminalLearningEntry, buildLoopIterationLearningEntry, buildSessionOutcomeLearningEntry, formatRecentLearnings, readLearningEntriesTail, readRecentLearnings, serializeLearningEntry } from "../src/core/learning-log.ts"
import type { GoalRecord, LoopEntry, UsageSnapshot } from "../src/core/types.ts"
import { GoalController } from "../src/runtime/controller.ts"
import type { BackgroundWork, Clock, EvaluationRequest, EvaluationResult, StoragePort } from "../src/runtime/ports.ts"
import { GoalStore } from "../src/runtime/store.ts"

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

class FakeClock implements Clock {
  t = 1_700_000_000_000
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

const baseRecord = (overrides: Partial<GoalRecord> = {}): GoalRecord => ({
  version: 1,
  id: "goal_test",
  sessionID: "ses_test",
  directory: "/tmp/project",
  condition: "all tests pass",
  status: "achieved",
  setAt: 1_700_000_000_000,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_030_000,
  turns: 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [],
  ...overrides,
})

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe("learning-log core", () => {
  test("buildGoalTerminalLearningEntry captures outcome and lesson for achieved goals", () => {
    const record = baseRecord({
      status: "achieved",
      reason: "bun run check passed",
      history: [{ turn: 2, verdict: "met", reason: "ok", at: 1_700_000_030_000, sha: "abc1234" }],
      final: { cost: 3, input: 300, output: 30, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    })
    const entry = buildGoalTerminalLearningEntry(record, 1_700_000_030_100)
    expect(entry.kind).toBe("goal_terminal")
    expect(entry.status).toBe("achieved")
    expect(entry.sessionID).toBe("ses_test")
    expect(entry.goalID).toBe("goal_test")
    expect(entry.condition).toBe("all tests pass")
    expect(entry.reason).toBe("bun run check passed")
    expect(entry.turns).toBe(2)
    expect(entry.elapsedMs).toBe(30_000)
    expect(entry.sha).toBe("abc1234")
    expect(entry.spend?.cost).toBe(3)
    expect(entry.lesson).toContain("Achieved")
    expect(entry.lesson).toContain("bun run check passed")
  })

  test("buildGoalTerminalLearningEntry records the terminal sha regardless of lastVerify state", () => {
    const history = [{ turn: 2, verdict: "met" as const, reason: "ok", at: 1_700_000_030_000, sha: "abc1234" }]
    const withFailingVerify = buildGoalTerminalLearningEntry(
      baseRecord({
        status: "achieved",
        history,
        lastVerify: { command: "bun run check", code: 1, at: 1_700_000_030_050 },
      }),
      1_700_000_030_100,
    )
    const withoutVerify = buildGoalTerminalLearningEntry(baseRecord({ status: "achieved", history }), 1_700_000_030_100)
    expect(withFailingVerify.sha).toBe("abc1234")
    expect(withoutVerify.sha).toBe("abc1234")
  })

  test("buildGoalTerminalLearningEntry derives lessons for non-achieved outcomes without fabricating evidence", () => {
    const impossible = buildGoalTerminalLearningEntry(baseRecord({ status: "impossible", reason: "missing API key" }))
    expect(impossible.lesson).toContain("Judged impossible")
    expect(impossible.lesson).toContain("missing API key")

    const cleared = buildGoalTerminalLearningEntry(baseRecord({ status: "cleared", reason: "Replaced by a new goal." }))
    expect(cleared.lesson).toContain("Cleared before completion")

    const failed = buildGoalTerminalLearningEntry(baseRecord({ status: "failed", reason: "Goal failed after an unrecoverable error: auth." }))
    expect(failed.lesson).toContain("Failed due to unrecoverable error")
  })

  test("buildLoopIterationLearningEntry captures iteration outcome and summary as learnable trace", () => {
    const record = baseRecord({
      status: "active",
      loopEnabled: true,
      loopObjective: "keep improving quality",
      condition: "fix flaky test",
      loopIteration: 2,
    })
    const loopEntry: LoopEntry = {
      version: 1,
      condition: "fix flaky test",
      summary: "Stabilized the timeout by awaiting flush. Key constraints: keep tests deterministic. What remains: audit other async tests.",
      reason: "targeted test now passes consistently",
      turns: 3,
      toolCalls: 7,
      endedAt: 1_700_000_020_000,
      sha: "def5678",
      spend: { cost: 0.5, input: 50, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    }
    const entry = buildLoopIterationLearningEntry(record, loopEntry, 1_700_000_020_100)
    expect(entry.kind).toBe("loop_iteration")
    expect(entry.iteration).toBe(1)
    expect(entry.objective).toBe("keep improving quality")
    expect(entry.condition).toBe("fix flaky test")
    expect(entry.summary).toContain("Stabilized the timeout")
    expect(entry.reason).toContain("passes consistently")
    expect(entry.turns).toBe(3)
    expect(entry.toolCalls).toBe(7)
    expect(entry.sha).toBe("def5678")
    expect(entry.spend?.cost).toBe(0.5)
    expect(entry.lesson).toContain("Iteration v1 met")
    expect(entry.lesson).toContain("What happened")
    expect(entry.lesson).toContain("Improve next time")
  })

  test("buildTurnVerdictLearningEntry captures per-turn verdicts and lessons", () => {
    const { buildTurnVerdictLearningEntry } = require("../src/core/learning-log.ts") as typeof import("../src/core/learning-log.ts")
    const record = baseRecord({ status: "active", condition: "add tests" })
    const verdictEntry = {
      turn: 1,
      verdict: "not_met" as const,
      reason: "tests missing for edge cases",
      at: 1_700_000_010_000,
      toolCalls: 4,
      sha: "abc1234",
      spend: { cost: 0.2, input: 20, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    }
    const entry = buildTurnVerdictLearningEntry(record, verdictEntry, 1_700_000_010_100)
    expect(entry.kind).toBe("turn_verdict")
    expect(entry.turn).toBe(1)
    expect(entry.verdict).toBe("not_met")
    expect(entry.reason).toContain("edge cases")
    expect(entry.toolCalls).toBe(4)
    expect(entry.sha).toBe("abc1234")
    expect(entry.lesson).toContain("Turn verdict not met")
    expect(entry.lesson).toContain("close the stated evidence gaps")

    const metEntry = buildTurnVerdictLearningEntry(record, { ...verdictEntry, verdict: "met", reason: "all checks passed" }, 1_700_000_010_200)
    expect(metEntry.lesson).toContain("Turn verdict met")
    const impEntry = buildTurnVerdictLearningEntry(record, { ...verdictEntry, verdict: "impossible", reason: "API unavailable" }, 1_700_000_010_300)
    expect(impEntry.lesson).toContain("Turn verdict impossible")
  })

  test("serializeLearningEntry and appendLearningEntry write JSONL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-learning-log-"))
    dirs.push(dir)
    const file = join(dir, "nested", "learnings.jsonl")
    const entry = buildGoalTerminalLearningEntry(baseRecord({ status: "achieved", reason: "done" }), 1_700_000_030_100)
    const line = serializeLearningEntry(entry)
    expect(line.endsWith("\n")).toBe(true)
    expect(JSON.parse(line)).toMatchObject({ kind: "goal_terminal", status: "achieved" })

    appendLearningEntry(file, entry)
    appendLearningEntry(file, { ...entry, reason: "done again" })
    const text = await readFile(file, "utf8")
    const rows = text.trim().split("\n").map((l) => JSON.parse(l))
    expect(rows).toHaveLength(2)
    expect(rows[0]?.kind).toBe("goal_terminal")
    expect(rows[1]?.reason).toBe("done again")
  })

  test("buildSessionOutcomeLearningEntry captures session-level outcome and lesson", () => {
    const record = baseRecord({
      status: "achieved",
      turns: 4,
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_120_000,
      loopEnabled: true,
      loopObjective: "keep improving",
      loopIteration: 3,
      loopHistory: [
        { version: 1, condition: "a", summary: "s", reason: "r", turns: 1, toolCalls: 1, endedAt: 1_700_000_010_000 },
        { version: 2, condition: "b", summary: "s2", reason: "r2", turns: 2, toolCalls: 3, endedAt: 1_700_000_020_000 },
      ],
      reason: "loop completed",
    })
    const entry = buildSessionOutcomeLearningEntry(record, 1_700_000_120_100)
    expect(entry.kind).toBe("session_outcome")
    expect(entry.status).toBe("achieved")
    expect(entry.iterations).toBe(2)
    expect(entry.turns).toBe(4)
    expect(entry.elapsedMs).toBe(120_000)
    expect(entry.lesson).toContain("Session outcome")
    expect(entry.lesson).toContain("next sessions")
  })

  test("appendLearningEntry is best-effort and never throws on bad paths", () => {
    const entry = buildGoalTerminalLearningEntry(baseRecord({ status: "cleared", reason: "x" }))
    expect(() => appendLearningEntry("", entry)).not.toThrow()
    expect(() => appendLearningEntry(undefined, entry)).not.toThrow()
  })

  test("readRecentLearnings and formatRecentLearnings surface recent lessons for feedback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-learning-recent-"))
    dirs.push(dir)
    const file = join(dir, "learnings.jsonl")
    const goal = buildGoalTerminalLearningEntry(baseRecord({ status: "achieved", reason: "done" }), 1_700_000_030_100)
    const turn = {
      ...buildGoalTerminalLearningEntry(baseRecord({ status: "cleared", reason: "x" })),
      kind: "turn_verdict" as const,
      turn: 1,
      verdict: "not_met" as const,
      lesson: "Turn verdict not met: missing proof. Lesson: add concrete evidence.",
      ts: "2026-01-01T00:00:00.000Z",
    }
    appendLearningEntry(file, goal)
    // write a raw turn_verdict-like entry
    const { writeFile } = await import("node:fs/promises")
    await writeFile(file, serializeLearningEntry(goal) + JSON.stringify(turn) + "\n")
    const recent = readRecentLearnings(file, 5)
    expect(recent.length).toBe(2)
    expect(recent[1]?.lesson).toContain("missing proof")
    const formatted = formatRecentLearnings(recent)
    expect(formatted).toContain("Recent learnings")
    expect(formatted).toContain("apply them to improve this turn")
    expect(formatted).toContain("missing proof")
    expect(formatRecentLearnings([])).toBe("")
    expect(readRecentLearnings(undefined, 5)).toEqual([])
  })

  test("readLearningEntriesTail reads only complete tail lines and falls back for small files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-learning-tail-"))
    dirs.push(dir)
    const file = join(dir, "learnings.jsonl")
    const { writeFile } = await import("node:fs/promises")
    const line = (i: number) => `${JSON.stringify({ version: 1, kind: "turn_verdict", ts: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`, sessionID: "s", goalID: "g", condition: "c", lesson: `lesson-${i}` })}\n`
    let text = ""
    for (let i = 0; i < 100; i++) text += line(i)
    await writeFile(file, text)
    // File smaller than the window → full read, all entries.
    expect(readLearningEntriesTail(file).length).toBe(100)
    expect(readLearningEntriesTail(file)[0]).toMatchObject({ lesson: "lesson-0" })
    // Tiny window → only complete lines inside it; the partial first line is dropped, the last line survives.
    const tail = readLearningEntriesTail(file, 400)
    expect(tail.length).toBeGreaterThan(0)
    expect(tail.length).toBeLessThan(100)
    expect(tail.at(-1)).toMatchObject({ lesson: "lesson-99" })
    for (const entry of tail) expect((entry as { lesson?: string }).lesson).toMatch(/^lesson-\d+$/)
    // A partial trailing line from a concurrent append is ignored.
    await writeFile(file, text + '{"version":1,"kind":"turn_verdict"')
    const tail2 = readLearningEntriesTail(file, 400)
    for (const entry of tail2) expect((entry as { lesson?: string }).lesson).toMatch(/^lesson-\d+$/)
    // Bad paths fail closed.
    expect(readLearningEntriesTail(undefined)).toEqual([])
    expect(readLearningEntriesTail(join(dir, "missing.jsonl"))).toEqual([])
  })

  test("formatRecentLearnings never splits a surrogate pair at the character budget", () => {
    const { formatRecentLearnings: fmt } = require("../src/core/learning-log.ts") as typeof import("../src/core/learning-log.ts")
    const lesson = `x${"\u{1F389}".repeat(400)}y`
    const out = fmt([{ kind: "goal_armed", ts: "2026-01-01T00:00:00Z", lesson }], 120)
    expect(out.length).toBeLessThan(lesson.length)
    const body = out.split("\n").at(-1) ?? ""
    expect(body.endsWith("…")).toBe(true)
    let loneSurrogate = false
    for (let i = 0; i < body.length; i++) {
      const c = body.charCodeAt(i) ?? 0
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = body.charCodeAt(i + 1) ?? 0
        if (next < 0xdc00 || next > 0xdfff) loneSurrogate = true
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        const prev = body.charCodeAt(i - 1) ?? 0
        if (prev < 0xd800 || prev > 0xdbff) loneSurrogate = true
      }
    }
    expect(loneSurrogate).toBe(false)
  })
})

function harness(dir: string, options: Record<string, unknown> = {}) {
  const clock = new FakeClock()
  const verdicts: Array<EvaluationResult | Error> = []
  const requests: EvaluationRequest[] = []
  const notices: Array<{ kind: string; title: string; message: string }> = []
  const storage = new MemoryStorage()
  const store = new GoalStore(storage, () => {})
  let work: BackgroundWork = { subagents: 0, shells: 0 }
  let usage: UsageSnapshot | undefined = { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  const controller = new GoalController({
    config: resolveConfig({ learning: { enabled: true, path: ".term/goal-loop/learnings.jsonl" }, ...options }),
    directory: dir,
    commit: { required: false, branch: "dev", reason: "test" },
    clock,
    store,
    log: silentLog,
    newId: (() => { let n = 0; return () => `goal_${++n}` })(),
    session: {
      prompt: async () => {},
      synthetic: async () => {},
      usage: async () => usage,
      compact: async () => {},
    },
    evaluator: {
      evaluate: async (request) => {
        requests.push(request)
        const next = verdicts.shift()
        if (!next) throw new Error("no verdict queued")
        if (next instanceof Error) throw next
        return next
      },
    },
    background: { busy: async () => work },
    emitter: { changed: () => {}, notice: (n) => void notices.push(n as any) },
  })
  const turn = async (tools = 1) => {
    controller.onExecutionStarted("ses_test")
    for (let i = 0; i < tools; i++) controller.onToolCalled("ses_test")
    await controller.onExecutionSucceeded("ses_test")
    await flush()
  }
  return { clock, controller, verdicts, requests, notices, storage, store, turn, setWork: (w: BackgroundWork) => void (work = w), setUsage: (u: UsageSnapshot | undefined) => void (usage = u) }
}

describe("learning-log runtime emission", () => {
  test("writes a goal_terminal entry when a goal is achieved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-learning-rt-"))
    dirs.push(dir)
    const h = harness(dir)
    await h.controller.command({ sessionID: "ses_test", text: "make tests pass", delivery: "steer" })
    h.verdicts.push({ verdict: "met", reason: "all checks green" })
    await h.turn()
    const text = await readFile(join(dir, ".term/goal-loop/learnings.jsonl"), "utf8")
    const rows = text.trim().split("\n").map((l) => JSON.parse(l))
    const armedRows = rows.filter((r) => r.kind === "goal_armed")
    const turnRows = rows.filter((r) => r.kind === "turn_verdict")
    const goalRows = rows.filter((r) => r.kind === "goal_terminal")
    const sessionRows = rows.filter((r) => r.kind === "session_outcome")
    expect(armedRows.length).toBeGreaterThanOrEqual(1)
    expect(turnRows.length).toBeGreaterThanOrEqual(1)
    expect(turnRows.some((r) => r.verdict === "met")).toBe(true)
    expect(goalRows.length).toBeGreaterThanOrEqual(1)
    expect(sessionRows.length).toBeGreaterThanOrEqual(1)
    const last = goalRows[goalRows.length - 1]
    expect(last.status).toBe("achieved")
    expect(last.condition).toBe("make tests pass")
    expect(last.lesson).toContain("Achieved")
    expect(sessionRows[sessionRows.length - 1]?.lesson).toContain("Session outcome")
  })

  test("writes a goal_terminal entry when a goal is cleared", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-learning-rt-"))
    dirs.push(dir)
    const h = harness(dir)
    await h.controller.command({ sessionID: "ses_test", text: "ship feature", delivery: "steer" })
    await h.controller.command({ sessionID: "ses_test", text: "/goal clear", delivery: "steer" })
    const text = await readFile(join(dir, ".term/goal-loop/learnings.jsonl"), "utf8")
    const rows = text.trim().split("\n").map((l) => JSON.parse(l))
    const cleared = rows.find((r) => r.kind === "goal_terminal" && r.status === "cleared")
    expect(cleared).toMatchObject({
      kind: "goal_terminal",
      status: "cleared",
      condition: "ship feature",
      sessionID: "ses_test",
    })
    expect(cleared.lesson).toContain("Cleared")
  })

  test("writes loop_iteration entries for completed loop iterations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-learning-rt-"))
    dirs.push(dir)
    const h = harness(dir, { maxLoops: 5 })
    // Evaluator has no summarize/nextGoal, so a met loop iteration ends clean and must still log the iteration.
    await h.controller.command({ sessionID: "ses_test", text: "keep improving the code", delivery: "steer", loop: true })
    h.verdicts.push({ verdict: "met", reason: "iteration complete" })
    await h.turn()
    await flush()
    const file = join(dir, ".term/goal-loop/learnings.jsonl")
    const text = await readFile(file, "utf8")
    const rows = text.trim().split("\n").map((l) => JSON.parse(l))
    const turnRows = rows.filter((r) => r.kind === "turn_verdict")
    const iterRows = rows.filter((r) => r.kind === "loop_iteration")
    const goalRows = rows.filter((r) => r.kind === "goal_terminal")
    expect(turnRows.length).toBeGreaterThanOrEqual(1)
    expect(iterRows.length).toBeGreaterThanOrEqual(1)
    expect(iterRows[0]?.iteration).toBe(1)
    expect(typeof iterRows[0]?.summary).toBe("string")
    expect(iterRows[0]!.summary!.length).toBeGreaterThan(0)
    expect(iterRows[0]?.lesson).toMatch(/^Iteration v1 met /)
    // loop ended clean (no planner) -> also terminal achieved
    expect(goalRows.some((r) => r.status === "achieved")).toBe(true)
  })

  test("anchors the journal at the repo root when armed from a subfolder", async () => {
    const root = await mkdtemp(join(tmpdir(), "goal-learning-subdir-"))
    dirs.push(root)
    // A minimal git repo (the same markers findRepository reads) with a docs/ subfolder.
    const git = join(root, ".git")
    mkdirSync(join(git, "refs", "heads"), { recursive: true })
    writeFileSync(join(git, "refs", "heads", "dev"), "0".repeat(40))
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/dev\n")
    const docs = join(root, "docs")
    mkdirSync(docs, { recursive: true })

    // The session's directory is the subfolder where OpenCode was launched.
    const h = harness(docs)
    await h.controller.command({ sessionID: "ses_test", text: "make tests pass", delivery: "steer" })
    h.verdicts.push({ verdict: "met", reason: "all checks green" })
    await h.turn()

    // The journal lands at the repository root, never in the launch subfolder.
    expect((await readFile(join(root, ".term/goal-loop/learnings.jsonl"), "utf8")).trim().length).toBeGreaterThan(0)
    await expect(readFile(join(docs, ".term/goal-loop/learnings.jsonl"), "utf8")).rejects.toThrow()
  })

  test("does not write when learning log is disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-learning-rt-"))
    dirs.push(dir)
    const h = harness(dir, { learning: { enabled: false } })
    await h.controller.command({ sessionID: "ses_test", text: "do thing", delivery: "steer" })
    h.verdicts.push({ verdict: "met", reason: "ok" })
    await h.turn()
    await expect(readFile(join(dir, ".term/goal-loop/learnings.jsonl"), "utf8")).rejects.toThrow()
  })
})
