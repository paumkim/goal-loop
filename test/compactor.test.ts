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
  contextCalls: number
  setContext: (messages: readonly unknown[] | Error) => void
  setCompact: (fn: (sessionID: string) => Promise<void>) => void
  compactor: AutoCompactor
}

function harness(options: Record<string, unknown> = { compactAtTokens: 260_000 }): Harness {
  const clock = new FakeClock()
  const notices: Notice[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const compactCalls: string[] = []
  let contextCalls = 0
  let context: readonly unknown[] | Error = [assistant({ input: 10_000, cache: { read: 255_000, write: 0 } })]
  let compactImpl: (sessionID: string) => Promise<void> = async () => {}
  const silent = {
    info: (m: string) => void infos.push(m),
    warn: (m: string) => void warnings.push(m),
    error: (m: string) => void warnings.push(m),
  }
  const compactor = new AutoCompactor({
    config: resolveConfig(options),
    compact: async (sessionID) => {
      compactCalls.push(sessionID)
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
  })
  return {
    clock,
    notices,
    warnings,
    compactCalls,
    get contextCalls() {
      return contextCalls
    },
    setContext: (m) => void (context = m),
    setCompact: (fn) => void (compactImpl = fn),
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
  test("compactOnLoopIteration=false does not read the context or compact", async () => {
    const h = harness({ compactAtTokens: 260_000, compactOnLoopIteration: false })
    await h.compactor.compactAtBoundary(SID)
    expect(h.contextCalls).toBe(0)
    expect(h.compactCalls).toEqual([])
  })

  test("tiny context (< 10k tokens) is skipped without a notice", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    h.setContext([assistant({ input: 1_000, cache: { read: 2_000, write: 0 } })])
    await h.compactor.compactAtBoundary(SID)
    expect(h.compactCalls).toEqual([])
    expect(h.notices).toEqual([])
  })

  test("context at or above 10k tokens compacts and emits the boundary notice", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    h.setContext([assistant({ input: 8_000, cache: { read: 2_500, write: 0 } })])
    await h.compactor.compactAtBoundary(SID)
    expect(h.compactCalls).toEqual([SID])
    const notice = h.notices.find((n) => n.kind === "compact")
    expect(notice?.level).toBe("info")
    expect(notice?.title).toBe("Auto-compact requested (loop boundary)")
    expect(notice?.message).toContain("~10500")
    expect(notice?.message).toContain("boundary")
  })

  test("no assistant token usage (estimate undefined) compacts with an unknown-size message", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    h.setContext([{ type: "user", text: "hi" }])
    await h.compactor.compactAtBoundary(SID)
    expect(h.compactCalls).toEqual([SID])
    const notice = h.notices.find((n) => n.kind === "compact")
    expect(notice?.title).toBe("Auto-compact requested (loop boundary)")
    expect(notice?.message).toBe("context size unknown; compacting at the loop boundary")
  })

  test("two immediate calls compact only once (in-flight/cooldown honored)", async () => {
    const h = harness({ compactAtTokens: 260_000 })
    await h.compactor.compactAtBoundary(SID)
    await h.compactor.compactAtBoundary(SID)
    expect(h.compactCalls).toEqual([SID])
  })
})
