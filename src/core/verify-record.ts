/**
 * The dossier's shas, answered. `goal.dossier.verify` (palette) and the dossier view's verify row
 * re-check every sha the record quotes against the repository at the host's cwd — the same property
 * the loop's own evaluator demands of its evidence (fresh output at current HEAD, not narration),
 * applied to the record as a whole. Not a new document: a report over the existing one.
 *
 * Honesty rules, same as the rest of the plugin:
 *   - Only the sha strings the record actually quotes (the loop ledger's per-iteration shas, oldest
 *     first) are checked. Deduplicated by sha, never by meaning; the iterations that quote each sha
 *     are listed, because the same HEAD quotes differently across iterations.
 *   - A probe that cannot answer is `unknown`, never `missing`. "git could not run" (no binary, not a
 *     repository, timed out) is categorically different from "git ran and the object does not resolve".
 *     Unknown is reported as unknown and never folded into either bucket.
 *   - A probe that throws is treated as `unknown` for that sha; one bad row never sinks the sweep.
 *   - Existence is not ancestry. A sha that resolves here may still belong to a rewritten history;
 *     a sha that does not resolve is an unresolvable receipt, not proof of misconduct. The report says
 *     what the repository still holds, nothing more.
 *   - The report is freshly generated on every invocation — it carries the generation time and the
 *     directory that was probed, so a stale copy can never masquerade as a live check.
 */
import { execFileSync } from "node:child_process"
import { conditionCellOf, shortSha, stampOf , recordStatusCell } from "./dossier.ts"
import type { GoalSnapshot } from "./types.ts"

/** The probe contract: true = the object exists, false = git answered and it does not, "unknown" = git could not answer. */
export type RecordProbe = (sha: string) => boolean | "unknown"

const GIT_TIMEOUT_MS = 10_000

/**
 * The real probe: one `git cat-file -e` per sha. The record holds a handful of shas; one process each
 * keeps the probe synchronous, synchronous callers happy, and the failure taxonomy trivial — a numeric
 * exit status means git answered (0 exists, anything else does not resolve, including a non-hex sha);
 * a spawn failure or a timeout means git could not answer at all and the row is `unknown`.
 */
export function gitCatFileProbe(cwd: string): RecordProbe {
  return (sha: string): boolean | "unknown" => {
    try {
      execFileSync("git", ["-C", cwd, "cat-file", "-e", sha], { stdio: "ignore", timeout: GIT_TIMEOUT_MS })
      return true
    } catch (error) {
      const status = (error as { status?: number | null } | undefined)?.status
      if (typeof status === "number") return false
      return "unknown"
    }
  }
}

type RecordCheckStatus = "present" | "missing" | "unknown"

interface RecordCheck {
  readonly sha: string
  readonly shortSha: string
  /** 1-based loop iterations that quote this sha (oldest first). */
  readonly iterations: readonly number[]
  readonly status: RecordCheckStatus
}

export interface RecordVerification {
  readonly checks: readonly RecordCheck[]
  /** Unique shas the record quotes. */
  readonly unique: number
  /** Total mentions across all iterations (unique shas can be > 0 mentions apart). */
  readonly mentions: number
  readonly present: number
  readonly missing: number
  readonly unknown: number
}

/** The shas the record quotes, in first-appearance order, with the iterations that quote each. */
export function recordShaMentions(goal: GoalSnapshot): { readonly sha: string; readonly iterations: number[] }[] {
  const mentions: { sha: string; iterations: number[] }[] = []
  const index = new Map<string, number>()
  for (const entry of goal.loopHistory ?? []) {
    const sha = typeof entry.sha === "string" ? entry.sha.trim() : ""
    if (!sha) continue
    const at = index.get(sha)
    if (at !== undefined) {
      mentions[at]!.iterations.push(entry.version)
      continue
    }
    index.set(sha, mentions.length)
    mentions.push({ sha, iterations: [entry.version] })
  }
  return mentions
}

