import { describe, expect, test } from "bun:test"
import { estimateContextTokens } from "../src/core/context-size.ts"
import { resolveConfig } from "../src/core/config.ts"
import type { Notice } from "../src/core/types.ts"
import { AutoCompactor } from "../src/runtime/compactor.ts"
import type { Clock } from "../src/runtime/ports.ts"

const SID = "ses_1"

class FakeClock implements Clock {
  t = 1_000_000
  now = () => this.t
  setTimeout = () => 0
  clearTimeout = () => {}
}

const assistant = (tokens?: Record<string, unknown>) => ({ type: "assistant", ...(tokens ? { tokens } : {}) })

describe("estimateContextTokens", () => {
  test("empty array returns undefined", () => {
    expect(estimateContextTokens([])).toBeUndefined()
  })

  test("assistant with full tokens returns input + cache read + cache write", () => {
    const messages = [assistant({ input: 1_000, output: 500, reasoning: 100, cache: { read: 250_000, write: 10_000 } })]
    expect(estimateContextTokens(messages)).toBe(261_000)
  })

  test("assistant missing tokens returns undefined", () => {
    expect(estimateContextTokens([assistant()])).toBeUndefined()
    expect(estimateContextTokens([assistant({ output: 10 })])).toBeUndefined()
    expect(estimateContextTokens([assistant({ cache: {} })])).toBeUndefined()
  })

  test("user and compaction messages are ignored; the last assistant wins", () => {
    const messages = [
      assistant({ input: 50, cache: { read: 50, write: 50 } }),
      { type: "user", text: "hi" },
      { type: "compaction", summary: "…" },
      assistant({ input: 2_000, cache: { read: 258_000, write: 0 } }),
      { type: "user", text: "again" },
    ]
    expect(estimateContextTokens(messages)).toBe(260_000)
  })

  test("missing cache fields are treated as zero", () => {
    expect(estimateContextTokens([assistant({ input: 1_000 })])).toBe(1_000)
    expect(estimateContextTokens([assistant({ input: 1_000, cache: { read: 500 } })])).toBe(1_500)
  })
})

interface Harness {
  clock: FakeClock
  notices: Notice[]
  warnings: string[]
  compactCalls: string[]
  coldCompactCalls: string[]
  contextCalls: number
  setContext: (messages: readonly unknown[] | Error) => void
  setCompact: (fn: (sessionID: string) => Promise<void>) => void
  setBusy: (value: boolean) => void
  compactor: AutoCompactor
}

