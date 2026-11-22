/**
 * Unit tests for the record-on-trial module — the dossier tab's verify row and the
 * `goal.dossier.verify` palette twin. The probe is injected everywhere: no test spawns git,
 * no test depends on a repository. What is pinned here is the contract — only the shas the
 * record quotes are checked, dedupe is first-appearance order with the quoting iterations
 * listed, an unanswerable probe is `unknown` and never folded into `missing`, a probe that
 * throws degrades one row to `unknown` instead of sinking the sweep, and the report/ack
 * strings say exactly what the sweep found, no more.
 */
import { describe, expect, test } from "bun:test"
import {
  recordShaMentions,
  verifyRecord,
  verifyReportMarkdown,
  verifyAckSegment,
  verifySummaryLine,
  type RecordProbe,
} from "../src/core/verify-record.ts"
import { conditionCellOf } from "../src/core/dossier.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const loopGoal = (loopHistory: GoalSnapshot["loopHistory"]): GoalSnapshot =>
  ({
    version: 1,
    id: "goal_verify",
    sessionID: "ses_verify",
    directory: "/tmp/verify",
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

const present: RecordProbe = () => true
const absent: RecordProbe = () => false
const unanswerable: RecordProbe = () => "unknown"

describe("recordShaMentions", () => {
  test("a record with no loop shas yields nothing — never a fabricated check", () => {
    expect(recordShaMentions(loopGoal([entry(1, undefined), entry(2, undefined)]))).toEqual([])
    expect(recordShaMentions(loopGoal(undefined))).toEqual([])
  })
  test("first-appearance order, deduplicated, quoting iterations listed oldest first", () => {
    const mentions = recordShaMentions(
      loopGoal([entry(1, "a".repeat(40)), entry(2, "b".repeat(40)), entry(3, "a".repeat(40)), entry(4, "c".repeat(40))]),
    )
    expect(mentions.map((m) => m.sha)).toEqual(["a".repeat(40), "b".repeat(40), "c".repeat(40)])
    expect(mentions.map((m) => m.iterations)).toEqual([[1, 3], [2], [4]])
  })
  test("surrounding whitespace is trimmed; blank shas never reach the probe", () => {
    const mentions = recordShaMentions(loopGoal([entry(1, "  " + "d".repeat(40) + "  "), entry(2, "   ")]))
    expect(mentions.map((m) => m.sha)).toEqual(["d".repeat(40)])
  })
})

describe("verifyRecord", () => {
  test("all-present sweep — unique, mentions, per-sha iterations, counts", () => {
    const v = verifyRecord(loopGoal([entry(1, "1".repeat(40)), entry(2, "1".repeat(40)), entry(3, "2".repeat(40))]), present)
    expect(v.unique).toBe(2)
    expect(v.mentions).toBe(3)
    expect(v.present).toBe(2)
    expect(v.missing).toBe(0)
    expect(v.unknown).toBe(0)
    expect(v.checks.map((c) => c.status)).toEqual(["present", "present"])
    expect(v.checks[0]?.iterations).toEqual([1, 2])
  })
  test("mixed sweep — present, missing and unknown stay in their own buckets", () => {
    const bySha = new Map<string, boolean | "unknown">([["1".repeat(40), true], ["2".repeat(40), false], ["3".repeat(40), "unknown"]])
    const v = verifyRecord(
      loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40)), entry(3, "3".repeat(40))]),
      (sha) => bySha.get(sha) ?? "unknown",
    )
    expect([v.present, v.missing, v.unknown]).toEqual([1, 1, 1])
    expect(v.checks.map((c) => c.status)).toEqual(["present", "missing", "unknown"])
  })
  test("a probe that throws degrades one row to unknown — the sweep still answers the rest", () => {
    const v = verifyRecord(
      loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))]),
      (sha) => {
        if (sha.startsWith("1")) throw new Error("probe exploded")
        return true
      },
    )
    expect(v.checks.map((c) => c.status)).toEqual(["unknown", "present"])
    expect(v.unknown).toBe(1)
    expect(v.present).toBe(1)
  })
  test("an unanswerable probe is all-unknown, never all-missing", () => {
    const v = verifyRecord(loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))]), unanswerable)
    expect([v.present, v.missing, v.unknown]).toEqual([0, 0, 2])
  })
  test("a non-hex sha reaches the probe and reports whatever git says — absence is one bit, never fabricated", () => {
    expect(verifyRecord(loopGoal([entry(1, "not-a-sha")]), absent).checks[0]?.status).toBe("missing")
    expect(verifyRecord(loopGoal([entry(1, "not-a-sha")]), present).checks[0]?.status).toBe("present")
  })
  test("an empty record verifies to nothing — zero counts, no checks, honest", () => {
    const v = verifyRecord(loopGoal(undefined), present)
    expect([v.unique, v.mentions, v.present, v.missing, v.unknown]).toEqual([0, 0, 0, 0, 0])
  })
})

