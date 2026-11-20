import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { formatDuration } from "./format.ts"

export const LEARNING_LOG_VERSION = 1 as const

import type { GoalRecord, GoalStatus, LoopEntry, UsageSnapshot, Verdict, VerdictEntry } from "./types.ts"

export type LearningEntryKind = "goal_terminal" | "loop_iteration" | "turn_verdict" | "goal_armed"

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

export interface TurnVerdictLearningEntry extends LearningEntryBase {
  readonly kind: "turn_verdict"
  readonly turn: number
  readonly verdict: Verdict
}

export interface GoalArmedLearningEntry extends LearningEntryBase {
  readonly kind: "goal_armed"
  readonly loopEnabled: boolean
  readonly loopMaxLoops?: number
}

export type LearningEntry = GoalTerminalLearningEntry | LoopIterationLearningEntry | TurnVerdictLearningEntry | GoalArmedLearningEntry

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

export interface RecentLearning {
  readonly kind: LearningEntryKind
  readonly ts: string
  readonly condition?: string
  readonly verdict?: string
  readonly status?: string
  readonly lesson: string
}

/** Best-effort read of recent learning entries (most recent last). Never throws. */
export function readRecentLearnings(file: string | undefined, limit = 6): RecentLearning[] {
  const target = typeof file === "string" ? file.trim() : ""
  if (!target || limit <= 0) return []
  try {
    const text = readFileSync(target, "utf8")
    const lines = text.trimEnd().split("\n")
    const out: RecentLearning[] = []
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i]?.trim()
      if (!line) continue
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        const lesson = typeof parsed.lesson === "string" ? parsed.lesson.trim() : ""
        const kind = typeof parsed.kind === "string" ? (parsed.kind as LearningEntryKind) : undefined
        if (!lesson || !kind) continue
        out.push({
          kind,
          ts: typeof parsed.ts === "string" ? parsed.ts : "",
          ...(typeof parsed.condition === "string" ? { condition: parsed.condition } : {}),
          ...(typeof parsed.verdict === "string" ? { verdict: parsed.verdict } : {}),
          ...(typeof parsed.status === "string" ? { status: parsed.status } : {}),
          lesson,
        })
      } catch {
        // skip malformed line
      }
    }
    return out.reverse()
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
  let text = lines.join("\n")
  if (text.length > maxChars) text = `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
  return `Recent learnings from this goal/loop (apply them to improve this turn):\n${text}`
}
