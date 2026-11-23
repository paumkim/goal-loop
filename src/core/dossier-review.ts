/**
 * The whole interrogation, one file — `goal.dossier.review` re-runs the three sweeps (existence,
 * ancestry, the seal) against the repository at the host's cwd and writes a single O_EXCL file:
 * the record's own bytes, then a combined appendix whose rows carry every answer git gave, per
 * sha, with one verdict column. The standalone reports remain available one question at a time
 * (`goal.dossier.verify` / `reach` / `sign`); the review is the artifact a reviewer opens cold.
 *
 * Honesty rules, same as the rest of the plugin:
 *   - The three sweeps run fresh, at generation time, with the same injected-probe contracts as
 *     their standalone cousins; no probe is reimplemented here. A probe that cannot answer is
 *     `unknown`, never a pass and never a fail — the counts name it separately.
 *   - A verdict of `clean` requires a yes on all three questions. Any `no` anywhere makes the row
 *     `gaps` — information, not misconduct; existence is not ancestry, ancestry is not the seal,
 *     and most commits are unsigned. A row with no `no` and at least one `unknown` is `unknown`,
 *     never `clean` and never `gaps`.
 *   - The bookkeeping above the appendix is the record's own and was not re-verified; it renders
 *     what the record holds, nothing more. This module adds no claim the probes did not support.
 *   - A record with no quoted shas renders the GAP case: one honest sentence, no table, and a
 *     summary line that says so — never a fabricated pass.
 *   - The write is O_EXCL with collision retries; a failed write throws with the filesystem's own
 *     message and the host toasts it. No directory is created, moved, or removed — the target is
 *     always the existing directory the caller names (the host's cwd).
 */
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildLoopDossier, shortSha, stampOf, fileStampOf , recordStatusCell, iterationList } from "./dossier.ts"
import {
  gitCatFileProbe,
  verifyRecord,
  type RecordProbe,
  type RecordVerification,
} from "./verify-record.ts"
import {
  gitAncestorProbe,
  reachRecord,
  type ReachProbe,
  type ReachVerification,
} from "./reach-record.ts"
import {
  gitSignProbe,
  signRecord,
  type SignProbe,
  type SignVerification,
} from "./sign-record.ts"
import { MAX_EXPORT_ATTEMPTS } from "./dossier-export.ts"
import type { GoalSnapshot } from "./types.ts"

/** The probe trio, injectable for tests; the defaults are the real synchronous probes at `directory`. */
interface ReviewProbes {
  readonly verify?: RecordProbe
  readonly reach?: ReachProbe
  readonly sign?: SignProbe
}

/** One answer cell, exactly as the appendix prints it. */
type ReviewAnswer = "yes" | "no" | "unknown"

/** `clean`: yes on all three. `gaps`: at least one no. `unknown`: no no, but at least one question git could not answer. */
type ReviewVerdict = "clean" | "gaps" | "unknown"

interface ReviewRow {
  readonly sha: string
  readonly shortSha: string
  readonly iterations: readonly number[]
  readonly exists: ReviewAnswer
  readonly onThisLine: ReviewAnswer
  readonly underSeal: ReviewAnswer
  readonly verdict: ReviewVerdict
}

interface ReviewedRecord {
  /** The complete review file's bytes: the dossier, then the appendix. */
  readonly markdown: string
  readonly verification: RecordVerification
  readonly reach: ReachVerification
  readonly sign: SignVerification
  /** Unique shas the record quotes. */
  readonly unique: number
  /** Shas clean on all three questions. */
  readonly clean: number
  /** Shas with at least one no on any question. */
  readonly gaps: number
  /** Shas with no no anywhere, but at least one unknown. */
  readonly unknown: number
}

/**
 * `goal-dossier-review-20261116-172233.md` from a clock; attempt > 0 appends `-attempt` (`-2`, `-3`, ...).
 * Deterministic: the same (nowMs, attempt) always yields the same name. A non-finite or
 * unrepresentable clock stamps the epoch rather than throwing — the name stays honest.
 */
