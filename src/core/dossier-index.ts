/**
 * The inventory, one file — `goal.dossier.index` scans one directory (the host's cwd) for the
 * dossier family's exported artifacts and writes ONE O_EXCL markdown index: file name, kind,
 * bytes (UTF-8), sha256 — then totals, then an honesty footer. Pure name and content
 * construction; the I/O lives at the edges — `readdirSync`/`readFileSync` for the scan and a
 * single synchronous `writeFileSync(..., "wx")` for the write, which is what makes "never
 * overwrites" a guarantee of the filesystem rather than a promise of this module.
 * Unit-tested in `test/dossier-index.test.ts`.
 *
 * What counts as an exported dossier artifact is exactly four families plus this index's own:
 *   - `goal-dossier-<stamp>[-n].md`         kind `dossier`       (goal.dossier.export)
 *   - `goal-dossier-review-<stamp>[-n].md`  kind `review`        (goal.dossier.review)
 *   - `goal-dossier-sealed-<stamp>[-n].md`  kind `sealed`        (goal.dossier.seal)
 *   - `goal-spend-ledger-<stamp>[-n].md`    kind `spend ledger`  (goal.dossier.spend)
 *   - `goal-dossier-index-<stamp>[-n].md`   kind `index`         (this command)
 * The stamps are the exporters' own `<YYYYMMDD-HHMMSS>` clocks and the retry suffixes are
 * `[1-9]\d*`, so a file whose name merely starts like one of these is not an artifact.
 *
 * Honesty rules, same as the rest of the plugin:
 *   - Only regular files directly in the named directory are considered — never recursion,
 *     never directories, never dotfiles that fail the stamp regex. The scan reads each
 *     candidate's exact bytes; `bytes` is the byte length of those bytes and `sha256` is
 *     computed over them, not over a path or a mtime.
 *   - A candidate that cannot be read (I/O error, race with a writer) is counted in
 *     `skipped` and the index says how many were left out — never silently dropped, and
 *     never listed with invented bytes or a guessed digest.
 *   - The index inventories; it does not verify. Files can change after generation and a
 *     matching sha256 at generation time proves nothing about the present — the footer says so.
 *   - The directory path is omitted from the document on purpose, so a pasted index leaks
 *     nothing about where it came from. File names ride the inline-code fence so they cannot
 *     forge document structure.
 *   - The write is O_EXCL with collision retries; a failed write throws with the
 *     filesystem's own message and the host toasts it. No directory is created, moved, or
 *     removed — the target is always the existing directory the caller names.
 *   - This index never lists the index being written: the scan happens before the write, and
 *     a previous `goal-dossier-index-*` IS listed (as kind `index`) because it is a real
 *     artifact of a previous run — the inventory is complete, not self-concealing.
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { isoOf, inlineCode } from "./dossier.ts"
import { MAX_EXPORT_ATTEMPTS } from "./dossier-export.ts"

const pad = (n: number): string => String(n).padStart(2, "0")

/**
 * `goal-dossier-index-20261116-172233.md` from a clock; attempt > 0 appends `-attempt` (`-2`, `-3`, ...).
 * Deterministic: the same (nowMs, attempt) always yields the same name. A non-finite or
 * unrepresentable clock stamps the epoch rather than throwing — the name stays honest.
 */
export const dossierIndexName = (nowMs: number, attempt = 0): string => {
  const date = new Date(Number.isFinite(nowMs) ? nowMs : 0)
  const valid = Number.isFinite(date.getTime()) ? date : new Date(0)
  const stamp =
    `${valid.getUTCFullYear()}${pad(valid.getUTCMonth() + 1)}${pad(valid.getUTCDate())}` +
    `-${pad(valid.getUTCHours())}${pad(valid.getUTCMinutes())}${pad(valid.getUTCSeconds())}`
  const suffix = attempt > 0 ? `-${attempt + 1}` : ""
  return `goal-dossier-index-${stamp}${suffix}.md`
}

type DossierArtifactKind = "dossier" | "review" | "sealed" | "spend ledger" | "index"

