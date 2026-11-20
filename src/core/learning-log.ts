import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { formatDuration } from "./format.ts"
import type { GoalRecord, GoalStatus, LoopEntry, UsageSnapshot } from "./types.ts"

export const LEARNING_LOG_VERSION = 1 as const

export type LearningEntryKind = "goal_terminal" | "loop_iteration"

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

export interface GoalTerminalLearningEntry extends LearningEntryBase {
  readonly kind: "goal_terminal"
  readonly status: GoalStatus
  readonly iterations?: number
}

export interface LoopIterationLearningEntry extends LearningEntryBase {
  readonly kind: "loop_iteration"
  readonly iteration: number
  readonly summary: string
  readonly verdict: "met"
}

export type LearningEntry = GoalTerminalLearningEntry | LoopIterationLearningEntry

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

export function serializeLearningEntry(entry: LearningEntry): string {
  return `${JSON.stringify(entry)}\n`
}

/** Best-effort append of one JSONL learning entry. Never throws. */
export function appendLearningEntry(file: string | undefined, entry: LearningEntry): void {
  const target = typeof file === "string" ? file.trim() : ""
  if (!target) return
  try {
    mkdirSync(dirname(target), { recursive: true })
    appendFileSync(target, serializeLearningEntry(entry))
  } catch {
    // Logging/learning must never break the caller.
  }
}
