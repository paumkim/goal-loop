/**
 * Structured outcome telemetry derived from the durable learning journal.
 *
 * Pure aggregation only: the runtime reads the JSONL file once and hands the parsed
 * entries here. Nothing in this module performs I/O, mutates its inputs, or throws on
 * malformed data — a missing/empty/all-garbage journal must never affect a goal run.
 * Telemetry is advisory context for prompts, not a gate on any verdict.
 */
import { formatRecentLearnings, parseLearningEntries, recentLearningsFromEntries } from "./learning-log.ts"
import type { LearningEntry } from "./learning-log.ts"
import { elideAtWordBoundary, formatDuration } from "./format.ts"

/** A failure theme is flagged recurring once it is seen this many times. */
export const RECURRING_THEME_THRESHOLD = 3
/** Default cap for the prompt-ready telemetry block (characters). */
export const DEFAULT_TELEMETRY_MAX_CHARS = 900
/** Default cap for the composed prompt-facing learnings block (recent lessons + telemetry together). */
export const PROMPT_LEARNINGS_MAX_CHARS = 900
/** Maximum recent lessons surfaced in the composed prompt block (down from the diagnostic default of 5). */
const PROMPT_LESSON_LIMIT = 3
/** Maximum number of themes/conditions surfaced in the formatted block. */
const MAX_THEMES = 4
const MAX_CONDITIONS = 3

export interface FailureTheme {
  readonly theme: string
  readonly count: number
  readonly recurring: boolean
}

export interface RecurringCondition {
  readonly condition: string
  readonly count: number
}

export interface TimeToGreen {
  readonly count: number
  readonly medianMs?: number
}

