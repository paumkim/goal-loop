/**
 * Smoke tests for the standalone render scripts (`scripts/render-dialog.tsx`, `scripts/render-history.tsx`).
 * These scripts mount the dialog components in @opentui/solid's test renderer and print the captured
 * character grid; they were previously verified only by manual invocation, so a flag rename or a broken
 * import could rot them silently. Each test spawns the script exactly the way the header comments invoke
 * it (`bun --preload @opentui/solid/preload scripts/<name>.tsx [flags]`), asserts exit 0 and a non-empty
 * grid on stdout. Not shipped (scripts/ is not in package.json `files`); this file lives in test/ only.
 */
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

const run = (script: string, args: string[] = []) =>
  spawnSync("bun", ["--preload", "@opentui/solid/preload", script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

/** Non-whitespace characters — a proxy for "the grid actually painted something". */
const gridChars = (output: string): number => output.replace(/\s/g, "").length

describe("render script smoke tests", () => {
  test("render-dialog.tsx exits 0 and prints the fixed-configuration frame", () => {
    const result = run("scripts/render-dialog.tsx")
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("fixed scrollbox configuration")
    expect(result.stdout).toContain("/goal · loop")
    expect(gridChars(result.stdout)).toBeGreaterThan(200)
  }, 30_000)

  test("render-history.tsx --mono demotes every glyph to ASCII and no Unicode ✓/█ survives", () => {
    const result = run("scripts/render-history.tsx", ["--mono"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("· mono ===")
    expect(result.stdout).toContain("#######-----------")
    expect(result.stdout).toContain("+x+")
    expect(result.stdout).not.toContain("✓")
    expect(result.stdout).not.toContain("█")
    expect(result.stdout).not.toContain("◎")
  }, 30_000)

  test("render-card.tsx --mono demotes the frame (asterisk marker, # bar) and keeps $0.90 whole at the clamp floor", () => {
    const result = run("scripts/render-card.tsx", ["--mono"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("· mono")
    expect(result.stdout).toContain("* /goal")
    expect(result.stdout).toContain("#########-------")
    expect(result.stdout).toContain("$0.90")
    expect(result.stdout).not.toContain("✓")
  }, 30_000)

  test("render-dialog.tsx --mono paints the demoted mirrored header and ASCII copy ack", () => {
    const result = run("scripts/render-dialog.tsx", ["--mono", "--copied"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("* /goal · loop")
    expect(result.stdout).toContain("[+ copied]")
    expect(result.stdout).not.toContain("✓")
    expect(result.stdout).not.toContain("◎")
  }, 30_000)

  test("render-card.tsx exits 0 and prints the three card frames (whole-cost contract at the clamp floor)", () => {
    const result = run("scripts/render-card.tsx")
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("=== card · active loop")
    expect(result.stdout).toContain("=== card · achieved ===")
    expect(result.stdout).toContain("=== card · width 52")
    // the CT contract: the dollar figure stays whole at the 52-cell clamp floor
    expect(result.stdout).toContain("$0.90")
    expect(gridChars(result.stdout)).toBeGreaterThan(200)
  }, 30_000)

  test("render-card.tsx first-impression arms paint the teaching hint and the impossible remedy", () => {
    const result = run("scripts/render-card.tsx")
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    // freshly armed: zero turns, no history — the hint is the row that teaches the evaluator contract
    expect(result.stdout).toContain("=== card · freshly armed (teaching hint)")
    expect(result.stdout).toContain("active 0 turns")
    expect(result.stdout).toContain("the evaluator reads only the transcript")
    // impossible: the loud verdict arms the rephrase path
    expect(result.stdout).toContain("=== card · judged impossible (rephrase or clear)")
    expect(result.stdout).toContain("impossible 31 turns")
    expect(result.stdout).toContain("judged impossible")
    expect(result.stdout).toContain("/goal clear")
  }, 30_000)

  test("render-card.tsx failure-first arms paint the exact remediation, never a vague warning", () => {
    const result = run("scripts/render-card.tsx")
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    // running-hot arm: the compact remedy names the pending count and the verifyCommand escape hatch
    expect(result.stdout).toContain("=== card · running hot (compaction pending 2/4)")
    expect(result.stdout).toContain("compact pending 2/4")
    expect(result.stdout).toContain("evaluator.verifyCommand")
    // stuck arm: the state word flips and the remedy names the retry count and the clear path
    expect(result.stdout).toContain("=== card · stuck on retries (3 failed turns)")
    expect(result.stdout).toContain("stuck 31 turns")
    expect(result.stdout).toContain("3 failed turns in a row")
    // failed arm: the loud stop names the failure label and the reset path
    expect(result.stdout).toContain("=== card · failed (loud stop) ===")
    expect(result.stdout).toContain("failed 31 turns")
    expect(result.stdout).toContain("provider error - /goal clear to reset")
  }, 30_000)

  test("render-dialog.tsx --width=80 prints the real compact-tier footer, not a hand-painted line", () => {
    const result = run("scripts/render-dialog.tsx", ["--width=80"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[copy]")
    expect(result.stdout).not.toContain("[copy condition]")
    expect(result.stdout).toContain("up/down scroll · p pin · c copy · x older")
    expect(result.stdout).not.toContain("esc close")
  }, 30_000)

  test("render-dialog.tsx --buggy exits 0 and prints the buggy-configuration frame", () => {
    const result = run("scripts/render-dialog.tsx", ["--buggy"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("buggy scrollbox configuration")
    expect(gridChars(result.stdout)).toBeGreaterThan(200)
  }, 30_000)

  test("render-history.tsx exits 0 and prints all five frames", () => {
    const result = run("scripts/render-history.tsx")
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("=== looped · 2 completed iterations, 30 verdicts ===")
    expect(result.stdout).toContain("=== looped · paused (stall/retries diagnostics) ===")
    expect(result.stdout).toContain("=== looped · complete (final tally row) ===")
    expect(result.stdout).toContain("=== non-looped · 34 verdicts, trailing streak ===")
    expect(result.stdout).toContain("=== non-looped · fresh, no verdicts yet ===")
    expect(gridChars(result.stdout)).toBeGreaterThan(200)
  }, 30_000)

  test("render-history.tsx --empty exits 0 and prints the empty-history frame", () => {
    const result = run("scripts/render-history.tsx", ["--empty"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("=== loop · empty history ===")
    expect(gridChars(result.stdout)).toBeGreaterThan(100)
  }, 30_000)
})
