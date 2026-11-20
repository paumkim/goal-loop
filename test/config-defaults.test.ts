/**
 * Pins the option defaults documented in README.md and docs/config.html to the code.
 *
 * Two directions, both required:
 *   1. Every key in `DEFAULTS` (src/core/config.ts) is documented in BOTH tables, with the documented
 *      default equal to the code default.
 *   2. Every option row parsed from BOTH tables names an option with a code default, and its documented
 *      default equals the resolved code default (`resolveConfig({}, {})`), normalized.
 * `resolveConfig({}, {})` evaluates against a deliberately empty env object, never process.env.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULTS, resolveConfig } from "../src/core/config.ts"

const ROOT = join(import.meta.dir, "..")
const readme = readFileSync(join(ROOT, "README.md"), "utf8")
const configHtml = readFileSync(join(ROOT, "docs", "config.html"), "utf8")

const stripTicks = (s: string): string => s.replace(/`/g, "").trim()

/** README.md options table: `| `name` | default | meaning |` rows; skips the `| Option | Default |` header. */
const parseReadmeTable = (md: string): Map<string, string> => {
  const rows = new Map<string, string>()
  for (const line of md.split("\n")) {
    const match = line.match(/^\|\s*`?([a-z][\w.]*)`?\s*\|\s*([^|]+?)\s*\|/)
    if (match && match[1] && match[2]) rows.set(match[1], stripTicks(match[2]))
  }
  return rows
}

/** docs/config.html options table: `<tr><td><code>name</code></td><td>TYPE</td><td>default</td>…` rows. */
const parseConfigHtmlTable = (html: string): Map<string, string> => {
  const rows = new Map<string, string>()
  for (const match of html.matchAll(/<tr><td><code>([\w.]+)<\/code><\/td><td>[^<]*<\/td><td>(?:<code>)?([^<]*?)(?:<\/code>)?<\/td>/g)) {
    if (match[1] && match[2]) rows.set(match[1], stripTicks(match[2]))
  }
  return rows
}

const readmeRows = parseReadmeTable(readme)
const htmlRows = parseConfigHtmlTable(configHtml)

const resolved = resolveConfig({}, {})

/** The option name each DEFAULTS key is documented under (the evaluator-nested ones are prefixed). */
const DEFAULTS_TO_DOC_NAME: Record<keyof typeof DEFAULTS, string> = {
  maxTranscriptChars: "evaluator.maxTranscriptChars",
  maxOutputTokens: "evaluator.maxOutputTokens",
  timeoutMs: "evaluator.timeoutMs",
  verifyTimeoutMs: "evaluator.verifyTimeoutMs",
  verifyProfile: "evaluator.verifyProfile",
  consensus: "evaluator.consensus",
  maxTurns: "maxTurns",
  stallTurns: "stallTurns",
  checkinMinutes: "checkinMinutes",
  maxIdleCheckins: "maxIdleCheckins",
  maxRetries: "maxRetries",
  compactAtTokens: "compactAtTokens",
  compactOnLoopIteration: "compactOnLoopIteration",
  maxLoops: "maxLoops",
  maxLoopSummaryTokens: "maxLoopSummaryTokens",
  maxConditionChars: "maxConditionChars",
  commitBranch: "commitBranch",
}

/** Code-side default per documented option name, grounded in the resolved config and DEFAULTS. */
const codeDefaultFor = (name: string): unknown => {
  switch (name) {
    case "model":
      return resolved.evaluator.model
    case "evaluator.model":
      return resolved.evaluator.model
    // The option default is "auto" (mode resolution is asserted separately below).
    case "evaluator.mode":
      return "auto"
    case "evaluator.maxTranscriptChars":
      return resolved.evaluator.maxTranscriptChars
    case "evaluator.maxOutputTokens":
      return resolved.evaluator.maxOutputTokens
    case "evaluator.timeoutMs":
      return resolved.evaluator.timeoutMs
    case "evaluator.verifyCommand":
      return resolved.evaluator.verifyCommand
    case "evaluator.verifyTimeoutMs":
      return resolved.evaluator.verifyTimeoutMs
    case "evaluator.verifyProfile":
      return resolved.evaluator.verifyProfile
    case "evaluator.verifyChecks":
      return resolved.evaluator.verifyChecks
    case "evaluator.consensus":
      return resolved.evaluator.consensus
    case "systemReminder":
      return resolved.systemReminder
    case "transcriptNotes":
      return resolved.transcriptNotes
    case "requireCommit":
      return resolved.commit.enabled
    case "coordinator":
      return resolved.commit.coordinator
    default:
      return DEFAULTS[Object.entries(DEFAULTS_TO_DOC_NAME).find(([, doc]) => doc === name)?.[0] as keyof typeof DEFAULTS]
  }
}

