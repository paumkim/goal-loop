/**
 * The dossier's shas, on this line. `goal.dossier.reach` (palette) and the dossier view's reach row
 * ask one question of every sha the record quotes: is it an ancestor of HEAD at the host's cwd —
 * i.e. does the history this session was built on actually carry the work the record attests?
 * EC answered whether the objects still resolve; this module answers whether they belong to this
 * line of history. Not a new document: a report over the existing one, same generation discipline.
 *
 * Honesty rules, same as the rest of the plugin:
 *   - Only the sha strings the record actually quotes (the loop ledger's per-iteration shas, oldest
 *     first) are checked. Deduplicated by sha; the iterations that quote each sha are listed.
 *   - A probe that cannot answer is `unknown`, never folded into `no`. "git could not run" (no binary,
 *     not a repository, unparseable sha, timed out) is categorically different from "git ran and this
 *     sha does not belong to this history" (exit 1). Unknown is reported as unknown.
 *   - A probe that throws is treated as `unknown` for that sha; one bad row never sinks the sweep.
 *   - "Not on this line" is not misconduct. A quoted sha may live on another branch, may have been
 *     rebased away, or the record may predate the merge that carried it. Unreached is information,
 *     not accusation; the report says exactly that and no more.
 *   - Existence is not ancestry — the EC footer said so, and this report exists to answer the other
 *     half. A sha that resolves here may still not belong to this history; a sha that does not belong
 *     may still resolve. The two reports are complementary, never substitutes.
 *   - The report is freshly generated on every invocation — generation time and the probed directory
 *     are printed so a stale copy cannot masquerade as a live check.
 */
import { execFileSync } from "node:child_process"
import { shortSha } from "./dossier.ts"
import { recordShaMentions } from "./verify-record.ts"
import type { GoalSnapshot } from "./types.ts"

/** The probe contract: true = an ancestor of HEAD at the probed directory, false = git answered and it is not, "unknown" = git could not answer. */
export type ReachProbe = (sha: string) => boolean | "unknown"

export const REACH_TIMEOUT_MS = 10_000

/**
 * The real probe: one `git merge-base --is-ancestor <sha> HEAD` per sha. Numeric exit 0 means yes,
 * exit 1 means git answered no, and every other outcome — exit ≥ 2 (including 128 for a sha git
 * cannot parse), a spawn failure, or a timeout — means git could not answer. A non-hex or missing
 * sha therefore reads `unknown`, never `no`: we cannot tell "not on this line" from "not a sha".
 */
export function gitAncestorProbe(cwd: string): ReachProbe {
  return (sha: string): boolean | "unknown" => {
    try {
      execFileSync("git", ["-C", cwd, "merge-base", "--is-ancestor", sha, "HEAD"], { stdio: "ignore", timeout: REACH_TIMEOUT_MS })
      return true
    } catch (error) {
      const status = (error as { status?: number | null } | undefined)?.status
      if (status === 0) return true
      if (status === 1) return false
      return "unknown"
    }
  }
}

export type ReachCheckStatus = "ancestor" | "unreached" | "unknown"

export interface ReachCheck {
  readonly sha: string
  readonly shortSha: string
  /** 1-based loop iterations that quote this sha (oldest first). */
  readonly iterations: readonly number[]
  readonly status: ReachCheckStatus
}

export interface ReachVerification {
  readonly checks: readonly ReachCheck[]
  /** Unique shas the record quotes. */
  readonly unique: number
  /** Total mentions across all iterations. */
  readonly mentions: number
  readonly ancestors: number
  readonly unreached: number
  readonly unknown: number
}

/** Sweeps the record's quoted shas against the probe. Pure: the probe is injected, the sweep never throws. */
export function reachRecord(goal: GoalSnapshot, probe: ReachProbe): ReachVerification {
  const checks = recordShaMentions(goal).map((m): ReachCheck => {
    let answer: boolean | "unknown"
    try {
      answer = probe(m.sha)
    } catch {
      answer = "unknown"
    }
    const status: ReachCheckStatus = answer === true ? "ancestor" : answer === false ? "unreached" : "unknown"
    return { sha: m.sha, shortSha: shortSha(m.sha), iterations: m.iterations, status }
  })
  let ancestors = 0
  let unreached = 0
  let unknown = 0
  let mentions = 0
  for (const check of checks) {
    if (check.status === "ancestor") ancestors += 1
    else if (check.status === "unreached") unreached += 1
    else unknown += 1
    mentions += check.iterations.length
  }
  return { checks, unique: checks.length, mentions, ancestors, unreached, unknown }
}

