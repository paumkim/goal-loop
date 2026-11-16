/**
 * Headless render tests for the `/goal` detail-dialog components (`src/status-dialog.tsx`) and the
 * history sections (`src/tui-history.tsx`). Previously these were only manually render-verified via
 * scripts/render-dialog.tsx / scripts/render-history.tsx, which are not wired into `bun run check`.
 * These tests mount the components in @opentui/solid's test renderer and assert on the captured
 * character grid. Requires the solid preload (test/bunfig.toml).
 */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import { RGBA, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { StatusDialogBody } from "../src/status-dialog.tsx"
import { DialogFooter, HudCard, hudCardRows } from "../src/hud-card.tsx"
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

const bigLoopGoal = (): GoalSnapshot => loopedGoal({
  turns: 33,
  loopIteration: 7,
  loopMaxLoops: 8,
  history: verdicts(["met", "not_met", "met", "met", "met", "met"]),
  loopHistory: [1, 2, 3, 4, 5, 6].map((version) => ({
    version,
    condition: `objective pass ${version}`,
    summary: `Summary of iteration ${version} work.`,
    reason: "met",
    turns: 5,
    toolCalls: 9,
    endedAt: now - 1000 * 60 * (60 - version * 5),
  })),
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
  test("at 80 cells the rail row wraps instead of clipping its trailing segments", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, 80, 40)
    expect(frame).toContain("met · 9 turns · 41 tools")
    expect(frame).toContain("ended")
    expect(frame).toContain("of wall")
  })

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

  test("the context row renders arm-size bars per completed iteration and is omitted without estimates", async () => {
    const withContext = loopedGoal({
      loopHistory: [
        { version: 1, condition: "add a progress bar", summary: "Added an 18-cell block progress bar.", reason: "met", turns: 9, toolCalls: 41, endedAt: now - 1000 * 60 * 27, contextTokens: 41_000 },
        { version: 2, condition: "render the verdict trail", summary: "Trail renders up to 24 verdicts.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12, contextTokens: 91_000 },
      ],
    })
    const frame = await render(() => <LoopSection goal={withContext} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("context")
    expect(frame).toContain("▄█")
    expect(frame).toContain("~91k peak · arm sizes, oldest→newest")
    const bare = await render(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(bare).not.toContain("arm sizes, oldest→newest")
  })

  test("the rail row names the commit HEAD had landed on (stamped sha)", async () => {
    const stamped = loopedGoal({
      loopHistory: [
        { version: 1, condition: "add a progress bar", summary: "Added an 18-cell block progress bar.", reason: "met", turns: 9, toolCalls: 41, endedAt: now - 1000 * 60 * 27, sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9001122334" },
        { version: 2, condition: "render the verdict trail", summary: "Trail renders up to 24 verdicts.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12 },
      ],
    })
    const frame = await render(() => <LoopSection goal={stamped} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("a1b2c3d")
    const bare = await render(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(bare).not.toContain("a1b2c3d")
  })

  test("finished loop renders the final tally row", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ status: "achieved" })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />)
    expect(frame).toContain("final")
    expect(frame).toContain("loop achieved · 2 iterations · 15 turns · 64 tools")
  })

  test("the final tally carries the loop's measured spend — complete when every iteration measured, honestly partial otherwise", async () => {
    const stamped = (list: NonNullable<GoalSnapshot["loopHistory"]>) => loopedGoal({ status: "achieved", loopHistory: list })
    const full = await render(() => (
      <LoopSection
        goal={stamped([
          { version: 1, condition: "add a bar", summary: "Added a bar.", reason: "met", turns: 9, toolCalls: 41, endedAt: now - 1000 * 60 * 27, spend: { ...spend, cost: 0.25 } },
          { version: 2, condition: "render the trail", summary: "Trail renders.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12, spend: { ...spend, cost: 0.5 } },
        ])}
        theme={theme}
        elapsedMs={() => 1000 * 60 * 39}
        nowMs={() => now}
      />
    ))
    expect(full).toContain("$0.75")
    expect(full).not.toContain("measured")
    const partial = await render(() => (
      <LoopSection
        goal={stamped([
          { version: 1, condition: "add a bar", summary: "Added a bar.", reason: "met", turns: 9, toolCalls: 41, endedAt: now - 1000 * 60 * 27, spend: { ...spend, cost: 0.42 } },
          { version: 2, condition: "render the trail", summary: "Trail renders.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12 },
        ])}
        theme={theme}
        elapsedMs={() => 1000 * 60 * 39}
        nowMs={() => now}
      />
    ))
    expect(partial).toContain("$0.42")
    expect(partial).toContain("across 1/2 measured")
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

  test("active looped goal, overview tab: the full dashboard — state at a glance plus everything the bar's level (c) names", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("active")
    expect(frame).toContain("evaluator")
    expect(frame).toContain("ship the release notes")
    expect(frame).toContain("spend")
    expect(frame).toContain("v3/5") // the loop position rides the state row — winning is one glance away
    expect(frame).toContain("objective") // LoopSection — the history stays on the default dashboard
  })

  test("active looped goal, ledger tab: the focus view — strip, the state row and the history, nothing else", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "ledger"} />)
    expect(frame).toContain("objective") // LoopSection
    expect(frame).toContain("v3") // the live row
    expect(frame).not.toContain("ship the release notes") // the condition rides the overview
    expect(frame).not.toContain("spend") // the spend row rides the overview
  })

  test("non-looped goal, overview tab: the full dashboard — the reason and the history block ride it", async () => {
    const frame = await render(() => <StatusDialogBody goal={plainGoal({ status: "paused", reason: "two consecutive iterations without tool use" })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("paused")
    expect(frame).toContain("two consecutive iterations without tool use")
    expect(frame).toContain("history")
  })

  test("non-looped goal, ledger tab: the history block rides it, the reason does not", async () => {
    const frame = await render(() => <StatusDialogBody goal={plainGoal({ status: "paused", reason: "two consecutive iterations without tool use" })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "ledger"} />)
    expect(frame).toContain("paused")
    expect(frame).toContain("history")
    expect(frame).not.toContain("two consecutive iterations without tool use") // the reason row rides the overview tab
  })

  test("hot loop, ledger tab: the failure-first remediation rides the focus view — the one row it keeps", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, loopCompact: { requestedAt: now, iteration: 3, misses: 2 } })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "ledger"} />)
    expect(frame).toContain("fix")
    expect(frame).toContain("compact pending 2/4")
    expect(frame).toContain("evaluator.verifyCommand")
    expect(frame).not.toContain("ship the release notes") // the condition stays overview-only — the fix row is the one exception
  })

  test("hot loop, overview tab: the remediation still rides the full dashboard (regression guard)", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, loopCompact: { requestedAt: now, iteration: 3, misses: 2 } })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("fix")
    expect(frame).toContain("compact pending 2/4")
  })

  test("nominal loop, ledger tab: no remediation exists, so the focus view stays lean", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "ledger"} />)
    expect(frame).not.toContain("fix")
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
    expect(frame).toContain("2x not met in a row")
  })

  test("a cap reached with a non-terminal status still renders the final tally row", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal({ status: "active", loopMaxLoops: 2 })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />)
    expect(frame).toContain("final")
    expect(frame).toContain("loop active · 2 iterations")
  })

  test("a finished loop retires its live row — no 'now' above the final tally; an active loop still paints it", async () => {
    const live = await render(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(live).toContain("now")
    expect(live).toContain("v3 · active · 4 turns")
    const done = await render(() => <LoopSection goal={loopedGoal({ status: "achieved" })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />)
    expect(done).toContain("final")
    expect(done).toContain("loop achieved")
    expect(done).not.toContain("now")
    expect(done).not.toContain("this turn")
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
    expect(frame).toContain("2x met in a row")
  })
})

describe("StatusDialogBody snapshot staleness", () => {
  test("noticeStale paints a faint snapshot-unavailable line above stale chrome", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} noticeStale={() => true} />)
    expect(frame).toContain("snapshot unavailable - showing last known state")
  })

  test("default and explicit false noticeStale paints nothing", async () => {
    const absent = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(absent).not.toContain("snapshot unavailable")
    const falseFrame = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} noticeStale={() => false} />)
    expect(falseFrame).not.toContain("snapshot unavailable")
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

describe("context meter row", () => {
  test("renders the bar and the honest ratio against the auto-compact threshold", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000 })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("context")
    expect(frame).toContain("~95k of 150k")
    expect(frame).toContain("63%")
    expect(frame).toContain("█".repeat(10))
  })

  test("the hot band (≥80% of threshold) renders the warning copy", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ contextSize: 140_000, compactAtTokens: 150_000 })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("93%")
    expect(frame).toContain("█".repeat(15))
  })

  test("a snapshot without a threshold renders the bare estimate, no bar", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ contextSize: 95_000, compactAtTokens: undefined })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("~95k tokens")
    expect(frame).not.toContain("of 150k")
  })

  test("a snapshot without an estimate omits the row entirely", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).not.toContain("context")
  })
})

