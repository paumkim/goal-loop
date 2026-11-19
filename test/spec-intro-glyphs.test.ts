/**
 * SPEC.md's intro (everything before `## Acceptance criteria`) quotes the shipped glyphs and the
 * context menu's size. Each was pinned once by tests only in the code's own suites, so the prose could
 * drift free of the renderer — and did: the breath wave was quoted as `· • ● •` (shipped `◦ ○ ◎ ○`), the
 * waiting ring as a small `○` (shipped large `◯`), the menu as "four fixed rows" (shipped six), and the
 * terminal acknowledgment as `◎` (shipped `●`). This test reads the intro and pins it against the code
 * that renders those glyphs, so the drift cannot come back silently.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { breathGlyph, contextMenuRows, pillModel, terminalPill } from "../src/core/hud.ts"
import type { GoalSnapshot, UsageSnapshot } from "../src/core/types.ts"

const intro = readFileSync(join(import.meta.dir, "..", "SPEC.md"), "utf8").split("\n## Acceptance criteria")[0]!

const baseline: UsageSnapshot = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

const snapshot = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_spec",
  sessionID: "ses_spec",
  directory: "/tmp/spec",
  condition: "make the intro quote the shipped glyphs",
  status: "active",
  reason: "Evaluator: not yet",
  setAt: 0,
  startedAt: 0,
  turns: 4,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline,
  history: [],
  loopEnabled: false,
  elapsedMs: 1000 * 60 * 12,
  evaluating: false,
  waiting: false,
  ...overrides,
})

describe("SPEC.md intro quotes the shipped glyphs", () => {
  test("the breath wave is quoted exactly as breathGlyph renders it (◦ ○ ◎ ○), not the old dot burst", () => {
    const wave = [0, 1, 2, 3].map((phase) => breathGlyph(phase)).join(" ")
    expect(wave).toBe("\u25E6 \u25CB \u25CE \u25CB")
    expect(intro).toContain(`\`${wave}\``)
    expect(intro).not.toContain("`\u00B7 \u2022 \u25CF \u2022`")
  })

  test("the waiting ring is quoted as the large hollow ring stateGlyph paints, not the small resting `○`", () => {
    // pillModel's leading cell is the state glyph; a waiting goal (nothing in flight) paints U+25EF.
    const waitingGlyph = pillModel(snapshot({ waiting: true }), 0).text.slice(0, 1)
    expect(waitingGlyph).toBe("\u25EF")
    expect(intro).toContain(`(\`${waitingGlyph}\`)`)
    expect(intro).not.toContain("(`\u25CB`)")
  })

  test("the context menu is described as six fixed rows and every shipped row text is quoted", () => {
    const rows = contextMenuRows({ hasReason: true, hasSummary: true, hasDossier: true })
    expect(rows.length).toBe(6)
    expect(intro).toContain("six fixed rows")
    expect(intro).not.toContain("four fixed rows")
    for (const row of rows) expect(intro).toContain(`\`${row.text}\``)
  })

  test("the terminal acknowledgment is quoted as the `●` terminalGlyph paints, not `◎`", () => {
    const text = terminalPill(snapshot({ status: "achieved" }), 1000 * 60 * 12)!.text
    expect(text).toBe("\u25CF goal achieved \u00B7 12m \u00B7 4 turns")
    expect(intro).toContain(`\`${text}\``)
    expect(intro).toContain("`\u25CF loop complete \u00B7 v")
    expect(intro).not.toContain("\u25CE goal achieved")
  })
})
