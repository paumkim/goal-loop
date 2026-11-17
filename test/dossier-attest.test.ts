/**
 * Unit tests for the attestation re-probe — `goal.dossier.attest`, the palette command that
 * answers what a counterparty holding a sealed dossier asks weeks later: is what the file
 * attested still true of the repository right now? The seal-time fixture is a real `sealRecord`
 * output with injected probes — no test spawns git — and the fresh answers come from a second
 * set of injected probes, so drift is constructed, never simulated against a live repository.
 * Pinned here: the parser never throws and never trusts, drift requires git to flip yes to no,
 * a fresh unknown is never drift and never a pass, a sha that was not clean at seal time cannot
 * regress, and an unsealed or unparsable file is named as such instead of being fabricated.
 */
import { describe, expect, test } from "bun:test"
import {
  attestSealedDossier,
  attestSummaryLine,
  attestationReportMarkdown,
  parseAttestationAppendix,
  selectNewestSealedDossier,
} from "../src/core/dossier-attest.ts"
import { sealRecord } from "../src/core/dossier-seal.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const now = 1_800_000_000_000 // 2027-01-15T08:00:00Z
const shaA = "a".repeat(40)
const shaB = "b".repeat(40)
const shortA = shaA.slice(0, 7)
const shortB = shaB.slice(0, 7)

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

const loopGoal = (loopHistory: GoalSnapshot["loopHistory"]): GoalSnapshot =>
  ({
    version: 1,
    id: "goal_attest",
    sessionID: "ses_attest",
    directory: "/tmp/attest",
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
    loopIteration: 2,
    loopObjective: "make every loop iteration visible at a glance",
    loopMaxLoops: 5,
    loopHistory,
    loopNotProgress: 0,
    elapsedMs: 600_000,
    evaluating: false,
    waiting: false,
  }) as GoalSnapshot

const allYes = (_sha: string) => true
const jailed = (answer: Record<string, boolean | "unknown">) => (sha: string) => answer[sha] ?? "unknown"

/** A sealed document over shaA quoted at v1 and shaB quoted at v1-v2, with seal-time probes all-yes by default. */
const sealedFixture = (shaProbes?: { verify?: Record<string, boolean | "unknown">; reach?: Record<string, boolean | "unknown">; sign?: Record<string, boolean | "unknown"> }) =>
  sealRecord(loopGoal([entry(1, shaA), entry(1, shaB), entry(2, shaB)]), "/tmp/attest", now, {
    verify: shaProbes?.verify ? jailed(shaProbes.verify) : allYes,
    reach: shaProbes?.reach ? jailed(shaProbes.reach) : allYes,
    sign: shaProbes?.sign ? jailed(shaProbes.sign) : allYes,
  }).markdown

describe("parseAttestationAppendix", () => {
  test("reads a fresh sealed document: stamp, directory, rows, iterations, answers", () => {
    const parsed = parseAttestationAppendix(sealedFixture())
    expect(parsed.kind).toBe("sealed")
    if (parsed.kind !== "sealed") return
    expect(parsed.stamp).toBe("2027-01-15T08:00:00.000Z")
    expect(parsed.directory).toBe("/tmp/attest")
    expect(parsed.gap).toBe(false)
    expect(parsed.rows.map((row) => row.sha)).toEqual([shortA, shortB])
    expect(parsed.rows[1]?.iterations).toEqual([1, 2])
    expect(parsed.rows.every((row) => row.exists === "yes" && row.onThisLine === "yes" && row.underSeal === "yes")).toBe(true)
    expect(parsed.malformed).toBe(0)
  })

  test("a plain export (no appendix) is unsealed, never attested", () => {
    const parsed = parseAttestationAppendix("# /goal-loop record\n\nbookkeeping only\n")
    expect(parsed.kind).toBe("unsealed")
  })

  test("a GAP record (no quoted shas) parses as the empty truth, gap=true, zero rows", () => {
    const gap = sealRecord(loopGoal([]), "/tmp/attest", now, {}).markdown
    const parsed = parseAttestationAppendix(gap)
    expect(parsed.kind).toBe("sealed")
    if (parsed.kind !== "sealed") return
    expect(parsed.gap).toBe(true)
    expect(parsed.rows).toEqual([])
  })

  test("a heading with no table and no GAP sentence is unparsable, never fabricated", () => {
    const parsed = parseAttestationAppendix("## Attestation (freshly probed at seal time)\n\njunk junk junk\n")
    expect(parsed.kind).toBe("unparsable")
  })

  test("a row with garbage answer cells degrades to unknown; a row without a sha is counted malformed", () => {
    const doc = [
      "## Attestation (freshly probed at seal time)",
      "",
      `_The bookkeeping above is the record's own and was not re-verified; the shas the record quotes were re-probed here, fresh, against \`/tmp/attest\`, at 2027-01-15T08:00:00.000Z: existence._`,
      "",
      "| sha | iterations | exists | on this line | under seal |",
      "| --- | --- | --- | --- | --- |",
      `| ${shaA.slice(0, 7)} | v1 | maybe | yes | YES |`,
      "| not-a-sha-cell-with-spaces | v1 | yes | yes | yes |",
      "",
    ].join("\n")
    const parsed = parseAttestationAppendix(doc)
    expect(parsed.kind).toBe("sealed")
    if (parsed.kind !== "sealed") return
    expect(parsed.rows.length).toBe(1)
    expect(parsed.rows[0]?.exists).toBe("unknown")
    expect(parsed.rows[0]?.onThisLine).toBe("yes") // cell answers are case-insensitive
    expect(parsed.rows[0]?.underSeal).toBe("yes")
    expect(parsed.malformed).toBe(1)
  })
})

