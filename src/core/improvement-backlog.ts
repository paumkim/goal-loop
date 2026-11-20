/**
 * Persistent improvement backlog for autonomous "keep improving" loops.
 *
 * The backlog is a machine-readable ledger of findings and planned improvements
 * (impact, risk, evidence, status, dedupe keys). It gives the planner a durable
 * source of truth so prioritization is not rebuilt from summaries each iteration
 * and completed work can be de-duplicated against history.
 *
 * Pure data helpers only: no I/O, no side effects.
 */

export type ImprovementImpact = "low" | "medium" | "high"
export type ImprovementRisk = "low" | "medium" | "high"
export type ImprovementStatus = "open" | "in_progress" | "blocked" | "deferred" | "done"

export interface ImprovementBacklogItem {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly priority: number
  readonly impact: ImprovementImpact
  readonly risk: ImprovementRisk
  readonly status: ImprovementStatus
  readonly finding: string
  readonly improvement: string
  readonly evidence: readonly string[]
  readonly dedupeKeys: readonly string[]
  readonly related?: readonly string[]
  readonly owner?: string
  readonly createdAt?: string
  readonly updatedAt?: string
}

export interface ImprovementBacklog {
  readonly version: number
  readonly updatedAt?: string
  readonly description?: string
  readonly items: readonly ImprovementBacklogItem[]
}

export interface BacklogValidationIssue {
  readonly path: string
  readonly message: string
}

export interface BacklogValidationResult {
  readonly ok: boolean
  readonly issues: readonly BacklogValidationIssue[]
}

export interface DedupeMatch {
  readonly left: string
  readonly right: string
  readonly reason: "id" | "dedupeKey"
  readonly key: string
}

interface NextItemOptions {
  /** Statuses considered selectable. Defaults to ["open"]. */
  readonly statuses?: readonly ImprovementStatus[]
  /** IDs to treat as already satisfied (e.g. completed conditions/history). */
  readonly completedIds?: readonly string[]
  /** Normalized dedupe keys already satisfied. */
  readonly completedDedupeKeys?: readonly string[]
}

const IMPACTS = new Set<ImprovementImpact>(["low", "medium", "high"])
const RISKS = new Set<ImprovementRisk>(["low", "medium", "high"])
const STATUSES = new Set<ImprovementStatus>(["open", "in_progress", "blocked", "deferred", "done"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function push(issues: BacklogValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

/** Normalize a dedupe key for stable comparison (lowercase, trim, collapse separators). */
export function normalizeDedupeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Parse/validate an unknown value as an ImprovementBacklog. */
export function validateImprovementBacklog(value: unknown): BacklogValidationResult {
  const issues: BacklogValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", message: "backlog must be an object" }] }
  }
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) {
    push(issues, "$.version", "version must be a positive integer")
  }
  if (value.updatedAt !== undefined && typeof value.updatedAt !== "string") {
    push(issues, "$.updatedAt", "updatedAt must be a string when present")
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    push(issues, "$.description", "description must be a string when present")
  }
  if (!Array.isArray(value.items)) {
    push(issues, "$.items", "items must be an array")
    return { ok: false, issues }
  }

  const seenIds = new Set<string>()
  value.items.forEach((item, index) => {
    const base = `$.items[${index}]`
    if (!isRecord(item)) {
      push(issues, base, "item must be an object")
      return
    }
    const id = typeof item.id === "string" ? item.id.trim() : ""
    if (!id) push(issues, `${base}.id`, "id must be a non-empty string")
    else if (seenIds.has(id)) push(issues, `${base}.id`, `duplicate id '${id}'`)
    else seenIds.add(id)

    if (typeof item.title !== "string" || !item.title.trim()) push(issues, `${base}.title`, "title must be a non-empty string")
    if (typeof item.category !== "string" || !item.category.trim()) push(issues, `${base}.category`, "category must be a non-empty string")
    if (typeof item.priority !== "number" || !Number.isFinite(item.priority)) {
      push(issues, `${base}.priority`, "priority must be a finite number")
    }
    if (!IMPACTS.has(item.impact as ImprovementImpact)) push(issues, `${base}.impact`, "impact must be low, medium, or high")
    if (!RISKS.has(item.risk as ImprovementRisk)) push(issues, `${base}.risk`, "risk must be low, medium, or high")
    if (!STATUSES.has(item.status as ImprovementStatus)) {
      push(issues, `${base}.status`, "status must be open, in_progress, blocked, deferred, or done")
    }
    if (typeof item.finding !== "string" || !item.finding.trim()) push(issues, `${base}.finding`, "finding must be a non-empty string")
    if (typeof item.improvement !== "string" || !item.improvement.trim()) {
      push(issues, `${base}.improvement`, "improvement must be a non-empty string")
    }
    if (!isStringArray(item.evidence)) push(issues, `${base}.evidence`, "evidence must be an array of strings")
    if (!isStringArray(item.dedupeKeys)) push(issues, `${base}.dedupeKeys`, "dedupeKeys must be an array of strings")
    if (item.related !== undefined && !isStringArray(item.related)) push(issues, `${base}.related`, "related must be an array of strings when present")
    if (item.owner !== undefined && typeof item.owner !== "string") push(issues, `${base}.owner`, "owner must be a string when present")
    if (item.createdAt !== undefined && typeof item.createdAt !== "string") push(issues, `${base}.createdAt`, "createdAt must be a string when present")
    if (item.updatedAt !== undefined && typeof item.updatedAt !== "string") push(issues, `${base}.updatedAt`, "updatedAt must be a string when present")
  })

  return { ok: issues.length === 0, issues }
}

/** Parse JSON text into a validated backlog. Throws with details on invalid input. */
export function parseImprovementBacklog(text: string): ImprovementBacklog {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`improvement backlog is not valid JSON: ${message}`)
  }
  const result = validateImprovementBacklog(value)
  if (!result.ok) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
    throw new Error(`invalid improvement backlog: ${detail}`)
  }
  return value as ImprovementBacklog
}

