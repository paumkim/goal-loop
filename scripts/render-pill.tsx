/**
 * Headless render of the ambient goal pill — the "it's alive and working, don't worry" indicator.
 * Mounts the real composition tui.tsx mounts (pillModel text inside the same absolute
 * 1-row box over a jump-row substrate), across the breath's phases. Not shipped (scripts/ is not
 * in package.json `files`).
 *
 *   bun --preload @opentui/solid/preload scripts/render-pill.tsx [--mono] [--width=N]
 *
 * --mono prints the reduced-color arm (NO_COLOR set): the family demotes to `*`, `o`, `|`, `+` /
 * `?` / `x` and weight carries whatever the wave cannot say.
 *
 * The breath frames (phases 0-3 + the undefined resting frame) are printed together so the
 * one-cell drift contract can be diffed by eye or by script: only the leading dot may change.
 */
import { RGBA, TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { pillModel, terminalPill, breathCrest, type NeutralTheme } from "../src/core/hud.ts"
import type { GoalSnapshot } from "../src/core/types.ts"
import { widthFlag } from "./width-flag.ts"
import { PALETTE } from "./render-theme.ts"

const mono = process.argv.includes("--mono")
if (mono) process.env.NO_COLOR = "1"
const terminal = widthFlag(process.argv.slice(2), 150)

const theme: NeutralTheme<RGBA> = {
  text: {
    base: PALETTE.base,
    muted: PALETTE.muted,
    faint: PALETTE.faint,
    feedback: {
      info: { base: PALETTE.info },
      warning: { base: PALETTE.warning },
      error: { base: PALETTE.error },
      success: { base: PALETTE.success },
    },
  },
}

const now = 1_800_000_000_000
const base: GoalSnapshot = {
  version: 1,
  id: "goal_pill",
  sessionID: "ses_pill",
  directory: "/tmp/pill",
  condition: "make every loop iteration visible at a glance",
  status: "active",
  setAt: now - 1000 * 60 * 42,
  startedAt: now - 1000 * 60 * 42,
  turns: 31,
  elapsedMs: 1000 * 60 * 42,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [{ turn: 1, verdict: "not_met", reason: "not yet", at: now - 1000 * 60 * 40, toolCalls: 2 }],
  evaluating: false,
  waiting: false,
}
const ascii = mono
const toneFg = (tone: string | undefined): RGBA => {
  if (mono) return theme.text.muted
  if (tone === "paused" || tone === "hot" || tone === "retrying" || tone === "impossible") return theme.text.feedback.warning.base
  if (tone === "failed") return theme.text.feedback.error?.base ?? theme.text.feedback.warning.base
  if (tone === "evaluating" || tone === "waiting") return theme.text.feedback.info.base
  if (tone === "achieved") return theme.text.feedback.success?.base ?? theme.text.feedback.info.base
  return theme.text.muted
}

const mount = async (name: string, goal: GoalSnapshot, phase: number | undefined, boldCrest: boolean) => {
  const isTerminal = goal.status === "achieved" || goal.status === "impossible" || goal.status === "failed"
  const model = (isTerminal
    ? terminalPill(goal, goal.elapsedMs, ascii)
    : pillModel(goal, 1000 * 60 * 42, ascii, Number.POSITIVE_INFINITY, phase))!
  const crest = boldCrest && breathCrest(phase)
  const attrs = crest ? TextAttributes.BOLD : undefined
  const line = model.text
  const setup = await testRender(
    () => (
      <box flexDirection="column" width={terminal} height={2}>
        <box position="absolute" top={0} left={0} width={terminal} height={1} paddingLeft={0} flexDirection="row">
          <text fg={toneFg(model.tone)} wrapMode="none" attributes={attrs}>
            {line}
          </text>
        </box>
        <box position="absolute" top={1} left={0} width={terminal} height={1} paddingLeft={0} flexDirection="row">
          <text fg={theme.text.faint} wrapMode="none">
            {"jump-to-latest row (host chrome)"}
          </text>
        </box>
      </box>
    ),
    { width: terminal, height: 2 },
  )
  await setup.renderOnce()
  console.log(name)
  console.log(setup.captureCharFrame())
  await setup.renderer.destroy()
}

const working = base
const checking = { ...base, evaluating: true }
const waiting = { ...base, waiting: true }
const paused = { ...base, status: "paused" as const }
const stuck = { ...base, retries: 3 }
const achieved = { ...base, status: "achieved" as const }

console.log(`=== ambient pill · ${mono ? "mono (NO_COLOR)" : "unicode"} · terminal ${terminal} ===`)
for (const phase of [0, 1, 2, 3]) {
  await mount(`--- working · phase ${phase} ---`, working, phase, false)
}
await mount("--- working · resting (reduced motion) ---", working, undefined, false)
for (const phase of [0, 1, 2, 3]) {
  await mount(`--- checking · phase ${phase}${phase === 2 ? " (crest · bold)" : ""} ---`, checking, phase, true)
}
await mount("--- checking · resting (reduced motion · bold weight) ---", checking, undefined, true)
await mount("--- waiting · static hollow ---", waiting, undefined, false)
await mount("--- paused · static bars ---", paused, undefined, false)
await mount("--- stuck · static solid (3 retries) ---", stuck, undefined, false)
await mount("--- achieved · terminal acknowledgment ---", achieved, undefined, false)
process.exit(0)
