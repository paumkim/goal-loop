import { describe, expect, test } from "bun:test"
import { isInheritModelValue, parseModelRef, resolveConfig } from "../src/core/config.ts"
import { classifyFailure, isNotFoundError, type FailureClass } from "../src/core/errors.ts"
import { diffUsage, elideAtWordBoundary, formatDuration, formatDurationCoarse, formatSpend, formatStatus, formatTokens, outcomeStory, truncate, wrapLines } from "../src/core/format.ts"
import stringWidth from "string-width"
import { parseGoalCommand, parseGoalLoopDirective } from "../src/core/parse.ts"
import { PLANNED_CONDITION_MAX_CHARS, parsePlan, planGoalRequest } from "../src/core/planner.ts"
import {
  checkin,
  compactGoalInstructions,
  continuation,
  directive,
  evaluateIndependently,
  evaluateInSession,
  loopContinuation,
  nativeEvaluationRequest,
  retry,
  systemReminder,
} from "../src/core/prompts.ts"
import { renderParentSummary, renderTranscript } from "../src/core/transcript.ts"
import { findNativeReport, isEvaluatorReport, parseSubagentReport, verdictFromNativeReport, echoedCondition, conditionEchoMatches } from "../src/core/evaluator-agent.ts"
import { DELEGATE_VERDICT } from "../src/core/prompts.ts"
import { EMPTY_USAGE, NO_COMMIT, type CommitPolicy, type GoalRecord } from "../src/core/types.ts"
import { isAlreadySatisfiedLanding, parseVerdict } from "../src/core/verdict.ts"

const COMMIT: CommitPolicy = { required: true, branch: "dev", reason: "test" }

describe("parseGoalCommand", () => {
  test("no arguments shows status", () => {
    expect(parseGoalCommand("", 4000)).toEqual({ type: "status" })
    expect(parseGoalCommand("   \n ", 4000)).toEqual({ type: "status" })
  })
  test("clear aliases, case-insensitive", () => {
    for (const word of ["clear", "stop", "off", "reset", "none", "cancel", "CLEAR", " Stop "])
      expect(parseGoalCommand(word, 4000)).toEqual({ type: "clear" })
  })
  test("anything else sets the goal, unquoted and trimmed", () => {
    expect(parseGoalCommand("  all tests pass  ", 4000)).toEqual({ type: "set", condition: "all tests pass" })
    expect(parseGoalCommand('"npm test exits 0"', 4000)).toEqual({ type: "set", condition: "npm test exits 0" })
    expect(parseGoalCommand("stop the server and lint is clean", 4000).type).toBe("set")
  })
  test("a lone unmatched quote is status, not a one-character condition", () => {
    // An unterminated opener (`/goal "`) used to set the condition to the bare quote character.
    for (const quote of ['"', "'", "`"]) expect(parseGoalCommand(quote, 4000)).toEqual({ type: "status" })
  })
  test("enforces the length limit", () => {
    const result = parseGoalCommand("x".repeat(4001), 4000)
    expect(result.type).toBe("invalid")
  })
})

describe("parseGoalLoopDirective", () => {
  test("plain /goal-loop keeps the default (no override)", () => {
    expect(parseGoalLoopDirective("/goal-loop fix the auth tests")).toEqual({ objective: "fix the auth tests" })
    expect(parseGoalLoopDirective("/goal-loop investigate the 12 failing tests")).toEqual({ objective: "investigate the 12 failing tests" })
  })
  test("-<N> and =<N> set a per-run override", () => {
    expect(parseGoalLoopDirective("/goal-loop-188 fix the whole release pipeline")).toEqual({ objective: "fix the whole release pipeline", maxLoops: 188 })
    expect(parseGoalLoopDirective("/goal-loop=3 audit the TUI")).toEqual({ objective: "audit the TUI", maxLoops: 3 })
    expect(parseGoalLoopDirective("/goal-loop-1 x")).toEqual({ objective: "x", maxLoops: 1 })
    expect(parseGoalLoopDirective("/goal-loop-1000 x")).toEqual({ objective: "x", maxLoops: 1000 })
  })
  test("the count is never part of the objective", () => {
    expect(parseGoalLoopDirective("/goal-loop-188 objective 12 things")?.objective).toBe("objective 12 things")
  })
  test("invalid counts are reported, never guessed: abc, 0, 1001, 1.5, -3, empty", () => {
    for (const raw of ["/goal-loop-abc fix it", "/goal-loop-0 fix it", "/goal-loop-1001 fix it", "/goal-loop-1.5 fix it", "/goal-loop--3 fix it", "/goal-loop- fix it", "/goal-loop= fix it"]) {
      const parsed = parseGoalLoopDirective(raw)
      expect(parsed).toBeDefined()
      expect(parsed?.maxLoops).toBeUndefined()
      expect(typeof parsed?.invalidCount).toBe("string")
      expect(parsed?.objective).toBe("fix it")
    }
    expect(parseGoalLoopDirective("/goal-loop-abc fix it")?.invalidCount).toBe("abc")
  })
  test("zero-padded counts are integers in range", () => {
    expect(parseGoalLoopDirective("/goal-loop-007 x")?.maxLoops).toBe(7)
  })
  test("a bare directive parses with an empty objective (status behavior upstream)", () => {
    expect(parseGoalLoopDirective("/goal-loop")).toEqual({ objective: "" })
    expect(parseGoalLoopDirective("/goal-loop   ")).toEqual({ objective: "" })
    expect(parseGoalLoopDirective("/goal-loop-12")).toEqual({ objective: "", maxLoops: 12 })
  })
  test("leading whitespace is tolerated; the directive must otherwise be first", () => {
    expect(parseGoalLoopDirective("  /goal-loop-5 x")?.maxLoops).toBe(5)
    expect(parseGoalLoopDirective("please /goal-loop-5 x")).toBeUndefined()
    expect(parseGoalLoopDirective("/goal-loopy thing")).toBeUndefined()
    expect(parseGoalLoopDirective("/goal-loops thing")).toBeUndefined()
    expect(parseGoalLoopDirective("/goal fix it")).toBeUndefined()
  })
  test("tab after the token still bounds it", () => {
    expect(parseGoalLoopDirective("/goal-loop-12\tfix it")).toEqual({ objective: "fix it", maxLoops: 12 })
  })
})

