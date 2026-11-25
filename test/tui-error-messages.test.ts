/**
 * Regression tests for user-facing error text. The TUI used to hand raw `Error` values — and even
 * `error.stack` — straight to toasts and the `/goal` dialog fallback. The formatter under test is the
 * one place that decides what a user is allowed to SEE; the full error (stack included) is logged at
 * the catch site, not rendered.
 */
import { describe, expect, test } from "bun:test"
import { userFacingError, USER_ERROR_MAX_LENGTH } from "../src/tui-error.ts"

describe("userFacingError", () => {
  test("an Error shows its plain message, never its stack frames or an 'Error:' prefix", () => {
    const error = new Error("goal store unavailable")
    expect(error.stack).toContain("at ") // the fixture really has a stack
    const shown = userFacingError(error)
    expect(shown).toBe("goal store unavailable")
    expect(shown).not.toMatch(/\bat\s+/)
    expect(shown).not.toMatch(/^Error:/)
  })

  test("a stringified error carrying stack frames is flattened to the message line", () => {
    const shown = userFacingError("render exploded\n    at paint (/x/tui.ts:12:3)\n    at mount (/x/tui.ts:4:5)")
    expect(shown).toBe("render exploded")
  })

  test("a message-bearing object uses its message and does not leak sibling fields (no secrets)", () => {
    const shown = userFacingError({ message: "rpc rejected", apiKey: "sk-super-secret" })
    expect(shown).toBe("rpc rejected")
    expect(shown).not.toContain("sk-super-secret")
    expect(shown).not.toContain("[object Object]")
  })

  test("an object without a message yields a neutral phrase, not an object dump", () => {
    expect(userFacingError({ code: "E_WHATEVER" })).toBe("an unexpected error occurred")
  })

  test("nullish and primitive non-message values yield the neutral phrase", () => {
    expect(userFacingError(null)).toBe("an unexpected error occurred")
    expect(userFacingError(undefined)).toBe("an unexpected error occurred")
    expect(userFacingError("[object Object]")).toBe("an unexpected error occurred")
    expect(userFacingError("null")).toBe("an unexpected error occurred")
  })

  test("a raw filesystem system error becomes plain language and drops the host path", () => {
    const error = new Error("ENOENT: no such file or directory, scandir '/home/private/project'")
    const shown = userFacingError(error)
    expect(shown).toBe("file or directory not found")
    expect(shown).not.toContain("ENOENT")
    expect(shown).not.toContain("/home/private/project")
  })

  test("other common system codes also get plain-language phrasings", () => {
    expect(userFacingError("EACCES: permission denied, open '/etc/shadow'")).toBe("permission denied")
    expect(userFacingError("EEXIST: file already exists, open '/x'")).toBe("file already exists")
  })

  test("long messages are bounded to one width with an ellipsis", () => {
    const shown = userFacingError(new Error("Z".repeat(500)))
    expect(shown).toHaveLength(USER_ERROR_MAX_LENGTH)
    expect(shown.endsWith("…")).toBe(true)
  })

  test("the bound can be narrowed for a short toast and never returns an empty string", () => {
    const shown = userFacingError(new Error("a".repeat(50)), 10)
    expect(shown).toHaveLength(10)
    expect(shown.endsWith("…")).toBe(true)
    expect(userFacingError(new Error("   "))).toBe("an unexpected error occurred")
  })
})
