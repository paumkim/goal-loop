/**
 * The pill and the HUD card are ONE accordion surface: the pill is the persistent stripe on the
 * host's jump-to-latest row (the panel's bottom seam while open), and the card expands upward
 * from it — left click toggles the panel, right click opens the dashboard. The pill mount in
 * src/tui.tsx is no longer gated on the card being closed; the body anchors at
 * top={-(1 + cardRows())} so the footprint never exceeds the old single-budget ceiling, and the
 * breath timer advances whenever the loop is alive. This suite pins (a) the wiring in
 * src/tui.tsx via source contract, and (b) the painted outcome of the accordion geometry via a
 * headless render of the real HudCard and the real pill model. Requires the solid preload
 * (test/bunfig.toml) for part (b).
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

describe("the src/tui.tsx wiring that makes the pill the accordion header (source contract)", () => {
  const tui = readFileSync(join(import.meta.dir, "../src/tui.tsx"), "utf8")

  test("the pill mount is NOT gated on the card being closed — it is the persistent stripe", () => {
    // The pill's absolute box (top={-1}) must never sit inside <Show when={!cardFor()}>: the pill
    // is the accordion's persistent header and the panel's bottom seam while open.
    expect(/<Show when=\{!cardFor\(\)\}>[\s\S]{0,400}top=\{-1\}/.test(tui)).toBe(false)
  })

  test("the panel body mounts one row above the pill stripe, anchored at top={-(1 + cardRows())}", () => {
    expect(tui).toMatch(/top=\{-\(1 \+ cardRows\(\)\)\}/)
  })

  test("the breath timer no longer references the card gate — it advances whenever the loop is alive", () => {
    expect(tui).toMatch(/if \(animated\(\) && motionOk\)/)
    expect(/animated\(\) && !cardFor\(\)/.test(tui)).toBe(false)
  })

  test("the pill carries a trailing caret cell: ▴ collapsed, ▾ open", () => {
    expect(tui).toContain('" ▴"')
    expect(tui).toContain('" ▾"')
  })
})

describe("the accordion geometry, headless (the real pill model and the real HudCard through one mount)", () => {
  const g = goal()
  // Mirror of src/tui.tsx: the viewport ceiling feeds maxCardRows, the body yields one row to the
  // pill stripe (maxBodyRows), and cardRows() is the plan under that cap.
  const maxCardRows = Math.max(8, MAX_ROWS - 2)
  const maxBodyRows = Math.max(8, maxCardRows - 1)
  const cardRows = hudCardRows(g, false, maxBodyRows, TERMINAL)
  const pillLine = pillModel(g, 1000 * 60 * 42, false, TERMINAL - 2 - 2, 2)!.text

  const compose = (cardOpen: boolean): JSX.Element => (
    <box flexDirection="column" width={TERMINAL} height={cardRows + 1}>
      {/* The body, literally as src/tui.tsx anchors it: above the pill stripe, one row per cardRows(). */}
      {cardOpen && (
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
            maxRows={maxBodyRows}
          />
        </box>
      )}
      {/* The pill, always mounted while showing(): the panel's bottom seam when open, the stripe when closed. */}
      <box position="absolute" top={cardRows} left={0} height={1} paddingLeft={1} flexDirection="row">
        <text fg={theme.text.muted} wrapMode="none">
          {pillLine}
        </text>
        <text fg={theme.text.faint} wrapMode="none" flexShrink={0}>
          {cardOpen ? " ▾" : " ▴"}
        </text>
      </box>
    </box>
  )

  test("card open: the pill stripe paints below the card, and it is the last row of the column", async () => {
    const setup = await testRender(() => compose(true), { width: TERMINAL, height: cardRows + 1 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    const rows = frame.replace(/\n+$/, "").split("\n")
    const pillRow = rows.findIndex((row) => row.includes(pillLine))
    const actionsRow = rows.findIndex((row) => row.includes("[details]"))
    expect(pillRow).toBeGreaterThanOrEqual(0)
    expect(actionsRow).toBeGreaterThanOrEqual(0)
    expect(pillRow).toBeGreaterThan(actionsRow)
    expect(pillRow).toBe(rows.length - 1)
    await setup.renderer.destroy()
  })

  test("card closed: the pill stripe paints; the card's affordance row does not", async () => {
    const setup = await testRender(() => compose(false), { width: TERMINAL, height: cardRows + 1 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame.split("\n").some((row) => row.includes(pillLine))).toBe(true)
    expect(frame).not.toContain("[details]")
    await setup.renderer.destroy()
  })
})
