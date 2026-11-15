/**
 * Headless render check for the goal-history components (`src/tui-history.tsx`). Mounts the components
 * in @opentui's test renderer with a fixed-size frame and prints the captured character grid, so the
 * rail / bar / now row / verdict trail / history block can be eyeballed without a live TUI. Not shipped
 * (scripts/ is not in package.json `files`).
 *
 *   bun --preload @opentui/solid/preload scripts/render-history.tsx [width] [height] [--empty]
 *
 * Modes: default prints all three frames (looped goal, non-looped goal with verdicts, fresh
 * non-looped goal); --empty prints the looped frame with an empty history.
 */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { JSX } from "@opentui/solid"
import { HistoryBlock, LoopSection, type HistoryTheme } from "../src/tui-history.tsx"
import type { GoalSnapshot, Verdict } from "../src/core/types.ts"

const width = Number(process.argv[2] ?? 96)
const height = Number(process.argv[3] ?? 34)
const empty = process.argv.includes("--empty")

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

const now = Date.now()
const verdicts: Verdict[] = ["not_met", "not_met", "met", "not_met", "met", "not_met", "not_met", "met", "not_met", "met", "not_met", "met", "not_met", "not_met", "met", "not_met", "met", "not_met", "met", "not_met", "not_met", "met", "not_met", "not_met", "met", "not_met", "met", "not_met", "met", "not_met"]

const baseline = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const spend = { cost: 0.42, input: 182_000, output: 21_400, reasoning: 3_100, cacheRead: 96_000, cacheWrite: 0 }

const loopedGoal: GoalSnapshot = {
  version: 1,
  id: "goal_demo",
  sessionID: "ses_demo",
  directory: "/tmp/demo",
  condition: "the release notes describe the new verifier gate",
  status: "active",
  reason: "Evaluator: docs build still fails on the config page",
  setAt: now - 1000 * 60 * 42,
  startedAt: now - 1000 * 60 * 42,
  turns: 4,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline,
  history: empty ? [] : verdicts.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (42 - index) })),
  loopEnabled: true,
  loopIteration: 3,
  loopObjective: "ship the /goal-loop observability pass: every iteration of the loop is visible at a glance in the /goal dialog",
  loopMaxLoops: 5,
  loopHistory: empty ? [] : [
    { version: 1, condition: "add a progress bar to the loop section", summary: "Added an 18-cell block progress bar under the loop header; filled cells use feedback.info, empty cells text.faint. Caption reads 'vN of at most M · K complete'.", reason: "met", turns: 9, toolCalls: 41, endedAt: now - 1000 * 60 * 27 },
    { version: 2, condition: "render the per-turn evaluator verdict trail", summary: "Trail renders up to the 24 newest verdicts as ✓/✗/⊘ glyphs, oldest first, with a 'shown of total' caption. Left-truncates long trails; section omitted when empty.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12 },
  ],
  loopNotProgress: 0,
  elapsedMs: 1000 * 60 * 12,
  evaluating: false,
  waiting: false,
  spend,
}

const nonLoopedGoal: GoalSnapshot = {
  ...loopedGoal,
  id: "goal_plain",
  condition: "the release notes describe the new verifier gate",
  reason: "Evaluator: docs build still fails on the config page",
  turns: verdicts.length + 4,
  history: (() => {
    const base = verdicts.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "still not", at: now - 1000 * 60 * (42 - index) }))
    const tail = ["not_met", "not_met", "not_met", "not_met"].map((verdict, index) => ({ turn: verdicts.length + index + 1, verdict: verdict as Verdict, reason: "still not", at: now - 1000 * 60 * (4 - index) }))
    return [...base, ...tail]
  })(),
  loopEnabled: undefined,
  loopIteration: undefined,
  loopObjective: undefined,
  loopMaxLoops: undefined,
  loopHistory: undefined,
  loopNotProgress: undefined,
}

const pausedGoal: GoalSnapshot = {
  ...loopedGoal,
  id: "goal_paused",
  status: "paused",
  reason: "Paused after 3 consecutive turns without tool use; resume with /goal to continue.",
  stall: 3,
  retries: 2,
}

const completeGoal: GoalSnapshot = {
  ...loopedGoal,
  id: "goal_complete",
  status: "achieved",
  reason: "Loop complete after 2 iterations",
  turns: 3,
  elapsedMs: 1000 * 60 * 39,
}

const freshGoal: GoalSnapshot = {
  ...nonLoopedGoal,
  id: "goal_fresh",
  reason: undefined,
  turns: 0,
  history: [],
  elapsedMs: 1000 * 60 * 2,
}

const frames: Array<[string, () => JSX.Element]> = empty
  ? [["loop · empty history", () => <LoopSection goal={loopedGoal} theme={theme} elapsedMs={() => 1000 * 60 * 12 + 1000 * 37} />]]
  : [
      ["looped · 2 completed iterations, 30 verdicts", () => <LoopSection goal={loopedGoal} theme={theme} elapsedMs={() => 1000 * 60 * 12 + 1000 * 37} />],
      ["looped · paused (stall/retries diagnostics)", () => <LoopSection goal={pausedGoal} theme={theme} elapsedMs={() => 1000 * 60 * 12} />],
      ["looped · complete (final tally row)", () => <LoopSection goal={completeGoal} theme={theme} elapsedMs={() => 1000 * 60 * 39} />],
      ["non-looped · 34 verdicts, trailing streak", () => <HistoryBlock goal={nonLoopedGoal} theme={theme} elapsedMs={() => 1000 * 60 * 41} />],
      ["non-looped · fresh, no verdicts yet", () => <HistoryBlock goal={freshGoal} theme={theme} elapsedMs={() => 1000 * 60 * 2} />],
    ]

for (const [name, renderFrame] of frames) {
  const setup = await testRender(
    () => (
      <box width={width} height={height} flexDirection="column" padding={1}>
        {renderFrame()}
      </box>
    ),
    { width, height },
  )
  await setup.renderOnce()
  console.log(`=== ${name} ===`)
  console.log(setup.captureCharFrame())
  await setup.renderer.destroy()
}
process.exit(0)
