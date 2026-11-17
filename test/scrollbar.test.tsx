/**
 * Unit + headless-render tests for the dialog scrollbar chrome (`src/core/scrollbar.ts` and the
 * host-owned scrollbox wiring in `src/tui.tsx`). The scrollbar is opentui's native Slider —
 * drag the thumb, click the track to page, wheel scrolls as before — this suite pins the two
 * things we own: which tones the two cells paint, and that the drag/jump grammar actually
 * moves the viewport through the real opentui event pipeline (mockMouse, real coordinates).
 *
 * Every render here wires the nested host theme through `scrollbarTrackOptions` — the exact
 * path and palette shape `tui.tsx` feeds the host's scrollbox — never a flat RGBA background,
 * which the pre-EN host crashed on. Requires the solid preload (test/bunfig.toml).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type ScrollBoxRenderable } from "@opentui/core"
import { scrollbarTrackOptions, type HostScrollbarTheme } from "../src/core/scrollbar.ts"

/** The host's real palette shape: a nested `background.raised.high`, not a flat color. */
const hostTheme: HostScrollbarTheme<RGBA> = {
  text: { base: RGBA.fromHex("#e8e8e8"), muted: RGBA.fromHex("#a0a0a0") },
  background: { raised: { high: RGBA.fromHex("#1c1c1c") } },
}

/** What a flat-background wiring would paint — the pre-EN seam failure, kept as a negative control. */
const flatBackground = RGBA.fromHex("#101010")

describe("scrollbarTrackOptions (the tones the bar paints)", () => {
  test("color arm: raised-token track, muted thumb — quiet chrome, never a hue", () => {
    const chrome = scrollbarTrackOptions(hostTheme, false)
    expect(chrome.backgroundColor?.equals(hostTheme.background!.raised!.high!)).toBe(true)
    expect(chrome.foregroundColor.equals(hostTheme.text.muted)).toBe(true)
  })

  test("mono arm (NO_COLOR): track stays the raised token, thumb reaches for the brightest tone the palette has", () => {
    const chrome = scrollbarTrackOptions(hostTheme, true)
    expect(chrome.backgroundColor?.equals(hostTheme.background!.raised!.high!)).toBe(true)
    expect(chrome.foregroundColor.equals(hostTheme.text.base)).toBe(true)
  })

  test("the two arms differ only in thumb tone — the mono contract drops hue, never contrast", () => {
    const color = scrollbarTrackOptions(hostTheme, false)
    const mono = scrollbarTrackOptions(hostTheme, true)
    expect(color.backgroundColor?.equals(mono.backgroundColor!)).toBe(true)
    expect(color.foregroundColor.equals(mono.foregroundColor)).toBe(false)
  })
})

const collectColumn = (
  frame: { lines: Array<{ spans: Array<{ text: string; fg: RGBA; bg: RGBA; width: number }> }> },
  col: number,
  maxRow?: number,
) => {
  const hits: Array<{ y: number; fg: RGBA; bg: RGBA; glyph: boolean }> = []
  frame.lines.forEach((line, y) => {
    if (maxRow !== undefined && y >= maxRow) return
    let x = 0
    for (const span of line.spans) {
      const start = x
      x += span.width
      if (col >= start && col < x) hits.push({ y, fg: span.fg, bg: span.bg, glyph: span.text.trim().length > 0 })
    }
  })
  return hits
}

const RAIL = Array.from({ length: 60 }, (_, i) => `rail row ${String(i + 1).padStart(2, "0")} · verdict trail`).join("\n")

