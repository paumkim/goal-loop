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
import type { GoalSnapshot } from "./types.ts"
import { recordAckSegment, recordSummaryLine, renderRecordReport, sweepRecordMentions } from "./record-attestation.ts"
import type { RecordCheckShape } from "./record-attestation.ts"

/** The probe contract: true = an ancestor of HEAD at the probed directory, false = git answered and it is not, "unknown" = git could not answer. */
export type ReachProbe = (sha: string) => boolean | "unknown"

const REACH_TIMEOUT_MS = 10_000

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

type ReachCheckStatus = "ancestor" | "unreached" | "unknown"

type ReachCheck = RecordCheckShape<ReachCheckStatus>

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
  const swept = sweepRecordMentions<ReachCheckStatus>(goal, probe, "ancestor", "unreached")
  return {
    checks: swept.checks,
    unique: swept.unique,
    mentions: swept.mentions,
    ancestors: swept.positive,
    unreached: swept.negative,
    unknown: swept.unknown,
  }
}

/**
 * The ancestry report as Markdown — freshly generated, self-describing, safe to hand to a reviewer.
 * Carries the generation time and the probed directory so a stale copy cannot masquerade as a live
 * check; the honesty footer states exactly what "not on this line" does and does not imply.
 */
export function reachReportMarkdown(goal: GoalSnapshot, reach: ReachVerification, nowMs: number, directory: string): string {
  return renderRecordReport(
    goal,
    reach,
    {
      title: "# /goal-loop record ancestry",
      columnHeader: "on this line",
      countsLine: `- On this line (ancestor of HEAD): ${reach.ancestors} · not on this line: ${reach.unreached} · unknown: ${reach.unknown}`,
      footer: "Not on this line is not misconduct: the sha may live on another branch, may have been rebased away, or this record may predate the merge that carried it. Existence is not ancestry, and ancestry is not content — a sha that belongs to this history may still carry a tree you have not read, and a sha that resolves here may still belong elsewhere. This report asks one question, per sha, of the repository at the directory named above, at generation time, and says nothing about which ref the work landed on, signatures, the working tree's cleanliness, or the content of any commit. Unknown means git could not answer (no binary, not a repository, unparseable sha, timed out) — never counted as “no”.",
      positive: "ancestor",
      negative: "unreached",
    },
    nowMs,
    directory,
  )
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function reachSummaryLine(reach: ReachVerification): string {
  return recordSummaryLine(
    {
      unique: reach.unique,
      positive: reach.ancestors,
      negative: reach.unreached,
      unknown: reach.unknown,
    },
    {
      none: "record quotes no shas to place on this line",
      success: (v) => `record reaches HEAD: ${v.positive} of ${v.unique} shas on this line`,
      failure: (v) => `record does not reach HEAD: ${v.negative} of ${v.unique} shas not on this line`,
      unknown: (v) => `record unverifiable: ${v.unknown} of ${v.unique} shas could not be placed`,
    },
  )
}

/**
 * The compact ack segment appended to the dossier's reach row (` ✓ 6/6 on this line` / ` - 2 of 6 not on this line`
 * / ` ! 2 of 6 unknown`). ascii demotes the check glyph to `+` and the cross to `-`; `!` survives both arms.
 * The leading space matches the other rows' suffix grammar. A record with no quoted shas says so, never fabricates a pass.
 */
export function reachAckSegment(reach: Pick<ReachVerification, "unique" | "ancestors" | "unreached" | "unknown">, ascii: boolean): string {
  return recordAckSegment(
    {
      unique: reach.unique,
      positive: reach.ancestors,
      negative: reach.unreached,
      unknown: reach.unknown,
    },
    ascii,
    {
      noneAscii: " (no shas)",
      noneUnicode: " (no shas to place)",
      negative: "not on this line",
      unknown: "unknown",
      positive: "on this line",
    },
  )
}

/** The shape the host hands back to the dossier row's in-place acknowledgment (and the dialog needs nothing else — the counts are the whole truth of the click). */
export type ReachOutcome = Pick<ReachVerification, "unique" | "ancestors" | "unreached" | "unknown">