describe("HUD card context meter row", () => {
  test("a pending boundary compaction paints the compaction-landed indicator — `pending` on the dial", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, loopCompact: { requestedAt: now, iteration: 3, misses: 0 } })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("· pending")
  })

  test("a landed compaction paints the acknowledged indicator — `landed ✓`", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, loopCompact: { requestedAt: now, iteration: 3, misses: 0, landedAt: now } })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("· landed ✓")
  })

  test("a measurable non-drop paints the count — `missed ×1` — and the remediation does not fire at one miss", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, loopCompact: { requestedAt: now, iteration: 3, misses: 1 } })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("· missed ×1")
    expect(frame).not.toContain("/compact")
  })

  test("no compaction was requested — no marker paints anywhere on the row", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000 })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).not.toContain("· pending")
    expect(frame).not.toContain("· landed")
    expect(frame).not.toContain("· missed")
    expect(frame).not.toContain("· unknown")
  })

  test("the bare-estimate fallback paints the marker too — the indicator does not depend on the threshold", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 95_000, compactAtTokens: undefined, loopCompact: { requestedAt: now, iteration: 3, misses: 2, unmeasurableTicks: 0 } })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("~95k tokens")
    expect(frame).toContain("· missed ×2")
  })

  test("the dialog's context row paints the same indicator — parity across the zoom levels", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ contextSize: 120_000, compactAtTokens: 150_000, loopCompact: { requestedAt: now, iteration: 3, misses: 0, landedAt: now } })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("· landed ✓")
  })

  test("renders the bar and the honest ratio against the auto-compact threshold", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000 })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("context")
    expect(frame).toContain("~95k of 150k")
    expect(frame).toContain("63%")
    expect(frame).toContain("█".repeat(10))
  })

  test("the hot band (≥80% of threshold) renders the warning copy", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 140_000, compactAtTokens: 150_000 })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("93%")
    expect(frame).toContain("█".repeat(15))
  })

  test("under mono the bar paints the ASCII glyph, never Unicode", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000 })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} mono />)
    expect(frame).toContain("#".repeat(10))
    expect(frame).not.toContain("█")
  })

  test("a snapshot without a threshold renders the bare estimate, no bar", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ contextSize: 95_000, compactAtTokens: undefined })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("~95k tokens")
    expect(frame).not.toContain("of 150k")
  })

  test("a snapshot without an estimate omits the row entirely", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).not.toContain("context")
  })

  test("under a ceiling the context row paints after spend and drops before the last-verdict row", async () => {
    // spend + hint + context + why available: full = 5 + 4 = 9; at 7 the hint and spend rows have given way, context has not
    const spendFirst = loopedGoal({ turns: 0, history: [], loopHistory: [], spend: { cost: 0.42, input: 120_000, output: 8_400, reasoning: 0, cacheRead: 30_000, cacheWrite: 0 }, contextSize: 95_000, compactAtTokens: 150_000 })
    expect(hudCardRows(spendFirst, false, 7)).toBe(7)
    const kept = await render(() => <HudCard goal={spendFirst} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} maxRows={7} />)
    expect(kept).toContain("context") // spend and hint dropped; context kept
    expect(kept).not.toContain("spend")
    // verdicts-bearing goal without spend: at a two-row-short ceiling the context and why rows give way, the last-verdict row stays
    const lastFirst = loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, spend: undefined })
    expect(hudCardRows(lastFirst, false, 6)).toBe(6)
    const lastKept = await render(() => <HudCard goal={lastFirst} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} maxRows={6} />)
    expect(lastKept).not.toContain("context")
    expect(lastKept).toContain("not met") // the last-verdict row survived
  })
})

describe("HUD card why row", () => {
  test("paints the evaluator's reason, whitespace-collapsed to one line", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ reason: "docs build\n  still\tfails" })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("why")
    expect(frame).toContain("docs build still fails")
  })

  test("clicking the row copies the collapsed reason when the host wires onCopyReason", async () => {
    let copied: string | undefined
    const setup = await testRender(() => <HudCard goal={loopedGoal({ reason: "flaky test in ci" })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} onCopyReason={(r) => { copied = r }} />, { width: 80, height: 16 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "flaky test in ci")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(copied).toBe("flaky test in ci")
    await setup.renderer.destroy()
  })

  test("without onCopyReason the row paints inert — and clicks are inert", async () => {
    const setup = await testRender(() => <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />, { width: 80, height: 16 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("why")
    expect(frame).toContain("Evaluator: docs build still fails")
    const at = findIn(frame, "Evaluator: docs build still fails")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Evaluator: docs build still fails")
    await setup.renderer.destroy()
  })

  test("a blank reason omits the row entirely", async () => {
    const frame = await render(() => <HudCard goal={loopedGoal({ reason: "   " })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).not.toContain("why")
  })

  test("a reason longer than the budget truncates with the ellipsis, never wraps", async () => {
    // pinned to an 80-column terminal (cardWidth(80) = 64, the 64-cell design) so the ellipsis lands at the 42-cell condition budget
    const frame = await render(() => <HudCard goal={loopedGoal({ reason: "x".repeat(60) })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />, 80, 40)
    expect(frame).toContain("x".repeat(41) + "…")
    expect(frame).not.toContain("x".repeat(42))
  })

  test("under a ceiling the why row drops after context and before the last-verdict row", async () => {
    // verdicts-bearing goal: 5 + context 1 + why 1 + last 1 = 8; at 7 the context row has given way, at 6 the why row has too
    const metered = loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, spend: undefined })
    const kept = await render(() => <HudCard goal={metered} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} maxRows={7} />)
    expect(kept).toContain("why")
    expect(kept).not.toContain("context")
    const dropped = await render(() => <HudCard goal={metered} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} maxRows={6} />)
    expect(dropped).not.toContain("why")
    expect(dropped).toContain("not met") // the last-verdict row survived
  })
})

describe("retry watch", () => {
  test("a goal stuck at 3 failed turns renders the exact remediation in the dialog fix row", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ retries: 3 })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("fix")
    expect(frame).toContain("3 failed turns in a row")
    expect(frame).toContain("/goal clear")
  })

  test("a cap-paused goal renders the exact cap remedy in the dialog fix row", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ status: "paused", pauseCause: "cap", reason: "Reached the 20-turn safety limit." })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("fix")
    expect(frame).toContain("turn cap reached")
    expect(frame).toContain("will not extend")
  })

  test("a stall-paused goal renders the nudge remedy in the dialog fix row", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ status: "paused", pauseCause: "stall", stall: 3 })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).toContain("no tool use for 3 turns")
    expect(frame).toContain("message to resume")
  })

  test("a nominal goal renders no fix row", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />)
    expect(frame).not.toContain("fix")
  })
})


describe("DialogFooter (80-column floor)", () => {
  const renderFooter = (width: number, pinned = false, copied = false) =>
    render(
      () => <DialogFooter theme={theme} pinned={() => pinned} copied={() => copied} onCopy={() => {}} onTogglePin={() => {}} onClear={() => {}} />,
      width,
      3,
    )

  test("at 80 cells the short hint and compact labels render unclipped", async () => {
    const frame = await renderFooter(80)
    expect(frame).toContain("up/down scroll · p pin · c copy · x older")
    expect(frame).toContain("[copy]")
    expect(frame).toContain("[pin]")
    expect(frame).toContain("[clear]")
    expect(frame).not.toContain("pgup")
    expect(frame).not.toContain("[copy condition]")
  })

  test("at 96 cells the noun labels overflow — compact labels hold the row (audit finding A1)", async () => {
    const frame = await renderFooter(96)
    expect(frame).toContain("[copy]")
    expect(frame).toContain("[pin]")
    expect(frame).toContain("[clear]")
    expect(frame).not.toContain("copy condition")
  })

  test("at 100 cells the noun labels return with the short hint", async () => {
    const frame = await renderFooter(100)
    expect(frame).toContain("[copy condition]")
    expect(frame).toContain("[pin condition]")
    expect(frame).toContain("[clear goal]")
    expect(frame).not.toContain("pgup")
  })

  test("the copy button acknowledges in-modal with ✓ copied at every width tier", async () => {
    for (const width of [80, 120]) {
      const frame = await renderFooter(width, false, true)
      expect(frame).toContain("[✓ copied]")
      expect(frame).not.toContain("[copy]")
    }
  })

  test("at 140 cells the full key hint returns, without repeating the host's Esc chord", async () => {
    const frame = await renderFooter(140)
    expect(frame).toContain("pgup/pgdn")
    expect(frame).toContain("home/end")
    expect(frame).toContain("p pin · c copy")
    expect(frame).not.toContain("esc")
    expect(frame).toContain("[copy condition]")
    expect(frame).toContain("[clear goal]")
  })

  test("a pinned goal keeps its object noun at the roomy tier; compact tiers render [unpin]", async () => {
    for (const width of [80]) {
      const frame = await renderFooter(width, true)
      expect(frame).toContain("[unpin]")
      expect(frame).not.toContain("[pin]")
      expect(frame).not.toContain("unpin condition")
    }
    for (const width of [103, 160]) {
      const frame = await renderFooter(width, true)
      expect(frame).toContain("[unpin condition]")
      expect(frame).not.toContain("[unpin]")
    }
  })
})

describe("reduced-color surfaces", () => {
  test("the dialog renders unchanged under mono — remedy, glyphs and words all still present", async () => {
    const frame = await render(() => <StatusDialogBody goal={loopedGoal({ status: "paused", pauseCause: "cap", reason: "Reached the 20-turn safety limit." })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} mono />)
    expect(frame).toContain("fix")
    expect(frame).toContain("turn cap reached")
    expect(frame).toContain("will not extend")
    expect(frame).toContain("goal")
  })

  test("the loop rail renders glyphs and rows under mono", async () => {
    const frame = await render(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} mono />, 80, 40)
    expect(frame).toContain("loop")
    expect(frame).toContain("v3 of at most 5")
    expect(frame).toContain("+")
    expect(frame).not.toContain("✓")
    expect(frame).toContain("met · 9 turns · 41 tools")
  })

  test("the history block renders the trail and counts under mono", async () => {
    const frame = await render(() => <HistoryBlock goal={{ ...loopedGoal(), loopEnabled: false, loopIteration: undefined, loopObjective: undefined, loopMaxLoops: undefined, loopHistory: undefined, loopNotProgress: undefined, loopCompact: undefined }} theme={theme} elapsedMs={() => 1000 * 60 * 12} mono />)
    expect(frame).toContain("history")
    expect(frame).toContain("met")
    expect(frame).toContain("trail")
  })
})