const iterationList = (iterations: readonly number[]): string => iterations.map((v) => `v${v}`).join(", ")

const GAP = "—"

const statusCell = (status: ReachCheckStatus): string =>
  status === "ancestor" ? "yes" : status === "unreached" ? "no" : "unknown"

/**
 * The ancestry report as Markdown — freshly generated, self-describing, safe to hand to a reviewer.
 * Carries the generation time and the probed directory so a stale copy cannot masquerade as a live
 * check; the honesty footer states exactly what "not on this line" does and does not imply.
 */
export function reachReportMarkdown(goal: GoalSnapshot, reach: ReachVerification, nowMs: number, directory: string): string {
  const stamp = new Date(Number.isFinite(nowMs) ? nowMs : 0).toISOString()
  const condition = (goal.condition ?? "").replace(/\s+/g, " ").trim()
  const conditionCell = condition.length > 200 ? `${condition.slice(0, 200)}…` : condition || GAP
  const lines: string[] = [
    "# /goal-loop record ancestry",
    "",
    `- Generated: ${stamp}`,
    `- Repository: ${directory}`,
    `- Condition: ${conditionCell}`,
    `- Shas quoted by the record: ${reach.unique} unique across ${reach.mentions} mention${reach.mentions === 1 ? "" : "s"}`,
    "",
    "| sha | quoted at | on this line |",
    "| --- | --- | --- |",
  ]
  for (const check of reach.checks) {
    lines.push(`| ${check.shortSha} | ${iterationList(check.iterations)} | ${statusCell(check.status)} |`)
  }
  if (reach.checks.length === 0) lines.push("| — | — | — |")
  lines.push(
    "",
    `- On this line (ancestor of HEAD): ${reach.ancestors} · not on this line: ${reach.unreached} · unknown: ${reach.unknown}`,
    "",
    "Not on this line is not misconduct: the sha may live on another branch, may have been rebased away, or this record may predate the merge that carried it. Existence is not ancestry, and ancestry is not content — a sha that belongs to this history may still carry a tree you have not read, and a sha that resolves here may still belong elsewhere. This report asks one question, per sha, of the repository at the directory named above, at generation time, and says nothing about which ref the work landed on, signatures, the working tree's cleanliness, or the content of any commit. Unknown means git could not answer (no binary, not a repository, unparseable sha, timed out) — never counted as “no”.",
    "",
  )
  return lines.join("\n")
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function reachSummaryLine(reach: ReachVerification): string {
  if (reach.unique === 0) return "record quotes no shas to place on this line"
  if (reach.unreached === 0 && reach.unknown === 0)
    return `record reaches HEAD: ${reach.ancestors} of ${reach.unique} shas on this line`
  if (reach.unreached > 0)
    return `record does not reach HEAD: ${reach.unreached} of ${reach.unique} shas not on this line`
  return `record unverifiable: ${reach.unknown} of ${reach.unique} shas could not be placed`
}

/**
 * The compact ack segment appended to the dossier's reach row (` ✓ 6/6 on this line` / ` - 2 of 6 not on this line`
 * / ` ! 2 of 6 unknown`). ascii demotes the check glyph to `+` and the cross to `-`; `!` survives both arms.
 * The leading space matches the other rows' suffix grammar. A record with no quoted shas says so, never fabricates a pass.
 */
export function reachAckSegment(reach: Pick<ReachVerification, "unique" | "ancestors" | "unreached" | "unknown">, ascii: boolean): string {
  const ok = ascii ? "+" : "✓"
  const bad = ascii ? "-" : "✗"
  if (reach.unique === 0) return ascii ? " (no shas)" : " (no shas to place)"
  if (reach.unreached > 0) return ` (${bad} ${reach.unreached} of ${reach.unique} not on this line)`
  if (reach.unknown > 0) return ` (! ${reach.unknown} of ${reach.unique} unknown)`
  return ` (${ok} ${reach.ancestors}/${reach.unique} on this line)`
}

/** The shape the host hands back to the dossier row's in-place acknowledgment (and the dialog needs nothing else — the counts are the whole truth of the click). */
export type ReachOutcome = Pick<ReachVerification, "unique" | "ancestors" | "unreached" | "unknown">
