/**
 * The sealed dossier — the record's own bytes plus a freshly probed attestation appendix,
 * written as one file. `goal.dossier.seal` (palette) and the dossier view's seal row ask
 * all three questions of every sha the ledger quotes — existence (EC: does the object
 * resolve), ancestry (ED: is it on this line), the seal (EF: does git verify a signature) —
 * and bind the three answers to the document a handoff actually carries, so a reviewer
 * holding the file does not need the three standalone reports pasted into an issue.
 *
 * Honesty rules, same as the rest of the plugin:
 *   - The bookkeeping above is untouched. `buildLoopDossier` output is carried byte for
 *     byte; the attestation appendix is appended *after* it and says so itself — nothing
 *     above was re-verified, only the shas the record quotes are re-probed here, fresh,
 *     at seal time. The plain `goal.dossier.export` path is unchanged.
 *   - The sweeps are the existing ones. `verifyRecord` / `reachRecord` / `signRecord` run
 *     with the same injected-probe contract as their standalone cousins; no probe is
 *     reimplemented. A probe failure degrades per-row to `unknown`, never sinks the seal.
 *   - The three answers are three answers. Existence is not ancestry, ancestry is not
 *     the seal; a sha that passes all three is `clean`, and clean is the only pass the
 *     appendix claims. A table row paints all three outcomes per sha — no blended verdict.
 *   - `unknown` never counts as a pass or a fail. `clean` is computed over rows that
 *     answered yes on all three questions; everything else (no / unknown on any question)
 *     is not clean. The counts line says which class the gaps are.
 *   - A record with no quoted shas paints a GAP row that says so — never an empty table
 *     dressed as a pass, never a fabricated `0 of 0`.
 *   - The appendix carries the generation stamp and the probed directory, so a stale copy
 *     cannot masquerade as a live seal. The plain export stem is never reused; collision
 *     retries with a numeric suffix instead of clobbering (same O_EXCL grammar as the
 *     plain export).
 */
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildLoopDossier, stampOf, fileStampOf } from "./dossier.ts"
import { MAX_EXPORT_ATTEMPTS } from "./dossier-export.ts"
import {
  gitCatFileProbe,
  verifyRecord,
  type RecordProbe,
  type RecordVerification,
} from "./verify-record.ts"
import { gitAncestorProbe, reachRecord, type ReachProbe, type ReachVerification } from "./reach-record.ts"
import { gitSignProbe, signRecord, type SignProbe, type SignVerification } from "./sign-record.ts"
import type { GoalSnapshot } from "./types.ts"

/** The probe trio, injectable for tests; the defaults are the real synchronous probes at `directory`. */
interface SealProbes {
  readonly verify?: RecordProbe
  readonly reach?: ReachProbe
  readonly sign?: SignProbe
}

/** The sealed document plus the sweeps behind it — the host needs the counts for the toast and the row ack. */
interface SealedDossier {
  readonly markdown: string
  readonly verification: RecordVerification
  readonly reach: ReachVerification
  readonly sign: SignVerification
  /** Unique shas the record quotes. */
  readonly unique: number
  /** Shas that answered yes on all three questions (present · ancestor · verified). The only pass this module claims. */
  readonly clean: number
}

/**
 * `goal-dossier-sealed-20261116-201500.md` from a clock; attempt > 0 appends `-attempt`.
 * Deterministic: the same (nowMs, attempt) always yields the same name. A non-finite or
 * unrepresentable clock stamps the epoch rather than throwing — the name stays honest.
 * Never collides with the plain export's stem (`goal-dossier-<stamp>.md`).
 */
export const sealedDossierName = (nowMs: number, attempt = 0): string => {
  const suffix = attempt > 0 ? `-${attempt + 1}` : ""
  return `goal-dossier-sealed-${fileStampOf(nowMs)}${suffix}.md`
}

const iterationList = (iterations: readonly number[]): string => iterations.map((v) => `v${v}`).join(", ")

const verifyCell = (status: string): string => (status === "present" ? "yes" : status === "missing" ? "no" : "unknown")
const reachCell = (status: string): string => (status === "ancestor" ? "yes" : status === "unreached" ? "no" : "unknown")
const signCell = (status: string): string => (status === "verified" ? "yes" : status === "unverified" ? "no" : "unknown")

