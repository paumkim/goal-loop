/**
 * Headless alignment invariants for the /goal surfaces — the card and the pill. Mounts the real
 * HudCard (not painted mock rows) at the five widths the layout promises to serve — 52 (the clamp
 * floor), 64, 80, 88 (the design ceiling), 112 (what the live measured-mount can paint) — in both
 * the color and the mono (reduced-color) arm, plus the default terminal-resolved width path
 * (`cardWidth`), and the real pill model through the same one-row absolute mount tui.tsx uses
 * (paddingLeft 1, no frame on the other sides). Not shipped (test/ is not in `files`).
 * Requires the solid preload (test/bunfig.toml).
 *
 * The invariants, measured per frame rather than trusted:
 *   bar        every painted row carries ink in cell 0 — the hanging state bar.
 *   left grid  every painted row snaps its first ink to the LABEL column (cell 3), or, when the
 *              row's gutter is deliberately blank (the context menu's continuation rows), to the
 *              value column (cell 14 — the same cell every labelled row's value paints at). Nothing
 *              lands between them: one two-stop grid, bar to padding to content.
 *   ceiling    no painted cell crosses the right content edge (width − 3 = border 1 + paddingRight 2).
 *   affordance the condition row's `copy` affordance cell, the why row's, and the actions row's
 *              flushRight `[esc]` all share ONE right edge at width − 3. The affordance cell is 8
 *              cells wide with the 4-cell verb painted left, so the verb ink starts at width − 10;
 *              `[esc]` ink ends exactly at width − 3.
 *   pill       the pill paints `budget = width − 2` (1-cell left padding, 1-cell right margin) and,
 *              mounted, inks cell 1 first and never beyond cell width − 2 — under mono too.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import stringWidth from "string-width"
import type { JSX } from "@opentui/solid"
import { HudCard, type HudCardTheme } from "../src/hud-card.tsx"
import { pillModel, terminalPill } from "../src/core/hud.ts"
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

const WIDTHS = [52, 64, 80, 88, 112] as const
const BAR = 0
const LABEL_COL = 3
const VALUE_COL = 14

const now = 1_800_000_000_000
const verdicts = (list: Verdict[]): GoalSnapshot["history"] =>
  list.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (list.length - index), toolCalls: 2 }))
const goal = (): GoalSnapshot => ({
  version: 1,
  id: "goal_align",
  sessionID: "ses_align",
  directory: "/tmp/align",
  condition: "make every loop iteration visible at a glance in the /goal surfaces",
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
  reason: "docs build still fails on the arm64 runner",
  spend: { input: 1_480_000, output: 2_100, reasoning: 0, cacheRead: 739_000, cacheWrite: 0, cost: 0.9 },
  contextSize: 512_000,
  compactAtTokens: 900_000,
  evaluating: false,
  waiting: false,
})
const achievedGoal = (): GoalSnapshot => ({ ...goal(), status: "achieved" as const })

// ---- cell math: the frame is a string of graphemes; a glyph may own more than one cell ----

interface Cell { readonly ch: string; readonly ink: boolean }
/** Walk a frame row into cells. Continuation cells of a wide grapheme carry a U+FFFF sentinel (never printed, never matched as text). */
const frameCells = (row: string): Cell[] => {
  const cells: Cell[] = []
  for (const { segment } of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(row)) {
    const w = stringWidth(segment)
    const ink = segment !== " "
    if (w <= 0) {
      if (cells.length > 0) (cells[cells.length - 1] as { ch: string }).ch += segment
      continue
    }
    for (let i = 0; i < w; i++) cells.push({ ch: i === 0 ? segment : "\uffff", ink })
  }
  return cells
}
const inkColumns = (cells: readonly Cell[]): number[] => cells.map((c, i) => (c.ink ? i : -1)).filter((i) => i >= 0)
const plainText = (cells: readonly Cell[]): string => cells.map((c) => (c.ch === "\uffff" ? "" : c.ch)).join("")
/** Cell index of the first occurrence of `needle` in the row's plain text, or -1. Wide-glyph safe (code units are not cells). */
const cellIndexOf = (cells: readonly Cell[], needle: string): number => {
  const map: number[] = []
  let acc = ""
  for (let i = 0; i < cells.length; i++) {
    const ch = cells[i]!.ch === "\uffff" ? "" : cells[i]!.ch
    for (let j = 0; j < ch.length; j++) map.push(i)
    acc += ch
  }
  const idx = acc.indexOf(needle)
  return idx === -1 ? -1 : map[idx]!
}
const labelCells = (cells: readonly Cell[]): string => plainText(cells.slice(LABEL_COL, LABEL_COL + 10)).trim()

