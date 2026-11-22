import stringWidth from "string-width"

/**
 * Memoized terminal-cell width. `stringWidth` strips ANSI and runs an Intl.Segmenter pass on every
 * call; the TUI asks for the width of the same labels, prefixes and graphemes many times per frame.
 * Cache hits are pure lookups. Bounded so a long session cannot grow the map without limit; an
 * evicted string is simply recomputed, which yields the same number.
 */
const WIDTH_CACHE_LIMIT = 4096
const widthCache = new Map<string, number>()
export const cellWidth = (text: string): number => {
  const hit = widthCache.get(text)
  if (hit !== undefined) return hit
  const width = stringWidth(text)
  if (widthCache.size < WIDTH_CACHE_LIMIT) widthCache.set(text, width)
  return width
}
import { COMPACT_MISS_CAP } from "./types.ts"
import type { GoalRecord, GoalStatus, UsageSnapshot } from "./types.ts"

/** Grapheme clusters, so a truncation boundary never splits an emoji, a flag or a combining sequence. */
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

/**
 * Rows a `wrapMode="word"` cell needs to paint `text` at `width` terminal cells. Greedy word wrap on
 * single spaces (the card's remediation grammar), width measured with stringWidth, never mid-word.
 * A word longer than the line hard-breaks across as many rows as it needs. An empty string paints one
 * line. Matches the card's `flexGrow` cell, which wraps at spaces and hard-breaks what cannot fit.
 */
export function wrapLines(text: string, width: number): number {
  const max = Math.max(1, Math.floor(width))
  let lines = 1
  let used = 0
  for (const word of text.split(" ")) {
    if (word === "") continue
    const w = cellWidth(word)
    const sep = used === 0 ? 0 : 1
    if (used > 0 && used + sep + w > max) {
      lines += 1
      used = 0
    }
    if (w > max) {
      const extra = Math.floor((w - 1) / max)
      lines += extra
      used = w % max === 0 ? max : w % max
    } else {
      used += (used === 0 ? 0 : 1) + w
    }
  }
  return lines
}

/**
 * Strips terminal control sequences (OSC, CSI, two-char Fe, lone C0/DEL) from subprocess output so a
 * persisted tail paints as plain text, never as raw escapes or mojibake, and normalizes CR to LF.
 * Tabs and newlines survive. Applied at the engine boundary (the verifier returns raw subprocess
 * output) before anything is stored on the record.
 */
export function stripControls(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "") // OSC ... BEL/ST
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI ... final byte
    .replace(/\u001b[@-Z\\-_]/g, "") // two-char Fe sequences
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") // lone C0 and DEL
    .replace(/\r\n?/g, "\n")
}

export const GOAL_GLYPH = "\u25CE"
/** ASCII demotion for dumb terminals (NO_COLOR / TERM=dumb): the goal marker becomes a plain asterisk. */
const GOAL_GLYPH_ASCII = "*"
/** The goal marker for the current surface — demoted under reduced color, never a broken glyph. */
export const goalGlyph = (ascii: boolean = false): string => (ascii ? GOAL_GLYPH_ASCII : GOAL_GLYPH)

export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`
  return `${s}s`
}

/**
 * The one-line story of a finished goal: turns, wall time, and — for loops — completed iterations.
 * Used by the outcome toast so every user reads the shape of what happened without opening the dialog.
 */
export const outcomeStory = (input: { turns: number; elapsedMs: number; iterations?: number }): string => {
  const turns = `${Math.max(0, input.turns)} turn${input.turns === 1 ? "" : "s"}`
  const elapsed = formatDuration(input.elapsedMs)
  const iterations =
    typeof input.iterations === "number" && input.iterations > 0
      ? ` · ${input.iterations} iteration${input.iterations === 1 ? "" : "s"}`
      : ""
  return `${turns} · ${elapsed}${iterations}`
}

/** Minute-resolution duration for always-on indicators, so they re-render rarely. */
export function formatDurationCoarse(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "<1m"
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`
}