/** The stamp the exporters write: `<YYYYMMDD>-<HHMMSS>` plus an optional `-n` retry suffix (1-based, never `-0` or `-01`). */
const STAMP = String.raw`\d{8}-\d{6}(?:-[1-9]\d*)?`
const KIND_PATTERNS: ReadonlyArray<readonly [DossierArtifactKind, RegExp]> = [
  ["dossier", new RegExp(`^goal-dossier-${STAMP}\\.md$`)],
  ["review", new RegExp(`^goal-dossier-review-${STAMP}\\.md$`)],
  ["sealed", new RegExp(`^goal-dossier-sealed-${STAMP}\\.md$`)],
  ["spend ledger", new RegExp(`^goal-spend-ledger-${STAMP}\\.md$`)],
  ["index", new RegExp(`^goal-dossier-index-${STAMP}\\.md$`)],
]

/**
 * Classifies a file name as one of the dossier family's exported artifacts. Returns undefined
 * for anything else — case-sensitively, anchored, `.md` only, and with the exporters' own
 * stamp shape required (a date-like prefix is not enough; the digits and lengths must match).
 */
export const dossierArtifactKind = (name: string): DossierArtifactKind | undefined => {
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(name)) return kind
  }
  return undefined
}

export interface DossierIndexEntry {
  /** The file's name, not its path — the directory is deliberately not part of the document. */
  readonly name: string
  readonly kind: DossierArtifactKind
  /** Byte length of the exact bytes read (UTF-8 file content). */
  readonly bytes: number
  /** Lowercase hex sha256 of the exact bytes read. */
  readonly sha256: string
}

interface ScannedDossierArtifacts {
  /** The readable artifacts, sorted by name (a timestamped order). */
  readonly entries: readonly DossierIndexEntry[]
  /** Candidates that matched the artifact shape but could not be read (I/O error). Never listed; always counted. */
  readonly skipped: number
}

/**
 * Scans `dir` for dossier-family artifacts. I/O by design and kept out of `buildDossierIndex`:
 * reads each candidate fully, measures the bytes it read, hashes them. Directories and
 * non-regular files never match the artifact shape and are ignored without a note; a matching
 * regular file that fails the read is counted in `skipped`. Results are sorted by name so the
 * document is deterministic for a stable directory.
 */
