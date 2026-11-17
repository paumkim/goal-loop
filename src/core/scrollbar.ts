/**
 * Pure chrome decision behind the status dialog's scrollbar: one place that decides the
 * track and thumb tones opentui's ScrollBarRenderable paints with, from the host theme and
 * the reduced-color flag. No I/O, no JSX, no event wiring; unit-tested in `test/scrollbar.test.tsx`.
 *
 * Why this exists as a module instead of inline JSX at the scrollbox site: the scrollbox in
 * `tui.tsx` is host-owned, the scrollbar it ships is a real GUI surface (drag the thumb,
 * click the track to page, wheel as before), and an unthemed Slider paints hardcoded hex
 * grays that ignore light themes, mono arms, and NO_COLOR. Every color the bar paints is
 * decided here, once, so the mechanism layer stays a thin pass-through.
 *
 * Honesty rules, same as the rest of the plugin:
 * - The thumb is the only meaning-bearing cell the bar paints. It maps to a single theme
 *   token per arm (muted in color, base in mono), so hue never encodes anything and the
 *   mono arm reaches for the brightest tone the palette has instead of a "grayer gray".
 * - The track is invisible by design: it paints the theme background, an overlay grammar
 *   (macOS-style) where the bar recedes until it is needed. When the content fits, the bar
 *   itself hides (opentui's recalculateVisibility); when it overflows, only the thumb shows.
 * - No arrow chrome is passed here — the host scrollbox decides `showArrows`; this module
 *   answers only the two-color question.
 */
import type { NeutralTheme } from "./hud.ts"

/** The two cells the bar needs: track (receding, invisible) and thumb (the meaning-bearing cell). */
export interface ScrollbarChrome<C> {
  readonly backgroundColor: C
  readonly foregroundColor: C
}

/** Minimal theme shape the bar needs: the NeutralTheme palette plus the host background token. */
export type ScrollbarTheme<C> = NeutralTheme<C> & { readonly background: C }

/**
 * Track and thumb tones for the dialog's overlay scrollbar.
 *
 * Color arm: thumb `text.muted` — quiet chrome that still reads on any host background,
 * never a hue. Mono / NO_COLOR arm: thumb `text.base` — the brightest gray the palette has,
 * because hue-dropping must not also mean contrast-dropping. Track is `background` in both
 * arms (the invisible-track overlay), so the two arms differ only in thumb tone.
 */
export const scrollbarChrome = <C>(theme: ScrollbarTheme<C>, mono: boolean): ScrollbarChrome<C> => ({
  backgroundColor: theme.background,
  foregroundColor: mono ? theme.text.base : theme.text.muted,
})

/**
 * The tones to hand the host scrollbox as `trackOptions`, read from the host theme's REAL shape: a
 * nested palette (`background.raised.high`), never a flat color. An earlier wiring passed the whole
 * `background` palette object as `backgroundColor`; the host's scrollbar-options clone crashed on it
 * at dialog open ("TypeError: undefined is not an object (evaluating 'e.length')" out of the options
 * assignment path, reproduced live 2026-11-17). The raised token is the same surface the HUD card
 * paints, so the track recedes into the dialog chrome. A host that exposes no raised token gets the
 * thumb only — never a non-color handed to the host.
 */
export interface HostScrollbarTheme<C> {
  readonly text: { readonly base: C; readonly muted: C }
  readonly background?: { readonly raised?: { readonly high?: C } }
}

export type ScrollbarTrackOptions<C> = { readonly foregroundColor: C; readonly backgroundColor?: C }

export const scrollbarTrackOptions = <C>(
  theme: HostScrollbarTheme<C>,
  mono: boolean,
): ScrollbarTrackOptions<C> => {
  const raised = theme.background?.raised?.high
  const thumb = mono ? theme.text.base : theme.text.muted
  return raised === undefined ? { foregroundColor: thumb } : { backgroundColor: raised, foregroundColor: thumb }
}
