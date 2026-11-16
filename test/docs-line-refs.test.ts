/**
 * Docs line-reference guard: extracts every `file.ts[x]:N` (and `file.ts[x]:N-M`) reference from
 * docs/*.html and SPEC.md, and asserts the cited file resolves on disk and the cited lines are in
 * range — catching the silent drift class where a `file.ts:NNN` reference points at nothing after the
 * source moves. Line refs whose file cannot be resolved fail loudly.
 *
 * Appendix A of SPEC.md is explicitly frozen to the Phase-1 commit ("Line numbers refer to the tree at
 * the Phase 1 commit"), so ranges from it are asserted structurally (file exists, range in bounds, range
 * contains code), never on content. Single-line refs must land on a non-empty line.
 *
 * Bare `:NNN` fragments without an attached `file.ts[x]` token (e.g. `coordinatorFlow `:65``) cannot be
 * attributed to a file and are skipped by design; that is a docs-style choice, not an oversight.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

/** Root-relative first, then the source-tree fallbacks for refs written without a directory prefix (`git.ts:146`). */
const CANDIDATE_DIRS = [".", "src", "src/core", "src/runtime", "test", "scripts", "bin", "docs"]

const resolve = (ref: string): string | undefined => {
  for (const dir of CANDIDATE_DIRS) {
    const candidate = join(ROOT, dir, ref)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const docFiles = [
  ...readdirSync(join(ROOT, "docs"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => join("docs", name)),
  "SPEC.md",
].sort()

interface Ref {
  readonly where: string
  readonly file: string
  readonly start: number
  readonly end: number
  readonly source: string
}

const collectRefs = (): Ref[] => {
  const refs: Ref[] = []
  const pattern = /([A-Za-z0-9_./-]+\.tsx?):([0-9]+)(?:-([0-9]+))?/g
  for (const file of docFiles) {
    const text = readFileSync(join(ROOT, file), "utf8")
    for (const match of text.matchAll(pattern)) {
      const [source, refFile, startS, endS] = match as unknown as [string, string, string, string | undefined]
      const start = Number(startS)
      const end = endS === undefined ? start : Number(endS)
      refs.push({ where: file, file: refFile, start, end, source })
    }
  }
  return refs
}

const refs = collectRefs()

describe("docs line references", () => {
  test("the extraction itself finds a meaningful number of refs", () => {
    // Guards against an over-strict regex silently passing by finding zero references.
    expect(refs.length).toBeGreaterThanOrEqual(70)
    expect(refs.some((r) => r.where.startsWith("docs/"))).toBe(true)
    expect(refs.some((r) => r.where === "SPEC.md")).toBe(true)
  })

  test("every cited file exists on disk", () => {
    const missing = refs.filter((ref) => resolve(ref.file) === undefined)
    expect(missing.map((ref) => `${ref.where}: ${ref.source}`)).toEqual([])
  })

  test("every cited range is ordered and in bounds", () => {
    const out: string[] = []
    for (const ref of refs) {
      const resolved = resolve(ref.file)
      if (!resolved) continue // reported by the exists test
      if (ref.start < 1) out.push(`${ref.where}: ${ref.source} -> line numbers start at 1`)
      if (ref.end < ref.start) out.push(`${ref.where}: ${ref.source} -> range end before start`)
      const lineCount = readFileSync(resolved, "utf8").split("\n").length
      if (ref.end > lineCount) out.push(`${ref.where}: ${ref.source} -> line ${ref.end} out of range (${lineCount} lines)`)
    }
    expect(out).toEqual([])
  })

  test("every single-line ref lands on a non-empty line", () => {
    const out: string[] = []
    for (const ref of refs) {
      if (ref.start !== ref.end) continue // ranges handled below
      const resolved = resolve(ref.file)
      if (!resolved) continue
      const lines = readFileSync(resolved, "utf8").split("\n")
      if (!(lines[ref.start - 1] ?? "").trim()) out.push(`${ref.where}: ${ref.source} -> line ${ref.start} is blank`)
    }
    expect(out).toEqual([])
  })

  test("every ranged ref covers at least one non-empty line", () => {
    const out: string[] = []
    for (const ref of refs) {
      if (ref.start === ref.end) continue
      const resolved = resolve(ref.file)
      if (!resolved) continue
      const lines = readFileSync(resolved, "utf8").split("\n")
      const covered = lines.slice(ref.start - 1, ref.end).some((line) => line.trim().length > 0)
      if (!covered) out.push(`${ref.where}: ${ref.source} -> every line in ${ref.start}-${ref.end} is blank`)
    }
    expect(out).toEqual([])
  })
})
