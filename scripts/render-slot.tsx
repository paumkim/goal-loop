/**
 * Headless render of the `session.composer.top` mount — the pill and the card through ONE slot,
 * the way src/tui.tsx wires them — to prove the two layers never paint on top of each other.
 * Mounts the real pill line (pillModel at the same width budget) and the real HudCard inside one
 * zero-flow absolutely-positioned mount; the pill's mount gate (`<Show when={!cardFor()}>`) is
 * mirrored literally, and the source-of-truth gate in src/tui.tsx is pinned separately by
 * test/tui-pill-card-coherence.test.tsx. Not shipped (scripts/ is not in package.json `files`).
 *
 *   bun --preload @opentui/solid/preload scripts/render-slot.tsx [--width=N]
 *
 * Frames:
 *   === slot · card open — the pill is suppressed, the card holds the row ===
 *   === slot · card closed — the pill paints, no card under it               ===
 * For machine checks the script prints two verdict lines:
 *   pill-in-open-card-frame=no    (must be no  — the pill never paints behind/under the card)
 *   pill-in-closed-card-frame=yes (must be yes — closing the card restores the pill)
 */
import { RGBA, TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { HudCard, hudCardRows, type HudCardTheme } from "../src/hud-card.tsx"
import { pillModel, type NeutralTheme } from "../src/core/hud.ts"
import type { GoalSnapshot, Verdict } from "../src/core/types.ts"

const widthFlag = process.argv.slice(2).find((a) => a.startsWith("--width="))
const parsed = widthFlag ? Number(widthFlag.slice("--width=".length)) : Number.NaN
const terminal = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 80

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
const verdicts = (list: Verdict[]): GoalSnapshot["history"] =>
  list.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (list.length - index), toolCalls: verdict === "met" ? 4 : 2 }))
const goal: GoalSnapshot = {
  version: 1,
  id: "goal_slot",
  sessionID: "ses_slot",
  directory: "/tmp/slot",
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
  history: verdicts(["met", "not_met", "met", "met", "not_met", "met", "met"]),
  loopEnabled: true,
  loopIteration: 3,
  loopObjective: "make every loop iteration visible at a glance",
  loopMaxLoops: 5,
  evaluating: false,
  waiting: false,
  spend: { input: 1_480_000, output: 2_100, reasoning: 0, cacheRead: 739_000, cacheWrite: 0, cost: 0.9 },
}

// The pill line exactly as tui.tsx composes it (post-Workstream XV: no leading glyph; the breath
// dot is part of the model text at the given phase). The leading icon owns cell 0 — no left padding —
// so the label keeps a 1-cell right margin (tui.tsx: width − 1 margin − 2 caret).
const model = pillModel(goal, 1000 * 60 * 42, false, Math.max(1, terminal - 1), 2)!
const pillLine = model.text
const tone = theme.text.muted // working goal, reduced-color posture not requested — muted like the live TUI
const cardRows = hudCardRows(goal, false, Math.max(8, 40 - 2), terminal)

const mount = async (name: string, cardOpen: boolean) => {
  const setup = await testRender(
    () => (
      <box flexDirection="column" width={terminal} height={cardRows + 1}>
        {/* The card mount: same anchor shape as src/tui.tsx (absolute, zIndex 10, left=0 right=0 probe).
            Painted AFTER the pill would paint it over the pill row — here it is the only claimant. */}
        {cardOpen ? (
          <box position="absolute" top={0} left={0} right={0} height={cardRows} zIndex={10}>
            <HudCard
              goal={goal}
              theme={theme}
              elapsedMs={() => 1000 * 60 * 42}
              nowMs={() => now}
              onClose={() => {}}
              onDetails={() => {}}
              onClear={() => {}}
              onCopyCondition={() => {}}
              onTogglePin={() => {}}
              width={terminal}
            />
          </box>
        ) : (
          <box position="absolute" top={0} left={0} width={terminal} height={cardRows} />
        )}
        {/* The pill mount, gate and all: `<Show when={!cardFor()}>` — the pill never mounts while
            the card is open. */}
        {!cardOpen ? (
          <box position="absolute" top={cardRows} left={0} height={1} paddingLeft={0} flexDirection="row">
            <text fg={tone} wrapMode="none" attributes={TextAttributes.BOLD}>
              {pillLine}
            </text>
          </box>
        ) : (
          <box position="absolute" top={cardRows} left={0} height={1}>
            <text fg={theme.text.faint} wrapMode="none">
              {" "}
            </text>
          </box>
        )}
      </box>
    ),
    { width: terminal, height: cardRows + 1 },
  )
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  console.log(name)
  console.log(frame)
  const painted = frame.split("\n").some((row) => row.includes(pillLine))
  console.log(`pill-in-${cardOpen ? "open-card" : "closed-card"}-frame=${painted ? "yes" : "no"}`)
  await setup.renderer.destroy()
  return painted
}

console.log(`=== slot · terminal ${terminal} · the pill yields to the open card ===`)
await mount("=== slot · card open — the pill is suppressed, the card holds the row ===", true)
await mount("=== slot · card closed — the pill paints, no card under it               ===", false)
process.exit(0)
