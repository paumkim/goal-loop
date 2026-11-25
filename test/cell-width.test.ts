/**
 * `cellWidth` is a memoized wrapper over `string-width`; its contract is to return exactly the same
 * number for every input, cached or not. No behavior may change for ASCII, CJK, emoji, combining
 * marks, ANSI escapes or the empty string.
 */
import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { cellWidth } from "../src/core/format.ts"

describe("cellWidth cached width", () => {
  test("matches string-width byte-for-byte across representative inputs, including repeats", () => {
    const inputs = [
      "", "plain ascii", "  padded  ", "\u001b[31mred\u001b[0m",
      "世", "世".repeat(20), "🎉", "e\u0301", "a\tb", "· — ◎ ○ ●",
      "x".repeat(2000),
    ]
    for (const input of inputs) {
      expect(cellWidth(input)).toBe(stringWidth(input))
      expect(cellWidth(input)).toBe(stringWidth(input)) // second call is a cache hit
    }
  })
})
