import { describe, expect, test } from "bun:test"
import { ENTRY_CAP, bumpReceivedAt, preserveCarriedFields, pruneSnapshotEntries, terminalStampOf, dropSessions, type GoalSnapshotCacheEntry } from "../src/core/entries.ts"
import type { GoalSnapshot, GoalStatus } from "../src/core/types.ts"

const snap = (status: GoalStatus): GoalSnapshot =>
  ({ version: 1, status, sessionID: "ses", condition: "c", setAt: 0, startedAt: 0, turns: 0, stall: 0, retries: 0, checkins: 0, baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, history: [], elapsedMs: 0 }) as unknown as GoalSnapshot

const entry = (status: GoalStatus | null, receivedAt = 1000): GoalSnapshotCacheEntry => ({
  goal: status === null ? null : snap(status),
  receivedAt,
})

describe("pruneSnapshotEntries", () => {
  test("null-valued entries are retained — the stale-chrome tick re-pulls them; only the cap evicts", () => {
    const out = pruneSnapshotEntries({ a: entry("achieved"), b: entry(null), c: entry(null, 2000) }, undefined)
    expect(Object.keys(out)).toEqual(["a", "b", "c"])
  })

  test("the session kept for an open dialog is never dropped, even when null-valued", () => {
    const out = pruneSnapshotEntries({ a: entry(null) }, "a")
    expect(Object.keys(out)).toEqual(["a"])
  })

  test("returns the same reference when nothing needed pruning", () => {
    const input = { a: entry("active") }
    expect(pruneSnapshotEntries(input, undefined)).toBe(input)
  })

  test("the cap evicts oldest non-live entries first; live goals are never evicted", () => {
    const map: Record<string, GoalSnapshotCacheEntry> = {}
    // 3 live (active) goals, oldest first
    map.a = entry("active", 100)
    map.b = entry("active", 200)
    map.c = entry("active", 300)
    // 3 terminal (achieved) goals, oldest first
    map.x = entry("achieved", 400)
    map.y = entry("achieved", 500)
    map.z = entry("achieved", 600)
    const out = pruneSnapshotEntries(map, undefined, 4)
    // Cap 4: drop the two oldest terminal (x, y); live goals and z survive regardless of age.
    expect(Object.keys(out).sort()).toEqual(["a", "b", "c", "z"])
  })

  test("keep wins the cap eviction too", () => {
    const map: Record<string, GoalSnapshotCacheEntry> = {}
    map.x = entry("achieved", 100)
    map.y = entry("achieved", 200)
    map.z = entry("cleared", 300)
    // keep=x survives the eviction; the oldest non-kept non-live entry is evicted instead.
    const out = pruneSnapshotEntries(map, "x", 2)
    expect(Object.keys(out).sort()).toEqual(["x", "z"])
  })

  test("the map may exceed the cap when everything left is live", () => {
    const map: Record<string, GoalSnapshotCacheEntry> = {}
    for (let i = 0; i < 5; i++) map[`live${i}`] = entry("active", i)
    const out = pruneSnapshotEntries(map, undefined, 2)
    expect(Object.keys(out)).toHaveLength(5)
  })

  test("default cap is the exported ENTRY_CAP", () => {
    expect(ENTRY_CAP).toBeGreaterThan(0)
  })
})

