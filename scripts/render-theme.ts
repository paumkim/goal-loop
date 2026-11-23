/**
 * Shared color palette for the headless render scripts. The five render fixtures paint the same
 * terminal theme but used to repeat every hex literal, so a color change had to be made five times
 * (and could drift silently). One copy here keeps the snapshots honest. Not shipped (`scripts/` is
 * not in package.json `files`).
 */
import { RGBA } from "@opentui/core"

export const PALETTE = {
  base: RGBA.fromHex("#e8e8e8"),
  muted: RGBA.fromHex("#a0a0a0"),
  faint: RGBA.fromHex("#6f6f6f"),
  info: RGBA.fromHex("#6cb6ff"),
  warning: RGBA.fromHex("#e0af3c"),
  error: RGBA.fromHex("#ff6c6c"),
  success: RGBA.fromHex("#7ee787"),
  border: RGBA.fromHex("#3f3f3f"),
  raised: RGBA.fromHex("#161616"),
} as const
