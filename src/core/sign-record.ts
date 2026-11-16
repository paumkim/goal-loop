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
import { shortSha } from "./dossier.ts"
import { recordShaMentions } from "./verify-record.ts"
import type { GoalSnapshot } from "./types.ts"

/** The probe contract: true = git verified a signature on the commit at the probed directory, false = git answered and the signature did not verify (object present, verify-commit exit non-zero), "unknown" = git could not answer (or there is no object to judge). */
export type SignProbe = (sha: string) => boolean | "unknown"

export const SIGN_TIMEOUT_MS = 10_000

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

export type SignCheckStatus = "verified" | "unverified" | "unknown"

export interface SignCheck {
  readonly sha: string
  readonly shortSha: string
  /** 1-based loop iterations that quote this sha (oldest first). */
  readonly iterations: readonly number[]
  readonly status: SignCheckStatus
}

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
  const checks = recordShaMentions(goal).map((m): SignCheck => {
    let answer: boolean | "unknown"
    try {
      answer = probe(m.sha)
    } catch {
      answer = "unknown"
    }
    const status: SignCheckStatus = answer === true ? "verified" : answer === false ? "unverified" : "unknown"
    return { sha: m.sha, shortSha: shortSha(m.sha), iterations: m.iterations, status }
  })
  let verified = 0
  let unverified = 0
  let unknown = 0
  let mentions = 0
  for (const check of checks) {
    if (check.status === "verified") verified += 1
    else if (check.status === "unverified") unverified += 1
    else unknown += 1
    mentions += check.iterations.length
  }
  return { checks, unique: checks.length, mentions, verified, unverified, unknown }
}

const iterationList = (iterations: readonly number[]): string => iterations.map((v) => `v${v}`).join(", ")

const GAP = "—"

const statusCell = (status: SignCheckStatus): string =>
  status === "verified" ? "yes" : status === "unverified" ? "no" : "unknown"

/**
 * The signature report as Markdown — freshly generated, self-describing, safe to hand to a reviewer.
 * Carries the generation time and the probed directory so a stale copy cannot masquerade as a live
 * check; the honesty footer states exactly what "not under seal" does and does not imply.
 */
export function signReportMarkdown(goal: GoalSnapshot, sign: SignVerification, nowMs: number, directory: string): string {
  const stamp = new Date(Number.isFinite(nowMs) ? nowMs : 0).toISOString()
  const condition = (goal.condition ?? "").replace(/\s+/g, " ").trim()
  const conditionCell = condition.length > 200 ? `${condition.slice(0, 200)}…` : condition || GAP
  const lines: string[] = [
    "# /goal-loop record signatures",
    "",
    `- Generated: ${stamp}`,
    `- Repository: ${directory}`,
    `- Condition: ${conditionCell}`,
    `- Shas quoted by the record: ${sign.unique} unique across ${sign.mentions} mention${sign.mentions === 1 ? "" : "s"}`,
    "",
    "| sha | quoted at | under seal |",
    "| --- | --- | --- |",
  ]
  for (const check of sign.checks) {
    lines.push(`| ${check.shortSha} | ${iterationList(check.iterations)} | ${statusCell(check.status)} |`)
  }
  if (sign.checks.length === 0) lines.push("| — | — | — |")
  lines.push(
    "",
    `- Under seal (git verified): ${sign.verified} · not under seal: ${sign.unverified} · unknown: ${sign.unknown}`,
    "",
    "A signature attests integrity only as strongly as the key and the trust configured at the probed directory — git decides by its own rules. `verified` means git's configured rules accepted the commit's signature, nothing more, nothing less. Anything else — an unsigned commit, an expired or untrusted key, a bad signature — is `not under seal`, never proof of forgery; most commits are unsigned, and git's thresholds differ across machines and time. An unresolvable object has no signature to judge and reads `unknown`, never `not under seal`. Unknown means git could not answer (no binary, not a repository, unparseable sha, timed out) — never counted as “no”. Existence is not ancestry, ancestry is not content, content is not intent — the EC and ED reports are the other halves, and none substitutes for another. This report asks one question, per sha, of the repository at the directory named above, at generation time — it says nothing about the key's origin, the author's intent, the commit's content, or the working tree's cleanliness.",
    "",
  )
  return lines.join("\n")
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function signSummaryLine(sign: SignVerification): string {
  if (sign.unique === 0) return "record quotes no shas to attest"
  if (sign.unverified === 0 && sign.unknown === 0)
    return `record under seal: ${sign.verified} of ${sign.unique} shas verify`
  if (sign.unverified > 0)
    return `record not under seal: ${sign.unverified} of ${sign.unique} shas do not verify`
  return `record unverifiable: ${sign.unknown} of ${sign.unique} shas could not be attested`
}

/**
 * The compact ack segment appended to the dossier's sign row (` ✓ 6/6 signed` / ` - 2 of 6 unsigned`
 * / ` ! 2 of 6 unknown`). ascii demotes the check glyph to `+` and the cross to `-`; `!` survives both arms.
 * The leading space matches the other rows' suffix grammar. A record with no quoted shas says so, never fabricates a pass.
 */
export function signAckSegment(sign: Pick<SignVerification, "unique" | "verified" | "unverified" | "unknown">, ascii: boolean): string {
  const ok = ascii ? "+" : "✓"
  const bad = ascii ? "-" : "✗"
  if (sign.unique === 0) return ascii ? " (no shas)" : " (no shas to attest)"
  if (sign.unverified > 0) return ` (${bad} ${sign.unverified} of ${sign.unique} unsigned)`
  if (sign.unknown > 0) return ` (! ${sign.unknown} of ${sign.unique} unknown)`
  return ` (${ok} ${sign.verified}/${sign.unique} signed)`
}

/** The shape the host hands back to the dossier row's in-place acknowledgment (and the dialog needs nothing else — the counts are the whole truth of the click). */
export type SignOutcome = Pick<SignVerification, "unique" | "verified" | "unverified" | "unknown">