export const reviewName = (nowMs: number, attempt = 0): string => {
  const suffix = attempt > 0 ? `-${attempt + 1}` : ""
  return `goal-dossier-review-${fileStampOf(nowMs)}${suffix}.md`
}

const verifyCell = (status: string): ReviewAnswer => recordStatusCell(status, "present", "missing")
const reachCell = (status: string): ReviewAnswer => recordStatusCell(status, "ancestor", "unreached")
const signCell = (status: string): ReviewAnswer => recordStatusCell(status, "verified", "unverified")

/** yes on all three → clean; any no → gaps; else unknown. The one honest collapse of the three cells. */
export const reviewVerdict = (exists: ReviewAnswer, onThisLine: ReviewAnswer, underSeal: ReviewAnswer): ReviewVerdict => {
  if (exists === "no" || onThisLine === "no" || underSeal === "no") return "gaps"
  if (exists === "yes" && onThisLine === "yes" && underSeal === "yes") return "clean"
  return "unknown"
}

/**
 * Runs the three sweeps (default: the real synchronous probes at `directory`) and builds the review
 * document. Deterministic given the probes and the clock: the same record, the same probes and the
 * same `nowMs` render the same bytes. Never throws on probe answers — a probe that throws is caught
 * by its own sweep and surfaces as `unknown`; a filesystem-level failure throws with its own message.
 */
export function buildReview(goal: GoalSnapshot, directory: string, nowMs: number, probes: ReviewProbes = {}): ReviewedRecord {
  const verifyProbe = probes.verify ?? gitCatFileProbe(directory)
  const reachProbe = probes.reach ?? gitAncestorProbe(directory)
  const signProbe = probes.sign ?? gitSignProbe(directory)
  const verification = verifyRecord(goal, verifyProbe)
  const reach = reachRecord(goal, reachProbe)
  const sign = signRecord(goal, signProbe)
  const base = buildLoopDossier(goal, nowMs)
  const stamp = stampOf(nowMs)

  const reachBySha = new Map<string, string>(reach.checks.map((check) => [check.sha, check.status]))
  const signBySha = new Map<string, string>(sign.checks.map((check) => [check.sha, check.status]))
  const rows: ReviewRow[] = verification.checks.map((check) => {
    const exists = verifyCell(check.status)
    const onThisLine = reachCell(reachBySha.get(check.sha) ?? "unknown")
    const underSeal = signCell(signBySha.get(check.sha) ?? "unknown")
    return {
      sha: check.sha,
      shortSha: shortSha(check.sha),
      iterations: check.iterations,
      exists,
      onThisLine,
      underSeal,
      verdict: reviewVerdict(exists, onThisLine, underSeal),
    }
  })
  const clean = rows.filter((row) => row.verdict === "clean").length
  const gaps = rows.filter((row) => row.verdict === "gaps").length
  const unknown = rows.filter((row) => row.verdict === "unknown").length

  const appendix: string[] = [
    "## Review (freshly probed at generation time)",
    "",
    `_The bookkeeping above is the record's own and was not re-verified; it renders what the record holds, nothing more. The shas the record quotes were re-probed here, fresh, against \`${directory}\`, at ${stamp}: existence (the object store), ancestry (this line), and the seal (git's signature check). A verdict of \`clean\` requires a yes on all three; any \`no\` makes the row \`gaps\`; a row with no \`no\` but at least one question git could not answer is \`unknown\` — never collapsed into either. Existence is not ancestry, ancestry is not the seal; no question substitutes for another._`,
    "",
  ]
  if (verification.unique === 0) {
    appendix.push(
      "The record quotes no sha — there is nothing to review. An unshaded record cannot be re-probed, and none is claimed.",
      "",
    )
  } else {
    appendix.push(
      "| sha | quoted at | exists | on this line | under seal | verdict |",
      "| --- | --- | --- | --- | --- | --- |",
    )
    for (const row of rows) {
      appendix.push(`| ${row.shortSha} | ${iterationList(row.iterations)} | ${row.exists} | ${row.onThisLine} | ${row.underSeal} | ${row.verdict} |`)
    }
    appendix.push(
      "",
      `- Existence: ${verification.present} of ${verification.unique} shas resolve (${verification.unknown} unknown — never counted as present)`,
      `- Ancestry: ${reach.ancestors} of ${reach.unique} shas on this line (${reach.unknown} unknown)`,
      `- Seal: ${sign.verified} of ${sign.unique} shas under seal (${sign.unverified} not under seal — not an accusation; ${sign.unknown} unknown)`,
      `- All three: ${clean} of ${verification.unique} shas clean (present · on this line · under seal) · ${gaps} with gaps · ${unknown} unverifiable`,
      "",
      "A clean row is the strongest thing this review can say: the object resolves, it belongs to this line, and git verified a signature on it at generation time. Anything short of that is not an accusation — existence is not ancestry, ancestry is not the seal, and most commits are unsigned. This file is a snapshot of the record's receipts at the moment it was written, and the stamp above travels with it. For a re-check weeks later, `goal.dossier.attest` answers whether what a sealed copy attests still holds.",
      "",
    )
  }
  const markdown = `${base}\n\n${appendix.join("\n")}`
  return { markdown, verification, reach, sign, unique: verification.unique, clean, gaps, unknown }
}

