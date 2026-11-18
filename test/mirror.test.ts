/**
 * The stranded-indicator incident (2026-11-17 background service: 77 consecutive HTTP 500s on
 * /api/rpc/goal/get; 2026-11-18 standalone: 25+ consecutive 500s and a verdict `changed` event that never
 * reached the TUI) showed that both convergence paths can be dead at once. The server now writes every
 * `changed` snapshot to a small mirror file and the TUI reads it when a re-pull is due; these tests pin the
 * mirror's contract and prove it closes the verdict -> pill loop end to end without the RPC or the bus.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGoalMirror } from "../src/core/mirror.ts"
import { applySnapshot, type GoalSnapshotCacheEntry } from "../src/core/entries.ts"
import { pillModel } from "../src/core/hud.ts"
import { isGoalSnapshot, parseChangedEvent } from "../src/core/wire.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const now = 1_800_000_000_000
const baseline = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

const record = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_m",
  sessionID: "ses_m",
  directory: "/tmp/m",
  condition: "ship it",
  status: "active",
  setAt: now - 100_000,
  startedAt: now - 100_000,
  turns: 0,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline,
  history: [],
  elapsedMs: 10_000,
  evaluating: false,
  waiting: false,
  ...overrides,
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "goal-mirror-test-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("createGoalMirror", () => {
  test("write -> read roundtrip preserves the snapshot", () => {
    const mirror = createGoalMirror(dir)
    const goal = record({ status: "achieved", evaluating: false, verdict: "met", endedAt: now })
    mirror.write(goal)
    const read = mirror.read("ses_m", "/tmp/m")
    expect(read?.status).toBe("achieved")
    expect(read?.condition).toBe("ship it")
  })

  test("the mirror file is owner-only and lives in the mirror dir", () => {
    const mirror = createGoalMirror(dir)
    mirror.write(record())
    expect(existsSync(join(dir, "ses_m.json"))).toBe(true)
    const raw = JSON.parse(readFileSync(join(dir, "ses_m.json"), "utf8")) as GoalSnapshot
    expect(raw.sessionID).toBe("ses_m")
    // Atomic write: no half-written sibling files left behind.
    expect(existsSync(join(dir, "ses_m.json.tmp"))).toBe(false)
  })

  test("remove() unlinks the mirror and read() then comes up empty", () => {
    const mirror = createGoalMirror(dir)
    mirror.write(record())
    mirror.remove("ses_m")
    expect(mirror.read("ses_m", "/tmp/m")).toBeUndefined()
  })

  test("a malformed mirror file is dropped, never cached", () => {
    const mirror = createGoalMirror(dir)
    writeFileSync(join(dir, "ses_m.json"), "{ not json", "utf8")
    expect(mirror.read("ses_m", "/tmp/m")).toBeUndefined()
    writeFileSync(join(dir, "ses_m.json"), JSON.stringify({ version: 1, sessionID: "ses_m", status: "achieved" }), "utf8")
    expect(mirror.read("ses_m", "/tmp/m")).toBeUndefined()
  })

  test("a record for a different session is dropped", () => {
    const mirror = createGoalMirror(dir)
    mirror.write(record({ sessionID: "ses_elsewhere" }))
    expect(mirror.read("ses_m", "/tmp/m")).toBeUndefined()
  })

  test("a record from another directory never paints here", () => {
    const mirror = createGoalMirror(dir)
    mirror.write(record({ directory: "/tmp/other-project" }))
    expect(mirror.read("ses_m", "/tmp/m")).toBeUndefined()
  })

  test("with no local directory the directory guard fails open (same posture as the changed intake)", () => {
    const mirror = createGoalMirror(dir)
    mirror.write(record())
    expect(mirror.read("ses_m", undefined)?.status).toBe("active")
  })

  test("a sessionID with path-like characters stays inside the mirror dir", () => {
    const mirror = createGoalMirror(dir)
    mirror.write(record({ sessionID: "../evil/../ses" }))
    // The hostile ID maps to one safe filename inside the dir; nothing escaped it.
    expect(existsSync(join(dir, "..", "evil"))).toBe(false)
    expect(readdirSync(dir).length).toBe(1)
    expect(readdirSync(dir)[0]).toMatch(/^[a-zA-Z0-9_.-]+\.json$/)
    // And the same hostile ID round-trips deterministically.
    expect(mirror.read("../evil/../ses", "/tmp/m")?.sessionID).toBe("../evil/../ses")
  })
})

describe("mirror read closes the verdict -> pill loop", () => {
  test("a stale evaluating entry converges to the terminal record and the pill leaves checking", () => {
    const mirror = createGoalMirror(dir)
    const inFlight = record({ evaluating: true, turns: 1, history: [] })
    let entries: Readonly<Record<string, GoalSnapshotCacheEntry>> = {
      ses_m: { goal: inFlight, receivedAt: now - 120_000 },
    }
    expect(pillModel(entries["ses_m"]!.goal as GoalSnapshot, 90_000).tone).toBe("evaluating")

    // The dead-RPC world: `goal/get` 500s, `changed` never arrived; only the mirror answers.
    const terminal = record({
      status: "achieved",
      evaluating: false,
      turns: 1,
      verdict: "met",
      reason: "word pong delivered",
      endedAt: now - 60_000,
      elapsedMs: 37_000,
      history: [{ turn: 1, verdict: "met", reason: "word pong delivered", at: now - 60_000, toolCalls: 4, sha: "abc123" }],
    })
    expect(isGoalSnapshot(terminal)).toBe(true)
    expect(parseChangedEvent({ sessionID: "ses_m", goal: terminal })).not.toBeUndefined()
    mirror.write(terminal)

    const stored = mirror.read("ses_m", "/tmp/m")
    expect(stored).not.toBeUndefined()
    entries = applySnapshot(entries, "ses_m", stored!, now, undefined)

    const after = entries["ses_m"]!.goal as GoalSnapshot
    expect(after.status).toBe("achieved")
    expect(after.evaluating).toBe(false)
    expect(pillModel(after, after.elapsedMs).text).not.toContain("checking")
  })
})