describe("evaluator teaching hint (fresh goal)", () => {
  const fresh = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => plainGoal({ turns: 0, history: [], reason: undefined, spend: undefined, ...overrides })

  test("the dialog shows the hint row while the goal is fresh", async () => {
    const frame = await render(() => <StatusDialogBody goal={fresh()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />)
    expect(frame).toContain("hint")
    expect(frame).toContain("the evaluator reads only the transcript")
    expect(frame).toContain("it cannot run commands")
  })

  test("the dialog drops the hint once a turn is recorded", async () => {
    const frame = await render(() => <StatusDialogBody goal={plainGoal({ turns: 1 })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />)
    expect(frame).not.toContain("it cannot run commands")
  })

  test("the loop card hint fits a fresh looped goal — and the card renders it", async () => {
    const freshLoop = loopedGoal({ turns: 0, history: [], loopIteration: 1, loopHistory: [], reason: undefined, spend: undefined })
    expect(hudCardRows(freshLoop)).toBe(6)
    const frame = await render(() => <HudCard goal={freshLoop} theme={theme} elapsedMs={() => 1000 * 60 * 2} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />)
    expect(frame).toContain("hint")
    expect(frame).toContain("the evaluator reads only the transcript")
  })
})

const findIn = (frame: string, needle: string): { x: number; y: number } | undefined => {
  const lines = frame.split("\n")
  for (let y = 0; y < lines.length; y += 1) {
    const x = lines[y]!.indexOf(needle)
    if (x >= 0) return { x, y }
  }
  return undefined
}

describe("copy-to-clipboard affordances (mouse)", () => {
  test("clicking the evaluator row copies the raw reason", async () => {
    let copied: string | undefined
    const goal = loopedGoal()
    const setup = await testRender(() => <StatusDialogBody goal={goal} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyReason={(r) => { copied = r }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "Evaluator: docs build still fails")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    expect(copied).toBe("Evaluator: docs build still fails")
    await setup.renderer.destroy()
  })

  test("the evaluator row renders unchanged without onCopyReason — and clicks are inert", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "Evaluator: docs build still fails")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Evaluator: docs build still fails")
    await setup.renderer.destroy()
  })

  test("clicking an iteration summary line copies the full summary with its version", async () => {
    const calls: Array<[string, number]> = []
    const setup = await testRender(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopySummary={(s, v) => calls.push([s, v])} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "Added an 18-cell block progress bar.")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    expect(calls).toEqual([["Added an 18-cell block progress bar.", 1]])
    await setup.renderer.destroy()
  })

  test("summary lines render unchanged without onCopySummary", async () => {
    const setup = await testRender(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Added an 18-cell block progress bar.")
    await setup.renderer.destroy()
  })
})

describe("loop rail progressive disclosure", () => {
  test("beyond four completed iterations, the two oldest fold behind a click target", async () => {
    const setup = await testRender(() => <LoopSection goal={bigLoopGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("2 older iterations - click or press x")
    expect(frame).toContain("v6")
    expect(frame).toContain("v3")
    expect(frame).not.toContain("v2 ")
    expect(frame).not.toContain("v1 ")
    expect(frame).not.toContain("Summary of iteration 1 work.")
    await setup.renderer.destroy()
  })

  test("clicking the fold row expands the full rail and flips the row to show recent only", async () => {
    const setup = await testRender(() => <LoopSection goal={bigLoopGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "2 older iterations")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    const expanded = setup.captureCharFrame()
    expect(expanded).toContain("show recent only")
    expect(expanded).toContain("v1 ")
    expect(expanded).toContain("Summary of iteration 1 work.")
    expect(expanded).toContain("v6")
    await setup.renderer.destroy()
  })

  test("at four or fewer completed iterations no fold row appears", async () => {
    const setup = await testRender(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("older iteration")
    await setup.renderer.destroy()
  })
})

describe("HUD card context menu (right-click)", () => {
  interface MenuSpies {
    onClear?: () => void
    onCopyCondition?: (condition: string) => void
    onCopyReason?: (reason: string) => void
    onCopySummary?: (summary: string) => void
    onCopyDossier?: () => void
    onSaveDossier?: () => void
  }

  const renderCardHarness = async (goal: GoalSnapshot, spies: MenuSpies = {}) => {
    const Harness = () => {
      const [open, setOpen] = createSignal(false)
      return (
        <HudCard
          goal={goal}
          theme={theme}
          elapsedMs={() => 1000 * 60 * 12}
          onClose={() => {}}
          onDetails={() => {}}
          onClear={() => spies.onClear?.()}
          onCopyCondition={(c) => spies.onCopyCondition?.(c)}
          contextOpen={open()}
          onToggleContext={() => setOpen((v) => !v)}
          onCloseMenu={() => setOpen(false)}
          onCopyReason={spies.onCopyReason ? (r) => spies.onCopyReason?.(r) : undefined}
          onCopySummary={spies.onCopySummary ? (s) => spies.onCopySummary?.(s) : undefined}
          onCopyDossier={spies.onCopyDossier ? () => spies.onCopyDossier?.() : undefined}
          onSaveDossier={spies.onSaveDossier ? () => spies.onSaveDossier?.() : undefined}
        />
      )
    }
    const setup = await testRender(() => <Harness />, { width: 80, height: 40 })
    await setup.renderOnce()
    return setup
  }

  const rightClickCard = async (setup: Awaited<ReturnType<typeof testRender>> extends infer _ ? any : never, frame: string) => {
    const at = findIn(frame, "condition")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y, 2)
    await setup.renderOnce()
  }

  test("right-click on the card toggles the menu; all six rows render, fixed in position", async () => {
    const setup = await renderCardHarness(loopedGoal(), { onCopyReason: () => {}, onCopySummary: () => {} })
    const closed = setup.captureCharFrame()
    expect(closed).not.toContain("copy evaluator reason")
    await rightClickCard(setup, closed)
    const opened = setup.captureCharFrame()
    expect(opened).toContain("menu")
    expect(opened).toContain("copy condition")
    expect(opened).toContain("copy evaluator reason")
    expect(opened).toContain("copy latest summary")
    expect(opened).toContain("copy dossier")
    expect(opened).toContain("save dossier file")
    expect(opened).toContain("clear goal")
    await rightClickCard(setup, opened)
    expect(setup.captureCharFrame()).not.toContain("copy evaluator reason")
    await setup.renderer.destroy()
  })

  test("copy evaluator reason copies the raw reason and closes the menu", async () => {
    let copied: string | undefined
    const setup = await renderCardHarness(loopedGoal(), { onCopyReason: (r) => { copied = r } })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    const at = findIn(opened, "copy evaluator reason")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(copied).toBe("Evaluator: docs build still fails")
    expect(setup.captureCharFrame()).not.toContain("copy evaluator reason")
    await setup.renderer.destroy()
  })

  test("copy latest summary copies the newest loopHistory entry", async () => {
    let copied: string | undefined
    const setup = await renderCardHarness(loopedGoal(), { onCopySummary: (s) => { copied = s } })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    const at = findIn(opened, "copy latest summary")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(copied).toBe("Trail renders up to 24 verdicts.")
    await setup.renderer.destroy()
  })

  test("copy dossier fires the dossier door and closes the menu", async () => {
    let copied = 0
    const setup = await renderCardHarness(loopedGoal(), { onCopyDossier: () => { copied += 1 }, onSaveDossier: () => {} })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    const at = findIn(opened, "copy dossier")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(copied).toBe(1)
    expect(setup.captureCharFrame()).not.toContain("copy dossier")
    await setup.renderer.destroy()
  })

  test("save dossier file fires the file door and closes the menu", async () => {
    let saved = 0
    const setup = await renderCardHarness(loopedGoal(), { onCopyDossier: () => {}, onSaveDossier: () => { saved += 1 } })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    const at = findIn(opened, "save dossier file")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(saved).toBe(1)
    expect(setup.captureCharFrame()).not.toContain("save dossier file")
    await setup.renderer.destroy()
  })

  test("dossier rows stay inert unless the host wires both doors — a half-wired host traps nobody", async () => {
    let copied = 0
    let saved = 0
    const setup = await renderCardHarness(loopedGoal(), { onCopyDossier: () => { copied += 1 } }) // save door unwired
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    const copyAt = findIn(opened, "copy dossier")
    const saveAt = findIn(opened, "save dossier file")
    expect(copyAt).toBeDefined()
    expect(saveAt).toBeDefined()
    await setup.mockMouse.click(copyAt!.x + 2, copyAt!.y)
    await setup.mockMouse.click(saveAt!.x + 2, saveAt!.y)
    await setup.renderOnce()
    expect(copied).toBe(0)
    expect(saved).toBe(0)
    expect(setup.captureCharFrame()).toContain("save dossier file") // the menu stays open; nothing fired
    await setup.renderer.destroy()
  })

  test("copy condition copies through the same wiring as the condition row", async () => {
    let copied: string | undefined
    const setup = await renderCardHarness(loopedGoal(), { onCopyCondition: (c) => { copied = c }, onCopyReason: () => {}, onCopySummary: () => {} })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const at = findIn(setup.captureCharFrame(), "copy condition")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(copied).toBe("ship the release notes")
    await setup.renderer.destroy()
  })

  test("the clear goal row fires onClear and closes the menu", async () => {
    let cleared = false
    const setup = await renderCardHarness(loopedGoal(), { onClear: () => { cleared = true } })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    // the [clear goal] button shares the label; target the menu row below the menu gutter instead
    const menuTop = findIn(opened, "copy condition")
    expect(menuTop).toBeDefined()
    const lines = opened.split("\n")
    let menuRow: { x: number; y: number } | undefined
    for (let y = menuTop!.y; y < lines.length && !menuRow; y += 1) {
      const x = lines[y]!.indexOf("clear goal")
      if (x >= 0) menuRow = { x, y }
    }
    expect(menuRow).toBeDefined()
    await setup.mockMouse.click(menuRow!.x + 2, menuRow!.y)
    await setup.renderOnce()
    expect(cleared).toBe(true)
    expect(setup.captureCharFrame()).not.toContain("copy latest summary")
    await setup.renderer.destroy()
  })

  test("inert rows: absent reason renders its row faint and inert; absent summary likewise; no callback at all disables them too", async () => {
    let copied: string | undefined
    const noReason = loopedGoal({ reason: undefined })
    const setup = await renderCardHarness(noReason, { onCopyReason: (r) => { copied = r }, onCopySummary: (s) => { copied = s } })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    const atReason = findIn(opened, "copy evaluator reason")
    expect(atReason).toBeDefined()
    await setup.mockMouse.click(atReason!.x + 2, atReason!.y)
    await setup.renderOnce()
    expect(copied).toBeUndefined()
    expect(setup.captureCharFrame()).toContain("copy evaluator reason") // stays open, nothing fired
    await setup.renderer.destroy()
    // reason present but host did not wire onCopyReason -> still inert
    copied = undefined
    const setup2 = await renderCardHarness(loopedGoal(), { onCopySummary: (s) => { copied = s } })
    const frame2 = setup2.captureCharFrame()
    await rightClickCard(setup2, frame2)
    const at2 = findIn(setup2.captureCharFrame(), "copy evaluator reason")
    expect(at2).toBeDefined()
    await setup2.mockMouse.click(at2!.x + 2, at2!.y)
    await setup2.renderOnce()
    expect(copied).toBeUndefined()
    await setup2.renderer.destroy()
  })
})

describe("in-modal copy acknowledgment (rows flip ✓ copied)", () => {
  test("clicking the evaluator row flips the row to ✓ copied — no toast required", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyReason={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    let frame = setup.captureCharFrame()
    expect(frame).not.toContain("✓ copied")
    const at = findIn(frame, "Evaluator: docs build still fails")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    const line = frame.split("\n")[at!.y]!
    expect(line).toContain("✓ copied")
    await setup.renderer.destroy()
  })

  test("clicking the condition row flips the row to ✓ copied", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyCondition={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    let frame = setup.captureCharFrame()
    expect(frame).not.toContain("✓ copied")
    const at = findIn(frame, "ship the release notes")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    const line = frame.split("\n")[at!.y]!
    expect(line).toContain("✓ copied")
    await setup.renderer.destroy()
  })

  test("clicking an iteration summary line flips that line to ✓ copied", async () => {
    const setup = await testRender(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopySummary={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    let frame = setup.captureCharFrame()
    expect(frame).not.toContain("✓ copied")
    const at = findIn(frame, "Added an 18-cell block progress bar.")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    const line = frame.split("\n")[at!.y]!
    expect(line).toContain("✓ copied")
    await setup.renderer.destroy()
  })
})

describe("dialog hover grammar (mouse over reveals the affordance)", () => {
  test("hovering the condition row reveals the faint copy hint; leaving hides it", async () => {
    const setup = await testRender(
      () => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyCondition={() => {}} />,
      { width: 112, height: 44 },
    )
    await setup.renderOnce()
    let frame = setup.captureCharFrame()
    expect(frame).not.toContain("copy")
    const at = findIn(frame, "ship the release notes")
    expect(at).toBeDefined()
    await setup.mockMouse.moveTo(at!.x + 4, at!.y)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    expect(frame.split("\n")[at!.y]!).toContain("copy")
    // Move off the row: the hint disappears again (no lingering chrome).
    await setup.mockMouse.moveTo(at!.x + 4, at!.y + 40 > 43 ? 0 : at!.y + 40)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    expect(frame.split("\n")[at!.y]!).not.toContain("copy")
    await setup.renderer.destroy()
  })

  test("hovering the evaluator row reveals the faint copy hint; leaving hides it", async () => {
    const setup = await testRender(
      () => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyReason={() => {}} />,
      { width: 112, height: 44 },
    )
    await setup.renderOnce()
    let frame = setup.captureCharFrame()
    expect(frame).not.toContain("copy")
    const at = findIn(frame, "Evaluator: docs build still fails")
    expect(at).toBeDefined()
    await setup.mockMouse.moveTo(at!.x + 4, at!.y)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    expect(frame.split("\n")[at!.y]!).toContain("copy")
    await setup.mockMouse.moveTo(at!.x + 4, 0)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    expect(frame.split("\n")[at!.y]!).not.toContain("copy")
    await setup.renderer.destroy()
  })
})

describe("hover grammar: weight, never underline (NO_COLOR-safe)", () => {
  test("hovering the condition row paints bold and no span in the frame carries UNDERLINE; leaving restores resting attributes", async () => {
    const setup = await testRender(
      () => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyCondition={() => {}} />,
      { width: 112, height: 44 },
    )
    await setup.renderOnce()
    const charFrame = setup.captureCharFrame()
    // Resting frame: nothing underlined, nothing bold on the condition text.
    const rest = setup.captureSpans().lines.flatMap((line) => line.spans)
    expect(rest.some((span) => (span.attributes & TextAttributes.UNDERLINE) !== 0)).toBe(false)
    const at = findIn(charFrame, "ship the release notes")
    expect(at).toBeDefined()
    await setup.mockMouse.moveTo(at!.x + 4, at!.y)
    await setup.renderOnce()
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    expect(spans.some((span) => (span.attributes & TextAttributes.UNDERLINE) !== 0)).toBe(false)
    const condition = spans.find((span) => span.text.includes("ship the release notes"))
    expect(condition).toBeDefined()
    expect(condition!.attributes & TextAttributes.BOLD).not.toBe(0)
    await setup.mockMouse.moveTo(at!.x + 4, 0)
    await setup.renderOnce()
    const left = setup.captureSpans().lines.flatMap((line) => line.spans)
    expect(left.some((span) => (span.attributes & TextAttributes.UNDERLINE) !== 0)).toBe(false)
    expect(left.find((span) => span.text.includes("ship the release notes"))!.attributes & TextAttributes.BOLD).toBe(0)
    await setup.renderer.destroy()
  })
})

describe("ASCII demotion (NO_COLOR / TERM=dumb)", () => {
  test("LoopSection paints bars as ink-density ASCII and never emits eighth-blocks or box glyphs unrenderable on dumb terminals", async () => {
    const previous = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    try {
      const frame = await render(() => <LoopSection goal={bigLoopGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 40} nowMs={() => now} />, 100, 40)
      expect(frame).toContain("###")
      expect(frame).not.toContain("█")
      expect(frame).not.toContain("░")
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = previous
    }
  })

  test("LoopSection sparkline row demotes to the ASCII ramp when NO_COLOR is set", async () => {
    const previous = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    try {
      const withContext = loopedGoal({
        loopHistory: [
          { version: 1, condition: "add a progress bar", summary: "Added an 18-cell block progress bar.", reason: "met", turns: 9, toolCalls: 41, endedAt: now - 1000 * 60 * 27, contextTokens: 41_000 },
          { version: 2, condition: "render the verdict trail", summary: "Trail renders up to 24 verdicts.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12, contextTokens: 91_000 },
        ],
      })
      const frame = await render(() => <LoopSection goal={withContext} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, 100, 30)
      expect(frame).toContain("context")
      expect(frame).not.toContain("▄")
      expect(frame).not.toContain("█")
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = previous
    }
  })
})

describe("mouse-button discipline (left activates; right and middle never do)", () => {
  const cardHarness = async (goal: GoalSnapshot, spies: { onClear?: () => void; onCopyCondition?: (c: string) => void; onCopyReason?: (r: string) => void } = {}) => {
    const Harness = () => {
      const [open, setOpen] = createSignal(false)
      return (
        <HudCard
          goal={goal}
          theme={theme as never as Parameters<typeof HudCard>[0]["theme"]}
          elapsedMs={() => 1000 * 60 * 12}
          onClose={() => {}}
          onDetails={() => {}}
          onClear={() => spies.onClear?.()}
          onCopyCondition={(c) => spies.onCopyCondition?.(c)}
          contextOpen={open()}
          onToggleContext={() => setOpen((v) => !v)}
          onCloseMenu={() => setOpen(false)}
          onCopyReason={spies.onCopyReason ? (r) => spies.onCopyReason?.(r) : undefined}
        />
      )
    }
    const setup = await testRender(() => <Harness />, { width: 80, height: 40 })
    await setup.renderOnce()
    return setup
  }
  const rightClickCard = async (setup: Awaited<ReturnType<typeof testRender>> extends infer _ ? any : never, frame: string) => {
    const at = findIn(frame, "condition")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y, 2)
    await setup.renderOnce()
  }
  const menuClearRow = (frame: string) => {
    const menuTop = findIn(frame, "copy condition")
    expect(menuTop).toBeDefined()
    const lines = frame.split("\n")
    for (let y = menuTop!.y; y < lines.length; y += 1) {
      const x = lines[y]!.indexOf("clear goal")
      if (x >= 0) return { x, y }
    }
    return undefined
  }

  test("right-clicking the [clear goal] menu row fires no action — the card root toggles the menu instead", async () => {
    let cleared = false
    const setup = await cardHarness(loopedGoal(), { onClear: () => { cleared = true } })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    const menuRow = menuClearRow(opened)
    expect(menuRow).toBeDefined()
    await setup.mockMouse.click(menuRow!.x + 2, menuRow!.y, 2)
    await setup.renderOnce()
    expect(cleared).toBe(false)
    expect(setup.captureCharFrame()).not.toContain("copy latest summary") // right-click fell through to the root toggle
    await setup.renderer.destroy()
  })

  test("middle-clicking a menu row fires no action and leaves the menu open", async () => {
    let copied: string | undefined
    const setup = await cardHarness(loopedGoal(), { onCopyReason: (r) => { copied = r } })
    const frame = setup.captureCharFrame()
    await rightClickCard(setup, frame)
    const opened = setup.captureCharFrame()
    const atReason = findIn(opened, "copy evaluator reason")
    expect(atReason).toBeDefined()
    await setup.mockMouse.click(atReason!.x + 2, atReason!.y, 1)
    await setup.renderOnce()
    expect(copied).toBeUndefined()
    expect(setup.captureCharFrame()).toContain("copy evaluator reason")
    await setup.renderer.destroy()
  })

  test("right-clicking the card's footer [clear goal] button fires no action — right-click anywhere on the card toggles the menu", async () => {
    let cleared = false
    const setup = await cardHarness(loopedGoal(), { onClear: () => { cleared = true } })
    const frame = setup.captureCharFrame()
    const atClear = findIn(frame, "clear goal") // footer button; menu is closed
    expect(atClear).toBeDefined()
    await setup.mockMouse.click(atClear!.x + 2, atClear!.y, 2)
    await setup.renderOnce()
    expect(cleared).toBe(false)
    expect(setup.captureCharFrame()).toContain("copy condition") // menu opened via the root toggle
    await setup.renderer.destroy()
  })

  test("right-clicking a loop summary row copies nothing", async () => {
    let copied: string | undefined
    const setup = await testRender(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopySummary={(s) => { copied = s }} />, { width: 100, height: 30 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "Added an 18-cell")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y, 2)
    await setup.renderOnce()
    expect(copied).toBeUndefined()
    await setup.renderer.destroy()
  })

  test("left-clicking a loop summary row still copies (regression guard)", async () => {
    let copied: string | undefined
    const setup = await testRender(() => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopySummary={(s) => { copied = s }} />, { width: 100, height: 30 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "Added an 18-cell")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(copied).toBe("Added an 18-cell block progress bar.")
    await setup.renderer.destroy()
  })
})

describe("loop rail fold — controlled expand (keyboard parity)", () => {
  test("expanded controlled state renders the full rail without any click", async () => {
    const setup = await testRender(() => <LoopSection goal={bigLoopGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} expanded={() => true} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("show recent only")
    expect(frame).toContain("v1 ")
    expect(frame).toContain("Summary of iteration 1 work.")
    expect(frame).not.toContain("older iteration")
    await setup.renderer.destroy()
  })

  test("fold-row click in controlled mode fires the toggle callback and does not self-flip", async () => {
    let toggles = 0
    const setup = await testRender(() => <LoopSection goal={bigLoopGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} expanded={() => false} onToggleExpanded={() => { toggles += 1 }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const at = findIn(setup.captureCharFrame(), "2 older iterations")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    expect(toggles).toBe(1)
    // Controlled false means the rail stays folded; the parent owns the flip.
    expect(setup.captureCharFrame()).toContain("2 older iterations")
    await setup.renderer.destroy()
  })

  test("uncontrolled mode still self-flips on click", async () => {
    const setup = await testRender(() => <LoopSection goal={bigLoopGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const at = findIn(setup.captureCharFrame(), "2 older iterations")
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("show recent only")
    await setup.renderer.destroy()
  })
})

describe("why ledger (the evaluator's most recent reasons, inline)", () => {
  const ledgerGoal = (history: VerdictEntry[]): GoalSnapshot =>
    loopedGoal({ loopEnabled: false, loopHistory: undefined, loopIteration: undefined, loopMaxLoops: undefined, history, status: "active" } as Partial<GoalSnapshot>)
  const ledgerHistory: VerdictEntry[] = [
    { turn: 1, verdict: "met", reason: "wired the progress bar", at: now - 1000 * 60 * 30 },
    { turn: 2, verdict: "not_met", reason: "typecheck still fails on the CLI flag", at: now - 1000 * 60 * 20 },
    { turn: 3, verdict: "met", reason: "all green including the flag path", at: now - 1000 * 60 * 10 },
    { turn: 4, verdict: "not_met", reason: "", at: now - 1000 * 60 * 5 },
    { turn: 5, verdict: "met", reason: "the full acceptance suite passes", at: now - 1000 * 60 * 2 },
  ]

  test("paints at most three non-empty rows, newest last — glyph, verdict, turn, relative time, reason", async () => {
    const setup = await testRender(
      () => <HistoryBlock goal={ledgerGoal(ledgerHistory)} theme={theme} elapsedMs={() => 1000 * 60 * 30} nowMs={() => now} />,
      { width: 112, height: 30 },
    )
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("why")
    expect(frame).toContain("typecheck still fails on the CLI flag")
    expect(frame).toContain("all green including the flag path")
    expect(frame).toContain("the full acceptance suite passes")
    expect(frame).toContain("turn 2 · 20m ago")
    expect(frame).toContain("turn 3 · 10m ago")
    expect(frame).toContain("turn 5 · 2m ago")
    // the oldest verdicts and the one-empty-reason entry stay out
    expect(frame).not.toContain("wired the progress bar")
    expect(frame).not.toContain("turn 4")
    await setup.renderer.destroy()
  })

  test("clicking a why row copies the raw reason — the row flips ✓ copied in place", async () => {
    const calls: string[] = []
    const setup = await testRender(
      () => <HistoryBlock goal={ledgerGoal(ledgerHistory)} theme={theme} elapsedMs={() => 1000 * 60 * 30} nowMs={() => now} onCopyReason={(reason) => calls.push(reason)} />,
      { width: 112, height: 30 },
    )
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("✓ copied")
    const at = findIn(frame, "typecheck still fails on the CLI flag")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    expect(calls).toEqual(["typecheck still fails on the CLI flag"])
    expect(setup.captureCharFrame().split("\n")[at!.y]!).toContain("✓ copied")
    await setup.renderer.destroy()
  })

  test("why rows render unchanged without onCopyReason — clicks are inert", async () => {
    const setup = await testRender(
      () => <HistoryBlock goal={ledgerGoal(ledgerHistory)} theme={theme} elapsedMs={() => 1000 * 60 * 30} nowMs={() => now} />,
      { width: 112, height: 30 },
    )
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "the full acceptance suite passes")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame().split("\n")[at!.y]!).not.toContain("✓ copied")
    await setup.renderer.destroy()
  })

  test("under mono the copied ack demotes to + copied and no ✓ leaks onto a dumb surface", async () => {
    const calls: string[] = []
    const setup = await testRender(
      () => <HistoryBlock goal={ledgerGoal(ledgerHistory)} theme={theme} elapsedMs={() => 1000 * 60 * 30} nowMs={() => now} onCopyReason={(reason) => calls.push(reason)} mono />,
      { width: 112, height: 30 },
    )
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("✓")
    expect(frame).toContain("why")
    const at = findIn(frame, "the full acceptance suite passes")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 4, at!.y)
    await setup.renderOnce()
    expect(calls).toEqual(["the full acceptance suite passes"])
    const row = setup.captureCharFrame().split("\n")[at!.y]!
    expect(row).toContain("+ copied")
    expect(row).not.toContain("✓ copied")
    await setup.renderer.destroy()
  })

  test("an empty transcript of reasons degrades to no why rows — and the trail still paints", async () => {
    const emptied = ledgerHistory.map((entry) => ({ ...entry, reason: "" }))
    const setup = await testRender(
      () => <HistoryBlock goal={ledgerGoal(emptied)} theme={theme} elapsedMs={() => 1000 * 60 * 30} nowMs={() => now} onCopyReason={() => {}} />,
      { width: 112, height: 30 },
    )
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("why")
    expect(frame).toContain("trail")
    await setup.renderer.destroy()
  })
})

describe("elsewhere block (other sessions holding live goals)", () => {
  const foreign = [
    loopedGoal({ sessionID: "ses_1111111111", id: "goal_f1", condition: "ship the deploy pipeline before friday", loopIteration: 2, loopMaxLoops: 5 }),
    loopedGoal({ sessionID: "ses_2222222222", id: "goal_f2", condition: "audit the whole tui surface", loopEnabled: false, status: "paused", pauseCause: "cap" }),
  ]
  const slugs: Record<string, string> = { ses_1111111111: "brisk-falcon", ses_2222222222: "quiet-otter" }
  const sessionLabel = (id: string): string => slugs[id] ?? id

  test("paints one read-only row per other live session, own session and terminal goals excluded", async () => {
    const own = loopedGoal() // sessionID ses_test — the dialog's own session
    const achieved = loopedGoal({ sessionID: "ses_3333333333", id: "goal_f3", status: "achieved" })
    const frame = await render(() => (
      <StatusDialogBody goal={own} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyReason={() => {}} others={[own, achieved, ...foreign]} sessionLabel={sessionLabel} />
    ))
    expect(frame).toContain("elsewhere")
    expect(frame).toContain("2 other sessions holding live goals")
    expect(frame).toContain("brisk-falcon")
    expect(frame).toContain("quiet-otter")
    expect(frame).toContain("v2/5") // looped foreign session shows its position
    expect(frame).toContain("ship the deploy pipeline") // whitespace-collapsed condition prefix
    expect(frame).toContain("audit the whole tui surface")
    expect(frame).not.toContain("ses_1111111111") // slug resolves; raw ids never paint
    expect(frame).not.toContain("ses_2222222222")
    expect(frame).not.toContain("ses_3333333333") // achieved is terminal, never listed
  })

  test("the elsewhere fold expands past the four-row chord cap on click, and folds back — the hidden sessions are never trapped behind a silent cap", async () => {
    // Six live foreign goals — the overflow case: two rows live behind the fold.
    const slugs6: Record<string, string> = { ses_1111111111: "brisk-falcon", ses_2222222222: "quiet-otter", ses_4444444444: "shy-heron", ses_5555555555: "grand-oyster", ses_6666666666: "still-bison", ses_7777777777: "ember-crab" }
    const sessionLabel6 = (id: string): string => slugs6[id] ?? id
    const six = [
      ...foreign,
      loopedGoal({ sessionID: "ses_4444444444", id: "goal_f4", condition: "map the snapshot states" }),
      loopedGoal({ sessionID: "ses_5555555555", id: "goal_f5", condition: "harden the 80 column floor" }),
      loopedGoal({ sessionID: "ses_6666666666", id: "goal_f6", condition: "wheel pin on the dialog" }),
      loopedGoal({ sessionID: "ses_7777777777", id: "goal_f7", condition: "fold affordance coverage" }),
    ]
    const [expanded, setExpanded] = createSignal(false)
    const render6 = () => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} others={six} sessionLabel={sessionLabel6} expandedOthers={() => expanded()} onToggleExpandedOthers={() => setExpanded((v) => !v)} />
    )
    const setup = await testRender(render6, { width: 112, height: 44 })
    await setup.renderOnce()
    const collapsed = setup.captureCharFrame()
    expect(collapsed).toContain("+2 more")
    expect(collapsed).toContain("shy-heron")
    expect(collapsed).not.toContain("still-bison")
    expect(collapsed).not.toContain("ember-crab")
    expect(collapsed).not.toContain("fold to 4")
    const foldAt = findIn(collapsed, "+2 more")
    expect(foldAt).toBeDefined()
    await setup.mockMouse.click(foldAt!.x + 1, foldAt!.y)
    await setup.renderOnce()
    const opened = setup.captureCharFrame()
    for (const slug of ["shy-heron", "grand-oyster", "still-bison", "ember-crab"]) expect(opened).toContain(slug)
    expect(opened).toContain("fold to 4")
    expect(opened).not.toContain("+2 more")
    const foldBack = findIn(opened, "fold to 4")
    expect(foldBack).toBeDefined()
    await setup.mockMouse.click(foldBack!.x + 1, foldBack!.y)
    await setup.renderOnce()
    const refolded = setup.captureCharFrame()
    expect(refolded).toContain("+2 more")
    expect(refolded).not.toContain("still-bison")
    expect(refolded).not.toContain("ember-crab")
    await setup.renderer.destroy()
  })

  test("the elsewhere fold works without host wiring (local state) — click expands, click folds", async () => {
    const slugs = { ses_1111111111: "brisk-falcon", ses_2222222222: "quiet-otter", ses_4444444444: "shy-heron", ses_5555555555: "grand-oyster", ses_6666666666: "still-bison" }
    const label = (id: string): string => slugs[id as keyof typeof slugs] ?? id
    const five = [
      ...foreign,
      loopedGoal({ sessionID: "ses_4444444444", id: "goal_f4", condition: "local fold alpha" }),
      loopedGoal({ sessionID: "ses_5555555555", id: "goal_f5", condition: "local fold beta" }),
      loopedGoal({ sessionID: "ses_6666666666", id: "goal_f6", condition: "local fold gamma" }),
    ]
    const setup = await testRender(() => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} others={five} sessionLabel={label} />
    ), { width: 112, height: 44 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("+1 more")
    const at = findIn(setup.captureCharFrame(), "+1 more")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 1, at!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("still-bison")
    expect(setup.captureCharFrame()).toContain("fold to 4")
    await setup.renderer.destroy()
  })

  test("the dialog's scrollbox scrolls under the mouse wheel at real coordinates — the mechanism the dialog's content depends on (pin on opentui's ScrollBox.onMouseEvent)", async () => {
    let sb: ScrollBoxRenderable | undefined
    const content = Array.from({ length: 60 }, (_, i) => `rail row ${String(i + 1).padStart(2, "0")} · verdict trail`).join("\n")
    const setup = await testRender(() => (
      <scrollbox ref={(el) => { sb = el }} scrollX={false} height={8} width={48} contentOptions={{ minHeight: 0 }}>
        <text wrapMode="none">{content}</text>
      </scrollbox>
    ), { width: 48, height: 10 })
    await setup.renderOnce()
    expect(sb).toBeDefined()
    const before = sb!.scrollTop
    await setup.mockMouse.scroll(6, 2, "down")
    await setup.renderOnce()
    const afterDown = sb!.scrollTop
    expect(afterDown).toBeGreaterThan(before)
    await setup.mockMouse.scroll(6, 2, "up")
    await setup.renderOnce()
    expect(sb!.scrollTop).toBeLessThan(afterDown)
    await setup.renderer.destroy()
  })

  test("with the jump route wired, elsewhere rows paint a faint digit gutter (the chord to press); unwired rows paint no digit", async () => {
    const wired = await testRender(() => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} others={foreign} sessionLabel={sessionLabel} onViewTranscript={() => {}} />
    ), { width: 112, height: 44 })
    await wired.renderOnce()
    const wiredFrame = wired.captureCharFrame()
    const wiredRow1 = wiredFrame.split("\n").find((line) => line.includes("brisk-falcon"))
    const wiredRow2 = wiredFrame.split("\n").find((line) => line.includes("quiet-otter"))
    expect(wiredRow1).toBeDefined()
    expect(wiredRow2).toBeDefined()
    expect(wiredRow1!.trimStart().startsWith("1")).toBe(true)
    expect(wiredRow2!.trimStart().startsWith("2")).toBe(true)
    await wired.renderer.destroy()
    const plain = await testRender(() => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} others={foreign} sessionLabel={sessionLabel} />
    ), { width: 112, height: 44 })
    await plain.renderOnce()
    const plainFrame = plain.captureCharFrame()
    const plainRow1 = plainFrame.split("\n").find((line) => line.includes("brisk-falcon"))
    expect(plainRow1).toBeDefined()
    expect(plainRow1!.trimStart().startsWith("1")).toBe(false)
    expect(plainRow1!.trimStart().startsWith("2")).toBe(false)
    await plain.renderer.destroy()
  })

  test("a left-click on an elsewhere row asks the host to open that session's transcript route", async () => {
    const jumps: string[] = []
    const setup = await testRender(() => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} others={foreign} sessionLabel={sessionLabel} onViewTranscript={(id) => { jumps.push(id) }} />), { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "brisk-falcon")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(jumps).toEqual(["ses_1111111111"])
    // the second other session lands on its own row — the jump carries that id, never the own session
    const at2 = findIn(setup.captureCharFrame(), "quiet-otter")
    expect(at2).toBeDefined()
    await setup.mockMouse.click(at2!.x + 2, at2!.y)
    await setup.renderOnce()
    expect(jumps).toEqual(["ses_1111111111", "ses_2222222222"])
    await setup.renderer.destroy()
  })

  test("right-click an elsewhere row and nothing jumps", async () => {
    const jumps: string[] = []
    const setup = await testRender(() => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} others={foreign} sessionLabel={sessionLabel} onViewTranscript={(id) => { jumps.push(id) }} />), { width: 112, height: 44 })
    await setup.renderOnce()
    const at = findIn(setup.captureCharFrame(), "brisk-falcon")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y, 2)
    await setup.renderOnce()
    expect(jumps).toEqual([])
    await setup.renderer.destroy()
  })

  test("singular noun for exactly one other live session", async () => {
    const frame = await render(() => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} others={[foreign[0]!]} sessionLabel={sessionLabel} />
    ))
    expect(frame).toContain("1 other session holding live goals")
    expect(frame).toContain("brisk-falcon")
    expect(frame).not.toContain("quiet-otter")
  })

  test("omits the block entirely when no other session holds a live goal", async () => {
    const empty = await render(() => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} others={[]} sessionLabel={sessionLabel} />
    ))
    expect(empty).not.toContain("elsewhere")
    const absent = await render(() => (
      <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />
    ))
    expect(absent).not.toContain("elsewhere")
  })
})

