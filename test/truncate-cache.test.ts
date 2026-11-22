/**
 * `truncate` now memoizes a pure computation. The risk is a stale or mis-keyed hit, so this pins the
 * cached result against an INDEPENDENT oracle that reimplements the original algorithm with a fresh
 * Intl.Segmenter and the raw `string-width` library (cellWidth itself is pinned equal to stringWidth
 * in cell-width.test.ts). Covers custom ellipses, CJK, emoji, combining marks, zero/negative limits
 * and ellipsis-wider-than-budget — on cold and warm calls.
 */
import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { truncate } from "../src/core/format.ts"

const seg = new Intl.Segmenter("en", { granularity: "grapheme" })
const w = (s: string) => stringWidth(s)
const oracle = (text: string, max: number, ellipsis = "\u2026"): string => {
  if (max <= 0) return ""
  const flat = text.replace(/\s+/g, " ").trim()
  if (w(flat) <= max) return flat
  const ew = w(ellipsis)
  if (ew >= max) {
    let fitted = "", used = 0
    for (const { segment } of seg.segment(ellipsis)) {
      const sw = w(segment)
      if (used + sw > max) break
      fitted += segment
      used += sw
    }
    return fitted
  }
  const budget = max - ew
  let out = "", used = 0
  for (const { segment } of seg.segment(flat)) {
    const sw = w(segment)
    if (used + sw > budget) break
    out += segment
    used += sw
  }
  return `${out.replace(/\s+$/, "")}${ellipsis}`
}

describe("truncate memo", () => {
  test("cold and warm results equal the uncached oracle for every edge shape", () => {
    const texts = [
      "ship the release notes now please", "床前明月光疑是地上霜举头望明月低头思故乡",
      "ship the 🚀 release notes now", "ab👨‍👩‍👧‍👦cd", "abe\u0301fghij",
      "  padded   text  ", "short", "", "x".repeat(200),
    ]
    const configs: readonly [number, string][] = [
      [0, "\u2026"], [-3, "\u2026"], [1, "\u2026"], [2, "..."], [5, "\u2026"],
      [13, "\u2026"], [42, "\u2026"], [64, "\u2026"], [4, "02"],
    ]
    for (const [max, ellipsis] of configs) {
      for (const text of texts) {
        // Two passes: the second hits the memo for every tuple populated by the first.
        for (let pass = 0; pass < 2; pass++) expect(truncate(text, max, ellipsis)).toBe(oracle(text, max, ellipsis))
      }
    }
  })
})
