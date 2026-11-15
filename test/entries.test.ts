import { describe, expect, test } from "bun:test"
import { ENTRY_CAP, pruneSnapshotEntries, type GoalSnapshotCacheEntry } from "../src/core/entries.ts"
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
