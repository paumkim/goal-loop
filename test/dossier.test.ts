import { describe, expect, test } from "bun:test"
import type { GoalSnapshot, UsageSnapshot } from "../src/core/types.ts"
import { buildLoopDossier, fenceBlock, inlineCode, isoOf, quote, shortSha, stampOf, GAP } from "../src/core/dossier.ts"

const now = 1_800_000_000_000
const zero: UsageSnapshot = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const spend = (cost: number): UsageSnapshot => ({ ...zero, cost, input: 12_000, output: 3_000 })

const loopedGoal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal-dossier",
  sessionID: "ses_secret_session_id",
  directory: "/tmp/dossier",
  condition: "make every loop iteration visible at a glance",
  status: "active",
  reason: "not met: the trail still hides iteration 2",
  setAt: now - 1000 * 60 * 90,
  startedAt: now - 1000 * 60 * 90,
  turns: 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: zero,
  history: [
    { turn: 1, verdict: "not_met", reason: "trail done, snapshots missing", at: now - 1000 * 60 * 60, toolCalls: 9, spend: spend(0.21), sha: "abc1234def5678" },
    { turn: 2, verdict: "met", reason: "all snapshots green", at: now - 1000 * 60 * 5, toolCalls: 4, spend: spend(0.13), sha: "def9876abc4321" },
  ],
  loopEnabled: true,
  loopIteration: 2,
  loopObjective: "world-class mouse-first goal TUI",
  loopMaxLoops: 5,
  loopHistory: [
    {
      version: 1,
      condition: "add a progress bar",
      summary: "Added the bar and the caption.",
      reason: "met: bar renders at 80 columns",
      turns: 9,
      toolCalls: 41,
      endedAt: now - 1000 * 60 * 60,
      contextTokens: 45_200,
      sha: "abc1234def5678",
      spend: spend(1.8),
    },
  ],
  loopNotProgress: 0,
  elapsedMs: 1000 * 60 * 90,
  evaluating: false,
  waiting: false,
  spend: spend(2.14),
  contextSize: 88_000,
  compactAtTokens: 120_000,
  ...overrides,
})