function harness(options: Record<string, unknown> = { compactAtTokens: 260_000 }): Harness {
  const clock = new FakeClock()
  const notices: Notice[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const compactCalls: string[] = []
  const coldCompactCalls: string[] = []
  let contextCalls = 0
  let busy = false
  let context: readonly unknown[] | Error = [assistant({ input: 10_000, cache: { read: 255_000, write: 0 } })]
  let compactImpl: (sessionID: string) => Promise<void> = async () => {}
  const silent = {
    info: (m: string) => void infos.push(m),
    warn: (m: string) => void warnings.push(m),
    error: (m: string) => void warnings.push(m),
  }
  const compactor = new AutoCompactor({
    config: resolveConfig(options),
    compact: async (sessionID, opts) => {
      compactCalls.push(sessionID)
      if (opts?.cold) coldCompactCalls.push(sessionID)
      return compactImpl(sessionID)
    },
    context: async () => {
      contextCalls += 1
      if (context instanceof Error) throw context
      return context
    },
    emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
    clock,
    log: silent,
    isBusy: async () => busy,
  })
  return {
    clock,
    notices,
    warnings,
    compactCalls,
    coldCompactCalls,
    get contextCalls() {
      return contextCalls
    },
    setContext: (m) => void (context = m),
    setCompact: (fn) => void (compactImpl = fn),
    setBusy: (value) => void (busy = value),
    compactor,
  }
}

describe("AutoCompactor.maybeCompact", () => {
  test("over-threshold context compacts once and emits a compact notice", async () => {
    const h = harness()
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID])
    const notice = h.notices.find((n) => n.kind === "compact")
    expect(notice?.level).toBe("info")
    expect(notice?.title).toBe("Auto-compact requested")
    expect(notice?.message).toContain("~265000")
    expect(notice?.message).toContain("260000")
  })

  test("second call within the cooldown does not compact again", async () => {
    const h = harness()
    await h.compactor.maybeCompact(SID)
    h.compactor.noteCompactionEnded(SID, true)
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID])
  })

  test("compacts again after the compaction ended and the cooldown elapsed", async () => {
    const h = harness()
    await h.compactor.maybeCompact(SID)
    h.compactor.noteCompactionEnded(SID, true)
    h.clock.t += 121_000
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID, SID])
  })

  test("under-threshold context does nothing", async () => {
    const h = harness()
    h.setContext([assistant({ input: 100, cache: { read: 100, write: 0 } })])
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([])
    expect(h.notices).toEqual([])
  })

  test("compactAtTokens = 0 disables the feature without reading the context", async () => {
    const h = harness({ compactAtTokens: 0 })
    await h.compactor.maybeCompact(SID)
    expect(h.contextCalls).toBe(0)
    expect(h.compactCalls).toEqual([])
  })

  test("compact() throwing logs a warning, emits a warning notice, clears in-flight, and allows retry after cooldown", async () => {
    const h = harness()
    h.setCompact(async () => {
      throw new Error("host rejected compaction")
    })
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID])
    expect(h.warnings.some((m) => m.includes("compaction failed to start"))).toBe(true)
    const notice = h.notices.find((n) => n.kind === "compact" && n.level === "warning")
    expect(notice?.title).toBe("Auto-compact failed to start")
    expect(notice?.message).toContain("host rejected compaction")
    // In-flight was cleared: a compaction-started event is not required to unblock.
    // Within the cooldown no retry happens…
    h.setCompact(async () => {})
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID])
    // …but after the cooldown it retries.
    h.clock.t += 121_000
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID, SID])
  })

  test("noteCompactionStarted blocks maybeCompact until noteCompactionEnded", async () => {
    const h = harness()
    h.compactor.noteCompactionStarted(SID)
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([])
    expect(h.contextCalls).toBe(0)
    h.compactor.noteCompactionEnded(SID, true)
    h.clock.t += 121_000
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID])
  })

  test("context read failure is logged and does not compact", async () => {
    const h = harness()
    h.setContext(new Error("context unavailable"))
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([])
    expect(h.warnings.some((m) => m.includes("could not read the session context"))).toBe(true)
  })

  test("context without assistant token usage does not compact", async () => {
    const h = harness()
    h.setContext([{ type: "user", text: "hi" }])
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([])
  })

  test("onSessionDeleted forgets cooldown and in-flight state", async () => {
    const h = harness()
    await h.compactor.maybeCompact(SID)
    h.compactor.noteCompactionEnded(SID, true)
    h.compactor.onSessionDeleted(SID)
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID, SID])
  })

  test("noteCompactionEnded with !ok emits a warning notice", async () => {
    const h = harness()
    h.compactor.noteCompactionStarted(SID)
    h.compactor.noteCompactionEnded(SID, false, "timed out")
    const notice = h.notices.find((n) => n.kind === "compact" && n.level === "warning")
    expect(notice?.title).toBe("Auto-compact failed")
    expect(notice?.message).toContain("timed out")
  })
})

