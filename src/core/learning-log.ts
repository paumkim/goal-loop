import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { elideAtWordBoundary, formatDuration } from "./format.ts"

const LEARNING_LOG_VERSION = 1 as const

import type { GoalRecord, GoalStatus, LoopEntry, UsageSnapshot, Verdict, VerdictEntry } from "./types.ts"

type LearningEntryKind = "goal_terminal" | "loop_iteration" | "turn_verdict" | "goal_armed" | "session_outcome"

interface LearningEntryBase {
  readonly version: typeof LEARNING_LOG_VERSION
  readonly ts: string
  readonly kind: LearningEntryKind
  readonly sessionID: string
  readonly goalID: string
  readonly directory?: string
  readonly condition: string
  readonly objective?: string
  readonly reason?: string
  readonly turns?: number
  readonly toolCalls?: number
  readonly elapsedMs?: number
  readonly sha?: string
  readonly spend?: UsageSnapshot
  readonly lesson: string
}

interface GoalTerminalLearningEntry extends LearningEntryBase {
  readonly kind: "goal_terminal"
  readonly status: GoalStatus
  readonly iterations?: number
}

interface LoopIterationLearningEntry extends LearningEntryBase {
  readonly kind: "loop_iteration"
  readonly iteration: number
  readonly summary: string
  readonly verdict: "met"
}

interface TurnVerdictLearningEntry extends LearningEntryBase {
  readonly kind: "turn_verdict"
  readonly turn: number
  readonly verdict: Verdict
}

interface GoalArmedLearningEntry extends LearningEntryBase {
  readonly kind: "goal_armed"
  readonly loopEnabled: boolean
  readonly loopMaxLoops?: number
}

interface SessionOutcomeLearningEntry extends LearningEntryBase {
  readonly kind: "session_outcome"
  readonly status: GoalStatus
  readonly iterations?: number
}

export type LearningEntry = GoalTerminalLearningEntry | LoopIterationLearningEntry | TurnVerdictLearningEntry | GoalArmedLearningEntry | SessionOutcomeLearningEntry

function iso(atMs: number): string {
  const d = new Date(atMs)
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString()
}

function clean(text: string | undefined): string | undefined {
  if (typeof text !== "string") return undefined
  const t = text.trim()
  return t ? t : undefined
}

function metricsLine(turns?: number, toolCalls?: number, elapsedMs?: number): string {
  const parts: string[] = []
  if (typeof turns === "number" && Number.isFinite(turns)) parts.push(`${turns} turn${turns === 1 ? "" : "s"}`)
  if (typeof toolCalls === "number" && Number.isFinite(toolCalls)) parts.push(`${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`)
  if (typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= 0) parts.push(formatDuration(elapsedMs))
  return parts.join(", ")
}

function goalLesson(record: GoalRecord, reason: string | undefined): string {
  const why = clean(reason) ?? clean(record.reason) ?? "no reason recorded"
  const metrics = metricsLine(record.turns, undefined, record.endedAt && record.startedAt ? record.endedAt - record.startedAt : undefined)
  const suffix = metrics ? ` (${metrics}).` : "."
  switch (record.status) {
    case "achieved":
      return `Achieved: ${why}${suffix} Preserve the evidence and checks that proved completion; reuse this approach when similar conditions recur.`
    case "impossible":
      return `Judged impossible: ${why}${suffix} Reframe the condition, remove the blocker, or gather missing prerequisites before retrying.`
    case "cleared":
      return `Cleared before completion: ${why}${suffix} Capture remaining gaps and decide explicitly whether to resume, narrow scope, or stop.`
    case "failed":
      return `Failed due to unrecoverable error: ${why}${suffix} Treat this as a reliability issue: fix the underlying failure mode and add safeguards before retrying.`
    case "paused":
      return `Paused: ${why}${suffix} Resume with a concrete next step that addresses the pause cause.`
    case "active":
    default:
      return `Outcome recorded: ${why}${suffix} Extract a concrete lesson and apply it on the next attempt.`
  }
}