const card = (width: number, mono: boolean, menuOpen: boolean): JSX.Element => (
  <HudCard
    goal={goal()}
    theme={theme}
    elapsedMs={() => 1000 * 60 * 42}
    nowMs={() => now}
    onClose={() => {}}
    onDetails={() => {}}
    onClear={() => {}}
    onCopyCondition={() => {}}
    onCopyReason={() => {}}
    onTogglePin={() => {}}
    pinned={false}
    width={width}
    mono={mono}
    contextOpen={menuOpen}
  />
)
const renderCard = async (width: number | undefined, mono: boolean, menuOpen = false, terminal?: number) => {
  const setup = await testRender(
    () => (width === undefined ? (
      <HudCard
        goal={goal()}
        theme={theme}
        elapsedMs={() => 1000 * 60 * 42}
        nowMs={() => now}
        onClose={() => {}}
        onDetails={() => {}}
        onClear={() => {}}
        onCopyCondition={() => {}}
        onCopyReason={() => {}}
        onTogglePin={() => {}}
        pinned={false}
        mono={mono}
      />
    ) : card(width, mono, menuOpen)),
    { width: terminal ?? width ?? 80, height: 20 },
  )
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  await setup.renderer.destroy()
  return frame
}
const paintedRows = (frame: string): Cell[][] =>
  frame
    .split("\n")
    .map(frameCells)
    .filter((cells) => inkColumns(cells).length > 0)

const expectSharedLeftGrid = (frame: string, allowBlankGutter: boolean) => {
  const expect3 = (label: string, cells: Cell[]) => {
    const ink = inkColumns(cells)
    expect(ink[0], label).toBe(BAR) // the hanging bar carries cell 0
    if (ink[1] === LABEL_COL || !allowBlankGutter) {
      expect(ink[1], `${label}: first content ink`).toBe(LABEL_COL)
      return
    }
    // Blank gutter arm (context menu continuation rows): the first ink must sit on the value column.
    expect(ink[1], `${label}: first ink outside the label column must be the value column`).toBe(VALUE_COL)
    for (let c = LABEL_COL; c < VALUE_COL; c++) expect(cells[c]!.ink, `${label}: gutter cell ${c} must stay blank`).toBe(false)
  }
  for (const [index, cells] of paintedRows(frame).entries()) expect3(`row ${index}`, cells)
}
/** The card's right content edge for a card painted at `width` cells: border 1 + paddingRight 2 off the lane end. */
const rightEdge = (width: number): number => width - 3
const expectNoBleed = (frame: string, width: number) => {
  const edge = rightEdge(width)
  for (const [index, cells] of paintedRows(frame).entries()) {
    const ink = inkColumns(cells)
    expect(ink[ink.length - 1]!, `row ${index}: last ink past the right content edge`).toBeLessThanOrEqual(edge)
  }
}
const rowWithLabel = (frame: string, label: string): Cell[] | undefined =>
  paintedRows(frame).find((cells) => labelCells(cells) === label)
const expectAffordanceEdge = (frame: string, width: number) => {
  const edge = rightEdge(width)
  // condition + why affordance cells: 8 cells flush right, the 4-cell `copy` verb painted left inside them.
  for (const label of ["condition", "why"] as const) {
    const cells = rowWithLabel(frame, label)
    expect(cells, `${label} row painted`).toBeDefined()
    expect(cellIndexOf(cells!, "copy"), `${label} affordance verb starts at the shared edge`).toBe(edge - 7)
  }
  // actions row: the flushRight esc button ends exactly on the edge.
  const actions = paintedRows(frame).find((cells) => cellIndexOf(cells, "[esc]") !== -1)
  expect(actions, "actions row painted").toBeDefined()
  expect(cellIndexOf(actions!, "[esc]") + stringWidth("[esc]") - 1, "[esc] ends on the shared edge").toBe(edge)
}

