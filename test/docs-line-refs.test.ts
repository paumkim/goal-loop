/**
 * Docs citation guard. SPEC.md still cites `file.ts[x]:N` (Appendix A is explicitly frozen to the
 * Phase-1 commit, so its ranges are asserted structurally: file exists, range in bounds, range
 * contains code; single-line refs must land on a non-empty line). SPEC.md refs keep that guard.
 *
 * docs/*.html cites `file · symbol` instead of file:line (re-anchored 2026-11-17): line citations
 * drifted semantically on every workstream — lines existed but pointed at the wrong constructs —
 * while the docs:check freshness gate only verifies stamps and the changelog, so the rot passed CI
 * invisibly. This test therefore forbids `file.ts[x]:N` citations in docs/*.html outright: if one
 * reappears, point it at a symbol instead of a line.
 *
 * Bare `:NNN` fragments without an attached `file.ts[x]` token cannot be attributed to a file and are
 * ignored by both scopes.
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

const docHtml = readdirSync(join(ROOT, "docs"))
  .filter((name) => name.endsWith(".html"))
  .map((name) => join("docs", name))
const docFiles = [...docHtml, "SPEC.md"].sort()

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
const docsRefs = refs.filter((ref) => ref.where.startsWith("docs/"))
const specRefs = refs.filter((ref) => ref.where === "SPEC.md")

describe("docs line references", () => {
  test("docs/*.html cite file · symbol, never file:line (SPEC.md keeps its frozen Appendix A refs)", () => {
    // The line-ref class drifted semantically between workstreams while the freshness gate stayed green;
    // symbol citations cannot. Forbid it here so it cannot creep back in through edits.
    expect(docsRefs.map((ref) => `${ref.where}: ${ref.source}`)).toEqual([])
    // Guards against the SPEC.md extraction silently going empty (Appendix A is frozen: refs must not shrink).
    expect(specRefs.length).toBeGreaterThanOrEqual(20)
  })

  test("every cited SPEC.md file exists on disk", () => {
    const missing = specRefs.filter((ref) => resolve(ref.file) === undefined)
    expect(missing.map((ref) => `${ref.where}: ${ref.source}`)).toEqual([])
  })

  test("every cited SPEC.md range is ordered and in bounds", () => {
    const out: string[] = []
    for (const ref of specRefs) {
      const resolved = resolve(ref.file)
      if (!resolved) continue // reported by the exists test
      if (ref.start < 1) out.push(`${ref.where}: ${ref.source} -> line numbers start at 1`)
      if (ref.end < ref.start) out.push(`${ref.where}: ${ref.source} -> range end before start`)
      const lineCount = readFileSync(resolved, "utf8").split("\n").length
      if (ref.end > lineCount) out.push(`${ref.where}: ${ref.source} -> line ${ref.end} out of range (${lineCount} lines)`)
    }
    expect(out).toEqual([])
  })

  test("every single-line SPEC.md ref lands on a non-empty line", () => {
    const out: string[] = []
    for (const ref of specRefs) {
      if (ref.start !== ref.end) continue // ranges handled below
      const resolved = resolve(ref.file)
      if (!resolved) continue
      const lines = readFileSync(resolved, "utf8").split("\n")
      if (!(lines[ref.start - 1] ?? "").trim()) out.push(`${ref.where}: ${ref.source} -> line ${ref.start} is blank`)
    }
    expect(out).toEqual([])
  })

  test("every ranged SPEC.md ref covers at least one non-empty line", () => {
    const out: string[] = []
    for (const ref of specRefs) {
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