export function buildGoalTerminalLearningEntry(record: GoalRecord, atMs = Date.now()): GoalTerminalLearningEntry {
  const reason = clean(record.reason)
  const elapsedMs = record.endedAt && record.startedAt ? Math.max(0, record.endedAt - record.startedAt) : undefined
  const iterations = record.loopEnabled ? (record.loopHistory?.length ?? 0) + (record.loopHistoryDropped ?? 0) : undefined
  return {
    version: LEARNING_LOG_VERSION,
    ts: iso(atMs),
    kind: "goal_terminal",
    sessionID: record.sessionID,
    goalID: record.id,
    ...(clean(record.directory) ? { directory: clean(record.directory) } : {}),
    condition: record.condition,
    ...(clean(record.loopObjective) ? { objective: clean(record.loopObjective) } : {}),
    status: record.status as GoalStatus,
    ...(reason ? { reason } : {}),
    ...(typeof record.turns === "number" ? { turns: record.turns } : {}),
    ...(typeof elapsedMs === "number" ? { elapsedMs } : {}),
    ...(iterations !== undefined ? { iterations } : {}),
    ...(clean(record.lastVerify?.command) && record.lastVerify?.code === 0 && record.history.at(-1)?.sha ? { sha: record.history.at(-1)?.sha } : record.history.at(-1)?.sha ? { sha: record.history.at(-1)?.sha } : {}),
    ...(record.final ? { spend: record.final } : {}),
    lesson: goalLesson(record, reason),
  }
}

export function buildLoopIterationLearningEntry(
  record: GoalRecord,
  entry: LoopEntry,
  atMs = Date.now(),
): LoopIterationLearningEntry {
  const objective = clean(record.loopObjective) ?? clean(record.condition)
  const summary = clean(entry.summary) ?? "(no summary)"
  const reason = clean(entry.reason)
  const lessonParts = [
    `Iteration v${entry.version} met "${clean(entry.condition) ?? record.condition}".`,
    `What happened: ${summary}`,
    reason ? `Evaluator reason: ${reason}.` : undefined,
    `Improve next time: carry forward constraints and unfinished improvements noted above; verify with fresh evidence before marking future iterations met.`,
  ].filter(Boolean)
  return {
    version: LEARNING_LOG_VERSION,
    ts: iso(atMs),
    kind: "loop_iteration",
    sessionID: record.sessionID,
    goalID: record.id,
    ...(clean(record.directory) ? { directory: clean(record.directory) } : {}),
    condition: entry.condition,
    ...(objective ? { objective } : {}),
    iteration: entry.version,
    verdict: "met",
    summary,
    ...(reason ? { reason } : {}),
    turns: entry.turns,
    toolCalls: entry.toolCalls,
    elapsedMs: Math.max(0, entry.endedAt - record.startedAt),
    ...(entry.sha ? { sha: entry.sha } : {}),
    ...(entry.spend ? { spend: entry.spend } : {}),
    lesson: lessonParts.join(" "),
  }
}

function turnVerdictLesson(verdict: Verdict, reason: string | undefined): string {
  const why = clean(reason) ?? "no reason recorded"
  switch (verdict) {
    case "met":
      return `Turn verdict met: ${why}. Lesson: the evidence was sufficient this turn; preserve the checks and proof that demonstrated completion.`
    case "impossible":
      return `Turn verdict impossible: ${why}. Lesson: stop repeating blocked work; reframe the goal or resolve the blocking constraint before continuing.`
    case "not_met":
    default:
      return `Turn verdict not met: ${why}. Lesson: close the stated evidence gaps with concrete, verifiable progress on the next turn.`
  }
}

export function buildTurnVerdictLearningEntry(
  record: GoalRecord,
  entry: VerdictEntry,
  atMs = Date.now(),
): TurnVerdictLearningEntry {
  const reason = clean(entry.reason)
  const objective = clean(record.loopObjective)
  return {
    version: LEARNING_LOG_VERSION,
    ts: iso(atMs),
    kind: "turn_verdict",
    sessionID: record.sessionID,
    goalID: record.id,
    ...(clean(record.directory) ? { directory: clean(record.directory) } : {}),
    condition: record.condition,
    ...(objective ? { objective } : {}),
    turn: entry.turn,
    verdict: entry.verdict,
    ...(reason ? { reason } : {}),
    ...(typeof entry.toolCalls === "number" ? { toolCalls: entry.toolCalls } : {}),
    elapsedMs: Math.max(0, entry.at - record.startedAt),
    ...(entry.sha ? { sha: entry.sha } : {}),
    ...(entry.spend ? { spend: entry.spend } : {}),
    lesson: turnVerdictLesson(entry.verdict, reason),
  }
}

