/**
 * Pure view-model behind the status dialog's `dossier` outline rail: takes the Markdown document
 * `buildLoopDossier` produces and cuts it into its sections, one chip per `## ` heading, so each
 * chip can quote that section verbatim. The classification is line-oriented and deterministic; a
 * one-pass fence state machine (the same pairing rules as `dossierLines`) keeps fenced payloads
 * verbatim even when they contain marker-looking lines. No I/O, no JSX, no theme; unit-tested in
 * `test/dossier-outline.test.ts`.
 *
 * Honesty rules, same as the builder it consumes: nothing is reworded, re-wrapped, or elided —
 * every section's `raw` is the document's own bytes for that section, heading included, and the
 * sections partition the document from the first `## ` heading to EOF.
 */

export interface DossierOutlineEntry {
  /** stable slug id derived from the heading (lowercase, alnum/dash, de-duped -2, -3…). */
  readonly id: string
  /** chip label, ≤ 12 columns; known headings get hand labels; unknown ones truncate with … (ascii "..."). */
  readonly label: string
  /** the heading text verbatim (after the leading `## `). */
  readonly title: string
  /** 0-based index of the section's first line (the `## ` line). */
  readonly startLine: number
  /** one past the last line of the section (next heading's index or lines.length). */
  readonly endLine: number
  /** verbatim Markdown of the section, heading included, lines joined by "\n" (no trailing newline). */
  readonly raw: string
}

export const DOSSIER_OUTLINE_LABEL_MAX = 12

/** A standalone fence opener/closer: a line whose only content is a run of backticks (the builder emits exactly these). Returns the run length. */
const fenceRun = (line: string): number | undefined => {
  const match = /^\s*(`{3,})\s*$/.exec(line)
  return match ? match[1]!.length : undefined
}

/** Heading text → stable slug: lowercase, runs of non-alnum collapse to one dash, edge dashes trimmed. */
const slugOf = (text: string): string => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.length > 0 ? slug : "section"
}

/** Hand labels for the headings the builder emits; matched by lowercased prefix, tolerating the trailing `(…)` suffix. */
const HAND_LABELS: readonly (readonly [prefix: string, label: string])[] = [
  ["objective", "objective"],
  ["condition", "condition"],
  ["status", "status"],
  ["completed iterations", "iterations"],
  ["verdict trail", "verdicts"],
  ["boundary compaction", "compaction"],
  ["re-anchor", "re-anchor"],
  ["verify gate", "verify"],
  ["totals", "totals"],
]

const labelOf = (title: string): string => {
  const lower = title.toLowerCase()
  for (const [prefix, label] of HAND_LABELS) {
    if (lower.startsWith(prefix)) return label
  }
  if (title.length <= DOSSIER_OUTLINE_LABEL_MAX) return title
  return `${title.slice(0, DOSSIER_OUTLINE_LABEL_MAX - 1)}…`
}

export const dossierOutline = (markdown: string): readonly DossierOutlineEntry[] => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  let fenceLength: number | undefined // the open fence's backtick run; undefined = outside a fence
  const headings: { readonly line: number; readonly title: string }[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!
    const run = fenceRun(raw)
    if (run !== undefined) {
      if (fenceLength === undefined) {
        fenceLength = run
        continue
      }
      if (run >= fenceLength) {
        fenceLength = undefined // the closer must outgrow or match the opener (CommonMark)
        continue
      }
      // A shorter run inside a longer fence is payload, verbatim.
      continue
    }
    if (fenceLength !== undefined) continue // `## ` inside a fence is payload, never a heading
    if (raw.startsWith("## ")) {
      headings.push({ line: i, title: raw.slice(3) })
    }
  }
  const seen = new Map<string, number>()
  const out: DossierOutlineEntry[] = []
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i]!
    const endLine = i + 1 < headings.length ? headings[i + 1]!.line : lines.length
    const base = slugOf(heading.title)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    const id = count === 0 ? base : `${base}-${count + 1}`
    out.push({
      id,
      label: labelOf(heading.title),
      title: heading.title,
      startLine: heading.line,
      endLine,
      raw: lines.slice(heading.line, endLine).join("\n"),
    })
  }
  return out
}
