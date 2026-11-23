/**
 * SPEC role-split guard.
 *
 * `SPEC.md` is the live spec: intro, acceptance criteria, current-behavior items, the `spec-check`
 * marker, the frozen Appendix A, verification notes, and a rolling "Recent workstreams" section. The
 * historical workstream log lives verbatim in `SPEC-workstreams.md` behind a slug index. This test keeps
 * that split from regressing: SPEC.md stays small, the live-spec anchors stay put, and no workstream
 * heading may live in both files (or be listed twice in one file).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const spec = readFileSync(join(ROOT, "SPEC.md"), "utf8")
const archive = readFileSync(join(ROOT, "SPEC-workstreams.md"), "utf8")

/** Every workstream heading, regardless of numbering style (Roman, unnumbered, or `Workstream:`). */
const workstreamHeadings = (text: string): string[] =>
  text.split("\n").filter((line) => /^## Workstream(?:\s|:)/.test(line)).map((line) => line.trim())

describe("SPEC role split", () => {
  test("SPEC.md stays a compact live spec (<= 2000 lines)", () => {
    expect(spec.split("\n").length).toBeLessThanOrEqual(2000)
  })

  test("the live-spec anchors stay in SPEC.md", () => {
    expect(spec).toContain("<!-- spec-check files=")
    expect(spec).toContain("## Acceptance criteria")
    expect(spec).toContain("## Appendix A")
    expect(spec).toContain("## Recent workstreams")
    // The glyph pins read everything before this heading; keep the intro ahead of it.
    expect(spec.split("\n## Acceptance criteria")[0]!).toContain("◦ ○ ◎ ○")
    // "Short" recent section: keep it a rolling window, not a second archive.
    const recent = spec.split("\n## Recent workstreams")[1]?.split("\n## Historical workstreams")[0] ?? ""
    const recentCount = recent.split("\n").filter((line) => /^## Workstream(?:\s|:)/.test(line)).length
    expect(recentCount).toBeGreaterThan(0)
    expect(recentCount).toBeLessThanOrEqual(15)
  })

  test("SPEC.md points readers at the historical archive", () => {
    expect(spec).toContain("SPEC-workstreams.md")
  })

  test("every workstream heading exists in exactly one of the two files", () => {
    const inSpec = workstreamHeadings(spec)
    const inArchive = workstreamHeadings(archive)
    expect(inSpec.length).toBeGreaterThan(0)
    expect(inArchive.length).toBeGreaterThan(0)
    // Pin the total so a heading silently deleted from both files cannot pass the disjointness check.
    expect(inSpec.length + inArchive.length).toBeGreaterThanOrEqual(370)
    const duplicates = inSpec.filter((heading) => inArchive.includes(heading))
    expect(duplicates).toEqual([])
    expect(new Set(inSpec).size).toBe(inSpec.length)
    expect(new Set(inArchive).size).toBe(inArchive.length)
  })

  test("the archive index has one row and one unique slug per archived workstream", () => {
    const indexText = archive.split("\n## Workstream")[0]!
    const rows = indexText.split("\n").filter((line) => /^\| .* \| `[^`]+` \| /.test(line))
    expect(rows.length).toBe(workstreamHeadings(archive).length)
    const slugs = rows.map((row) => /`([^`]+)`/.exec(row)?.[1] ?? "")
    expect(slugs.every((slug) => slug.length > 0)).toBe(true)
    // The slug is the stable key (workstream numbers are contested); duplicates make it useless.
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
