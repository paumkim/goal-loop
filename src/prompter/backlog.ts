import type { BacklogLine, TaskMarker, TaskState } from "./types.ts"
import { shortId } from "./util.ts"

const CHECKBOX = /^(\s*)([-*+]\s+\[)([ xX])(\]\s*)(.*)$/
const MARKER = /<!--\s*prompter:\s*([a-z_]+)(?:\s+id=([0-9a-zA-Z]+))?\s*-->/

/** Parse a backlog into checkbox lines. Non-checkbox lines are ignored. */
export const parseBacklog = (text: string): BacklogLine[] => {
  const lines = text.split("\n")
  const out: BacklogLine[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ""
    const match = CHECKBOX.exec(raw)
    if (!match) continue
    const indent = match[1] ?? ""
    const checked = (match[3] ?? " ").toLowerCase() === "x"
    const body = match[5] ?? ""
    const markerMatch = MARKER.exec(body)
    const objective = (markerMatch ? body.replace(markerMatch[0], "") : body).trim()
    if (!objective) continue
    const marker: TaskMarker | undefined = markerMatch
      ? { status: markerMatch[1] ?? "unknown", id: markerMatch[2] ?? "" }
      : undefined
    const id = marker?.id || shortId(objective)
    out.push({ index: i, raw, indent, checked, objective, id, ...(marker ? { marker } : {}) })
  }
  return out
}

/** States that still own a line: a marker can be missing after a crash, so the journal guards those too. */
const ACTIVE_STATES: ReadonlySet<string> = new Set(["running", "in_review"])

/**
 * First eligible unchecked line in file order. Removing a marker is the documented retry signal, so a
 * *terminal* journal record (failed/rejected/interrupted/merged) must not disqualify a line whose marker was
 * removed — otherwise a failed or rejected task could never be retried and the loop would silently lose it.
 * Only live states still block selection (they cannot have a stale absence of a marker).
 */
export const selectNextTask = (lines: readonly BacklogLine[], states: ReadonlyMap<string, TaskState>): BacklogLine | undefined =>
  lines.find((line) => !line.checked && !line.marker && !ACTIVE_STATES.has(states.get(line.id)?.status ?? ""))

/** Render one line with an updated marker (and checkbox for terminal-done states). */
export const renderLine = (line: BacklogLine, status: string, id: string, done: boolean): string => {
  const match = CHECKBOX.exec(line.raw)
  if (!match) return line.raw
  const indent = match[1] ?? ""
  const open = match[2] ?? "- ["
  const close = match[4] ?? "] "
  const body = (match[5] ?? "").replace(MARKER, "").trim()
  const check = done ? "x" : " "
  return `${indent}${open}${check}${close}${body} <!-- prompter: ${status} id=${id} -->`
}

/** Replace a single line's text in the full backlog. */
export const writeLineStatus = (text: string, line: BacklogLine, status: string, id: string, done: boolean): string => {
  const lines = text.split("\n")
  if (line.index < 0 || line.index >= lines.length) return text
  lines[line.index] = renderLine(line, status, id, done)
  return lines.join("\n")
}

/** Human-readable summary used by `prompter status`. */
export const summarizeBacklog = (lines: readonly BacklogLine[], states: ReadonlyMap<string, TaskState>): string => {
  const rows = lines.map((line) => {
    const state = states.get(line.id)
    const status = line.checked ? "done" : (state?.status ?? line.marker?.status ?? "todo")
    return `- [${status}] ${line.id}  ${line.objective}`
  })
  return rows.length > 0 ? rows.join("\n") : "(no tasks in backlog)"
}
