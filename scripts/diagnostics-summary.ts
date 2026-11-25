#!/usr/bin/env bun
/**
 * diagnostics-summary: read-only report over .term/goal-loop/diagnostics/*.json.
 *
 * Every repeated-failure escalation persists an artifact there. This turns the raw trail into the
 * recurring patterns it contains: how many artifacts, which signatures/streak counts recur, which
 * conditions and verdict reasons dominate, and how recent the trail is. It never writes and never
 * deletes — the artifacts stay the durable evidence behind the report.
 *
 * Usage: bun scripts/diagnostics-summary.ts [directory]
 *   Defaults to <repo>/ .term/goal-loop/diagnostics (repo root inferred from this script's location).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export interface DiagnosticArtifact {
  readonly signature?: string
  readonly count?: number
  readonly kind?: string
  readonly verdictReason?: string
  readonly condition?: string
  readonly at?: string
  readonly turn?: number
  readonly sessionID?: string
}

export interface PatternRow {
  readonly key: string
  readonly count: number
}

export interface DiagnosticsSummary {
  readonly total: number
  readonly kinds: readonly PatternRow[]
  readonly signatures: readonly PatternRow[]
  readonly conditions: readonly PatternRow[]
  readonly reasons: readonly PatternRow[]
  readonly latestAt?: string
}

const TOP = 10

/** Empty for a missing directory. Unparseable files are skipped: one bad artifact must not hide the rest. */
export function loadArtifacts(dir: string): DiagnosticArtifact[] {
  if (!existsSync(dir)) return []
  const out: DiagnosticArtifact[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    try {
      const value: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"))
      if (value !== null && typeof value === "object" && !Array.isArray(value)) out.push(value as DiagnosticArtifact)
    } catch {
      // A truncated or hand-edited artifact is not a pattern; skip it.
    }
  }
  return out
}

function tally(values: readonly (string | undefined)[]): PatternRow[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = (value ?? "").trim()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** Group by a stable key so repeated escalations collapse into one row with their file count. */
export function summarizeArtifacts(artifacts: readonly DiagnosticArtifact[]): DiagnosticsSummary {
  const latest = artifacts.map((a) => a.at ?? "").filter(Boolean).sort().at(-1)
  return {
    total: artifacts.length,
    kinds: tally(artifacts.map((a) => a.kind)),
    signatures: tally(artifacts.map((a) => a.signature)),
    conditions: tally(artifacts.map((a) => a.condition)),
    reasons: tally(artifacts.map((a) => a.verdictReason)),
    ...(latest ? { latestAt: latest } : {}),
  }
}

function formatRows(title: string, rows: readonly PatternRow[]): string[] {
  if (!rows.length) return []
  const lines = [`${title}:`]
  for (const { key, count } of rows.slice(0, TOP)) lines.push(`  ${String(count).padStart(4)}  ${key}`)
  if (rows.length > TOP) lines.push(`  ... ${rows.length - TOP} more`)
  return lines
}

export function formatSummary(summary: DiagnosticsSummary, dir: string): string {
  const lines = [
    `diagnostics: ${dir}`,
    `artifacts: ${summary.total}${summary.total === 0 ? " — no repeated-failure diagnostics recorded" : ""}`,
  ]
  if (!summary.total) return lines.join("\n")
  lines.push(...formatRows("by kind", summary.kinds), ...formatRows("top signatures", summary.signatures))
  lines.push(...formatRows("top conditions", summary.conditions), ...formatRows("top verdict reasons", summary.reasons))
  if (summary.latestAt) lines.push(`latest: ${summary.latestAt}`)
  return lines.join("\n")
}

function main(): void {
  const dir = process.argv[2] ?? join(import.meta.dir, "..", ".term", "goal-loop", "diagnostics")
  process.stdout.write(formatSummary(summarizeArtifacts(loadArtifacts(dir)), dir) + "\n")
}

if (import.meta.main) main()