export function buildGoalArmedLearningEntry(record: GoalRecord, atMs = Date.now()): GoalArmedLearningEntry {
  const loop = record.loopEnabled === true
  const objective = clean(record.loopObjective) ?? clean(record.condition)
  const lesson = loop
    ? `Loop armed (max ${record.loopMaxLoops ?? "?"} iterations): ${objective ?? record.condition}. Lesson: capture evidence each turn, learn from verdicts/summaries, and apply improvements in the next iteration.`
    : `Goal armed: ${record.condition}. Lesson: define success clearly, log progress each turn, and use evidence to learn and improve until the condition holds.`
  return {
    version: LEARNING_LOG_VERSION,
    ts: iso(atMs),
    kind: "goal_armed",
    sessionID: record.sessionID,
    goalID: record.id,
    ...(clean(record.directory) ? { directory: clean(record.directory) } : {}),
    condition: record.condition,
    ...(objective ? { objective } : {}),
    loopEnabled: loop,
    ...(loop && typeof record.loopMaxLoops === "number" ? { loopMaxLoops: record.loopMaxLoops } : {}),
    lesson,
  }
}

export function buildSessionOutcomeLearningEntry(record: GoalRecord, atMs = Date.now()): SessionOutcomeLearningEntry {
  const base = buildGoalTerminalLearningEntry(record, atMs)
  const reason = clean(record.reason) ?? "no reason recorded"
  const metrics = metricsLine(record.turns, undefined, record.endedAt && record.startedAt ? record.endedAt - record.startedAt : undefined)
  const metricSuffix = metrics ? ` (${metrics})` : ""
  const sessionLesson = `Session outcome for this goal: ${record.status} — ${reason}${metricSuffix}. Lesson for next sessions: review this outcome and its turn/loop learnings, keep what worked, and change approach where evidence showed gaps.`
  return {
    version: LEARNING_LOG_VERSION,
    ts: base.ts,
    kind: "session_outcome",
    sessionID: base.sessionID,
    goalID: base.goalID,
    ...(base.directory ? { directory: base.directory } : {}),
    condition: base.condition,
    ...(base.objective ? { objective: base.objective } : {}),
    status: record.status as GoalStatus,
    ...(base.reason ? { reason: base.reason } : {}),
    ...(base.turns !== undefined ? { turns: base.turns } : {}),
    ...(base.elapsedMs !== undefined ? { elapsedMs: base.elapsedMs } : {}),
    ...(base.iterations !== undefined ? { iterations: base.iterations } : {}),
    ...(base.sha ? { sha: base.sha } : {}),
    ...(base.spend ? { spend: base.spend } : {}),
    lesson: sessionLesson,
  }
}

export function serializeLearningEntry(entry: LearningEntry): string {
  return `${JSON.stringify(entry)}\n`
}

const ensuredDirs = new Set<string>()