describe("parseVerdict", () => {
  test("strict JSON", () => {
    expect(parseVerdict('{"verdict":"met","reason":"tests pass"}')).toEqual({ verdict: "met", reason: "tests pass" })
  })
  test("fenced JSON with prose and thinking", () => {
    const text = '<think>hmm {not json}</think>Sure.\n```json\n{"verdict": "not_met", "reason": "lint fails"}\n```'
    expect(parseVerdict(text)).toEqual({ verdict: "not_met", reason: "lint fails" })
  })
  test("braces inside strings do not break extraction", () => {
    expect(parseVerdict('{"reason":"saw {x} in output","verdict":"impossible"}')?.verdict).toBe("impossible")
  })
  test("synonyms and line fallback", () => {
    expect(parseVerdict('{"verdict":"Not yet met","reason":""}')?.verdict).toBe("not_met")
    expect(parseVerdict('{"status":"achieved"}')?.verdict).toBe("met")
    expect(parseVerdict("VERDICT: impossible\nREASON: the API was removed")).toEqual({ verdict: "impossible", reason: "the API was removed" })
  })
  test("garbage yields undefined", () => {
    expect(parseVerdict("")).toBeUndefined()
    expect(parseVerdict("I think we are close")).toBeUndefined()
    expect(parseVerdict('{"verdict":"maybe"}')).toBeUndefined()
  })
  test("blocked/cannot are not_met, not impossible", () => {
    expect(parseVerdict('{"verdict":"blocked","reason":"waiting"}')?.verdict).toBe("not_met")
    expect(parseVerdict('{"verdict":"cannot","reason":"no api"}')?.verdict).toBe("not_met")
    expect(parseVerdict('{"verdict":"impossible"}')?.verdict).toBe("impossible")
    expect(parseVerdict('{"verdict":"infeasible"}')?.verdict).toBe("impossible")
  })
  test("long reasons are clamped", () => {
    expect(parseVerdict(JSON.stringify({ verdict: "met", reason: "a".repeat(5000) }))!.reason.length).toBeLessThanOrEqual(4000)
  })
  test("forward-pointer gate: a met on the already-satisfied path without a next: line fails closed to not_met", () => {
    const out = parseVerdict('{"verdict":"met","reason":"Already satisfied at HEAD 3f3e1eb. No new work is produced by this iteration."}')
    expect(out?.verdict).toBe("not_met")
    expect(out?.reason).toContain("duplicate-without-forward-pointer")
    expect(out?.reason).toContain("Already satisfied at HEAD 3f3e1eb") // the original reason is quoted, fail closed
  })
  test("forward-pointer gate: a met on the already-satisfied path with a next: line naming a gap is accepted", () => {
    const out = parseVerdict('{"verdict":"met","reason":"Already satisfied at HEAD 3f3e1eb. No new work is produced by this iteration. next: docs/core.html stale cards"}')
    expect(out?.verdict).toBe("met")
    expect(out?.reason).toContain("next: docs/core.html stale cards")
  })
  test("isAlreadySatisfiedLanding mirrors the gate: only already-satisfied + next: qualifies", () => {
    expect(isAlreadySatisfiedLanding("Already satisfied at HEAD 3f3e1eb. next: docs/core.html stale cards")).toBe(true)
    expect(isAlreadySatisfiedLanding("No new work is produced by this iteration.\nnext: src/runtime/store.ts")).toBe(true)
    expect(isAlreadySatisfiedLanding("Already satisfied at HEAD 3f3e1eb. Nothing left to do.")).toBe(false)
    expect(isAlreadySatisfiedLanding("merged aa5e196: work landed; next: follow-up")).toBe(false) // genuinely new work
    expect(isAlreadySatisfiedLanding("all tests pass")).toBe(false)
  })
  test("forward-pointer gate: 'next: none', 'n/a' and an empty pointer name no concrete gap", () => {
    for (const reason of [
      "Already satisfied at HEAD 3f3e1eb. No new work is produced by this iteration. next: none",
      "Already satisfied at HEAD 3f3e1eb. next: n/a",
      "Already satisfied at HEAD 3f3e1eb. next:",
    ]) {
      expect(isAlreadySatisfiedLanding(reason)).toBe(false)
      const out = parseVerdict(JSON.stringify({ verdict: "met", reason }))
      expect(out?.verdict).toBe("not_met")
      expect(out?.reason).toContain("duplicate-without-forward-pointer")
    }
    // A concrete pointer still lands, including the rubric's multi-line numbered form.
    expect(isAlreadySatisfiedLanding("Already satisfied at HEAD 3f3e1eb. next:\n1. [high] add fuzz coverage")).toBe(true)
  })

  test("forward-pointer gate: 'no new work' and 'nothing to do' phrasing is gated the same", () => {
    expect(parseVerdict('{"verdict":"met","reason":"no new work was needed at this HEAD"}')?.verdict).toBe("not_met")
    expect(parseVerdict('{"verdict":"met","reason":"The work was already done. Nothing to do."}')?.verdict).toBe("not_met")
  })
  test("forward-pointer gate: a met for genuinely new work (no already-satisfied phrasing) is untouched", () => {
    expect(parseVerdict('{"verdict":"met","reason":"merged aa5e196: unified finish-time prune; 1693 tests green"}')?.verdict).toBe("met")
  })
  test("forward-pointer gate: the VERDICT-line fallback path is gated the same", () => {
    expect(parseVerdict("VERDICT: met\nREASON: Already satisfied at HEAD 3f3e1eb.")?.verdict).toBe("not_met")
    expect(parseVerdict("VERDICT: met\nREASON: Already satisfied at HEAD 3f3e1eb. next: src/runtime/store.ts")?.verdict).toBe("met")
  })
  test("forward-pointer gate: not_met and impossible are never gated", () => {
    expect(parseVerdict('{"verdict":"not_met","reason":"already satisfied but tempted"}')?.verdict).toBe("not_met")
    expect(parseVerdict('{"verdict":"impossible","reason":"already satisfied with something unavailable"}')?.verdict).toBe("impossible")
  })
  test("a verdict object with raw newlines in the reason parses (live evaluator output)", () => {
    const text = `{"verdict":"met","reason":"(a) Clause-by-clause judgment with evidence ref
clause=commit, status=satisfied
(b) Gaps: none material.
next: none"}`
    expect(parseVerdict(text)).toEqual({
      verdict: "met",
      reason: "(a) Clause-by-clause judgment with evidence ref\nclause=commit, status=satisfied\n(b) Gaps: none material.\nnext: none",
    })
  })
  test("a verdict object with an unescaped quote in the reason parses", () => {
    const text = `{"verdict":"not_met","reason":"(a) Tests failed
(b) Missing gate output for "bun run check"
next: run the gate"}`
    expect(parseVerdict(text)?.verdict).toBe("not_met")
    expect(parseVerdict(text)?.reason).toContain('"bun run check"')
    expect(parseVerdict(text)?.reason).toContain("next: run the gate")
  })
  test("a double-encoded verdict object parses", () => {
    const inner = JSON.stringify({ verdict: "met", reason: "merged abc1234: all gates green" })
    expect(parseVerdict(JSON.stringify(inner))).toEqual({ verdict: "met", reason: "merged abc1234: all gates green" })
  })
  test("a verdict object truncated mid-reason still yields its verdict token", () => {
    const text = '{"verdict":"met","reason":"(a) Clause-by-clause judgment with evidence ref'
    expect(parseVerdict(text)?.verdict).toBe("met")
    expect(parseVerdict(text)?.reason).toContain("Clause-by-clause judgment")
  })
  test("the lenient pass never manufactures a verdict from reason-only or unknown-token JSON", () => {
    expect(parseVerdict('{"reason":"(a) clause matrix"}')).toBeUndefined()
    expect(parseVerdict('{"verdict":"maybe","reason":"(a) unclear"}')).toBeUndefined()
    expect(parseVerdict('prose saying "verdict":"met" without an object')).toBeUndefined()
  })
  test("the lenient pass ignores a verdict-looking token quoted inside a reason string", () => {
    const text = '{"foo":1,"reason":"prior eval said "verdict":"met", but that was wrong\n and I disagree"}'
    expect(parseVerdict(text)).toBeUndefined()
    // A genuine top-level verdict key still wins even when the reason quotes another verdict token.
    expect(parseVerdict('{"verdict":"not_met","reason":"quoted "verdict":"met" in prose"}')?.verdict).toBe("not_met")
  })
  test("a verdict object quoted inside a malformed reason never overrides the outer verdict", () => {
    // jsonObjects used to restart its scan at every `{`, so the inner quoted object was parsed as a
    // top-level candidate by the strict pass before the lenient pass could see the real field.
    const notMet = '{"verdict":"not_met","reason":"prior eval returned\n{"verdict":"met"} but it was wrong"}'
    expect(parseVerdict(notMet)?.verdict).toBe("not_met")
    const met = '{"verdict":"met","reason":"prior eval returned\n{"verdict":"not_met"} but it was wrong"}'
    expect(parseVerdict(met)?.verdict).toBe("met")
  })
  test("the lenient pass finds the real verdict key after an embedded token in the reason", () => {
    // The old lenient pass used `.exec()` (first match only): the embedded token was rejected by the
    // object-key guard, then the loop moved to the next key instead of the next `"verdict"` occurrence.
    const text = '{"reason":"prior eval said "verdict":"met", but that was wrong\n and I disagree","verdict":"not_met"}'
    expect(parseVerdict(text)?.verdict).toBe("not_met")
  })

  test("structured reasons with clause matrix and next actions parse (compatibility)", () => {
    const met = parseVerdict(JSON.stringify({
      verdict: "met",
      reason: "(a) Clause 1: clause=commit landed, required=commit hash+branch, observed=abc1234 on wt/x merged to dev, status=satisfied, source/turn=turn 3.\\n(b) Gaps/flaws/risks: none material. What would falsify met? hidden regression in untested path. What important risk is untested? integration smoke.\\n(c) Repeated-failure/escalation: none.\\nnext: none",
    }))
    expect(met?.verdict).toBe("met")
    expect(met?.reason).toContain("clause=commit landed")
    expect(met?.reason).toContain("What would falsify met?")
    expect(met?.reason).toContain("next: none")

    const notMet = parseVerdict(JSON.stringify({
      verdict: "not_met",
      reason: "(a) Clause 1: clause=tests pass, required=bun run check output, observed=none, status=missing, source/turn=n/a.\\n(b) Gaps/flaws/risks: missing fresh gate evidence. What would falsify met? tests fail. What important risk is untested? build artifacts.\\n(c) Repeated-failure/escalation: none.\\nnext:\\n1. [high/risk] Run and show bun run check in worktree — gap/finding: no fresh gate output — proof: terminal output with exit 0.",
    }))
    expect(notMet?.verdict).toBe("not_met")
    expect(notMet?.reason).toContain("status=missing")
    expect(notMet?.reason).toContain("next:")
  })
})

