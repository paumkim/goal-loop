import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig } from "../src/core/config.ts"
import { parseLearningEntries, serializeLearningEntry, type LearningEntry } from "../src/core/learning-log.ts"
import {
  DEFAULT_TELEMETRY_MAX_CHARS,
  RECURRING_THEME_THRESHOLD,
  formatOutcomeTelemetry,
  normalizeReason,
  summarizeLearningText,
  summarizeOutcomeTelemetry,
} from "../src/core/outcome-telemetry.ts"
import { GoalController } from "../src/runtime/controller.ts"
import type { BackgroundWork, Clock, EvaluationResult, StoragePort } from "../src/runtime/ports.ts"
import { GoalStore } from "../src/runtime/store.ts"
import type { GoalStatus, UsageSnapshot } from "../src/core/types.ts"

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const dirs: string[] = []
const track = async () => {
  const dir = await mkdtemp(join(tmpdir(), "goal-telemetry-"))
  dirs.push(dir)
  return dir
}
const cleanup = async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
}

class FakeClock implements Clock {
  t = 1_700_000_000_000
  now = () => this.t
  setTimeout = (fn: () => void, _ms: number) => (setTimeout(fn, 0) as unknown as number)
  clearTimeout = (id: unknown) => clearTimeout(id as number)
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

function base(overrides: Partial<LearningEntry> = {}): LearningEntry {
  return {
    version: 1,
    ts: "2026-01-01T00:00:00.000Z",
    kind: "goal_armed",
    sessionID: "ses_test",
    goalID: "goal_x",
    condition: "make tests pass",
    loopEnabled: false,
    lesson: "armed",
    ...overrides,
  } as LearningEntry
}

function verdict(reason: string, ts = "2026-01-01T00:01:00.000Z"): LearningEntry {
  return base({ kind: "turn_verdict", ts, turn: 1, verdict: "not_met", reason, lesson: `not met: ${reason}` }) as LearningEntry
}

function terminal(status: string, ts = "2026-01-01T00:05:00.000Z", goalID = "goal_x"): LearningEntry {
  return base({ kind: "goal_terminal", ts, goalID, status: status as GoalStatus, lesson: `terminal ${status}` }) as LearningEntry
}

const teardown = async () => { await cleanup() }
// bun:test runs files in one process; register cleanup via a final afterAll-equivalent test.
import { afterAll } from "bun:test"
afterAll(teardown)

describe("parseLearningEntries", () => {
  test("skips blank, malformed, non-object, unknown-kind and timestamp-less lines", () => {
    const text = [
      "",
      "{ not json",
      "[]",
      JSON.stringify({ kind: "mystery", ts: "2026-01-01T00:00:00Z", lesson: "x" }),
      JSON.stringify({ kind: "goal_armed", lesson: "no ts" }),
      serializeLearningEntry(base()).trim(),
    ].join("\n")
    const parsed = parseLearningEntries(text)
    expect(parsed.length).toBe(1)
    expect(parsed[0]?.kind).toBe("goal_armed")
  })

  test("empty and non-string inputs fail closed", () => {
    expect(parseLearningEntries("")).toEqual([])
    expect(parseLearningEntries("   \n  ")).toEqual([])
    expect(parseLearningEntries(undefined as unknown as string)).toEqual([])
  })
})

describe("normalizeReason", () => {
  test("lowercases and strips URLs, hashes, durations and punctuation for stable grouping", () => {
    expect(normalizeReason("  Missing verifier output at https://x.dev/a?b=1 (sha abcdef1234) after 90s! "))
      .toBe("missing verifier output at sha after")
    expect(normalizeReason("")).toBe("")
    expect(normalizeReason(undefined)).toBe("")
  })
})

describe("summarizeOutcomeTelemetry", () => {
  test("empty or all-unknown entries yield an empty summary", () => {
    const empty = summarizeOutcomeTelemetry([])
    expect(empty.entries).toBe(0)
    expect(empty.terminalCounts).toEqual({})
    expect(empty.verdictCounts).toEqual({})
    expect(empty.failureThemes).toEqual([])
    expect(empty.timeToGreen.count).toBe(0)
    expect(formatOutcomeTelemetry(empty)).toBe("")
  })

  test("groups not_met reasons into a taxonomy and flags recurring themes at the threshold", () => {
    const entries = [
      verdict("missing verifier output"),
      verdict("missing verifier output!"),
      verdict("MISSING verifier output (30s)"),
      verdict("different gap entirely"),
    ]
    const s = summarizeOutcomeTelemetry(entries)
    expect(s.verdictCounts.not_met).toBe(4)
    expect(s.failureThemes.length).toBe(2)
    expect(s.failureThemes[0]?.count).toBe(RECURRING_THEME_THRESHOLD)
    expect(s.failureThemes[0]?.recurring).toBe(true)
    expect(s.failureThemes[0]?.theme).toContain("missing verifier output")
    expect(s.failureThemes[1]?.count).toBe(1)
    expect(s.failureThemes[1]?.recurring).toBe(false)
  })

  test("ignores non-not_met verdicts when building the failure taxonomy", () => {
    const entries = [verdict("x"), base({ kind: "turn_verdict", verdict: "met", reason: "all good", lesson: "met" })]
    const s = summarizeOutcomeTelemetry(entries)
    expect(s.verdictCounts.met).toBe(1)
    expect(s.failureThemes.length).toBe(1) // only "x" from not_met
  })

  test("pairs goal_armed -> achieved by session+goal and computes a median time to green", () => {
    const armed1 = base({ goalID: "g1", ts: "2026-01-01T00:00:00.000Z" })
    const green1 = terminal("achieved", "2026-01-01T00:05:00.000Z", "g1")
    const armed2 = base({ goalID: "g2", ts: "2026-01-01T00:00:00.000Z" })
    const green2 = terminal("achieved", "2026-01-01T00:11:00.000Z", "g2")
    const s = summarizeOutcomeTelemetry([armed1, green1, armed2, green2])
    expect(s.timeToGreen.count).toBe(2)
    // sorted [5m, 11m], upper median for even length -> 11m
    expect(s.timeToGreen.medianMs).toBe(11 * 60_000)
  })

  test("skips malformed timestamps, negative pairs and cross-goal pairings", () => {
    const entries = [
      base({ goalID: "g1", ts: "not-a-date" }),
      terminal("achieved", "2026-01-01T00:05:00.000Z"),
      base({ goalID: "g2", ts: "2026-01-01T00:00:00.000Z" }),
      terminal("achieved", "2026-01-01T00:01:00.000Z", "g2"),
      base({ goalID: "g3", ts: "2026-01-01T00:10:00.000Z" }),
      terminal("achieved", "2026-01-01T00:02:00.000Z", "g3"), // end before start -> skipped
      terminal("achieved", "2026-01-01T00:03:00.000Z"), // no armed entry for goalID goal_x -> skipped
    ]
    const s = summarizeOutcomeTelemetry(entries)
    expect(s.timeToGreen.count).toBe(1)
    expect(s.timeToGreen.medianMs).toBe(60_000)
  })

  test("deduplicates goal_terminal against session_outcome and detects recurring conditions", () => {
    const t = terminal("achieved")
    const so = base({ kind: "session_outcome", ts: t.ts, status: "achieved", lesson: "session" })
    const s = summarizeOutcomeTelemetry([t, so, base({ condition: "make tests pass" }), base({ condition: "Make tests pass!" })])
    expect(s.terminalCounts.achieved).toBe(1)
    expect(s.recurringConditions.length).toBe(1)
    expect(s.recurringConditions[0]?.count).toBeGreaterThan(1)
    expect(s.recurringConditions[0]?.condition).toContain("make tests pass")
  })

  test("summarizeLearningText parses JSONL end to end", () => {
    const s = summarizeLearningText([serializeLearningEntry(verdict("flaky test")), "{bad", ""].join("\n"))
    expect(s.entries).toBe(1)
    expect(s.failureThemes[0]?.theme).toBe("flaky test")
  })
})

describe("formatOutcomeTelemetry", () => {
  test("renders a compact block with all signals and caps at a code-point boundary", () => {
    const s = summarizeOutcomeTelemetry([
      base(), verdict("missing proof"), verdict("missing proof"), verdict("missing proof"),
      terminal("achieved", "2026-01-01T00:05:00.000Z"),
    ])
    const text = formatOutcomeTelemetry(s)
    expect(text).toContain("Outcome telemetry (from 5 journal entries)")
    expect(text).toContain("Terminal outcomes: achieved=1")
    expect(text).toContain("Turn verdicts: not_met=3")
    expect(text).toContain("(recurring)")
    expect(text).toContain("Time to green: median 5m 00s over 1 run")

    const short = formatOutcomeTelemetry(s, 60)
    expect(short.length).toBeLessThanOrEqual(60)
    expect(short.endsWith("…")).toBe(true)
    expect(formatOutcomeTelemetry(s, DEFAULT_TELEMETRY_MAX_CHARS).length).toBeGreaterThan(short.length)
  })

  test("never splits a multibyte code point when truncating", () => {
    const emoji = "\u{1F389}".repeat(200)
    const s = summarizeOutcomeTelemetry([verdict(emoji)])
    const short = formatOutcomeTelemetry(s, 40)
    expect(short.length).toBeLessThanOrEqual(40)
    expect(short).not.toContain("\uFFFD")
  })
})

describe("telemetry prompt integration", () => {
  test("the controller injects the telemetry block into a continuation prompt from one log read", async () => {
    const dir = await track()
    const logPath = join(dir, ".term", "goal-loop", "learnings.jsonl")
    mkdirSync(join(dir, ".term", "goal-loop"), { recursive: true })
    writeFileSync(logPath, [
      serializeLearningEntry(base({ goalID: "seeded", ts: "2026-01-01T00:00:00.000Z" })),
      serializeLearningEntry(verdict("missing verifier output", "2026-01-01T00:02:00.000Z")),
      serializeLearningEntry(verdict("missing verifier output", "2026-01-01T00:03:00.000Z")),
      serializeLearningEntry(verdict("missing verifier output", "2026-01-01T00:04:00.000Z")),
      serializeLearningEntry(terminal("achieved", "2026-01-01T00:06:00.000Z", "seeded")),
    ].join(""))
    const prompts: string[] = []
    const verdicts: EvaluationResult[] = [{ verdict: "not_met", reason: "still not done" }]
    const controller = new GoalController({
      config: resolveConfig({ learning: { enabled: true, path: ".term/goal-loop/learnings.jsonl" } }),
      directory: dir,
      commit: { required: false, branch: "dev", reason: "test" },
      clock: new FakeClock(),
      store: new GoalStore(new MemoryStorage(), () => {}),
      log: silentLog,
      newId: (() => { let n = 0; return () => `goal_${++n}` })(),
      session: {
        prompt: async () => {},
        synthetic: async (input: { text: string }) => void prompts.push(input.text),
        usage: async (): Promise<UsageSnapshot> => ({ cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
        compact: async () => {},
      },
      evaluator: {
        evaluate: async () => verdicts.shift() ?? ({ verdict: "not_met", reason: "no verdict queued" } as EvaluationResult),
      },
      background: { busy: async () => ({ subagents: 0, shells: 0 } as BackgroundWork) },
      emitter: { changed: () => {}, notice: () => {} },
    })
    await controller.command({ sessionID: "ses_test", text: "make tests pass", delivery: "steer" })
    controller.onExecutionStarted("ses_test")
    controller.onToolCalled("ses_test")
    await controller.onExecutionSucceeded("ses_test")
    await flush()

    const injected = prompts.join("\n")
    expect(injected).toContain("Outcome telemetry (from")
    expect(injected).toContain("(recurring)")
    expect(injected).toContain("Time to green")
    // The seeded log is still on disk and the runtime appended without corrupting it.
    const raw = await readFile(logPath, "utf8")
    expect(raw).toContain("missing verifier output")
  })
})