describe("view tabs (overview · ledger)", () => {
  test("clicking the ledger tab focuses the history — the overview rows drop, the rail stays; clicking back restores everything", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const overview = setup.captureCharFrame()
    expect(overview).toContain("ship the release notes")
    expect(overview).toContain("objective")
    const at = findIn(overview, "ledger")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x, at!.y)
    await setup.renderOnce()
    const focused = setup.captureCharFrame()
    expect(focused).not.toContain("ship the release notes") // the condition rides the overview
    expect(focused).not.toContain("spend") // the spend row rides the overview
    expect(focused).toContain("objective") // the rail stays — it is the point of the view
    expect(focused).toContain("v3/5") // the state row stays — the armed line never leaves
    const back = findIn(focused, "overview")
    await setup.mockMouse.click(back!.x, back!.y)
    await setup.renderOnce()
    const restored = setup.captureCharFrame()
    expect(restored).toContain("ship the release notes")
    expect(restored).toContain("spend")
    await setup.renderer.destroy()
  })

  test("right click on a tab is inert — the view never flips on the power button", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "ledger")
    await setup.mockMouse.click(at!.x, at!.y, 2)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("ship the release notes") // still the overview
    await setup.renderer.destroy()
  })

  test("clicking a tab with the host wiring flips the controlled view — the strip and the t chord ride one signal", async () => {
    const state = { view: "overview" as "overview" | "ledger" | "dossier" }
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => state.view} onViewChange={(v) => { state.view = v }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "ledger")
    await setup.mockMouse.click(at!.x, at!.y)
    expect(state.view).toBe("ledger")
    await setup.mockMouse.click(findIn(setup.captureCharFrame(), "overview")!.x, findIn(setup.captureCharFrame(), "overview")!.y)
    expect(state.view).toBe("overview")
    await setup.renderer.destroy()
  })

  test("the strip switches under mono too — the words are the contract, the hue was never it", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} mono={true} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findIn(frame, "ledger")
    await setup.mockMouse.click(at!.x, at!.y)
    await setup.renderOnce()
    const focused = setup.captureCharFrame()
    expect(focused).not.toContain("ship the release notes")
    expect(focused).toContain("objective")
    await setup.renderer.destroy()
  })

  test("a fresh loop with no host wiring flips to an empty ledger without throwing — the strip is chrome, not a command", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal({ history: [], loopHistory: [], loopIteration: 1, turns: 0 })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 30} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const at = findIn(setup.captureCharFrame(), "ledger")
    await setup.mockMouse.click(at!.x, at!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("v1/5") // the armed line never leaves
    await setup.renderer.destroy()
  })
})

