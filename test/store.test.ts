import { describe, expect, test } from "bun:test"
import type { GoalRecord } from "../src/core/types.ts"
import type { StoragePort } from "../src/runtime/ports.ts"
import { GoalStore, keyFor, sameDirectory } from "../src/runtime/store.ts"

class MemoryStorage implements StoragePort {
  data = new Map<string, unknown>()
  get = async (key: string) => structuredClone(this.data.get(key))
  set = async (key: string, value: unknown) => void this.data.set(key, structuredClone(value))
  remove = async (key: string) => void this.data.delete(key)
  scan = async ({ prefix }: { prefix: string }) => ({
    entries: [...this.data]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: structuredClone(value) })),
  })
}

const record = (overrides: Partial<GoalRecord> = {}): GoalRecord => ({
  version: 1,
  id: "goal-1",
  sessionID: "ses_1",
  directory: "/work/project",
  condition: "tests pass",
  status: "active",
  setAt: 1_000,
  startedAt: 1_000,
  turns: 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [],
  ...overrides,
})

describe("sameDirectory", () => {
  test("treats trailing slashes and mixed separators as equal", () => {
    expect(sameDirectory("/work/project", "/work/project/")).toBe(true)
    expect(sameDirectory("/work/project", "/work//project")).toBe(true)
    expect(sameDirectory("C:\\work\\project", "C:/work/project")).toBe(true)
  })

  test("distinguishes different directories", () => {
    expect(sameDirectory("/work/a", "/work/b")).toBe(false)
  })
})

describe("GoalStore.loadLive", () => {
  test("returns only live records owned by the directory", async () => {
    const storage = new MemoryStorage()
    const store = new GoalStore(storage, () => {})
    const live = record({ sessionID: "ses_a", status: "active" })
    const paused = record({ sessionID: "ses_b", status: "paused" })
    const achieved = record({ sessionID: "ses_c", status: "achieved" })
    const otherDirectory = record({ sessionID: "ses_d", status: "active", directory: "/elsewhere" })
    for (const entry of [live, paused, achieved, otherDirectory]) await store.save(entry)
    await store.flush()
    const found = await store.loadLive("/work/project/")
    expect(found.map((entry) => entry.sessionID).sort()).toEqual(["ses_a", "ses_b"])
  })

  test("skips malformed records instead of failing the restore", async () => {
    const storage = new MemoryStorage()
    const store = new GoalStore(storage, () => {})
    storage.data.set(keyFor("ses_broken"), { nope: true })
    storage.data.set(keyFor("ses_ok"), record({ sessionID: "ses_ok", status: "paused" }))
    const found = await store.loadLive("/work/project")
    expect(found.map((entry) => entry.sessionID)).toEqual(["ses_ok"])
  })

  test("returns nothing when no directory matches", async () => {
    const storage = new MemoryStorage()
    const store = new GoalStore(storage, () => {})
    await store.save(record())
    await store.flush()
    expect(await store.loadLive("/nowhere")).toEqual([])
  })
})

describe("GoalStore.load", () => {
  test("returns the stored record, undefined for missing or malformed values", async () => {
    const storage = new MemoryStorage()
    const store = new GoalStore(storage, () => {})
    expect(await store.load("ses_none")).toBeUndefined()
    storage.data.set(keyFor("ses_broken"), { nope: true })
    expect(await store.load("ses_broken")).toBeUndefined()
    await store.save(record({ sessionID: "ses_ok", status: "paused" }))
    await store.flush()
    expect((await store.load("ses_ok"))?.sessionID).toBe("ses_ok")
  })
})

describe("GoalStore probe mode (read-only)", () => {
  test("saves and removes are dropped; reads still work", async () => {
    const storage = new MemoryStorage()
    const live = new GoalStore(storage, () => {})
    await live.save(record({ sessionID: "ses_live", status: "active" }))
    await live.flush()
    expect(storage.data.has(keyFor("ses_live"))).toBe(true)

    const probe = new GoalStore(storage, () => { throw new Error("probe onError must not fire for dropped writes") }, { readOnly: true })
    // A probe save is a no-op: it reports success so callers behave, but nothing is written.
    expect(await probe.save(record({ sessionID: "ses_probe", status: "active" }))).toBe(true)
    expect(await probe.remove("ses_live")).toBe(true)
    expect(storage.data.has(keyFor("ses_probe"))).toBe(false)
    expect(storage.data.has(keyFor("ses_live"))).toBe(true)
    // Reads pass through untouched.
    expect((await probe.load("ses_live"))?.sessionID).toBe("ses_live")
    expect((await probe.loadLive("/work/project")).map((entry) => entry.sessionID)).toEqual(["ses_live"])
  })
})

describe("GoalStore.loadLive regression: under-validated records", () => {
  test("a live record missing `directory` is skipped, not fatal to the whole restore", async () => {
    const storage = new MemoryStorage()
    const store = new GoalStore(storage, () => {})
    const broken = record({ sessionID: "ses_no_dir" }) as unknown as Record<string, unknown>
    delete broken.directory
    storage.data.set(keyFor("ses_no_dir"), broken)
    storage.data.set(keyFor("ses_ok"), record({ sessionID: "ses_ok", status: "paused" }))
    const found = await store.loadLive("/work/project")
    expect(found.map((entry) => entry.sessionID)).toEqual(["ses_ok"])
  })

  test("a live record with a non-string `directory` is skipped too", async () => {
    const storage = new MemoryStorage()
    const store = new GoalStore(storage, () => {})
    storage.data.set(keyFor("ses_dir_42"), { ...record({ sessionID: "ses_dir_42" }), directory: 42 })
    storage.data.set(keyFor("ses_ok"), record({ sessionID: "ses_ok", status: "paused" }))
    const found = await store.loadLive("/work/project")
    expect(found.map((entry) => entry.sessionID)).toEqual(["ses_ok"])
  })
})

describe("GoalStore.flush", () => {
  test("flush drains writes enqueued while it is awaiting", async () => {
    const storage = new MemoryStorage()
    const written: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((r) => (releaseFirst = r))
    let releaseSecond!: () => void
    const secondGate = new Promise<void>((r) => (releaseSecond = r))
    storage.set = async (key: string, value: unknown) => {
      written.push(key)
      if (key === keyFor("ses_first")) await firstGate
      if (key === keyFor("ses_second")) await secondGate
      storage.data.set(key, structuredClone(value))
    }
    const store = new GoalStore(storage, () => {})
    void store.save(record({ sessionID: "ses_first" }))
    let flushDone = false
    const flushing = store.flush().then(() => {
      flushDone = true
    })
    void store.save(record({ sessionID: "ses_second" })) // enqueued during flush await
    releaseFirst() // first write completes; second body starts and blocks on secondGate
    await new Promise((resolve) => setTimeout(resolve, 0)) // let microtasks settle
    // With the bug, flush resolved while the second write is still in flight.
    expect(flushDone).toBe(false)
    expect(written).toContain(keyFor("ses_second"))
    releaseSecond()
    await flushing
    expect(flushDone).toBe(true)
    expect(written).toEqual([keyFor("ses_first"), keyFor("ses_second")])
  })
})
