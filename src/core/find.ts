/**
 * Find-in-record, pure: the dossier tab's live spotlight. Given the rendered line texts
 * and a query, decide which lines match, count the occurrences, split one line into
 * highlighted segments, and label the count for the paint. No I/O, no JSX, no theme;
 * unit-tested in `test/find.test.ts`.
 *
 * Honesty rules, same as the rest of the plugin: matching is a LITERAL, case-insensitive
 * substring scan — a query is never reinterpreted as a pattern; a blank query matches
 * nothing (it is not "match everything"); offsets are trusted only when case folding
 * preserves string length, and when it does not (e.g. ß→ss, İ→i̇) the line is still found
 * and counted faithfully but painted as one whole "match" segment rather than with
 * misaligned highlights — the copy is never dressed up with guessed offsets; a non-finite
 * or negative input clamps rather than throwing.
 */

/** One piece of a line, flagged for the paint. Segments always tile the original text in order. */
export interface FindSegment {
  readonly text: string
  readonly match: boolean
}

/** Case fold that also reports whether it preserved length. The length check is what certifies offsets. */
const fold = (text: string): string => text.toLowerCase()

const contains = (foldText: string, foldQuery: string): boolean => foldText.includes(foldQuery)

const isBlank = (query: string): boolean => query.trim().length === 0

/**
 * Per line: does the lowered line contain the lowered query? Literal, case-insensitive.
 * A blank query (after trim) marks nothing — the spotlight has nothing to say.
 */
export const findMatches = (texts: readonly string[], query: string): readonly boolean[] => {
  if (isBlank(query)) return texts.map(() => false)
  const q = fold(query)
  return texts.map((text) => contains(fold(text), q))
}

/**
 * Total occurrences across all lines (non-overlapping, left to right). Zero for a blank
 * query. Counts real occurrences, not matching lines — "3" means three places the record
 * says the word, wherever they are.
 */
export const countMatches = (texts: readonly string[], query: string): number => {
  if (isBlank(query)) return 0
  const q = fold(query)
  let total = 0
  for (const text of texts) {
    const line = fold(text)
    let index = line.indexOf(q)
    while (index !== -1) {
      total += 1
      index = line.indexOf(q, index + q.length)
    }
  }
  return total
}

/**
 * Split one line into segments for the paint. When case folding preserves length (the
 * overwhelmingly common case), segments tile the ORIGINAL string with exact offsets. When
 * it does not, the honest fallback kicks in: a containing line returns one whole-match
 * segment (the paint can bold it, never misalign it); a non-containing line returns one
 * whole non-match segment. Segments always tile the original text in order, and their
 * concatenation is always the input string.
 */
export const segmentLine = (text: string, query: string): readonly FindSegment[] => {
  if (isBlank(query)) return [{ text, match: false }]
  const q = fold(query)
  const line = fold(text)
  if (line.length !== text.length || q.length !== query.length) {
    return contains(line, q) ? [{ text, match: true }] : [{ text, match: false }]
  }
  const first = line.indexOf(q)
  if (first === -1) return [{ text, match: false }]
  const segments: FindSegment[] = []
  let cursor = 0
  let index = first
  while (index !== -1) {
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false })
    segments.push({ text: text.slice(index, index + q.length), match: true })
    cursor = index + q.length
    index = line.indexOf(q, cursor)
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false })
  return segments
}

/** The count's spoken words for the find row: "1 match" / "N matches" / "no matches". Never a bare numeral without its noun. */
export const matchLabel = (count: number): string => {
  if (!Number.isFinite(count) || count <= 0) return "no matches"
  const n = Math.floor(count)
  return `${n} ${n === 1 ? "match" : "matches"}`
}