describe("dossier tab (the whole record, in-screen — mouse-first)", () => {
  const dossierAt = (frame: string): { x: number; y: number } | undefined => findIn(frame, "dossier")
  const copyRowAt = (frame: string): { x: number; y: number } | undefined => findIn(frame, "the whole record as markdown")

  test("clicking the dossier tab drops the dashboard rows, keeps the armed line, and paints the document — the record, not chrome", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyDossier={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const overview = setup.captureCharFrame()
    expect(overview).toContain("ship the release notes")
    expect(overview).toContain("spend")
    const at = dossierAt(overview)
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x, at!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("ship the release notes") // the condition rides the overview tab only — the document quotes the loop objective instead
    expect(frame).toContain("make every loop iteration visible at a glance") // the objective lives on inside the document's blockquote — it IS the record
    expect(frame).toContain("Goal loop dossier") // the document's title
    expect(frame).toContain("Completed iterations (") // the per-iteration ledger section (the verdict table rides further down the document — asserted via the copied payload instead)
    expect(frame).toContain("v3/5") // the armed line never leaves
    expect(frame).toContain("the whole record as markdown") // the copy row
    await setup.renderer.destroy()
  })

  test("clicking the copy row copies the whole record as markdown — one click, the same bytes goal.dossier.copy writes", async () => {
    const copied: string[] = []
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyDossier={(doc) => copied.push(doc)} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const row = copyRowAt(frame)
    expect(row).toBeDefined()
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(copied.length).toBe(1)
    expect(copied[0]).toContain("# Goal loop dossier")
    expect(copied[0]).toContain("make every loop iteration visible at a glance")
    expect(copied[0]).toContain("### Iteration v1")
    expect(copied[0]).toContain("## Verdict trail (")
    expect(setup.captureCharFrame()).toContain("✓ copied") // the in-modal acknowledgment, same grammar as the other rows
    await setup.renderer.destroy()
  })

  test("clicking the save row exports through the host — one click, the optimistic `✓ saved` acknowledgment", async () => {
    let saved = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyDossier={() => {}} onSaveDossier={() => { saved += 1 }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const rowAt = findIn(setup.captureCharFrame(), "the whole record as a file")
    expect(rowAt).toBeDefined()
    await setup.mockMouse.click(rowAt!.x, rowAt!.y)
    await setup.renderOnce()
    expect(saved).toBe(1)
    expect(setup.captureCharFrame()).toContain("✓ saved") // the in-modal acknowledgment, the save row's own verb
    await setup.renderer.destroy()
  })

  test("right click on the save row is inert — no export on the power button", async () => {
    let saved = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onSaveDossier={() => { saved += 1 }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const rowAt = findIn(setup.captureCharFrame(), "the whole record as a file")
    expect(rowAt).toBeDefined()
    await setup.mockMouse.click(rowAt!.x, rowAt!.y, 2)
    await setup.renderOnce()
    expect(saved).toBe(0)
    await setup.renderer.destroy()
  })

  test("the save row does not paint when the host leaves it unwired — the document renders exactly as before", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyDossier={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("the whole record as markdown")
    expect(frame).not.toContain("the whole record as a file")
    await setup.renderer.destroy()
  })

  test("mono keeps the save row's words — weight carries the acknowledgment, hue never did", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} mono={true} onSaveDossier={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("the whole record as a file")
    await setup.renderer.destroy()
  })

  test("right click on the dossier tab is inert — the view never flips on the power button", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = dossierAt(frame)
    await setup.mockMouse.click(at!.x, at!.y, 2)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("spend") // still the overview
    await setup.renderer.destroy()
  })

  test("clicking back from dossier to overview restores the dashboard — the strip is a round trip", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("spend")
    const back = findIn(setup.captureCharFrame(), "overview")
    await setup.mockMouse.click(back!.x, back!.y)
    await setup.renderOnce()
    const restored = setup.captureCharFrame()
    expect(restored).toContain("spend")
    expect(restored).toContain("ship the release notes")
    await setup.renderer.destroy()
  })

  test("the strip switches under mono too — weight carries the words, hue was never the contract", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} mono={true} onCopyDossier={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Goal loop dossier")
    expect(frame).toContain("the whole record as markdown")
    await setup.renderer.destroy()
  })

  test("the strip's round trip on a controlled signal repaints between all three views (the signal the t chord drives on the host)", async () => {
    const [view, setView] = createSignal<"overview" | "ledger" | "dossier">("overview")
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={view} onViewChange={(v) => setView(v)} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(findIn(setup.captureCharFrame(), "dossier")!.x, findIn(setup.captureCharFrame(), "dossier")!.y)
    expect(view()).toBe("dossier")
    expect(setup.captureCharFrame()).toContain("Goal loop dossier")
    await setup.mockMouse.click(findIn(setup.captureCharFrame(), "ledger")!.x, findIn(setup.captureCharFrame(), "ledger")!.y)
    expect(view()).toBe("ledger")
    expect(setup.captureCharFrame()).toContain("objective")
    expect(setup.captureCharFrame()).not.toContain("Goal loop dossier")
    await setup.renderer.destroy()
  })
})