export function formatTokens(n: number): string {
  if (n < 1_000) return String(Math.round(n))
  // Round-then-compare at the unit boundary: a value whose rounded k-form reaches 1000k renders as M instead.
  const k = (n / 1_000).toFixed(n < 10_000 ? 1 : 0)
  if (n < 1_000_000 && Number(k) < 1_000) return `${k}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function formatCost(usd: number): string {
  if (usd <= 0) return "$0"
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`
}

export function diffUsage(current: UsageSnapshot, baseline: UsageSnapshot): UsageSnapshot {
  const d = (a: number, b: number) => Math.max(0, a - b)
  return {
    cost: d(current.cost, baseline.cost),
    input: d(current.input, baseline.input),
    output: d(current.output, baseline.output),
    reasoning: d(current.reasoning, baseline.reasoning),
    cacheRead: d(current.cacheRead, baseline.cacheRead),
    cacheWrite: d(current.cacheWrite, baseline.cacheWrite),
  }
}

/**
 * The spend line. With `maxWidth` (terminal cells), a degradation ladder applies when the content
 * does not fit: the least decision-relevant segment drops first — cached, then out, then in — and
 * the cost is the anchor, always kept whole and never clipped mid-figure. With no `maxWidth` the
 * full line renders (the dialog's modal has room). An absent cost simply drops from the anchor.
 */
export function formatSpend(spend: UsageSnapshot, maxWidth: number = Number.POSITIVE_INFINITY): string {
  const cost = spend.cost > 0 ? formatCost(spend.cost) : undefined
  const parts = [`${formatTokens(spend.input + spend.cacheRead + spend.cacheWrite)} in`, `${formatTokens(spend.output + spend.reasoning)} out`]
  if (spend.cacheRead > 0) parts.push(`${formatTokens(spend.cacheRead)} cached`)
  const join = (tokens: string[]) => [...tokens, ...(cost ? [cost] : [])].join(" \u00B7 ")
  let tokens = parts
  let out = join(tokens)
  while (tokens.length > 0 && cellWidth(out) > maxWidth) {
    tokens = tokens.slice(0, -1)
    out = join(tokens)
  }
  if (tokens.length === 0) return cost ?? parts[0] ?? ""
  return out
}

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "active",
  paused: "paused",
  achieved: "achieved",
  impossible: "judged impossible",
  cleared: "cleared",
  failed: "failed after an unrecoverable error",
}

export const statusLabel = (status: GoalStatus) => STATUS_LABEL[status]

function elapsed(record: GoalRecord, now: number) {
  return (record.endedAt ?? now) - record.startedAt
}

/** Multi-line report used by `/goal` with no arguments. */
export function formatStatus(record: GoalRecord, now: number, spend: UsageSnapshot | undefined, defaultMaxLoops?: number): string {
  const lines = [
    `Goal ${statusLabel(record.status)}: ${record.condition}`,
    `${record.endedAt ? "Ran" : "Running"} for ${formatDuration(elapsed(record, now))}${record.turns > 0 ? ` \u00B7 ${record.turns} turn${record.turns === 1 ? "" : "s"} evaluated` : ""}`,
  ]
  if (spend) lines.push(`Spend: ${formatSpend(spend)}`)
  if (record.loopEnabled) {
    const iteration = record.loopIteration ?? 1
    const max = record.loopMaxLoops ?? defaultMaxLoops ?? "?"
    lines.push(`Loop: iteration="${iteration}" max="${max}" · objective: ${record.loopObjective ?? record.condition}`)
    const pending = record.loopCompact
    if (pending) {
      if (pending.landedAt) lines.push(`Loop compact: landed ${formatDuration(now - pending.landedAt)} ago`)
      else lines.push(`Loop compact: pending ${formatDuration(now - pending.requestedAt)} (miss ${pending.misses}/${COMPACT_MISS_CAP})`)
    }
    for (const entry of record.loopHistory ?? [])
      lines.push(`  v${entry.version} · met · ${entry.turns} turn${entry.turns === 1 ? "" : "s"} · ${truncate(entry.summary, 140)}`)
  }
  if (record.reason) lines.push(`${record.status === "active" ? "Evaluator" : "Reason"}: ${record.reason}`)
  return lines.join("\n")
}

