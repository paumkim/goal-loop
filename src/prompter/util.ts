import { parseBool } from "../core/parse.ts"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

export const nowIso = (): string => new Date().toISOString()

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

export const shortId = (objective: string): string => sha256(objective.trim()).slice(0, 12)

export const prompterHome = (): string => process.env.PROMPTER_HOME?.trim() || path.join(os.homedir(), ".prompter")

export const repoHash = (repo: string): string => sha256(path.resolve(repo)).slice(0, 12)

export const statePath = (repo: string): string => path.join(prompterHome(), "state", `${repoHash(repo)}.jsonl`)

export const worktreeRoot = (repo: string): string => path.join(prompterHome(), "worktrees", repoHash(repo))

export const logPath = (repo: string): string => path.join(prompterHome(), "log", `${repoHash(repo)}.log`)

export const globalStopFile = (): string => path.join(prompterHome(), "STOP")

export const localStopFile = (repo: string): string => path.join(repo, ".prompter", "STOP")

/** "provider/model" -> { providerID, modelID }. The model id may itself contain slashes. */
export const parseModel = (value: string): { providerID: string; modelID: string } => {
  const slash = value.indexOf("/")
  if (slash <= 0) throw new Error(`model must be "provider/model" (got "${value}")`)
  const providerID = value.slice(0, slash)
  const modelID = value.slice(slash + 1)
  if (!providerID || !modelID || /\s/.test(value)) throw new Error(`model must be "provider/model" (got "${value}")`)
  return { providerID, modelID }
}

export const intFrom = (value: unknown, fallback: number, min: number, max: number): number => {
  if (value === undefined || value === null || value === "") return fallback
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(n)) throw new Error(`expected an integer, got ${JSON.stringify(value)}`)
  const clamped = Math.min(max, Math.max(min, Math.trunc(n)))
  return clamped
}

export const numberFrom = (value: unknown, fallback: number, min: number, max: number): number => {
  if (value === undefined || value === null || value === "") return fallback
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) throw new Error(`expected a number, got ${JSON.stringify(value)}`)
  return Math.min(max, Math.max(min, n))
}

export const strFrom = (value: unknown, fallback: string): string => {
  if (value === undefined || value === null) return fallback
  const s = String(value).trim()
  return s.length > 0 ? s : fallback
}

export const boolFrom = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  // String() preserves the CLI's coercion of numbers/boxed values; parseBool owns only the spellings.
  const parsed = parseBool(String(value))
  if (parsed === undefined) throw new Error(`expected a boolean, got ${JSON.stringify(value)}`)
  return parsed
}

export const money = (value: number): string => `$${value.toFixed(2)}`

export const short = (value: string, max = 140): string => {
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}
