/**
 * The HUD card's mount-width probe (2026-11-17): the card mounts inside the opencode v2 composer,
 * which sits beside the sidebar — not at the terminal's full width. The fix in src/tui.tsx measures
 * the outer absolute box (left=0 right=0) instead of useTerminalDimensions(). This suite pins the
 * opentui behavior that fix relies on, so an opentui upgrade that breaks it fails here rather than
 * silently zeroing the card in the host. Requires the solid preload (test/bunfig.toml).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"

const PARENT = 100

describe("an absolute left=0 right=0 box (the card's mount-width probe)", () => {
  test("resolves to the parent's width and reports it through onSizeChange", async () => {
    const widths: number[] = []
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
    expect(widths).toEqual([PARENT])
    await setup.renderer.destroy()
  })

  test("onSizeChange keeps reporting after a layout pass rather than only at creation", async () => {
    const widths: number[] = []
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
    expect(widths).toEqual([PARENT])
    expect(setup.captureCharFrame()).toContain("x")
    await setup.renderer.destroy()
  })
})