describe("preserveCarriedFields", () => {
  const withCtx = (contextSize: number | undefined): GoalSnapshot => ({ ...snap("active"), contextSize }) as unknown as GoalSnapshot

  test("carries the cached estimate forward when an event snapshot drops it", () => {
    const merged = preserveCarriedFields(withCtx(95_000), snap("active"))
    expect(merged?.contextSize).toBe(95_000)
  })

  test("an event snapshot carrying its own estimate wins over the cache", () => {
    const merged = preserveCarriedFields(withCtx(95_000), withCtx(120_000))
    expect(merged?.contextSize).toBe(120_000)
  })

  test("returns the next reference untouched when there is nothing to carry", () => {
    const next = snap("active")
    expect(preserveCarriedFields(undefined, next)).toBe(next)
    expect(preserveCarriedFields(withCtx(undefined), next)).toBe(next)
    expect(preserveCarriedFields(null, next)).toBe(next)
  })

  test("null stays null (session cleared)", () => {
    expect(preserveCarriedFields(withCtx(95_000), null)).toBeNull()
  })

  test("a cached estimate that is not a finite non-negative number is ignored", () => {
    expect(preserveCarriedFields(withCtx(Number.NaN), snap("active"))?.contextSize).toBeUndefined()
    expect(preserveCarriedFields(withCtx(-10), snap("active"))?.contextSize).toBeUndefined()
  })
})

describe("preserveCarriedFields across a compaction landing", () => {
  const withCtx = (contextSize: number | undefined): GoalSnapshot => ({ ...snap("active"), contextSize }) as unknown as GoalSnapshot
  const withCompact = (landedAt: number | undefined, base: GoalSnapshot): GoalSnapshot =>
    ({ ...base, loopCompact: { requestedAt: 1, iteration: 2, misses: 0, ...(landedAt !== undefined ? { landedAt } : {}) } }) as unknown as GoalSnapshot

  test("a pending→landed flip drops the cached pre-compaction total", () => {
    const prev = withCompact(undefined, withCtx(185_000))
    const next = withCompact(2, snap("active"))
    expect(preserveCarriedFields(prev, next)?.contextSize).toBeUndefined()
  })

  test("a fresh landing event with no prior pending still drops the cache", () => {
    // First snapshot observed after the TUI (re)starts can already carry landedAt; dropping the
    // cache costs nothing when there is nothing worth carrying from a replaced context.
    const next = withCompact(2, snap("active"))
    expect(preserveCarriedFields(withCtx(185_000), next)?.contextSize).toBeUndefined()
  })

  test("a re-delivered landed record keeps the carried (post-landing) value", () => {
    const prev = withCompact(2, withCtx(9_500))
    const next = withCompact(2, snap("active"))
    expect(preserveCarriedFields(prev, next)?.contextSize).toBe(9_500)
  })

  test("an unchanged pending still carries the total forward (no landing, no invalidation)", () => {
    const prev = withCompact(undefined, withCtx(185_000))
    const next = withCompact(undefined, snap("active"))
    expect(preserveCarriedFields(prev, next)?.contextSize).toBe(185_000)
  })

  test("a snapshot carrying its own estimate wins over the invalidation", () => {
    const prev = withCompact(undefined, withCtx(185_000))
    const next = withCompact(2, withCtx(9_500))
    expect(preserveCarriedFields(prev, next)?.contextSize).toBe(9_500)
  })
})