describe("classifyFailure", () => {
  test("fatal errors clear the goal", () => {
    expect(classifyFailure({ status: 401, message: "nope" }).kind).toBe("fatal")
    expect(classifyFailure({ message: "Your credit balance is too low" }).kind).toBe("fatal")
    expect(classifyFailure({ status: 429, message: "You exceeded your current quota" }).kind).toBe("fatal")
    expect(classifyFailure({ message: "prompt is too long: 210000 tokens" }).kind).toBe("fatal")
    expect(classifyFailure({ type: "provider.model-not-found", message: "model gpt-x not found" }).kind).toBe("fatal")
  })
  test("rate limits pause", () => {
    expect(classifyFailure({ status: 429, message: "slow down" }).kind).toBe("pause")
    expect(classifyFailure({ message: "Rate limit reached" }).kind).toBe("pause")
  })
  test("overload and network errors retry", () => {
    expect(classifyFailure({ status: 529, message: "Overloaded" }).kind).toBe("transient")
    expect(classifyFailure({ message: "fetch failed: ECONNRESET" }).kind).toBe("transient")
  })
  test("unknown errors pause with their message", () => {
    expect(classifyFailure({ message: "weird thing" })).toEqual({ kind: "pause", label: "weird thing" })
    expect(classifyFailure(undefined).kind).toBe("pause")
  })
  // Parametrized taxonomy per src/core/errors.ts status + pattern order (402/404/413/408/500, hook, capacity, timeout).
  const cases: Array<[string, Parameters<typeof classifyFailure>[0], FailureClass]> = [
    ["402 credit bare", { status: 402 }, "fatal"],
    ["402 payment required", { status: 402, message: "Payment Required" }, "fatal"],
    ["402 message credit", { message: "insufficient credit balance" }, "fatal"],
    ["404 model", { status: 404, message: "model gpt-x not found" }, "fatal"],
    ["404 bare model", { status: 404 }, "fatal"],
    ["404 session not found pauses, not model", { status: 404, message: "session not found" }, "pause"],
    ["413 context", { status: 413 }, "fatal"],
    ["413 context message", { status: 413, message: "prompt is too long" }, "fatal"],
    ["408 timeout", { status: 408 }, "transient"],
    ["500 server", { status: 500 }, "transient"],
    ["503 unavailable", { status: 503, message: "service unavailable" }, "transient"],
    ["529 overload", { status: 529, message: "Overloaded" }, "transient"],
    ["hook pauses", { message: "hook denied this turn" }, "pause"],
    ["capacity transient", { message: "capacity exceeded, try again" }, "transient"],
    ["timeout transient", { message: "request timed out" }, "transient"],
    ["evaluator timeout transient", { message: "evaluator timed out after 120s (attempt 1/3)" }, "transient"],
    ["AbortError transient", { message: "This operation was aborted" }, "transient"],
    ["429 bare pauses", { status: 429 }, "pause"],
    ["429 rate limit pauses", { status: 429, message: "Rate limit reached" }, "pause"],
    ["429 quota is fatal credit", { status: 429, message: "You exceeded your current quota" }, "fatal"],
    ["429 credit balance fatal", { status: 429, message: "insufficient credit" }, "fatal"],
    ["401 auth", { status: 401 }, "fatal"],
    ["403 auth", { status: 403 }, "fatal"],
    ["network transient", { message: "fetch failed: ECONNRESET" }, "transient"],
    ["unknown pauses", { message: "weird thing" }, "pause"],
  ]
  for (const [name, input, kind] of cases) {
    test(`classify: ${name}`, () => {
      expect(classifyFailure(input).kind).toBe(kind)
    })
  }
  test("isNotFoundError only for definitive not-found", () => {
    expect(isNotFoundError({ status: 404, message: "session not found" })).toBeTrue()
    expect(isNotFoundError(new Error("session not found"))).toBeTrue()
    expect(isNotFoundError({ message: "no such session" })).toBeTrue()
    expect(isNotFoundError(new Error("ECONNRESET socket hang up"))).toBeFalse()
    expect(isNotFoundError(new Error("timeout"))).toBeFalse()
    expect(isNotFoundError(undefined)).toBeFalse()
    expect(isNotFoundError(null)).toBeFalse()
  })
})

describe("config", () => {
  test("model refs", () => {
    expect(parseModelRef("opencode/big-pickle")).toEqual({ providerID: "opencode", id: "big-pickle" })
    expect(parseModelRef("openrouter/anthropic/claude#high")).toEqual({ providerID: "openrouter", id: "anthropic/claude", variant: "high" })
    expect(parseModelRef("nope")).toBeUndefined()
    expect(parseModelRef("/x")).toBeUndefined()
  })
  test("auto mode picks independent only with a model", () => {
    expect(resolveConfig({}).evaluator.mode).toBe("session")
    expect(resolveConfig({ evaluator: { model: "a/b" } }).evaluator.mode).toBe("independent")
    expect(resolveConfig({ evaluator: { mode: "independent" } }).evaluator.mode).toBe("session")
    expect(resolveConfig({ evaluator: { model: "a/b", mode: "session" } }).evaluator.mode).toBe("session")
  })
  test("inherit sentinel: all sources, aliases, case and whitespace", () => {
    expect(isInheritModelValue("inherit")).toBe(true)
    expect(isInheritModelValue(" INHERIT ")).toBe(true)
    for (const alias of ["session", "parent", "current", "active"]) {
      expect(isInheritModelValue(alias.toUpperCase())).toBe(true)
    }
    expect(isInheritModelValue("provider/model")).toBe(false)
    expect(isInheritModelValue(undefined)).toBe(false)
    expect(isInheritModelValue(42)).toBe(false)
  })
  test("inherit sentinel resolves to inheritModel, not a pinned model", () => {
    const nested = resolveConfig({ evaluator: { model: "Inherit" } })
    expect(nested.evaluator.inheritModel).toBe(true)
    expect(nested.evaluator.model).toBeUndefined()
    expect(nested.evaluator.mode).toBe("independent")
    const env = resolveConfig({}, { OPENCODE_GOAL_MODEL: " parent " })
    expect(env.evaluator.inheritModel).toBe(true)
    expect(env.evaluator.model).toBeUndefined()
    expect(env.evaluator.mode).toBe("independent")
    const top = resolveConfig({ model: "CURRENT" })
    expect(top.evaluator.inheritModel).toBe(true)
    expect(top.evaluator.model).toBeUndefined()
    expect(top.evaluator.mode).toBe("independent")
    for (const alias of ["inherit", "session", "parent", "current", "active"]) {
      expect(resolveConfig({ evaluator: { model: alias } }).evaluator.inheritModel).toBe(true)
    }
  })
  test("inherit sentinel: explicit mode overrides, default stays byte-compatible", () => {
    expect(resolveConfig({ evaluator: { model: "inherit", mode: "session" } }).evaluator.mode).toBe("session")
    expect(resolveConfig({ evaluator: { model: "inherit", mode: "independent" } }).evaluator.mode).toBe("independent")
    const plain = resolveConfig({})
    expect(plain.evaluator.inheritModel).toBe(false)
    expect(plain.evaluator.model).toBeUndefined()
    expect(plain.evaluator.mode).toBe("session")
    const pinned = resolveConfig({ evaluator: { model: "a/b" } })
    expect(pinned.evaluator.inheritModel).toBe(false)
    expect(pinned.evaluator.model).toEqual({ providerID: "a", id: "b" })
    expect(pinned.evaluator.mode).toBe("independent")
  })
  test("env overrides and clamping", () => {
    const config = resolveConfig({ maxTurns: 10, stallTurns: -4 }, { OPENCODE_GOAL_CHECKIN_MINUTES: "0", OPENCODE_GOAL_MODEL: "x/y" })
    expect(config.checkinMinutes).toBe(0)
    expect(config.maxTurns).toBe(10)
    expect(config.stallTurns).toBe(0)
    expect(config.evaluator.model).toEqual({ providerID: "x", id: "y" })
  })
  test("defaults: maxTurns 0, stallTurns 0, compactOnLoopIteration true", () => {
    const config = resolveConfig({})
    expect(config.maxTurns).toBe(0)
    expect(config.stallTurns).toBe(0)
    expect(config.compactOnLoopIteration).toBe(true)
    expect(resolveConfig({ compactOnLoopIteration: false }).compactOnLoopIteration).toBe(false)
    expect(resolveConfig({}, { OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION: "0" }).compactOnLoopIteration).toBe(false)
  })
  test("commit options", () => {
    expect(resolveConfig({}).commit).toEqual({ enabled: true, branch: "dev", coordinator: "auto" })
    expect(resolveConfig({ requireCommit: false }).commit.enabled).toBe(false)
    expect(resolveConfig({ commitBranch: "main" }).commit.branch).toBe("main")
    expect(resolveConfig({}, { OPENCODE_GOAL_COMMIT_BRANCH: "release" }).commit.branch).toBe("release")
    expect(resolveConfig({}, { OPENCODE_GOAL_REQUIRE_COMMIT: "0" }).commit.enabled).toBe(false)
    expect(resolveConfig({}, { OPENCODE_GOAL_REQUIRE_COMMIT: "yes" }).commit.enabled).toBe(true)
    expect(resolveConfig({ coordinator: false }).commit.coordinator).toBe(false)
    expect(resolveConfig({ coordinator: true }).commit.coordinator).toBe(true)
    expect(resolveConfig({}, { OPENCODE_GOAL_COORDINATOR: "off" }).commit.coordinator).toBe(false)
    expect(resolveConfig({}, { OPENCODE_GOAL_COORDINATOR: "on" }).commit.coordinator).toBe(true)
  })
  test("a blank branch name falls back to the default", () => {
    expect(resolveConfig({ commitBranch: "   " }).commit.branch).toBe("dev")
    expect(resolveConfig({ commitBranch: "two words" }).commit.branch).toBe("dev")
  })
})

