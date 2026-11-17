/**
 * The sealed dossier, on trial again — the file leaves the process, and this module answers
 * the question the counterparty holding that file actually asks weeks later: *is what this
 * file attested still true of the repository right now?* `goal.dossier.attest` (palette)
 * re-probes every sha named in the file's `## Attestation` appendix against HEAD at the
 * host's cwd and reports **drift since sealing** — shas that were clean at seal time and
 * no longer are.
 *
 * Honesty rules, same as the rest of the plugin:
 *   - The appendix is parsed, never trusted. The three sweeps run again, fresh, at attestation
 *     time, with the same injected-probe contracts as their standalone cousins; no probe is
 *     reimplemented here. A probe that cannot answer is `unknown`, never `no`.
 *   - Drift requires git to flip an answer from yes to no. A fresh `unknown` is not drift and
 *     not a pass either — it is reported as `unknown`, and the counts say so. An accusation
 *     this report never makes.
 *   - A sha that was not clean at seal time cannot regress; it reads `was-not-clean` and is
 *     reported as exactly that — never laundered into a failure and never blamed on the seal.
 *   - The report detects drift in the repository, not tampering with the file. An editor who
 *     rewrites appendix cells can make the file claim anything; this module re-probes the
 *     object store, the ancestry line and the signature on the shas the file names — the
 *     delta between seal-time answers and now. It does not audit the prose around the table.
 *   - Existence is not ancestry, ancestry is not the seal. A sha clean on all three at seal
 *     time and clean on all three now is `held`; anything short is named per question.
 *   - A file with no `## Attestation` appendix (a plain export, or someone else's markdown) is
 *     `unsealed` — not attested, never fabricated. A heading with no readable rows and no GAP
 *     sentence is `unparsable` — the bytes are not a seal this module can interrogate.
 *   - A record that sealed zero shas (the GAP sentence) attests to zero shas: `held 0 of 0`
 *     is printed as the empty truth it is, never dressed as a pass.
 */
import {
  gitCatFileProbe,
  type RecordProbe,
  type RecordVerification,
  verifyRecord,
} from "./verify-record.ts"
import { gitAncestorProbe, reachRecord, type ReachProbe, type ReachVerification } from "./reach-record.ts"
import { gitSignProbe, signRecord, type SignProbe, type SignVerification } from "./sign-record.ts"
import { shortSha, stampOf } from "./dossier.ts"
import type { GoalSnapshot } from "./types.ts"

/** One answer cell, exactly as the appendix prints it. */
type AttestationAnswer = "yes" | "no" | "unknown"

/** One parsed appendix row — the shas and the seal-time answers as the file records them. */
interface AttestationRow {
  /** The sha exactly as the file spells it (full or abbreviated — git resolves either). */
  readonly sha: string
  /** 1-based loop iterations that quoted the sha at seal time, oldest first. */
  readonly iterations: readonly number[]
  readonly exists: AttestationAnswer
  readonly onThisLine: AttestationAnswer
  readonly underSeal: AttestationAnswer
}

type ParsedAttestation =
  | {
      readonly kind: "sealed"
      /** The seal-time stamp as the file prints it, when present. */
      readonly stamp?: string
      /** The directory the file says it was sealed against, when present. */
      readonly directory?: string
      readonly rows: readonly AttestationRow[]
      /** True when the appendix is the GAP sentence (the record quoted no shas at seal time). */
      readonly gap: boolean
      /** Table-looking rows that could not be read (kept, never silently dropped). */
      readonly malformed: number
    }
  | { readonly kind: "unsealed" }
  | { readonly kind: "unparsable" }

const ANSWERS = new Set<AttestationAnswer>(["yes", "no", "unknown"])

const cellAnswer = (raw: string): AttestationAnswer => {
  const flat = raw.trim().toLowerCase()
  return ANSWERS.has(flat as AttestationAnswer) ? (flat as AttestationAnswer) : "unknown"
}

const splitRow = (line: string): string[] | null => {
  const cells = line.split("|").map((cell) => cell.trim())
  // The edges of a well-formed `| a | b | ... | z |` line split to ["", ...cells, ""].
  if (cells.length >= 2 && cells[0] === "" && cells[cells.length - 1] === "") cells.shift(), cells.pop()
  if (cells.length < 5) return null
  return cells
}

const SHA_RE = /^[0-9a-f]{4,64}$/i