describe("dossier outline rail (mouse — quote any section, one click)", () => {
  const chipAt = (frame: string, needle: string): { x: number; y: number } | undefined => findIn(frame, needle)

  test("the rail paints the expected labels in order, and the document still paints whole beside it", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "dossier"} onCopyDossierSection={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    for (const label of ["objective", "status", "iterations", "verdicts", "compaction", "verify", "totals"]) {
      expect(frame).toContain(label)
    }
    expect(frame.indexOf("objective")).toBeLessThan(frame.indexOf("status"))
    expect(frame.indexOf("status")).toBeLessThan(frame.indexOf("iterations"))
    expect(frame.indexOf("iterations")).toBeLessThan(frame.indexOf("verdicts"))
    expect(frame).toContain("Goal loop dossier") // the document still paints, line for line
    expect(frame).toContain("Completed iterations (")
    await setup.renderer.destroy()
  })

  test("hovering a chip boldens it — weight, never hue alone or underline", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "dossier"} onCopyDossierSection={() => {}} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const rest = setup.captureSpans().lines.flatMap((line) => line.spans)
    expect(rest.some((span) => (span.attributes & TextAttributes.UNDERLINE) !== 0)).toBe(false)
    const at = chipAt(setup.captureCharFrame(), "verdicts")
    expect(at).toBeDefined()
    await setup.mockMouse.moveTo(at!.x, at!.y)
    await setup.renderOnce()
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    expect(spans.some((span) => (span.attributes & TextAttributes.UNDERLINE) !== 0)).toBe(false)
    const chip = spans.find((span) => span.text === "verdicts")
    expect(chip).toBeDefined()
    expect(chip!.attributes & TextAttributes.BOLD).not.toBe(0)
    await setup.renderer.destroy()
  })

  test("left-clicking a chip copies that section verbatim — heading included, next section excluded", async () => {
    const copied: { label: string; raw: string }[] = []
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "dossier"} onCopyDossierSection={(label, raw) => copied.push({ label, raw })} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const at = chipAt(setup.captureCharFrame(), "verdicts")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x, at!.y)
    await setup.renderOnce()
    expect(copied.length).toBe(1)
    expect(copied[0]!.label).toBe("verdicts")
    expect(copied[0]!.raw.startsWith("## Verdict trail (")).toBe(true)
    expect(copied[0]!.raw).toContain("Tallies:")
    expect(copied[0]!.raw).not.toContain("## Boundary compaction")
    expect(setup.captureCharFrame()).toContain("✓ copied") // the in-modal acknowledgment, painted on the chip
    await setup.renderer.destroy()
  })

  test("the copied acknowledgment demotes to `+ copied` under NO_COLOR — words, not hue", async () => {
    const previous = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    try {
      const copied: string[] = []
      const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "dossier"} onCopyDossierSection={(_label, raw) => copied.push(raw)} />, { width: 112, height: 44 })
      await setup.renderOnce()
      const at = chipAt(setup.captureCharFrame(), "totals")
      expect(at).toBeDefined()
      await setup.mockMouse.click(at!.x, at!.y)
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("+ copied")
      expect(frame).not.toContain("✓ copied")
      expect(copied.length).toBe(1)
      await setup.renderer.destroy()
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = previous
    }
  })

  test("right click on a chip is inert — no copy, no acknowledgment", async () => {
    const copied: string[] = []
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "dossier"} onCopyDossierSection={(_label, raw) => copied.push(raw)} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const at = chipAt(setup.captureCharFrame(), "verdicts")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x, at!.y, 2)
    await setup.renderOnce()
    expect(copied.length).toBe(0)
    expect(setup.captureCharFrame()).not.toContain("✓ copied")
    await setup.renderer.destroy()
  })

  test("unwired, the rail does not paint — the document renders exactly as before", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => "dossier"} />, { width: 112, height: 44 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Goal loop dossier") // the document still paints
    expect(findIn(frame, "verdicts")).toBeUndefined() // no chip labels
    expect(findIn(frame, "compaction")).toBeUndefined()
    await setup.renderer.destroy()
  })
})

