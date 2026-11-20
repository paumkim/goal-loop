/**
 * Unit tests for the find-in-record module — the dossier tab's live spotlight. Matching is
 * a literal, case-insensitive substring scan; the module never reinterprets a query as a
 * pattern, never claims "match everything" for a blank query, and never prints guessed
 * offsets. Segments always tile the original line; assertions here pin that.
 */
import { describe, expect, test } from "bun:test"
import { findMatches, countMatches, segmentLine, matchLabel } from "../src/core/find.ts"

const dossierLike = [
  "Loop dossier",
  "- Condition: `ship the release notes`",
  "| turn | verdict | tools | commit | spend | verify |",
  "| 4 | met | 41 | a1b2c3d | $0.42 |",
  "v2 · met — evaluator reason: not yet",
  "The record, whole: met met met",
]

describe("findMatches", () => {
  test("a blank query marks nothing — never match-everything", () => {
    expect(findMatches(dossierLike, "")).toEqual([false, false, false, false, false, false])
    expect(findMatches(dossierLike, "   ")).toEqual([false, false, false, false, false, false])
    expect(findMatches(dossierLike, "\t")).toEqual([false, false, false, false, false, false])
  })
  test("case-insensitive, literal substring per line", () => {
    expect(findMatches(dossierLike, "MET")).toEqual([false, false, false, true, true, true])
    expect(findMatches(dossierLike, "release notes")).toEqual([false, true, false, false, false, false])
  })
  test("regex metacharacters are literals, never a pattern", () => {
    expect(findMatches(["a.b", "axb", "a(b)"], "a.b")).toEqual([true, false, false])
    expect(findMatches(["a.b", "axb", "a(b)"], "a(b)")).toEqual([false, false, true])
    expect(findMatches(["$5.00", "$5.00x"], "$5.00")).toEqual([true, true])
  })
  test("a query longer than the line matches nothing", () => {
    expect(findMatches(["met", "me"], "met ")).toEqual([false, false])
  })
})

describe("countMatches", () => {
  test("zero for a blank query", () => {
    expect(countMatches(dossierLike, "")).toBe(0)
    expect(countMatches(dossierLike, "   ")).toBe(0)
  })
  test("counts occurrences, not matching lines", () => {
    expect(countMatches(dossierLike, "met")).toBe(1 + 1 + 3) // table row + bullet + the trailing trio
    expect(countMatches(["aaaa"], "aa")).toBe(2) // non-overlapping, left to right
    expect(countMatches(["aaa"], "aa")).toBe(1)
  })
  test("case-insensitive", () => {
    expect(countMatches(["MET met Met"], "met")).toBe(3)
    expect(countMatches(["Release Notes"], "release notes")).toBe(1)
  })
  test("an occurrence at the very end of the string terminates the scan", () => {
    expect(countMatches(["commit a1b2c3d"], "a1b2c3d")).toBe(1)
  })
})

describe("segmentLine", () => {
  test("tiles the original text exactly, match flags pinned", () => {
    const segments = segmentLine("v2 · met · 6 tools", "met")
    expect(segments.map((s) => s.text).join("")).toBe("v2 · met · 6 tools")
    expect(segments).toEqual([
      { text: "v2 · ", match: false },
      { text: "met", match: true },
      { text: " · 6 tools", match: false },
    ])
  })
  test("multiple matches on one line, in order", () => {
    const segments = segmentLine("met met met", "met")
    expect(segments.map((s) => s.text).join("")).toBe("met met met")
    expect(segments.filter((s) => s.match)).toHaveLength(3)
  })
  test("no match on the line yields one whole non-match segment", () => {
    expect(segmentLine("nothing here", "met")).toEqual([{ text: "nothing here", match: false }])
  })
  test("a blank query yields one whole non-match segment", () => {
    expect(segmentLine("met met", "")).toEqual([{ text: "met met", match: false }])
    expect(segmentLine("met met", "  ")).toEqual([{ text: "met met", match: false }])
  })
  test("case folding that expands the string (İ→i̇) falls back to a whole-line match, never misaligned offsets", () => {
    const line = "İstanbul"
    const segments = segmentLine(line, "i̇")
    expect(segments.map((s) => s.text).join("")).toBe(line)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.match).toBe(true)
    expect(segmentLine(line, "zzz")).toEqual([{ text: line, match: false }])
  })
  test("a query longer than the line tiles cleanly", () => {
    expect(segmentLine("met", "metaphysics")).toEqual([{ text: "met", match: false }])
  })
  test("case-insensitive match keeps the original casing in segments", () => {
    const segments = segmentLine("Release NOTES build", "release notes")
    expect(segments.map((s) => s.text).join("")).toBe("Release NOTES build")
    expect(segments[0]).toEqual({ text: "Release NOTES", match: true })
    expect(segments[1]).toEqual({ text: " build", match: false })
  })
})

describe("matchLabel", () => {
  test("zero and junk counts read 'no matches', never a negative noun", () => {
    expect(matchLabel(0)).toBe("no matches")
    expect(matchLabel(-3)).toBe("no matches")
    expect(matchLabel(Number.NaN)).toBe("no matches")
    expect(matchLabel(Infinity)).toBe("no matches")
  })
  test("one is singular", () => {
    expect(matchLabel(1)).toBe("1 match")
  })
  test("counts floor and pluralize", () => {
    expect(matchLabel(2)).toBe("2 matches")
    expect(matchLabel(3.9)).toBe("3 matches")
    expect(matchLabel(42)).toBe("42 matches")
  })
})
