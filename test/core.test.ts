import { describe, expect, test } from "bun:test"
import { isInheritModelValue, parseModelRef, resolveConfig } from "../src/core/config.ts"
import { classifyFailure, formatValue, isNotFoundError, type FailureClass } from "../src/core/errors.ts"
import { diffUsage, elideAtWordBoundary, formatCost, formatDuration, formatDurationCoarse, formatSpend, formatStatus, formatTokens, outcomeStory, stripLoneSurrogates, truncate, wrapLines } from "../src/core/format.ts"
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
  loopReanchor,
  nativeEvaluationRequest,
  retry,
  strategyEscalation,
  systemReminder,
} from "../src/core/prompts.ts"
import { currentTurnStart, renderParentSummary, renderTranscript } from "../src/core/transcript.ts"
import { isEvaluatorReport, verdictFromNativeReport, echoedCondition, echoMatches } from "../src/core/evaluator-agent.ts"
import { DELEGATE_VERDICT } from "../src/core/prompts.ts"
import { EMPTY_USAGE, type CommitPolicy, type GoalRecord } from "../src/core/types.ts"
import { isAlreadySatisfiedLanding, parseVerdict } from "../src/core/verdict.ts"

const COMMIT: CommitPolicy = { required: true, branch: "dev", reason: "test" }
/** Test-only fixture: the no-git policy is a stub for prompt assertions, not a production export. */
const NO_COMMIT: CommitPolicy = { required: false, branch: "dev", mode: "direct", reason: "not a git repository" }

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
  test("the lenient pass keeps no regex state across calls (precompiled patterns)", () => {
    // Field patterns are precompiled with the `g` flag and reused. Each call must reset lastIndex:
    // without it, an early-returning parse leaves lastIndex past the real field of the next verdict,
    // so the next call silently loses its verdict. The two strings below exercise that exact sequence.
    const first = `{"verdict":"met","reason":"line one\nline two with a long reason string here"}`
    const second = `{"verdict":"not_met","reason":"second call with a different verdict"}`
    expect(parseVerdict(first)?.verdict).toBe("met")
    expect(parseVerdict(second)).toEqual({ verdict: "not_met", reason: "second call with a different verdict" })
    expect(parseVerdict(first)?.verdict).toBe("met")
    expect(parseVerdict(second)?.verdict).toBe("not_met")
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
    // Genuine quota signals keep the dedicated pause label/window, including provider codes and asserted hits.
    expect(classifyFailure({ type: "rate_limit_error", message: "provider rejected the request" })).toEqual({ kind: "pause", label: "rate or usage limit" })
    expect(classifyFailure({ message: "HTTP 429 too many requests" }).label).toBe("rate or usage limit")
    // A provider may wrap an asserted quota hit in a 5xx; the quota signal must win over the generic
    // transient 5xx branch, matching isUsageLimitError on the evaluator path.
    for (const input of [
      { status: 500, message: "rate limit exceeded" },
      { status: 502, message: "Free usage limit reached" },
    ]) {
      expect(classifyFailure(input)).toEqual({ kind: "pause", label: "rate or usage limit" })
    }
  })
  test("non-quota errors that merely mention a limit are not labelled a quota pause", () => {
    // Regression: the old PAUSE pattern matched a bare "rate limit"/"usage limit"/"quota" phrase anywhere and
    // parked the goal for 15m with a misleading "rate or usage limit" label. These are ordinary errors.
    for (const message of [
      "KiloCode-Free usage is available on this key",
      "no rate limit is configured for this model",
      "rate limit settings are documented at example.com",
      "usage limit was not reached",
    ]) {
      const result = classifyFailure({ message })
      expect(result.label).not.toBe("rate or usage limit")
      expect(result.label).toBe(message)
    }
    // A transient error that happens to mention a limit is still retried quickly, not parked as a quota.
    expect(classifyFailure({ message: "rate limit check failed: fetch failed ECONNRESET" }).kind).toBe("transient")
  })
  test("overload and network errors retry", () => {
    expect(classifyFailure({ status: 529, message: "Overloaded" }).kind).toBe("transient")
    expect(classifyFailure({ message: "fetch failed: ECONNRESET" }).kind).toBe("transient")
  })
  test("unknown errors pause with their message", () => {
    // One canonical value-rendering format for every error message that names a value (workstream CXLVII).
    expect(formatValue("a b")).toBe('"a b"')
    expect(formatValue(1.5)).toBe("1.5")
    expect(formatValue(true)).toBe("true")
    expect(formatValue(null)).toBe("null")
    expect(formatValue(undefined)).toBe("undefined")
    expect(formatValue([1, "x"])).toBe('[1,"x"]')
    expect(formatValue({ k: "v" })).toBe('{"k":"v"}')
    expect(formatValue(12n)).toBe("12n")

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

describe("diffUsage regression: non-finite host readings", () => {
  test("NaN and Infinity readings yield a zero delta, never NaN", () => {
    const d = diffUsage(
      { ...EMPTY_USAGE, cost: Number.NaN, input: Number.POSITIVE_INFINITY, output: Number.NEGATIVE_INFINITY, reasoning: Number.NaN, cacheRead: Number.POSITIVE_INFINITY, cacheWrite: Number.NaN },
      EMPTY_USAGE,
    )
    expect(d).toEqual(EMPTY_USAGE)
  })
  test("a non-finite baseline also yields a zero delta", () => {
    const d = diffUsage({ ...EMPTY_USAGE, cost: 5 }, { ...EMPTY_USAGE, cost: Number.NaN })
    expect(d.cost).toBe(0)
  })
  test("finite deltas are byte-identical to the old clamp", () => {
    expect(diffUsage(
      { ...EMPTY_USAGE, cost: 3.5, input: 100, output: 420, reasoning: 7, cacheRead: 9, cacheWrite: 11 },
      { ...EMPTY_USAGE, cost: 1.5, input: 250, output: 20, reasoning: 2, cacheRead: 4, cacheWrite: 6 },
    )).toEqual({ cost: 2, input: 0, output: 400, reasoning: 5, cacheRead: 5, cacheWrite: 5 })
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

describe("lone-surrogate sanitization in the text helpers", () => {
  test("stripLoneSurrogates drops unpaired halves, keeps valid pairs, and is an identity on clean text", () => {
    expect(stripLoneSurrogates("plain text 漢 😀")).toBe("plain text 漢 😀") // same reference value
    expect(stripLoneSurrogates("a\ud83db\ude00c😀d")).toBe("abc😀d")
    expect(stripLoneSurrogates("\ud83d\ude00")).toBe("😀")
    expect(stripLoneSurrogates("\ud83d")).toBe("")
  })

  test("truncate never renders wider than its cap on malformed input, and leaks no lone surrogate", () => {
    // The fuzz shape that failed before the sanitizer: a lone high surrogate beside combining marks made
    // the concatenated width (14) exceed the sum of per-grapheme widths used to fill the budget (13).
    const text = "😀 \ńx\n\ud83d 漢😀́漢é\ude00́é😀\na😀漢"
    const out = truncate(text, 13, "...")
    expect(stringWidth(out)).toBeLessThanOrEqual(13)
    expect(() => encodeURIComponent(out)).not.toThrow()
  })

  test("elideAtWordBoundary never emits a half surrogate from a malformed input", () => {
    const text = "漢漢漢\ud83déé\ude00\ud83da  \n"
    const out = elideAtWordBoundary(text, 6)
    expect(out.length).toBeLessThanOrEqual(6)
    expect(() => encodeURIComponent(out)).not.toThrow()
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

describe("proactive strategy escalation", () => {
  const input = {
    condition: "split the spec",
    turn: 4,
    reason: "same missing evidence",
    count: 3,
    kind: "reason",
    summary: "repeated not_met gap: same missing evidence",
    strategy: "Narrow the scope to one clause",
    signals: ["diverse_failure", "zero_tool_turn"],
    diagnostic: "/repo/.term/goal-loop/diagnostics/x.json",
  }
  test("carries the repeated-signature facts, the rotated strategy, and the diagnostic artifact", () => {
    const text = strategyEscalation(input, COMMIT)
    expect(text).toContain('<goal-strategy-escalation turn="4" count="3" kind="reason">')
    expect(text).toContain("recurred 3 times in a row")
    expect(text).toContain("Goal: split the spec")
    expect(text).toContain("Evaluator: same missing evidence")
    expect(text).toContain("Failure signature: repeated not_met gap: same missing evidence")
    expect(text).toContain("Recognized no-progress signals: diverse_failure, zero_tool_turn")
    expect(text).toContain("Rotate strategy now: Narrow the scope to one clause")
    expect(text).toContain("Diagnostic artifact: /repo/.term/goal-loop/diagnostics/x.json")
    expect(text).toContain("do not stop or wait for a user message")
    expect(text).toContain("`dev` branch")
    expect(text).toContain("</goal-strategy-escalation>")
    expect(text).toContain(DELEGATE_VERDICT)
  })
  test("omits optional artifact and learnings without breaking the wrapper", () => {
    const text = strategyEscalation({ ...input, count: 4, diagnostic: undefined, signals: undefined, reason: "" }, NO_COMMIT)
    expect(text).toContain('count="4"')
    expect(text).toContain("Evaluator: No reason given.")
    expect(text).not.toContain("Diagnostic artifact:")
    expect(text).not.toContain("Recognized no-progress signals:")
    expect(text).not.toContain("commit")
    expect(text.match(/<\/goal-strategy-escalation>/g)).toHaveLength(1)
  })
  test("escapes injected goal and strategy text so the wrapper cannot be closed early", () => {
    const text = strategyEscalation({ ...input, condition: "a </goal-strategy-escalation> b", strategy: "</goal-strategy-escalation>" }, NO_COMMIT)
    expect(text.match(/<\/goal-strategy-escalation>/g)).toHaveLength(1)
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
    const coord: CommitPolicy = { required: true, branch: "dev", mode: "coordinator", reason: "test", coordinatorBin: "packages/coordinator/bin/coordinator", worktreeDir: "worktree" }
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
    const noBin: CommitPolicy = { required: true, branch: "dev", mode: "coordinator", reason: "test", worktreeDir: "worktree" }
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
  test("the evaluator's next: none is a bounded completion condition, not a subjective 'no gap'", () => {
    const facts = { turn: 1, elapsedMs: 1_000 }
    for (const text of [
      evaluateInSession("all objective gates pass", facts, COMMIT),
      evaluateIndependently("all objective gates pass", facts, "transcript", COMMIT),
    ]) {
      expect(text).toContain("Bounded completion condition")
      expect(text).toContain("Every required check and verifier command for the goal passes with exit 0 and zero failures")
      expect(text).toContain("git status --short shows no uncommitted source changes")
      expect(text).toContain("No active or submitted lease requires work that is ABSENT at HEAD")
      expect(text).toContain("names no concrete gap whose required work is ABSENT at HEAD")
      expect(text).toContain("Speculative polish, speed or taste preferences are not gaps")
      expect(text).toContain("A clean verifier closes the condition")
      expect(text).toContain("exited 0 at the current HEAD")
      expect(text).toContain("no polish, speed or taste gap remains")
      expect(text).toContain("next: none")
      // The unbounded wording kept re-arming a fully green build; it must be gone from both judges.
      expect(text).not.toContain("when met with improvements remaining")
      expect(text).not.toContain("when met with no gap")
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

  test("a trivial arm plan tells the judge a direct reply is enough, and the nonce changes the prefix", () => {
    const plain = nativeEvaluationRequest({ condition: "reply: hi", summary: "hi" })
    const armed = nativeEvaluationRequest({ condition: "reply: hi", summary: "hi", armPlanScope: "trivial", nonce: "abc123" })
    expect(plain).not.toContain("trivial reply goal")
    expect(armed).toContain("Arm plan: this is a trivial reply goal")
    expect(armed).toContain("Do not require command output or file changes")
    expect(armed).toContain("Verdict request abc123")
    expect(armed).toContain("<condition>reply: hi</condition>")
    expect(armed.indexOf("Verdict request")).toBeLessThan(armed.indexOf("You are judging ONE condition"))
  })

  test("a code arm plan does not add the trivial-reply shortcut", () => {
    const req = nativeEvaluationRequest({ condition: "fix the tests", summary: "12 pass 0 fail", armPlanScope: "code" })
    expect(req).not.toContain("trivial reply goal")
  })

  test("the default native judge carries the verifier-closes completion rule", () => {
    // The native judge is the only per-turn evaluator by default. Without this line it demanded
    // unprovable "no polish gap remains" proof even when a clean verifyCommand exited 0.
    for (const req of [
      nativeEvaluationRequest({ condition: "fix the bug", summary: "bun run check: 2314 pass / 0 fail" }),
      nativeEvaluationRequest({
        condition: "fix the bug",
        summary: "bun run check: 2314 pass / 0 fail",
        loop: { objective: "improve the repo", iteration: 2, maxLoops: 5, history: [] },
      }),
    ]) {
      expect(req).toContain("A clean verifier closes the condition")
      expect(req).toContain("evaluator.verifyCommand")
      expect(req).toContain("no polish, speed or taste gap remains")
    }
    const loop = nativeEvaluationRequest({
      condition: "fix the bug",
      summary: "bun run check: 2314 pass / 0 fail",
      loop: { objective: "improve the repo", iteration: 4, maxLoops: 5, history: [1, 2, 3].map((v) => ({ version: v, condition: `old ${v}`, summary: `s${v}`, reason: "met", turns: 2, toolCalls: 1, endedAt: v })) },
    })
    expect(loop.length).toBeLessThan(2_000)
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

describe("the judge's digest starts at the current turn", () => {
  const reply = (text: string) => ({ type: "assistant", content: [{ type: "text", text }] })

  test("uses the <goal> kickoff when no steer was written yet", () => {
    const messages = [reply("pre goal chatter"), { type: "user", text: "<goal>reply: hi</goal>" }, reply("hi")]
    expect(currentTurnStart(messages)).toBe(2)
    expect(renderParentSummary(messages, { maxChars: 4_000, since: currentTurnStart(messages) })).toBe("hi")
  })

  test("uses the newest goal continuation, not an older one", () => {
    const messages = [
      { type: "user", text: "<goal>reply: hi</goal>" },
      reply("first attempt"),
      { type: "synthetic", text: '<goal-continuation turn="2">Evaluator: not met</goal-continuation>', metadata: { source: "goal", turn: 2 } },
      reply("second attempt"),
    ]
    expect(currentTurnStart(messages)).toBe(3)
    const text = renderParentSummary(messages, { maxChars: 4_000, since: currentTurnStart(messages) })
    expect(text).toContain("second attempt")
    expect(text).not.toContain("first attempt")
  })

  test("falls back to the whole transcript when no marker exists", () => {
    expect(currentTurnStart([reply("one"), reply("two")])).toBe(0)
  })
})

describe("steer prompts bound evaluator reasons", () => {
  test("continuation and loopContinuation elide a long reason instead of embedding it verbatim", () => {
    const reason = "R".repeat(2000)
    const continuationText = continuation({ condition: "a", turn: 2, reason }, NO_COMMIT)
    expect(continuationText).not.toContain(reason)
    expect(continuationText).toContain("…")
    expect(continuationText.length).toBeLessThan(1_000)
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

  test("the default unbounded-width fast path matches the general degradation loop", () => {
    const cases = [
      spend,
      { ...EMPTY_USAGE, input: 120_000, output: 8_400 },
      { ...EMPTY_USAGE, input: 1, output: 1, cacheRead: 1, cost: 0.001 },
      { ...EMPTY_USAGE, input: 999_999, output: 9_999, reasoning: 99, cacheWrite: 5, cost: 12.5 },
    ]
    for (const value of cases) {
      // A finite width larger than any rendered line can never trigger a drop, so the general loop and
      // the early return for the default Infinity must agree exactly.
      expect(formatSpend(value)).toBe(formatSpend(value, Number.MAX_SAFE_INTEGER))
    }
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

describe("formatDurationCoarse regression: non-finite input", () => {
  test("NaN and Infinity render <1m, never NaN/Infinity garbage", () => {
    expect(formatDurationCoarse(Number.NaN)).toBe("<1m")
    expect(formatDurationCoarse(Number.POSITIVE_INFINITY)).toBe("<1m")
    expect(formatDurationCoarse(Number.NEGATIVE_INFINITY)).toBe("<1m")
  })
})

describe("formatTokens/formatCost regression: non-finite input", () => {
  test("non-finite token and cost metrics render as zero, never NaNM/InfinityM", () => {
    expect(formatTokens(Number.NaN)).toBe("0")
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("0")
    expect(formatTokens(Number.NEGATIVE_INFINITY)).toBe("0")
    expect(formatCost(Number.NaN)).toBe("$0")
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe("$0")
    expect(formatCost(Number.NEGATIVE_INFINITY)).toBe("$0")
  })
  test("finite values are byte-identical to the pre-guard formatting", () => {
    expect(formatTokens(950)).toBe("950")
    expect(formatTokens(12_345)).toBe("12k")
    expect(formatTokens(2_500_000)).toBe("2.50M")
    expect(formatCost(0)).toBe("$0")
    expect(formatCost(-5)).toBe("$0")
    expect(formatCost(0.005)).toBe("<$0.01")
    expect(formatCost(0.5)).toBe("$0.50")
    expect(formatCost(12.345)).toBe("$12.35")
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

describe("native evaluator verdict", () => {
  test("a loop kickoff states the objective and the no-judge contract exactly once", () => {
    const objective = "Run an evidence-based repo improvement pass in small units via the repo's workflow: remove dead code and unify naming. Preserve behavior and run all checks."
    // Iteration 1 arms the objective itself: condition === objective.
    const kickoff = directive(objective, COMMIT, { iteration: 1, maxLoops: 5, objective, history: [] })
    const count = (needle: string) => kickoff.split(needle).length - 1
    expect(count(objective)).toBe(1) // no duplicated objective paragraph
    expect(kickoff).toContain("Condition for this iteration: the objective above")
    expect(kickoff).toContain("WORKING RULES")
    expect(kickoff).toContain("VERDICT HANDOFF")
    // one, and only one, "do the work / end your turn / evaluator" instruction block
    expect(kickoff).not.toContain("Do the work below")
    expect(kickoff).not.toContain("an independent evaluator checks this iteration and decides what comes next")
    expect(count(DELEGATE_VERDICT)).toBe(1)
    expect(kickoff.endsWith(DELEGATE_VERDICT)).toBe(true)
  })

  test("the iteration-1 kickoff is a stable golden structure", () => {
    // Pin the whole rendered prompt, not just counts: a future edit that re-introduces a second
    // objective, a second no-judge block, or a dropped header changes this string and fails here.
    const objective = "Run an evidence-based repo improvement pass in small units via the repos workflow: remove dead code and unify naming. Preserve behavior and run all checks."
    const kickoff = directive(objective, NO_COMMIT, { iteration: 1, maxLoops: 5, objective, history: [] }, true)
    const expected = [
      `<goal>`,
      `<loop iteration="1" max="5">`,
      `Context: this is iteration 1 of at most 5 in a continuous improvement loop.`,
      `Prior iterations:\n(none — this is the first iteration)`,
      `</loop>`,
      `Objective (constant): ${objective}`,
      `Condition for this iteration: the objective above (no narrower step this iteration).`,
      `</goal>`,
      ``,
      `WORKING RULES`,
      `Show command output when it is part of the work. Do not stop to ask for confirmation unless you are truly blocked.`,
      ``,
      `VERDICT HANDOFF`,
      DELEGATE_VERDICT,
    ].join("\n")
    expect(kickoff).toBe(expected)
  })

  test("loop continuation leaves the evaluator contract to DELEGATE_VERDICT alone", () => {
    const text = loopContinuation({ iteration: 2, maxLoops: 5, condition: "c", previousSummary: "s", reason: "met" }, COMMIT)
    expect((text.match(/evaluator/gi) ?? []).length).toBe(1)
    expect(text).toContain("a met result arms the next iteration; a not_met result keeps this one active.")
    expect(text.split(DELEGATE_VERDICT).length - 1).toBe(1)
    expect(text.endsWith(DELEGATE_VERDICT)).toBe(true)
  })

  test("the system reminder states the do-work/evaluator contract once", () => {
    const text = systemReminder("c", COMMIT)
    expect((text.match(/evaluator/gi) ?? []).length).toBe(1)
    expect((text.match(/do the work/gi) ?? []).length).toBe(1)
    expect(text).toContain("Only command output and test results visible in this conversation count as evidence.")
    expect(text.split(DELEGATE_VERDICT).length - 1).toBe(1)
    expect(text.endsWith(DELEGATE_VERDICT)).toBe(true)
  })

  test("a later iteration keeps both the objective and its narrower condition", () => {
    const objective = "the constant objective"
    const condition = "this iteration's narrower condition"
    const kickoff = directive(condition, COMMIT, {
      iteration: 2,
      maxLoops: 5,
      objective,
      history: [{ version: 1, condition: "c", summary: "s", reason: "r", turns: 2, toolCalls: 5, endedAt: 1 }],
    })
    expect(kickoff).toContain(`Objective (constant): ${objective}`)
    expect(kickoff).toContain(`Condition for this iteration: ${condition}`)
    expect(kickoff.split(objective).length - 1).toBe(1)
    expect(kickoff.split(condition).length - 1).toBe(1)
  })

  test("the kickoff directive tells the worker to report evidence and never judge the verdict", () => {
    const kickoff = directive("all tests pass", COMMIT)
    expect(kickoff).toContain(DELEGATE_VERDICT)
    expect(kickoff.endsWith(DELEGATE_VERDICT)).toBe(true) // last line, after the commit rule
    expect(kickoff).not.toContain("delegate the verdict to")
    expect(kickoff).not.toContain("task tool")
    expect(kickoff).not.toContain("Prove progress")
    expect(DELEGATE_VERDICT).toContain("don't judge the verdict, delegate that judgment, or narrate it")
    expect(DELEGATE_VERDICT).not.toContain("do not delegate, judge, or narrate")
    expect(DELEGATE_VERDICT).not.toContain("after your turn") // the conflicting evaluator-timing advice is gone
    expect(DELEGATE_VERDICT).toContain("Never state, declare, or assess whether the condition is met")
  })

  test("the verdict handoff makes delegated background subagents safe and drops timing advice (CCIX)", () => {
    // A parent must be able to end its turn while subagents run: goal-loop defers the verdict for active
    // sessions, and the harness injects the reports back to wake the parent. No "judges after your turn" worry.
    expect(DELEGATE_VERDICT).toContain("goal-loop detects active sessions and defers its verdict")
    expect(DELEGATE_VERDICT).toContain("no nudge")
    expect(DELEGATE_VERDICT).toContain("the harness injects results back to wake you")
    expect(DELEGATE_VERDICT).not.toContain("after your turn")
    for (const text of [
      directive("all tests pass", COMMIT),
      continuation({ condition: "a", turn: 2, reason: "not yet" }, COMMIT),
      checkin({ condition: "a", waitedMs: 1_000, subagents: 1, shells: 0 }, COMMIT),
      systemReminder("a", COMMIT),
    ]) {
      expect(text).toContain("the harness injects results back to wake you")
    }
  })

  test("every worker-facing prompt ends with the shared no-judge invariant (CXLII coverage hole)", () => {
    const prompts = [
      ["directive", directive("all tests pass", COMMIT)],
      ["continuation", continuation({ condition: "a", turn: 2, reason: "not yet" }, COMMIT)],
      ["retry", retry({ condition: "a", label: "timeout" }, COMMIT)],
      ["checkin", checkin({ condition: "a", waitedMs: 1_000, subagents: 1, shells: 0 }, COMMIT)],
      ["loopContinuation", loopContinuation({ iteration: 2, maxLoops: 5, condition: "a", previousSummary: "done", reason: "r" }, COMMIT)],
      ["loopReanchor", loopReanchor({ iteration: 2, maxLoops: 5, objective: "o", condition: "a", history: [] })],
      ["systemReminder", systemReminder("a", COMMIT)],
    ] as const
    for (const [name, text] of prompts) {
      expect({ name, endsWithInvariant: text.endsWith(DELEGATE_VERDICT) }).toEqual({ name, endsWithInvariant: true })
    }
    // The one source of truth replaced continuation's old, weaker custom wording.
    expect(continuation({ condition: "a", turn: 2, reason: "not yet" }, COMMIT)).not.toContain("The harness judges the condition after your turn")
  })

  test("only subagent reports from the evaluator agent count as verdicts", () => {
    expect(isEvaluatorReport({ source: "subagent", agent: "Evaluator", childID: "ses_1" })).toBe(true)
    expect(isEvaluatorReport({ source: "subagent", agent: "evaluator" })).toBe(true)
    expect(isEvaluatorReport({ source: "subagent", agent: "review" })).toBe(false)
    expect(isEvaluatorReport({ source: "shell", agent: "evaluator" })).toBe(false)
    expect(isEvaluatorReport(undefined)).toBe(false)
  })

  test("echoedCondition tolerates aliases and a strict-parse-failed body", () => {
    expect(echoedCondition('{"verdict":"met","condition":"Reply with DONE"}')).toBe("Reply with DONE")
    expect(echoedCondition('{"verdict":"met","echo":"Reply with DONE"}')).toBe("Reply with DONE")
    expect(echoedCondition('{"verdict":"met","reason":"bad \" quote","condition":"Reply with DONE"}')).toBe("Reply with DONE")
    expect(echoedCondition('{"verdict":"met","reason":"no echo"}')).toBeUndefined()
  })

  test("echoMatches accepts exact, punctuated and paraphrased echoes but rejects a different goal", () => {
    // Re-pointed from the deleted conditionEchoMatches wrapper: compose the two underlying exports directly,
    // keeping the same assertions on the production token-overlap primitive.
    const expected = "Reply with the single word DONE."
    const matches = (body: string) => {
      const echo = echoedCondition(body)
      return echo === undefined ? false : echoMatches(echo, expected)
    }
    expect(matches('{"condition":"Reply with the single word DONE."}')).toBe(true)
    expect(matches('{"condition":"reply with the single word done"}')).toBe(true)
    expect(matches('{"condition":"Reply with the single word DONE. Extra."}')).toBe(true)
    expect(matches('{"condition":"Fix the roadmap-renderer.html layout"}')).toBe(false)
    expect(matches('{"condition":"Verify the anti-dup marker in the plugin"}')).toBe(false)
    expect(matches('{"verdict":"met","reason":"stale"}')).toBe(false)
  })

  test("the bounded echo-normalization memo keeps echoMatches exact cold and warm", () => {
    // Independent oracle: the same NFKC + Unicode-letter fold, reimplemented without the cache.
    const oracle = (text: string) => text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    const expected = "Reply with the single word DONE."
    const echoes = [
      "Reply with the single word DONE.", "reply with the single word done",
      "Reply with the single word DONE. Extra.", "Verify the anti-dup marker",
      "İstanbul — 魚🐟 release!", "  padded   reply  ",
    ]
    for (const echo of echoes) {
      const a = oracle(echo), b = oracle(expected)
      const want = a === b || a.includes(b) || b.includes(a)
      // Two passes: the second hits the memo for both the echo and the expected condition.
      for (let pass = 0; pass < 2; pass++) {
        expect(echoMatches(echo, expected)).toBe(want)
      }
    }
  })

  test("verdictFromNativeReport pins the exact stale-condition error text after the single-parse refactor", () => {
    const stale = { key: "stale", state: "completed", body: '{"verdict":"met","reason":"the 4-part prompt was implemented","condition":"Verify the anti-dup marker"}' }
    const expected = "Reply with the single word DONE."
    // The message is assembled from one parsed echo; quoting must stay byte-identical.
    expect(() => verdictFromNativeReport(stale, expected)).toThrow(
      'evaluator subagent judged a stale condition: expected "Reply with the single word DONE.", report echoed "Verify the anti-dup marker"',
    )
    // A JSON-ish body whose echo needed the alias fallback still parses once and produces the same text.
    const jsonish = { key: "jsonish", state: "completed", body: '{"verdict":"met","reason":"bad \" quote","condition":"Verify the anti-dup marker"}' }
    expect(() => verdictFromNativeReport(jsonish, expected)).toThrow(/report echoed "Verify the anti-dup marker"/)
    // No expected condition: the echo is never parsed and behavior is unchanged.
    expect(verdictFromNativeReport(stale)).toEqual({ verdict: "met", reason: "the 4-part prompt was implemented" })
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

  test("every fail-closed verdict error clips the raw body at one shared 500-char preview", () => {
    // The four error paths used to repeat a literal `slice(0, 500)`; pin that they all still clip at
    // the same width so moving to one helper changed no message.
    const long = "A".repeat(700)
    const first500 = "A".repeat(500)
    const errorFor = (state: string, body: string) => {
      try { verdictFromNativeReport({ key: "x", body, state }); return "" } catch (e) { return (e as Error).message }
    }
    expect(errorFor("error", long)).toBe(`evaluator subagent failed: ${first500}`)
    expect(errorFor("completed", `"rests_on":{} ${long}`)).toBe(
      `evaluator subagent returned a verdict from a different evaluation contract: ${`"rests_on":{} ${long}`.slice(0, 500)}`,
    )
    expect(errorFor("completed", long)).toBe(
      `unreadable verdict: evaluator subagent returned no authoritative verdict/met field (status/result are not verdicts): ${first500}`,
    )
  })

  test("a failed or unreadable native report throws so the generation judge can take over", () => {
    expect(() => verdictFromNativeReport({ key: "x", body: "Free usage limit reached (429)", state: "error" })).toThrow(/evaluator subagent failed: Free usage limit reached/)
    expect(() => verdictFromNativeReport({ key: "x", body: "no verdict here", state: "completed" })).toThrow(/unreadable verdict/)
    expect(verdictFromNativeReport({ key: "x", body: '{"verdict":"met","reason":"ok"}', state: "completed" })).toEqual({ verdict: "met", reason: "ok" })
  })

  test("a replayed verdict from a foreign rubric is rejected instead of scoring a false met", () => {
    // Exact body shape from the live ses_dffcbe0b / replay:hello. failure: an i18n/Astro review rubric with
    // `status` instead of `verdict` and no condition echo. parseVerdict would otherwise read status:met as met.
    const replay = [
      '{"rests_on":"Set of four runtime code files across i18n, landing page, pricing, and presale page",',
      '"status":"met","target_files":[{"path":"src/i18n/locales/en.json","status":"edited"}],',
      '"observed_evidence":"en.json has landingFeature keys","verified_this_turn":"empty diff"}',
    ].join("")
    expect(() => verdictFromNativeReport({ key: "replay", body: replay, state: "completed" }, "replay: hello.")).toThrow(/different evaluation contract/)
    // Even without the foreign marker keys, a bare status/result field is not an authoritative verdict.
    expect(() => verdictFromNativeReport({ key: "status", body: '{"status":"met","reason":"done"}', state: "completed" })).toThrow(/unreadable verdict.*no authoritative verdict\/met field/)
    expect(() => verdictFromNativeReport({ key: "result", body: '{"result":"met","reason":"done"}', state: "completed" })).toThrow(/unreadable verdict.*no authoritative verdict\/met field/)
    // A real met, including the small-model `{met, reason}` shape with no echo, is still accepted.
    expect(verdictFromNativeReport({ key: "ok", body: '{"met":true,"reason":"done"}', state: "completed" }, "replay: hello.")).toEqual({ verdict: "met", reason: "done" })
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
  const coord: CommitPolicy = { required: true, branch: "dev", mode: "coordinator", reason: "test", coordinatorBin: "packages/coordinator/bin/coordinator", worktreeDir: "worktree" }

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
