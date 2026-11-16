/**
 * Unit tests for the record-under-seal module — the dossier tab's sign row and the
 * `goal.dossier.sign` palette twin. The probe is injected everywhere: no test spawns git,
 * no test depends on a repository. What is pinned here is the contract — only the shas the
 * record quotes are attested, dedupe is first-appearance order with the quoting iterations
 * listed, an unanswerable probe is `unknown` and never folded into `not under seal`, a probe
 * that throws degrades one row to `unknown` instead of sinking the sweep, and the report/ack
 * strings say exactly what the signature sweep found, no more.
 */
import { describe, expect, test } from "bun:test"
import {
  signRecord,
  signReportMarkdown,
  signAckSegment,
  signSummaryLine,
  type SignProbe,
} from "../src/core/sign-record.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const loopGoal = (loopHistory: GoalSnapshot["loopHistory"]): GoalSnapshot =>
  ({
    version: 1,
    id: "goal_sign",
    sessionID: "ses_sign",
    directory: "/tmp/sign",
    condition: "ship the release notes",
    status: "achieved",
    setAt: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    turns: 4,
    stall: 0,
    retries: 0,
    checkins: 0,
    baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    history: [],
    loopEnabled: true,
    loopIteration: 3,
    loopObjective: "make every loop iteration visible at a glance",
    loopMaxLoops: 5,
    loopHistory,
    loopNotProgress: 0,
    elapsedMs: 600_000,
    evaluating: false,
    waiting: false,
  }) as GoalSnapshot

const entry = (version: number, sha: string | undefined): NonNullable<GoalSnapshot["loopHistory"]>[number] => ({
  version,
  condition: `objective pass ${version}`,
  summary: `summary ${version}`,
  reason: "met",
  turns: 5,
  toolCalls: 9,
  endedAt: 1_700_000_000_000 + version * 1000,
  ...(sha === undefined ? {} : { sha }),
})

const verified: SignProbe = () => true
const unverified: SignProbe = () => false
const unanswerable: SignProbe = () => "unknown"

describe("signRecord", () => {
  test("all-under-seal sweep — unique, mentions, per-sha iterations, counts", () => {
    const v = signRecord(loopGoal([entry(1, "1".repeat(40)), entry(2, "1".repeat(40)), entry(3, "2".repeat(40))]), verified)
    expect(v.unique).toBe(2)
    expect(v.mentions).toBe(3)
    expect(v.verified).toBe(2)
    expect(v.unverified).toBe(0)
    expect(v.unknown).toBe(0)
    expect(v.checks.map((c) => c.status)).toEqual(["verified", "verified"])
    expect(v.checks[0]?.iterations).toEqual([1, 2])
  })
  test("mixed sweep — verified, not under seal and unknown stay in their own buckets", () => {
    const bySha = new Map<string, boolean | "unknown">([["1".repeat(40), true], ["2".repeat(40), false], ["3".repeat(40), "unknown"]])
    const v = signRecord(
      loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40)), entry(3, "3".repeat(40))]),
      (sha) => bySha.get(sha) ?? "unknown",
    )
    expect([v.verified, v.unverified, v.unknown]).toEqual([1, 1, 1])
    expect(v.checks.map((c) => c.status)).toEqual(["verified", "unverified", "unknown"])
  })
  test("a probe that throws degrades one row to unknown — the sweep still answers the rest", () => {
    const v = signRecord(
      loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))]),
      (sha) => {
        if (sha.startsWith("1")) throw new Error("probe exploded")
        return true
      },
    )
    expect(v.checks.map((c) => c.status)).toEqual(["unknown", "verified"])
    expect(v.unknown).toBe(1)
    expect(v.verified).toBe(1)
  })
  test("an unanswerable probe is all-unknown, never all-not-under-seal", () => {
    const v = signRecord(loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))]), unanswerable)
    expect([v.verified, v.unverified, v.unknown]).toEqual([0, 0, 2])
  })
  test("a non-hex sha reaches the probe and reports whatever git says — under seal is one bit, never fabricated", () => {
    expect(signRecord(loopGoal([entry(1, "not-a-sha")]), unverified).checks[0]?.status).toBe("unverified")
    expect(signRecord(loopGoal([entry(1, "not-a-sha")]), verified).checks[0]?.status).toBe("verified")
  })
  test("an empty record attests nothing — zero counts, no checks, honest", () => {
    const v = signRecord(loopGoal(undefined), verified)
    expect([v.unique, v.mentions, v.verified, v.unverified, v.unknown]).toEqual([0, 0, 0, 0, 0])
  })
})