/** Find duplicate items by id is already caught by validation; this finds dedupeKey collisions. */
export function findBacklogDedupeMatches(items: readonly ImprovementBacklogItem[]): readonly DedupeMatch[] {
  const matches: DedupeMatch[] = []
  const byKey = new Map<string, string>()
  for (const item of items) {
    const keys = new Set<string>([item.id, ...item.dedupeKeys].map(normalizeDedupeKey).filter(Boolean))
    for (const key of keys) {
      const existing = byKey.get(key)
      if (existing && existing !== item.id) {
        matches.push({ left: existing, right: item.id, reason: key === normalizeDedupeKey(item.id) ? "id" : "dedupeKey", key })
      } else {
        byKey.set(key, item.id)
      }
    }
  }
  return matches
}

function impactWeight(impact: ImprovementImpact): number {
  switch (impact) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
  }
}

function riskPenalty(risk: ImprovementRisk): number {
  switch (risk) {
    case "high":
      return 0.3
    case "medium":
      return 0.15
    case "low":
      return 0
  }
}

/**
 * Rank open/selectable items: lower priority number first, then higher impact,
 * then lower risk, then stable id. Excludes done/deferred/blocked by default
 * and excludes items whose id or any normalized dedupe key is already completed.
 */
export function selectNextBacklogItem(
  items: readonly ImprovementBacklogItem[],
  opts: NextItemOptions = {},
): ImprovementBacklogItem | undefined {
  const statuses = new Set(opts.statuses ?? ["open"])
  const completedIds = new Set((opts.completedIds ?? []).map((id) => id.trim()).filter(Boolean))
  const completedKeys = new Set((opts.completedDedupeKeys ?? []).map(normalizeDedupeKey).filter(Boolean))

  const candidates = items.filter((item) => {
    if (!statuses.has(item.status)) return false
    if (completedIds.has(item.id)) return false
    const keys = [item.id, ...item.dedupeKeys].map(normalizeDedupeKey).filter(Boolean)
    return !keys.some((key) => completedKeys.has(key))
  })

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const impactDelta = impactWeight(b.impact) - impactWeight(a.impact)
    if (impactDelta !== 0) return impactDelta
    const riskDelta = riskPenalty(a.risk) - riskPenalty(b.risk)
    if (riskDelta !== 0) return riskDelta
    return a.id.localeCompare(b.id)
  })

  return candidates[0]
}

/** Convenience: parse and also report dedupe collisions (not fatal by themselves). */
export function inspectImprovementBacklog(text: string): {
  readonly backlog: ImprovementBacklog
  readonly validation: BacklogValidationResult
  readonly dedupeMatches: readonly DedupeMatch[]
} {
  const backlog = parseImprovementBacklog(text)
  const validation = validateImprovementBacklog(backlog)
  const dedupeMatches = findBacklogDedupeMatches(backlog.items)
  return { backlog, validation, dedupeMatches }
}