/** Best-effort append of one JSONL learning entry. Never throws. */
export function appendLearningEntry(file: string | undefined, entry: LearningEntry): void {
  const target = typeof file === "string" ? file.trim() : ""
  if (!target) return
  const dir = dirname(target)
  const line = serializeLearningEntry(entry)
  try {
    if (!ensuredDirs.has(dir)) {
      mkdirSync(dir, { recursive: true })
      ensuredDirs.add(dir)
    }
    appendFileSync(target, line)
  } catch (error) {
    // If the directory was removed after being ensured, recover once; logging must never break the caller.
    if (ensuredDirs.has(dir) && (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      try {
        ensuredDirs.delete(dir)
        mkdirSync(dir, { recursive: true })
        ensuredDirs.add(dir)
        appendFileSync(target, line)
      } catch {
        // swallow
      }
      return
    }
    // swallow
  }
}

interface RecentLearning {
  readonly kind: LearningEntryKind
  readonly ts: string
  readonly condition?: string
  readonly verdict?: string
  readonly status?: string
  readonly lesson: string
}

const LEARNING_KINDS = new Set<LearningEntryKind>([
  "goal_terminal", "loop_iteration", "turn_verdict", "goal_armed", "session_outcome",
])

/**
 * Best-effort parse of JSONL learning text. Blank, malformed, non-object, unknown-kind and
 * timestamp-less lines are skipped; the reader never throws. Exported so the runtime can read
 * the log once and derive both recent learnings and aggregate telemetry from the same entries.
 */
export function parseLearningEntries(text: string): LearningEntry[] {
  if (typeof text !== "string" || !text.trim()) return []
  const out: LearningEntry[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let value: unknown
    try {
      value = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    const kind = record.kind
    if (typeof kind !== "string" || !LEARNING_KINDS.has(kind as LearningEntryKind)) continue
    if (typeof record.ts !== "string") continue
    out.push(value as LearningEntry)
  }
  return out
}

/** Derive recent-learning summaries from already-parsed entries (most recent last). */
export function recentLearningsFromEntries(entries: readonly LearningEntry[], limit = 6): RecentLearning[] {
  if (limit <= 0) return []
  const out: RecentLearning[] = []
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = entries[i]
    if (!entry) continue
    const lesson = typeof entry.lesson === "string" ? entry.lesson.trim() : ""
    if (!lesson) continue
    out.push({
      kind: entry.kind,
      ts: entry.ts,
      ...(typeof entry.condition === "string" ? { condition: entry.condition } : {}),
      ...("verdict" in entry && typeof entry.verdict === "string" ? { verdict: entry.verdict } : {}),
      ...("status" in entry && typeof entry.status === "string" ? { status: entry.status } : {}),
      lesson,
    })
  }
  return out.reverse()
}

/**
 * Default byte window for the prompt-facing tail read. The journal is append-only and grows with every goal version;
 * reading the tail keeps per-tick I/O bounded regardless of how many historical entries exist.
 */
const LEARNING_TAIL_MAX_BYTES = 256 * 1024

/**
 * Best-effort read of learning entries from the tail of a JSONL journal without loading the whole file.
 * Only complete lines are parsed: a partial first line (the byte window starts mid-line) and a partial trailing line
 * (a concurrent append) are dropped. Small files fall back to a plain full read. Never throws.
 */
export function readLearningEntriesTail(file: string | undefined, maxBytes = LEARNING_TAIL_MAX_BYTES): LearningEntry[] {
  const target = typeof file === "string" ? file.trim() : ""
  if (!target || maxBytes <= 0) return []
  try {
    const size = statSync(target).size
    if (size <= maxBytes) return parseLearningEntries(readFileSync(target, "utf8"))
    const fd = openSync(target, "r")
    try {
      const buf = Buffer.alloc(maxBytes)
      const read = readSync(fd, buf, 0, maxBytes, size - maxBytes)
      let text = buf.subarray(0, read).toString("utf8")
      const firstNl = text.indexOf("\n")
      if (firstNl !== -1) text = text.slice(firstNl + 1) // window start is mid-line — drop the partial line
      const lastNl = text.lastIndexOf("\n")
      if (lastNl !== -1) text = text.slice(0, lastNl) // trailing partial line from a concurrent append
      return parseLearningEntries(text)
    } finally {
      closeSync(fd)
    }
  } catch {
    return []
  }
}

/** Best-effort read of recent learning entries (most recent last). Never throws. */
export function readRecentLearnings(file: string | undefined, limit = 6): RecentLearning[] {
  const target = typeof file === "string" ? file.trim() : ""
  if (!target || limit <= 0) return []
  try {
    return recentLearningsFromEntries(parseLearningEntries(readFileSync(target, "utf8")), limit)
  } catch {
    return []
  }
}

/** Format recent learnings for prompt injection (or empty string). */
export function formatRecentLearnings(learnings: readonly RecentLearning[], maxChars = 1200): string {
  if (!learnings.length) return ""
  const lines = learnings.map((l, i) => {
    const tag = [l.kind, l.verdict ?? l.status].filter(Boolean).join("/")
    const head = tag ? `[${tag}] ` : ""
    return `${i + 1}. ${head}${l.lesson}`
  })
  const text = elideAtWordBoundary(lines.join("\n"), maxChars)
  return `Recent learnings from this goal/loop (apply them to improve this turn):\n${text}`
}