describe("AutoCompactor.compactAtBoundary", () => {
  test("compactOnLoopIteration=false returns disabled without reading the context or compacting", async () => {
    const h = harness({ compactAtTokens: 260_000, compactOnLoopIteration: false })
    const result = await h.compactor.compactAtBoundary(SID)
    expect(result).toEqual({ requested: false, reason: "disabled" })
    expect(h.contextCalls).toBe(0)
    expect(h.compactCalls).toEqual([])
  })

  test("tiny context (< 10k tokens) is skipped without a notice", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    h.setContext([assistant({ input: 1_000, cache: { read: 2_000, write: 0 } })])
    const result = await h.compactor.compactAtBoundary(SID)
    expect(result).toEqual({ requested: false, reason: "too-small" })
    expect(h.compactCalls).toEqual([])
    expect(h.notices).toEqual([])
  })

  test("context at or above 10k tokens compacts and returns the estimated size", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    h.setContext([assistant({ input: 8_000, cache: { read: 2_500, write: 0 } })])
    const result = await h.compactor.compactAtBoundary(SID)
    expect(result).toEqual({ requested: true, estimatedTokens: 10_500 })
    expect(h.compactCalls).toEqual([SID])
    const notice = h.notices.find((n) => n.kind === "compact")
    expect(notice?.level).toBe("info")
    expect(notice?.title).toBe("Auto-compact requested (loop boundary)")
    expect(notice?.message).toContain("~10500")
    expect(notice?.message).toContain("boundary")
  })

  test("no assistant token usage (estimate undefined) compacts with an unknown-size result", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    h.setContext([{ type: "user", text: "hi" }])
    const result = await h.compactor.compactAtBoundary(SID)
    expect(result).toEqual({ requested: true })
    expect(h.compactCalls).toEqual([SID])
    const notice = h.notices.find((n) => n.kind === "compact")
    expect(notice?.title).toBe("Auto-compact requested (loop boundary)")
    expect(notice?.message).toBe("context size unknown; compacting at the loop boundary")
  })

  test("two immediate calls compact only once (in-flight/cooldown honored)", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    const first = await h.compactor.compactAtBoundary(SID)
    const second = await h.compactor.compactAtBoundary(SID)
    expect(first).toEqual(expect.objectContaining({ requested: true }))
    expect(second).toEqual({ requested: false, reason: "in-flight" })
    expect(h.compactCalls).toEqual([SID])
  })

  test("work in flight defers the compaction without requesting anything", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    h.setBusy(true)
    const result = await h.compactor.compactAtBoundary(SID, { cold: true })
    expect(result).toEqual({ requested: false, reason: "busy" })
    expect(h.compactCalls).toEqual([])
    expect(h.coldCompactCalls).toEqual([])
    expect(h.contextCalls).toBe(0)
  })

  test("cold is forwarded only to a host call that actually happens", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    const result = await h.compactor.compactAtBoundary(SID, { cold: true })
    expect(result).toEqual(expect.objectContaining({ requested: true }))
    expect(h.compactCalls).toEqual([SID])
    expect(h.coldCompactCalls).toEqual([SID])

    // A skipped request must not leave the session primed for a cold replay later.
    const skipped = harness({ compactAtTokens: 260_000 })
    skipped.setContext([assistant({ input: 1_000, cache: { read: 0, write: 0 } })])
    expect(await skipped.compactor.compactAtBoundary(SID, { cold: true })).toEqual({ requested: false, reason: "too-small" })
    expect(skipped.coldCompactCalls).toEqual([])
  })

  test("maybeCompact defers while work is in flight", async () => {
    const h = harness()
    h.setBusy(true)
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([])
    expect(h.contextCalls).toBe(0)
  })

  test("maybeCompact runs again once the work ends", async () => {
    const h = harness()
    h.setBusy(true)
    await h.compactor.maybeCompact(SID)
    h.setBusy(false)
    await h.compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([SID])
  })

  test("re-checks in-flight before compacting when another path marks compaction during the context read", async () => {
    const clock = new FakeClock()
    const notices: Notice[] = []
    const compactCalls: string[] = []
    let compactor!: AutoCompactor
    compactor = new AutoCompactor({
      config: resolveConfig({ compactAtTokens: 260_000 }),
      compact: async (sessionID) => {
        compactCalls.push(sessionID)
      },
      context: async () => {
        compactor.noteCompactionStarted(SID)
        return [assistant({ input: 10_000, cache: { read: 255_000, write: 0 } })]
      },
      emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
      clock,
      log: { info() {}, warn() {}, error() {} },
    })
    await compactor.maybeCompact(SID)
    expect(compactCalls).toEqual([])
    expect(notices.some((n) => n.kind === "compact" && n.title === "Auto-compact requested")).toBe(false)
  })

  test("force skips the cooldown but never the in-flight or busy gate", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    await h.compactor.compactAtBoundary(SID)
    h.compactor.noteCompactionEnded(SID, true)
    // Within the cooldown an ordinary request is denied…
    expect(await h.compactor.compactAtBoundary(SID)).toEqual({ requested: false, reason: "cooldown" })
    // …but a forced request goes through.
    expect(await h.compactor.compactAtBoundary(SID, { force: true })).toEqual(expect.objectContaining({ requested: true }))
    h.compactor.noteCompactionEnded(SID, true)
    // Force never bypasses the busy gate.
    h.setBusy(true)
    expect(await h.compactor.compactAtBoundary(SID, { force: true })).toEqual({ requested: false, reason: "busy" })
    // …and never the in-flight gate.
    h.setBusy(false)
    h.compactor.noteCompactionStarted(SID)
    expect(await h.compactor.compactAtBoundary(SID, { force: true })).toEqual({ requested: false, reason: "in-flight" })
  })

  test("re-checks in-flight before compacting when another path marks compaction during the context read", async () => {
    const clock = new FakeClock()
    const notices: Notice[] = []
    const compactCalls: string[] = []
    let compactor!: AutoCompactor
    compactor = new AutoCompactor({
      config: resolveConfig({ compactAtTokens: 260_000 }),
      compact: async (sessionID) => {
        compactCalls.push(sessionID)
      },
      context: async () => {
        compactor.noteCompactionStarted(SID)
        return [assistant({ input: 8_000, cache: { read: 2_500, write: 0 } })]
      },
      emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
      clock,
      log: { info() {}, warn() {}, error() {} },
    })
    const result = await compactor.compactAtBoundary(SID)
    expect(result).toEqual({ requested: false, reason: "in-flight" })
    expect(compactCalls).toEqual([])
    expect(notices.some((n) => n.kind === "compact" && n.title === "Auto-compact requested (loop boundary)")).toBe(false)
  })

  test("a busy check that throws fails closed (defers the compaction)", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    const throwing = new AutoCompactor({
      config: resolveConfig({ compactAtTokens: 260_000 }),
      compact: async () => void h.compactCalls.push(SID),
      context: async () => [assistant({ input: 10_000 })],
      emitter: { changed: () => {}, notice: () => {} },
      clock: h.clock,
      log: { info() {}, warn() {}, error() {} },
      isBusy: async () => {
        throw new Error("busy probe down")
      },
    })
    expect(await throwing.compactAtBoundary(SID)).toEqual({ requested: false, reason: "busy" })
    expect(h.compactCalls).toEqual([])
  })
})

