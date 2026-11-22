/**
 * Unit tests for the dossier index — the `goal.dossier.index` palette command's artifact.
 * What is pinned here is the contract: the kind classifier is exact (anchored, case-sensitive,
 * the exporters' own stamp shape, `.md` only); the builder renders exact byte counts and
 * sha256 digests over the exact bytes read, sorted by name, with the skipped-count note when
 * a matching file could not be read; the index inventories and never verifies; the directory
 * path never appears; a previous index is listed as kind `index` but the index being written
 * never lists itself; the write is O_EXCL with collision suffixes; and the summary line
 * carries every arm.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildDossierIndex,
  dossierArtifactKind,
  dossierIndexName,
  dossierIndexSummaryLine,
  exportDossierIndex,
  scanDossierArtifacts,
} from "../src/core/dossier-index.ts"
import type { DossierIndexEntry } from "../src/core/dossier-index.ts"

const now = 1_800_000_000_000 // 2027-01-15T08:00:00Z — a fixed clock keeps every assertion deterministic
const content = "the dossier left the process\n"
const contentSha = "525fe9f28b760e7c7b5379e9560c36c4e2756bd61d3a954dc413d2c90713a22f" // sha256 of `content`
const contentBytes = Buffer.byteLength(content, "utf8")

const entry = (
  name: string,
  kind: DossierIndexEntry["kind"],
  bytes = contentBytes,
  sha256 = contentSha,
): DossierIndexEntry => ({ name, kind, bytes, sha256 })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "goal-dossier-index-test-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("dossierIndexName", () => {
  test("stamps the UTC clock stem and suffixes collisions", () => {
    expect(dossierIndexName(now)).toBe("goal-dossier-index-20270115-080000.md")
    expect(dossierIndexName(now, 1)).toBe("goal-dossier-index-20270115-080000-2.md")
    expect(dossierIndexName(now, 41)).toBe("goal-dossier-index-20270115-080000-42.md")
  })

  test("a non-finite clock stamps the epoch rather than throwing", () => {
    expect(dossierIndexName(Number.NaN)).toBe("goal-dossier-index-19700101-000000.md")
    expect(dossierIndexName(Number.POSITIVE_INFINITY)).toBe("goal-dossier-index-19700101-000000.md")
  })
})

describe("dossierArtifactKind", () => {
  test("classifies every family, with and without a retry suffix", () => {
    expect(dossierArtifactKind("goal-dossier-20261116-172233.md")).toBe("dossier")
    expect(dossierArtifactKind("goal-dossier-review-20261116-172233.md")).toBe("review")
    expect(dossierArtifactKind("goal-dossier-sealed-20261116-172233.md")).toBe("sealed")
    expect(dossierArtifactKind("goal-spend-ledger-20261116-172233.md")).toBe("spend ledger")
    expect(dossierArtifactKind("goal-dossier-index-20261116-172233.md")).toBe("index")
    expect(dossierArtifactKind("goal-dossier-20261116-172233-2.md")).toBe("dossier")
    expect(dossierArtifactKind("goal-spend-ledger-20261116-172233-42.md")).toBe("spend ledger")
  })

  test("rejects near-misses: wrong shape, bad suffixes, wrong case, missing extension", () => {
    expect(dossierArtifactKind("goal-dossier-20261116-17233.md")).toBeUndefined() // 5-digit time
    expect(dossierArtifactKind("goal-dossier-2026111-172233.md")).toBeUndefined() // 7-digit date
    expect(dossierArtifactKind("goal-dossier-20261116-172233-0.md")).toBeUndefined() // suffix starts at 2
    expect(dossierArtifactKind("goal-dossier-20261116-172233-01.md")).toBeUndefined() // no leading zeros
    expect(dossierArtifactKind("goal-dossier-20261116-172233.txt")).toBeUndefined()
    expect(dossierArtifactKind("Goal-dossier-20261116-172233.md")).toBeUndefined() // case-sensitive
    expect(dossierArtifactKind("goal-dossier-notes-20261116-172233.md")).toBeUndefined()
    expect(dossierArtifactKind("goal-dossier-review-2026.md")).toBeUndefined()
    expect(dossierArtifactKind("other.md")).toBeUndefined()
    expect(dossierArtifactKind("goal-dossier-20261116-172233.md.bak")).toBeUndefined()
  })
})

describe("buildDossierIndex", () => {
  test("renders one row per artifact with exact bytes, sha256, kind and inline-code name", () => {
    const built = buildDossierIndex(
      [
        entry("goal-dossier-sealed-20261116-172300.md", "sealed"),
        entry("goal-dossier-20261116-172233.md", "dossier"),
      ],
      now,
    )
    expect(built.artifacts).toBe(2)
    expect(built.bytes).toBe(contentBytes * 2)
    expect(built.markdown).toContain("# Goal dossier index")
    expect(built.markdown).toContain(`_Generated 2027-01-15T08:00:00.000Z`)
    expect(built.markdown).toContain("## Artifacts (2 files, " + built.bytes + " bytes)")
    expect(built.markdown).toContain(`| \`goal-dossier-sealed-20261116-172300.md\` | sealed | ${contentBytes} | ${contentSha} |`)
    expect(built.markdown).toContain(`| \`goal-dossier-20261116-172233.md\` | dossier | ${contentBytes} | ${contentSha} |`)
  })

  test("an empty scan renders the honest None sentence and claims no rows", () => {
    const built = buildDossierIndex([], now)
    expect(built.artifacts).toBe(0)
    expect(built.bytes).toBe(0)
    expect(built.skipped).toBe(0)
    expect(built.markdown).toContain("None — the directory holds no exported dossier artifacts")
    expect(built.markdown).not.toContain("| file | kind |")
  })

  test("unreadable matches are counted, never listed, and named in the index", () => {
    const built = buildDossierIndex([entry("goal-dossier-20261116-172233.md", "dossier")], now, 2)
    expect(built.skipped).toBe(2)
    expect(built.markdown).toContain("2 matching files could not be read (I/O error) and are not listed above")
    expect(built.markdown).toContain("not zero")
  })

  test("the skipped count must be a non-negative integer", () => {
    expect(() => buildDossierIndex([], now, -1)).toThrow("non-negative integer")
    expect(() => buildDossierIndex([], now, 1.5)).toThrow("non-negative integer")
    expect(() => buildDossierIndex([], now, -1)).toThrow("skipped must be a non-negative integer, got -1")
    expect(() => buildDossierIndex([], now, 1.5)).toThrow("skipped must be a non-negative integer, got 1.5")
  })

  test("the same inputs render the same document, byte for byte", () => {
    const entries = [
      entry("goal-spend-ledger-20261116-172233.md", "spend ledger"),
      entry("goal-dossier-review-20261116-172300.md", "review", 10, "0".repeat(64)),
    ]
    expect(buildDossierIndex(entries, now).markdown).toBe(buildDossierIndex(entries, now).markdown)
  })

  test("the document inventories, never verifies, and leaks no directory path", () => {
    const built = buildDossierIndex([entry("goal-dossier-20261116-172233.md", "dossier")], now)
    expect(built.markdown).toContain("This index inventories; it does not verify")
    expect(built.markdown).toContain("this index inventories, it does not verify.")
    expect(built.markdown).not.toContain(tmpdir())
    expect(built.markdown).not.toContain(dir)
  })
})

describe("scanDossierArtifacts", () => {
  test("reads regular files, measures the bytes, hashes them, sorts by name, skips the rest", () => {
    writeFileSync(join(dir, "goal-dossier-20261116-172233.md"), content)
    writeFileSync(join(dir, "goal-dossier-sealed-20261116-172233.md"), "smaller\n")
    writeFileSync(join(dir, "not-a-dossier.md"), "ignored\n")
    mkdirSync(join(dir, "goal-spend-ledger-20261116-172233.md")) // a directory is not an artifact
    writeFileSync(join(dir, "goal-dossier-20261116-172234.md.bak"), "ignored suffix\n")
    const scan = scanDossierArtifacts(dir)
    expect(scan.skipped).toBe(0)
    expect(scan.entries.map((e) => e.name)).toEqual([
      "goal-dossier-20261116-172233.md",
      "goal-dossier-sealed-20261116-172233.md",
    ])
    const first = scan.entries[0]!
    expect(first.kind).toBe("dossier")
    expect(first.bytes).toBe(contentBytes)
    expect(first.sha256).toBe(contentSha)
    const second = scan.entries[1]!
    expect(second.kind).toBe("sealed")
    expect(second.bytes).toBe(Buffer.byteLength("smaller\n", "utf8"))
  })

  test("an empty directory scans to no entries and nothing skipped", () => {
    expect(scanDossierArtifacts(dir)).toEqual({ entries: [], skipped: 0 })
  })
})

describe("exportDossierIndex", () => {
  test("writes one O_EXCL file whose rows match the artifacts on disk", () => {
    writeFileSync(join(dir, "goal-dossier-20261116-172233.md"), content)
    const result = exportDossierIndex(now, dir)
    expect(result.attempts).toBe(1)
    expect(result.path).toBe(join(dir, "goal-dossier-index-20270115-080000.md"))
    expect(existsSync(result.path)).toBe(true)
    const raw = readFileSync(result.path, "utf8")
    expect(result.bytes).toBe(Buffer.byteLength(raw, "utf8"))
    expect(raw).toContain(`| \`goal-dossier-20261116-172233.md\` | dossier | ${contentBytes} | ${contentSha} |`)
    expect(result.artifacts).toBe(1)
    expect(result.artifactBytes).toBe(contentBytes)
    expect(result.skipped).toBe(0)
  })

  test("a pre-existing stem is never overwritten — the write suffixes -2 and both files survive", () => {
    const stem = join(dir, "goal-dossier-index-20270115-080000.md")
    writeFileSync(stem, "the previous index\n")
    const result = exportDossierIndex(now, dir)
    expect(result.attempts).toBe(2)
    expect(result.path).toBe(join(dir, "goal-dossier-index-20270115-080000-2.md"))
    expect(readFileSync(stem, "utf8")).toBe("the previous index\n")
    expect(readFileSync(result.path, "utf8")).toContain("# Goal dossier index")
  })

  test("the export never lists the index being written, but a previous index is listed as kind index", () => {
    writeFileSync(join(dir, "goal-dossier-index-20261116-172233.md"), content)
    const result = exportDossierIndex(now, dir)
    const raw = readFileSync(result.path, "utf8")
    expect(raw).toContain("| `goal-dossier-index-20261116-172233.md` | index |")
    expect(raw).not.toContain(result.path.split("/").pop() as string)
  })

  test("a missing directory throws with the filesystem's own message", () => {
    expect(() => exportDossierIndex(now, join(dir, "does-not-exist"))).toThrow()
  })

  test("the written file is itself classified as an artifact by the kind classifier", () => {
    const result = exportDossierIndex(now, dir)
    expect(dossierArtifactKind(result.path.split("/").pop() as string)).toBe("index")
    expect(readdirSync(dir).filter((n) => dossierArtifactKind(n) === "index")).toHaveLength(1)
  })
})

describe("dossierIndexSummaryLine", () => {
  test("zero artifacts arm names the count, including the unreadable ones", () => {
    expect(dossierIndexSummaryLine({ artifacts: 0, artifactBytes: 0, skipped: 0 })).toBe(
      "dossier index written: no artifacts found",
    )
    expect(dossierIndexSummaryLine({ artifacts: 0, artifactBytes: 0, skipped: 2 })).toBe(
      "dossier index written: no artifacts found; 2 unreadable (not listed)",
    )
  })

  test("the complete arm names artifacts and bytes exactly", () => {
    expect(dossierIndexSummaryLine({ artifacts: 3, artifactBytes: 12345, skipped: 0 })).toBe(
      "dossier index written: 3 artifacts, 12345 bytes",
    )
    expect(dossierIndexSummaryLine({ artifacts: 1, artifactBytes: 12, skipped: 0 })).toBe(
      "dossier index written: 1 artifact, 12 bytes",
    )
  })

  test("the partial arm carries the unreadable count", () => {
    expect(dossierIndexSummaryLine({ artifacts: 2, artifactBytes: 100, skipped: 1 })).toBe(
      "dossier index written: 2 artifacts, 100 bytes; 1 unreadable (not listed)",
    )
  })
})