/** Shas that answered yes on all three questions, joined by sha (the same mention order in all three sweeps). */
export const cleanShaCount = (
  verification: RecordVerification,
  reach: ReachVerification,
  sign: SignVerification,
): number => {
  const reachStatus = new Map<string, string>(reach.checks.map((c) => [c.sha, c.status]))
  const signStatus = new Map<string, string>(sign.checks.map((c) => [c.sha, c.status]))
  let clean = 0
  for (const check of verification.checks) {
    if (check.status === "present" && reachStatus.get(check.sha) === "ancestor" && signStatus.get(check.sha) === "verified") {
      clean += 1
    }
  }
  return clean
}

/**
 * The appendix as Markdown — appended after the base dossier, freshly generated, self-describing.
 * A record with no quoted shas renders the GAP case: one honest sentence, no table.
 */
export function attestationAppendix(
  _goal: GoalSnapshot,
  verification: RecordVerification,
  reach: ReachVerification,
  sign: SignVerification,
  nowMs: number,
  directory: string,
): string[] {
  const stamp = stampOf(nowMs)
  const lines: string[] = [
    "## Attestation (freshly probed at seal time)",
    "",
    `_The bookkeeping above is the record's own and was not re-verified; it renders what the record holds, nothing more. The shas the record quotes were re-probed here, fresh, against \`${directory}\`, at ${stamp}: existence (the object store), ancestry (this line), and the seal (git's signature check). \`unknown\` means git could not answer and is never counted as a pass or a fail. No question substitutes for another._`,
    "",
  ]
  // A retention-capped record no longer quotes every sha the session ever saw. Say so once, plainly: the
  // dropped entries are gone by design; nothing below re-probes them, and the counts are never a claim about them.
  const droppedLoop = _goal.loopHistoryDropped ?? 0
  const droppedVerdicts = _goal.historyDropped ?? 0
  if (droppedLoop > 0 || droppedVerdicts > 0) {
    const bits: string[] = []
    if (droppedLoop > 0) bits.push(`${droppedLoop} earlier iteration record${droppedLoop === 1 ? "" : "s"}`)
    if (droppedVerdicts > 0) bits.push(`${droppedVerdicts} earlier verdict${droppedVerdicts === 1 ? "" : "s"}`)
    lines.push(`_${bits.join(" and ")} dropped by the retention caps; the shas they quoted are not re-probed here and are never implied held._`, "")
  }
  if (verification.unique === 0) {
    lines.push(
      "The record quotes no sha — there is nothing to seal. An unshaded record cannot be re-probed, and none is claimed.",
      "",
    )
    return lines
  }
  const reachStatus = new Map<string, string>(reach.checks.map((c) => [c.sha, c.status]))
  const signStatus = new Map<string, string>(sign.checks.map((c) => [c.sha, c.status]))
  lines.push(
    "| sha | iterations | exists | on this line | under seal |",
    "| --- | --- | --- | --- | --- |",
  )
  for (const check of verification.checks) {
    lines.push(
      `| ${check.shortSha} | ${iterationList(check.iterations)} | ${verifyCell(check.status)} | ${reachCell(reachStatus.get(check.sha) ?? "unknown")} | ${signCell(signStatus.get(check.sha) ?? "unknown")} |`,
    )
  }
  const clean = cleanShaCount(verification, reach, sign)
  lines.push(
    "",
    `- Existence: ${verification.present} of ${verification.unique} shas resolve (${verification.unknown} unknown — never counted as present)`,
    `- Ancestry: ${reach.ancestors} of ${reach.unique} shas on this line (${reach.unknown} unknown)`,
    `- Seal: ${sign.verified} of ${sign.unique} shas under seal (${sign.unverified} not under seal — not an accusation; ${sign.unknown} unknown)`,
    `- All three: ${clean} of ${verification.unique} shas clean (present · on this line · under seal)`,
    "",
    "A clean row is the strongest thing this appendix can say: the object resolves, it belongs to this line, and git verified a signature on it at seal time. Anything short of that is not an accusation — existence is not ancestry, ancestry is not the seal, and most commits are unsigned. The loop that produced this record may be running right now; this file is a snapshot of its receipts at the moment it was written, and the stamp above travels with it.",
    "",
  )
  return lines
}

/**
 * Runs the three sweeps (default: the real synchronous probes at `directory`) and builds the sealed
 * document. Deterministic given the probes and the clock: the same record, the same probes and the
 * same `nowMs` render the same bytes.
 */
