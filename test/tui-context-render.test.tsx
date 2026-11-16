/**
 * Render-layer proof that after a simulated compaction the finite post-compaction context size
 * paints — and the stale pre-compaction total and the "unknown" state do not. Also pins the
 * re-anchor surfacing contract: a quiet `⟲ N` token on the card's `now` row, never a notice.
 * Headless testRender + captureCharFrame (test/bunfig.toml solid preload); no live-TUI claims.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { HudCard } from "../src/hud-card.tsx"
import { StatusDialogBody } from "../src/status-dialog.tsx"
import type { HistoryTheme } from "../src/tui-history.tsx"
import { estimateContextTokens } from "../src/core/context-size.ts"
import { preserveContextSize } from "../src/core/entries.ts"
import type { GoalSnapshot, VerdictEntry } from "../src/core/types.ts"

const theme: HistoryTheme = {
  text: {
    base: RGBA.fromHex("#e8e8e8"),
    muted: RGBA.fromHex("#a0a0a0"),
    faint: RGBA.fromHex("#6f6f6f"),
    feedback: {
      info: { base: RGBA.fromHex("#6cb6ff") },
      warning: { base: RGBA.fromHex("#e0af3c") },
    },
  },
}

const now = 1_800_000_000_000
const baseline = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const verdicts = (list: VerdictEntry["verdict"][]): VerdictEntry[] =>
  list.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (list.length - index) }))

const loopedGoal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_test",
  sessionID: "ses_test",
  directory: "/tmp/test",
  condition: "ship the release notes",
  status: "active",
  reason: "Evaluator: docs build still fails",
  setAt: now - 1000 * 60 * 42,
  startedAt: now - 1000 * 60 * 42,
  turns: 4,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline,
  history: verdicts(["met", "not_met", "met"]),
  loopEnabled: true,
  loopIteration: 3,
  loopObjective: "make every loop iteration visible at a glance",
  loopMaxLoops: 5,
  loopHistory: [],
  loopNotProgress: 0,
  elapsedMs: 1000 * 60 * 12,
  evaluating: false,
  waiting: false,
  ...overrides,
})

const assistant = (input: number, cacheRead = 0) => ({
  type: "assistant",
  tokens: { input, output: 50, reasoning: 0, cache: { read: cacheRead, write: 0 } },
})
const compaction = () => ({ type: "compaction", status: "completed", reason: "auto", summary: "lossy summary" })

// The pre-compaction context carries a huge step (180k in); after the landing, only the fresh
// post-compaction assistant may be read.
const postCompaction = [assistant(180_000, 5_000), compaction(), assistant(9_000, 500)]
const freshSize = estimateContextTokens(postCompaction)

const stale = loopedGoal({ contextSize: 185_000, compactAtTokens: 150_000, loopCompact: { requestedAt: now - 1000, iteration: 3, misses: 1 } })
// The `changed` snapshot right after the landing: no contextSize, loopCompact.landedAt set.
const landed = (() => {
  const { contextSize: _drop, ...rest } = stale
  return { ...rest, loopCompact: { requestedAt: now - 1000, iteration: 3, misses: 0, landedAt: now } }
})() as unknown as GoalSnapshot

const render = async (node: () => JSX.Element, width = 112, height = 40): Promise<string> => {
  const setup = await testRender(node, { width, height })
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  await setup.renderer.destroy()
  return frame
}

describe("context size after a simulated compaction", () => {
  test("the estimator reads the post-compaction window: known, finite, below the stale total", () => {
    expect(freshSize).toBe(9_500)
    expect(Number.isFinite(freshSize)).toBe(true)
    expect(freshSize as number).toBeLessThan(185_000)
  })

  test("card: the landing snapshot paints no context row — not the stale 185k, not 'unknown'", async () => {
    const merged = preserveContextSize(stale, landed)
    expect(merged?.contextSize).toBeUndefined()
    const frame = await render(() => <HudCard goal={merged!} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).not.toContain("185k")
    expect(frame).not.toContain("unknown")
    expect(frame).not.toContain("context")
  })

  test("card: once the count is re-derived, the finite post-compaction size paints", async () => {
    const merged = preserveContextSize(stale, landed)
    const fresh = { ...merged!, contextSize: freshSize }
    const frame = await render(() => <HudCard goal={fresh} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("9.5k")
    expect(frame).toContain("6%")
    expect(frame).not.toContain("185k")
    expect(frame).not.toContain("unknown")
  })

  test("card: the re-anchor count paints as one quiet ⟲ token on the now row — never a transcript line", async () => {
    const anchored = loopedGoal({ reanchorCount: 2, contextSize: freshSize, compactAtTokens: 150_000 })
    const frame = await render(() => <HudCard goal={anchored} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("⟲ 2")
    // Zero (or legacy absent) paints nothing.
    const bare = await render(() => <HudCard goal={loopedGoal({ contextSize: freshSize, compactAtTokens: 150_000 })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(bare).not.toContain("⟲")
  })

  test("dialog: the finite post-compaction size paints in the overview meter", async () => {
    const fresh = { ...landed, contextSize: freshSize }
    const frame = await render(() => <StatusDialogBody goal={fresh} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("9.5k")
    expect(frame).not.toContain("185k")
    expect(frame).not.toContain("unknown")
  })
})
