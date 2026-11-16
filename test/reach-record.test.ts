/**
 * Unit tests for the record-in-reach module — the dossier tab's reach row and the
 * `goal.dossier.reach` palette twin. The probe is injected everywhere: no test spawns git,
 * no test depends on a repository. What is pinned here is the contract — only the shas the
 * record quotes are placed, dedupe is first-appearance order with the quoting iterations
 * listed, an unanswerable probe is `unknown` and never folded into `no`, a probe that throws
 * degrades one row to `unknown` instead of sinking the sweep, and the report/ack strings say
 * exactly what the ancestry sweep found, no more.
 */
import { describe, expect, test } from "bun:test"
import {
  reachRecord,
  reachReportMarkdown,
  reachAckSegment,
  reachSummaryLine,
  type ReachProbe,
} from "../src/core/reach-record.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const loopGoal = (loopHistory: GoalSnapshot["loopHistory"]): GoalSnapshot =>
  ({
    version: 1,
    id: "goal_reach",
    sessionID: "ses_reach",
    directory: "/tmp/reach",
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

const ancestor: ReachProbe = () => true
const unreached: ReachProbe = () => false
const unanswerable: ReachProbe = () => "unknown"

describe("reachRecord", () => {
  test("all-on-this-line sweep — unique, mentions, per-sha iterations, counts", () => {
    const v = reachRecord(loopGoal([entry(1, "1".repeat(40)), entry(2, "1".repeat(40)), entry(3, "2".repeat(40))]), ancestor)
    expect(v.unique).toBe(2)
    expect(v.mentions).toBe(3)
    expect(v.ancestors).toBe(2)
    expect(v.unreached).toBe(0)
    expect(v.unknown).toBe(0)
    expect(v.checks.map((c) => c.status)).toEqual(["ancestor", "ancestor"])
    expect(v.checks[0]?.iterations).toEqual([1, 2])
  })
  test("mixed sweep — on-this-line, not-on-this-line and unknown stay in their own buckets", () => {
    const bySha = new Map<string, boolean | "unknown">([["1".repeat(40), true], ["2".repeat(40), false], ["3".repeat(40), "unknown"]])
    const v = reachRecord(
      loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40)), entry(3, "3".repeat(40))]),
      (sha) => bySha.get(sha) ?? "unknown",
    )
    expect([v.ancestors, v.unreached, v.unknown]).toEqual([1, 1, 1])
    expect(v.checks.map((c) => c.status)).toEqual(["ancestor", "unreached", "unknown"])
  })
  test("a probe that throws degrades one row to unknown — the sweep still answers the rest", () => {
    const v = reachRecord(
      loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))]),
      (sha) => {
        if (sha.startsWith("1")) throw new Error("probe exploded")
        return true
      },
    )
    expect(v.checks.map((c) => c.status)).toEqual(["unknown", "ancestor"])
    expect(v.unknown).toBe(1)
    expect(v.ancestors).toBe(1)
  })
  test("an unanswerable probe is all-unknown, never all-unreached", () => {
    const v = reachRecord(loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))]), unanswerable)
    expect([v.ancestors, v.unreached, v.unknown]).toEqual([0, 0, 2])
  })
  test("a non-hex sha reaches the probe and reports whatever git says — placement is one bit, never fabricated", () => {
    expect(reachRecord(loopGoal([entry(1, "not-a-sha")]), unreached).checks[0]?.status).toBe("unreached")
    expect(reachRecord(loopGoal([entry(1, "not-a-sha")]), ancestor).checks[0]?.status).toBe("ancestor")
  })
  test("an empty record places nothing — zero counts, no checks, honest", () => {
    const v = reachRecord(loopGoal(undefined), ancestor)
    expect([v.unique, v.mentions, v.ancestors, v.unreached, v.unknown]).toEqual([0, 0, 0, 0, 0])
  })
})

