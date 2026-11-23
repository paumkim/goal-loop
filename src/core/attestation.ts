/**
 * The loop's bookkeeping, quotable verbatim — one left click, wherever the tallies are painted.
 *
 * Why this module: the rail's iteration row and the final tally row answer "what did this loop
 * actually do" with numbers, but those numbers were "ink to stare at", not quotable payload —
 * catching them for an issue, a handoff, or a review meant transcribing them by hand, drift and
 * all. The attestation line is the iteration's receipt (`v3 · met · 9 turns · 41 tools · … · sha
 * · cost`), the final tally line is the loop's (`loop achieved · 5 iterations · … wall · $12.34`).
 * Both are built here, from the same inputs the rows paint from, so the copy can never quote
 * numbers the paint disagrees with — the "quoted once" contract the dossier established (DT).
 *
 * Honesty rules, same as the rest of the plugin: the sha is sliced to the seven leading cells
 * the rows paint, never guessed — an absent sha is omitted, not fabricated; the cost is printed
 * only when it measures above zero (the spend suffix grammar); an iteration whose wall duration
 * is not finite or not positive is omitted, never a `0s` that lies about being measured; zero
 * tools keeps its `already satisfied at HEAD` tag so the quote explains itself without the rail;
 * partial spend measurement is never presented as a complete total (the `across n/m measured`
 * fraction rides the tally exactly as it rides the painted row).
 */
import type { LoopEntry } from "./types.ts"
import { formatCost, formatDuration, formatDurationCoarse, nonNegative } from "./format.ts"

/** The numbers the final tally paints — the `loopTotals` shape from history.ts, restated so this module does not import the renderer's world. `spend.measured` is the count of iterations whose usage delta was measurable; the tally never claims a complete total from a partial measurement. */
interface AttestationTotals {
  readonly iterations: number
  readonly turns: number
  readonly tools: number
  readonly spanMs: number
  readonly spend?: { readonly total: number; readonly measured: number }
}

/** Sha as a pasteable quote: the leading seven cells the rail paints, from the record's own stamp. Absent or blank is `undefined` — never guessed. */
export const quoteSha = (sha: string | undefined): string | undefined => {
  if (typeof sha !== "string") return undefined
  const trimmed = sha.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 7) : undefined
}

/**
 * The iteration attestation: `v3 · met · 9 turns · 41 tools · 27m 05s · already satisfied at HEAD · a1b2c3d` —
 * each measurement the rail paints, in paint order, minus the live-row furniture. The zero-tool tag
 * rides even a clipboard-only quote because "0 tools" is exactly the claim a reader must not misread.
 * Singular forms hold at one (`1 turn`, `1 tool`); a non-finite or zero duration is omitted, never `0s`.
 */
export function iterationAttestation(entry: LoopEntry, durationMs: number): string {
  const turns = nonNegative(entry.turns)
  const tools = nonNegative(entry.toolCalls)
  const parts = [`v${entry.version} · met`, `${turns} turn${turns === 1 ? "" : "s"}`, `${tools} tool${tools === 1 ? "" : "s"}`]
  if (Number.isFinite(durationMs) && durationMs > 0) parts.push(formatDuration(durationMs))
  if (tools === 0) parts.push("already satisfied at HEAD")
  const sha = quoteSha(entry.sha)
  if (sha) parts.push(sha)
  const cost = entry.spend?.cost
  if (cost !== undefined && Number.isFinite(cost) && cost > 0) parts.push(formatCost(cost))
  return parts.join(" · ")
}

/**
 * The final tally line: `loop achieved · 5 iterations · 84 turns · 301 tools · 47h00m wall · $12.34`.
 * Exactly the string the ledger paints once the loop is over — the status word, the same units,
 * the same partial-measurement honesty (`$12.34 across 3/5 measured`). Non-finite or negative inputs
 * clamp to zero rather than paint a negative wall or a fractional iteration count.
 */
export function finalTallyLine(status: string, totals: AttestationTotals): string {
  const iterations = nonNegative(totals.iterations)
  const turns = nonNegative(totals.turns)
  const tools = nonNegative(totals.tools)
  let line = `loop ${status} · ${iterations} iteration${iterations === 1 ? "" : "s"} · ${turns} turns · ${tools} tools · ${formatDurationCoarse(nonNegative(totals.spanMs))} wall`
  if (totals.spend) {
    line +=
      totals.spend.measured === iterations
        ? ` · ${formatCost(totals.spend.total)}`
        : ` · ${formatCost(totals.spend.total)} across ${totals.spend.measured}/${iterations} measured`
  }
  return line
}