describe("format", () => {
  test("outcomeStory renders turns, elapsed and optional loop iterations", () => {
    expect(outcomeStory({ turns: 1, elapsedMs: 65_000 })).toBe("1 turn · 1m 05s")
    expect(outcomeStory({ turns: 12, elapsedMs: 3_725_000 })).toBe("12 turns · 1h 02m")
    expect(outcomeStory({ turns: 0, elapsedMs: 5_000 })).toBe("0 turns · 5s")
    expect(outcomeStory({ turns: 34, elapsedMs: 90_000, iterations: 4 })).toBe("34 turns · 1m 30s · 4 iterations")
    expect(outcomeStory({ turns: 3, elapsedMs: 1_000, iterations: 1 })).toBe("3 turns · 1s · 1 iteration")
    expect(outcomeStory({ turns: 3, elapsedMs: 1_000, iterations: 0 })).toBe("3 turns · 1s")
  })

  test("durations and tokens", () => {
    expect(formatDuration(5_000)).toBe("5s")
    expect(formatDuration(65_000)).toBe("1m 05s")
    expect(formatDuration(3_725_000)).toBe("1h 02m")
    expect(formatDurationCoarse(30_000)).toBe("<1m")
    expect(formatDurationCoarse(125 * 60_000)).toBe("2h05m")
    expect(formatTokens(950)).toBe("950")
    expect(formatTokens(12_345)).toBe("12k")
    expect(formatTokens(2_500_000)).toBe("2.50M")
    expect(formatTokens(999_499)).toBe("999k")
    expect(formatTokens(999_500)).toBe("1.00M")
    expect(formatTokens(999_999)).toBe("1.00M")
  })
  test("usage diff never goes negative", () => {
    expect(diffUsage(EMPTY_USAGE, { ...EMPTY_USAGE, cost: 5 }).cost).toBe(0)
  })
})

describe("truncate", () => {
  test("an ASCII string at exactly the cap is returned unchanged", () => {
    expect(truncate("a".repeat(42), 42)).toBe("a".repeat(42))
  })

  test("the cap is terminal cells, not code units — CJK text truncates at 2 cells per glyph", () => {
    const out = truncate("床前明月光疑是地上霜举头望明月低头思故乡", 12)
    // 5 CJK glyphs (10 cells) + … = 11 cells; a 6th glyph would overflow the 11-cell budget
    expect(stringWidth(out)).toBe(11)
    expect(out).toBe("床前明月光…")
  })

  test("the boundary never splits an astral emoji — no lone surrogate ever leaks", () => {
    const out = truncate("ship the 🚀 release notes now please", 13)
    // budget 12: "ship the 🚀" is exactly 11 cells, the dangling space is rstripped, + … = 12
    expect(stringWidth(out)).toBe(12)
    expect(out).toBe("ship the 🚀…")
    // a lone surrogate throws URIError here — the cheapest exact check
    expect(() => encodeURIComponent(out)).not.toThrow()
  })

  test("a ZWJ family emoji is one grapheme costing 2 cells", () => {
    const out = truncate("ab👨‍👩‍👧‍👦cd", 5)
    expect(stringWidth(out)).toBeLessThanOrEqual(5)
    expect(out).toBe("ab👨‍👩‍👧‍👦…")
  })

  test("a combining mark stays attached to its base — é never decomposes at the boundary", () => {
    const out = truncate("abe\u0301fghij", 4)
    expect(out).toBe("abe\u0301…")
    expect(stringWidth(out)).toBe(4)
  })

  test("max of 1 yields just the ellipsis; max of 0 yields empty", () => {
    expect(truncate("hello", 1)).toBe("…")
    expect(truncate("hello", 0)).toBe("")
    // an ellipsis wider than the cap itself degrades to whole graphemes of the ellipsis — never past max
    expect(truncate("hello", 2, "...")).toBe("..")
    expect(truncate("hello", 1, "...")).toBe(".")
    expect(stringWidth(truncate("hello", 2, "..."))).toBeLessThanOrEqual(2)
  })

  test("whitespace collapses before measuring", () => {
    expect(truncate("a   b\n\tc", 10)).toBe("a b c")
  })
})

describe("elideAtWordBoundary", () => {
  test("input at or under the budget is returned unchanged (identity, marker not added)", () => {
    const text = "v11: re-read the tree; fresh check green."
    expect(elideAtWordBoundary(text, text.length)).toBe(text)
    expect(elideAtWordBoundary(text, text.length + 10)).toBe(text)
    expect(elideAtWordBoundary("", 100)).toBe("")
  })

  test("an over-budget summary lands on a word boundary with the elision marker, never mid-word", () => {
    // The v12 regression shape: the summarizer's raw slice at 1600 chars ended mid-word at "bu…".
    const sentence = "the planner reasons over exactly this summary verbatim "
    const text = sentence.repeat(40) // 2240 chars, way over 1600
    const out = elideAtWordBoundary(text, 1600)
    expect(out.endsWith("…")).toBe(true)
    expect(out.length).toBeLessThanOrEqual(1600)
    // The last kept token is whole — the marker never glues onto a half-word.
    const kept = out.slice(0, -1)
    const lastToken = kept.split(" ").pop()!
    expect(text.startsWith(kept)).toBe(true)
    expect(sentence.includes(`${lastToken} `) || sentence.endsWith(lastToken)).toBe(true)
    // Nothing was added except the single marker unit at the end.
    expect(kept).toBe(text.slice(0, kept.length))
  })

  test("the boundary never splits a UTF-16 surrogate pair — no lone surrogate leaks", () => {
    // Emoji astral plane: "🚀" is two code units. Place it so it straddles the budget.
    const prefix = "x".repeat(1597)
    const text = `${prefix}🚀deploy the rocket` // 1597 + 2 + 17 = 1616 chars, over 1600
    const out = elideAtWordBoundary(text, 1600)
    expect(out.endsWith("…")).toBe(true)
    expect(out.length).toBeLessThanOrEqual(1600)
    expect(() => encodeURIComponent(out)).not.toThrow()
    expect(out.includes("�")).toBe(false)
  })

  test("a budget window with no whitespace cuts at the budget, backing off a high surrogate", () => {
    const text = `${"a".repeat(2005)}` // single 2005-char token
    const out = elideAtWordBoundary(text, 100)
    expect(out.endsWith("…")).toBe(true)
    expect(out).toBe(`${"a".repeat(99)}…`)
    const astral = `${"a".repeat(1599)}🚀xyz`
    const atAstral = elideAtWordBoundary(astral, 1601) // budget 1600 lands on the 🚀 high surrogate at 1599
    expect(atAstral.endsWith("…")).toBe(true)
    expect(() => encodeURIComponent(atAstral)).not.toThrow()
    expect(atAstral).toBe(`${"a".repeat(1599)}…`)
  })

  test("trailing whitespace before the marker is stripped; marker is the only added unit", () => {
    const text = `word one   ${"two ".repeat(600)}` // cut window falls inside a whitespace run
    const out = elideAtWordBoundary(text, 100)
    expect(out.endsWith("…")).toBe(true)
    expect(out.includes(" …")).toBe(false) // no dangling space before the marker
  })

  test("a zero or negative budget returns empty, never a bare marker", () => {
    expect(elideAtWordBoundary("hello world", 0)).toBe("")
    expect(elideAtWordBoundary("hello world", -5)).toBe("")
    expect(elideAtWordBoundary("hello world", 1)).toBe("…")
  })
})

describe("formatStatus", () => {
  const base = (): GoalRecord => ({
    version: 1,
    id: "goal_test",
    sessionID: "ses_test",
    directory: "/tmp/goal-test",
    condition: "all tests pass",
    status: "active",
    setAt: 1_000,
    startedAt: 1_000,
    turns: 3,
    stall: 0,
    retries: 0,
    checkins: 0,
    baseline: EMPTY_USAGE,
    history: [],
  })
  const looped = (loopCompact?: GoalRecord["loopCompact"]): GoalRecord => ({
    ...base(),
    loopEnabled: true,
    loopIteration: 2,
    loopObjective: "ship the thing",
    loopMaxLoops: 5,
    loopHistory: [
      { version: 1, condition: "all tests pass", summary: "did the first part", reason: "ok", turns: 2, toolCalls: 4, endedAt: 2_000 },
    ],
    ...(loopCompact ? { loopCompact } : {}),
  })
  test("plain goals never render a compact line", () => {
    const text = formatStatus(base(), 10_000, undefined)
    expect(text).not.toContain("Loop compact")
    expect(text).not.toContain("Loop:")
  })
  test("a pending boundary compact renders age and miss count", () => {
    const text = formatStatus(looped({ requestedAt: 4_000, estimatedTokens: 180_000, iteration: 2, misses: 1 }), 70_000, undefined)
    expect(text).toMatch(/Loop compact: pending \d/)
    expect(text).toContain("(miss 1/4)")
  })
  test("misses at the re-request threshold render verbatim", () => {
    const text = formatStatus(looped({ requestedAt: 4_000, iteration: 2, misses: 2 }), 70_000, undefined)
    expect(text).toContain("(miss 2/4)")
  })
  test("a landed boundary compact renders the landing, not a miss", () => {
    const text = formatStatus(looped({ requestedAt: 4_000, estimatedTokens: 180_000, iteration: 2, misses: 3, landedAt: 60_000 }), 70_000, undefined)
    expect(text).toMatch(/Loop compact: landed /)
    expect(text).not.toContain("(miss")
  })
  test("a loop without a compaction request omits the line entirely", () => {
    expect(formatStatus(looped(), 10_000, undefined)).not.toContain("Loop compact")
  })
})