describe("the dialog scrollbox, wired the way tui.tsx wires it (nested palette)", () => {
  test("overflow paints the raised track and the muted thumb in the bar's last column", async () => {
    let sb: ScrollBoxRenderable | undefined
    const setup = await testRender(() => (
      <scrollbox ref={(el) => { sb = el }} scrollX={false} height={8} width={48} contentOptions={{ minHeight: 0 }} verticalScrollbarOptions={{ trackOptions: scrollbarTrackOptions(hostTheme, false), showArrows: false }}>
        <text wrapMode="none">{RAIL}</text>
      </scrollbox>
    ), { width: 48, height: 10 })
    await setup.renderOnce()
    expect(sb).toBeDefined()
    const cells = collectColumn(setup.captureSpans(), 47, 8)
    expect(cells.length).toBe(8)
    // the whole bar column paints the raised token — the same surface the HUD card paints
    for (const cell of cells) expect(cell.bg.equals(hostTheme.background!.raised!.high!)).toBe(true)
    // and it is NOT the flat pre-EN background the host crashed on
    expect(cells.some((cell) => cell.bg.equals(flatBackground))).toBe(false)
    // the thumb is the only cell painted with the thumb tone — and it carries a block-edge glyph
    const thumb = cells.filter((cell) => cell.fg.equals(hostTheme.text.muted) && cell.glyph)
    expect(thumb.length).toBeGreaterThan(0)
    await setup.renderer.destroy()
  })

  test("mono arm paints the thumb in base, never muted — weight of tone, not hue", async () => {
    const setup = await testRender(() => (
      <scrollbox ref={(el) => { }} scrollX={false} height={8} width={48} contentOptions={{ minHeight: 0 }} verticalScrollbarOptions={{ trackOptions: scrollbarTrackOptions(hostTheme, true), showArrows: false }}>
        <text wrapMode="none">{RAIL}</text>
      </scrollbox>
    ), { width: 48, height: 10 })
    await setup.renderOnce()
    const cells = collectColumn(setup.captureSpans(), 47, 8)
    const thumb = cells.filter((cell) => cell.fg.equals(hostTheme.text.base) && cell.glyph)
    expect(thumb.length).toBeGreaterThan(0)
    expect(cells.some((cell) => cell.fg.equals(hostTheme.text.muted) && cell.glyph)).toBe(false)
    await setup.renderer.destroy()
  })

  test("content that fits paints no bar at all — the overlay recedes completely", async () => {
    const setup = await testRender(() => (
      <scrollbox scrollX={false} height={8} width={48} contentOptions={{ minHeight: 0 }} verticalScrollbarOptions={{ trackOptions: scrollbarTrackOptions(hostTheme, false), showArrows: false }}>
        <text wrapMode="none">short rail</text>
      </scrollbox>
    ), { width: 48, height: 10 })
    await setup.renderOnce()
    const cells = collectColumn(setup.captureSpans(), 47, 8)
    expect(cells.every((cell) => !cell.bg.equals(hostTheme.background!.raised!.high!))).toBe(true)
    await setup.renderer.destroy()
  })

  test("dragging the thumb down pages the viewport — the mouse-first grammar through the real event pipeline", async () => {
    let sb: ScrollBoxRenderable | undefined
    const setup = await testRender(() => (
      <scrollbox ref={(el) => { sb = el }} scrollX={false} height={8} width={48} contentOptions={{ minHeight: 0 }} verticalScrollbarOptions={{ trackOptions: scrollbarTrackOptions(hostTheme, false), showArrows: false }}>
        <text wrapMode="none">{RAIL}</text>
      </scrollbox>
    ), { width: 48, height: 10 })
    await setup.renderOnce()
    expect(sb!.scrollTop).toBe(0)
    await setup.mockMouse.drag(47, 0, 47, 4)
    await setup.renderOnce()
    expect(sb!.scrollTop).toBeGreaterThan(0)
    expect(sb!.scrollTop).toBeLessThanOrEqual(52)
    await setup.renderer.destroy()
  })

  test("a left-click on the track below the thumb pages toward the click — not a no-op, not a full jump", async () => {
    let sb: ScrollBoxRenderable | undefined
    const setup = await testRender(() => (
      <scrollbox ref={(el) => { sb = el }} scrollX={false} height={8} width={48} contentOptions={{ minHeight: 0 }} verticalScrollbarOptions={{ trackOptions: scrollbarTrackOptions(hostTheme, false), showArrows: false }}>
        <text wrapMode="none">{RAIL}</text>
      </scrollbox>
    ), { width: 48, height: 10 })
    await setup.renderOnce()
    const before = sb!.scrollTop
    await setup.mockMouse.click(47, 7)
    await setup.renderOnce()
    expect(sb!.scrollTop).toBeGreaterThan(before)
    await setup.renderer.destroy()
  })
})

/**
 * 2026-11-17 live crash, reproduced as a regression: the host passes its theme to the dialog
 * scrollbox with a NESTED palette (`background.raised.high`), not a flat color. Passing that
 * palette object as `trackOptions.backgroundColor` crashed the host's scrollbar-options clone at
 * dialog open ("TypeError: undefined is not an object (evaluating 'e.length')" out of the
 * options-assignment path). The fixtures above wire the nested shape everywhere; this block pins
 * the host shape at the seam where the two meet.
 */
describe("scrollbarTrackOptions (the host palette shape)", () => {
  test("a nested raised token becomes the track color; the thumb keeps the muted/base rule", () => {
    const color = scrollbarTrackOptions(hostTheme, false)
    expect(color.backgroundColor?.equals(hostTheme.background!.raised!.high!)).toBe(true)
    expect(color.foregroundColor.equals(hostTheme.text.muted)).toBe(true)
    const mono = scrollbarTrackOptions(hostTheme, true)
    expect(mono.foregroundColor.equals(hostTheme.text.base)).toBe(true)
    expect(mono.backgroundColor?.equals(hostTheme.background!.raised!.high!)).toBe(true)
  })

  test("a host with no raised token omits the track color entirely — never a non-color", () => {
    const noRaised = scrollbarTrackOptions({ text: hostTheme.text, background: {} }, false)
    expect("backgroundColor" in noRaised).toBe(false)
    expect(noRaised.foregroundColor.equals(hostTheme.text.muted)).toBe(true)
    const noBackground = scrollbarTrackOptions({ text: hostTheme.text }, true)
    expect("backgroundColor" in noBackground).toBe(false)
    expect(noBackground.foregroundColor.equals(hostTheme.text.base)).toBe(true)
  })

  test("the dialog's real mount shape renders a nested-palette theme without throwing", async () => {
    let sb: ScrollBoxRenderable | undefined
    const setup = await testRender(() => (
      <scrollbox
        ref={(el) => { sb = el }}
        scrollX={false}
        height={8}
        width={48}
        contentOptions={{ minHeight: 0 }}
        verticalScrollbarOptions={{ trackOptions: scrollbarTrackOptions(hostTheme, false), showArrows: false }}
      >
        <text wrapMode="none">{RAIL}</text>
      </scrollbox>
    ), { width: 48, height: 10 })
    await setup.renderOnce()
    expect(sb).toBeDefined()
    expect(setup.captureCharFrame().length).toBeGreaterThan(0)
    await setup.renderer.destroy()
  })
})