describe("attestSealedDossier", () => {
  test("all yes at seal and all yes now: every sha is held, the appendix reads clean", () => {
    const result = attestSealedDossier(sealedFixture(), "/tmp/attest", {
      verify: allYes,
      reach: allYes,
      sign: allYes,
    })
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    expect(result.unique).toBe(2)
    expect(result.sealedClean).toBe(2)
    expect(result.held).toBe(2)
    expect(result.regressed).toBe(0)
    expect(result.rows.every((row) => row.verdict === "held" && row.flipped.length === 0)).toBe(true)
  })

  test("a yes flipped to a no is drift: regressed names the flipped question, the sibling sha holds", () => {
    const result = attestSealedDossier(sealedFixture(), "/tmp/attest", {
      verify: (sha) => (sha === shortA ? false : true),
      reach: allYes,
      sign: allYes,
    })
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    expect(result.regressed).toBe(1)
    expect(result.held).toBe(1)
    const rowA = result.rows.find((row) => row.sha === shortA)
    expect(rowA?.verdict).toBe("regressed")
    expect(rowA?.flipped).toEqual(["exists"])
    expect(attestSummaryLine(result)).toContain("drifted")
  })

  test("a fresh unknown is not drift and not a pass: the row reads unknown", () => {
    const result = attestSealedDossier(sealedFixture(), "/tmp/attest", {
      verify: () => "unknown",
      reach: allYes,
      sign: allYes,
    })
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    expect(result.regressed).toBe(0)
    expect(result.unknown).toBe(2)
    expect(result.rows.every((row) => row.verdict === "unknown")).toBe(true)
    expect(attestSummaryLine(result)).toContain("unverifiable")
  })

  test("a sha that was not clean at seal time cannot regress — it reads was-not-clean", () => {
    const fixture = sealedFixture({ sign: { [shaA]: false, [shaB]: true } }) // shaA fails the seal at seal time
    const result = attestSealedDossier(fixture, "/tmp/attest", {
      verify: allYes,
      reach: allYes,
      sign: allYes, // …and git verifies it now: information, not drift
    })
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    expect(result.sealedClean).toBe(1)
    const rowA = result.rows.find((row) => row.sha === shortA)
    expect(rowA?.verdict).toBe("was-not-clean")
    expect(result.regressed).toBe(0)
  })

  test("a flip to no wins over a co-occurring unknown when both touched the same sealed-clean row", () => {
    const result = attestSealedDossier(sealedFixture(), "/tmp/attest", {
      verify: (sha) => (sha === shortA ? false : true),
      reach: () => "unknown",
      sign: allYes,
    })
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    const rowA = result.rows.find((row) => row.sha === shortA)
    expect(rowA?.verdict).toBe("regressed")
    expect(rowA?.flipped).toEqual(["exists"])
    const rowB = result.rows.find((row) => row.sha === shortB)
    expect(rowB?.verdict).toBe("unknown")
  })

  test("the empty seal attests to zero shas — never a fabricated pass", () => {
    const gap = sealRecord(loopGoal([]), "/tmp/attest", now, {}).markdown
    const result = attestSealedDossier(gap, "/tmp/attest", {})
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    expect(result.unique).toBe(0)
    expect(attestSummaryLine(result)).toBe("sealed dossier quotes no shas to attest")
  })

  test("a probe that throws degrades its question to unknown for the row; the sweep never throws", () => {
    const result = attestSealedDossier(sealedFixture(), "/tmp/attest", {
      verify: () => {
        throw new Error("git exploded")
      },
      reach: allYes,
      sign: allYes,
    })
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    expect(result.rows.every((row) => row.now.exists === "unknown")).toBe(true)
    expect(result.regressed).toBe(0)
  })

  test("shas are re-probed exactly as the file spells them", () => {
    const seen: string[] = []
    const record = (sha: string) => {
      seen.push(sha)
      return true
    }
    attestSealedDossier(sealedFixture(), "/tmp/attest", { verify: record, reach: record, sign: record })
    expect(seen).toContain("a".repeat(7)) // the appendix prints the 7-char short sha
    expect(seen.filter((sha) => sha === "a".repeat(7)).length).toBeGreaterThanOrEqual(3) // all three questions
  })
})