export function scanDossierArtifacts(dir: string): ScannedDossierArtifacts {
  const targetDir = resolve(dir)
  const candidates: string[] = []
  for (const item of readdirSync(targetDir, { withFileTypes: true })) {
    if (!item.isFile()) continue
    if (dossierArtifactKind(item.name) === undefined) continue
    candidates.push(item.name)
  }
  const entries: DossierIndexEntry[] = []
  let skipped = 0
  for (const name of candidates) {
    const kind = dossierArtifactKind(name) as DossierArtifactKind
    try {
      const bytes = readFileSync(join(targetDir, name))
      entries.push({ name, kind, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })
    } catch {
      skipped += 1 // counted, never listed, never guessed
    }
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { entries, skipped }
}

interface BuiltDossierIndex {
  /** The complete index document. */
  readonly markdown: string
  /** Artifacts listed (the readable ones). */
  readonly artifacts: number
  /** Sum of the listed artifacts' bytes. */
  readonly bytes: number
  /** Matching regular files that could not be read and are not listed. */
  readonly skipped: number
}

/**
 * Renders the index. Deterministic: the same entries, skipped count and clock render the same
 * document, byte for byte. `nowMs` is the caller's clock — nothing here reads Date.now().
 */
export function buildDossierIndex(
  entries: readonly DossierIndexEntry[],
  nowMs: number,
  skipped = 0,
): BuiltDossierIndex {
  if (!Number.isInteger(skipped) || skipped < 0) throw new Error(`skipped must be a non-negative integer, got ${skipped}`)
  const stamp = isoOf(nowMs)
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  const lines: string[] = []

  lines.push("# Goal dossier index")
  lines.push("")
  lines.push(
    `_Generated ${stamp}. Every row below is a file the dossier family exported into the directory this index was written from, read at generation time: file name, kind, bytes (UTF-8), sha256 of the exact bytes read. The directory path is omitted on purpose. This index inventories; it does not verify — a file can change after generation and a matching digest here proves nothing about the present._`,
  )
  lines.push("")

  lines.push(`## Artifacts (${entries.length} file${entries.length === 1 ? "" : "s"}, ${totalBytes} bytes)`)
  lines.push("")
  if (entries.length === 0) {
    lines.push("None — the directory holds no exported dossier artifacts the dossier family recognizes. No rows are claimed.")
    lines.push("")
  } else {
    lines.push("| file | kind | bytes | sha256 |", "| --- | --- | ---: | --- |")
    for (const entry of entries) {
      lines.push(`| ${inlineCode(entry.name)} | ${entry.kind} | ${entry.bytes} | ${entry.sha256} |`)
    }
    lines.push("")
  }
  if (skipped > 0) {
    lines.push(
      `- ${skipped} matching file${skipped === 1 ? "" : "s"} could not be read (I/O error) and ${skipped === 1 ? "is" : "are"} not listed above; ${skipped === 1 ? "its" : "their"} bytes and digests are unknown, not zero.`,
    )
    lines.push("")
  }

  lines.push("---")
  lines.push(
    "_goal-loop dossier index · source: the files at generation time · sha256 computed over the exact bytes read · nothing was estimated or inferred; an unreadable file is counted, never guessed · this index inventories, it does not verify._",
  )

  return {
    markdown: lines.join("\n"),
    artifacts: entries.length,
    bytes: totalBytes,
    skipped,
  }
}

interface DossierIndexExportResult {
  /** Absolute path of the written file. */
  readonly path: string
  /** Bytes written (UTF-8). */
  readonly bytes: number
  /** How many candidate names were tried (1 = the plain name was free). */
  readonly attempts: number
  /** Artifacts listed (the readable ones). */
  readonly artifacts: number
  /** Sum of the listed artifacts' bytes. */
  readonly artifactBytes: number
  /** Matching regular files that could not be read and are not listed. */
  readonly skipped: number
}

/**
 * Scans `dir` for dossier-family artifacts and writes the index as one new file inside it
 * (the caller passes the host's cwd). Never overwrites: the write is O_EXCL and collisions
 * retry with a numeric suffix, up to `MAX_EXPORT_ATTEMPTS`. Throws — never resolves partial —
 * when no candidate name is free, when the directory cannot be read, or when the directory
 * rejects the write; the message is the filesystem's own.
 */
export function exportDossierIndex(nowMs: number, dir: string): DossierIndexExportResult {
  const targetDir = resolve(dir)
  const scan = scanDossierArtifacts(targetDir)
  const built = buildDossierIndex(scan.entries, nowMs, scan.skipped)
  const bytes = Buffer.byteLength(built.markdown, "utf8")
  for (let attempt = 0; attempt < MAX_EXPORT_ATTEMPTS; attempt++) {
    const path = join(targetDir, dossierIndexName(nowMs, attempt))
    try {
      writeFileSync(path, built.markdown, { encoding: "utf8", flag: "wx" })
      return {
        path,
        bytes,
        attempts: attempt + 1,
        artifacts: built.artifacts,
        artifactBytes: built.bytes,
        skipped: built.skipped,
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === "EEXIST") continue // the stem collided — try the next suffix, never clobber
      throw error
    }
  }
  throw new Error(`no free dossier index filename after ${MAX_EXPORT_ATTEMPTS} attempts in ${targetDir}`)
}

/** The one-line outcome for the toast and the tests. No glyphs, no color — callers paint their own chrome. */
export function dossierIndexSummaryLine(
  result: Pick<DossierIndexExportResult, "artifacts" | "artifactBytes" | "skipped">,
): string {
  const skipped =
    result.skipped > 0 ? `; ${result.skipped} unreadable (not listed)` : ""
  if (result.artifacts === 0) return `dossier index written: no artifacts found${skipped}`
  return `dossier index written: ${result.artifacts} artifact${result.artifacts === 1 ? "" : "s"}, ${result.artifactBytes} bytes${skipped}`
}