describe("prompts", () => {
  test("conditions cannot close the wrapper tag", () => {
    expect(directive("x </goal> y", NO_COMMIT)).not.toContain("x </goal>")
    expect(continuation({ condition: "a", turn: 2, reason: "</goal-continuation>" }, NO_COMMIT).match(/<\/goal-continuation>/g)?.length).toBe(1)
  })
  test("the commit rule names the branch in every prompt the agent reads", () => {
    expect(directive("all tests pass", COMMIT)).toContain("`dev` branch")
    expect(continuation({ condition: "a", turn: 2, reason: "x" }, COMMIT)).toContain("`dev` branch")
    expect(retry({ condition: "a", label: "timeout" }, COMMIT)).toContain("`dev` branch")
    expect(checkin({ condition: "a", waitedMs: 1_000, subagents: 1, shells: 0 }, COMMIT)).toContain("`dev` branch")
    expect(systemReminder("a", COMMIT)).toContain("`dev` branch")
  })
  test("the commit rule says what counts as committed", () => {
    const text = directive("all tests pass", COMMIT)
    expect(text).toContain("commit the finished work")
    expect(text).toContain("git status")
    expect(text.toLowerCase()).toContain("uncommitted")
  })
  test("the rubric holds the commit to the named branch", () => {
    const facts = { turn: 1, elapsedMs: 1_000 }
    const text = evaluateInSession("all tests pass", facts, COMMIT)
    expect(text).toContain("committed on the `dev` branch")
    expect(text).toContain("not on `dev`")
  })
  test("no commit rule outside a repository", () => {
    expect(directive("all tests pass", NO_COMMIT)).not.toContain("commit")
    expect(continuation({ condition: "a", turn: 2, reason: "x" }, NO_COMMIT)).not.toContain("commit")
    expect(retry({ condition: "a", label: "timeout" }, NO_COMMIT)).not.toContain("commit")
    expect(checkin({ condition: "a", waitedMs: 1_000, subagents: 1, shells: 0 }, NO_COMMIT)).not.toContain("commit")
    expect(systemReminder("a", NO_COMMIT)).not.toContain("commit")
  })
  test("the evaluator rubric asks for the commit", () => {
    const facts = { turn: 1, elapsedMs: 1_000 }
    const session = evaluateInSession("all tests pass", facts, COMMIT)
    expect(session).toContain("Commit rule")
    expect(session).toContain("`dev` branch")
    expect(session).toContain("not_met")
    const independent = evaluateIndependently("all tests pass", facts, "transcript", COMMIT)
    expect(independent).toContain("Commit rule")
    expect(independent).toContain("`dev` branch")
  })
  test("coordinator mode injects the wt/<slug> flow everywhere and the rubric accepts submit evidence", () => {
    const coord: CommitPolicy = { required: true, branch: "dev", mode: "coordinator", reason: "test", coordinatorBin: "packages/coordinator/bin/coordinator", worktreeDir: "worktrees" }
    const text = directive("add feature", coord)
    expect(text).toContain("Coordinator repo. Before editing")
    expect(text).toContain("wt/<slug>")
    expect(text).toContain("submit")
    expect(text).not.toContain("serial lock")
    expect(text).not.toContain("land.ts")
    expect(text).not.toContain("heartbeat")
    expect(text).not.toContain("guard-")
    expect(continuation({ condition: "a", turn: 2, reason: "x" }, coord)).toContain("wt/<slug>")
    expect(retry({ condition: "a", label: "timeout" }, coord)).toContain("wt/<slug>")
    expect(checkin({ condition: "a", waitedMs: 1_000, subagents: 1, shells: 0 }, coord)).toContain("wt/<slug>")
    expect(systemReminder("a", coord)).toContain("wt/<slug>")
    const facts = { turn: 1, elapsedMs: 1_000 }
    expect(evaluateInSession("add feature", facts, coord)).toContain("wt/<slug>")
    expect(evaluateIndependently("add feature", facts, "transcript", coord)).toContain("submit")
    expect(evaluateInSession("add feature", facts, coord)).toContain("merge-next")
  })
  test("a coordinator policy without an absolute bin never emits a repo-relative path", () => {
    const noBin: CommitPolicy = { required: true, branch: "dev", mode: "coordinator", reason: "test", worktreeDir: "worktrees" }
    const text = directive("add feature", noBin)
    expect(text).toContain("no coordinator binary")
    expect(text).not.toContain("packages/coordinator/bin/coordinator")
    expect(text).toContain("wt/<slug>")
  })
  test("the harness facts state the rule as measured outside the conversation", () => {
    const text = evaluateInSession("all tests pass", { turn: 1, elapsedMs: 1_000 }, COMMIT)
    expect(text).toContain("Harness facts")
    expect(text).toContain("runs inside a git repository")
  })
  test("the evaluator rubric requires clause/evidence matrix, adversarial checks, and honest next actions (LXXXVII)", () => {
    const facts = { turn: 1, elapsedMs: 1_000 }
    const session = evaluateInSession("work the merged plan", facts, COMMIT)
    for (const token of [
      "clause, required evidence, observed evidence, status: satisfied|missing|contradicted|unscoped, source/turn",
      "What would falsify met?",
      "What important risk is untested?",
      "Green but unscoped is insufficient for broad goals",
      "repeated failure signatures",
      "strategy escalation",
      "duplicate-without-forward-pointer",
      "next: none",
    ]) {
      expect(session).toContain(token)
    }
    const independent = evaluateIndependently("work the merged plan", facts, "transcript", COMMIT)
    for (const token of [
      "evidence matrix per clause",
      "What would falsify met?",
      "repeated failure signatures",
      "duplicate-without-forward-pointer",
      "next: none",
    ]) {
      expect(independent).toContain(token)
    }
  })
  test("the evaluator rubric bounds deliberation without dropping the evidence contract (CXXV)", () => {
    const facts = { turn: 1, elapsedMs: 1_000 }
    for (const text of [
      evaluateInSession("make the opencode tui nicer and nicer", facts, COMMIT),
      evaluateIndependently("make the opencode tui nicer and nicer", facts, "transcript", COMMIT),
    ]) {
      expect(text).toContain("Decide from the evidence actually shown, not from exhaustive hypotheticals")
      expect(text).toContain("name the single most critical gap when not met")
      expect(text).toContain("keep the reason short (a few lines)")
      expect(text).toContain("do not enumerate every edge case")
      // The exhaustive contract is preserved, not traded away for brevity.
      expect(text).toContain("evidence matrix per clause")
      expect(text).toContain("What would falsify met?")
      expect(text).toContain("Broad-condition verifier corroboration")
    }
  })
  test("the evaluator rubric requires verifier-command corroboration for broad conditions (XCIV)", () => {
    const facts = { turn: 1, elapsedMs: 1_000 }
    for (const text of [
      evaluateInSession("improve the whole codebase and verify end to end", facts, COMMIT),
      evaluateIndependently("improve the whole codebase and verify end to end", facts, "transcript", COMMIT),
    ]) {
      expect(text).toContain("Broad-condition verifier corroboration")
      expect(text).toContain("transcript-only green does not corroborate a broad claim")
      expect(text).toContain("missing verifier-command corroboration")
    }
  })
  test("no commit rule in the rubric when it does not apply", () => {
    const facts = { turn: 1, elapsedMs: 1_000 }
    expect(evaluateInSession("all tests pass", facts, NO_COMMIT)).not.toContain("Commit rule")
    expect(evaluateIndependently("all tests pass", facts, "transcript", NO_COMMIT)).not.toContain("Commit rule")
  })
})

