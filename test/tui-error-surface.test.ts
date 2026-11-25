/**
 * Source-level regression guard for the TUI's user-facing error surfaces. A formatter unit test proves
 * the helper is correct; this test proves the TUI actually uses it and has not reintroduced a raw stack
 * or the copy-pasted `error instanceof Error ? error : error` tautology at any toast/fallback site.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const source =
  readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8") +
  readFileSync(new URL("../src/tui-actions.ts", import.meta.url), "utf8")

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

  test("every individual failed-action path is routed, not just counted in aggregate", () => {
    // One assertion per pre-fix failure site (file:line at the time of the audit):
    // 744 copy, 754 export, 776 verify, 799 reach, 822 sign, 840/852/876 attest,
    // 889 review, 902 spend, 916 seal, 929 index, 951 clear.
    const titles = [
      "copy failed",
      "export failed",
      "verify failed",
      "reach check failed",
      "sign check failed",
      "attest failed",
      "review failed",
      "spend report failed",
      "seal failed",
      "index failed",
      "clear failed",
    ]
    for (const title of titles) {
      expect(source, `${title} is still a raw safeToast`).toMatch(new RegExp(`toastError\\("${title}", error`))
    }
    // The one remaining "failed" safeToast is the notice-handler catch (line ~494), whose body is
    // the fixed plain string "see logs" — an intentional error surface, not a raw error dump.
    expect(source).not.toMatch(/safeToast\(\{ title: "(?!goal plugin notice handler failed)[^"]*failed"/)
  })

  test("the two stack sites keep a plain user line beside a full-error log call", () => {
    const dialogCatch = source.slice(source.indexOf('showStatusDialogInner(sessionID, fallback)'), source.indexOf("const showStatusDialogInner"))
    expect(dialogCatch).toContain("logUiError(\"status dialog failed\", error)")
    expect(dialogCatch).toContain("userFacingError(error)")

    const fallback = source.slice(source.indexOf("<ErrorBoundary"), source.indexOf("</ErrorBoundary>"))
    expect(fallback).toContain("logUiError(\"dialog render failed\", error)")
    expect(fallback).toContain("{userFacingError(error)}")
  })
})