describe("verifyReportMarkdown", () => {
  const verificationOf = (entries: GoalSnapshot["loopHistory"], probe: RecordProbe = present) =>
    verifyRecord(loopGoal(entries), probe)
  const stamp = Date.UTC(2026, 10, 16, 18, 0, 0)

  test("carries the generation stamp, the probed directory, and the condition", () => {
    const report = verifyReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), verificationOf([entry(1, "a".repeat(40))]), stamp, "/repo/dir")
    expect(report).toContain("# /goal-loop record verification")
    expect(report).toContain(`- Generated: ${new Date(stamp).toISOString()}`)
    expect(report).toContain("- Repository: /repo/dir")
    expect(report).toContain("- Condition: ship the release notes")
  })
  test("tables every unique sha with the iterations that quote it and the verdict cell", () => {
    const report = verifyReportMarkdown(
      loopGoal([entry(1, "a".repeat(40)), entry(2, "a".repeat(40)), entry(3, "b".repeat(40))]),
      verificationOf([entry(1, "a".repeat(40)), entry(2, "a".repeat(40)), entry(3, "b".repeat(40))], (sha) => !sha.startsWith("b")),
      stamp,
      "/repo/dir",
    )
    expect(report).toContain("| aaaaaaa | v1, v2 | yes |")
    expect(report).toContain("| bbbbbbb | v3 | no |")
    expect(report).toContain("- Present: 1 · missing: 1 · unknown: 0")
    expect(report).toContain("unique across 3 mentions")
  })
  test("an empty record paints a GAP row, not an empty table", () => {
    const report = verifyReportMarkdown(loopGoal(undefined), verificationOf(undefined), stamp, "/repo/dir")
    expect(report).toContain("| — | — | — |")
    expect(report).toContain("0 unique across 0 mentions")
  })
  test("unknown cells are spelled unknown, never folded into missing", () => {
    const report = verifyReportMarkdown(
      loopGoal([entry(1, "a".repeat(40))]),
      verificationOf([entry(1, "a".repeat(40))], unanswerable),
      stamp,
      "/repo/dir",
    )
    expect(report).toContain("| aaaaaaa | v1 | unknown |")
    expect(report).toContain("- Present: 0 · missing: 0 · unknown: 1")
  })
  test("the honesty footer states what existence and absence do and do not prove", () => {
    const report = verifyReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), verificationOf([entry(1, "a".repeat(40))]), stamp, "/repo/dir")
    expect(report).toContain("Existence is not ancestry")
    expect(report).toContain("unresolvable receipt, not proof of misconduct")
    expect(report).toContain("never counted as missing")
  })
  test("a stale report cannot masquerade as a live check — the stamp and directory ride every copy", () => {
    const earlier = verifyReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), verificationOf([entry(1, "a".repeat(40))]), stamp, "/one/repo")
    const later = verifyReportMarkdown(loopGoal([entry(1, "a".repeat(40))]), verificationOf([entry(1, "a".repeat(40))]), stamp + 60_000, "/two/repo")
    expect(earlier).not.toEqual(later)
    expect(earlier).toContain("/one/repo")
    expect(later).toContain("/two/repo")
  })
})

describe("verifySummaryLine", () => {
  test("phrases the outcome without chrome — the caller paints its own", () => {
    const goal = loopGoal([entry(1, "1".repeat(40)), entry(2, "2".repeat(40))])
    expect(verifySummaryLine(verifyRecord(goal, present))).toBe("record verifies: 2 of 2 shas resolve")
    expect(verifySummaryLine(verifyRecord(goal, () => false))).toBe("record does not verify: 2 of 2 shas unresolvable")
    expect(verifySummaryLine(verifyRecord(goal, unanswerable))).toBe("record unverifiable: 2 of 2 shas could not be checked")
    expect(verifySummaryLine(verifyRecord(loopGoal(undefined), present))).toBe("record quotes no shas to verify")
  })
})

describe("verifyAckSegment", () => {
  const ack = (unique: number, present: number, missing: number, unknown: number, ascii: boolean) =>
    verifyAckSegment({ unique, present, missing, unknown }, ascii)

  test("all-resolve paints the pass in both arms", () => {
    expect(ack(6, 6, 0, 0, false)).toBe(" (✓ 6/6 resolve)")
    expect(ack(6, 6, 0, 0, true)).toBe(" (+ 6/6 resolve)")
  })
  test("missing outranks unknown in the paint — the louder truth wins", () => {
    expect(ack(6, 3, 2, 1, false)).toBe(" (✗ 2 of 6 unresolvable)")
    expect(ack(6, 3, 2, 1, true)).toBe(" (- 2 of 6 unresolvable)")
    expect(ack(6, 4, 0, 2, false)).toBe(" (! 2 of 6 unknown)")
    expect(ack(6, 4, 0, 2, true)).toBe(" (! 2 of 6 unknown)")
  })
  test("a record with no quoted shas says so, never paints a pass", () => {
    expect(ack(0, 0, 0, 0, false)).toBe(" (no shas to verify)")
    expect(ack(0, 0, 0, 0, true)).toBe(" (no shas)")
  })
})

describe("conditionCellOf (shared record condition formatter)", () => {
  test("flattens whitespace, falls back to GAP, and truncates at 200 chars", () => {
    expect(conditionCellOf(undefined)).toBe("—")
    expect(conditionCellOf("   ")).toBe("—")
    expect(conditionCellOf("  ship\n the\t release   notes  ")).toBe("ship the release notes")
    const atLimit = "x".repeat(200)
    expect(conditionCellOf(atLimit)).toBe(atLimit)
    expect(conditionCellOf(`${atLimit}y`)).toBe(`${atLimit}…`)
  })
})
