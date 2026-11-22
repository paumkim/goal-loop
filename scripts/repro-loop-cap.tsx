/**
 * Headless reproduction of the loop-position indicator across loop caps — the pill, the HUD card and
 * the /goal dialog, mounted from the same snapshot at caps 5 (small), 50, 99, 100 and 1000 (large).
 * Not shipped (scripts/ is not in package.json `files`).
 *
 *   bun --preload @opentui/solid/preload scripts/repro-loop-cap.tsx [--caps=5,50,99,100,1000] [--width=80]
 *
 * One frame per surface per cap. `--caps` exists so a regression test can render the exact cap it
 * pins without a bespoke script.
 */
import { RGBA, TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { HudCard, type HudCardTheme } from "../src/hud-card.tsx"
import { StatusDialogBody } from "../src/status-dialog.tsx"
import { pillModel, type NeutralTheme } from "../src/core/hud.ts"
import type { GoalSnapshot } from "../src/core/types.ts"
import { widthFlag } from "./width-flag.ts"
const capFlag = process.argv.slice(2).find((a) => a.startsWith("--caps="))
const caps = (capFlag ? capFlag.slice("--caps=".length) : "5,50,99,100,1000")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
const terminal = widthFlag(process.argv.slice(2), 80)
const theme: HudCardTheme & NeutralTheme<RGBA> = {
  text: {
    base: RGBA.fromHex("#e8e8e8"),
    muted: RGBA.fromHex("#a0a0a0"),
    faint: RGBA.fromHex("#6f6f6f"),
    feedback: {
      info: { base: RGBA.fromHex("#6cb6ff") },
      warning: { base: RGBA.fromHex("#e0af3c") },
      error: { base: RGBA.fromHex("#ff6c6c") },
      success: { base: RGBA.fromHex("#7ee787") },
    },
  },
  border: { base: RGBA.fromHex("#3f3f3f") },
  background: { raised: { high: RGBA.fromHex("#161616") } },
}
const now = 1_800_000_000_000
const goalAt = (cap: number): GoalSnapshot => ({
  version: 1,
  id: "goal_cap",
  sessionID: "ses_cap",
  directory: "/tmp/cap",
  stall: 0,
  condition: "make every loop iteration visible at a glance in the /goal dialog",
  status: "active",
  startedAt: now - 1000 * 60 * 42,
  setAt: now - 1000 * 60 * 42,
  turns: 31,
  elapsedMs: 1000 * 60 * 42,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [
    { turn: 1, verdict: "met", reason: "done", at: now - 1000 * 60 * 30, toolCalls: 4 },
    { turn: 2, verdict: "met", reason: "done", at: now - 1000 * 60 * 20, toolCalls: 4 },
  ],
  evaluating: false,
  waiting: false,
  loopEnabled: true,
  loopIteration: 3,
  loopObjective: "make every loop iteration visible at a glance",
  loopMaxLoops: cap,
  // Two completed iterations, so the pip visual has real progress to paint at every cap.
  loopHistory: [
    { version: 1, condition: "first pass", summary: "first pass landed", reason: "met", turns: 4, toolCalls: 6, endedAt: now - 1000 * 60 * 30 },
    { version: 2, condition: "second pass", summary: "second pass landed", reason: "met", turns: 3, toolCalls: 5, endedAt: now - 1000 * 60 * 20 },
  ],
  loopNotProgress: 0,
})
const mountPill = async (goal: GoalSnapshot) => {
  const model = pillModel(goal, goal.elapsedMs, false, Math.max(1, terminal - 3), 2)!
  const setup = await testRender(
    () => (
      <box flexDirection="column" width={terminal} height={1}>
        <text fg={theme.text.muted} wrapMode="none" attributes={TextAttributes.BOLD}>
          {model.text}
        </text>
      </box>
    ),
    { width: terminal, height: 1 },
  )
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  await setup.renderer.destroy()
  return frame
}
const mountCard = async (goal: GoalSnapshot) => {
  const setup = await testRender(
    () => (
      <HudCard
        goal={goal}
        theme={theme}
        elapsedMs={() => goal.elapsedMs}
        nowMs={() => now}
        onClose={() => {}}
        onDetails={() => {}}
        onClear={() => {}}
        onCopyCondition={() => {}}
        onTogglePin={() => {}}
        width={terminal}
      />
    ),
    { width: terminal, height: 12 },
  )
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  await setup.renderer.destroy()
  return frame
}
const mountDialog = async (goal: GoalSnapshot) => {
  const setup = await testRender(
    () => (
      <box width={terminal} height={24} flexDirection="column">
        <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
          /goal · loop
        </text>
        <scrollbox flexGrow={1} scrollX={false} contentOptions={{ minHeight: 0 }}>
          <StatusDialogBody
            goal={goal}
            fallback="no cached goal snapshot"
            theme={theme}
            elapsedMs={() => goal.elapsedMs}
            nowMs={() => now}
            onCopyCondition={() => {}}
            onCopyReason={() => {}}
            onCopySummary={() => {}}
            onCopyAttestation={() => {}}
            onCopyTally={() => {}}
            onCopyVerify={() => {}}
            onViewTranscript={() => {}}
            others={[]}
            sessionLabel={(id) => id}
          />
        </scrollbox>
      </box>
    ),
    { width: terminal, height: 24 },
  )
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  await setup.renderer.destroy()
  return frame
}
for (const cap of caps) {
  const goal = goalAt(cap)
  console.log(`===== cap ${cap} =====`)
  const pill = await mountPill(goal)
  console.log(`--- pill · cap ${cap} ---`)
  console.log(pill)
  const card = await mountCard(goal)
  console.log(`--- card · cap ${cap} ---`)
  console.log(card)
  const dialog = await mountDialog(goal)
  console.log(`--- dialog · cap ${cap} ---`)
  console.log(dialog)
  const present = (frame: string, needle: string) => (frame.includes(needle) ? "yes" : "NO")
  console.log(`pill v3/${cap}=${present(pill, `v3/${cap}`)} card v3/${cap}=${present(card, `v3/${cap}`)} dialog v3-or-of-at-most=${present(dialog, `v3 of at most ${cap}`)}`)
}
process.exit(0)