describe("AutoCompactor regression: work that starts during the context read", () => {
  test("maybeCompact defers when the session starts work during the context fetch", async () => {
    const h = harness()
    let busy = false
    const compactor = new AutoCompactor({
      config: resolveConfig({ compactAtTokens: 260_000 }),
      compact: async (sessionID) => void h.compactCalls.push(sessionID),
      context: async () => {
        busy = true // the turn starts while the context read is in flight
        return [assistant({ input: 10_000, cache: { read: 255_000, write: 0 } })]
      },
      emitter: { changed: () => {}, notice: (n) => void h.notices.push(n) },
      clock: h.clock,
      log: { info() {}, warn() {}, error() {} },
      isBusy: async () => busy,
    })
    await compactor.maybeCompact(SID)
    expect(h.compactCalls).toEqual([])
  })

  test("compactAtBoundary reports busy when the session starts work during the context fetch", async () => {
    const h = harness({ compactOnLoopIteration: true })
    let busy = false
    const compactor = new AutoCompactor({
      config: resolveConfig({ compactOnLoopIteration: true }),
      compact: async (sessionID) => void h.compactCalls.push(sessionID),
      context: async () => {
        busy = true
        return [assistant({ input: 10_000, cache: { read: 100, write: 0 } })]
      },
      emitter: { changed: () => {}, notice: (n) => void h.notices.push(n) },
      clock: h.clock,
      log: { info() {}, warn() {}, error() {} },
      isBusy: async () => busy,
    })
    const result = await compactor.compactAtBoundary(SID)
    expect(result).toEqual({ requested: false, reason: "busy" })
    expect(h.compactCalls).toEqual([])
  })
})
