import { describe, expect, test } from "bun:test"
import { computeScopePolicy, parseGoalDeclaredChecks, resolveVerifyChecks, evaluateCoveragePolicy } from "../src/core/verify-matrix.ts"

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

  test("ignores and flags malformed declarations safely without throwing", () => {
    const condition = [
      'verify: type=tests cmd=bun test', // unquoted cmd
      'verify: type=bogus cmd="bun test"',
      'verify: cmd="bun test"', // missing type
      'verify: type=lint cmd="bun run lint" evidence=artifact', // missing artifacts
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
    expect(evaluateCoveragePolicy(opts, computeScopePolicy(opts))).toEqual(evaluateCoveragePolicy(opts))
  })
})