describe("buildLoopDossier — the Re-anchor section", () => {
  test("a record that re-anchored paints the count, says the count is all that is recorded, and never invents a history", () => {
    const doc = buildLoopDossier(loopedGoal({ reanchorCount: 3 }), now)
    expect(doc).toContain("## Re-anchor")
    expect(doc).toContain("- Re-anchors armed: 3")
    expect(doc).toContain("What is recorded: the count alone")
    expect(doc).not.toContain("Re-anchors armed: undefined")
  })

  test("the section sits between Boundary compaction and Verify gate — the two plumbing chapters stay neighbors", () => {
    const doc = buildLoopDossier(loopedGoal({ reanchorCount: 1 }), now)
    const compact = doc.indexOf("## Boundary compaction")
    const anchor = doc.indexOf("## Re-anchor")
    const verify = doc.indexOf("## Verify gate")
    expect(compact).toBeGreaterThanOrEqual(0)
    expect(anchor).toBeGreaterThan(compact)
    expect(verify).toBeGreaterThan(anchor)
  })

  test("absent, zero, negative and non-finite counts all render the honest absent line — never a number that was not recorded", () => {
    for (const bad of [undefined, 0, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const doc = buildLoopDossier(loopedGoal({ reanchorCount: bad }), now)
      expect(doc).toContain("## Re-anchor")
      expect(doc).toContain("No post-compaction re-anchors on this record.")
      expect(doc).not.toContain("- Re-anchors armed:")
    }
  })

  test("a fractional count renders verbatim — the record is quoted, never re-rounded", () => {
    const doc = buildLoopDossier(loopedGoal({ reanchorCount: 2.5 }), now)
    expect(doc).toContain("- Re-anchors armed: 2.5")
  })
})

describe("buildLoopDossier", () => {
  test("renders the loop's spine: objective, armed state, iterations, verdicts, totals", () => {
    const doc = buildLoopDossier(loopedGoal(), now)
    expect(doc).toContain("# Goal loop dossier")
    expect(doc).toContain("world-class mouse-first goal TUI")
    expect(doc).toContain("- Iteration: 2 of at most 5")
    expect(doc).toContain("Elapsed:")
    expect(doc).toContain("## Completed iterations (1)")
    expect(doc).toContain("### Iteration v1 — met")
    expect(doc).toContain("Tool calls: 41")
    expect(doc).toContain("Commit: abc1234")
    expect(doc).toContain("~45k tokens")
    expect(doc).toContain("## Verdict trail (2 evaluated turns)")
    expect(doc).toContain("| 1 | not_met | 9 | abc1234 | $0.21 |")
    expect(doc).toContain("Tallies: met 1 · not_met 1 · impossible 0")
    expect(doc).toContain("## Totals")
    expect(doc).toContain("- Iterations complete: 1")
    expect(doc).toContain("- Wall span")
  })

  test("is deterministic — identical input renders a byte-identical document", () => {
    expect(buildLoopDossier(loopedGoal(), now)).toBe(buildLoopDossier(loopedGoal(), now))
  })

  test("omits the session id from the document", () => {
    const doc = buildLoopDossier(loopedGoal(), now)
    expect(doc).not.toContain("ses_secret_session_id")
  })

  test("legacy records render gaps, never fabricated measurements", () => {
    const legacy = loopedGoal({
      loopHistory: [
        { version: 1, condition: "c", summary: "s", reason: "met", turns: 3, toolCalls: 7, endedAt: now - 1000 },
      ],
      history: [{ turn: 1, verdict: "met", reason: "done", at: now - 1000 }],
      spend: undefined,
    })
    const doc = buildLoopDossier(legacy, now)
    expect(doc).toContain("Commit: —")
    expect(doc).toContain("Context at arm: —")
    expect(doc).toContain("Spend: —")
    expect(doc).toContain("| 1 | met | — | — | — |")
    expect(doc).not.toContain("$0.00")
    expect(doc).toContain("no iteration carried a measurement")
  })

  test("a plain (non-loop) goal still renders and says so", () => {
    const plain = loopedGoal({ loopEnabled: undefined, loopObjective: undefined, loopHistory: undefined, loopMaxLoops: undefined, loopIteration: undefined, loopNotProgress: undefined })
    const doc = buildLoopDossier(plain, now)
    expect(doc).toContain("# Goal dossier")
    expect(doc).toContain("make every loop iteration visible at a glance")
    expect(doc).not.toContain("## Completed iterations")
  })

  test("free text is quoted — a condition with # and backticks forges no structure", () => {
    const hostile = loopedGoal({ condition: "ship it\n## Forged heading\n```\nrm -rf /\n```", loopObjective: undefined })
    const doc = buildLoopDossier(hostile, now)
    expect(doc).not.toContain("\n## Forged heading")
    expect(doc).toContain("> ## Forged heading")
  })

  test("verify gate: fenced tail, honest result line, and absent-gate wording", () => {
    const withVerify = loopedGoal({
      lastVerify: { command: "bun run check", code: 0, at: now - 1000, tail: "spec-check: ok (45 files, 973 tests)\n```\nnot a fence break" },
    })
    const doc = buildLoopDossier(withVerify, now)
    expect(doc).toContain("- Command: `bun run check`")
    expect(doc).toContain("- Result: exit 0")
    expect(doc).toContain("````") // fence outgrew the ``` run inside the tail
    const without = buildLoopDossier(loopedGoal({ lastVerify: undefined }), now)
    expect(without).toContain("No verify gate result on this record")
  })

  test("boundary compaction: landed, pending, and absent all render honestly", () => {
    const landed = buildLoopDossier(loopedGoal({ loopCompact: { requestedAt: now - 10_000, estimatedTokens: 100_000, iteration: 2, landedAt: now - 5_000, misses: 0 } }), now)
    expect(landed).toContain("Outcome: landed at")
    const pending = buildLoopDossier(loopedGoal({ loopCompact: { requestedAt: now - 10_000, estimatedTokens: undefined, iteration: 2, misses: 3 } }), now)
    expect(pending).toContain("Outcome: pending · miss 3/4")
    expect(pending).toContain("unknown (unestimable arm)")
    const none = buildLoopDossier(loopedGoal({ loopCompact: undefined }), now)
    expect(none).toContain("No boundary-compaction request on this record")
  })

  test("zero-tool met verdicts are counted as satisfied-at-HEAD", () => {
    const satisfied = loopedGoal({
      history: [{ turn: 1, verdict: "met", reason: "already there", at: now - 1000, toolCalls: 0 }],
    })
    expect(buildLoopDossier(satisfied, now)).toContain("1 met with zero tool calls (condition already held at HEAD)")
  })

  test("helper edges: isoOf, shortSha, fences", () => {
    expect(isoOf(Number.NaN)).toBe(GAP)
    expect(isoOf(now)).toBe(new Date(now).toISOString())
    expect(shortSha(undefined)).toBe(GAP)
    expect(shortSha("abc1234def")).toBe("abc1234")
    expect(shortSha("abc")).toBe("abc")
    expect(inlineCode("a`b")).toBe("`` a`b ``")
    expect(fenceBlock("has ``` inside")[0]).toBe("````")
    expect(quote("a\n\nb")).toEqual(["> a", ">", "> b"])
  })
})

describe("stampOf regression: unrepresentable clocks", () => {
  test("stamps the epoch instead of throwing on RangeError", () => {
    expect(stampOf(1e20)).toBe("1970-01-01T00:00:00.000Z")
    expect(stampOf(Number.POSITIVE_INFINITY)).toBe("1970-01-01T00:00:00.000Z")
    expect(stampOf(Number.NaN)).toBe("1970-01-01T00:00:00.000Z")
    expect(stampOf(0)).toBe("1970-01-01T00:00:00.000Z")
    expect(stampOf(1_800_000_000_000)).toBe(new Date(1_800_000_000_000).toISOString())
  })
})