/** Normalize a documented default cell to its code counterpart (docs use `unlimited`, `—`, `session model`, `""`). */
const norm = (value: unknown): unknown => {
  if (value === undefined || value === null) return undefined
  if (typeof value === "number" || typeof value === "boolean") return value
  const s = String(value).trim().replace(/`/g, "").trim()
  if (Array.isArray(value) && value.length === 0) return "[]"
  if (s === "") return ""
  const numeric = Number(s.replace(/,/g, ""))
  if (!Number.isNaN(numeric) && s !== "") return numeric
  if (s === "true") return true
  if (s === "false") return false
  if (s === "unlimited") return Number.MAX_SAFE_INTEGER
  if (s === "—" || s === "session model") return undefined
  if (s === '""') return ""
  if (s === "[]") return "[]"
  return s
}

const DOC_TO_CODE_NAMES = Object.keys(
  Object.fromEntries([
    ...Object.entries(DEFAULTS_TO_DOC_NAME).map(([, doc]) => [doc, doc] as const),
    ...[
      "model",
      "evaluator.model",
      "evaluator.mode",
      "evaluator.verifyCommand",
      "evaluator.verifyProfile",
      "evaluator.verifyChecks",
      "evaluator.consensus",
      "systemReminder",
      "transcriptNotes",
      "requireCommit",
      "coordinator",
    ].map((name) => [name, name] as const),
  ]),
)

describe("config defaults — documented vs code", () => {
  test("every DEFAULTS key is documented in README.md and docs/config.html", () => {
    for (const [, docName] of Object.entries(DEFAULTS_TO_DOC_NAME)) {
      expect(readmeRows.has(docName), `README.md is missing DEFAULTS option ${docName}`).toBe(true)
      expect(htmlRows.has(docName), `docs/config.html is missing DEFAULTS option ${docName}`).toBe(true)
    }
  })

  test("every DEFAULTS value matches its documented default in both tables", () => {
    for (const [key, docName] of Object.entries(DEFAULTS_TO_DOC_NAME)) {
      const code = DEFAULTS[key as keyof typeof DEFAULTS]
      expect(norm(readmeRows.get(docName)), `README.md ${docName}`).toBe(norm(code))
      expect(norm(htmlRows.get(docName)), `docs/config.html ${docName}`).toBe(norm(code))
    }
  })

  test("every documented option row in README.md names an option with a code default, and matches it", () => {
    for (const [name, cell] of readmeRows) {
      expect(DOC_TO_CODE_NAMES, `README.md row ${name}`).toContain(name)
      expect(norm(cell), `README.md ${name}`).toBe(norm(codeDefaultFor(name)))
    }
  })

  test("every documented option row in docs/config.html names an option with a code default, and matches it", () => {
    for (const [name, cell] of htmlRows) {
      expect(DOC_TO_CODE_NAMES, `docs/config.html row ${name}`).toContain(name)
      expect(norm(cell), `docs/config.html ${name}`).toBe(norm(codeDefaultFor(name)))
    }
  })

  test("both tables document the same set of options", () => {
    expect([...readmeRows.keys()].sort()).toEqual([...htmlRows.keys()].sort())
  })

  test("resolveConfig({}, {}) resolves the DEFAULTS table to itself", () => {
    expect(resolved.evaluator.maxTranscriptChars).toBe(DEFAULTS.maxTranscriptChars)
    expect(resolved.evaluator.maxOutputTokens).toBe(DEFAULTS.maxOutputTokens)
    expect(resolved.evaluator.timeoutMs).toBe(DEFAULTS.timeoutMs)
    expect(resolved.evaluator.verifyTimeoutMs).toBe(DEFAULTS.verifyTimeoutMs)
    expect(resolved.evaluator.verifyProfile).toBe(DEFAULTS.verifyProfile)
    expect(resolved.evaluator.verifyChecks).toEqual([])
    expect(resolved.evaluator.consensus).toBe(DEFAULTS.consensus)
    expect(resolved.maxTurns).toBe(DEFAULTS.maxTurns)
    expect(resolved.stallTurns).toBe(DEFAULTS.stallTurns)
    expect(resolved.checkinMinutes).toBe(DEFAULTS.checkinMinutes)
    expect(resolved.maxIdleCheckins).toBe(DEFAULTS.maxIdleCheckins)
    expect(resolved.maxRetries).toBe(DEFAULTS.maxRetries)
    expect(resolved.maxConditionChars).toBe(DEFAULTS.maxConditionChars)
    expect(resolved.compactAtTokens).toBe(DEFAULTS.compactAtTokens)
    expect(resolved.compactOnLoopIteration).toBe(DEFAULTS.compactOnLoopIteration)
    expect(resolved.maxLoops).toBe(DEFAULTS.maxLoops)
    expect(resolved.maxLoopSummaryTokens).toBe(DEFAULTS.maxLoopSummaryTokens)
    expect(resolved.commit.branch).toBe(DEFAULTS.commitBranch)
  })

  test("the documented 'unlimited' maxConditionChars is MAX_SAFE_INTEGER in code", () => {
    expect(DEFAULTS.maxConditionChars).toBe(Number.MAX_SAFE_INTEGER)
    expect(norm(readmeRows.get("maxConditionChars"))).toBe(Number.MAX_SAFE_INTEGER)
    expect(norm(htmlRows.get("maxConditionChars"))).toBe(Number.MAX_SAFE_INTEGER)
  })

  test("maxConditionChars: the floor lets 0 and small values through (documented default stays unlimited)", () => {
    expect(resolveConfig({}, {}).maxConditionChars).toBe(Number.MAX_SAFE_INTEGER)
    expect(resolveConfig({ maxConditionChars: 0 }, {}).maxConditionChars).toBe(0)
    expect(resolveConfig({ maxConditionChars: 5 }, {}).maxConditionChars).toBe(5)
  })

  test("evaluator.mode documents 'auto'; 'auto' without a model resolves to 'session'", () => {
    expect(norm(readmeRows.get("evaluator.mode"))).toBe("auto")
    expect(norm(htmlRows.get("evaluator.mode"))).toBe("auto")
    // 'auto' is the option default; with no model configured it resolves to 'session'.
    expect(resolved.evaluator.mode).toBe("session")
  })

  test("requireCommit documents 'true' and resolves to enabled by default", () => {
    expect(norm(readmeRows.get("requireCommit"))).toBe(true)
    expect(norm(htmlRows.get("requireCommit"))).toBe(true)
    expect(resolved.commit.enabled).toBe(true)
  })

  test("model and evaluator.model mocked as unset by default", () => {
    expect(resolved.evaluator.model).toBeUndefined()
    expect(norm(readmeRows.get("model"))).toBeUndefined()
    expect(norm(htmlRows.get("model"))).toBeUndefined()
    expect(norm(readmeRows.get("evaluator.model"))).toBeUndefined()
    expect(norm(htmlRows.get("evaluator.model"))).toBeUndefined()
  })

  test("coordinator documents 'auto' and resolves to 'auto' by default", () => {
    expect(norm(readmeRows.get("coordinator"))).toBe("auto")
    expect(norm(htmlRows.get("coordinator"))).toBe("auto")
    expect(resolved.commit.coordinator).toBe("auto")
  })
})
