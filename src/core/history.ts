/**
 * Pure helpers behind the goal-history rendering in the TUI detail dialog (`src/tui-history.tsx`).
 * No I/O, no JSX, no theme — everything here is unit-tested in `test/history.test.ts`.
 */
import type { LoopEntry, VerdictEntry } from "./types.ts"

export const BAR_CELLS = 18

/** Block bar for the loop progress: filled cells as `filled`, the rest empty. Never divides by zero; clamps to [0, BAR_CELLS]. */
export function renderBar(done: number, max: number | undefined, cells: number = BAR_CELLS): { filled: number; text: string } {
  const width = Math.max(1, Math.floor(cells))
  const safeMax = typeof max === "number" && Number.isFinite(max) && max > 0 ? max : 0
  const safeDone = Number.isFinite(done) ? Math.max(0, done) : 0
  const filled = safeMax === 0 ? 0 : Math.min(width, Math.max(0, Math.round((safeDone / safeMax) * width)))
  return { filled, text: "█".repeat(filled) + "░".repeat(width - filled) }
}

/** Caption under/near the bar, e.g. `v3 of at most 5 · 2 complete`. */
export function barCaption(current: number, max: number | undefined, done: number): string {
  const safeDone = Number.isFinite(done) ? Math.max(0, done) : 0
  const v = Number.isFinite(current) && current >= 1 ? Math.floor(current) : 1
  return typeof max === "number" && Number.isFinite(max) && max > 0
    ? `v${v} of at most ${Math.floor(max)} · ${safeDone} complete`
    : `v${v} · ${safeDone} complete`
}

export function verdictGlyph(verdict: VerdictEntry["verdict"]): string {
  switch (verdict) {
    case "met":
      return "✓"
    case "impossible":
      return "⊘"
    default:
      return "✗"
  }
}

/** Per-iteration durations in ms; v1 anchors at the record's setAt, vN at the previous entry's endedAt. Negative spans clamp to 0. */
export function iterationDurations(entries: readonly LoopEntry[], setAt: number): number[] {
  const out: number[] = []
  let previous = setAt
  for (const entry of entries) {
    const span = Number.isFinite(entry.endedAt) ? entry.endedAt - previous : 0
    out.push(Math.max(0, span))
    previous = Number.isFinite(entry.endedAt) ? entry.endedAt : previous
  }
  return out
}

/**
 * The verdict trail to render: at most `limit` newest verdicts, oldest first.
 * `total` is the full history length so the caption can say `<shown> of <total> verdicts`.
 */
export function trailWindow(history: readonly VerdictEntry[], limit = 24): { shown: readonly VerdictEntry[]; total: number } {
  const total = history.length
  const shown = limit >= total ? history : history.slice(total - limit)
  return { shown, total }
}

export interface VerdictCounts {
  readonly met: number
  readonly not_met: number
  readonly impossible: number
  readonly total: number
}

/** Per-verdict tallies over the evaluated turns (oldest first input). */
export function verdictCounts(history: readonly VerdictEntry[]): VerdictCounts {
  let met = 0
  let not_met = 0
  let impossible = 0
  for (const entry of history) {
    if (entry.verdict === "met") met += 1
    else if (entry.verdict === "impossible") impossible += 1
    else not_met += 1
  }
  return { met, not_met, impossible, total: history.length }
}

/** The most recent verdict, or undefined when nothing has been evaluated yet. */
export function lastVerdict(history: readonly VerdictEntry[]): VerdictEntry | undefined {
  return history.length === 0 ? undefined : history[history.length - 1]
}

/**
 * Iteration pips for the prompt-footer loop indicator: `●` per completed iteration, `○` for the
 * remaining cap. Rendered only for small, known caps (1–8) so the footer stays compact; empty otherwise.
 */
export function renderPips(done: number, max: number | undefined): string {
  if (typeof max !== "number" || !Number.isFinite(max)) return ""
  const cap = Math.floor(max)
  if (cap < 1 || cap > 8) return ""
  const filled = Math.min(Math.max(0, Math.floor(Number.isFinite(done) ? done : 0)), cap)
  return "●".repeat(filled) + "○".repeat(cap - filled)
}

/** Mean per-iteration duration (ms) and estimated remaining wall time (ms) at that pace. Undefined when no iteration has completed or the cap is unknown/exhausted. */
export function paceEstimate(durations: readonly number[], max: number | undefined): { perIteration: number; remaining: number } | undefined {
  if (durations.length === 0) return undefined
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) return undefined
  const left = Math.floor(max) - durations.length
  if (left <= 0) return undefined
  const perIteration = durations.reduce((sum, span) => sum + span, 0) / durations.length
  return { perIteration, remaining: perIteration * left }
}

/**
 * Per-iteration verdict mix: assigns each verdict to the iteration whose `(from, to]` window contains
 * its timestamp. The first window opens at `setAt`, later windows at the previous entry's `endedAt`.
 * Zero-verdict iterations yield `undefined`.
 */
export function iterationVerdictMix(history: readonly VerdictEntry[], entries: readonly LoopEntry[], setAt: number): Array<VerdictCounts | undefined> {
  const out: Array<VerdictCounts | undefined> = []
  let start = setAt
  for (const entry of entries) {
    const end = entry.endedAt
    const slice = history.filter((verdict) => verdict.at > start && verdict.at <= end)
    out.push(slice.length === 0 ? undefined : verdictCounts(slice))
    start = end
  }
  return out
}

/** Consecutive identical verdicts at the tail of the history. `count` is 0 when the history is empty. */
export function verdictStreak(history: readonly VerdictEntry[]): { verdict: VerdictEntry["verdict"] | undefined; count: number } {
  const last = history[history.length - 1]
  if (!last) return { verdict: undefined, count: 0 }
  let count = 1
  for (let index = history.length - 2; index >= 0; index -= 1) {
    if (history[index]?.verdict !== last.verdict) break
    count += 1
  }
  return { verdict: last.verdict, count }
}
