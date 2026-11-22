#!/usr/bin/env bun
/**
 * The one positive-finite-number argument check for the standalone render scripts.
 *
 * Both `render-dialog.tsx` and `render-history.tsx` used to carry a byte-for-byte copy of this
 * rule (parse, reject non-finite/non-positive, log, exit 2, else return the number). Keeping it in a
 * single place prevents the two copies from drifting. The caller owns argument extraction (flag
 * lookup vs. positional) and supplies `label` verbatim so each script's pinned error text is
 * unchanged; the value is rendered with `formatValue`, the same convention error messages use.
 */
import { formatValue } from "../src/core/errors.ts"

/**
 * Validate a script argument that must parse to a positive finite number.
 *
 * `value === undefined` means "argument absent", so `dflt` applies. Any other input must parse to a
 * finite number greater than zero; on rejection the exact `label` is logged and the process exits 2.
 */
export function positiveFinite(value: string | undefined, dflt: number, label: string): number {
  if (value === undefined) return dflt
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${label} must be a positive finite number (got ${formatValue(value)})`)
    process.exit(2)
  }
  return n
}
