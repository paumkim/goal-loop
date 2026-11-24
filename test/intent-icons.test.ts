/**
 * Pins the live activity-icon contract: the nine nerd codepoints from the design snippet, the ASCII arm
 * that stands in under reduced color, the tool-name → intent fold, and the one-cell swap into the pill
 * that keeps the HUD's width budget intact. Pure/headless: no host, no RPC, no timer dependency.
 */
import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { AGENT_ICONS, INTENT_TTL_MS, intentAccent, intentGlyph, resolveToolIntent, withIntentGlyph, type AgentIntent } from "../src/tui.tsx"
import { pillModel } from "../src/core/hud.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const INTENTS: readonly AgentIntent[] = ["thinking", "reading", "writing", "executing", "web", "memory", "waiting", "done", "error"]

const goal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_icons",
  sessionID: "ses_icons",
  directory: "/tmp/icons",
  condition: "paint live intent icons",
  status: "active",
  setAt: 0,
  startedAt: 0,
  turns: 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [],
  loopEnabled: false,
  elapsedMs: 60_000,
  evaluating: false,
  waiting: false,
  ...overrides,
})

describe("AGENT_ICONS", () => {
  test("the nine nerd glyphs are the exact codepoints from the design", () => {
    const codepoints: Record<AgentIntent, string> = {
      thinking: "f06a9",
      reading: "f021e",
      writing: "f03eb",
      executing: "f489",
      web: "f059f",
      memory: "f02da",
      waiting: "f03e4",
      done: "f012c",
      error: "f0156",
    }
    for (const intent of INTENTS) {
      const glyph = AGENT_ICONS[intent].nerd
      expect([...glyph].length).toBe(1)
      expect(glyph.codePointAt(0)!.toString(16)).toBe(codepoints[intent])
    }
  })

  test("every nerd glyph is one terminal cell and every ascii glyph is one printable ASCII char", () => {
    for (const intent of INTENTS) {
      expect(stringWidth(AGENT_ICONS[intent].nerd)).toBe(1)
      expect(stringWidth(intentGlyph(intent))).toBe(1)
      expect(AGENT_ICONS[intent].ascii).toMatch(/^[\x21-\x7e]$/)
    }
  })

  test("the ascii arm demotes done/error to the HUD's + / x spelling, not ✓ / ✗", () => {
    expect(AGENT_ICONS.done.ascii).toBe("+")
    expect(AGENT_ICONS.error.ascii).toBe("x")
    expect(AGENT_ICONS.thinking.ascii).toBe("*") // same face as the breath's ascii arm
  })

  test("every intent carries a label", () => {
    for (const intent of INTENTS) expect(AGENT_ICONS[intent].label.length).toBeGreaterThan(0)
  })
})

describe("resolveToolIntent", () => {
  test("each tool family folds to its intent", () => {
    const cases: ReadonlyArray<readonly [string, AgentIntent]> = [
      ["read", "reading"], ["grep", "reading"], ["glob", "reading"], ["ls", "reading"],
      ["write", "writing"], ["edit", "writing"], ["patch", "writing"], ["create", "writing"],
      ["bash", "executing"], ["exec", "executing"], ["shell", "executing"], ["test", "executing"],
      ["webfetch", "web"], ["websearch", "web"], ["fetch", "web"], ["curl", "web"],
      ["memory", "memory"], ["compact", "memory"], ["history", "memory"], ["rag", "memory"],
    ]
    for (const [tool, intent] of cases) expect(resolveToolIntent(tool)).toBe(intent)
  })

  test("unknown and malformed names think rather than throwing or painting a wrong icon", () => {
    for (const tool of ["task", "subagent", "todo", "unknown", "", "   "]) expect(resolveToolIntent(tool)).toBe("thinking")
    expect(resolveToolIntent(undefined as unknown as string)).toBe("thinking")
  })

  test("tool names are folded case-insensitively", () => {
    expect(resolveToolIntent("WebFetch")).toBe("web")
    expect(resolveToolIntent("BASH")).toBe("executing")
  })

  test("first matching family wins", () => {
    // "websearch" matches both the web and search regexes of the same family; no cross-family tool wins twice.
    expect(resolveToolIntent("websearch")).toBe("web")
    expect(resolveToolIntent("memory-read")).toBe("reading")
  })
})

describe("withIntentGlyph", () => {
  test("swaps only the leading cell of a real pill line and leaves the rest byte-identical", () => {
    const text = pillModel(goal(), 60_000, false, 80, 2)!.text
    const swapped = withIntentGlyph(text, "writing")
    expect(swapped.glyph).toBe(AGENT_ICONS.writing.nerd)
    expect(swapped.rest).toBe(text.slice(1))
    expect(stringWidth(swapped.glyph + swapped.rest)).toBe(stringWidth(text))
  })

  test("the ascii swap keeps the same width", () => {
    const text = pillModel(goal(), 60_000, true, 80)!.text
    const swapped = withIntentGlyph(text, "executing", true)
    expect(swapped.glyph).toBe("$")
    expect(stringWidth(swapped.glyph + swapped.rest)).toBe(stringWidth(text))
  })

  test("an unknown intent falls back to the thinking cell instead of an empty glyph", () => {
    expect(intentGlyph("bogus" as AgentIntent)).toBe(AGENT_ICONS.thinking.nerd)
  })
})

describe("intentAccent", () => {
  test("maps every intent onto an available theme-token key", () => {
    expect(intentAccent("reading")).toBe("info")
    expect(intentAccent("web")).toBe("info")
    expect(intentAccent("writing")).toBe("warning")
    expect(intentAccent("executing")).toBe("warning")
    expect(intentAccent("waiting")).toBe("warning")
    expect(intentAccent("done")).toBe("success")
    expect(intentAccent("error")).toBe("error")
    expect(intentAccent("thinking")).toBe("muted")
    expect(intentAccent("memory")).toBe("muted")
  })

  test("the expiry window is short enough to feel live but long enough to read the icon", () => {
    expect(INTENT_TTL_MS).toBeGreaterThan(0)
    expect(INTENT_TTL_MS).toBeLessThanOrEqual(10_000)
  })
})