describe("verdict trail as a control (mouse — the timeline scrubs, not just reports)", () => {
  const trailGoal = (): GoalSnapshot => loopedGoal({
    history: [
      { turn: 1, verdict: "not_met", reason: "api shape still wrong", at: now - 1000 * 60 * 60 },
      { turn: 2, verdict: "met", reason: "refactor landed green", at: now - 1000 * 60 * 30 },
      { turn: 3, verdict: "not_met", reason: "", at: now - 1000 * 60 * 10 }, // an empty reason stays an inert picture
    ],
  })
  const trailRender = (goal: GoalSnapshot, width = 100, height = 40) =>
    testRender(() => <LoopSection goal={goal} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyReason={(r) => { copied.push(r) }} />, { width, height })
  const copied: string[] = []
  const dotX = (frame: string, index: number) => {
    const at = findIn(frame, "trail")
    expect(at).toBeDefined()
    return at!.x + 10 + 2 + index // label column (10) + gap (2) + the dot's ordinal cell
  }

  test("clicking the timeline's dots copies that turn's reason — earlier verdicts are reachable, not just the last three", async () => {
    copied.length = 0
    const setup = await trailRender(trailGoal())
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    // Turn 1 — the reason the why ledger would not reach from here (the ledger shows newest first, 3 max)
    await setup.mockMouse.click(dotX(frame, 0), findIn(frame, "trail")!.y)
    // Turn 2 — a different reason, from a different dot
    await setup.mockMouse.click(dotX(frame, 1), findIn(frame, "trail")!.y)
    await setup.renderOnce()
    expect(copied).toEqual(["api shape still wrong", "refactor landed green"])
    await setup.renderer.destroy()
  })

  test("left click activates, right click is inert — button discipline is the same everywhere else in the dialog", async () => {
    copied.length = 0
    const setup = await trailRender(trailGoal())
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const y = findIn(frame, "trail")!.y
    await setup.mockMouse.click(dotX(frame, 0), y, 2)
    await setup.renderOnce()
    expect(copied).toEqual([])
    await setup.renderer.destroy()
  })

  test("a dot whose reason is empty is inert — the picture paints, no copy fires", async () => {
    copied.length = 0
    const setup = await trailRender(trailGoal())
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const y = findIn(frame, "trail")!.y
    await setup.mockMouse.click(dotX(frame, 2), y)
    await setup.renderOnce()
    expect(copied).toEqual([])
    await setup.renderer.destroy()
  })

  test("hover names the turn; the resting frame carries no hover tag; a click adds the copied acknowledgment", async () => {
    copied.length = 0
    const setup = await trailRender(trailGoal())
    await setup.renderOnce()
    const rest = setup.captureCharFrame()
    expect(rest).not.toContain("verdicts · turn 2")
    const x = dotX(rest, 1)
    const y = findIn(rest, "trail")!.y
    await setup.mockMouse.moveTo(x, y)
    await setup.renderOnce()
    const hovered = setup.captureCharFrame()
    expect(hovered).toContain("verdicts · turn 2")
    expect(hovered).not.toContain("✓ copied")
    await setup.mockMouse.click(x, y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("verdicts · turn 2 · ✓ copied")
    expect(copied).toEqual(["refactor landed green"])
    await setup.renderer.destroy()
  })
})

/** Locate the first occurrence of `needle` in the painted frame — row index is the y cell, column is the x cell. */
const findRow = (frame: string, needle: string): { x: number; y: number } | undefined => {
  const lines = frame.split("\n")
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(needle)
    if (x !== -1) return { x, y }
  }
  return undefined
}

describe("StatusDialogBody — the record, on trial (the verify row)", () => {
  const dossierAt = (frame: string): { x: number; y: number } | undefined => findIn(frame, "dossier")
  const verifyRowAt = (frame: string): { x: number; y: number } | undefined => findIn(frame, "the shas the record quotes, checked")

  test("the dossier tab paints a verify row; one click runs the host sweep and paints the outcome in place", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyDossier={() => {}} onVerifyDossier={() => { sweeps += 1; return { unique: 2, present: 2, missing: 0, unknown: 0 } }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const row = verifyRowAt(frame)
    expect(row).toBeDefined()
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(sweeps).toBe(1)
    expect(setup.captureCharFrame()).toContain("✓ 2/2 resolve")
    await setup.renderer.destroy()
  })

  test("mono demotes the pass glyph to + — the counts never demote", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} mono={true} onVerifyDossier={() => ({ unique: 6, present: 6, missing: 0, unknown: 0 })} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = verifyRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("+ 6/6 resolve")
    await setup.renderer.destroy()
  })

  test("a missing sha paints the unresolvable arm, not the pass", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onVerifyDossier={() => ({ unique: 4, present: 2, missing: 2, unknown: 0 })} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = verifyRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("✗ 2 of 4 unresolvable")
    await setup.renderer.destroy()
  })

  test("right click on the verify row is inert — the power button runs nothing", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onVerifyDossier={() => { sweeps += 1; return { unique: 2, present: 2, missing: 0, unknown: 0 } }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = verifyRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y, 2)
    await setup.renderOnce()
    expect(sweeps).toBe(0)
    await setup.renderer.destroy()
  })

  test("the verify row does not paint when the host leaves it unwired — the document renders exactly as before", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Goal loop dossier")
    expect(frame).not.toContain("the shas the record quotes, checked")
    await setup.renderer.destroy()
  })

  test("a host that returns undefined runs the click but paints no ack — the row never claims a sweep that did not happen", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onVerifyDossier={() => { sweeps += 1; return undefined }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = verifyRowAt(setup.captureCharFrame())
    expect(row).toBeDefined()
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(sweeps).toBe(1)
    expect(setup.captureCharFrame()).not.toContain("resolve")
    await setup.renderer.destroy()
  })
})

