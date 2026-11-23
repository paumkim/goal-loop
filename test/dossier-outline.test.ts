/**
 * Unit tests for `src/core/dossier-outline.ts` — the pure section slicer behind the dialog's
 * outline rail. Fixtures are hand-written string literals except the two builder-backed cases,
 * which assert the outline of a real `buildLoopDossier` document.
 */
import { describe, expect, test } from "bun:test"
import type { GoalSnapshot, UsageSnapshot } from "../src/core/types.ts"
import { buildLoopDossier } from "../src/core/dossier.ts"
import { dossierOutline, DOSSIER_OUTLINE_LABEL_MAX } from "../src/core/dossier-outline.ts"
import stringWidth from "string-width"

const DOC = [
  "# Goal loop dossier",
  "",
  "_provenance line_",
  "",
  "## Objective",
  "",
  "> world-class mouse-first goal TUI",
  "",
  "## Status",
  "",
  "- Status: active",
  "",
  "## Completed iterations (1)",
  "",
  "### Iteration v1 — met",
  "",
  "- Turns: 9",
  "",
  "## Verdict trail (2 evaluated turns)",
  "",
  "| turn | verdict |",
  "",
  "## Boundary compaction",
  "",
  "No boundary-compaction request on this record.",
  "",
  "## Verify gate",
  "",
  "No verify gate result on this record.",
  "",
  "## Totals",
  "",
  "- Iterations complete: 1",
  "",
  "---",
  "_footer_",
].join("\n")

describe("dossierOutline", () => {
  test("a fenced `## ` line is payload — never a heading", () => {
    const doc = [
      "# Title",
      "",
      "## Real",
      "",
      "```",
      "## Fake",
      "```",
      "",
      "## Second",
      "",
      "text",
    ].join("\n")
    const outline = dossierOutline(doc)
    expect(outline.map((entry) => entry.title)).toEqual(["Real", "Second"])
    expect(outline[0]!.raw).toContain("## Fake")
  })

  test("a shorter backtick run inside a longer fence is payload — the fence does not close early (CommonMark)", () => {
    const doc = [
      "# Title",
      "",
      "## Foo",
      "",
      "````",
      "```",
      "## Not a heading",
      "```",
      "````",
      "",
      "## Bar",
      "",
      "text",
    ].join("\n")
    const outline = dossierOutline(doc)
    expect(outline.map((entry) => entry.title)).toEqual(["Foo", "Bar"])
  })

  test("the `# ` title never opens a section", () => {
    const outline = dossierOutline(["# Goal loop dossier", "", "body"].join("\n"))
    expect(outline).toEqual([])
  })

  test("`### ` headings never open a section — `### Iteration vN` stays inside its parent", () => {
    const outline = dossierOutline(DOC)
    expect(outline.every((entry) => !entry.title.startsWith("#"))).toBe(true)
    expect(outline.map((entry) => entry.title)).not.toContain("Iteration v1 — met")
    const iterations = outline.find((entry) => entry.label === "iterations")!
    expect(iterations.raw).toContain("### Iteration v1 — met")
  })

  test("`> ## ` and `- ## ` never open a section — only flush-left `## ` does", () => {
    const doc = [
      "# Title",
      "",
      "> ## Quoted",
      "- ## Bulleted",
      "## Real",
      "",
      "text",
    ].join("\n")
    const outline = dossierOutline(doc)
    expect(outline.map((entry) => entry.title)).toEqual(["Real"])
  })

  test("a loop document outlines objective → status → iterations → verdicts → compaction → verify → totals, in order", () => {
    const outline = dossierOutline(DOC)
    expect(outline.map((entry) => entry.label)).toEqual([
      "objective",
      "status",
      "iterations",
      "verdicts",
      "compaction",
      "verify",
      "totals",
    ])
  })

  test("sections partition the document from the first `## ` to EOF — raws rejoin byte-for-byte", () => {
    const lines = DOC.split("\n")
    const first = lines.findIndex((line) => line.startsWith("## "))
    const outline = dossierOutline(DOC)
    expect(outline[0]!.startLine).toBe(first)
    expect(outline[outline.length - 1]!.endLine).toBe(lines.length)
    expect(outline.map((entry) => entry.raw).join("\n")).toBe(lines.slice(first).join("\n"))
    for (let i = 1; i < outline.length; i += 1) {
      expect(outline[i]!.startLine).toBe(outline[i - 1]!.endLine)
    }
  })

  test("each raw starts with its heading line and excludes the next section", () => {
    const outline = dossierOutline(DOC)
    const status = outline.find((entry) => entry.id === "status")!
    expect(status.raw.startsWith("## Status\n")).toBe(true)
    expect(status.raw).not.toContain("## Completed iterations")
  })

  test("ids de-dupe identical headings with -2, -3…", () => {
    const doc = ["## Custom", "", "a", "", "## Custom", "", "b", "", "## Custom", "", "c"].join("\n")
    const outline = dossierOutline(doc)
    expect(outline.map((entry) => entry.id)).toEqual(["custom", "custom-2", "custom-3"])
  })

  test("a heading whose own slug is a generated suffix does not steal another heading's id", () => {
    const doc = ["## Custom", "", "a", "", "## Custom-2", "", "b", "", "## Custom", "", "c"].join("\n")
    const outline = dossierOutline(doc)
    expect(outline.map((entry) => entry.id)).toEqual(["custom", "custom-2", "custom-3"])
    expect(new Set(outline.map((entry) => entry.id)).size).toBe(outline.length)
  })

  test("labels are ≤ 12 columns — known labels fit, unknown headings truncate with a trailing ellipsis", () => {
    for (const entry of dossierOutline(DOC)) {
      expect(entry.label.length).toBeLessThanOrEqual(DOSSIER_OUTLINE_LABEL_MAX)
    }
    const doc = "## Some Extraordinarily Long Custom Heading\n\nbody"
    const [entry] = dossierOutline(doc)
    expect(entry!.label.length).toBe(DOSSIER_OUTLINE_LABEL_MAX)
    expect(entry!.label.endsWith("…")).toBe(true)
    expect(entry!.label).not.toContain("……")
  })

  test("labels are ≤ 12 cells — CJK headings are measured in cells, not UTF-16 code units", () => {
    const doc = "## 中文标题非常非常长的内容写不下去了\n\nbody"
    const [entry] = dossierOutline(doc)
    expect(stringWidth(entry!.label)).toBeLessThanOrEqual(DOSSIER_OUTLINE_LABEL_MAX)
    expect(entry!.label.endsWith("…")).toBe(true)
  })

  test("CRLF and CR line endings normalize to LF — identical entries either way", () => {
    const crlf = DOC.replace(/\n/g, "\r\n")
    const cr = DOC.replace(/\n/g, "\r")
    expect(dossierOutline(crlf)).toEqual(dossierOutline(DOC))
    expect(dossierOutline(cr)).toEqual(dossierOutline(DOC))
  })

  test("known headings tolerate the trailing `(…)` suffix — `Completed iterations (2)` labels as `iterations`", () => {
    const outline = dossierOutline(DOC)
    expect(outline.map((entry) => entry.id)).toContain("completed-iterations-1")
    expect(outline.find((entry) => entry.id === "completed-iterations-1")!.label).toBe("iterations")
    expect(outline.find((entry) => entry.id === "verdict-trail-2-evaluated-turns")!.label).toBe("verdicts")
  })
})

