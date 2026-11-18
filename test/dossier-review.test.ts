/**
 * Unit tests for the record review — the `goal.dossier.review` palette command's artifact. The
 * three probes are injected everywhere: no test spawns git, no test depends on a repository.
 * What is pinned here is the contract — the record's own bytes are left byte-for-byte in place
 * (the appendix rides *after* the base document), the three sweeps are the existing ones
 * (verifyRecord / reachRecord / signRecord, never reimplemented), a clean row requires a yes on
 * all three questions, `gaps` means at least one no somewhere, `unknown` never counts as clean
 * or gaps, and an empty record paints a GAP sentence instead of a fabricated table.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildReview,
  exportReview,
  reviewName,
  reviewSummaryLine,
  reviewVerdict,
} from "../src/core/dossier-review.ts"
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
    id: "goal_review",
    sessionID: "ses_review",
    directory: "/tmp/review",
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

describe("reviewName", () => {
  test("stamps the UTC clock stem and never reuses the sealed or plain export stems", () => {
    expect(reviewName(now)).toBe("goal-dossier-review-20270115-080000.md")
    expect(reviewName(now, 1)).toBe("goal-dossier-review-20270115-080000-2.md")
    expect(reviewName(now, 41)).toBe("goal-dossier-review-20270115-080000-42.md")
  })

  test("a non-finite clock stamps the epoch rather than throwing", () => {
    expect(reviewName(Number.NaN)).toBe("goal-dossier-review-19700101-000000.md")
    expect(reviewName(Number.POSITIVE_INFINITY)).toBe("goal-dossier-review-19700101-000000.md")
  })
})

describe("reviewVerdict", () => {
  test("clean requires a yes on all three questions", () => {
    expect(reviewVerdict("yes", "yes", "yes")).toBe("clean")
  })

  test("any no anywhere makes the row gaps, wherever it sits", () => {
    expect(reviewVerdict("no", "yes", "yes")).toBe("gaps")
    expect(reviewVerdict("yes", "no", "yes")).toBe("gaps")
    expect(reviewVerdict("yes", "yes", "no")).toBe("gaps")
    expect(reviewVerdict("no", "no", "no")).toBe("gaps")
    expect(reviewVerdict("no", "unknown", "yes")).toBe("gaps")
  })

  test("no no anywhere but at least one unknown is unknown, never clean and never gaps", () => {
    expect(reviewVerdict("unknown", "yes", "yes")).toBe("unknown")
    expect(reviewVerdict("yes", "unknown", "yes")).toBe("unknown")
    expect(reviewVerdict("yes", "yes", "unknown")).toBe("unknown")
    expect(reviewVerdict("unknown", "unknown", "unknown")).toBe("unknown")
  })
})

describe("buildReview", () => {
  test("carries the base document byte for byte and appends the review after it", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const review = buildReview(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(review.markdown.startsWith(buildLoopDossier(goal, now))).toBe(true)
    expect(review.markdown).toContain("\n\n## Review (freshly probed at generation time)\n")
    expect(review.markdown.indexOf("## Totals")).toBeLessThan(review.markdown.indexOf("## Review"))
  })

  test("an all-clean sweep yields clean === unique and paints yes/yes/yes/clean", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const review = buildReview(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(review.unique).toBe(2)
    expect(review.clean).toBe(2)
    expect(review.gaps).toBe(0)
    expect(review.unknown).toBe(0)
    expect(review.markdown).toContain(`| ${"a".repeat(7)} | v1 | yes | yes | yes | clean |`)
    expect(review.markdown).toContain(`| ${"b".repeat(7)} | v2 | yes | yes | yes | clean |`)
    expect(review.markdown).toContain("- All three: 2 of 2 shas clean (present · on this line · under seal) · 0 with gaps · 0 unverifiable")
    expect(review.markdown).toContain("/tmp/probed")
    expect(review.markdown).toContain("2027-01-15T08:00:00.000Z")
  })

  test("a sha that fails any one question reads gaps, wherever it failed", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const review = buildReview(goal, "/tmp/probed", now, {
      verify: (sha) => (sha === shaA ? false : true),
      reach: () => true,
      sign: () => true,
    })
    expect(review.clean).toBe(1)
    expect(review.gaps).toBe(1)
    expect(review.markdown).toContain(`| ${"a".repeat(7)} | v1 | no | yes | yes | gaps |`)
    expect(review.markdown).toContain(`| ${"b".repeat(7)} | v2 | yes | yes | yes | clean |`)
  })

  test("an unanswerable question with no no anywhere reads unknown, never clean and never gaps", () => {
    const goal = loopGoal([entry(1, shaA)])
    const review = buildReview(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => "unknown",
    })
    expect(review.clean).toBe(0)
    expect(review.gaps).toBe(0)
    expect(review.unknown).toBe(1)
    expect(review.markdown).toContain(`| ${"a".repeat(7)} | v1 | yes | yes | unknown | unknown |`)
  })

  test("a probe that throws degrades its question to unknown rather than failing the build", () => {
    const goal = loopGoal([entry(1, shaA)])
    const review = buildReview(goal, "/tmp/probed", now, {
      verify: () => {
        throw new Error("no git binary")
      },
      reach: () => true,
      sign: () => true,
    })
    expect(review.unknown).toBe(1)
    expect(review.markdown).toContain(`| ${"a".repeat(7)} | v1 | unknown | yes | yes | unknown |`)
  })

  test("mixed record: jailed answers land in the counts and the rows", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const review = buildReview(goal, "/tmp/probed", now, {
      verify: jailed({ [shaA]: true, [shaB]: true }),
      reach: jailed({ [shaA]: true, [shaB]: false }),
      sign: jailed({ [shaA]: false, [shaB]: true }),
    })
    expect(review.clean).toBe(0)
    expect(review.gaps).toBe(2)
    expect(review.markdown).toContain(`| ${"a".repeat(7)} | v1 | yes | yes | no | gaps |`)
    expect(review.markdown).toContain(`| ${"b".repeat(7)} | v2 | yes | no | yes | gaps |`)
  })

  test("a record with no quoted shas renders the GAP sentence and no table", () => {
    const goal = loopGoal([entry(1, undefined), entry(2, undefined)])
    const review = buildReview(goal, "/tmp/probed", now, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(review.unique).toBe(0)
    expect(review.clean).toBe(0)
    expect(review.markdown).toContain("The record quotes no sha — there is nothing to review.")
    expect(review.markdown).not.toContain("| sha | quoted at |")
  })
})

describe("reviewSummaryLine", () => {
  test("names the empty record, the clean record, the gaps and the unverifiable", () => {
    expect(reviewSummaryLine({ unique: 0, clean: 0, gaps: 0, unknown: 0 })).toBe("record quotes no shas to review")
    expect(reviewSummaryLine({ unique: 3, clean: 3, gaps: 0, unknown: 0 })).toBe("review written: 3 of 3 shas clean on all three questions")
    expect(reviewSummaryLine({ unique: 3, clean: 1, gaps: 2, unknown: 0 })).toBe("review written with gaps: 1 of 3 shas clean on all three questions")
    expect(reviewSummaryLine({ unique: 3, clean: 1, gaps: 0, unknown: 2 })).toBe("review unverifiable: 1 of 3 shas clean, 2 could not answer")
  })
})

describe("exportReview", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "goal-review-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("writes the review as one new file and reports path, bytes and attempts", () => {
    const goal = loopGoal([entry(1, shaA)])
    const result = exportReview(goal, now, dir, {
      verify: () => true,
      reach: () => true,
      sign: () => true,
    })
    expect(result.path).toBe(join(dir, "goal-dossier-review-20270115-080000.md"))
    expect(result.attempts).toBe(1)
    expect(result.bytes).toBe(Buffer.byteLength(readFileSync(result.path, "utf8"), "utf8"))
    expect(result.unique).toBe(1)
    expect(result.clean).toBe(1)
  })

  test("never overwrites: a collision retries with the numeric suffix", () => {
    const goal = loopGoal([entry(1, shaA)])
    const probes = { verify: () => true as const, reach: () => true as const, sign: () => true as const }
    writeFileSync(join(dir, "goal-dossier-review-20270115-080000.md"), "someone else's bytes", "utf8")
    const result = exportReview(goal, now, dir, probes)
    expect(result.path).toBe(join(dir, "goal-dossier-review-20270115-080000-2.md"))
    expect(result.attempts).toBe(2)
    expect(readFileSync(join(dir, "goal-dossier-review-20270115-080000.md"), "utf8")).toBe("someone else's bytes")
  })

  test("the written file's bytes match a fresh build of the same clock", () => {
    const goal = loopGoal([entry(1, shaA), entry(2, shaB)])
    const probes = { verify: () => true as const, reach: () => true as const, sign: () => true as const }
    const result = exportReview(goal, now, dir, probes)
    const expected = buildReview(goal, dir, now, probes)
    expect(readFileSync(result.path, "utf8")).toBe(expected.markdown)
    expect(existsSync(result.path)).toBe(true)
  })

  test("a directory that rejects the write throws with the filesystem's own message", () => {
    const goal = loopGoal([entry(1, shaA)])
    expect(() =>
      exportReview(goal, now, join(dir, "does-not-exist"), {
        verify: () => true,
        reach: () => true,
        sign: () => true,
      }),
    ).toThrow()
  })
})