describe("selectNewestSealedDossier", () => {
  test("picks the newest stamp; attempt suffix beats the base name at the same stamp", () => {
    const entries = [
      { name: "goal-dossier-sealed-20270115-080000.md", mtimeMs: 100 },
      { name: "goal-dossier-sealed-20270115-080000-2.md", mtimeMs: 90 },
      { name: "goal-dossier-sealed-20270116-080000.md", mtimeMs: 10 },
    ]
    expect(selectNewestSealedDossier(entries)).toBe("goal-dossier-sealed-20270116-080000.md")
    expect(selectNewestSealedDossier(entries.slice(0, 2))).toBe("goal-dossier-sealed-20270115-080000-2.md")
  })

  test("unrelated names are ignored and mtime breaks a tie; undefined when nothing qualifies", () => {
    const entries = [
      { name: "goal-dossier-20270116-080000.md", mtimeMs: 9999 }, // the plain export stem never qualifies
      { name: "goal-dossier-sealed-20270115-080000.md", mtimeMs: 50 },
      { name: "notes.md", mtimeMs: 9999 },
    ]
    expect(selectNewestSealedDossier(entries)).toBe("goal-dossier-sealed-20270115-080000.md")
    expect(selectNewestSealedDossier([entries[1]!, { name: "goal-dossier-sealed-20270115-080000-3.md", mtimeMs: 5 }])).toBe(
      "goal-dossier-sealed-20270115-080000-3.md",
    )
    expect(selectNewestSealedDossier([{ name: "goal-dossier-20270115-080000.md", mtimeMs: 1 }])).toBeUndefined()
    expect(selectNewestSealedDossier([])).toBeUndefined()
  })
})

describe("attestationReportMarkdown", () => {
  test("carries the file, both directories, the counts, the flipped question, and the tamper-honesty footer", () => {
    const result = attestSealedDossier(sealedFixture(), "/tmp/attest", {
      verify: (sha) => (sha === shortA ? false : true),
      reach: () => "unknown",
      sign: allYes,
    })
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    const report = attestationReportMarkdown(result, now + 60_000, "/tmp/attest", "goal-dossier-sealed-20270115-080000.md")
    expect(report).toContain("goal-dossier-sealed-20270115-080000.md")
    expect(report).toContain("/tmp/attest")
    expect(report).toContain("Sealed at: 2027-01-15T08:00:00.000Z")
    expect(report).toContain("regressed (exists)")
    expect(report).toContain("Held: 0")
    expect(report).toContain("regressed: 1")
    expect(report).toContain("tampering with the file")
    expect(report).toContain("was-not-clean")
  })

  test("an all-held attestation prints held for every sha and says only what three git processes answered", () => {
    const result = attestSealedDossier(sealedFixture(), "/tmp/attest", {
      verify: allYes,
      reach: allYes,
      sign: allYes,
    })
    expect(result.kind).toBe("attested")
    if (result.kind !== "attested") return
    const report = attestationReportMarkdown(result, now + 60_000, "/tmp/attest", "goal-dossier-sealed-20270115-080000.md")
    expect(report).toContain("Held: 2 · regressed: 0 · unknown: 0")
    expect(report).toContain("| aaaaaaa | yes · yes · yes | yes · yes · yes | held |")
  })
})

describe("attestSummaryLine", () => {
  test("the arms: nothing quoted, nothing sealed-clean, drifted, unverifiable, holds", () => {
    const at = (overrides: Partial<Extract<typeof base, { kind: "attested" }>>) => ({ ...base, ...overrides })
    const base = ((): Extract<ReturnType<typeof attestSealedDossier>, { kind: "attested" }> => {
      const result = attestSealedDossier(sealedFixture(), "/tmp/attest", {
        verify: allYes,
        reach: allYes,
        sign: allYes,
      })
      if (result.kind !== "attested") throw new Error("fixture sealed clean")
      return result
    })()
    expect(attestSummaryLine(at({ unique: 0, sealedClean: 0, held: 0 }))).toBe("sealed dossier quotes no shas to attest")
    expect(attestSummaryLine(at({ sealedClean: 0, held: 0 }))).toContain("nothing held")
    expect(attestSummaryLine(at({ regressed: 1, held: 1 }))).toContain("drifted")
    expect(attestSummaryLine(at({ unknown: 1, held: 1 }))).toContain("unverifiable")
    expect(attestSummaryLine(at({}))).toBe("attestation holds: 2 of 2 sealed-clean shas still clean")
  })
})