describe("renderTranscript", () => {
  const messages = [
    { type: "user", text: "make tests pass" },
    {
      type: "assistant",
      content: [
        { type: "text", text: "Running tests." },
        { type: "tool", name: "shell", state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: `${"noise\n".repeat(2000)}12 pass 0 fail` }] } },
      ],
    },
    { type: "synthetic", text: "<goal-continuation>keep going</goal-continuation>" },
    { type: "assistant", content: [{ type: "tool", name: "edit", state: { status: "error", input: {}, error: { message: "file locked" } } }] },
  ]
  test("keeps tool output tails and errors", () => {
    const text = renderTranscript(messages, { maxChars: 8_000 })
    expect(text).toContain("12 pass 0 fail")
    expect(text).toContain("[tool edit FAILED]")
    expect(text).toContain("file locked")
    expect(text.indexOf("USER")).toBeLessThan(text.indexOf("NOTE"))
  })
  test("respects the budget, newest first", () => {
    const text = renderTranscript(messages, { maxChars: 300 })
    expect(text.length).toBeLessThan(600)
    expect(text).toContain("file locked")
    expect(text).toContain("earlier messages omitted")
  })
  test("truncation never splits an astral surrogate pair at any cut boundary", () => {
    const rocket = "\uD83D\uDE80" // 🚀 — two UTF-16 code units
    // Fails on any lone surrogate: a high not followed by a low, or a low not preceded by one.
    const wellFormed = (t: string) => {
      for (let i = 0; i < t.length; i++) {
        const c = t.charCodeAt(i)!
        if (c >= 0xd800 && c <= 0xdbff) {
          const lo = t.charCodeAt(i + 1) ?? 0
          expect(lo >= 0xdc00 && lo <= 0xdfff).toBe(true)
          i++
        } else {
          expect(c < 0xd800 || c > 0xdfff).toBe(true)
        }
      }
      expect(() => encodeURIComponent(t)).not.toThrow() // URIError on any lone surrogate
    }
    const toolOutput = `${"a".repeat(100)}${rocket}${"b".repeat(100)}` // pair at indices 100/101
    const astralMessages = [
      { type: "user", text: `ship ${rocket} now` }, // head() cut can land between its high/low
      {
        type: "assistant",
        content: [{ type: "tool", name: "shell", state: { status: "completed", input: {}, content: [{ type: "text", text: toolOutput }] } }],
      },
    ]
    // Sweep the per-tool cap: front=101 (head cut right after the high surrogate) lands at maxToolChars=404;
    // tail start=101 (lone low surrogate) lands near maxToolChars=134. The user-text head cut lands near cap=6.
    for (let cap = 1; cap <= 500; cap++) {
      wellFormed(renderTranscript(astralMessages, { maxChars: 100_000, maxToolChars: cap }))
    }
    // Sweep the whole-transcript budget: a single oversized block is cut via headTail(block, maxChars),
    // whose tail start lands on the embedded pair near maxChars=134.
    for (let budget = 1; budget <= 320; budget++) {
      wellFormed(renderTranscript(astralMessages, { maxChars: budget }))
    }
    // Not vacuous: small caps really do cut, and the pair survives intact when nothing is cut.
    const cut = renderTranscript(astralMessages, { maxChars: 100_000, maxToolChars: 20 })
    expect(cut).toContain("chars cut]")
    const whole = renderTranscript(astralMessages, { maxChars: 100_000 })
    expect(whole).toContain(rocket)
  })
})
describe("compactGoalInstructions: only the newest live goal directive survives", () => {
  const instr = (text: string) => ({ role: "user", content: [{ type: "text", text }] })

  test("drops older goal/loop/continuation messages but keeps real messages and the newest directive", () => {
    const v1 = instr("<goal>fix the parser</goal>")
    const evidence = instr("12 pass 0 fail")
    const v2 = instr('<goal-loop iteration="2" max="5">old iteration</goal-loop>')
    const stale = instr('<goal-continuation turn="3">Evaluator: an old stale reason</goal-continuation>')
    const newest = instr('<goal-loop iteration="4" max="5">ship it</goal-loop>')
    expect(compactGoalInstructions([v1, evidence, v2, stale, newest])).toEqual([evidence, newest])
  })

  test("leaves a goal-free context unchanged", () => {
    const message = instr("hello")
    expect(compactGoalInstructions([message])).toEqual([message])
  })
})

describe("nativeEvaluationRequest: original goal + parent summary only", () => {
  test("a plain /goal carries just the condition and the parent summary", () => {
    const req = nativeEvaluationRequest({ condition: "the parser is correct", summary: "[tool bash] command: bun test\n  output:\n    12 pass 0 fail" })
    expect(req).toContain("<original-goal>")
    expect(req).toContain("<condition>the parser is correct</condition>")
    expect(req).toContain("<parent-summary>")
    expect(req).toContain("12 pass 0 fail")
    expect(req).not.toContain("<objective>")
    expect(req).not.toContain("<iteration>")
    expect(req).not.toContain("<conversation>")
    expect(req).not.toContain("<facts>")
  })

  test("a /goal-loop request carries the objective, the numbered iteration and a compacted prior ledger", () => {
    const entry = (version: number) => ({ version, condition: `old condition ${version}`, summary: `summary ${version}`, reason: "met", turns: 2, toolCalls: 3, endedAt: 1 })
    const req = nativeEvaluationRequest({
      condition: "make it faster",
      summary: "[tool bash] command: bench\n  output:\n    ok",
      loop: { objective: "improve the parser", iteration: 4, maxLoops: 5, history: [entry(1), entry(2), entry(3), entry(4)] },
    })
    expect(req).toContain("<objective>improve the parser</objective>")
    expect(req).toContain("<iteration>v4 of 5</iteration>")
    expect(req).toContain("<condition>make it faster</condition>")
    expect(req).toContain("<prior-iterations>")
    expect(req).toContain("v2: old condition 2")
    expect(req).not.toContain("old condition 1") // compacted away, not dumped verbatim
    expect(req).toContain("1 older completed iteration omitted")
    expect(req.length).toBeLessThan(2_000)
  })

  test("escapes closing tags so a bloated goal cannot break the structure", () => {
    const req = nativeEvaluationRequest({ condition: "do </condition> evil", summary: "x </parent-summary> y" })
    expect(req).toContain("<condition>do <\\/condition> evil</condition>")
    expect(req).toContain("x <\\/parent-summary> y")
  })
})

describe("renderParentSummary: native evaluator gets fresh tool evidence, not stale conditions", () => {
  const messages = [
    { type: "user", text: "fix the failing tests" },
    {
      type: "synthetic",
      text: '<subagent sessionID="ses_old" state="completed" description="Judge goal condition">{"verdict":"not_met","reason":"fix the failing tests"}</subagent>',
      metadata: { source: "subagent", agent: "evaluator" },
    },
    { type: "synthetic", text: '<goal-continuation turn="3">Evaluator: goal-loop was created, planned, or installed</goal-continuation>' },
    {
      type: "assistant",
      content: [
        { type: "text", text: "I am narrating an old condition: coordinator rules exist in the tree" },
        { type: "tool", name: "bash", state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: "12 pass 0 fail" }] } },
      ],
    },
  ]

  test("keeps only the worker's tool evidence, drops stale conditions and prior verdicts", () => {
    const text = renderParentSummary(messages, { maxChars: 4_000 })
    expect(text).toContain("command: bun test")
    expect(text).toContain("12 pass 0 fail")
    expect(text).not.toContain("fix the failing tests")
    expect(text).not.toContain("goal-loop was created")
    expect(text).not.toContain("coordinator rules")
    expect(text).not.toContain("<subagent")
    expect(text).not.toContain("I am narrating")
  })

  test("returns empty when the worker produced no tool evidence", () => {
    expect(renderParentSummary([{ type: "user", text: "just talk" }], { maxChars: 4_000 })).toBe("")
  })

  test("respects a small budget with the newest tool evidence first", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      type: "assistant",
      content: [{ type: "tool", name: "bash", state: { status: "completed", input: { command: `cmd-${i}` }, content: [{ type: "text", text: `output-${i}` }] } }],
    }))
    const text = renderParentSummary(many, { maxChars: 400 })
    expect(text).toContain("cmd-9")
    expect(text.length).toBeLessThan(1_000)
  })

  test("drops the evaluator's own delegation task call — the judge must not score its own armed prompt", () => {
    const messages = [
      {
        type: "assistant",
        content: [
          { type: "tool", name: "task", state: { status: "running", input: { agent: "evaluator", description: "Judge goal condition", prompt: "Judge the goal condition and return the verdict JSON." } } },
        ],
      },
    ]
    expect(renderParentSummary(messages, { maxChars: 4_000 })).toBe("")
  })

  test("keeps a pure-text reply as evidence for a communication goal", () => {
    const messages = [
      { type: "assistant", content: [{ type: "reasoning", text: "the goal says reply hi" }, { type: "text", text: "hi" }] },
    ]
    expect(renderParentSummary(messages, { maxChars: 4_000 })).toContain("hi")
  })

  test("still drops narration that is interleaved with real tool work", () => {
    const messages = [
      {
        type: "assistant",
        content: [
          { type: "text", text: "I am narrating an old condition: dogfood merge to main" },
          { type: "tool", name: "bash", state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: "12 pass 0 fail" }] } },
        ],
      },
    ]
    const text = renderParentSummary(messages, { maxChars: 4_000 })
    expect(text).toContain("12 pass 0 fail")
    expect(text).not.toContain("dogfood merge")
  })
})

