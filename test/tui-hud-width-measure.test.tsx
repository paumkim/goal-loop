/**
 * The HUD card's mount-width probe (2026-11-17): the card mounts inside the opencode v2 composer,
 * which sits beside the sidebar — not at the terminal's full width. The fix in src/tui.tsx measures
 * the outer absolute box (left=0 right=0) instead of useTerminalDimensions(). This suite pins the
 * opentui behavior that fix relies on — so an opentui upgrade that breaks it fails here rather than
 * silently zeroing the card in the host — and the wiring that consumes it: the probe branch of
 * `src/tui.tsx`, the reset on disarm, the mount-width anchor, and the card's own width prop.
 * Requires the solid preload (test/bunfig.toml) for the render test; the wiring test is pure source scan.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/solid"

const PARENT = 100

describe("an absolute left=0 right=0 box (the card's mount-width probe)", () => {
  test("resolves to the parent's width and reports it through onSizeChange after the first layout — never at ref time", async () => {
    const widths: number[] = []
    const refWidths: number[] = []
    const setup = await testRender(
      () => (
        <box width={PARENT} height={5} flexDirection="column">
          <box
            position="absolute"
            top={0}
            left={0}
            right={0}
            height={1}
            ref={(el: any) => {
              refWidths.push(el.width)
              el.onSizeChange = () => {
                if (el.width > 0) widths.push(el.width)
              }
            }}
          >
            <text>x</text>
          </box>
        </box>
      ),
      { width: PARENT + 30, height: 10 },
    )
    await setup.renderOnce()
    // The mount probe fires on the first layout, not at ref time (ref sees width 0) —
    // this is exactly why the card waits for the probe instead of painting at the terminal width.
    expect(refWidths).toEqual([0])
    // onSizeChange keeps reporting after the layout pass rather than only at creation —
    // a sidebar toggle or terminal resize re-snaps the width the same way.
    expect(widths).toEqual([PARENT])
    expect(setup.captureCharFrame()).toContain("x")
    await setup.renderer.destroy()
  })
})

describe("the src/tui.tsx wiring that consumes the probe (source contract)", () => {
  const tui = readFileSync(join(import.meta.dir, "../src/tui.tsx"), "utf8")

  test("the probe box snapshots its own width and re-snaps on every layout pass", () => {
    // left=0 right=0 probe with a ref that (a) assigns onSizeChange, (b) snapshots at creation.
    expect(tui).toContain("el.onSizeChange = () =>")
    expect(tui).toContain("setMountWidth(w)")
    expect(tui).toContain("right={0}")
  })

  test("the disarm path resets the measured width so re-arming waits for a fresh measure", () => {
    expect(tui).toMatch(/createEffect\(\(\) => \{\s*\n\s*if \(!cardFor\(\)\) setMountWidth\(undefined\)/)
  })

  test("the card and its anchor consume the measured mount width, never the full terminal width", () => {
    // The row plan anchor and the painted card both read mountWidthOr() (mount width with
    // terminal width as the fallback), not dimensions().width directly.
    expect(tui).toContain("hudCardRows(g, contextOpen(), maxCardRows(), mountWidthOr())")
    expect(tui).toContain("width={mountWidthOr()}")
    expect(tui).toContain("const mountWidthOr = () => mountWidth() ?? dimensions().width")
    // The width-dependent <Show> gate must sit INSIDE the probe box, never around it —
    // gating the probe behind the width it produces deadlocks the card (Workstream EO).
    expect(tui).toContain("when={mountWidth() !== undefined}")
  })
})