interface ReviewExportResult {
  /** Absolute path of the written file. */
  readonly path: string
  /** Bytes written (UTF-8). */
  readonly bytes: number
  /** How many candidate names were tried (1 = the plain name was free). */
  readonly attempts: number
  readonly unique: number
  readonly clean: number
  readonly gaps: number
  readonly unknown: number
  readonly verification: RecordVerification
  readonly reach: ReachVerification
  readonly sign: SignVerification
}

/**
 * Writes the review for `goal` as one new file inside `dir` (the caller passes the host's cwd).
 * Never overwrites: the write is O_EXCL and collisions retry with a numeric suffix, up to
 * `MAX_EXPORT_ATTEMPTS`. Throws — never resolves partial — when no candidate name is free or when
 * the directory rejects the write; the message is the filesystem's own.
 */
export function exportReview(goal: GoalSnapshot, nowMs: number, dir: string, probes: ReviewProbes = {}): ReviewExportResult {
  const targetDir = resolve(dir)
  const review = buildReview(goal, targetDir, nowMs, probes)
  const bytes = Buffer.byteLength(review.markdown, "utf8")
  for (let attempt = 0; attempt < MAX_EXPORT_ATTEMPTS; attempt++) {
    const path = join(targetDir, reviewName(nowMs, attempt))
    try {
      writeFileSync(path, review.markdown, { encoding: "utf8", flag: "wx" })
      return {
        path,
        bytes,
        attempts: attempt + 1,
        unique: review.unique,
        clean: review.clean,
        gaps: review.gaps,
        unknown: review.unknown,
        verification: review.verification,
        reach: review.reach,
        sign: review.sign,
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === "EEXIST") continue // the stem collided — try the next suffix, never clobber
      throw error
    }
  }
  throw new Error(`no free review filename after ${MAX_EXPORT_ATTEMPTS} attempts in ${targetDir}`)
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function reviewSummaryLine(review: Pick<ReviewedRecord, "unique" | "clean" | "gaps" | "unknown">): string {
  if (review.unique === 0) return "record quotes no shas to review"
  if (review.gaps > 0) return `review written with gaps: ${review.clean} of ${review.unique} shas clean on all three questions`
  if (review.unknown > 0) return `review unverifiable: ${review.clean} of ${review.unique} shas clean, ${review.unknown} could not answer`
  return `review written: ${review.clean} of ${review.unique} shas clean on all three questions`
}