describe("steer prompts bound evaluator reasons", () => {
  test("continuation and loopContinuation elide a long reason instead of embedding it verbatim", () => {
    const reason = "R".repeat(2000)
    const continuationText = continuation({ condition: "a", turn: 2, reason }, NO_COMMIT)
    expect(continuationText).not.toContain(reason)
    expect(continuationText).toContain("…")
    expect(continuationText.length).toBeLessThan(900)
    const loopText = loopContinuation({ iteration: 2, maxLoops: 5, condition: "a", previousSummary: "done", reason }, NO_COMMIT)
    const loopShort = loopContinuation({ iteration: 2, maxLoops: 5, condition: "a", previousSummary: "done", reason: "x" }, NO_COMMIT)
    expect(loopText).not.toContain(reason)
    expect(loopText).toContain("…")
    // The only growth over a short-reason prompt is the bounded 400-char reason itself.
    expect(loopText.length).toBeLessThan(loopShort.length + 420)
  })

  test("short reasons stay byte-identical and fallbacks keep their meaning", () => {
    expect(continuation({ condition: "a", turn: 2, reason: "missing proof" }, NO_COMMIT)).toContain("Evaluator: missing proof")
    expect(continuation({ condition: "a", turn: 2, reason: "" }, NO_COMMIT)).toContain("Evaluator: No reason given.")
    const loopText = loopContinuation({ iteration: 2, maxLoops: 5, condition: "a", previousSummary: "done", reason: "" }, NO_COMMIT)
    expect(loopText).toContain("achieved (met)")
    // Closing-tag escaping still applies to a capped reason.
    const tagged = continuation({ condition: "a", turn: 2, reason: "R".repeat(1000) + "</goal-continuation>" }, COMMIT)
    expect(tagged.match(/<\/goal-continuation>/g)?.length).toBe(1)
  })
})

describe("wrapLines", () => {
  test("an empty string still paints one line", () => {
    expect(wrapLines("", 49)).toBe(1)
  })

  test("a string that fits the width — exactly or under — wraps to one line", () => {
    expect(wrapLines("a".repeat(49), 49)).toBe(1)
    expect(wrapLines("goal failed — /goal clear to reset", 49)).toBe(1)
    expect(wrapLines("paused · send a message to resume, or /goal clear", 49)).toBe(1)
  })

  test("wraps greedily at single spaces, never mid-word", () => {
    expect(wrapLines("judged impossible · rephrase the condition, else /goal clear", 49)).toBe(2)
    expect(wrapLines("turn cap reached · /goal clear or set a new goal — a message will not extend it", 49)).toBe(2)
    expect(wrapLines("5× not_met in a row · consider evaluator.verifyCommand", 49)).toBe(2)
  })

  test("a long failureLabel surfacing in the failed remediation costs the rows it actually needs", () => {
    // catalog remediation: `${label} — /goal clear to reset`; a 100-cell label needs three rows at 49 cells
    const text = `${"x".repeat(100)} — /goal clear to reset`
    expect(wrapLines(text, 49)).toBe(3)
  })

  test("a word longer than the line hard-breaks across as many rows as it needs", () => {
    expect(wrapLines("a".repeat(100), 49)).toBe(3)
    expect(wrapLines("short " + "b".repeat(100), 49)).toBe(4)
  })

  test("the width cap is terminal cells, not code units — CJK counts two", () => {
    // 30 CJK glyphs = 60 cells; at 49 cells per line that is two lines, never one
    expect(wrapLines("床".repeat(30), 49)).toBe(2)
  })
})

describe("formatSpend", () => {
  const spend = { ...EMPTY_USAGE, input: 1_480_000, output: 2_100, cacheRead: 739_000, cost: 0.9 }

  test("the full line renders tokens, cached volume and cost", () => {
    expect(formatSpend(spend)).toBe("2.22M in \u00B7 2.1k out \u00B7 739k cached \u00B7 $0.90")
  })

  test("an absent cost renders tokens only — no fabricated $ figure", () => {
    const noCost = { ...EMPTY_USAGE, input: 120_000, output: 8_400 }
    expect(formatSpend(noCost)).toBe("120k in \u00B7 8.4k out")
  })

  test("a tight budget drops cached first, then out — the cost is the anchor", () => {
    // 36 cells is the clamp-floor card's spend budget (width 52 - left border 1 - padding 4 - LABEL 10 - gap 1)
    expect(formatSpend(spend, 36)).toBe("2.22M in \u00B7 2.1k out \u00B7 $0.90")
    // 28-cell budget forces out as well
    expect(formatSpend(spend, 28)).toBe("2.22M in \u00B7 2.1k out \u00B7 $0.90")
    expect(formatSpend(spend, 26)).toBe("2.22M in \u00B7 $0.90")
    // 16 cells keeps tokens + anchor exactly (16 cells, fits)
    expect(formatSpend(spend, 16)).toBe("2.22M in \u00B7 $0.90")
    expect(formatSpend(spend, 15)).toBe("$0.90")
  })

  test("the cost is never dropped and never clipped mid-figure — even at a budget smaller than the cost", () => {
    expect(formatSpend(spend, 5)).toBe("$0.90")
    expect(formatSpend(spend, 3)).toBe("$0.90")
    expect(formatSpend(spend, 0)).toBe("$0.90")
  })

  test("with a budget the degraded output never exceeds it while a figure remains to drop", () => {
    for (const budget of [26, 30, 37, 41, 56]) {
      expect(stringWidth(formatSpend(spend, budget))).toBeLessThanOrEqual(budget)
    }
  })
})

describe("formatDuration regression: non-finite input", () => {
  test("NaN and Infinity render 0s, never NaNs", () => {
    expect(formatDuration(Number.NaN)).toBe("0s")
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0s")
    expect(formatDuration(Number.NEGATIVE_INFINITY)).toBe("0s")
  })
})

describe("renderTranscript regression: a zero per-tool budget", () => {
  const toolHeavy = [
    { type: "user", text: "run the tests" },
    {
      type: "assistant",
      content: [
        { type: "tool", name: "shell", state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: `${"noise\n".repeat(2000)}12 pass 0 fail` }] } },
      ],
    },
  ]

  test("renders the cut marker with a bounded tail, never the whole tool output", () => {
    const text = renderTranscript(toolHeavy, { maxChars: 8_000, maxToolChars: 0 })
    expect(text).toContain("chars cut]")
    expect(text).not.toContain("12 pass 0 fail")
    expect(text.length).toBeLessThan(400)
  })
})

describe("config regression: an empty env model", () => {
  test("reads as unset and falls back to the configured model, never discards it", () => {
    expect(resolveConfig({ evaluator: { model: "a/b" } }, { OPENCODE_GOAL_MODEL: "" }).evaluator.model).toEqual({ providerID: "a", id: "b" })
    expect(resolveConfig({ evaluator: { model: "a/b" } }, { OPENCODE_GOAL_MODEL: "   " }).evaluator.model).toEqual({ providerID: "a", id: "b" })
    expect(resolveConfig({ model: "a/b" }, { OPENCODE_GOAL_MODEL: "" }).evaluator.model).toEqual({ providerID: "a", id: "b" })
    // An empty option model falls back past it to a valid top-level one too.
    expect(resolveConfig({ evaluator: { model: "" }, model: "a/b" }).evaluator.model).toEqual({ providerID: "a", id: "b" })
    // A non-empty invalid env value still yields no model (unchanged semantics).
    expect(resolveConfig({ evaluator: { model: "a/b" } }, { OPENCODE_GOAL_MODEL: "nope" }).evaluator.model).toBeUndefined()
  })
})

