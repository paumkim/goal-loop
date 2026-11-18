/**
 * Pure view-model behind the status dialog's `dossier` view: takes the Markdown document
 * `buildLoopDossier` produces and classifies each LINE for terminal paint — heading, quote,
 * fence, table, bullet, blank, body — stripping the structural markers (`#`, `>`) so the
 * dialog renders the record, never raw syntax noise. The classification is line-oriented and
 * deterministic; a one-pass fence state machine keeps fenced payloads verbatim even when they
 * contain marker-looking lines. No I/O, no JSX, no theme; unit-tested in `test/dossier-view.test.ts`.
 *
 * Honesty rules, same as the builder it consumes: nothing is reworded, re-wrapped, or elided —
 * every line of the document reaches the paint in order, only the two structural prefixes
 * (`# `/`## `/`### ` and `> `) are lifted into styling.
 */

export type DossierLineKind = "title" | "section" | "quote" | "fence" | "table" | "bullet" | "blank" | "body"

interface DossierLine {
  readonly kind: DossierLineKind
  readonly text: string
}

/** A standalone fence opener/closer: a line whose only content is a run of backticks (the builder emits exactly these). Returns the run length. */
const fenceRun = (line: string): number | undefined => {
  const match = /^\s*(`{3,})\s*$/.exec(line)
  return match ? match[1]!.length : undefined
}

export const dossierLines = (markdown: string): readonly DossierLine[] => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  let fenceLength: number | undefined // the open fence's backtick run; undefined = outside a fence
  const out: DossierLine[] = []
  for (const raw of lines) {
    const run = fenceRun(raw)
    if (run !== undefined) {
      if (fenceLength === undefined) {
        fenceLength = run
        out.push({ kind: "fence", text: raw.trim() })
        continue
      }
      if (run >= fenceLength) {
        fenceLength = undefined // the closer must outgrow or match the opener (CommonMark)
        out.push({ kind: "fence", text: raw.trim() })
        continue
      }
      // A shorter run inside a longer fence is payload, verbatim.
      out.push({ kind: "fence", text: raw })
      continue
    }
    if (fenceLength !== undefined) {
      out.push({ kind: "fence", text: raw })
      continue
    }
    if (raw.trim().length === 0) {
      out.push({ kind: "blank", text: "" })
      continue
    }
    if (raw.startsWith("# ")) {
      out.push({ kind: "title", text: raw.slice(2) })
      continue
    }
    if (raw.startsWith("### ")) {
      out.push({ kind: "section", text: raw.slice(4) })
      continue
    }
    if (raw.startsWith("## ")) {
      out.push({ kind: "section", text: raw.slice(3) })
      continue
    }
    if (raw === ">") {
      out.push({ kind: "quote", text: "" })
      continue
    }
    if (raw.startsWith("> ")) {
      out.push({ kind: "quote", text: raw.slice(2) })
      continue
    }
    if (raw.startsWith("|")) {
      out.push({ kind: "table", text: raw })
      continue
    }
    if (raw.startsWith("- ")) {
      out.push({ kind: "bullet", text: raw.slice(2) })
      continue
    }
    out.push({ kind: "body", text: raw })
  }
  return out
}
