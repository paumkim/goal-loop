/**
 * Source-level guard for the one user-facing error surface in the server plugin: the background
 * update-check notice. Before the fix it interpolated the raw thrown system string into a notice the
 * user sees; the plain-language formatter must be used instead.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")

describe("src/index.ts user-facing error surfaces", () => {
  test("the update-check failure notice does not embed a raw thrown system string", () => {
    expect(source).not.toMatch(/Update check failed: \$\{error instanceof Error \? error\.message : String\(error\)\}/)
  })

  test("the update-check failure notice uses the shared plain-language formatter with operation context", () => {
    expect(source).toContain('from "./tui-error.ts"')
    expect(source).toContain("Could not check for updates. ${userFacingError(error)}")
  })
})