export function sealRecord(goal: GoalSnapshot, directory: string, nowMs: number, probes: SealProbes = {}): SealedDossier {
  const verifyProbe = probes.verify ?? gitCatFileProbe(directory)
  const reachProbe = probes.reach ?? gitAncestorProbe(directory)
  const signProbe = probes.sign ?? gitSignProbe(directory)
  const verification = verifyRecord(goal, verifyProbe)
  const reach = reachRecord(goal, reachProbe)
  const sign = signRecord(goal, signProbe)
  const clean = cleanShaCount(verification, reach, sign)
  const base = buildLoopDossier(goal, nowMs)
  const appendix = attestationAppendix(goal, verification, reach, sign, nowMs, directory)
  const markdown = `${base}\n\n${appendix.join("\n")}`
  return { markdown, verification, reach, sign, unique: verification.unique, clean }
}

interface SealedExportResult {
  /** Absolute path of the written file. */
  readonly path: string
  /** Bytes written (UTF-8). */
  readonly bytes: number
  /** How many candidate names were tried (1 = the plain name was free). */
  readonly attempts: number
  readonly unique: number
  readonly clean: number
  readonly verification: RecordVerification
  readonly reach: ReachVerification
  readonly sign: SignVerification
}

/**
 * Writes the sealed dossier for `goal` as one new file inside `dir` (the caller passes the host's
 * cwd). Never overwrites: the write is O_EXCL and collisions retry with a numeric suffix, up to
 * `MAX_EXPORT_ATTEMPTS`. Throws — never resolves partial — when no candidate name is free or when
 * the directory rejects the write; the message is the filesystem's own.
 */
export function exportSealedDossier(goal: GoalSnapshot, nowMs: number, dir: string, probes: SealProbes = {}): SealedExportResult {
  const targetDir = resolve(dir)
  const seal = sealRecord(goal, targetDir, nowMs, probes)
  const bytes = Buffer.byteLength(seal.markdown, "utf8")
  for (let attempt = 0; attempt < MAX_EXPORT_ATTEMPTS; attempt++) {
    const path = join(targetDir, sealedDossierName(nowMs, attempt))
    try {
      writeFileSync(path, seal.markdown, { encoding: "utf8", flag: "wx" })
      return {
        path,
        bytes,
        attempts: attempt + 1,
        unique: seal.unique,
        clean: seal.clean,
        verification: seal.verification,
        reach: seal.reach,
        sign: seal.sign,
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === "EEXIST") continue // the stem collided — try the next suffix, never clobber
      throw error
    }
  }
  throw new Error(`no free sealed-dossier filename after ${MAX_EXPORT_ATTEMPTS} attempts in ${targetDir}`)
}

/** The one-line outcome for the toast. No glyphs, no color — callers paint their own chrome. */
export function sealSummaryLine(seal: Pick<SealedDossier, "unique" | "clean" | "verification" | "reach" | "sign">): string {
  if (seal.unique === 0) return "record quotes no shas to seal"
  const hard = seal.verification.missing + seal.reach.unreached + seal.sign.unverified
  const unknown = seal.verification.unknown + seal.reach.unknown + seal.sign.unknown
  if (hard === 0 && unknown === 0) return `record sealed: ${seal.clean} of ${seal.unique} shas pass all three checks`
  if (hard > 0) return `record sealed with gaps: ${seal.clean} of ${seal.unique} shas pass all three checks`
  return `record sealed, unverifiable: ${unknown} of ${3 * seal.unique} checks could not answer`
}

/**
 * The compact ack segment appended to the dossier's seal row (` ✓ 2/2 sealed` / ` - 1 of 3 sealed` /
 * ` ! 1 of 3 sealed`). ascii demotes the check glyph to `+` and the cross to `-`; `!` survives both arms.
 * A record with no quoted shas says so, never fabricates a pass.
 */
export function sealAckSegment(seal: Pick<SealedDossier, "unique" | "clean" | "verification" | "reach" | "sign">, ascii: boolean): string {
  const ok = ascii ? "+" : "✓"
  const bad = ascii ? "-" : "✗"
  if (seal.unique === 0) return ascii ? " (no shas)" : " (no shas to seal)"
  const hard = seal.verification.missing + seal.reach.unreached + seal.sign.unverified
  if (hard > 0) return ` (${bad} ${seal.clean} of ${seal.unique} sealed)`
  if (seal.clean < seal.unique) return ` (! ${seal.clean} of ${seal.unique} sealed)`
  return ` (${ok} ${seal.clean}/${seal.unique} sealed)`
}

/** The shape the host hands back to the dossier row's in-place acknowledgment (and the dialog needs nothing else — the counts are the whole truth of the click). */
export type SealOutcome = Pick<SealedDossier, "unique" | "clean" | "verification" | "reach" | "sign">
