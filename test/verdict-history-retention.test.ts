/**
 * The verdict-trail retention cap, unit level: the bounding helper itself, the cap-aware count the
 * displays use, and the honest surfaces (dossier, HUD remediation, sealed-dossier attestation note).
 * The controller-level behavior is exercised end to end in test/loop.test.ts.
 */
import { describe, expect, test } from "bun:test"
import type { GoalSnapshot, UsageSnapshot, Verdict, VerdictEntry } from "../src/core/types.ts"
import { boundVerdictHistory, totalVerdictCount, MAX_VERDICT_HISTORY_ENTRIES } from "../src/core/types.ts"
import { buildLoopDossier } from "../src/core/dossier.ts"
import { remediationFor } from "../src/core/hud.ts"
import { attestationAppendix } from "../src/core/dossier-seal.ts"

const verdict = (turn: number, kind: Verdict = "not_met"): VerdictEntry => ({
  turn,
  verdict: kind,
  reason: `turn ${turn} reason`,
  at: 1_700_000_000_000 + turn * 1000,
  toolCalls: 2,
  sha: "b".repeat(40),
})
const verdicts = (from: number, to: number, kind: Verdict = "not_met"): VerdictEntry[] =>
  Array.from({ length: to - from + 1 }, (_, i) => verdict(from + i, kind))

const zero: UsageSnapshot = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const now = 1_800_000_000_000

const goal = (history: VerdictEntry[], historyDropped?: number): GoalSnapshot => ({
  version: 1,
  id: "goal-verdict-retention",
  sessionID: "ses_secret_session_id",
  directory: "/tmp/verdict-retention",
  condition: "keep going",
  status: "active",
  setAt: now - 1000 * 60 * 30,
  startedAt: now - 1000 * 60 * 30,
  turns: history.length + (historyDropped ?? 0),
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: zero,
  history,
  ...(historyDropped !== undefined ? { historyDropped } : {}),
  loopEnabled: false,
  loopNotProgress: 0,
  loopObjective: "objective",
  elapsedMs: 1000 * 60 * 30,
  evaluating: false,
  waiting: false,
  spend: zero,
})

describe("boundVerdictHistory", () => {
  test("keeps everything at or below the cap and reports zero drops", () => {
    expect(boundVerdictHistory([])).toEqual({ retained: [], dropped: 0 })
    const atCap = verdicts(1, MAX_VERDICT_HISTORY_ENTRIES)
    const bound = boundVerdictHistory(atCap)
    expect(bound.dropped).toBe(0)
    expect(bound.retained.map((e) => e.turn)).toEqual(atCap.map((e) => e.turn))
  })

  test("drops the oldest entries beyond the cap and keeps the newest", () => {
    const all = verdicts(1, MAX_VERDICT_HISTORY_ENTRIES + 7)
    const bound = boundVerdictHistory(all)
    expect(bound.dropped).toBe(7)
    expect(bound.retained).toHaveLength(MAX_VERDICT_HISTORY_ENTRIES)
    expect(bound.retained[0]!.turn).toBe(8)
    expect(bound.retained.at(-1)!.turn).toBe(MAX_VERDICT_HISTORY_ENTRIES + 7)
  })
})

describe("totalVerdictCount", () => {
  test("is retained length when nothing was dropped (and 0 for empty/absent)", () => {
    expect(totalVerdictCount({})).toBe(0)
    expect(totalVerdictCount({ history: verdicts(1, 4) })).toBe(4)
  })

  test("adds the dropped count to the retained length", () => {
    expect(totalVerdictCount({ history: verdicts(6, 10), historyDropped: 5 })).toBe(10)
  })
})

describe("dossier says so when the trail was trimmed", () => {
  test("heading names retained vs evaluated and carries the unknown-not-inferred note", () => {
    const doc = buildLoopDossier(goal(verdicts(6, 10), 5), now)
    expect(doc).toContain("## Verdict trail (5 most recent of 10 evaluated turns)")
    expect(doc).toContain("5 earlier verdicts dropped by the verdict-trail retention cap")
    expect(doc).toContain("the dropped ones are unknown, never inferred")
    expect(doc).toContain("retained turns only")
  })

  test("untrimmed shape is byte-identical in heading and tallies", () => {
    const doc = buildLoopDossier(goal(verdicts(1, 3, "met")), now)
    expect(doc).toContain("## Verdict trail (3 evaluated turns)")
    expect(doc).not.toContain("retention cap")
    expect(doc).toContain("Tallies: met 3 · not_met 0 · impossible 0")
  })
})

describe("HUD remediation is honest about a trimmed trail", () => {
  test("a fully-not_met retained window with drops renders as a lower bound", () => {
    const remediation = remediationFor(goal(verdicts(6, 25), 5))
    expect(remediation?.text).toContain("at least 20 not_met in a row")
    expect(remediation?.text).not.toContain("20x not_met")
  })

  test("a streak broken inside the retained window stays exact even with drops", () => {
    const history = [...verdicts(1, 16), verdict(17, "met"), ...verdicts(18, 21)]
    const remediation = remediationFor(goal(history, 5))
    expect(remediation?.text).toContain("4x not_met in a row")
  })

  test("no drops keeps the plain exact streak text", () => {
    const remediation = remediationFor(goal(verdicts(1, 20)))
    expect(remediation?.text).toContain("20x not_met in a row")
  })
})

describe("sealed-dossier attestation names the retention caps", () => {
  const verification = { checks: [], unique: 0, mentions: 0, present: 0, missing: 0, unknown: 0 }
  const reach = { checks: [], unique: 0, mentions: 0, ancestors: 0, unreached: 0, unknown: 0 }
  const sign = { checks: [], unique: 0, mentions: 0, verified: 0, unverified: 0, unknown: 0 }

  test("a trimmed record says the dropped shas are not re-probed, never implied held", () => {
    const lines = attestationAppendix(goal(verdicts(1, 3), 2), verification, reach, sign, now, "/tmp/dir")
    const doc = lines.join("\n")
    expect(doc).toContain("2 earlier verdicts dropped by the retention caps")
    expect(doc).toContain("not re-probed here and are never implied held")
  })

  test("an untrimmed record carries no retention note", () => {
    const lines = attestationAppendix(goal(verdicts(1, 3)), verification, reach, sign, now, "/tmp/dir")
    const doc = lines.join("\n")
    expect(doc).not.toContain("retention caps")
  })
})