const now = 1_800_000_000_000
const zero: UsageSnapshot = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

const loopedGoal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal-outline",
  sessionID: "ses_outline",
  directory: "/tmp/outline",
  condition: "make every loop iteration visible at a glance",
  status: "active",
  reason: "not met: the trail still hides iteration 2",
  setAt: now - 1000 * 60 * 90,
  startedAt: now - 1000 * 60 * 90,
  turns: 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: zero,
  history: [
    { turn: 1, verdict: "not_met", reason: "trail done, snapshots missing", at: now - 1000 * 60 * 60, toolCalls: 9 },
    { turn: 2, verdict: "met", reason: "all snapshots green", at: now - 1000 * 60 * 5, toolCalls: 4 },
  ],
  loopEnabled: true,
  loopIteration: 2,
  loopObjective: "world-class mouse-first goal TUI",
  loopMaxLoops: 5,
  loopHistory: [
    {
      version: 1,
      condition: "add a progress bar",
      summary: "Added the bar and the caption.",
      reason: "met: bar renders at 80 columns",
      turns: 9,
      toolCalls: 41,
      endedAt: now - 1000 * 60 * 60,
    },
  ],
  loopNotProgress: 0,
  elapsedMs: 1000 * 60 * 90,
  evaluating: false,
  waiting: false,
  ...overrides,
})

describe("dossierOutline on a real buildLoopDossier document", () => {
  test("the loop dossier outlines exactly the seven expected sections, and reconstruction holds", () => {
    const doc = buildLoopDossier(loopedGoal(), now)
    const outline = dossierOutline(doc)
    expect(outline.map((entry) => entry.label)).toEqual([
      "objective",
      "status",
      "iterations",
      "verdicts",
      "compaction",
      "re-anchor",
      "verify",
      "totals",
    ])
    const lines = doc.split("\n")
    const first = lines.findIndex((line) => line.startsWith("## "))
    expect(outline.map((entry) => entry.raw).join("\n")).toBe(lines.slice(first).join("\n"))
    for (const entry of outline) expect(entry.raw.startsWith("## ")).toBe(true)
  })

  test("an empty verify section (no verifyCommand record) is still outlined", () => {
    const doc = buildLoopDossier(loopedGoal(), now) // no lastVerify on the fixture
    expect(doc).toContain("No verify gate result on this record.")
    const outline = dossierOutline(doc)
    const verify = outline.find((entry) => entry.label === "verify")
    expect(verify).toBeDefined()
    expect(verify!.raw).toContain("## Verify gate")
    expect(verify!.raw).toContain("No verify gate result on this record.")
  })

  test("a plain goal's dossier outlines condition first, with no iterations section", () => {
    const { loopEnabled: _a, loopIteration: _b, loopObjective: _c, loopMaxLoops: _d, loopHistory: _e, loopNotProgress: _f, ...rest } = loopedGoal()
    const doc = buildLoopDossier({ ...rest, id: "goal-plain-outline" }, now)
    const outline = dossierOutline(doc)
    expect(outline[0]!.label).toBe("condition")
    expect(outline.map((entry) => entry.label)).not.toContain("iterations")
    expect(outline.map((entry) => entry.label)).toContain("verify")
  })
})