for (const width of WIDTHS) {
  describe(`/goal card alignment · ${width} columns`, () => {
    test(`every painted row hangs on the bar and snaps to the left grid (color)`, async () => {
      expectSharedLeftGrid(await renderCard(width, false), false)
    })
    test(`every painted row hangs on the bar and snaps to the left grid (mono)`, async () => {
      expectSharedLeftGrid(await renderCard(width, true), false)
    })
    test(`no painted cell bleeds past the right content edge (color)`, async () => {
      expectNoBleed(await renderCard(width, false), width)
    })
    test(`no painted cell bleeds past the right content edge (mono)`, async () => {
      expectNoBleed(await renderCard(width, true), width)
    })
    test(`the condition/why affordance cells and [esc] share one right edge (color)`, async () => {
      expectAffordanceEdge(await renderCard(width, false), width)
    })
    test(`the condition/why affordance cells and [esc] share one right edge (mono)`, async () => {
      expectAffordanceEdge(await renderCard(width, true), width)
    })
    test(`with the menu open, every menu row keeps the LABEL/value grid (color)`, async () => {
      expectSharedLeftGrid(await renderCard(width, false, true), true)
    })
    test(`with the menu open, every menu row keeps the LABEL/value grid (mono)`, async () => {
      expectSharedLeftGrid(await renderCard(width, true, true), true)
    })
  })

  describe(`/goal pill alignment · ${width} columns`, () => {
    const pillAt = async (mono: boolean, terminal: boolean) => {
      const ascii = mono
      const g = goal()
      const line = terminal
        ? terminalPill(achievedGoal(), 1000 * 60 * 42, ascii, width - 2)!.text
        : pillModel(g, 1000 * 60 * 42, ascii, width - 2, 2).text
      const setup = await testRender(
        () => (
          <box position="absolute" top={0} left={0} height={1} paddingLeft={1} flexDirection="row" width={width}>
            <text fg={theme.text.muted} wrapMode="none">{line}</text>
          </box>
        ),
        { width, height: 1 },
      )
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      await setup.renderer.destroy()
      return { frame, line }
    }
    const expectPillFits = (label: string, mono: boolean, terminal: boolean) => async () => {
      const { frame, line } = await pillAt(mono, terminal)
      expect(stringWidth(line), `${label} model stays inside its budget`).toBeLessThanOrEqual(width - 2)
      const cells = frameCells(frame.split("\n")[0]!)
      const ink = inkColumns(cells)
      expect(cells[0]!.ink, `${label} leaves the mount's left margin cell blank`).toBe(false)
      expect(ink[0], `${label} paints its first cell at the padding column`).toBe(1)
      expect(ink[ink.length - 1]!, `${label} never paints past its right margin`).toBeLessThanOrEqual(width - 2)
    }
    test(`the working pill paints inside its mount budget (color)`, expectPillFits("working pill", false, false))
    test(`the working pill paints inside its mount budget (mono)`, expectPillFits("working pill", true, false))
    test(`the terminal acknowledgment pill paints inside the same budget (color)`, expectPillFits("terminal pill", false, true))
    test(`the terminal acknowledgment pill paints inside the same budget (mono)`, expectPillFits("terminal pill", true, true))
  })
}

describe("/goal card alignment · terminal-resolved width (cardWidth path)", () => {
  // No `width` prop: the card resolves cardWidth(112) = 88 inside a 112-cell frame, which is what
  // the render-card arms and any mount without a measured width rely on.
  const DEFAULT_CARD = 88
  test(`a 112-column terminal resolves to the 88-cell card and keeps every invariant (color)`, async () => {
    const frame = await renderCard(undefined, false, false, 112)
    expect(stringWidth(frame.split("\n")[0]!), "the frame stays 112 cells").toBe(112)
    expectSharedLeftGrid(frame, false)
    expectNoBleed(frame, DEFAULT_CARD)
    for (const [index, cells] of paintedRows(frame).entries()) {
      const ink = inkColumns(cells)
      expect(ink[ink.length - 1]!, `row ${index}: nothing inks past the resolved 88-cell card`).toBeLessThan(DEFAULT_CARD)
    }
  })
  test(`a 112-column terminal under mono keeps every invariant`, async () => {
    const frame = await renderCard(undefined, true, false, 112)
    expectSharedLeftGrid(frame, false)
    expectNoBleed(frame, DEFAULT_CARD)
  })
})
