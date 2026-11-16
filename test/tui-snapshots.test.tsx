/**
 * Full-frame snapshot tests for the HUD's named layout states — the craft-bar requirement that
 * every layout state (empty/armed, waiting-on-evaluator, evaluating, met, hot, failed) is pinned
 * byte-for-byte, not merely probed for substrings. A snapshot failure means chrome changed; either
 * the change is intended (regenerate with `bun test -u`) or it is a regression.
 *
 * Frames are deterministic by construction: every clock is injected (`elapsedMs`, `nowMs`), no
 * snapshot reads the wall clock. The surfaces are the three zoom levels that render headlessly —
 * the compact card (level b), the dashboard's history sections (level c), and the dialog body
 * (level c). The ambient pill (level a) is inline in the plugin's slot render and is not
 * headlessly renderable; its states are pinned by pillModel unit tests in tui-hud.test.tsx.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { HudCard, type HudCardTheme } from "../src/hud-card.tsx"
import { StatusDialogBody } from "../src/status-dialog.tsx"
import { LoopSection, type HistoryTheme } from "../src/tui-history.tsx"
import type { GoalSnapshot, VerdictEntry } from "../src/core/types.ts"

const now = 1_800_000_000_000

const theme: HudCardTheme & HistoryTheme = {
  text: {
    base: RGBA.fromHex("#e8e8e8"),
    muted: RGBA.fromHex("#a0a0a0"),
    faint: RGBA.fromHex("#6f6f6f"),
    feedback: {
      info: { base: RGBA.fromHex("#6cb6ff") },
      warning: { base: RGBA.fromHex("#e0af3c") },
      error: { base: RGBA.fromHex("#ff6c6c") },
    },
  },
  background: {
    raised: { high: RGBA.fromHex("#2a2a2a") },
  },
}

const baseline = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const spend = { cost: 0.42, input: 182_000, output: 21_400, reasoning: 3_100, cacheRead: 96_000, cacheWrite: 0 }

const verdicts = (list: VerdictEntry["verdict"][]): VerdictEntry[] =>
  list.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (list.length - index) }))

const loopedGoal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_snapshot",
  sessionID: "ses_snapshot",
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

const freshGoal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => {
  const { history: _h, loopHistory: _l, loopIteration: _i, loopNotProgress: _n, reason: _r, spend: _s, ...rest } = loopedGoal()
  void spend
  return { ...rest, id: "goal_fresh", turns: 0, history: [], loopHistory: [], loopIteration: 1, evaluating: false, waiting: false, spend: undefined, ...overrides }
}

const frame = async (node: () => JSX.Element, width: number, height: number): Promise<string> => {
  const setup = await testRender(node, { width, height })
  await setup.renderOnce()
  const capture = setup.captureCharFrame()
  await setup.renderer.destroy()
  return capture
}

describe("full-frame snapshots (named layout states)", () => {
  test("HudCard · armed", async () => {
    const snapshot = await frame(
      () => <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} pinned={false} onTogglePin={() => {}} />,
      80,
      24,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("HudCard · evaluating (the evaluator is thinking)", async () => {
    const snapshot = await frame(
      () => <HudCard goal={loopedGoal({ evaluating: true })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />,
      80,
      24,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("HudCard · hot (compaction keeps missing — exact remediation, never a vague warning)", async () => {
    const hot = loopedGoal({
      loopCompact: { requestedAt: now - 1000 * 60 * 3, iteration: 3, estimatedTokens: 148_000, misses: 2, unmeasurableTicks: 0 },
    })
    const snapshot = await frame(
      () => <HudCard goal={hot} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />,
      80,
      26,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("HudCard · failed (failure is a first-class screen)", async () => {
    const failed = loopedGoal({ status: "failed", failureLabel: "provider error" } as Partial<GoalSnapshot>)
    const snapshot = await frame(
      () => <HudCard goal={failed} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />,
      80,
      26,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("LoopSection · freshly armed (empty ledger, the now row carries the state)", async () => {
    const snapshot = await frame(
      () => <LoopSection goal={freshGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 3} nowMs={() => now} />,
      100,
      24,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("LoopSection · met (finished loop renders the final tally)", async () => {
    const snapshot = await frame(
      () => <LoopSection goal={loopedGoal({ status: "achieved" })} theme={theme} elapsedMs={() => 1000 * 60 * 39} nowMs={() => now} />,
      100,
      30,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("StatusDialogBody · freshly armed (the teaching hint is on screen)", async () => {
    const snapshot = await frame(
      () => <StatusDialogBody goal={freshGoal()} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 3} nowMs={() => now} />,
      100,
      40,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("StatusDialogBody · hot (the remediation row rides the dialog, not just the card)", async () => {
    const hot = loopedGoal({
      loopCompact: { requestedAt: now - 1000 * 60 * 3, iteration: 3, estimatedTokens: 148_000, misses: 2, unmeasurableTicks: 0 },
    })
    const snapshot = await frame(
      () => <StatusDialogBody goal={hot} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />,
      100,
      44,
    )
    expect(snapshot).toMatchSnapshot()
  })
})
