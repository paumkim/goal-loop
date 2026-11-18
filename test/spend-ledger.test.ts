/**
 * Unit tests for the spend ledger — the `goal.dossier.spend` palette command's artifact.
 * What is pinned here is the contract: one O_EXCL file whose per-iteration rows carry the
 * record's own usage deltas exactly (never rounded — the report is a receipt), totals that
 * sum only measured iterations and name the measurement count when it is partial, an
 * iteration counts as measured only when its full usage snapshot is present and finite,
 * nothing measured never reads as $0.00, free text cannot forge document structure, and
 * the session id never appears.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildSpendLedger,
  exportSpendLedger,
  spendLedgerName,
  spendSummaryLine,
} from "../src/core/spend-ledger.ts"
import type { GoalSnapshot, LoopEntry, UsageSnapshot } from "../src/core/types.ts"

const now = 1_800_000_000_000 // 2027-01-15T08:00:00Z — a fixed clock keeps every assertion deterministic
const shaA = "a".repeat(40)
const shaB = "b".repeat(40)

const spend = (overrides: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  cost: 0.42,
  input: 182_345,
  output: 21_000,
  reasoning: 3_000,
  cacheRead: 96_000,
  cacheWrite: 12_500,
  ...overrides,
})

const entry = (
  version: number,
  spendOverrides: UsageSnapshot | undefined | "corrupt",
  sha: string | undefined = shaA,
): LoopEntry => ({
  version,
  condition: `objective pass ${version}`,
  summary: `summary ${version}`,
  reason: "met",
  turns: 5,
  toolCalls: 9,
  endedAt: 1_700_000_000_000 + version * 1000,
  ...(sha === undefined ? {} : { sha }),
  ...(spendOverrides === undefined
    ? {}
    : spendOverrides === "corrupt"
      ? { spend: { ...spend(), input: Number.NaN } }
      : { spend: spendOverrides }),
})

const loopGoal = (loopHistory: LoopEntry[], overrides: Partial<GoalSnapshot> = {}): GoalSnapshot =>
  ({
    version: 1,
    id: "goal_spend",
    sessionID: "ses_spend_secret",
    directory: "/tmp/spend",
    condition: "ship the release notes",
    status: "achieved",
    setAt: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    turns: 10,
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
    ...overrides,
  }) as GoalSnapshot

describe("spendLedgerName", () => {
  test("stamps the UTC clock stem and never reuses the dossier, review, or sealed stems", () => {
    expect(spendLedgerName(now)).toBe("goal-spend-ledger-20270115-080000.md")
    expect(spendLedgerName(now, 1)).toBe("goal-spend-ledger-20270115-080000-2.md")
    expect(spendLedgerName(now, 41)).toBe("goal-spend-ledger-20270115-080000-42.md")
    expect(spendLedgerName(now)).not.toContain("goal-dossier")
  })

  test("a non-finite clock stamps the epoch rather than throwing", () => {
    expect(spendLedgerName(Number.NaN)).toBe("goal-spend-ledger-19700101-000000.md")
    expect(spendLedgerName(Number.POSITIVE_INFINITY)).toBe("goal-spend-ledger-19700101-000000.md")
  })
})

describe("buildSpendLedger", () => {
  test("renders one row per landed iteration with exact figures, sha, tools, and timestamps", () => {
    const goal = loopGoal([entry(1, spend(), shaA), entry(2, spend({ cost: 0.1, input: 10 }), shaB)])
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.iterations).toBe(2)
    expect(ledger.measured).toBe(2)
    expect(ledger.markdown).toContain("# Goal loop spend ledger")
    expect(ledger.markdown).toContain("_Generated 2027-01-15T08:00:00.000Z")
    expect(ledger.markdown).toContain("| v1 | 2023-11-14T22:13:21.000Z | $0.42 | 182345 | 21000 | 3000 | 96000 | 12500 | 9 | aaaaaaa |")
    expect(ledger.markdown).toContain("$0.10")
    expect(ledger.markdown).toContain("bbbbbbb")
  })

  test("totals sum measured iterations and say how many were measured", () => {
    const goal = loopGoal([entry(1, spend(), shaA), entry(2, spend({ cost: 0.08, input: 18 }), shaB)])
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.spendTotal).toBeCloseTo(0.5, 10)
    expect(ledger.markdown).toContain("- Spend across measured iterations: $0.50")
    expect(ledger.markdown).toContain("- In tokens: 182363 · Out tokens: 42000 · Reasoning tokens: 6000")
    expect(ledger.markdown).toContain("- Cache read: 192000 · Cache write: 25000")
    expect(ledger.markdown).not.toContain("not $0.00")
  })

  test("a partial measurement names the measured fraction and never reads the rest as $0.00", () => {
    const goal = loopGoal([entry(1, spend(), shaA), entry(2, undefined, shaB)])
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.measured).toBe(1)
    expect(ledger.markdown).toContain("$0.42 (1 of 2 iterations measured — the unmeasured iterations are not $0.00; they are unknown)")
    expect(ledger.markdown).toContain("- Token totals sum the 1 measured iterations only; adding the 1 unmeasured ones would be inventing numbers.")
    // the unmeasured row renders dashes, never fabricated figures
    expect(ledger.markdown).toContain("| v2 | 2023-11-14T22:13:22.000Z | — | — | — | — | — | — | 9 | bbbbbbb |")
  })

  test("nothing measured renders no $0.00 claim anywhere", () => {
    const goal = loopGoal([entry(1, undefined, shaA)])
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.measured).toBe(0)
    expect(ledger.spendTotal).toBeUndefined()
    expect(ledger.markdown).toContain("- Spend across iterations: no iteration carried a measurement")
    expect(ledger.markdown).toContain("- In tokens: — · Out tokens: — · Reasoning tokens: —")
    expect(ledger.markdown).not.toContain("$0.00")
  })

  test("a snapshot with a non-finite field degrades its whole iteration to unmeasured", () => {
    const goal = loopGoal([entry(1, "corrupt", shaA)])
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.measured).toBe(0)
    expect(ledger.markdown).toContain("| v1 | 2023-11-14T22:13:21.000Z | — | — | — | — | — | — | 9 | aaaaaaa |")
  })

  test("an empty record says so instead of fabricating a table or a figure", () => {
    const goal = loopGoal([])
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.iterations).toBe(0)
    expect(ledger.measured).toBe(0)
    expect(ledger.markdown).toContain("None — this record has not landed an iteration, so there is nothing to attribute. No figures are claimed.")
    expect(ledger.markdown).toContain("- Spend across iterations: no iteration carried a measurement")
  })

  test("the session id never appears and free text is quoted, not structure", () => {
    const goal = loopGoal([entry(1, spend(), shaA)], { loopObjective: "objective with ```fence\nand ## heading\nand — dash" })
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.markdown).not.toContain("ses_spend_secret")
    expect(ledger.markdown).toContain("> objective with ```fence")
    expect(ledger.markdown).toContain("> and ## heading")
  })

  test("a zero-cost measurement is still a measurement and renders $0, never a gap", () => {
    const goal = loopGoal([entry(1, spend({ cost: 0 }), shaA)])
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.measured).toBe(1)
    expect(ledger.markdown).toContain("| v1 | 2023-11-14T22:13:21.000Z | $0 |")
    expect(ledger.markdown).toContain("- Spend across measured iterations: $0")
  })

  test("a non-loop record renders the condition heading and an honest empty ledger", () => {
    const goal = loopGoal([], { loopEnabled: false, loopObjective: undefined })
    const ledger = buildSpendLedger(goal, now)
    expect(ledger.markdown).toContain("# Goal spend ledger")
    expect(ledger.markdown).toContain("## Condition")
  })

  test("the same record and clock render the same bytes", () => {
    const goal = loopGoal([entry(1, spend(), shaA), entry(2, undefined, shaB)])
    expect(buildSpendLedger(goal, now).markdown).toBe(buildSpendLedger(goal, now).markdown)
  })
})

describe("exportSpendLedger", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spend-ledger-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("writes one new file and reports path, bytes, and attempts", () => {
    const goal = loopGoal([entry(1, spend(), shaA)])
    const result = exportSpendLedger(goal, now, dir)
    expect(result.attempts).toBe(1)
    expect(result.path).toBe(join(dir, "goal-spend-ledger-20270115-080000.md"))
    expect(existsSync(result.path)).toBe(true)
    expect(result.bytes).toBe(Buffer.byteLength(readFileSync(result.path, "utf8"), "utf8"))
    expect(result.iterations).toBe(1)
    expect(result.measured).toBe(1)
  })

  test("the written bytes match a fresh build of the same clock", () => {
    const goal = loopGoal([entry(1, spend(), shaA)])
    const result = exportSpendLedger(goal, now, dir)
    expect(readFileSync(result.path, "utf8")).toBe(buildSpendLedger(goal, now).markdown)
  })

  test("never overwrites — a collision suffixes and the pre-existing bytes survive", () => {
    const goal = loopGoal([entry(1, spend(), shaA)])
    const first = join(dir, "goal-spend-ledger-20270115-080000.md")
    writeFileSync(first, "pre-existing bytes", "utf8")
    const result = exportSpendLedger(goal, now, dir)
    expect(result.attempts).toBe(2)
    expect(result.path).toBe(join(dir, "goal-spend-ledger-20270115-080000-2.md"))
    expect(readFileSync(first, "utf8")).toBe("pre-existing bytes")
  })

  test("a missing directory throws with the filesystem's own message", () => {
    const goal = loopGoal([entry(1, spend(), shaA)])
    expect(() => exportSpendLedger(goal, now, join(dir, "no-such-dir"))).toThrow()
  })
})

describe("spendSummaryLine", () => {
  test("names the no-iteration, nothing-measured, partial, and complete arms", () => {
    expect(spendSummaryLine({ iterations: 0, measured: 0 })).toBe("no landed iterations to report")
    expect(spendSummaryLine({ iterations: 3, measured: 0 })).toBe("spend ledger written: no iteration carried a measurement (0 of 3)")
    expect(spendSummaryLine({ iterations: 3, measured: 2, spendTotal: 0.5 })).toBe(
      "spend ledger written: $0.50 across 2 of 3 measured iterations",
    )
    expect(spendSummaryLine({ iterations: 2, measured: 2, spendTotal: 1.234 })).toBe(
      "spend ledger written: $1.23 across 2 iterations",
    )
    expect(spendSummaryLine({ iterations: 1, measured: 1, spendTotal: 0.42 })).toBe(
      "spend ledger written: $0.42 across 1 iteration",
    )
  })
})

