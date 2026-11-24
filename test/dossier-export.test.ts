import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { dossierExportName, exportLoopDossier, MAX_EXPORT_ATTEMPTS } from "../src/core/dossier-export.ts"
import { buildLoopDossier } from "../src/core/dossier.ts"
import type { GoalSnapshot, UsageSnapshot } from "../src/core/types.ts"

const now = 1_800_000_000_000 // 2027-01-15T06:40:00Z — a fixed clock keeps every assertion deterministic
const zero: UsageSnapshot = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

const plainGoal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal-export",
  sessionID: "ses_secret_session_id",
  directory: "/tmp/export",
  condition: "ship the release notes",
  status: "achieved",
  reason: "met: notes published",
  setAt: now - 1000 * 60 * 30,
  startedAt: now - 1000 * 60 * 30,
  turns: 1,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: zero,
  history: [{ turn: 1, verdict: "met", reason: "notes published", at: now - 1000 * 60 * 5, toolCalls: 3, spend: { ...zero, cost: 0.5, input: 900, output: 120 } }],
  elapsedMs: 1000 * 60 * 30,
  evaluating: false,
  waiting: false,
  spend: { ...zero, cost: 0.5, input: 900, output: 120 },
  ...overrides,
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dossier-export-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("dossierExportName", () => {
  test("stamps the UTC clock stem — no local timezone leaks into the filename", () => {
    expect(dossierExportName(now)).toBe("goal-dossier-20270115-080000.md")
    expect(dossierExportName(now, 1)).toBe("goal-dossier-20270115-080000-2.md")
    expect(dossierExportName(now, 41)).toBe("goal-dossier-20270115-080000-42.md")
  })

  test("a non-finite or unrepresentable clock stamps the epoch rather than throwing", () => {
    expect(dossierExportName(Number.NaN)).toBe("goal-dossier-19700101-000000.md")
    expect(dossierExportName(Number.POSITIVE_INFINITY)).toBe("goal-dossier-19700101-000000.md")
    expect(dossierExportName(8.64e15 + 1)).toBe("goal-dossier-19700101-000000.md")
  })
})

describe("exportLoopDossier", () => {
  test("writes exactly the bytes goal.dossier.copy puts on the clipboard — one builder, two doors", () => {
    const result = exportLoopDossier(plainGoal(), now, dir)
    expect(readFileSync(result.path, "utf8")).toBe(buildLoopDossier(plainGoal(), now))
    expect(result.bytes).toBe(Buffer.byteLength(buildLoopDossier(plainGoal(), now), "utf8"))
    expect(result.attempts).toBe(1)
    expect(result.path).toBe(join(resolve(dir), "goal-dossier-20270115-080000.md"))
  })

  test("the file leaks no session id — the same provenance rule as the copy path, on disk", () => {
    const result = exportLoopDossier(plainGoal(), now, dir)
    expect(readFileSync(result.path, "utf8")).not.toContain("ses_secret_session_id")
  })

  test("never overwrites — a collision retries with a numeric suffix and the original stays put", () => {
    const stem = dossierExportName(now)
    writeFileSync(join(dir, stem), "keep me", "utf8")
    const result = exportLoopDossier(plainGoal(), now, dir)
    expect(result.path).toBe(join(resolve(dir), dossierExportName(now, 1)))
    expect(result.attempts).toBe(2)
    expect(readFileSync(join(dir, stem), "utf8")).toBe("keep me")
    expect(existsSync(result.path)).toBe(true)
  })

  test("stacked collisions keep walking the suffix — second export in the same second lands on -3", () => {
    writeFileSync(join(dir, dossierExportName(now)), "first", "utf8")
    writeFileSync(join(dir, dossierExportName(now, 1)), "second", "utf8")
    const result = exportLoopDossier(plainGoal(), now, dir)
    expect(result.path).toBe(join(resolve(dir), dossierExportName(now, 2)))
    expect(result.attempts).toBe(3)
  })

  test("the written file lands in the caller's directory and nowhere else", () => {
    const result = exportLoopDossier(plainGoal(), now, dir)
    expect(readdirSync(dir)).toEqual(["goal-dossier-20270115-080000.md"])
    expect(resolve(result.path).startsWith(resolve(dir))).toBe(true)
  })

  test("a target that is not a directory throws the filesystem's own error — no silent no-op, no mkdir", () => {
    const notADir = join(dir, "not-a-directory")
    writeFileSync(notADir, "occupied", "utf8")
    expect(() => exportLoopDossier(plainGoal(), now, notADir)).toThrow()
    expect(readdirSync(dir)).toEqual(["not-a-directory"]) // nothing created, nothing moved
  })

  test("a directory that does not exist throws instead of being conjured into existence", () => {
    const missing = join(dir, "nope")
    expect(() => exportLoopDossier(plainGoal(), now, missing)).toThrow()
    expect(existsSync(missing)).toBe(false)
  })

  test("the attempt ceiling is a real number of names, not a hang — MAX_EXPORT_ATTEMPTS candidates then throw", () => {
    expect(MAX_EXPORT_ATTEMPTS).toBe(100)
  })
})
