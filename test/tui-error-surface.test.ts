/**
 * Source-level regression guard for the TUI's user-facing error surfaces. A formatter unit test proves
 * the helper is correct; this test proves the TUI actually uses it and has not reintroduced a raw stack
 * or the copy-pasted `error instanceof Error ? error : error` tautology at any toast/fallback site.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")

describe("src/tui.tsx user-facing error surfaces", () => {
  test("never renders an error stack to the user", () => {
    expect(source).not.toMatch(/error\.stack/)
  })

  test("never uses the tautological raw-error string expression in a toast", () => {
    expect(source).not.toMatch(/String\(error instanceof Error \? error : error\)/)
  })

  test("routes every failed-action toast and both stack sites through the shared formatter", () => {
    expect(source).toContain('from "./tui-error.ts"')
    // 13 action toasts go through toastError; the dialog catch and the render fallback call the
    // formatter directly (one call is inside toastError itself, one in a doc comment).
    const toastCalls = source.match(/toastError\(/g)?.length ?? 0
    expect(toastCalls).toBeGreaterThanOrEqual(13)
    const formatterCalls = source.match(/userFacingError\(/g)?.length ?? 0
    expect(formatterCalls).toBeGreaterThanOrEqual(4)
  })

  test("logs the full error where stacks used to be shown to the user", () => {
    // The dialog catch and the ErrorBoundary fallback must keep the stack in the host log even though
    // the user only sees the plain line. One shared logger keeps that contract in one place.
    expect(source).toContain("logUiError(")
  })
})
