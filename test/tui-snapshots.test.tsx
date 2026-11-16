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
import { DialogFooter, HudCard, type HudCardTheme } from "../src/hud-card.tsx"
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

  test("StatusDialogBody · verify (the gate ran — the output tail is on screen, click-to-copy)", async () => {
    const downgraded = loopedGoal({
      reason: "Verification `bun run check` did not pass: exit 1: 1 fail\nerror: expected true",
      lastVerify: { command: "bun run check", code: 1, tail: "1 fail\nerror: expected true", at: now - 1000 * 60 * 3 },
    })
    const snapshot = await frame(
      () => <StatusDialogBody goal={downgraded} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopyVerify={() => {}} />,
      100,
      44,
    )
    expect(snapshot).toMatchSnapshot()
  })
})

describe("full-frame snapshots (waiting and remediation states)", () => {
  test("HudCard · waiting (background work is holding evaluation back — the pill's fifth word)", async () => {
    const snapshot = await frame(
      () => <HudCard goal={loopedGoal({ waiting: true })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />,
      80,
      24,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("HudCard · paused at the turn cap (exact remediation: clear or re-arm — never 'try again')", async () => {
    const snapshot = await frame(
      () => <HudCard goal={loopedGoal({ status: "paused", pauseCause: "cap" })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />,
      80,
      26,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("HudCard · judged impossible (remediation rides two rows of the anchor budget)", async () => {
    const snapshot = await frame(
      () => <HudCard goal={loopedGoal({ status: "impossible" })} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />,
      80,
      26,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("StatusDialogBody · paused at the turn cap (the dialog carries the same exact remedy as the card)", async () => {
    const snapshot = await frame(
      () => <StatusDialogBody goal={loopedGoal({ status: "paused", pauseCause: "cap" })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />,
      100,
      44,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("StatusDialogBody · judged impossible (the dialog shows why, not a generic failure)", async () => {
    const snapshot = await frame(
      () => <StatusDialogBody goal={loopedGoal({ status: "impossible" })} fallback="fb" theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />,
      100,
      44,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("LoopSection · a zero-tool met iteration renders the already-satisfied-at-HEAD row", async () => {
    const idle = loopedGoal({
      loopHistory: [
        { version: 1, condition: "add a progress bar", summary: "Inspection only — nothing to build.", reason: "not_met", turns: 2, toolCalls: 0, endedAt: now - 1000 * 60 * 27 },
        { version: 2, condition: "render the verdict trail", summary: "Trail renders up to 24 verdicts.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12 },
      ],
    })
    const snapshot = await frame(
      () => <LoopSection goal={idle} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} />,
      100,
      30,
    )
    expect(snapshot).toMatchSnapshot()
  })
})
describe("full-frame snapshots (chrome tiers and reduced-color frames)", () => {
  test("HudCard · context menu open — all four rows live", async () => {
    const snapshot = await frame(
      () => <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} onCopyReason={() => {}} onCopySummary={() => {}} contextOpen onToggleContext={() => {}} onCloseMenu={() => {}} />,
      80,
      30,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("HudCard · mono (NO_COLOR / TERM=dumb — weight and glyphs carry meaning)", async () => {
    const snapshot = await frame(
      () => <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} mono />,
      80,
      24,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("LoopSection · ASCII frame (NO_COLOR / TERM=dumb — bars and sparkline demote)", async () => {
    const previous = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    try {
      const snapshot = await frame(
        () => <LoopSection goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} nowMs={() => now} onCopySummary={() => {}} />,
        100,
        46,
      )
      expect(snapshot).toMatchSnapshot()
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = previous
    }
  })

  test("DialogFooter · 80 columns (short hint · compact labels)", async () => {
    const snapshot = await frame(
      () => <DialogFooter theme={theme} pinned={() => false} copied={() => false} onCopy={() => {}} onTogglePin={() => {}} onClear={() => {}} />,
      80,
      3,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("DialogFooter · 96 columns (short hint · compact labels — the noun labels overflow at 96)", async () => {
    const snapshot = await frame(
      () => <DialogFooter theme={theme} pinned={() => false} copied={() => false} onCopy={() => {}} onTogglePin={() => {}} onClear={() => {}} />,
      96,
      3,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("DialogFooter · 100 columns (short hint · noun labels)", async () => {
    const snapshot = await frame(
      () => <DialogFooter theme={theme} pinned={() => false} copied={() => false} onCopy={() => {}} onTogglePin={() => {}} onClear={() => {}} />,
      100,
      3,
    )
    expect(snapshot).toMatchSnapshot()
  })

  test("DialogFooter · 140 columns (full hint · full labels)", async () => {
    const snapshot = await frame(
      () => <DialogFooter theme={theme} pinned={() => false} copied={() => false} onCopy={() => {}} onTogglePin={() => {}} onClear={() => {}} />,
      140,
      3,
    )
    expect(snapshot).toMatchSnapshot()
  })
})
