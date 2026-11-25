/**
 * The dossier's shas, under seal. `goal.dossier.sign` (palette) and the dossier view's sign row
 * ask one question of every sha the record quotes: does git verify a signature on the commit at
 * the host's cwd — i.e. does the receipt carry a cryptographic mark, or is it merely a hash?
 * EC answered resolution (the object exists), ED answered placement (the object is on this line);
 * this module answers the third half of "is this real?" — the object carries a checkable
 * signature. Not a new document: a report over the existing one, same generation discipline.
 *
 * Honesty rules, same as the rest of the plugin:
 *   - Only the sha strings the record actually quotes (the loop ledger's per-iteration shas, oldest
 *     first) are checked. Deduplicated by sha; the iterations that quote each sha are listed.
 *   - A probe that cannot answer is `unknown`, never folded into `not under seal`. "git could not
 *     run" (no binary, not a repository, unparseable sha, timed out) and "the object does not
 *     resolve, so there is no signature to judge" are categorically different from "git ran and
 *     the signature did not verify" (exit non-zero with the object present). Unknown is reported
 *     as unknown.
 *   - A probe that throws is treated as `unknown` for that sha; one bad row never sinks the sweep.
 *   - `not under seal` is not misconduct. Git decides by its own rules, against the keys and trust
 *     configured at the probed directory: an unsigned commit, an expired or untrusted key, and a
 *     bad signature are indistinguishable from here without reading stderr, and most commits are
 *     unsigned. Unverified is information, not accusation; the report says exactly that and no more.
 *   - Existence is not ancestry, and neither existence nor ancestry is a signature — the EC and ED
 *     footers said so, and this report exists to answer the remaining half. The three reports are
 *     complementary, never substitutes.
 *   - The report is freshly generated on every invocation — generation time and the probed directory
 *     are printed so a stale copy cannot masquerade as a live check.
 */
import { execFileSync } from "node:child_process"
import type { GoalSnapshot } from "./types.ts"
import { recordAckSegment, recordSummaryLine, renderRecordReport, sweepRecordMentions } from "./record-attestation.ts"
import type { RecordCheckShape } from "./record-attestation.ts"

/** The probe contract: true = git verified a signature on the commit at the probed directory, false = git answered and the signature did not verify (object present, verify-commit exit non-zero), "unknown" = git could not answer (or there is no object to judge). */
export type SignProbe = (sha: string) => boolean | "unknown"

const SIGN_TIMEOUT_MS = 10_000

/**
 * The real probe: one `git cat-file -e <sha>` then one `git verify-commit <sha>` per sha. The
 * existence step first because verify-commit cannot distinguish "the signature did not verify"
 * from "there is no commit to verify" from exit status alone — an unresolvable object reads
 * `unknown`, never `not under seal`. Numeric exit 0 from verify-commit means the signature
 * verified under git's configured rules; any numeric exit means git answered and the signature
 * did not verify; a spawn failure or timeout is `unknown`, categorically not `not under seal`.
 */
export function gitSignProbe(cwd: string): SignProbe {
  return (sha: string): boolean | "unknown" => {
    try {
      execFileSync("git", ["-C", cwd, "cat-file", "-e", sha], { stdio: "ignore", timeout: SIGN_TIMEOUT_MS })
    } catch {
      // The commit is invisible from here (or git could not answer) — the signature question has
      // no subject. Honest answer: unknown, never folded into "not under seal".
      return "unknown"
    }
    try {
      execFileSync("git", ["-C", cwd, "verify-commit", sha], { stdio: "ignore", timeout: SIGN_TIMEOUT_MS })
      return true
    } catch (error) {
      const status = (error as { status?: number | null } | undefined)?.status
      // A numeric exit means git ran and the signature did not verify — unsigned, expired key,
      // untrusted key, bad signature: all land in the same bucket, by design, and the report says so.
      return typeof status === "number" ? false : "unknown"
    }
  }
}

type SignCheckStatus = "verified" | "unverified" | "unknown"

type SignCheck = RecordCheckShape<SignCheckStatus>

