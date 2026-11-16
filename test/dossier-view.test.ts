/**
 * Tests for the dossier view-model (`dossierLines`) — the classifier behind the dialog's
 * `dossier` view. The contract under test: line order is preserved exactly, every line maps
 * to exactly one kind, the two structural prefixes are lifted into kinds (and only those),
 * and marker-looking lines inside a fence stay fence payload verbatim.
 */
import { describe, expect, test } from "bun:test"
import { buildLoopDossier } from "../src/core/dossier.ts"
import { dossierLines, type DossierLineKind } from "../src/core/dossier-view.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const kinds = (markdown: string): DossierLineKind[] => dossierLines(markdown).map((line) => line.kind)
const texts = (markdown: string): string[] => dossierLines(markdown).map((line) => line.text)

const baseline = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const goal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_test",
  sessionID: "ses_test",
  directory: "/tmp/test",
  condition: "ship the release notes",
  status: "active",
  setAt: 1_800_000_000_000 - 42 * 60_000,
  startedAt: 1_800_000_000_000 - 42 * 60_000,
  turns: 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline,
  history: [{ turn: 1, verdict: "not_met", reason: "docs build still fails", at: 1_800_000_000_000 - 60_000 }],
  elapsedMs: 1000,
  evaluating: false,
  waiting: false,
  ...overrides,
})

describe("dossierLines — the structural contract", () => {
  test("every line is classified, in order, one row per line", () => {
    const markdown = "# Title\n\n## Section\n\n- bullet\n\n> quote\n\nbody"
    expect(kinds(markdown)).toEqual(["title", "blank", "section", "blank", "bullet", "blank", "quote", "blank", "body"])
    expect(dossierLines(markdown).length).toBe(9)
  })

  test("an empty document classifies to a single blank row — never a crash", () => {
    expect(dossierLines("")).toEqual([{ kind: "blank", text: "" }])
    expect(dossierLines("\n")).toEqual([{ kind: "blank", text: "" }, { kind: "blank", text: "" }])
  })

  test("the two structural prefixes are lifted; everything else paints as written", () => {
    expect(texts("# Goal loop dossier")).toEqual(["Goal loop dossier"])
    expect(texts("## Objective")).toEqual(["Objective"])
    expect(texts("### Iteration v2 — met")).toEqual(["Iteration v2 — met"])
    expect(texts("> quoted reason line")).toEqual(["quoted reason line"])
    expect(texts("- Turns: 4 · Tool calls: 41")).toEqual(["Turns: 4 · Tool calls: 41"])
    expect(texts("| turn | verdict |")).toEqual(["| turn | verdict |"])
    expect(texts("_Generated 2026-11-16…_")).toEqual(["_Generated 2026-11-16…_"]) // emphasis is paint-neutral body
  })

  test("# vs ## is title vs section, and a bare > is an empty quote row", () => {
    expect(kinds("# a\n## b\n### c\n>\n> ")).toEqual(["title", "section", "section", "quote", "quote"])
    expect(texts(">")).toEqual([""])
  })

  test("lines inside a fence stay verbatim even when they look like markdown", () => {
    const markdown = "```\n# not a title\n> not a quote\n- not a bullet\n```\nafter"
    expect(kinds(markdown)).toEqual(["fence", "fence", "fence", "fence", "fence", "body"])
    expect(texts(markdown)[1]).toBe("# not a title")
    expect(texts(markdown)[2]).toBe("> not a quote")
    expect(texts(markdown)[5]).toBe("after")
  })

  test("a fence whose payload outgrew the fence backticks — the state machine pairs on runs of 3+", () => {
    const markdown = "````\n```\ninside\n```\n````\nout"
    expect(kinds(markdown)).toEqual(["fence", "fence", "fence", "fence", "fence", "body"])
    expect(texts(markdown)[2]).toBe("inside")
  })

  test("a CRLF document classifies identically to its LF twin", () => {
    const lf = "# t\n\n> q\n\n- b"
    expect(kinds(lf.replace(/\n/g, "\r\n"))).toEqual(kinds(lf))
    expect(texts(lf.replace(/\n/g, "\r\n"))).toEqual(texts(lf))
  })
})

describe("dossierLines — against the builder's real output", () => {
  const markdown = buildLoopDossier(goal({ loopEnabled: true, loopIteration: 2, loopMaxLoops: 5, loopObjective: "make every iteration visible", loopHistory: [{ version: 1, condition: "add a bar", summary: "Added a bar.", reason: "met", turns: 9, toolCalls: 41, endedAt: 1_800_000_000_000 - 27 * 60_000 }] }), 1_800_000_000_000)

  test("the document's skeleton survives classification: title, sections, quote, table, bullets, fence-free", () => {
    const lines = dossierLines(markdown)
    expect(lines[0]).toEqual({ kind: "title", text: "Goal loop dossier" })
    expect(kinds(markdown)).toContain("section")
    expect(kinds(markdown)).toContain("quote")
    expect(kinds(markdown)).toContain("table")
    expect(kinds(markdown)).toContain("bullet")
    expect(kinds(markdown)).not.toContain("fence") // this record carries no fenced blocks
  })

  test("no line of the document is dropped, added, or reordered", () => {
    const expected = markdown.split("\n")
    const got = dossierLines(markdown)
    expect(got.length).toBe(expected.length)
    // Title/section/quote/bullet lose their structural prefix; everything else is the raw line.
    const strip = (line: string): string =>
      line.startsWith("### ") ? line.slice(4) : line.startsWith("## ") ? line.slice(3) : line.startsWith("# ") ? line.slice(2) : line.startsWith("> ") ? line.slice(2) : line.startsWith("- ") ? line.slice(2) : line
    for (let i = 0; i < expected.length; i++) {
      expect(got[i]!.text).toBe(strip(expected[i]!))
    }
  })

  test("a fenced verify tail keeps its marker-looking lines as fence payload", () => {
    const withVerify = buildLoopDossier(goal({ lastVerify: { command: "bun test", code: 1, at: 1_800_000_000_000 - 1000, tail: "# failing\n> excerpt\n| a | b |" } }), 1_800_000_000_000)
    const lines = dossierLines(withVerify)
    const fenceIndex = lines.findIndex((line) => line.kind === "fence")
    expect(fenceIndex).toBeGreaterThan(-1)
    const payload = lines.slice(fenceIndex + 1).filter((line) => line.kind === "fence").map((line) => line.text)
    expect(payload.slice(0, 3)).toEqual(["# failing", "> excerpt", "| a | b |"])
  })
})