describe("preserveCarriedFields spend carry-forward", () => {
  const usage = (cost: number) => ({ cost, input: 1000, output: 500, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
  const withSpend = (cost: number | undefined): GoalSnapshot =>
    ({ ...snap("active"), ...(cost !== undefined ? { spend: usage(cost) } : {}) }) as unknown as GoalSnapshot

  test("carries the cached spend forward when an event snapshot drops it", () => {
    const merged = preserveCarriedFields(withSpend(0.42), snap("active"))
    expect(merged?.spend?.cost).toBe(0.42)
  })

  test("an event snapshot carrying its own spend wins over the cache", () => {
    const merged = preserveCarriedFields(withSpend(0.42), withSpend(0.87))
    expect(merged?.spend?.cost).toBe(0.87)
  })

  test("no cached spend means no spend on the merged snapshot", () => {
    expect(preserveCarriedFields(snap("active"), snap("active"))?.spend).toBeUndefined()
  })

  test("spend is carried even across a compaction landing (only the context total is invalidated)", () => {
    const prev = { ...snap("active"), spend: usage(0.42), contextSize: 185_000, loopCompact: { requestedAt: 1, iteration: 2, misses: 0 } } as unknown as GoalSnapshot
    const next = { ...snap("active"), loopCompact: { requestedAt: 1, iteration: 2, misses: 0, landedAt: 2 } } as unknown as GoalSnapshot
    const merged = preserveCarriedFields(prev, next)
    expect(merged?.contextSize).toBeUndefined()
    expect(merged?.spend?.cost).toBe(0.42)
  })

  test("null stays null even when a spend was cached", () => {
    expect(preserveCarriedFields(withSpend(0.42), null)).toBeNull()
  })
})

describe("preserveCarriedFields record identity", () => {
  const usage = { cost: 0.42, input: 1000, output: 500, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

  test("a cleared-then-re-armed goal in the same session inherits nothing from the old record", () => {
    const old = { ...snap("achieved"), id: "goal_old", contextSize: 95_000, spend: usage } as unknown as GoalSnapshot
    const fresh = { ...snap("active"), id: "goal_new" } as unknown as GoalSnapshot
    const merged = preserveCarriedFields(old, fresh)!
    expect(merged.contextSize).toBeUndefined()
    expect(merged.spend).toBeUndefined()
    // A pending→landed flip recorded on the old record is not applied to the new one either.
    const freshLanded = { ...fresh, loopCompact: { requestedAt: 9, iteration: 1, misses: 0, landedAt: 10 } } as unknown as GoalSnapshot
    const kept = preserveCarriedFields(old, freshLanded)
    expect(kept).toBe(freshLanded)
  })

  test("the same record id keeps carrying its figures", () => {
    const old = { ...snap("active"), id: "goal_a", contextSize: 95_000, spend: usage } as unknown as GoalSnapshot
    const next = { ...snap("active"), id: "goal_a" } as unknown as GoalSnapshot
    const merged = preserveCarriedFields(old, next)!
    expect(merged.contextSize).toBe(95_000)
    expect(merged.spend?.cost).toBe(0.42)
  })

  test("a pending→landed flip is still honored within one record", () => {
    const old = { ...snap("active"), id: "goal_a", contextSize: 185_000, loopCompact: { requestedAt: 1, iteration: 2, misses: 0 } } as unknown as GoalSnapshot
    const next = { ...snap("active"), id: "goal_a", loopCompact: { requestedAt: 1, iteration: 2, misses: 0, landedAt: 2 } } as unknown as GoalSnapshot
    expect(preserveCarriedFields(old, next)?.contextSize).toBeUndefined()
  })
})

describe("bumpReceivedAt", () => {
  test("returns a NEW map; the entry gets receivedAt=now with the SAME goal reference; siblings untouched", () => {
    const goal = snap("active")
    const other = entry("paused", 111)
    const input: Record<string, GoalSnapshotCacheEntry> = { a: { goal, receivedAt: 1000 }, b: other }
    const out = bumpReceivedAt(input, "a", 5000)
    expect(out).not.toBe(input)
    expect(out.a).not.toBe(input.a)
    expect(out.a!.receivedAt).toBe(5000)
    expect(out.a!.goal).toBe(goal) // same reference: goal-identical memos do not re-evaluate
    expect(out.b).toBe(other) // same reference: siblings untouched
    expect(input.a!.receivedAt).toBe(1000) // input not mutated
  })

  test("an unknown session returns the same reference", () => {
    const input = { a: entry("active") }
    expect(bumpReceivedAt(input, "ses_missing", 5000)).toBe(input)
  })

  test("works for a null-goal entry", () => {
    const input: Record<string, GoalSnapshotCacheEntry> = { a: { goal: null, receivedAt: 1000 } }
    const out = bumpReceivedAt(input, "a", 7000)
    expect(out).not.toBe(input)
    expect(out.a!.receivedAt).toBe(7000)
    expect(out.a!.goal).toBeNull()
  })
})

describe("steady null entries and the cap", () => {
  test("steady null entries are retained below the cap", () => {
    const input: Record<string, GoalSnapshotCacheEntry> = { a: entry(null, 1000), b: entry(null, 2000) }
    const out = pruneSnapshotEntries(input, undefined, ENTRY_CAP)
    expect(out).toBe(input)
  })

  test("the cap still evicts oldest non-live (null) entries, freshly bumped survive, live goals never evicted", () => {
    const map: Record<string, GoalSnapshotCacheEntry> = {}
    // ENTRY_CAP null entries, oldest first — the shape a long-lived TUI reaches over months of session churn.
    for (let i = 0; i < ENTRY_CAP; i++) map[`ses_${i}`] = entry(null, 1000 + i)
    map.live_a = entry("active", 1)
    map.live_b = entry("paused", 2)
    // The freshly re-pulled entry: receivedAt is bumped to NOW before the cap runs.
    const bumped = bumpReceivedAt(map, "ses_0", 99999)
    const out = pruneSnapshotEntries(bumped, undefined, ENTRY_CAP)
    expect(Object.keys(out)).toHaveLength(ENTRY_CAP)
    expect(out.ses_0?.receivedAt).toBe(99999) // the freshly checked entry survives the eviction
    expect(out.live_a?.goal).not.toBeNull()
    expect(out.live_b?.goal).not.toBeNull()
    expect(out.ses_1).toBeUndefined() // oldest null evicted first
    expect(out.ses_2).toBeUndefined()
    expect(out.ses_3?.goal).toBeNull() // overflow is 2 (66 entries, cap 64); ses_3 is the newest survivor of the null tail
  })
})

describe("terminalStampOf", () => {
  test("a terminal goal stamps first-observation time", () => {
    expect(terminalStampOf(undefined, snap("achieved"), 5000)).toBe(5000)
  })

  test("re-observation retains the original stamp, not the latest pull", () => {
    const existing = { goal: snap("achieved"), receivedAt: 1000, terminalAt: 4000 }
    expect(terminalStampOf(existing, snap("achieved"), 9000)).toBe(4000)
  })

  test("a live goal drops the stamp entirely", () => {
    const existing = { goal: snap("achieved"), receivedAt: 1000, terminalAt: 4000 }
    expect(terminalStampOf(existing, snap("active"), 9000)).toBeUndefined()
  })

  test("a null goal drops the stamp entirely", () => {
    const existing = { goal: snap("achieved"), receivedAt: 1000, terminalAt: 4000 }
    expect(terminalStampOf(existing, null, 9000)).toBeUndefined()
  })

  test("every non-live status stamps, not only achieved (failed, impossible, cleared)", () => {
    for (const status of ["failed", "impossible", "cleared"] as const) {
      expect(terminalStampOf(undefined, snap(status), 5000)).toBe(5000)
    }
  })

  test("bumpReceivedAt keeps the terminal stamp (re-pulls do not age the window)", () => {
    const input: Record<string, GoalSnapshotCacheEntry> = { a: { goal: snap("achieved"), receivedAt: 1000, terminalAt: 4000 } }
    const out = bumpReceivedAt(input, "a", 9999)
    expect(out.a!.terminalAt).toBe(4000)
  })
})

describe("dropSessions", () => {
  const entryWith = (terminalAt?: number) => ({ goal: snap("achieved"), receivedAt: 1000, ...(terminalAt !== undefined ? { terminalAt } : {}) })

  test("drops the named sessions and keeps the rest", () => {
    const out = dropSessions({ a: entryWith(5000), b: entryWith(6000), c: entryWith(7000) }, ["a", "c"])
    expect(Object.keys(out)).toEqual(["b"])
  })

  test("the kept session is never dropped", () => {
    const out = dropSessions({ a: entryWith(5000) }, ["a"], "a")
    expect(Object.keys(out)).toEqual(["a"])
  })

  test("an empty id list (or nothing matched) returns the same reference", () => {
    const input = { a: entryWith(5000) }
    expect(dropSessions(input, [])).toBe(input)
    expect(dropSessions(input, ["zzz"])).toBe(input)
  })
})
