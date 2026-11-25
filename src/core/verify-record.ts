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
import type { GoalSnapshot } from "./types.ts"
import { recordAckSegment, recordSummaryLine, renderRecordReport, sweepRecordMentions } from "./record-attestation.ts"
import type { RecordCheckShape } from "./record-attestation.ts"
export { recordShaMentions } from "./record-attestation.ts"

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

type RecordCheck = RecordCheckShape<RecordCheckStatus>

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

/** Sweeps the record's quoted shas against the probe. Pure: the probe is injected, the sweep never throws. */
export function verifyRecord(goal: GoalSnapshot, probe: RecordProbe): RecordVerification {
  const swept = sweepRecordMentions<RecordCheckStatus>(goal, probe, "present", "missing")
  return {
    checks: swept.checks,
    unique: swept.unique,
    mentions: swept.mentions,
    present: swept.positive,
    missing: swept.negative,
    unknown: swept.unknown,
  }
}

/**
 * The verification report as Markdown — freshly generated, self-describing, and safe to hand to a
 * reviewer. Carries the generation time and the probed directory so a stale copy cannot masquerade
 * as a live check; the honesty footer states exactly what a resolving or unresolvable sha does and
 * does not prove.
 */
export function verifyReportMarkdown(goal: GoalSnapshot, verification: RecordVerification, nowMs: number, directory: string): string {
  return renderRecordReport(
    goal,
    verification,
    {
      title: "# /goal-loop record verification",
      columnHeader: "resolves",
      countsLine: `- Present: ${verification.present} · missing: ${verification.missing} · unknown: ${verification.unknown}`,
      footer: "Existence is not ancestry: a sha that resolves here may still belong to a rewritten history elsewhere. A sha that does not resolve is an unresolvable receipt, not proof of misconduct — the record says what HEAD was, this report says what the repository still holds. Unknown means git could not answer (no binary, not a repository, timed out) — never counted as missing. Existence is checked at the directory named above, at generation time, and says nothing about the working tree's cleanliness.",
      positive: "present",
      negative: "missing",
    },
    nowMs,
    directory,
  )
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function verifySummaryLine(verification: RecordVerification): string {
  return recordSummaryLine(
    {
      unique: verification.unique,
      positive: verification.present,
      negative: verification.missing,
      unknown: verification.unknown,
    },
    {
      none: "record quotes no shas to verify",
      success: (v) => `record verifies: ${v.positive} of ${v.unique} shas resolve`,
      failure: (v) => `record does not verify: ${v.negative} of ${v.unique} shas unresolvable`,
      unknown: (v) => `record unverifiable: ${v.unknown} of ${v.unique} shas could not be checked`,
    },
  )
}

/**
 * The compact ack segment appended to the dossier's verify row (` ✓ 6/6 resolve` / ` - 2 of 6 unresolvable`
 * / ` ! 2 of 6 unknown`). ascii demotes the check glyph to `+` and the cross to `-`; `!` survives both arms.
 * The leading space matches the other rows' suffix grammar. A record with no quoted shas says so, never fabricates a pass.
 */
export function verifyAckSegment(verification: Pick<RecordVerification, "unique" | "present" | "missing" | "unknown">, ascii: boolean): string {
  return recordAckSegment(
    {
      unique: verification.unique,
      positive: verification.present,
      negative: verification.missing,
      unknown: verification.unknown,
    },
    ascii,
    {
      noneAscii: " (no shas)",
      noneUnicode: " (no shas to verify)",
      negative: "unresolvable",
      unknown: "unknown",
      positive: "resolve",
    },
  )
}

/** The shape the host hands back to the dossier row's in-place acknowledgment (and the dialog needs nothing else — the counts are the whole truth of the click). */
export type VerifyOutcome = Pick<RecordVerification, "unique" | "present" | "missing" | "unknown">
