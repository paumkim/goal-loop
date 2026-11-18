/**
 * Pins the OPENCODE_GOAL_* environment surface to the documents that explain it.
 * Every `OPENCODE_GOAL_*` name read (i.e. referenced anywhere) in src/ must be documented in BOTH
 * README.md and docs/config.html, and every name documented in either file must actually be referenced
 * in src/ — so the documented env list can never drift in either direction.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

const TOKEN = /OPENCODE_GOAL_[A-Z0-9_]+/g

const tokensIn = (text: string): Set<string> => new Set(text.match(TOKEN) ?? [])

/** Every OPENCODE_GOAL_* occurrence anywhere under src/ (config.ts reads the option overrides; index.ts reads PROBE). */
const srcTokens = (): Set<string> => {
  const found = new Set<string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) for (const token of tokensIn(readFileSync(full, "utf8"))) found.add(token)
    }
  }
  walk(join(ROOT, "src"))
  return found
}

const src = srcTokens()
const readme = tokensIn(readFileSync(join(ROOT, "README.md"), "utf8"))
const configHtml = tokensIn(readFileSync(join(ROOT, "docs", "config.html"), "utf8"))

const sorted = (set: Set<string>): string[] => [...set].sort()

describe("OPENCODE_GOAL_* environment variables", () => {
  test("src/ references at least one variable (the suite cannot pass vacuously)", () => {
    expect(src.size).toBeGreaterThanOrEqual(10)
  })

  test("every variable read in src/ is documented in README.md", () => {
    expect(sorted(new Set([...src].filter((token) => !readme.has(token))))).toEqual([])
  })

  test("every variable documented in README.md is read in src/", () => {
    expect(sorted(new Set([...readme].filter((token) => !src.has(token))))).toEqual([])
  })

  test("every variable read in src/ is documented in docs/config.html", () => {
    expect(sorted(new Set([...src].filter((token) => !configHtml.has(token))))).toEqual([])
  })

  test("every variable documented in docs/config.html is read in src/", () => {
    expect(sorted(new Set([...configHtml].filter((token) => !src.has(token))))).toEqual([])
  })

  test("README.md and docs/config.html document the identical variable set", () => {
    expect(sorted(readme)).toEqual(sorted(configHtml))
  })

  test("the documented set matches the code set exactly (same size, no stragglers)", () => {
    expect(readme.size).toBe(src.size)
    expect(configHtml.size).toBe(src.size)
    expect(sorted(readme)).toEqual(sorted(src))
  })
})