describe("reachReportMarkdown", () => {
  const reachOf = (entries: GoalSnapshot["loopHistory"], probe: ReachProbe = ancestor) =>
    reachRecord(loopGoal(entries), probe)
  const stamp = Date.UTC(2026, 10, 16, 18, 0, 0)

  test("carries the generation stamp, the probed directory, and the condition", () => {
    const report = reachReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), reachOf([entry(1, "a".repeat(40))]), stamp, "/repo/dir")
    expect(report).toContain("# /goal-loop record ancestry")
    expect(report).toContain(`- Generated: ${new Date(stamp).toISOString()}`)
    expect(report).toContain("- Repository: /repo/dir")
    expect(report).toContain("- Condition: ship the release notes")
  })
  test("tables every unique sha with the iterations that quote it and the verdict cell", () => {
    const report = reachReportMarkdown(
      loopGoal([entry(1, "a".repeat(40)), entry(2, "a".repeat(40)), entry(3, "b".repeat(40))]),
      reachOf([entry(1, "a".repeat(40)), entry(2, "a".repeat(40)), entry(3, "b".repeat(40))], (sha) => sha.startsWith("a")),
      stamp,
      "/repo/dir",
    )
    expect(report).toContain("| aaaaaaa | v1, v2 | yes |")
    expect(report).toContain("| bbbbbbb | v3 | no |")
    expect(report).toContain("- On this line (ancestor of HEAD): 1 · not on this line: 1 · unknown: 0")
    expect(report).toContain("unique across 3 mentions")
  })
  test("an empty record paints a GAP row, not an empty table", () => {
    const report = reachReportMarkdown(loopGoal(undefined), reachOf(undefined), stamp, "/repo/dir")
    expect(report).toContain("| — | — | — |")
    expect(report).toContain("0 unique across 0 mentions")
  })
  test("unknown cells are spelled unknown, never folded into not-on-this-line", () => {
    const report = reachReportMarkdown(
      loopGoal([entry(1, "a".repeat(40))]),
      reachOf([entry(1, "a".repeat(40))], unanswerable),
      stamp,
      "/repo/dir",
    )
    expect(report).toContain("| aaaaaaa | v1 | unknown |")
    expect(report).toContain("- On this line (ancestor of HEAD): 0 · not on this line: 0 · unknown: 1")
  })
  test("the honesty footer states what unreached does and does not imply", () => {
    const report = reachReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), reachOf([entry(1, "a".repeat(40))]), stamp, "/repo/dir")
    expect(report).toContain("Not on this line is not misconduct")
    expect(report).toContain("Existence is not ancestry")
    expect(report).toContain("never counted as “no”")
  })
  test("a stale report cannot masquerade as a live check — the stamp and directory ride every copy", () => {
    const earlier = reachReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), reachOf([entry(1, "a".repeat(40))]), stamp, "/one/repo")
    const later = reachReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), reachOf([entry(1, "a".repeat(40))]), stamp + 60_000, "/two/repo")
    expect(earlier).not.toEqual(later)
    expect(earlier).toContain("/one/repo")
    expect(later).toContain("/two/repo")
  })
})

describe("reachSummaryLine", () => {
  test("phrases the outcome without chrome — the caller paints its own", () => {
    const goal = loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))])
    expect(reachSummaryLine(reachRecord(goal, ancestor))).toBe("record reaches HEAD: 2 of 2 shas on this line")
    expect(reachSummaryLine(reachRecord(goal, () => false))).toBe("record does not reach HEAD: 2 of 2 shas not on this line")
    expect(reachSummaryLine(reachRecord(goal, unanswerable))).toBe("record unverifiable: 2 of 2 shas could not be placed")
    expect(reachSummaryLine(reachRecord(loopGoal(undefined), ancestor))).toBe("record quotes no shas to place on this line")
  })
})

describe("reachAckSegment", () => {
  const ack = (unique: number, ancestors: number, unreached: number, unknown: number, ascii: boolean) =>
    reachAckSegment({ unique, ancestors, unreached, unknown }, ascii)

  test("all-on-this-line paints the pass in both arms", () => {
    expect(ack(6, 6, 0, 0, false)).toBe(" (✓ 6/6 on this line)")
    expect(ack(6, 6, 0, 0, true)).toBe(" (+ 6/6 on this line)")
  })
  test("unreached outranks unknown in the paint — the louder truth wins", () => {
    expect(ack(6, 3, 2, 1, false)).toBe(" (✗ 2 of 6 not on this line)")
    expect(ack(6, 3, 2, 1, true)).toBe(" (- 2 of 6 not on this line)")
    expect(ack(6, 4, 0, 2, false)).toBe(" (! 2 of 6 unknown)")
    expect(ack(6, 4, 0, 2, true)).toBe(" (! 2 of 6 unknown)")
  })
  test("a record with no quoted shas says so, never paints a pass", () => {
    expect(ack(0, 0, 0, 0, false)).toBe(" (no shas to place)")
    expect(ack(0, 0, 0, 0, true)).toBe(" (no shas)")
  })
})
