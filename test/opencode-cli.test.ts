import { describe, expect, test } from "bun:test"
import { isOpencodeCliCondition, opencodeCliGuide } from "../src/core/opencode-cli.ts"
import { directive } from "../src/core/prompts.ts"
import type { CommitPolicy } from "../src/core/types.ts"

const direct: CommitPolicy = { required: true, branch: "dev", mode: "direct", reason: "test" }
const off: CommitPolicy = { required: false, branch: "dev", mode: "direct", reason: "not a git repository" }

describe("isOpencodeCliCondition", () => {
  test("matches any word-bounded mention of opencode, any case", () => {
    expect(isOpencodeCliCondition("test the opencode v2 CLI")).toBe(true)
    expect(isOpencodeCliCondition("make OpenCode's plugin api nicer")).toBe(true)
    expect(isOpencodeCliCondition("wire the tui.jsonc for opencode")).toBe(true)
    expect(isOpencodeCliCondition("check ~/.opencode/bin/opencode --version first")).toBe(true)
    expect(isOpencodeCliCondition("fix the opencode-goal plugin")).toBe(true)
  })

  test("does not match other words containing the letters", () => {
    expect(isOpencodeCliCondition("practice opencoding daily")).toBe(false)
    expect(isOpencodeCliCondition("open coding night")).toBe(false)
    expect(isOpencodeCliCondition("document the code generator")).toBe(false)
    expect(isOpencodeCliCondition("")).toBe(false)
  })
})

describe("opencodeCliGuide", () => {
  const guide = opencodeCliGuide()

  test("is a balanced, tagged block", () => {
    expect(guide.startsWith("<opencode-cli>\n")).toBe(true)
    expect(guide.endsWith("\n</opencode-cli>")).toBe(true)
    expect(guide.match(/<opencode-cli>/g)).toHaveLength(1)
    expect(guide.match(/<\/opencode-cli>/g)).toHaveLength(1)
  })

  test("pins the operational invariants agents need", () => {
    // How to learn what is installed; never touch the installed harness.
    expect(guide).toContain("opencode --version")
    expect(guide).toContain("~/Projects/opencode")
    expect(guide).toContain("Never rebuild or replace the installed binary")
    // The stable extension surface for TUI UI.
    expect(guide).toContain("node_modules/@opencode/plugin/dist/tui/context.d.ts")
    expect(guide).toContain("SlotMap")
    expect(guide).toContain("session.composer.top")
    // Headless verification route: opentui test renderer + opencode-headless drive of the real binary.
    expect(guide).toContain("@opentui/core/testing")
    expect(guide).toContain("createTestRenderer")
    expect(guide).toContain("captureCharFrame()")
    // The headless plugin is the sanctioned way to drive the installed binary; tmux is the fallback.
    expect(guide).toContain("opencode-headless")
    expect(guide).toContain("headless_start")
    expect(guide).toContain("headless_capture")
    expect(guide).toContain("headless_permission")
    expect(guide).toContain("pty")
    expect(guide).toContain("tmux capture-pane -p")
    expect(guide).not.toContain("no stable, documented tool")
    // Build/mount flow.
    expect(guide).toContain("Plugin.define")
    expect(guide).toContain("~/.config/opencode/opencode.jsonc")
    // Report the layer each claim was verified at; string extraction remains the binary-truth route.
    expect(guide).toContain("binary / source / test-render / live TUI")
    // CXXV: reporting is brief and limited to claims actually made — not an exhaustive audit of every possibility.
    expect(guide).toContain("report briefly which layer")
    expect(guide).toContain("each claim you make was verified at")
    expect(guide).toContain("no need to audit every possibility")
    expect(guide).toContain("string extraction from the binary is often the only source of truth")
    expect(guide).toContain("never commit to the host repo")
  })
})

describe("directive() with the opencode-cli guide", () => {
  test("injects the guide only for conditions that mention opencode", () => {
    const withOpencode = directive("fix the opencode cli crash on /goal", off)
    expect(withOpencode).toContain("<opencode-cli>")
    expect(withOpencode).toContain("</opencode-cli>")

    const without = directive("add a CONTRIBUTING.md with the test commands", off)
    expect(without).not.toContain("<opencode-cli>")
  })

  test("coexists with the fuzzy-condition SPEC.md hint", () => {
    const fuzzyAndOpencode = directive("make the opencode tui pretty", off)
    expect(fuzzyAndOpencode).toContain("Fuzzy request: write SPEC.md first")
    expect(fuzzyAndOpencode).toContain("<opencode-cli>")
  })

  test("lands before the commit rule and keeps the evaluator framing", () => {
    const out = directive("rework the opencode harness tests", direct)
    expect(out.indexOf("<opencode-cli>")).toBeLessThan(out.indexOf("Commit rule:"))
    expect(out).toContain("an independent evaluator checks the condition")
  })

  test("injects even when the condition does not read as fuzzy", () => {
    // "test" + "ci" keywords make isFuzzyCondition return false; the guide must not depend on the fuzzy path.
    const out = directive("test the opencode v2 CLI end to end, tests pass", off)
    expect(out).toContain("<opencode-cli>")
  })
})