describe("signReportMarkdown", () => {
  const signOf = (entries: GoalSnapshot["loopHistory"], probe: SignProbe = verified) =>
    signRecord(loopGoal(entries), probe)
  const stamp = Date.UTC(2026, 10, 16, 18, 0, 0)

  test("carries the generation stamp, the probed directory, and the condition", () => {
    const report = signReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), signOf([entry(1, "a".repeat(40))]), stamp, "/repo/dir")
    expect(report).toContain("# /goal-loop record signatures")
    expect(report).toContain(`- Generated: ${new Date(stamp).toISOString()}`)
    expect(report).toContain("- Repository: /repo/dir")
    expect(report).toContain("- Condition: ship the release notes")
  })
  test("tables every unique sha with the iterations that quote it and the verdict cell", () => {
    const report = signReportMarkdown(
      loopGoal([entry(1, "a".repeat(40)), entry(2, "a".repeat(40)), entry(3, "b".repeat(40))]),
      signOf([entry(1, "a".repeat(40)), entry(2, "a".repeat(40)), entry(3, "b".repeat(40))], (sha) => sha.startsWith("a")),
      stamp,
      "/repo/dir",
    )
    expect(report).toContain("| aaaaaaa | v1, v2 | yes |")
    expect(report).toContain("| bbbbbbb | v3 | no |")
    expect(report).toContain("- Under seal (git verified): 1 · not under seal: 1 · unknown: 0")
    expect(report).toContain("unique across 3 mentions")
  })
  test("an empty record paints a GAP row, not an empty table", () => {
    const report = signReportMarkdown(loopGoal(undefined), signOf(undefined), stamp, "/repo/dir")
    expect(report).toContain("| — | — | — |")
    expect(report).toContain("0 unique across 0 mentions")
  })
  test("unknown cells are spelled unknown, never folded into not under seal", () => {
    const report = signReportMarkdown(
      loopGoal([entry(1, "a".repeat(40))]),
      signOf([entry(1, "a".repeat(40))], unanswerable),
      stamp,
      "/repo/dir",
    )
    expect(report).toContain("| aaaaaaa | v1 | unknown |")
    expect(report).toContain("- Under seal (git verified): 0 · not under seal: 0 · unknown: 1")
  })
  test("the honesty footer states what not under seal does and does not imply", () => {
    const report = signReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), signOf([entry(1, "a".repeat(40))]), stamp, "/repo/dir")
    expect(report).toContain("most commits are unsigned")
    expect(report).toContain("never proof of forgery")
    expect(report).toContain("never counted as “no”")
    expect(report).toContain("Existence is not ancestry")
  })
  test("a stale report cannot masquerade as a live check — the stamp and directory ride every copy", () => {
    const earlier = signReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), signOf([entry(1, "a".repeat(40))]), stamp, "/one/repo")
    const later = signReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), signOf([entry(1, "a".repeat(40))]), stamp + 60_000, "/two/repo")
    expect(earlier).not.toEqual(later)
    expect(earlier).toContain("/one/repo")
    expect(later).toContain("/two/repo")
  })
})

describe("signSummaryLine", () => {
  test("phrases the outcome without chrome — the caller paints its own", () => {
    const goal = loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))])
    expect(signSummaryLine(signRecord(goal, verified))).toBe("record under seal: 2 of 2 shas verify")
    expect(signSummaryLine(signRecord(goal, () => false))).toBe("record not under seal: 2 of 2 shas do not verify")
    expect(signSummaryLine(signRecord(goal, unanswerable))).toBe("record unverifiable: 2 of 2 shas could not be attested")
    expect(signSummaryLine(signRecord(loopGoal(undefined), verified))).toBe("record quotes no shas to attest")
  })
})

describe("signAckSegment", () => {
  const ack = (unique: number, verified: number, unverified: number, unknown: number, ascii: boolean) =>
    signAckSegment({ unique, verified, unverified, unknown }, ascii)

  test("all-under-seal paints the pass in both arms", () => {
    expect(ack(6, 6, 0, 0, false)).toBe(" (✓ 6/6 signed)")
    expect(ack(6, 6, 0, 0, true)).toBe(" (+ 6/6 signed)")
  })
  test("not under seal outranks unknown in the paint — the louder truth wins", () => {
    expect(ack(6, 3, 2, 1, false)).toBe(" (✗ 2 of 6 unsigned)")
    expect(ack(6, 3, 2, 1, true)).toBe(" (- 2 of 6 unsigned)")
    expect(ack(6, 4, 0, 2, false)).toBe(" (! 2 of 6 unknown)")
    expect(ack(6, 4, 0, 2, true)).toBe(" (! 2 of 6 unknown)")
  })
  test("a record with no quoted shas says so, never paints a pass", () => {
    expect(ack(0, 0, 0, 0, false)).toBe(" (no shas to attest)")
    expect(ack(0, 0, 0, 0, true)).toBe(" (no shas)")
  })
})