export interface SignVerification {
  readonly checks: readonly SignCheck[]
  /** Unique shas the record quotes. */
  readonly unique: number
  /** Total mentions across all iterations. */
  readonly mentions: number
  readonly verified: number
  readonly unverified: number
  readonly unknown: number
}

/** Sweeps the record's quoted shas against the probe. Pure: the probe is injected, the sweep never throws. */
export function signRecord(goal: GoalSnapshot, probe: SignProbe): SignVerification {
  const swept = sweepRecordMentions<SignCheckStatus>(goal, probe, "verified", "unverified")
  return {
    checks: swept.checks,
    unique: swept.unique,
    mentions: swept.mentions,
    verified: swept.positive,
    unverified: swept.negative,
    unknown: swept.unknown,
  }
}

/**
 * The signature report as Markdown — freshly generated, self-describing, safe to hand to a reviewer.
 * Carries the generation time and the probed directory so a stale copy cannot masquerade as a live
 * check; the honesty footer states exactly what "not under seal" does and does not imply.
 */
export function signReportMarkdown(goal: GoalSnapshot, sign: SignVerification, nowMs: number, directory: string): string {
  return renderRecordReport(
    goal,
    sign,
    {
      title: "# /goal-loop record signatures",
      columnHeader: "under seal",
      countsLine: `- Under seal (git verified): ${sign.verified} · not under seal: ${sign.unverified} · unknown: ${sign.unknown}`,
      footer: "A signature attests integrity only as strongly as the key and the trust configured at the probed directory — git decides by its own rules. `verified` means git's configured rules accepted the commit's signature, nothing more, nothing less. Anything else — an unsigned commit, an expired or untrusted key, a bad signature — is `not under seal`, never proof of forgery; most commits are unsigned, and git's thresholds differ across machines and time. An unresolvable object has no signature to judge and reads `unknown`, never `not under seal`. Unknown means git could not answer (no binary, not a repository, unparseable sha, timed out) — never counted as “no”. Existence is not ancestry, ancestry is not content, content is not intent — the EC and ED reports are the other halves, and none substitutes for another. This report asks one question, per sha, of the repository at the directory named above, at generation time — it says nothing about the key's origin, the author's intent, the commit's content, or the working tree's cleanliness.",
      positive: "verified",
      negative: "unverified",
    },
    nowMs,
    directory,
  )
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function signSummaryLine(sign: SignVerification): string {
  return recordSummaryLine(
    {
      unique: sign.unique,
      positive: sign.verified,
      negative: sign.unverified,
      unknown: sign.unknown,
    },
    {
      none: "record quotes no shas to attest",
      success: (v) => `record under seal: ${v.positive} of ${v.unique} shas verify`,
      failure: (v) => `record not under seal: ${v.negative} of ${v.unique} shas do not verify`,
      unknown: (v) => `record unverifiable: ${v.unknown} of ${v.unique} shas could not be attested`,
    },
  )
}

/**
 * The compact ack segment appended to the dossier's sign row (` ✓ 6/6 signed` / ` - 2 of 6 unsigned`
 * / ` ! 2 of 6 unknown`). ascii demotes the check glyph to `+` and the cross to `-`; `!` survives both arms.
 * The leading space matches the other rows' suffix grammar. A record with no quoted shas says so, never fabricates a pass.
 */
export function signAckSegment(sign: Pick<SignVerification, "unique" | "verified" | "unverified" | "unknown">, ascii: boolean): string {
  return recordAckSegment(
    {
      unique: sign.unique,
      positive: sign.verified,
      negative: sign.unverified,
      unknown: sign.unknown,
    },
    ascii,
    {
      noneAscii: " (no shas)",
      noneUnicode: " (no shas to attest)",
      negative: "unsigned",
      unknown: "unknown",
      positive: "signed",
    },
  )
}

/** The shape the host hands back to the dossier row's in-place acknowledgment (and the dialog needs nothing else — the counts are the whole truth of the click). */
export type SignOutcome = Pick<SignVerification, "unique" | "verified" | "unverified" | "unknown">
