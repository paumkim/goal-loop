import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  fifoHead,
  isMergeTurn,
  isStandbyRecord,
  readCoordinatorState,
  STANDBY_PREFIX,
  standbyKey,
  withStandbyActivity,
  type CoordinatorState,
} from "../src/core/coordinator-wait.ts"
import type { BackgroundPort } from "../src/runtime/ports.ts"

const state = (overrides: Partial<CoordinatorState> = {}): CoordinatorState => ({
  leases: {
    earlier: { status: "submitted", submittedAt: "2026-11-25T10:00:00Z" },
    later: { status: "submitted", submittedAt: "2026-11-25T11:00:00Z" },
    working: { status: "claimed", submittedAt: "2026-11-25T09:00:00Z" },
  },
  mergeLock: null,
  ...overrides,
})

describe("coordinator standby", () => {
  test("standby records are keyed by session and validated on read", () => {
    expect(standbyKey("ses_parent")).toBe(`${STANDBY_PREFIX}ses_parent`)
    expect(isStandbyRecord({ slug: "my-slug", address: "ses_parent", at: 1 })).toBe(true)
    expect(isStandbyRecord({ slug: "", address: "ses_parent", at: 1 })).toBe(false)
    expect(isStandbyRecord({ slug: "my-slug", address: "ses_parent" })).toBe(false)
    expect(isStandbyRecord(null)).toBe(false)
  })

  test("the FIFO head is the oldest submitted lease, not the oldest claim", () => {
    expect(fifoHead(state())).toBe("earlier")
    expect(fifoHead(state({ leases: { working: { status: "claimed", createdAt: "2020-01-01T00:00:00Z" } } }))).toBeUndefined()
    expect(
      fifoHead(
        state({
          leases: {
            fallback: { status: "submitted", createdAt: "2020-01-01T00:00:00Z" },
            stamped: { status: "submitted", submittedAt: "2021-01-01T00:00:00Z" },
          },
        }),
      ),
    ).toBe("fallback")
  })

  test("only the head lease is its own merge turn", () => {
    expect(isMergeTurn(state(), "earlier")).toBe(true)
    expect(isMergeTurn(state(), "later")).toBe(false)
    expect(isMergeTurn(state(), "working")).toBe(false)
    expect(isMergeTurn(state(), "missing")).toBe(false)
  })

  test("a lease that is no longer submitted or has no state is not a turn", () => {
    expect(isMergeTurn(state({ leases: { earlier: { status: "done" } } }), "earlier")).toBe(false)
    expect(isMergeTurn(state({ leases: {} }), "earlier")).toBe(false)
    expect(isMergeTurn({}, "earlier")).toBe(false)
  })

  test("a live merge lock defers the wake until it clears", () => {
    expect(isMergeTurn(state({ mergeLock: { holder: "other" } }), "earlier")).toBe(false)
    expect(isMergeTurn(state({ mergeLock: null }), "earlier")).toBe(true)
  })

  test("a parked session counts as active work, so the evaluator defers instead of calling it stale", async () => {
    const real: BackgroundPort = {
      busy: async () => ({ subagents: 0, shells: 1 }),
      ancestorsOf: async () => ["ses_parent"],
    }
    const parked = new Set(["ses_waiting"])
    const wrapped = withStandbyActivity(real, (id) => parked.has(id))
    expect(await wrapped.busy("ses_waiting")).toEqual({ subagents: 1, shells: 1 })
    expect(await wrapped.busy("ses_other")).toEqual({ subagents: 0, shells: 1 })
    expect(await wrapped.ancestorsOf?.("ses_waiting")).toEqual(["ses_parent"])
    parked.delete("ses_waiting")
    expect(await wrapped.busy("ses_waiting")).toEqual({ subagents: 0, shells: 1 })
  })

  test("unreadable or malformed coordinator state never yields a turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coordinator-wait-"))
    try {
      const path = join(dir, "state.json")
      expect(await readCoordinatorState(path)).toBeUndefined()
      await writeFile(path, "not json")
      expect(await readCoordinatorState(path)).toBeUndefined()
      await writeFile(path, JSON.stringify({ leases: [], mergeLock: null }))
      expect(await readCoordinatorState(path)).toBeUndefined()
      await writeFile(path, JSON.stringify(state()))
      expect(isMergeTurn((await readCoordinatorState(path))!, "earlier")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
