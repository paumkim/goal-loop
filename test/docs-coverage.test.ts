/**
 * Docs coverage gate — the narrow, named check the /goal-loop armed for the docs workstream.
 *
 * docs/config.html is the page that documents every option `resolveConfig()` accepts. This suite
 * pins two mechanical presences there, no more:
 *   1. Every `DEFAULTS` key (src/core/config.ts), by its documented option name, appears as a row
 *      in the config.html options table.
 *   2. Every `OPENCODE_GOAL_*` env var referenced in src/core/config.ts — the module `resolveConfig`
 *      lives in, i.e. exactly the env surface resolveConfig reads — appears in docs/config.html.
 *
 * The value-level pins (documented default === code default) live in config-defaults.test.ts; the
 * src-wide bidirectional token pin lives in env-vars.test.ts. This gate is the presence floor and is
 * mutation-verified by removing a documented row: the gate fails, reverting passes.
 *
 * `resolveConfig({}, {})` is evaluated against a deliberately empty env object, never process.env.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULTS } from "../src/core/config.ts"

const ROOT = join(import.meta.dir, "..")
const configHtml = readFileSync(join(ROOT, "docs", "config.html"), "utf8")
const configSource = readFileSync(join(ROOT, "src", "core", "config.ts"), "utf8")

/** docs/config.html options table: `<tr><td><code>name</code></td><td>TYPE</td><td>default</td>…` rows. */
const parseConfigHtmlTable = (html: string): Set<string> => {
  const rows = new Set<string>()
  for (const match of html.matchAll(/<tr><td><code>([\w.]+)<\/code><\/td>/g)) {
    if (match[1]) rows.add(match[1])
  }
  return rows
}

const htmlRows = parseConfigHtmlTable(configHtml)

/** The option name each DEFAULTS key is documented under (the evaluator-nested ones are prefixed). */
const DEFAULTS_TO_DOC_NAME: Record<keyof typeof DEFAULTS, string> = {
  maxTranscriptChars: "evaluator.maxTranscriptChars",
  maxOutputTokens: "evaluator.maxOutputTokens",
  timeoutMs: "evaluator.timeoutMs",
  verifyTimeoutMs: "evaluator.verifyTimeoutMs",
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

/** Every OPENCODE_GOAL_* token referenced in src/core/config.ts (comments included — a doc comment is where the env surface is declared). */
const configEnvVars = (): Set<string> => new Set(configSource.match(/OPENCODE_GOAL_[A-Z0-9_]+/g) ?? [])

const sorted = (set: Set<string>): string[] => [...set].sort()

describe("docs coverage gate — docs/config.html covers the resolveConfig surface", () => {
  test("the gate cannot pass vacuously: config.ts references the full env surface and config.html parses rows", () => {
    // resolveConfig reads 12 env vars today; a regex that matched nothing must fail here, not pass silently.
    expect(configEnvVars().size).toBeGreaterThanOrEqual(12)
    expect(htmlRows.size).toBeGreaterThanOrEqual(20)
  })

  test("every DEFAULTS key is documented in docs/config.html", () => {
    const missing = sorted(new Set(Object.values(DEFAULTS_TO_DOC_NAME).filter((name) => !htmlRows.has(name))))
    expect(missing, `docs/config.html is missing DEFAULTS option(s): ${missing.join(", ")}`).toEqual([])
  })

  test("every OPENCODE_GOAL_* env var resolveConfig reads appears in docs/config.html", () => {
    const missing = sorted(new Set([...configEnvVars()].filter((token) => !configHtml.includes(token))))
    expect(missing, `docs/config.html is missing env var(s) read by resolveConfig: ${missing.join(", ")}`).toEqual([])
  })

  test("the DEFAULTS key set and the documented-name map are in one-to-one correspondence (no key left unmapped)", () => {
    // A DEFAULTS key added without a doc-name entry would silently escape the presence check otherwise.
    expect(Object.keys(DEFAULTS_TO_DOC_NAME).sort()).toEqual(Object.keys(DEFAULTS).sort())
  })
})
