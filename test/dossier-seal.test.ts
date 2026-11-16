/**
 * Unit tests for the sealed dossier — the `goal.dossier.seal` palette command and the dossier
 * view's seal row. The three probes are injected everywhere: no test spawns git, no test depends
 * on a repository. What is pinned here is the contract — the plain export path's bytes are left
 * alone (the appendix rides *after* the base document), the three sweeps are the existing ones
 * (verifyRecord / reachRecord / signRecord, never reimplemented), a clean sha answered yes on
 * all three questions, `unknown` never counts as a pass or a fail, and an empty record paints a
 * GAP sentence instead of a fabricated table.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  attestationAppendix,
  cleanShaCount,
  exportSealedDossier,
  sealAckSegment,
  sealRecord,
  sealSummaryLine,
  sealedDossierName,
} from "../src/core/dossier-seal.ts"
import { buildLoopDossier } from "../src/core/dossier.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const now = 1_800_000_000_000 // 2027-01-15T08:00:00Z — a fixed clock keeps every assertion deterministic
const shaA = "a".repeat(40)
const shaB = "b".repeat(40)

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

const loopGoal = (loopHistory: GoalSnapshot["loopHistory"], overrides: Partial<GoalSnapshot> = {}): GoalSnapshot =>
  ({
    version: 1,
    id: "goal_seal",
    sessionID: "ses_seal",
    directory: "/tmp/seal",
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
    ...overrides,
  }) as GoalSnapshot

const jailed = (answer: Record<string, boolean | "unknown">) => (sha: string) => answer[sha] ?? "unknown"

describe("sealedDossierName", () => {
  test("stamps the UTC clock stem and never reuses the plain export's stem", () => {
    expect(sealedDossierName(now)).toBe("goal-dossier-sealed-20270115-080000.md")
    expect(sealedDossierName(now, 1)).toBe("goal-dossier-sealed-20270115-080000-2.md")
    expect(sealedDossierName(now, 41)).toBe("goal-dossier-sealed-20270115-080000-42.md")
  })

  test("a non-finite clock stamps the epoch rather than throwing", () => {
    expect(sealedDossierName(Number.NaN)).toBe("goal-dossier-sealed-19700101-000000.md")
    expect(sealedDossierName(Number.POSITIVE_INFINITY)).toBe("goal-dossier-sealed-19700101-000000.md")
  })
})

describe("sealRecord", () => {
  test("carries the base document byte for byte and appends the attestation after it", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(seal.markdown.startsWith(buildLoopDossier(goal, now))).toBe(true)
    expect(seal.markdown).toContain("\n\n## Attestation (freshly probed at seal time)\n")
    expect(seal.markdown.indexOf("## Totals")).toBeLessThan(seal.markdown.indexOf("## Attestation"))
  })

  test("an all-clean sweep yields clean === unique and paints yes/yes/yes", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(seal.unique).toBe(2)
    expect(seal.clean).toBe(2)
    expect(seal.markdown).toContain(`| ${"a".repeat(7)} | v1 | yes | yes | yes |`)
    expect(seal.markdown).toContain(`| ${"b".repeat(7)} | v2 | yes | yes | yes |`)
    expect(seal.markdown).toContain("- All three: 2 of 2 shas clean (present · on this line · under seal)")
    expect(seal.markdown).toContain("/tmp/probed")
    expect(seal.markdown).toContain("2027-01-15T08:00:00.000Z")
  })

  test("a sha that fails the seal is not clean even when it resolves and reaches HEAD", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: (sha) => (sha === shaA ? true : false),
    })
    expect(seal.clean).toBe(1)
    expect(seal.markdown).toContain(`| ${"a".repeat(7)} | v1 | yes | yes | yes |`)
    expect(seal.markdown).toContain(`| ${"b".repeat(7)} | v2 | yes | yes | no |`)
    expect(seal.markdown).toContain("- All three: 1 of 2 shas clean")
  })

  test("a sha that is not on this line is not clean even when it resolves and is sealed", () => {
    const goal = loopGoal([entry(1, shaA)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => false,
      sign: () => true,
    })
    expect(seal.clean).toBe(0)
    expect(seal.markdown).toContain(`| ${"a".repeat(7)} | v1 | yes | no | yes |`)
  })

  test("a missing sha is not clean — existence gates the other two", () => {
    const goal = loopGoal([entry(1, shaA)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => false,
      reach: () => true,
      sign: () => true,
    })
    expect(seal.clean).toBe(0)
    expect(seal.markdown).toContain(`| ${"a".repeat(7)} | v1 | no | yes | yes |`)
  })

  test("unknown never counts as a pass or a fail — it rides its own column and its own counts line", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => "unknown",
    })
    expect(seal.clean).toBe(0)
    expect(seal.verification.unknown).toBe(0)
    expect(seal.sign.unknown).toBe(2)
    expect(seal.markdown).toContain(`| ${"a".repeat(7)} | v1 | yes | yes | unknown |`)
    expect(seal.markdown).toContain("- Seal: 0 of 2 shas under seal (0 not under seal — not an accusation; 2 unknown)")
  })

  test("a probe that throws degrades its row to unknown instead of sinking the seal", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: (sha) => {
        if (sha === shaA) throw new Error("git exploded")
        return true
      },
      reach: () => true,
      sign: () => true,
    })
    expect(seal.verification.checks[0]?.status).toBe("unknown")
    expect(seal.verification.checks[1]?.status).toBe("present")
    expect(seal.clean).toBe(1) // only shaB answered yes on all three
  })

  test("a record with no quoted shas paints the GAP sentence and no table", () => {
    const goal = loopGoal([entry(1, undefined), entry(2, undefined)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(seal.unique).toBe(0)
    expect(seal.clean).toBe(0)
    expect(seal.markdown).toContain("The record quotes no sha — there is nothing to seal.")
    expect(seal.markdown).not.toContain("| sha | iterations |")
  })

  test("the same sha quoted by several iterations lists them oldest first, deduplicated", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaA), entry(3, shaA)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(seal.verification.mentions).toBe(3)
    expect(seal.unique).toBe(1)
    expect(seal.markdown).toContain(`| ${"a".repeat(7)} | v1, v2, v3 | yes | yes | yes |`)
  })

  test("the appendix states the not-re-verified contract and the stale-copy caveat", () => {
    const goal = loopGoal([entry(1, shaA)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(seal.markdown).toContain("The bookkeeping above is the record's own and was not re-verified")
    expect(seal.markdown).toContain("a snapshot of its receipts at the moment it was written")
  })
})

describe("cleanShaCount", () => {
  test("joins the three sweeps by sha — every question must answer yes", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: jailed({ [shaA]: true, [shaB]: true }),
      reach: jailed({ [shaA]: true, [shaB]: false }),
      sign: jailed({ [shaA]: true, [shaB]: true }),
    })
    expect(cleanShaCount(seal.verification, seal.reach, seal.sign)).toBe(1)
  })
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dossier-seal-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("exportSealedDossier", () => {
  test("writes exactly the sealed bytes and reports the path, attempts and counts", () => {
    const goal = loopGoal([entry(1, shaA)])
    const result = exportSealedDossier(goal, now, dir, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(result.path).toBe(join(resolve(dir), "goal-dossier-sealed-20270115-080000.md"))
    expect(result.attempts).toBe(1)
    expect(result.unique).toBe(1)
    expect(result.clean).toBe(1)
    const written = readFileSync(result.path, "utf8")
    expect(written).toBe(
      sealRecord(goal, resolve(dir), now, { verify: () => true, reach: () => true, sign: () => true }).markdown,
    )
    expect(result.bytes).toBe(Buffer.byteLength(written, "utf8"))
  })

  test("never overwrites — a colliding stem retries with a numeric suffix", () => {
    const goal = loopGoal([entry(1, shaA)])
    const first = join(resolve(dir), "goal-dossier-sealed-20270115-080000.md")
    writeFileSync(first, "pre-existing bytes", "utf8")
    const result = exportSealedDossier(goal, now, dir, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(result.attempts).toBe(2)
    expect(result.path).toBe(join(resolve(dir), "goal-dossier-sealed-20270115-080000-2.md"))
    expect(readFileSync(first, "utf8")).toBe("pre-existing bytes")
    expect(existsSync(result.path)).toBe(true)
  })

  test("a directory that cannot be written to throws instead of resolving partial", () => {
    const goal = loopGoal([entry(1, shaA)])
    expect(() =>
      exportSealedDossier(goal, now, join(resolve(dir), "does-not-exist"), {
        verify: () => true,
        reach: () => true,
        sign: () => true,
      }),
    ).toThrow()
  })
})

describe("sealSummaryLine", () => {
  const goal = loopGoal([entry(1, shaA)])
  test("an untouched record with no quoted shas says so", () => {
    const seal = sealRecord(loopGoal([entry(1, undefined)]), "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(sealSummaryLine(seal)).toBe("record quotes no shas to seal")
  })

  test("all clean reads as a sealed record", () => {
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(sealSummaryLine(seal)).toBe("record sealed: 1 of 1 shas pass all three checks")
  })

  test("a hard failure reads as sealed with gaps — information, not accusation", () => {
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => false,
    })
    expect(sealSummaryLine(seal)).toBe("record sealed with gaps: 0 of 1 shas pass all three checks")
  })

  test("unknowns only read as unverifiable — never folded into gaps", () => {
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => "unknown",
      sign: () => "unknown",
    })
    expect(sealSummaryLine(seal)).toBe("record sealed, unverifiable: 2 of 3 checks could not answer")
  })
})

describe("sealAckSegment", () => {
  const goal = loopGoal([entry(1, shaA)])
  test("an empty record says so instead of painting a pass", () => {
    const seal = sealRecord(loopGoal([entry(1, undefined)]), "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(sealAckSegment(seal, false)).toBe(" (no shas to seal)")
    expect(sealAckSegment(seal, true)).toBe(" (no shas)")
  })

  test("all clean paints the check arm; ascii demotes to plus", () => {
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(sealAckSegment(seal, false)).toBe(" (✓ 1/1 sealed)")
    expect(sealAckSegment(seal, true)).toBe(" (+ 1/1 sealed)")
  })

  test("a hard failure paints the cross arm; ascii demotes to minus", () => {
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => false,
      reach: () => true,
      sign: () => true,
    })
    expect(sealAckSegment(seal, false)).toBe(" (✗ 0 of 1 sealed)")
    expect(sealAckSegment(seal, true)).toBe(" (- 0 of 1 sealed)")
  })

  test("unknowns only paint the bang arm", () => {
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => "unknown",
      reach: () => true,
      sign: () => true,
    })
    expect(sealAckSegment(seal, false)).toBe(" (! 0 of 1 sealed)")
    expect(sealAckSegment(seal, true)).toBe(" (! 0 of 1 sealed)")
  })
})

describe("attestationAppendix", () => {
  test("renders the GAP sentence with no table for an empty record", () => {
    const goal = loopGoal([entry(1, undefined)])
    const seal = sealRecord(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    const lines = attestationAppendix(goal, seal.verification, seal.reach, seal.sign, now, "/tmp/probed")
    expect(lines.join("\n")).toContain("nothing to seal")
    expect(lines.join("\n")).not.toContain("| sha | iterations |")
  })
})
