import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import type { TaskState } from "./types.ts"

/** Reduce the append-only journal to the latest record per id. */
export const reduceJournal = (text: string): Map<string, TaskState> => {
  const map = new Map<string, TaskState>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line) as TaskState
      if (record && typeof record.id === "string" && typeof record.status === "string") {
        map.set(record.id, record)
      }
    } catch {
      // A torn last line from a crash is ignored; earlier records stay intact.
    }
  }
  return map
}

export const loadState = (stateFile: string): Map<string, TaskState> => {
  if (!existsSync(stateFile)) return new Map()
  return reduceJournal(readFileSync(stateFile, "utf8"))
}

/** Append one record. Append-only is crash-safe: a partial tail never corrupts earlier records. */
export const appendState = (stateFile: string, record: TaskState): void => {
  mkdirSync(path.dirname(stateFile), { recursive: true })
  appendFileSync(stateFile, `${JSON.stringify(record)}\n`, "utf8")
}

export const byStatus = (states: ReadonlyMap<string, TaskState>, status: string): TaskState[] =>
  [...states.values()].filter((s) => s.status === status)
