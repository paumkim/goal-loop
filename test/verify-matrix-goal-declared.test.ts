import { describe, expect, test } from "bun:test"
import { computeScopePolicy, parseGoalDeclaredChecks, resolveVerifyChecks, evaluateCoveragePolicy } from "../src/core/verify-matrix.ts"
import { VERIFY_CHECK_TYPES, type VerifyCheckType } from "../src/core/types.ts"
import type { VerifyCheckType as TCanonical, VerifyEvidenceMode as ECanonical, VerifyCheckSource as SCanonical } from "../src/core/types.ts"
import type { VerifyCheckType as TConfig, VerifyEvidenceMode as EConfig } from "../src/core/config.ts"
import type { VerifyEvidenceMode as EMatrix, VerifyCheckSource as SMatrix } from "../src/core/verify-matrix.ts"

/** Compile-time identity: the re-exported aliases must be the very same union as the canonical one. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const _sameType: Same<TCanonical, TConfig> = true
const _sameEvidenceConfig: Same<ECanonical, EConfig> = true
const _sameEvidenceMatrix: Same<ECanonical, EMatrix> = true
const _sameSource: Same<SCanonical, SMatrix> = true
void [_sameType, _sameEvidenceConfig, _sameEvidenceMatrix, _sameSource]

describe("goal-declared verify directive parsing", () => {
  test("parses explicit structured directives and merges as typed command-executed checks", () => {
    const condition = [
      "Fix the thing.",
      'verify: type=typecheck cmd="bunx tsc --noEmit" id=tc when=always',
      'verify: type=tests cmd="bun test targeted" id=tests when=broad evidence=command',
      'verify: type=lint cmd="bun run lint" id=lint evidence=either artifacts="lint ok||0 problems"',
    ].join("\n")
    const parsed = parseGoalDeclaredChecks(condition)
    expect(parsed.malformed).toHaveLength(0)
    expect(parsed.checks.map((c) => ({ id: c.id, type: c.type, command: c.command, when: c.when, evidence: c.evidence, source: c.source, artifactPatterns: c.artifactPatterns }))).toEqual([
      { id: "tc", type: "typecheck", command: "bunx tsc --noEmit", when: "always", evidence: "command", source: "goal-declared", artifactPatterns: undefined },
      { id: "tests", type: "tests", command: "bun test targeted", when: "broad", evidence: "command", source: "goal-declared", artifactPatterns: undefined },
      { id: "lint", type: "lint", command: "bun run lint", when: "always", evidence: "either", source: "goal-declared", artifactPatterns: ["lint ok", "0 problems"] },
    ])

    const resolved = resolveVerifyChecks({ configured: [], condition })
    expect(resolved.malformed).toHaveLength(0)
    expect(resolved.checks).toHaveLength(3)
    expect(resolved.checks.every((c) => c.source === "goal-declared")).toBe(true)
  })

  test("a one-line fenced verify directive parses cleanly with an uncorrupted id and command", () => {
    const condition = [
      "Fix it.",
      '`verify: type=tests cmd="bun test" id=tc`',
      '`verify: type=lint cmd="bun run lint" evidence=either artifacts="lint ok||0 problems"`',
    ].join("\n")
    const parsed = parseGoalDeclaredChecks(condition)
    expect(parsed.malformed).toHaveLength(0)
    expect(parsed.checks.map((c) => ({ id: c.id, type: c.type, command: c.command, artifacts: c.artifactPatterns }))).toEqual([
      { id: "tc", type: "tests", command: "bun test", artifacts: undefined },
      { id: "goal-declared-lint-2", type: "lint", command: "bun run lint", artifacts: ["lint ok", "0 problems"] },
    ])
  })

  test("ignores and flags malformed declarations safely without throwing", () => {
    const condition = [
      'verify: type=tests cmd=bun test', // unquoted cmd
      'verify: type=bogus cmd="bun test"',
      'verify: cmd="bun test"', // missing type
      'verify: type=lint cmd="bun run lint" evidence=artifact', // missing artifacts
    'verify: type=tests', // missing cmd
      'verify: type=build cmd="bun run build" when=sometimes',
      'verify: type=tests cmd="bun test ok" id=ok',
    ].join("\n")
    const parsed = parseGoalDeclaredChecks(condition)
    expect(parsed.checks.map((c) => c.id)).toEqual(["ok"])
    expect(parsed.malformed.length).toBeGreaterThanOrEqual(4)
    expect(parsed.malformed.every((m) => m.malformed && m.raw.startsWith("verify:") && m.reason.length > 0)).toBe(true)
    // Exact text after the quoting standardization: values AND field names use the one JSON convention.
    expect(parsed.malformed.find((m) => m.raw.includes("type=bogus"))?.reason).toBe('invalid type "bogus"')
    expect(parsed.malformed.find((m) => m.raw.includes("when=sometimes"))?.reason).toBe('invalid when "sometimes"')
    expect(parsed.malformed.find((m) => m.raw === 'verify: cmd="bun test"')?.reason).toBe('missing required "type"')

    // The two "missing required" paths share one formatValue-based message shape.
    expect(parsed.malformed.find((m) => m.raw === "verify: type=tests")?.reason).toBe('missing required "cmd"')
    expect(parsed.malformed.find((m) => m.raw.includes("cmd=bun test"))?.reason).toBe("expected '=' after \"test\"")
  })

  test("merges goal-declared checks after configured/legacy checks with configured precedence by id", () => {
    const condition = 'verify: type=tests cmd="bun test from-goal" id=tests\nverify: type=lint cmd="bun run lint" id=lint'
    const resolved = resolveVerifyChecks({
      configured: [{ id: "tests", type: "tests", command: "bun test configured", required: true, when: "always" }],
      condition,
    })
    expect(resolved.checks.map((c) => [c.id, c.command, c.source])).toEqual([
      ["tests", "bun test configured", "configured"],
      ["lint", "bun run lint", "goal-declared"],
    ])
  })

  test("legacy verifyCommand synthesis is marked legacy", () => {
    const resolved = resolveVerifyChecks({
      configured: [{ id: "verify-command", type: "custom", command: "bun run check", required: true, when: "always", label: "verifyCommand" }],
      condition: "plain goal",
    })
    expect(resolved.checks[0]!.source).toBe("legacy")
  })
})

describe("deterministic verification coverage policy", () => {
  test("broad goal with generic-only legacy required check is coverage-unsatisfied", () => {
    const resolved = resolveVerifyChecks({
      configured: [{ id: "verify-command", type: "custom", command: "bun run check", required: true, when: "always", label: "verifyCommand" }],
      condition: "improve the entire codebase and finish the backlog",
    })
    const coverage = evaluateCoveragePolicy({ condition: "improve the entire codebase and finish the backlog", profile: "default", checks: resolved.checks })
    expect(coverage.policy.broadGoal).toBe(true)
    expect(coverage.ok).toBe(false)
    expect(coverage.reasons.join(" ")).toMatch(/generic-only|unscoped/i)
  })

  test("broad goal with scoped typed required checks satisfies deterministic coverage precheck", () => {
    const condition = 'improve verification across repo\nverify: type=typecheck cmd="bunx tsc --noEmit" id=tc\nverify: type=tests cmd="bun test" id=tests'
    const resolved = resolveVerifyChecks({ configured: [], condition })
    const coverage = evaluateCoveragePolicy({ condition, profile: "default", checks: resolved.checks })
    expect(coverage.policy.broadGoal).toBe(true)
    expect(coverage.ok).toBe(true)
  })

  test("scoped non-broad goal can be satisfied by explicit configured checks", () => {
    const resolved = resolveVerifyChecks({
      configured: [{ id: "tests", type: "tests", command: "bun test file.test.ts", required: true, when: "always" }],
      condition: "fix parser bug in file.test.ts",
    })
    const coverage = evaluateCoveragePolicy({ condition: "fix parser bug in file.test.ts", profile: "default", checks: resolved.checks })
    expect(coverage.policy.broadGoal).toBe(false)
    expect(coverage.ok).toBe(true)
  })

  test("an explicitly precomputed policy yields the same coverage decision as the internal recompute", () => {
    // verifyMet computes the scope policy once and hands it to the coverage precheck (Workstream XCIII); the
    // explicit-policy path must be identical to the default (recompute) path, else the shared object would drift.
    const condition = 'improve the entire codebase\nverify: type=typecheck cmd="bunx tsc --noEmit" id=tc'
    const resolved = resolveVerifyChecks({ configured: [], condition })
    const opts = { condition, profile: "default", checks: resolved.checks }
    const policy = computeScopePolicy(opts)
    const explicit = evaluateCoveragePolicy(opts, policy)
    expect(explicit).toEqual(evaluateCoveragePolicy(opts))
    // Prove the precomputed policy is actually consumed: if the explicit-policy path silently
    // recomputed its own policy, the two sides would still be equal but this identity check would fail.
    expect(explicit.policy).toBe(policy)
    expect(explicit.ok).toBe(true)
    expect(policy.broadGoal).toBe(true)
  })
})

describe("verification union types have one canonical home", () => {
  test("re-exports from config.ts and verify-matrix.ts are identical to the types.ts unions", () => {
    // The compile-time Same<> bindings above fail `tsc` if any alias drifts. This runtime case pins the
    // values the unions describe, so a future edit that changes one path's accepted literals is caught here.
    const types = ["typecheck", "tests", "lint", "build", "smoke", "custom", "goal-declared"] as const satisfies readonly TConfig[]
    const evidence = ["command", "artifact", "either"] as const satisfies readonly EMatrix[]
    const sources = ["configured", "legacy", "goal-declared"] as const satisfies readonly SMatrix[]
    expect(types.length).toBe(7)
    expect(evidence.length).toBe(3)
    expect(sources.length).toBe(3)
  })
})

describe("verify check types have one canonical set", () => {
  test("the canonical set drives parsing in config and verify-matrix for every accepted type", () => {
    const all = ["typecheck", "tests", "lint", "build", "smoke", "custom", "goal-declared"]
    expect([...VERIFY_CHECK_TYPES].sort()).toEqual(all.slice().sort())
    for (const type of all) {
      const parsed = parseGoalDeclaredChecks(`Fix it.\nverify: type=${type} cmd="bun test" id=x`)
      expect(parsed.checks.length).toBe(1)
      expect(parsed.checks[0]?.type).toBe(type as VerifyCheckType)
      expect(parsed.malformed.length).toBe(0)
    }
    // An off-list type is rejected by the same set, not by a per-module copy.
    expect(parseGoalDeclaredChecks('Fix it.\nverify: type=bogus cmd="bun test" id=x').malformed.length).toBe(1)
  })
})