/** Sweeps the record's quoted shas against the probe. Pure: the probe is injected, the sweep never throws. */
export function verifyRecord(goal: GoalSnapshot, probe: RecordProbe): RecordVerification {
  const checks = recordShaMentions(goal).map((m): RecordCheck => {
    let answer: boolean | "unknown"
    try {
      answer = probe(m.sha)
    } catch {
      answer = "unknown"
    }
    const status: RecordCheckStatus = answer === true ? "present" : answer === false ? "missing" : "unknown"
    return { sha: m.sha, shortSha: shortSha(m.sha), iterations: m.iterations, status }
  })
  let present = 0
  let missing = 0
  let unknown = 0
  let mentions = 0
  for (const check of checks) {
    if (check.status === "present") present += 1
    else if (check.status === "missing") missing += 1
    else unknown += 1
    mentions += check.iterations.length
  }
  return { checks, unique: checks.length, mentions, present, missing, unknown }
}

const iterationList = (iterations: readonly number[]): string => iterations.map((v) => `v${v}`).join(", ")


const statusCell = (status: string): string => recordStatusCell(status, "present", "missing")

/**
 * The verification report as Markdown — freshly generated, self-describing, and safe to hand to a
 * reviewer. Carries the generation time and the probed directory so a stale copy cannot masquerade
 * as a live check; the honesty footer states exactly what a resolving or unresolvable sha does and
 * does not prove.
 */
export function verifyReportMarkdown(goal: GoalSnapshot, verification: RecordVerification, nowMs: number, directory: string): string {
  const stamp = stampOf(nowMs)
  const conditionCell = conditionCellOf(goal.condition)
  const lines: string[] = [
    "# /goal-loop record verification",
    "",
    `- Generated: ${stamp}`,
    `- Repository: ${directory}`,
    `- Condition: ${conditionCell}`,
    `- Shas quoted by the record: ${verification.unique} unique across ${verification.mentions} mention${verification.mentions === 1 ? "" : "s"}`,
    "",
    "| sha | quoted at | resolves |",
    "| --- | --- | --- |",
  ]
  for (const check of verification.checks) {
    lines.push(`| ${check.shortSha} | ${iterationList(check.iterations)} | ${statusCell(check.status)} |`)
  }
  if (verification.checks.length === 0) lines.push("| — | — | — |")
  lines.push(
    "",
    `- Present: ${verification.present} · missing: ${verification.missing} · unknown: ${verification.unknown}`,
    "",
    "Existence is not ancestry: a sha that resolves here may still belong to a rewritten history elsewhere. A sha that does not resolve is an unresolvable receipt, not proof of misconduct — the record says what HEAD was, this report says what the repository still holds. Unknown means git could not answer (no binary, not a repository, timed out) — never counted as missing. Existence is checked at the directory named above, at generation time, and says nothing about the working tree's cleanliness.",
    "",
  )
  return lines.join("\n")
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function verifySummaryLine(verification: RecordVerification): string {
  if (verification.unique === 0) return "record quotes no shas to verify"
  if (verification.missing === 0 && verification.unknown === 0)
    return `record verifies: ${verification.present} of ${verification.unique} shas resolve`
  if (verification.missing > 0)
    return `record does not verify: ${verification.missing} of ${verification.unique} shas unresolvable`
  return `record unverifiable: ${verification.unknown} of ${verification.unique} shas could not be checked`
}

/**
 * The compact ack segment appended to the dossier's verify row (` ✓ 6/6 resolve` / ` - 2 of 6 unresolvable`
 * / ` ! 2 of 6 unknown`). ascii demotes the check glyph to `+` and the cross to `-`; `!` survives both arms.
 * The leading space matches the other rows' suffix grammar. A record with no quoted shas says so, never fabricates a pass.
 */
export function verifyAckSegment(verification: Pick<RecordVerification, "unique" | "present" | "missing" | "unknown">, ascii: boolean): string {
  const ok = ascii ? "+" : "✓"
  const bad = ascii ? "-" : "✗"
  if (verification.unique === 0) return ascii ? " (no shas)" : " (no shas to verify)"
  if (verification.missing > 0) return ` (${bad} ${verification.missing} of ${verification.unique} unresolvable)`
  if (verification.unknown > 0) return ` (! ${verification.unknown} of ${verification.unique} unknown)`
  return ` (${ok} ${verification.present}/${verification.unique} resolve)`
}

/** The shape the host hands back to the dossier row's in-place acknowledgment (and the dialog needs nothing else — the counts are the whole truth of the click). */
export type VerifyOutcome = Pick<RecordVerification, "unique" | "present" | "missing" | "unknown">
