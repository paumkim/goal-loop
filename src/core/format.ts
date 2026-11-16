import stringWidth from "string-width"
import { COMPACT_MISS_CAP } from "./types.ts"
import type { GoalRecord, GoalStatus, UsageSnapshot } from "./types.ts"

/** Grapheme clusters, so a truncation boundary never splits an emoji, a flag or a combining sequence. */
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

export const GOAL_GLYPH = "\u25CE"

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
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

function formatCost(usd: number): string {
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

export function formatSpend(spend: UsageSnapshot): string {
  const parts = [`${formatTokens(spend.input + spend.cacheRead + spend.cacheWrite)} in`, `${formatTokens(spend.output + spend.reasoning)} out`]
  if (spend.cacheRead > 0) parts.push(`${formatTokens(spend.cacheRead)} cached`)
  if (spend.cost > 0) parts.push(formatCost(spend.cost))
  return parts.join(" \u00B7 ")
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
 * Hard-cap a one-line fragment at `max` terminal cells, appending `…` when anything was cut.
 * Width-aware (unlike a code-unit slice): a CJK cell costs 2, an emoji 2, a combining mark 0,
 * and the boundary always falls between graphemes — the output never carries a lone surrogate
 * or half a ZWJ sequence, and never renders wider than `max` cells.
 */
export function truncate(text: string, max: number): string {
  if (max <= 0) return ""
  const flat = text.replace(/\s+/g, " ").trim()
  if (stringWidth(flat) <= max) return flat
  const budget = max - 1 // reserve one cell for the ellipsis
  let out = ""
  let used = 0
  for (const { segment } of segmenter.segment(flat)) {
    const w = stringWidth(segment)
    if (used + w > budget) break
    out += segment
    used += w
  }
  // Never leave a dangling space before the ellipsis.
  return `${out.replace(/\s+$/, "")}\u2026`
}