/**
 * Parses the `## Attestation` appendix out of a sealed dossier's bytes. Pure: no fs, no git, no
 * clock. Never throws — anything it cannot read comes back as `unsealed` / `unparsable` and any
 * row it cannot read is counted in `malformed`, never silently dropped.
 */
export function parseAttestationAppendix(markdown: string): ParsedAttestation {
  const lines = markdown.split("\n")
  const heading = lines.findIndex((line) => line.startsWith("## Attestation"))
  if (heading === -1) return { kind: "unsealed" }
  const section: string[] = []
  for (let index = heading + 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.startsWith("## ")) break
    section.push(line)
  }
  const body = section.join("\n")
  const stamp = /at ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.Z+-]+):/.exec(body)?.[1]
  const directory = /against `([^`]+)`, at/.exec(body)?.[1]
  const gap = section.some((line) => line.includes("The record quotes no sha"))
  const rows: AttestationRow[] = []
  let malformed = 0
  for (const line of section) {
    if (!line.startsWith("|")) continue
    const cells = splitRow(line)
    if (!cells) {
      malformed += 1
      continue
    }
    const first = cells[0]!.toLowerCase()
    if (first === "sha" || /^-+$/.test(first)) continue // header and separator
    const sha = cells[0]!
    if (!SHA_RE.test(sha)) {
      malformed += 1
      continue
    }
    const iterations = (cells[1]!.match(/\d+/g) ?? []).map(Number)
    rows.push({
      sha,
      iterations,
      exists: cellAnswer(cells[2]!),
      onThisLine: cellAnswer(cells[3]!),
      underSeal: cellAnswer(cells[4]!),
    })
  }
  if (rows.length === 0 && !gap) return { kind: "unparsable" }
  return { kind: "sealed", stamp, directory, rows, gap, malformed }
}

/** The probe trio, injectable for tests; the defaults are the real synchronous probes at `directory`. */
interface AttestProbes {
  readonly verify?: RecordProbe
  readonly reach?: ReachProbe
  readonly sign?: SignProbe
}

export type Verdict = "held" | "regressed" | "unknown" | "was-not-clean"

/** One re-probed appendix row: the seal-time answers, the fresh answers, and the verdict. */
interface AttestationRowVerdict {
  readonly sha: string
  readonly shortSha: string
  readonly iterations: readonly number[]
  readonly seal: { readonly exists: AttestationAnswer; readonly onThisLine: AttestationAnswer; readonly underSeal: AttestationAnswer }
  readonly now: { readonly exists: AttestationAnswer; readonly onThisLine: AttestationAnswer; readonly underSeal: AttestationAnswer }
  /** `held`: yes on all three at seal time and yes on all three now. `regressed`: git flipped a yes to a no.
   *  `unknown`: was clean at seal time, nothing flipped to no, but git could not answer one of the questions.
   *  `was-not-clean`: not clean at seal time — nothing to regress. */
  readonly verdict: Verdict
  /** The questions whose answers flipped yes → no since sealing (empty unless regressed). */
  readonly flipped: readonly string[]
}

interface SealedAttestation {
  readonly rows: readonly AttestationRowVerdict[]
  /** Unique shas the appendix names (malformed rows excluded, counted separately). */
  readonly unique: number
  /** Shas that answered yes on all three questions at seal time. */
  readonly sealedClean: number
  /** Sealed-clean shas still yes on all three questions right now. */
  readonly held: number
  /** Sealed-clean shas where git flipped a yes to a no since sealing. */
  readonly regressed: number
  /** Sealed-clean shas with no flip to no, but at least one fresh unknown. */
  readonly unknown: number
  /** Rows that were not clean at seal time — reported, never blamed. */
  readonly wasNotClean: number
  /** The seal-time stamp and directory as the file prints them, when present. */
  readonly stamp?: string
  readonly sealDirectory?: string
  /** Table-looking rows that could not be read. */
  readonly malformed: number
}

type AttestationResult =
  | ({ readonly kind: "attested" } & SealedAttestation)
  | { readonly kind: "unsealed" }
  | { readonly kind: "unparsable" }

const verifyCell = (status: string): AttestationAnswer => (status === "present" ? "yes" : status === "missing" ? "no" : "unknown")
const reachCell = (status: string): AttestationAnswer => (status === "ancestor" ? "yes" : status === "unreached" ? "no" : "unknown")
const signCell = (status: string): AttestationAnswer => (status === "verified" ? "yes" : status === "unverified" ? "no" : "unknown")

/** A one-off record view so the existing sweeps (and their injected probes) run over the file's shas verbatim. */
const shasAsGoal = (rows: readonly AttestationRow[]): GoalSnapshot =>
  ({
    loopHistory: rows.flatMap((row, index) =>
      row.iterations.length > 0
        ? row.iterations.map((version) => ({ version, sha: row.sha }))
        : [{ version: index + 1, sha: row.sha }],
    ),
  } as unknown as GoalSnapshot)

/**
 * Re-probes every sha the appendix names against `directory`, fresh, and reports drift since sealing.
 * Pure given the probes: no fs, no clock. The probes receive the sha exactly as the file spells it.
 * Never throws — a probe that throws degrades its question to `unknown` for that row.
 */
export function attestSealedDossier(markdown: string, directory: string, probes: AttestProbes = {}): AttestationResult {
  const parsed = parseAttestationAppendix(markdown)
  if (parsed.kind !== "sealed") return parsed
  const verifyProbe = probes.verify ?? gitCatFileProbe(directory)
  const reachProbe = probes.reach ?? gitAncestorProbe(directory)
  const signProbe = probes.sign ?? gitSignProbe(directory)
  // The appendix is parsed, not trusted: a hand-assembled or tampered file can repeat a sha.
  // Counts and the report are per unique sha — keep the first row spelling, drop repeats.
  const seen = new Set<string>()
  const uniqRows = parsed.rows.filter((row) => {
    if (seen.has(row.sha)) return false
    seen.add(row.sha)
    return true
  })
  const synthetic = shasAsGoal(uniqRows)
  const verification: RecordVerification = verifyRecord(synthetic, verifyProbe)
  const reach: ReachVerification = reachRecord(synthetic, reachProbe)
  const sign: SignVerification = signRecord(synthetic, signProbe)
  const reachBySha = new Map<string, string>(reach.checks.map((check) => [check.sha, check.status]))
  const signBySha = new Map<string, string>(sign.checks.map((check) => [check.sha, check.status]))
  const verifyBySha = new Map<string, string>(verification.checks.map((check) => [check.sha, check.status]))
  const rows: AttestationRowVerdict[] = uniqRows.map((row) => {
    const now = {
      exists: verifyCell(verifyBySha.get(row.sha) ?? "unknown"),
      onThisLine: reachCell(reachBySha.get(row.sha) ?? "unknown"),
      underSeal: signCell(signBySha.get(row.sha) ?? "unknown"),
    }
    const seal = { exists: row.exists, onThisLine: row.onThisLine, underSeal: row.underSeal }
    const wasClean = seal.exists === "yes" && seal.onThisLine === "yes" && seal.underSeal === "yes"
    const flipped: string[] = []
    if (wasClean) {
      if (now.exists === "no") flipped.push("exists")
      if (now.onThisLine === "no") flipped.push("on this line")
      if (now.underSeal === "no") flipped.push("under seal")
    }
    const nowClean = now.exists === "yes" && now.onThisLine === "yes" && now.underSeal === "yes"
    const verdict: Verdict = !wasClean
      ? "was-not-clean"
      : flipped.length > 0
        ? "regressed"
        : nowClean
          ? "held"
          : "unknown"
    return { sha: row.sha, shortSha: shortSha(row.sha), iterations: row.iterations, seal, now, verdict, flipped }
  })
  const sealedClean = rows.filter((row) => row.seal.exists === "yes" && row.seal.onThisLine === "yes" && row.seal.underSeal === "yes").length
  const held = rows.filter((row) => row.verdict === "held").length
  const regressed = rows.filter((row) => row.verdict === "regressed").length
  const unknown = rows.filter((row) => row.verdict === "unknown").length
  const wasNotClean = rows.length - sealedClean
  return {
    kind: "attested",
    rows,
    unique: rows.length,
    sealedClean,
    held,
    regressed,
    unknown,
    wasNotClean,
    stamp: parsed.stamp,
    sealDirectory: parsed.directory,
    malformed: parsed.malformed,
  }
}

/** One line for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function attestSummaryLine(attestation: SealedAttestation): string {
  if (attestation.unique === 0) return "sealed dossier quotes no shas to attest"
  if (attestation.sealedClean === 0) return `nothing held: no sha was clean at seal time (${attestation.unique} quoted)`
  if (attestation.regressed > 0)
    return `attestation drifted: ${attestation.regressed} of ${attestation.sealedClean} sealed-clean shas regressed since sealing`
  if (attestation.unknown > 0)
    return `attestation unverifiable: ${attestation.held} held, ${attestation.unknown} of ${attestation.sealedClean} could not answer`
  return `attestation holds: ${attestation.held} of ${attestation.sealedClean} sealed-clean shas still clean`
}

/**
 * The drift report as Markdown — freshly generated, self-describing, safe to hand to a reviewer.
 * Carries the generation time, the probed directory and the file re-attested so a stale copy cannot
 * masquerade as a live check; the honesty footer states exactly what this report can and cannot prove.
 */
export function attestationReportMarkdown(
  result: Extract<AttestationResult, { kind: "attested" }>,
  nowMs: number,
  directory: string,
  fileName: string,
): string {
  const stamp = stampOf(nowMs)
  const lines: string[] = [
    "# /goal-loop sealed dossier attestation",
    "",
    `- Generated: ${stamp}`,
    `- Repository: ${directory}`,
    `- File re-attested: ${fileName}`,
    result.stamp !== undefined ? `- Sealed at: ${result.stamp}${result.sealDirectory !== undefined ? ` against ${result.sealDirectory}` : ""}` : "- Sealed at: unknown (the appendix does not carry a stamp this parser can read)",
    `- Shas named by the appendix: ${result.unique} unique`,
    "",
    "| sha | sealed (exists · line · seal) | now (exists · line · seal) | verdict |",
    "| --- | --- | --- | --- |",
  ]
  for (const row of result.rows) {
    const sealCell = `${row.seal.exists} · ${row.seal.onThisLine} · ${row.seal.underSeal}`
    const nowCell = `${row.now.exists} · ${row.now.onThisLine} · ${row.now.underSeal}`
    const verdictCell = row.verdict === "regressed" ? `regressed (${row.flipped.join(", ")})` : row.verdict
    lines.push(`| ${row.shortSha} | ${sealCell} | ${nowCell} | ${verdictCell} |`)
  }
  if (result.rows.length === 0) lines.push("| — | — | — | — |")
  lines.push(
    "",
    `- Held: ${result.held} · regressed: ${result.regressed} · unknown: ${result.unknown} · was not clean at seal time: ${result.wasNotClean}`,
    result.malformed > 0 ? `- ${result.malformed} table-looking row(s) could not be read and are excluded from every count` : "- Every table row parsed",
    "",
    "This report re-probes the shas the file names — existence in the object store, membership of this line of history, and git's signature check — against the repository at the directory named above, right now. It cannot audit the bytes around the table: an editor who rewrites appendix cells can make the file claim anything, and this report detects divergence between seal-time answers and fresh ones, not tampering with the file itself. A verdict of `regressed` means git answered yes at seal time and no right now on the named question; `unknown` means git could not answer and is counted as neither; `was-not-clean` is a sha that never qualified. Existence is not ancestry, ancestry is not the seal. The strongest thing this document can say is `held`, and it says only that three `git` processes answered yes to three questions, now.",
    "",
  )
  return lines.join("\n")
}

const SEALED_NAME_RE = /^goal-dossier-sealed-(\d{8})-(\d{6})(?:-([1-9]\d*))?\.md$/

/**
 * Picks the newest sealed-dossier filename from a candidate list (typically a directory's
 * entries). Deterministic: stamped by the embedded clock, then by the collision-attempt
 * suffix, then by mtime. Anything that is not a `goal-dossier-sealed-<stamp>[-n].md` name is
 * ignored. Returns undefined when no candidate qualifies.
 */
export function selectNewestSealedDossier(
  entries: readonly { name: string; mtimeMs: number }[],
): string | undefined {
  let best: { name: string; stamp: string; attempt: number; mtimeMs: number } | undefined
  for (const entry of entries) {
    const match = SEALED_NAME_RE.exec(entry.name)
    if (!match) continue
    const stamp = `${match[1]}-${match[2]}`
    const attempt = match[3] !== undefined ? Number(match[3]) : 1
    if (
      !best ||
      stamp > best.stamp ||
      (stamp === best.stamp && attempt > best.attempt) ||
      (stamp === best.stamp && attempt === best.attempt && entry.mtimeMs > best.mtimeMs)
    ) {
      best = { name: entry.name, stamp, attempt, mtimeMs: entry.mtimeMs }
    }
  }
  return best?.name
}
