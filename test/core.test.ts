import { describe, expect, test } from "bun:test"
import { parseModelRef, resolveConfig } from "../src/core/config.ts"
import { classifyFailure, isNotFoundError, type FailureClass } from "../src/core/errors.ts"
import { diffUsage, formatDuration, formatDurationCoarse, formatTokens } from "../src/core/format.ts"
import { parseGoalCommand } from "../src/core/parse.ts"
import {
  checkin,
  continuation,
  directive,
  evaluateIndependently,
  evaluateInSession,
  retry,
  systemReminder,
} from "../src/core/prompts.ts"
import { renderTranscript } from "../src/core/transcript.ts"
import { EMPTY_USAGE, NO_COMMIT, type CommitPolicy } from "../src/core/types.ts"
import { parseVerdict } from "../src/core/verdict.ts"

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
  test("enforces the length limit", () => {
    const result = parseGoalCommand("x".repeat(4001), 4000)
    expect(result.type).toBe("invalid")
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
    expect(parseVerdict(JSON.stringify({ verdict: "met", reason: "a".repeat(2000) }))!.reason.length).toBeLessThanOrEqual(600)
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
  test("durations and tokens", () => {
    expect(formatDuration(5_000)).toBe("5s")
    expect(formatDuration(65_000)).toBe("1m 05s")
    expect(formatDuration(3_725_000)).toBe("1h 02m")
    expect(formatDurationCoarse(30_000)).toBe("<1m")
    expect(formatDurationCoarse(125 * 60_000)).toBe("2h05m")
    expect(formatTokens(950)).toBe("950")
    expect(formatTokens(12_345)).toBe("12k")
    expect(formatTokens(2_500_000)).toBe("2.50M")
  })
  test("usage diff never goes negative", () => {
    expect(diffUsage(EMPTY_USAGE, { ...EMPTY_USAGE, cost: 5 }).cost).toBe(0)
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
})
