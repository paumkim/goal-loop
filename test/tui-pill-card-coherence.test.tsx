/**
 * The pill and the HUD card both claim the row directly above the prompt through the host's
 * `session.composer.top` slot. Before this workstream they were stacked: the pill painted at
 * top={-1} on the very row the opaque, zIndex=10 card also covers — invisible, but still laid
 * out, hit-tested and breath-timed. Now the pill mount gate (`<Show when={!cardFor()}>` in
 * src/tui.tsx) suppresses it by construction while the card is open, and the breath timer is
 * gated the same way. This suite pins (a) the wiring in src/tui.tsx via source contract, and
 * (b) the painted outcome of the gated mount via a headless render of the real HudCard and the
 * real pill model. Requires the solid preload (test/bunfig.toml) for part (b).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { HudCard, hudCardRows, type HudCardTheme } from "../src/hud-card.tsx"
import { pillModel } from "../src/core/hud.ts"
import type { GoalSnapshot, Verdict } from "../src/core/types.ts"

const theme: HudCardTheme = {
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
  border: { base: RGBA.fromHex("#3f3f3f") },
  background: { raised: { high: RGBA.fromHex("#161616") } },
}

const now = 1_800_000_000_000
const verdicts = (list: Verdict[]): GoalSnapshot["history"] =>
  list.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (list.length - index), toolCalls: 2 }))
const goal = (): GoalSnapshot => ({
  version: 1,
  id: "goal_coherence",
  sessionID: "ses_coherence",
  directory: "/tmp/coherence",
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
  history: verdicts(["met", "not_met", "met", "met", "not_met", "met", "met"]),
  loopEnabled: true,
  loopIteration: 3,
  loopObjective: "make every loop iteration visible at a glance",
  loopMaxLoops: 5,
  evaluating: false,
  waiting: false,
})

const TERMINAL = 80
const MAX_ROWS = 40

describe("the src/tui.tsx wiring that keeps the pill out from behind the card (source contract)", () => {
  const tui = readFileSync(join(import.meta.dir, "../src/tui.tsx"), "utf8")

  test("the pill mount is gated on the card being closed — never painted behind it", () => {
    // The pill's absolute box (top={-1}) must sit inside <Show when={!cardFor()}>: the card is
    // opaque, zIndex 10 and anchored over exactly that row, so an ungated pill paints unseen.
    expect(tui).toMatch(/<Show when=\{!cardFor\(\)\}>[\s\S]{0,600}top=\{-1\}/)
  })

  test("the breath timer does not advance a pill that is not painted", () => {
    expect(tui).toMatch(/if \(animated\(\) && !cardFor\(\) && motionOk\)/)
  })
})

describe("the gated mount, headless (the real pill model and the real HudCard through one mount)", () => {
  const g = goal()
  const cardRows = hudCardRows(g, false, Math.max(8, MAX_ROWS - 2), TERMINAL)
  const pillLine = pillModel(g, 1000 * 60 * 42, false, TERMINAL - 2, 2)!.text

  const compose = (cardOpen: boolean): JSX.Element => (
    <box flexDirection="column" width={TERMINAL} height={cardRows + 1}>
      {cardOpen ? (
        <box position="absolute" top={0} left={0} right={0} height={cardRows} zIndex={10}>
          <HudCard
            goal={g}
            theme={theme}
            elapsedMs={() => 1000 * 60 * 42}
            nowMs={() => now}
            onClose={() => {}}
            onDetails={() => {}}
            onClear={() => {}}
            onCopyCondition={() => {}}
            onTogglePin={() => {}}
            width={TERMINAL}
          />
        </box>
      ) : (
        <box />
      )}
      {/* The gate, literally as src/tui.tsx writes it: the pill never mounts while the card is open. */}
      {!cardOpen && (
        <box position="absolute" top={cardRows} left={0} height={1} paddingLeft={1} flexDirection="row">
          <text fg={theme.text.muted} wrapMode="none">
            {pillLine}
          </text>
        </box>
      )}
    </box>
  )

  test("card open: the pill text is nowhere in the frame; the card's affordance row is", async () => {
    const setup = await testRender(() => compose(true), { width: TERMINAL, height: cardRows + 1 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame.split("\n").some((row) => row.includes(pillLine))).toBe(false)
    expect(frame).toContain("[details]")
    await setup.renderer.destroy()
  })

  test("card closed: the pill text paints; the card's affordance row does not", async () => {
    const setup = await testRender(() => compose(false), { width: TERMINAL, height: cardRows + 1 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame.split("\n").some((row) => row.includes(pillLine))).toBe(true)
    expect(frame).not.toContain("[details]")
    await setup.renderer.destroy()
  })
})
