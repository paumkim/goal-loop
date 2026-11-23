/**
 * The one `--width=<n>` reader for the standalone render scripts.
 *
 * `render-slot.tsx` and `render-pill.tsx` used to carry byte-identical copies of this parse-and-clamp
 * rule; only the fallback default differed. Keeping it here (scripts/ is not in the published
 * `files` list) prevents the two from drifting. Missing, empty, malformed,
 * zero and negative flags all fall back to `dflt`; a positive finite value is floored, matching the
 * original arithmetic exactly. The first flag wins when several are supplied.
 */
export const widthFlag = (args: readonly string[], dflt: number): number => {
  const flag = args.find((a) => a.startsWith("--width="))
  const parsed = flag ? Number(flag.slice("--width=".length)) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : dflt
}