describe("native evaluator delegation", () => {
  test("the kickoff directive tells the worker to delegate the verdict via the task tool", () => {
    expect(directive("all tests pass", COMMIT)).toContain(DELEGATE_VERDICT)
    expect(continuation({ condition: "all tests pass", turn: 2, reason: "not yet" }, COMMIT)).toContain("Delegate the verdict to the evaluator subagent")
  })

  test("only subagent reports from the evaluator agent count as verdicts", () => {
    expect(isEvaluatorReport({ source: "subagent", agent: "Evaluator", childID: "ses_1" })).toBe(true)
    expect(isEvaluatorReport({ source: "subagent", agent: "evaluator" })).toBe(true)
    expect(isEvaluatorReport({ source: "subagent", agent: "review" })).toBe(false)
    expect(isEvaluatorReport({ source: "shell", agent: "evaluator" })).toBe(false)
    expect(isEvaluatorReport(undefined)).toBe(false)
  })

  test("a native <subagent> report yields its body and state", () => {
    const text = '<subagent sessionID="ses_child" state="completed" description="evaluator">\n{"verdict":"met","reason":"fresh"}\n</subagent>'
    expect(parseSubagentReport(text)).toEqual({ body: '{"verdict":"met","reason":"fresh"}', state: "completed", childID: "ses_child" })
    expect(parseSubagentReport("not a report")).toBeUndefined()
  })

  const report = (id: string, verdict: string, childID = `ses_${id}`, state = "completed") => ({
    id,
    type: "synthetic",
    text: `<subagent sessionID="${childID}" state="${state}" description="evaluator">\n{"verdict":"${verdict}","reason":"r"}\n</subagent>`,
    metadata: { source: "subagent", childID, agent: "Evaluator", state },
  })
  const marker = (turn: number) => ({ id: `kickoff_${turn}`, type: "synthetic", metadata: { source: "goal", goal: "g1", turn } })
  const pick = (messages: unknown[], turn = 1, consumed = new Set<string>(), pluginJudgeIDs = new Set<string>(), seenTurns = new Map<string, number>()) =>
    findNativeReport(messages, consumed, pluginJudgeIDs, seenTurns, turn)

  test("the newest report is picked once; a consumed report is never replayed", () => {
    const messages = [report("a", "not_met"), report("b", "met")]
    const consumed = new Set<string>()
    expect(pick(messages, 1, consumed)?.body).toContain('"met"')
    consumed.add("b")
    expect(pick(messages, 1, consumed)?.body).toContain('"not_met"')
  })

  test("plugin fallback-judge reports and still-running reports are never read as verdicts", () => {
    const native = report("c", "met")
    const fallback = report("judge", "not_met", "plugin_judge_1")
    const running = report("d", "met", "ses_d", "running")
    expect(pick([fallback, running, native], 1, new Set(), new Set(["plugin_judge_1"]))).toEqual({
      key: "c",
      body: '{"verdict":"met","reason":"r"}',
      state: "completed",
    })
    expect(pick([fallback], 1, new Set(), new Set(["plugin_judge_1"]))).toBeUndefined()
  })

  test("a report delivered before this turn's kickoff is stale and never replayed", () => {
    const stale = report("old", "met")
    const fresh = report("new", "not_met")
    const messages = [stale, marker(2), fresh]
    // turn 2: only the report after the marker is eligible, even though the stale met is unconsumed.
    expect(pick(messages, 2)?.key).toBe("new")
    // With no marker in context (e.g. the first turn), first-observed-turn is the fallback guard.
    const seen = new Map([["old", 1]])
    expect(pick([stale], 2, new Set(), new Set(), seen)).toBeUndefined()
    expect(pick([stale], 2, new Set(), new Set(), new Map())?.key).toBe("old")
  })

  test("a still-running report is not pinned to a turn until it completes", () => {
    const running = report("late", "met", "ses_late", "running")
    const seen = new Map<string, number>()
    // First look while the child is still running: eligible, but nothing returned and nothing pinned.
    expect(pick([running], 2, new Set(), new Set(), seen)).toBeUndefined()
    expect(seen.size).toBe(0)
    // The same report, now completed, can be consumed for this turn (and only now is it pinned).
    const done = report("late", "met", "ses_late", "completed")
    expect(pick([done], 2, new Set(), new Set(), seen)?.key).toBe("late")
    expect(seen.get("late")).toBe(2)
  })

  test("echoedCondition tolerates aliases and a strict-parse-failed body", () => {
    expect(echoedCondition('{"verdict":"met","condition":"Reply with DONE"}')).toBe("Reply with DONE")
    expect(echoedCondition('{"verdict":"met","echo":"Reply with DONE"}')).toBe("Reply with DONE")
    expect(echoedCondition('{"verdict":"met","reason":"bad \" quote","condition":"Reply with DONE"}')).toBe("Reply with DONE")
    expect(echoedCondition('{"verdict":"met","reason":"no echo"}')).toBeUndefined()
  })

  test("conditionEchoMatches accepts exact, punctuated and paraphrased echoes but rejects a different goal", () => {
    const expected = "Reply with the single word DONE."
    expect(conditionEchoMatches('{"condition":"Reply with the single word DONE."}', expected)).toBe(true)
    expect(conditionEchoMatches('{"condition":"reply with the single word done"}', expected)).toBe(true)
    expect(conditionEchoMatches('{"condition":"Reply with the single word DONE. Extra."}', expected)).toBe(true)
    expect(conditionEchoMatches('{"condition":"Fix the roadmap-renderer.html layout"}', expected)).toBe(false)
    expect(conditionEchoMatches('{"condition":"Verify the anti-dup marker in the plugin"}', expected)).toBe(false)
    expect(conditionEchoMatches('{"verdict":"met","reason":"stale"}', expected)).toBe(false)
  })

  test("verdictFromNativeReport rejects a verdict that echoes a stale condition", () => {
    const stale = { key: "x", state: "completed", body: '{"verdict":"met","reason":"the 4-part prompt was implemented","condition":"Verify the anti-dup marker"}' }
    expect(() => verdictFromNativeReport(stale, "Reply with the single word DONE.")).toThrow(/judged a stale condition/)
    const matching = { key: "y", state: "completed", body: '{"verdict":"met","reason":"ok","condition":"Reply with the single word DONE."}' }
    expect(verdictFromNativeReport(matching, "Reply with the single word DONE.")).toEqual({ verdict: "met", reason: "ok" })
    // No expected condition pins the legacy call sites: behavior is unchanged without one.
    expect(verdictFromNativeReport(stale)).toEqual({ verdict: "met", reason: "the 4-part prompt was implemented" })
    // A judge that omits the echo (small models follow the worker's shorter contract) is still accepted — rejecting
    // every echo-less verdict stalled the loop on not_met for every turn.
    const noEcho = { key: "z", state: "completed", body: '{"verdict":"met","reason":"the reply was DONE"}' }
    expect(verdictFromNativeReport(noEcho, "Reply with the single word DONE.")).toEqual({ verdict: "met", reason: "the reply was DONE" })
  })

  test("a failed or unreadable native report throws so the generation judge can take over", () => {
    expect(() => verdictFromNativeReport({ key: "x", body: "Free usage limit reached (429)", state: "error" })).toThrow(/evaluator subagent failed: Free usage limit reached/)
    expect(() => verdictFromNativeReport({ key: "x", body: "no verdict here", state: "completed" })).toThrow(/unreadable verdict/)
    expect(verdictFromNativeReport({ key: "x", body: '{"verdict":"met","reason":"ok"}', state: "completed" })).toEqual({ verdict: "met", reason: "ok" })
  })

  test("a tool call digest shows a readable command, not the raw input JSON", () => {
    const text = renderTranscript([
      {
        type: "assistant",
        content: [{
          type: "tool",
          name: "bash",
          state: { status: "completed", input: { command: "bun test src/core/transcript.ts" }, content: [{ type: "text", text: "12 pass 0 fail" }] },
        }],
      },
    ], { maxChars: 4_000 })
    expect(text).toContain("command: bun test src/core/transcript.ts")
    expect(text).not.toContain('{"command"')
    expect(text).toContain("output:")
    expect(text).toContain("12 pass 0 fail")
  })
})

describe("arm-time planner", () => {
  const coord: CommitPolicy = { required: true, branch: "dev", mode: "coordinator", reason: "test", coordinatorBin: "packages/coordinator/bin/coordinator", worktreeDir: "worktrees" }

  test("the request carries only the raw body and the output contract", () => {
    const raw = "simple reply back."
    const text = planGoalRequest(raw)
    expect(text).toContain(raw)
    expect(text).toContain("<raw>")
    expect(text.length).toBeLessThan(500)
  })

  test("parsePlan reads a plain object and defaults an absent scope to trivial", () => {
    expect(parsePlan('{"condition":"Give a short reply.","scope":"trivial"}')).toEqual({ condition: "Give a short reply.", scope: "trivial" })
    expect(parsePlan('{"condition":"Fix the tests.","scope":"code"}')).toEqual({ condition: "Fix the tests.", scope: "code" })
    expect(parsePlan('{"condition":"Give a short reply."}')).toEqual({ condition: "Give a short reply.", scope: "trivial" })
  })

  test("parsePlan tolerates a fence or prose and rejects garbage or an empty condition", () => {
    expect(parsePlan('intro\n```json\n{"condition":"Reply briefly.","scope":"trivial"}\n```')?.condition).toBe("Reply briefly.")
    expect(parsePlan("no json here")).toBeUndefined()
    expect(parsePlan('{"condition":"   ","scope":"code"}')).toBeUndefined()
    expect(parsePlan('{"scope":"code"}')).toBeUndefined()
  })

  test("parsePlan bounds a runaway condition", () => {
    const huge = "x".repeat(5_000)
    expect(parsePlan(JSON.stringify({ condition: huge, scope: "code" }))?.condition.length).toBe(PLANNED_CONDITION_MAX_CHARS)
  })

  test("a planned directive drops the fuzzy SPEC and coordinator essays", () => {
    const text = directive("simple reply back.", coord, undefined, true)
    expect(text).toContain("<goal>")
    expect(text).toContain("simple reply back.")
    expect(text).toContain(DELEGATE_VERDICT)
    expect(text).not.toContain("Fuzzy request")
    expect(text).not.toContain("SPEC.md")
    expect(text).not.toContain("Coordinator repo. Before editing")
    expect(text).not.toContain("wt/<slug>")
    expect(text).not.toContain("`dev` branch")
    expect(text.length).toBeLessThan(1_000)
  })

  test("an unplanned directive keeps the old heuristics", () => {
    const text = directive("simple reply back.", coord)
    expect(text).toContain("Fuzzy request")
    expect(text).toContain("Coordinator repo. Before editing")
  })
})
