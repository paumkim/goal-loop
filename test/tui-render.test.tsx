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