describe("StatusDialogBody — the record, in reach (the reach row)", () => {
  const dossierAt = (frame: string): { x: number; y: number } | undefined => findIn(frame, "dossier")
  const reachRowAt = (frame: string): { x: number; y: number } | undefined => findIn(frame, "the shas the record quotes, on this line")

  test("the dossier tab paints a reach row; one click runs the host sweep and paints the outcome in place", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyDossier={() => {}} onReachDossier={() => { sweeps += 1; return { unique: 2, ancestors: 2, unreached: 0, unknown: 0 } }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const row = reachRowAt(frame)
    expect(row).toBeDefined()
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(sweeps).toBe(1)
    expect(setup.captureCharFrame()).toContain("✓ 2/2 on this line")
    await setup.renderer.destroy()
  })

  test("mono demotes the pass glyph to + — the counts never demote", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} mono={true} onReachDossier={() => ({ unique: 6, ancestors: 6, unreached: 0, unknown: 0 })} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = reachRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("+ 6/6 on this line")
    await setup.renderer.destroy()
  })

  test("a sha not on this line paints the unreached arm, not the pass", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onReachDossier={() => ({ unique: 4, ancestors: 2, unreached: 2, unknown: 0 })} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = reachRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("✗ 2 of 4 not on this line")
    await setup.renderer.destroy()
  })

  test("right click on the reach row is inert — the power button runs nothing", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onReachDossier={() => { sweeps += 1; return { unique: 2, ancestors: 2, unreached: 0, unknown: 0 } }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = reachRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y, 2)
    await setup.renderOnce()
    expect(sweeps).toBe(0)
    await setup.renderer.destroy()
  })

  test("the reach row does not paint when the host leaves it unwired — the document renders exactly as before", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Goal loop dossier")
    expect(frame).not.toContain("the shas the record quotes, on this line")
    await setup.renderer.destroy()
  })

  test("a host that returns undefined runs the click but paints no ack — the row never claims a sweep that did not happen", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onReachDossier={() => { sweeps += 1; return undefined }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = reachRowAt(setup.captureCharFrame())
    expect(row).toBeDefined()
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(sweeps).toBe(1)
    expect(setup.captureCharFrame()).not.toContain("2/2 on this line")
    await setup.renderer.destroy()
  })
})

describe("StatusDialogBody — the record, under seal (the sign row)", () => {
  const dossierAt = (frame: string): { x: number; y: number } | undefined => findIn(frame, "dossier")
  const signRowAt = (frame: string): { x: number; y: number } | undefined => findIn(frame, "the shas the record quotes, signed")

  test("the dossier tab paints a sign row; one click runs the host sweep and paints the outcome in place", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyDossier={() => {}} onSignDossier={() => { sweeps += 1; return { unique: 2, verified: 2, unverified: 0, unknown: 0 } }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const row = signRowAt(frame)
    expect(row).toBeDefined()
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(sweeps).toBe(1)
    expect(setup.captureCharFrame()).toContain("✓ 2/2 signed")
    await setup.renderer.destroy()
  })

  test("mono demotes the pass glyph to + — the counts never demote", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} mono={true} onSignDossier={() => ({ unique: 6, verified: 6, unverified: 0, unknown: 0 })} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = signRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("+ 6/6 signed")
    await setup.renderer.destroy()
  })

  test("a sha that does not verify paints the unverified arm, not the pass", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onSignDossier={() => ({ unique: 4, verified: 2, unverified: 2, unknown: 0 })} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = signRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("✗ 2 of 4 unsigned")
    await setup.renderer.destroy()
  })

  test("right click on the sign row is inert — the power button runs nothing", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onSignDossier={() => { sweeps += 1; return { unique: 2, verified: 2, unverified: 0, unknown: 0 } }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = signRowAt(setup.captureCharFrame())
    await setup.mockMouse.click(row!.x, row!.y, 2)
    await setup.renderOnce()
    expect(sweeps).toBe(0)
    await setup.renderer.destroy()
  })

  test("the sign row does not paint when the host leaves it unwired — the document renders exactly as before", async () => {
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Goal loop dossier")
    expect(frame).not.toContain("the shas the record quotes, signed")
    await setup.renderer.destroy()
  })

  test("a host that returns undefined runs the click but paints no ack — the row never claims a sweep that did not happen", async () => {
    let sweeps = 0
    const setup = await testRender(() => <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onSignDossier={() => { sweeps += 1; return undefined }} />, { width: 112, height: 44 })
    await setup.renderOnce()
    await setup.mockMouse.click(dossierAt(setup.captureCharFrame())!.x, dossierAt(setup.captureCharFrame())!.y)
    await setup.renderOnce()
    const row = signRowAt(setup.captureCharFrame())
    expect(row).toBeDefined()
    await setup.mockMouse.click(row!.x, row!.y)
    await setup.renderOnce()
    expect(sweeps).toBe(1)
    expect(setup.captureCharFrame()).not.toContain("2/2 signed")
    await setup.renderer.destroy()
  })
})

describe("StatusDialogBody — find in the record (the dossier spotlight)", () => {
  const dossierProps = () => ({ goal: loopedGoal(), fallback: "fb", theme, elapsedMs: () => 1000 * 60 * 12, nowMs: () => now, view: () => "dossier" as const })

  test("the dossier tab paints a find row; the bar is closed and resets on toggle", async () => {
    const setup = await testRender(() => <StatusDialogBody {...dossierProps()} />, { width: 112, height: 40 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("find in the record")
    expect(frame).not.toContain("type to find")
    const at = findRow(frame, "find in the record")!
    await setup.mockMouse.click(at.x + 2, at.y)
    await setup.renderOnce()
    const opened = setup.captureCharFrame()
    expect(opened).toContain("hide find")
    expect(opened).toContain("type to find...")
    expect(opened).toContain("no matches")
    // one click while open hides the bar and clears the query
    const hideAt = findRow(opened, "hide find")!
    await setup.mockMouse.click(hideAt.x + 2, hideAt.y)
    await setup.renderOnce()
    const closed = setup.captureCharFrame()
    expect(closed).toContain("find in the record")
    expect(closed).not.toContain("type to find")
    expect(closed).not.toContain("no matches")
    await setup.renderer.destroy()
  })

  test("typing into the open bar filters the document and boldens the matches (count rides the same query)", async () => {
    const setup = await testRender(() => <StatusDialogBody {...dossierProps()} />, { width: 112, height: 40 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findRow(frame, "find in the record")!
    await setup.mockMouse.click(at.x + 2, at.y)
    await setup.renderOnce()
    await setup.mockInput.typeText("iteration", 5)
    await setup.renderOnce()
    const filtered = setup.captureCharFrame()
    expect(filtered).not.toContain("type to find")
    expect(filtered).toMatch(/[1-9]\d* matches/)
    // the matches paint bold; weight is the NO_COLOR contract for the highlight
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const emphatized = spans.filter((span) => span.text === "iteration" && (span.attributes & TextAttributes.BOLD) !== 0)
    expect(emphatized.length).toBeGreaterThan(0)
    await setup.renderer.destroy()
  })

  test("a query with no occurrences demotes the whole document to faint and says so", async () => {
    const setup = await testRender(() => <StatusDialogBody {...dossierProps()} />, { width: 112, height: 40 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findRow(frame, "find in the record")!
    await setup.mockMouse.click(at.x + 2, at.y)
    await setup.renderOnce()
    await setup.mockInput.typeText("zzz-no-such-token", 5)
    await setup.renderOnce()
    const filtered = setup.captureCharFrame()
    expect(filtered).toContain("no matches")
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const title = spans.find((span) => span.text === "Goal loop dossier")
    expect(title).toBeDefined()
    expect((title!.fg as RGBA).equals(RGBA.fromHex("#6f6f6f"))).toBe(true)
    await setup.renderer.destroy()
  })

  test("the close button clears the query and unmounts the bar", async () => {
    const setup = await testRender(() => <StatusDialogBody {...dossierProps()} />, { width: 112, height: 40 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findRow(frame, "find in the record")!
    await setup.mockMouse.click(at.x + 2, at.y)
    await setup.renderOnce()
    await setup.mockInput.typeText("iteration", 5)
    await setup.renderOnce()
    const opened = setup.captureCharFrame()
    expect(opened).toMatch(/[1-9]\d* matches/)
    const closeAt = findRow(opened, "close")!
    await setup.mockMouse.click(closeAt.x + 1, closeAt.y)
    await setup.renderOnce()
    const closed = setup.captureCharFrame()
    expect(closed).toContain("find in the record")
    expect(closed).not.toContain("no matches")
    expect(closed).not.toMatch(/[1-9]\d* matches/)
    await setup.renderer.destroy()
  })

  test("leaving the dossier tab unmounts and resets the bar; coming back greets a fresh row", async () => {
    const Stateful = () => {
      const [view, setView] = createSignal<"overview" | "ledger" | "dossier">("dossier")
      return <StatusDialogBody goal={loopedGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} view={() => view()} onViewChange={(v) => setView(v)} />
    }
    const setup = await testRender(() => <Stateful />, { width: 112, height: 40 })
    await setup.renderOnce()
    let frame = setup.captureCharFrame()
    const at = findRow(frame, "find in the record")!
    await setup.mockMouse.click(at.x + 2, at.y)
    await setup.renderOnce()
    await setup.mockInput.typeText("iteration", 5)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toMatch(/[1-9]\d* matches/)
    // leave to the ledger tab — the find bar must not ride the record over there
    const ledgerAt = findRow(setup.captureCharFrame(), "ledger")!
    await setup.mockMouse.click(ledgerAt.x + 1, ledgerAt.y)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    expect(frame).not.toContain("type to find")
    expect(frame).not.toContain("no matches")
    // back to the dossier — the row is there, closed, query reset
    const dossierAt = findRow(frame, "dossier")!
    await setup.mockMouse.click(dossierAt.x + 1, dossierAt.y)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    expect(frame).toContain("find in the record")
    expect(frame).not.toContain("type to find")
    await setup.renderer.destroy()
  })

  test("the find arm holds under mono (weight alone carries the highlight)", async () => {
    const setup = await testRender(() => <StatusDialogBody {...dossierProps()} mono={true} />, { width: 112, height: 40 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const at = findRow(frame, "find in the record")!
    await setup.mockMouse.click(at.x + 2, at.y)
    await setup.renderOnce()
    await setup.mockInput.typeText("iteration", 5)
    await setup.renderOnce()
    const filtered = setup.captureCharFrame()
    expect(filtered).toMatch(/[1-9]\d* matches/)
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const emphatized = spans.filter((span) => span.text === "iteration" && (span.attributes & TextAttributes.BOLD) !== 0)
    expect(emphatized.length).toBeGreaterThan(0)
    await setup.renderer.destroy()
  })
})
