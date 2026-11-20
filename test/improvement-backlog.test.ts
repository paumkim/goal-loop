import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  findBacklogDedupeMatches,
  inspectImprovementBacklog,
  normalizeDedupeKey,
  parseImprovementBacklog,
  selectNextBacklogItem,
  validateImprovementBacklog,
  type ImprovementBacklog,
  type ImprovementBacklogItem,
} from "../src/core/improvement-backlog.ts"

const ROOT = join(import.meta.dir, "..")

function item(overrides: Partial<ImprovementBacklogItem> = {}): ImprovementBacklogItem {
  return {
    id: "sample-item",
    title: "Sample item",
    category: "planning",
    priority: 2,
    impact: "medium",
    risk: "low",
    status: "open",
    finding: "A finding.",
    improvement: "An improvement.",
    evidence: ["evidence"],
    dedupeKeys: ["sample-item"],
    ...overrides,
  }
}

function backlog(items: ImprovementBacklogItem[], overrides: Partial<ImprovementBacklog> = {}): ImprovementBacklog {
  return { version: 1, items, ...overrides }
}

describe("normalizeDedupeKey", () => {
  test("lowercases, trims, and collapses separators", () => {
    expect(normalizeDedupeKey("  Verification  Matrix__Beyond Check  ")).toBe("verification-matrix-beyond-check")
    expect(normalizeDedupeKey("a---b")).toBe("a-b")
    expect(normalizeDedupeKey("")).toBe("")
  })
})

describe("validateImprovementBacklog", () => {
  test("accepts a well-formed backlog", () => {
    const result = validateImprovementBacklog(backlog([item()]))
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  test("rejects non-object and malformed structure", () => {
    expect(validateImprovementBacklog(null).ok).toBe(false)
    expect(validateImprovementBacklog({ version: 1, items: "nope" }).issues[0]?.path).toBe("$.items")
  })

  test("reports duplicate ids and missing required fields", () => {
    const result = validateImprovementBacklog({
      version: 1,
      items: [
        item({ id: "dup" }),
        item({ id: "dup", title: "", finding: "", improvement: "", evidence: "bad" as unknown as string[], dedupeKeys: "bad" as unknown as string[] }),
      ],
    })
    expect(result.ok).toBe(false)
    const messages = result.issues.map((issue) => `${issue.path}:${issue.message}`)
    expect(messages.some((m) => m.includes("$.items[1].id") && m.includes("duplicate id"))).toBe(true)
    expect(messages.some((m) => m.includes("$.items[1].title"))).toBe(true)
    expect(messages.some((m) => m.includes("$.items[1].evidence"))).toBe(true)
    expect(messages.some((m) => m.includes("$.items[1].dedupeKeys"))).toBe(true)
  })

  test("rejects invalid enums and non-finite priority", () => {
    const result = validateImprovementBacklog(
      backlog([item({ impact: "urgent" as never, risk: "extreme" as never, status: "todo" as never, priority: Number.NaN })]),
    )
    expect(result.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["$.items[0].impact", "$.items[0].risk", "$.items[0].status", "$.items[0].priority"]),
    )
  })
})

describe("parseImprovementBacklog", () => {
  test("throws on invalid JSON and invalid schema", () => {
    expect(() => parseImprovementBacklog("{")).toThrow(/not valid JSON/)
    expect(() => parseImprovementBacklog(JSON.stringify({ version: 0, items: [] }))).toThrow(/invalid improvement backlog/)
  })

  test("parses a valid backlog", () => {
    const parsed = parseImprovementBacklog(JSON.stringify(backlog([item()])))
    expect(parsed.version).toBe(1)
    expect(parsed.items[0]?.id).toBe("sample-item")
  })
})

describe("findBacklogDedupeMatches", () => {
  test("detects collisions on normalized dedupe keys across items", () => {
    const matches = findBacklogDedupeMatches([
      item({ id: "a", dedupeKeys: ["shared-key", "Verification Matrix"] }),
      item({ id: "b", dedupeKeys: ["verification__matrix"] }),
      item({ id: "c", dedupeKeys: ["other"] }),
    ])
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.some((m) => m.left === "a" && m.right === "b")).toBe(true)
  })

  test("returns no matches for distinct keys", () => {
    expect(findBacklogDedupeMatches([item({ id: "a", dedupeKeys: ["x"] }), item({ id: "b", dedupeKeys: ["y"] })])).toEqual([])
  })
})

describe("selectNextBacklogItem", () => {
  test("prefers lower priority, then higher impact, then lower risk, then id", () => {
    const items = [
      item({ id: "z-low", priority: 2, impact: "high", risk: "low" }),
      item({ id: "a-high-pri", priority: 1, impact: "medium", risk: "medium" }),
      item({ id: "b-same-pri-lower-impact", priority: 1, impact: "low", risk: "low" }),
      item({ id: "c-same-pri-impact-riskier", priority: 1, impact: "medium", risk: "high" }),
    ]
    expect(selectNextBacklogItem(items)?.id).toBe("a-high-pri")
  })

  test("skips non-open statuses by default and honors completed ids/keys", () => {
    const items = [
      item({ id: "done", status: "done", priority: 1 }),
      item({ id: "blocked", status: "blocked", priority: 1 }),
      item({ id: "completed-by-key", status: "open", priority: 1, dedupeKeys: ["same-thing"] }),
      item({ id: "pick-me", status: "open", priority: 2 }),
    ]
    expect(selectNextBacklogItem(items, { completedDedupeKeys: ["same_thing"] })?.id).toBe("pick-me")
  })

  test("can select explicit statuses such as in_progress", () => {
    const items = [item({ id: "wip", status: "in_progress", priority: 1 })]
    expect(selectNextBacklogItem(items)?.id).toBeUndefined()
    expect(selectNextBacklogItem(items, { statuses: ["in_progress"] })?.id).toBe("wip")
  })

  test("excludes completed ids", () => {
    const items = [item({ id: "a", priority: 1 }), item({ id: "b", priority: 2 })]
    expect(selectNextBacklogItem(items, { completedIds: ["a"] })?.id).toBe("b")
  })
})

describe("repo improvement backlog artifact", () => {
  test("docs/improvement-backlog.json is valid, seeded, and de-duplicated", () => {
    const text = readFileSync(join(ROOT, "docs", "improvement-backlog.json"), "utf8")
    const inspected = inspectImprovementBacklog(text)
    expect(inspected.validation.ok).toBe(true)
    expect(inspected.backlog.version).toBe(1)
    expect(inspected.backlog.items.length).toBeGreaterThanOrEqual(8)

    const ids = inspected.backlog.items.map((entry) => entry.id)
    expect(ids).toContain("persistent-prioritized-backlog-dedup")
    expect(ids).toContain("verification-matrix-beyond-check")
    expect(ids).toContain("failure-signature-strategy-escalation")

    // No cross-item dedupe collisions in the seed ledger.
    expect(inspected.dedupeMatches).toEqual([])

    const highest = selectNextBacklogItem(inspected.backlog.items)
    expect(highest).toBeDefined()
    // Priority 1 open/in_progress items may be completed over time; highest selected open item is valid and prioritized.
    expect(highest!.priority).toBeGreaterThanOrEqual(1)
    expect(highest!.priority).toBeLessThanOrEqual(2)
  })
})
