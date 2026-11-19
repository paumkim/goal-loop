/**
 * The always-mounted click-affordance cell — the hover-stability grammar shared by the three
 * zoom levels (ambient surfaces paint their own copies of these semantics through this module):
 * the cell never mounts, unmounts or changes width; hover only brightens it (weight under mono).
 * The row's text never changes attributes on hover, so nothing rewraps, nothing reflows, nothing
 * flickers. Width 8 fits the widest in-cell payload (`✓ copied` / `+ copied` / `✓ saved`); the
 * verb sits left, padding stays empty. Wider verbs pass their own width.
 */
import { TextAttributes, type ColorInput } from "@opentui/core"
import type { JSX } from "@opentui/solid"

/** Structural subset of the host theme the affordance cell needs; anything ColorInput-typed fits (RGBA or hex string). */
export interface AffordanceTheme {
  readonly text: {
    readonly base: ColorInput
    readonly faint: ColorInput
  }
}

export const Affordance = (props: { theme: AffordanceTheme; mono: () => boolean; verb: string; hovered: boolean; ack?: string | null; width?: number }): JSX.Element => {
  const ack = () => props.ack ?? null
  const lit = () => props.hovered || ack() !== null
  return (
    <text
      wrapMode="none"
      flexShrink={0}
      width={props.width ?? 8}
      fg={lit() ? props.theme.text.base : props.theme.text.faint}
      attributes={props.mono() && props.hovered && ack() === null ? TextAttributes.BOLD : undefined}
    >
      {ack() ?? props.verb}
    </text>
  )
}