export interface OutcomeTelemetry {
  /** Number of parsed journal entries that contributed. */
  readonly entries: number
  /** Terminal status -> count (goal_terminal, deduplicated against session_outcome). */
  readonly terminalCounts: Readonly<Record<string, number>>
  /** Turn verdict -> count. */
  readonly verdictCounts: Readonly<Record<string, number>>
  /** Normalized not_met reasons, most frequent first. */
  readonly failureThemes: readonly FailureTheme[]
  /** Median goal_armed -> achieved duration, paired by session + goal. */
  readonly timeToGreen: TimeToGreen
  /** Normalized goal conditions seen at more than one boundary. */
  readonly recurringConditions: readonly RecurringCondition[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Normalize a free-text reason into a stable comparison key. Lowercases, drops URLs,
 * hashes, durations and punctuation, and collapses whitespace. Never fabricates words:
 * the result is a lossy key for grouping, not a replacement for the original reason.
 */
export function normalizeReason(reason: string | undefined): string {
  if (!asString(reason)) return ""
  return (reason ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[0-9a-f]{7,40}\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|day|days)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

function normalizeCondition(condition: string | undefined): string {
  return normalizeReason(condition)
}

function pairKey(entry: LearningEntry): string | undefined {
  const session = asString(entry.sessionID)
  const goal = asString(entry.goalID)
  return session && goal ? `${session}\u0000${goal}` : undefined
}

function validTime(ts: string | undefined): number | undefined {
  if (typeof ts !== "string" || !ts) return undefined
  const ms = Date.parse(ts)
  return Number.isFinite(ms) ? ms : undefined
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function sortedCounts(counts: Readonly<Record<string, number>>): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
}

/**
 * Aggregate a parsed learning journal into an outcome-telemetry summary.
 * Accepts any array; unknown/malformed entries are ignored by the field readers.
 */
export function summarizeOutcomeTelemetry(entries: readonly LearningEntry[]): OutcomeTelemetry {
  const terminalCounts: Record<string, number> = {}
  const verdictCounts: Record<string, number> = {}
  const themeCounts: Record<string, number> = {}
  const conditionCounts: Record<string, number> = {}
  const armedAt = new Map<string, number>()
  const greenDurations: number[] = []
  const seenTerminals = new Set<string>()
  let parsed = 0

  for (const entry of entries) {
    if (!isRecord(entry)) continue
    parsed += 1
    const key = pairKey(entry)

    if (entry.kind === "goal_terminal" || entry.kind === "session_outcome") {
      const status = asString(entry.status)
      // goal_terminal and session_outcome are two records of the same terminal event; dedupe by identity.
      const identity = `${key ?? ""}\u0000${validTime(entry.ts) ?? entry.ts}\u0000${status ?? ""}`
      if (!seenTerminals.has(identity)) {
        seenTerminals.add(identity)
        if (status) bump(terminalCounts, status)
      }
    }

    if (entry.kind === "turn_verdict") {
      const verdict = asString(entry.verdict)
      if (verdict) bump(verdictCounts, verdict)
      if (verdict === "not_met") {
        const theme = normalizeReason(isRecord(entry) ? asString(entry.reason) : undefined)
        if (theme) bump(themeCounts, theme)
      }
    }

    if (entry.kind === "goal_armed" || entry.kind === "goal_terminal" || entry.kind === "session_outcome") {
      const condition = normalizeCondition(asString(entry.condition))
      if (condition) bump(conditionCounts, condition)
    }

    if (key && entry.kind === "goal_armed") {
      const ms = validTime(entry.ts)
      if (ms !== undefined) {
        const prev = armedAt.get(key)
        if (prev === undefined || ms < prev) armedAt.set(key, ms)
      }
    }
  }

  // Second pass: a terminal can appear after its armed entry in append order, but pairing is
  // order-independent because armed times are collected first. Malformed/negative pairs are skipped.
  for (const entry of entries) {
    if (!isRecord(entry) || entry.kind !== "goal_terminal" || asString(entry.status) !== "achieved") continue
    const key = pairKey(entry)
    const end = validTime(entry.ts)
    const start = key ? armedAt.get(key) : undefined
    if (key && start !== undefined && end !== undefined && end >= start) greenDurations.push(end - start)
  }
  greenDurations.sort((a, b) => a - b)
  const medianMs = greenDurations.length
    ? greenDurations[Math.floor(greenDurations.length / 2)]
    : undefined

  const failureThemes: FailureTheme[] = sortedCounts(themeCounts)
    .slice(0, MAX_THEMES)
    .map(([theme, count]) => ({ theme, count, recurring: count >= RECURRING_THEME_THRESHOLD }))

  const recurringConditions: RecurringCondition[] = sortedCounts(conditionCounts)
    .filter(([, count]) => count > 1)
    .slice(0, MAX_CONDITIONS)
    .map(([condition, count]) => ({ condition, count }))

  return {
    entries: parsed,
    terminalCounts,
    verdictCounts,
    failureThemes,
    ...(medianMs !== undefined ? { timeToGreen: { count: greenDurations.length, medianMs } } : { timeToGreen: { count: 0 } }),
    recurringConditions,
  }
}

/** Convenience: parse best-effort JSONL text and aggregate it in one call. */
export function summarizeLearningText(text: string): OutcomeTelemetry {
  return summarizeOutcomeTelemetry(parseLearningEntries(text))
}

function countLine(counts: Readonly<Record<string, number>>): string {
  const pairs = sortedCounts(counts)
  return pairs.length ? pairs.map(([key, count]) => `${key}=${count}`).join(", ") : "none"
}

/**
 * Render a compact, prompt-ready telemetry block. Returns "" when the journal carries
 * no telemetry-worthy signal, so callers can simply append it to the learnings channel.
 */
export function formatOutcomeTelemetry(summary: OutcomeTelemetry, maxChars = DEFAULT_TELEMETRY_MAX_CHARS): string {
  const hasSignal = summary.entries > 0 && (
    Object.keys(summary.terminalCounts).length > 0 ||
    Object.keys(summary.verdictCounts).length > 0 ||
    summary.failureThemes.length > 0 ||
    summary.timeToGreen.count > 0 ||
    summary.recurringConditions.length > 0
  )
  if (!hasSignal) return ""

  const lines: string[] = []
  lines.push(`Outcome telemetry (from ${summary.entries} journal entries):`)
  lines.push(`- Terminal outcomes: ${countLine(summary.terminalCounts)}`)
  lines.push(`- Turn verdicts: ${countLine(summary.verdictCounts)}`)

  if (summary.failureThemes.length) {
    const themes = summary.failureThemes
      .map((t) => `"${t.theme}" x${t.count}${t.recurring ? " (recurring)" : ""}`)
      .join("; ")
    lines.push(`- Failure themes: ${themes}`)
  }

  if (summary.timeToGreen.count > 0 && summary.timeToGreen.medianMs !== undefined) {
    lines.push(`- Time to green: median ${formatDuration(summary.timeToGreen.medianMs)} over ${summary.timeToGreen.count} run${summary.timeToGreen.count === 1 ? "" : "s"}`)
  }

  if (summary.recurringConditions.length) {
    const conditions = summary.recurringConditions
      .map((c) => `"${c.condition}" x${c.count}`)
      .join("; ")
    lines.push(`- Recurring conditions: ${conditions}`)
  }

  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_TELEMETRY_MAX_CHARS
  return elideAtWordBoundary(lines.join("\n"), limit)
}

/**
 * Composition of the two prompt-facing learnings channels into one bounded block. This string rides every
 * continuation/arm/retry/checkin steer and, in session mode, is part of the evaluator's live context — so it is kept
 * deliberately small and focused (at most `maxChars` code units after both components are elided). Aggregate telemetry
 * is summarized over the bounded journal tail the caller supplies, not the whole historical journal.
 */
export function formatLearningsForPrompt(entries: readonly LearningEntry[], maxChars = PROMPT_LEARNINGS_MAX_CHARS): string {
  const budget = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : PROMPT_LEARNINGS_MAX_CHARS
  // Leave room for the formatters' own header lines so the combined block stays at or under `budget`.
  const lessons = formatRecentLearnings(recentLearningsFromEntries(entries, PROMPT_LESSON_LIMIT), Math.max(1, Math.floor(budget * 0.6)))
  const telemetry = formatOutcomeTelemetry(summarizeOutcomeTelemetry(entries), Math.max(1, Math.floor(budget * 0.3)))
  return [lessons, telemetry].filter(Boolean).join("\n\n")
}