/**
 * Hard-cap a one-line fragment at `max` terminal cells, appending `…` (or the caller's
 * `ellipsis`, e.g. `...` on a reduced-color surface) when anything was cut.
 * Width-aware (unlike a code-unit slice): a CJK cell costs 2, an emoji 2, a combining mark 0,
 * and the boundary always falls between graphemes — the output never carries a lone surrogate
 * or half a ZWJ sequence, and never renders wider than `max` cells. When even the ellipsis is
 * wider than `max`, whole graphemes of the ellipsis are emitted up to `max` — the width
 * contract wins over showing an ellipsis.
 */
export function truncate(text: string, max: number, ellipsis: string = "\u2026"): string {
  if (max <= 0) return ""
  const flat = text.replace(/\s+/g, " ").trim()
  if (cellWidth(flat) <= max) return flat
  const ellipsisWidth = cellWidth(ellipsis)
  if (ellipsisWidth >= max) {
    let fitted = ""
    let used = 0
    for (const { segment } of segmenter.segment(ellipsis)) {
      const w = cellWidth(segment)
      if (used + w > max) break
      fitted += segment
      used += w
    }
    return fitted
  }
  const budget = max - ellipsisWidth // reserve exactly the cells the ellipsis paints
  let out = ""
  let used = 0
  for (const { segment } of segmenter.segment(flat)) {
    const w = cellWidth(segment)
    if (used + w > budget) break
    out += segment
    used += w
  }
  // Never leave a dangling space before the ellipsis.
  return `${out.replace(/\s+$/, "")}${ellipsis}`
}

/**
 * Hard character cap for text that feeds an LLM verbatim — the loop summary that rides the
 * re-arm boundary into the next planner call (and, truncated the same way, into the armed
 * kickoff). Unlike {@link truncate} this preserves the leading text byte-for-byte: no
 * whitespace flattening, no cell math — the summary's lines are payload, not paint.
 *
 * Guarantees at `maxChars`:
 * - input at or under `maxChars` code units is returned unchanged (identity, not a copy);
 * - the output is at most `maxChars` code units and ends with the elision marker "…" (U+2026);
 * - when a whitespace run exists within the cut window the cut lands on that whitespace, so
 *   the last kept token is whole — never the mid-word raw cut the planner demonstrably read;
 * - the boundary never splits a UTF-16 surrogate pair, so no lone surrogate ever leaks;
 * - the marker is the only added character; no ellipsis is added when nothing was cut.
 *
 * A zero/negative budget returns "" — never a bare marker.
 */
export function elideAtWordBoundary(text: string, maxChars: number): string {
  if (maxChars <= 0) return ""
  if (text.length <= maxChars) return text
  const budget = maxChars - 1 // reserve one code unit for the elision marker "…"
  if (budget <= 0) return "…"
  // Prefer the last whitespace at or before `budget` within the trailing quarter of the
  // window: a cut near the front of a long line would drop more payload than it saves.
  let cut = -1
  for (let i = budget; i >= Math.max(0, budget - Math.floor(budget / 4)); i--) {
    const code = text.charCodeAt(i)
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      cut = i
      break
    }
  }
  if (cut !== -1) return `${text.slice(0, cut).replace(/\s+$/, "")}…`
  // No whitespace in the window: cut at the budget, backing off a high surrogate so the
  // pair stays whole (a low surrogate at the boundary is the split half — skip it too).
  let end = budget
  const before = text.charCodeAt(end - 1)
  if (before >= 0xd800 && before <= 0xdbff) end -= 1
  return `${text.slice(0, end)}…`
}
