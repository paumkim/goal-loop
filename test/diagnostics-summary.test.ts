/**
 * Unit tests for the read-only diagnostics report. Importing the module has no side effects —
 * main() only runs under import.meta.main, so no filesystem scan happens on import.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { formatSummary, loadArtifacts, summarizeArtifacts } from "../scripts/diagnostics-summary.ts"

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "goal-diag-"))
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const artifact = (extra: Record<string, unknown> = {}) => ({
  signature: "reason:same missing test evidence",
  kind: "reason",
  verdictReason: "same missing test evidence",
  condition: "fix the failing tests",
  at: "2026-11-25T08:14:20.326Z",
  ...extra,
})

describe("loadArtifacts", () => {
  test("a missing directory loads nothing", () => {
    expect(loadArtifacts(join(scratch(), "absent"))).toEqual([])
  })

  test("skips non-JSON files and unparseable artifacts without hiding valid ones", () => {
    const dir = scratch()
    writeFileSync(join(dir, "notes.txt"), "ignore me")
    writeFileSync(join(dir, "broken.json"), "{not json")
    writeFileSync(join(dir, "good.json"), JSON.stringify(artifact()))
    expect(loadArtifacts(dir)).toHaveLength(1)
  })
})

describe("summarizeArtifacts", () => {
  test("collapses the same signature into one row with its file count", () => {
    const summary = summarizeArtifacts([artifact({ turn: 3 }), artifact({ turn: 4 }), artifact({ signature: "verify:build", kind: "verification" })])
    expect(summary.total).toBe(3)
    expect(summary.signatures).toEqual([
      { key: "reason:same missing test evidence", count: 2 },
      { key: "verify:build", count: 1 },
    ])
    expect(summary.kinds).toEqual([
      { key: "reason", count: 2 },
      { key: "verification", count: 1 },
    ])
    expect(summary.latestAt).toBe("2026-11-25T08:14:20.326Z")
  })

  test("an empty trail has no patterns and no latest timestamp", () => {
    expect(summarizeArtifacts([])).toEqual({ total: 0, kinds: [], signatures: [], conditions: [], reasons: [] })
  })
})

describe("formatSummary", () => {
  test("an empty directory says so explicitly", () => {
    const text = formatSummary(summarizeArtifacts([]), "/repo/.term/goal-loop/diagnostics")
    expect(text).toContain("artifacts: 0")
    expect(text).toContain("no repeated-failure diagnostics recorded")
    expect(text).not.toContain("top signatures")
  })

  test("reports the dominant pattern first and caps the row list", () => {
    const many = Array.from({ length: 12 }, (_, i) => artifact({ signature: `reason:turn ${i} still failing`, verdictReason: `turn ${i} still failing` }))
    many.push(artifact(), artifact(), artifact())
    const text = formatSummary(summarizeArtifacts(many), "/d")
    expect(text).toContain("artifacts: 15")
    expect(text).toContain("top signatures:")
    expect(text).toMatch(/3  reason:same missing test evidence/)
    expect(text).toContain("... 3 more")
    expect(text).toContain("latest: 2026-11-25T08:14:20.326Z")
  })
})
