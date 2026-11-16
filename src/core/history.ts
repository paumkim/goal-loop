/**
 * Pure helpers behind the goal-history rendering in the TUI detail dialog (`src/tui-history.tsx`).
 * No I/O, no JSX, no theme — everything here is unit-tested in `test/history.test.ts`.
 */
import type { LoopEntry, VerdictEntry } from "./types.ts"

export const BAR_CELLS = 18

/** Width of the label column in the goal surfaces (detail dialog rows, history rail). */
export const LABEL = 10

/** Unicode bar pair — the default everywhere UTF-8 renders. */
export const BAR_FILLED = "█"
export const BAR_EMPTY = "░"
/** ASCII bar pair — selected under NO_COLOR / TERM=dumb (the same predicate as reduced motion), where eighth-block glyphs are not guaranteed to exist. */
export const BAR_FILLED_ASCII = "#"
export const BAR_EMPTY_ASCII = "-"

/** Block bar for the loop progress: filled cells as `filled`, the rest empty. Never divides by zero; clamps to [0, BAR_CELLS]. `ascii` swaps the pair for the same swap the sparkline does. */
export function renderBar(done: number, max: number | undefined, cells: number = BAR_CELLS, ascii: boolean = false): { filled: number; text: string } {
  const width = Math.max(1, Math.floor(cells))
  const safeMax = typeof max === "number" && Number.isFinite(max) && max > 0 ? max : 0
  const safeDone = Number.isFinite(done) ? Math.max(0, done) : 0
  const filled = safeMax === 0 ? 0 : Math.min(width, Math.max(0, Math.round((safeDone / safeMax) * width)))
  const filledGlyph = ascii ? BAR_FILLED_ASCII : BAR_FILLED
  const emptyGlyph = ascii ? BAR_EMPTY_ASCII : BAR_EMPTY
  return { filled, text: filledGlyph.repeat(filled) + emptyGlyph.repeat(width - filled) }
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

interface VerdictCounts {
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

/** Unicode pip pair — the default everywhere UTF-8 renders. */
export const PIP_FILLED = "●"
export const PIP_EMPTY = "○"
/** ASCII pip pair — selected under NO_COLOR / TERM=dumb, where the bullet glyphs are not guaranteed to exist. Matches the bar demotion pair so the two read as one family. */
export const PIP_FILLED_ASCII = "#"
export const PIP_EMPTY_ASCII = "-"

/**
 * Iteration pips for the prompt-footer loop indicator: one pip per completed iteration, one per
 * remaining cap slot. Rendered only for small, known caps (1–8) so the footer stays compact; empty
 * otherwise. `ascii` swaps the pair for `#`/`-` under NO_COLOR / TERM=dumb.
 */
export function renderPips(done: number, max: number | undefined, ascii: boolean = false): string {
  if (typeof max !== "number" || !Number.isFinite(max)) return ""
  const cap = Math.floor(max)
  if (cap < 1 || cap > 8) return ""
  const filled = Math.min(Math.max(0, Math.floor(Number.isFinite(done) ? done : 0)), cap)
  const filledGlyph = ascii ? PIP_FILLED_ASCII : PIP_FILLED
  const emptyGlyph = ascii ? PIP_EMPTY_ASCII : PIP_EMPTY
  return filledGlyph.repeat(filled) + emptyGlyph.repeat(cap - filled)
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

/** Relative `ended <ago>` label for a rail row. Future or non-finite timestamps clamp to `just now`. */
export function relativeTime(endedAt: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - endedAt)
  if (!Number.isFinite(delta)) return "just now"
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h ago`
}

/** Stall/retries diagnostics for a paused goal's now row. Values floor-clamp to >= 0; NaN degrades to 0. */
export function pauseDiagnostics(stall: number, retries: number): string {
  const clean = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)
  return `stall ${clean(stall)} · retries ${clean(retries)}`
}

interface LoopTotals {
  readonly iterations: number
  readonly turns: number
  readonly tools: number
  readonly spanMs: number
}

/** Aggregate tally for a finished loop: iterations, evaluated turns, tool calls and wall-clock span setAt → last endedAt. Empty input yields zeros with span 0. */
export function loopTotals(entries: readonly LoopEntry[], setAt: number): LoopTotals {
  let turns = 0
  let tools = 0
  let lastEnded = 0
  for (const entry of entries) {
    turns += Number.isFinite(entry.turns) ? entry.turns : 0
    tools += Number.isFinite(entry.toolCalls) ? entry.toolCalls : 0
    if (Number.isFinite(entry.endedAt) && entry.endedAt > lastEnded) lastEnded = entry.endedAt
  }
  const spanMs = entries.length === 0 ? 0 : Math.max(0, lastEnded - setAt)
  return { iterations: entries.length, turns, tools, spanMs }
}

/** Local wall-clock HH:MM for a timestamp (24h, zero-padded). Non-finite input yields "--:--". */
export function localTime(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--"
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return "--:--"
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/** The most recent verdict inside the current iteration's window — `(last endedAt | setAt, ∞)`. Undefined when the current iteration has no verdict yet. */
export function currentIterationVerdict(history: readonly VerdictEntry[], entries: readonly LoopEntry[], setAt: number): VerdictEntry | undefined {
  const from = entries.length > 0 ? entries[entries.length - 1]!.endedAt : setAt
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]!
    if (entry.at > from) return entry
    break
  }
  return undefined
}

/** Evaluated turns after the given verdict's turn (same per-iteration counter). Clamps to >= 0. */
export function turnsSinceVerdict(turns: number, verdictTurn: number): number {
  if (!Number.isFinite(turns) || !Number.isFinite(verdictTurn)) return 0
  return Math.max(0, Math.floor(turns) - Math.floor(verdictTurn))
}

/** Per-iteration share of completed wall time as integer percentages (rounds; may sum to ~100). Zero-sum input yields all zeros. */
export function durationShares(durations: readonly number[]): number[] {
  const total = durations.reduce((sum, span) => sum + Math.max(0, Number.isFinite(span) ? span : 0), 0)
  if (total <= 0) return durations.map(() => 0)
  return durations.map((span) => Math.round((Math.max(0, Number.isFinite(span) ? span : 0) / total) * 100))
}

const SPARK_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const
/** ASCII level ramp for dumb terminals — ascending ink density, the same shape as eighth-blocks without the font requirement. */
export const SPARK_GLYPHS_ASCII = [".", ":", "-", "=", "+", "*", "#", "@"] as const
/** Gap in the sparkline: an unmeasurable arm renders as a void (space) in ASCII mode, `·` otherwise. */
export const SPARK_GAP_ASCII = " "
/** Truncation lead-in for the sparkline: `>` in ASCII mode, `…` otherwise. */
export const SPARK_TRUNC_ASCII = ">"
/** Bars the per-iteration context sparkline renders; older estimates fall off the left behind a leading … marker. */
export const SPARK_MAX_CELLS = 16

export interface ContextSpark {
  /** One glyph per recent entry, oldest → newest; `·` marks an entry whose arm could not measure the context. A leading `…` marks truncation past SPARK_MAX_CELLS. */
  readonly bars: string
  /** Highest estimate across ALL completed iterations (not just the visible window). */
  readonly peak: number
  /** Newest estimate present anywhere in the history. */
  readonly latest: number
  /** How many entries carry a finite estimate (gaps excluded). */
  readonly shown: number
  readonly truncated: boolean
}

/**
 * Per-iteration context timeline behind the loop dialog: each bar is the context size estimated at the
 * arm of that iteration (the boundary-compaction estimate tagged with the iteration). Never divides by
 * zero; a present-but-tiny estimate still renders `▁` (present data is not a gap). Entries without a
 * finite estimate render `·`. Returns undefined when NO entry carries an estimate — the caller omits the row.
 */
export function contextSparkline(entries: readonly { readonly contextTokens?: number }[], ascii: boolean = false): ContextSpark | undefined {
  const estimates = entries.map((entry) =>
    typeof entry.contextTokens === "number" && Number.isFinite(entry.contextTokens) && entry.contextTokens >= 0 ? entry.contextTokens : undefined,
  )
  const present = estimates.filter((value): value is number => value !== undefined)
  if (present.length === 0) return undefined
  const peak = Math.max(...present)
  let latest = 0
  for (let index = estimates.length - 1; index >= 0; index -= 1) {
    const value = estimates[index]
    if (value !== undefined) {
      latest = value
      break
    }
  }
  const window = estimates.slice(-SPARK_MAX_CELLS)
  const truncated = window.length < estimates.length
  const ramp = ascii ? SPARK_GLYPHS_ASCII : SPARK_GLYPHS
  const gap = ascii ? SPARK_GAP_ASCII : "·"
  const truncatedMarker = ascii ? SPARK_TRUNC_ASCII : "…"
  const bars = window
    .map((value) => {
      if (value === undefined) return gap
      if (peak === 0) return ramp[0]!
      return ramp[Math.min(7, Math.floor((value / peak) * 8))]!
    })
    .join("")
  return { bars: (truncated ? truncatedMarker : "") + bars, peak, latest, shown: present.length, truncated }
}

export const CONTEXT_BAR_CELLS = 16
/** Fill ratio at/past which the context meter renders in the warning tone. Matches the boundary-compaction arming signal (the loop needs headroom before the threshold is reached). */
export const CONTEXT_HOT_RATIO = 0.8

/**
 * The context-size meter behind the status dialog: the estimated prompt size as a share of the
 * plugin's auto-compact threshold. Never divides by zero; `capacity <= 0` or absent means the
 * threshold is disabled, so the caller renders the bare token count without a bar. `pct` is the
 * raw ratio × 100 and may exceed 100 when the estimate is past the threshold — honest over the neat.
 */
export function contextMeter(size: number, capacity: number | undefined, cells: number = CONTEXT_BAR_CELLS, ascii: boolean = false): {
  filled: number
  text: string
  pct: number | undefined
  hot: boolean
  over: boolean
} {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0
  const width = Math.max(1, Math.floor(cells))
  const hasCapacity = typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0
  const filledGlyph = ascii ? BAR_FILLED_ASCII : BAR_FILLED
  const emptyGlyph = ascii ? BAR_EMPTY_ASCII : BAR_EMPTY
  if (!hasCapacity) return { filled: 0, text: emptyGlyph.repeat(width), pct: undefined, hot: false, over: false }
  const ratio = safeSize / (capacity as number)
  const pct = Math.round(ratio * 100)
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)))
  return {
    filled,
    text: filledGlyph.repeat(filled) + emptyGlyph.repeat(width - filled),
    pct,
    hot: ratio >= CONTEXT_HOT_RATIO,
    over: ratio >= 1,
  }
}
