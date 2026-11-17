import { describe, expect, test } from "bun:test"
import { ENTRY_CAP, preserveCarriedFields, pruneSnapshotEntries, type GoalSnapshotCacheEntry } from "../src/core/entries.ts"
import type { GoalSnapshot, GoalStatus } from "../src/core/types.ts"

const snap = (status: GoalStatus): GoalSnapshot =>
  ({ version: 1, status, sessionID: "ses", condition: "c", setAt: 0, startedAt: 0, turns: 0, stall: 0, retries: 0, checkins: 0, baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, history: [], elapsedMs: 0 }) as unknown as GoalSnapshot

const entry = (status: GoalStatus | null, receivedAt = 1000): GoalSnapshotCacheEntry => ({
  goal: status === null ? null : snap(status),
  receivedAt,
})

describe("pruneSnapshotEntries", () => {
  test("null-valued entries are dropped, others kept", () => {
    const out = pruneSnapshotEntries({ a: entry("achieved"), b: entry(null), c: entry(null, 2000) }, undefined)
    expect(Object.keys(out)).toEqual(["a"])
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
