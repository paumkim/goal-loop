/**
 * Headless render tests for the `/goal` detail-dialog components (`src/status-dialog.tsx`) and the
 * history sections (`src/tui-history.tsx`). Previously these were only manually render-verified via
 * scripts/render-dialog.tsx / scripts/render-history.tsx, which are not wired into `bun run check`.
 * These tests mount the components in @opentui/solid's test renderer and assert on the captured
 * character grid. Requires the solid preload (test/bunfig.toml).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { StatusDialogBody } from "../src/status-dialog.tsx"
import { HistoryBlock, LoopSection, type HistoryTheme } from "../src/tui-history.tsx"
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
const spend = { cost: 0.42, input: 182_000, output: 21_400, reasoning: 3_100, cacheRead: 96_000, cacheWrite: 0 }

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
  history: verdicts(["met", "not_met", "met", "met", "not_met"]),
  loopEnabled: true,
  loopIteration: 3,
  loopObjective: "make every loop iteration visible at a glance",
  loopMaxLoops: 5,
  loopHistory: [
    { version: 1, condition: "add a progress bar", summary: "Added an 18-cell block progress bar.", reason: "met", turns: 9, toolCalls: 41, endedAt: now - 1000 * 60 * 27 },
    { version: 2, condition: "render the verdict trail", summary: "Trail renders up to 24 verdicts.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12 },
  ],
  loopNotProgress: 0,
  elapsedMs: 1000 * 60 * 12,
  evaluating: false,
  waiting: false,
  spend,
  ...overrides,
})

const plainGoal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => {
  const { loopEnabled: _a, loopIteration: _b, loopObjective: _c, loopMaxLoops: _d, loopHistory: _e, loopNotProgress: _f, ...rest } = loopedGoal()
  return { ...rest, id: "goal_plain", ...overrides }
}

const render = async (node: () => JSX.Element, width = 112, height = 40): Promise<string> => {
  const setup = await testRender(node, { width, height })
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  await setup.renderer.destroy()
  return frame
}


describe("LoopSection", () => {
  test("renders caption, bar, objective, rail rows, now row and trail", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("loop")
    expect(frame).toContain("v3 of at most 5 · 2 complete")
    expect(frame).toContain("██")
    expect(frame).toContain("objective")
    expect(frame).toContain("make every loop iteration visible at a glance")
    expect(frame).toContain("v1")
    expect(frame).toContain("v2")
    expect(frame).toContain("9 turns · 41 tools")
    expect(frame).toContain("Added an 18-cell block progress bar.")
    expect(frame).toContain("now")
    expect(frame).toContain("v3 · active · 4 turns")
    expect(frame).toContain("trail")
    expect(frame).not.toContain("final")
  })

  test("finished loop renders the final tally row", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ status: "achieved" })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />)
    expect(frame).toContain("final")
    expect(frame).toContain("loop achieved · 2 iterations · 15 turns · 64 tools")
  })

  test("paused loop shows stall/retries diagnostics in the now row", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ status: "paused", stall: 3, retries: 2 })} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("paused")
    expect(frame).toContain("stall 3 · retries 2")
  })
})

describe("HistoryBlock", () => {
  test("renders last verdict, counts and trail for a non-looped goal", async () => {
    const frame = await render(() => <HistoryBlock goal={plainGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 41} />)
    expect(frame).toContain("history")
    expect(frame).toContain("last not met (turn 5)")
    expect(frame).toContain("3 met · 2 not_met")
    expect(frame).toContain("trail")
  })

  test("fresh goal degrades to 'no verdicts yet' plus elapsed", async () => {
    const frame = await render(() => <HistoryBlock goal={plainGoal({ history: [], turns: 0 })} theme={theme} elapsedMs={() => 1000 * 60 * 2} />)
    expect(frame).toContain("no verdicts yet")
    expect(frame).toContain("elapsed")
  })
})

describe("StatusDialogBody", () => {
  test("undefined goal renders the fallback text", async () => {
    const frame = await render(() => <StatusDialogBody goal={undefined} fallback="no cached goal snapshot" theme={theme} elapsedMs={() => 0} nowMs={() => now} />)
    expect(frame).toContain("no cached goal snapshot")
  })

  test("active looped goal shows the evaluator label and the loop section, not the history block", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("active")
    expect(frame).toContain("evaluator")
    expect(frame).toContain("ship the release notes")
    expect(frame).toContain("spend")
    expect(frame).toContain("objective") // LoopSection
    expect(frame).not.toContain("history\n") // HistoryBlock header absent for looped goals
  })

  test("non-looped goal with reason shows the reason label and the history block", async () => {
    const frame = await render(() => <StatusDialogBody goal={plainGoal({ status: "paused", reason: "two consecutive iterations without tool use" })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("paused")
    expect(frame).toContain("reason")
    expect(frame).toContain("two consecutive iterations without tool use")
    expect(frame).toContain("history")
  })
})

describe("LoopSection edge paths", () => {
  test("fresh loop with no verdicts renders no trail row, caption 'v1 · 0 complete', and no pace row", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ history: [], loopHistory: [], loopIteration: 1, turns: 0 })} theme={theme} elapsedMs={() => 1000 * 30} nowMs={() => now} />)
    expect(frame).toContain("v1 of at most 5 · 0 complete")
    expect(frame).not.toContain("trail")
    expect(frame).not.toContain("pace")
  })

  test("loop without a cap renders no 'of at most' in the caption and no pace row", async () => {
    const { loopMaxLoops: _max, ...noCap } = loopedGoal()
    const frame = await render(() => <LoopSection goal={noCap} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("v3 · 2 complete")
    expect(frame).not.toContain("of at most")
    expect(frame).not.toContain("pace")
  })

  test("a history longer than the trail window renders the '24 of 30 verdicts' caption", async () => {
    const calls: VerdictEntry["verdict"][] = []
    for (let index = 0; index < 30; index += 1) calls.push(index % 3 === 2 ? "not_met" : "met")
    const frame = await render(() => <LoopSection goal={loopedGoal({ history: verdicts(calls) })} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("24 of 30 verdicts")
  })

  test("a rail summary longer than the cap is truncated with an ellipsis, not rendered in full", async () => {
    const longSummary = `the quick brown fox ${"jumps over the lazy dog ".repeat(20)}end`
    expect(longSummary.length).toBeGreaterThan(400)
    const frame = await render(() => <LoopSection goal={loopedGoal({ loopHistory: [{ version: 1, condition: "c", summary: longSummary, reason: "met", turns: 3, toolCalls: 5, endedAt: now - 1000 * 60 * 5 }], loopIteration: 2 })} theme={theme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />)
    expect(frame).not.toContain(longSummary)
    expect(frame).toContain("…")
  })

  test("rail entries with a blank summary render no connector line", async () => {
    const blank = [{ version: 1, condition: "c", summary: "   ", reason: "met", turns: 3, toolCalls: 5, endedAt: now - 1000 * 60 * 5 }]
    const frame = await render(() => <LoopSection goal={loopedGoal({ loopHistory: blank, loopIteration: 2 })} theme={theme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />)
    expect(frame).not.toContain("│")
  })

  test("a verdict inside the current iteration renders the 'last' suffix with 'this turn'", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ history: [{ turn: 4, verdict: "met", reason: "ok", at: now - 5_000 }], turns: 4 })} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("last")
    expect(frame).toContain("this turn")
  })

  test("a current-iteration verdict older than the turn counter renders 'N turns since'", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ history: [{ turn: 3, verdict: "not_met", reason: "no", at: now - 5_000 }], turns: 5 })} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("2 turns since")
  })

  test("a verdict streak of two renders the streak suffix in the now row", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ history: verdicts(["met", "not_met", "not_met"]) })} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("2× not met in a row")
  })

  test("a cap reached with a non-terminal status still renders the final tally row", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ status: "active", loopMaxLoops: 2 })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />)
    expect(frame).toContain("final")
    expect(frame).toContain("loop active · 2 iterations")
  })

  test("an impossible loop renders the ⊘ glyph in the final tally", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ status: "impossible" })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />)
    expect(frame).toContain("loop impossible · 2 iterations")
    expect(frame).toContain("⊘")
  })

  test("a cleared loop renders the ✗ glyph and 'loop cleared' in the final tally", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ status: "cleared" })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />)
    expect(frame).toContain("loop cleared · 2 iterations")
    expect(frame).toContain("✗")
  })

  test("a failed loop renders 'loop failed' in the final tally", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ status: "failed" })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />)
    expect(frame).toContain("loop failed · 2 iterations")
  })

  test("a pending boundary compaction renders the pending age and the miss counter", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ loopCompact: { requestedAt: now - 1000 * 60 * 3, estimatedTokens: 182_000, iteration: 3, misses: 2 } })} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("compact")
    expect(frame).toContain("pending")
    expect(frame).toContain("miss 2/4")
    expect(frame).toContain("~182k at request")
  })

  test("a landed boundary compaction renders the landed age and no miss counter", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ loopCompact: { requestedAt: now - 1000 * 60 * 5, landedAt: now - 1000 * 60, iteration: 3, misses: 0 } })} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("compact")
    expect(frame).toContain("landed")
    expect(frame).not.toContain("miss")
  })
})

describe("HistoryBlock edge paths", () => {
  test("impossible verdicts surface in the counts line", async () => {
    const frame = await render(() => <HistoryBlock goal={plainGoal({ history: verdicts(["met", "not_met", "impossible"]), turns: 3 })} theme={theme} elapsedMs={() => 1000 * 60 * 41} />)
    expect(frame).toContain("1 impossible")
    expect(frame).toContain("⊘")
  })

  test("a trailing streak renders the streak suffix in the last-verdict line", async () => {
    const frame = await render(() => <HistoryBlock goal={plainGoal({ history: verdicts(["not_met", "met", "met"]), turns: 3 })} theme={theme} elapsedMs={() => 1000 * 60 * 41} />)
    expect(frame).toContain("2× met in a row")
  })
})

describe("StatusDialogBody edge paths", () => {
  test("an evaluating goal shows 'checking' in the state line", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ evaluating: true })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("checking")
  })

  test("a waiting goal shows 'waiting' in the state line", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ waiting: true })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("waiting")
  })

  test("a goal without a spend snapshot omits the spend row", async () => {
    const { spend: _spend, ...noSpend } = loopedGoal()
    const frame = await render(() => <StatusDialogBody goal={noSpend} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).not.toContain("spend")
  })
})
