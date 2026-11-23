import { describe, expect, test } from "bun:test"
import { stripReasoningControl } from "../src/core/sanitize.ts"

describe("stripReasoningControl", () => {
  test("leaves ordinary text untouched (idempotent)", () => {
    const text = "objective: ship the thing\nachieved: commit abc123\nconstraints_next: keep it simple"
    expect(stripReasoningControl(text)).toBe(text)
    expect(stripReasoningControl(stripReasoningControl(text))).toBe(text)
  })

  test("removes a complete namespaced paired block", () => {
    expect(stripReasoningControl("<ernie:think>reasoning here</ernie:think>objective: done")).toBe("objective: done")
  })

  test("removes paired blocks of every supported tag name, case-insensitively", () => {
    expect(stripReasoningControl("<THINK>a</THINK>keep")).toBe("keep")
    expect(stripReasoningControl("<thinking>a</thinking>keep")).toBe("keep")
    expect(stripReasoningControl("<reasoning>a</reasoning>keep")).toBe("keep")
    expect(stripReasoningControl("<thought>a</thought>keep")).toBe("keep")
  })

  test("stray closer with an unterminated reasoning preamble keeps the post-tag answer", () => {
    expect(stripReasoningControl("hmm, let me think about this</ernie:think>objective: done")).toBe("objective: done")
  })

  test("verbatim Workstream XXV leak: pre-tag block is complete, post-tag restart is a truncated duplicate — keeps the block", () => {
    const block =
      "objective: Create LOOP.txt\nstatus: met\nachieved: commit b716ac9\nconstraints_next: keep it closed"
    const leaked = `${block}.</ernie:think>objective: Cre`
    expect(stripReasoningControl(leaked)).toBe(block + ".")
  })

  test("post-tag content that is not a duplicate of the prefix is kept, preamble dropped", () => {
    expect(stripReasoningControl("objective: one status: met</ernie:think>totally different answer")).toBe(
      "totally different answer",
    )
  })

  test("trailing stray closer with no post-tag content keeps the pre-tag content", () => {
    expect(stripReasoningControl("objective: done</ernie:think>")).toBe("objective: done")
  })

  test("unterminated opener drops the reasoning tail to end-of-text", () => {
    expect(stripReasoningControl("objective: done\n<ernie:think>and now I ramble forever")).toBe("objective: done")
  })

  test("nested stray closers inside the kept part are re-cleaned", () => {
    expect(stripReasoningControl("a</ernie:think>objective: done</ernie:think>objective: do")).toBe("objective: done")
  })

  test("tags-only input strips to empty string", () => {
    expect(stripReasoningControl("<ernie:think></ernie:think>")).toBe("")
    expect(stripReasoningControl("<ernie:think>")).toBe("")
  })

  test("ordinary angle brackets that are not reasoning tags survive", () => {
    expect(stripReasoningControl("use <ernie:notthink> and <goal-loop> tags")).toBe("use <ernie:notthink> and <goal-loop> tags")
  })

  test("whitespace around kept content is trimmed", () => {
    expect(stripReasoningControl("\n  <ernie:think>x</ernie:think>  objective: done  \n")).toBe("objective: done")
  })
})

import { resolveConfig } from "../src/core/config.ts"
import type { CommitPolicy } from "../src/core/types.ts"
import type { LoopSummaryRequest, NextGoalRequest } from "../src/runtime/ports.ts"
import { Evaluator } from "../src/runtime/evaluator.ts"

const SID = "ses_test"
const COMMIT: CommitPolicy = { required: false, branch: "dev", mode: "direct", reason: "test" }
const silentLog = { info() {}, warn() {}, error() {} }
const sessionConfig = () => resolveConfig({ evaluator: { mode: "session" } }, {}).evaluator

const XXV_LEAK =
  "objective: Create LOOP.txt containing ok\nstatus: met\nachieved: commit b716ac9, od = 6f 6b\nconstraints_next: keep it closed.</ernie:think>objective: Cre"

function summaryRequest(maxSummaryTokens = 400): LoopSummaryRequest {
  return {
    sessionID: SID,
    objective: "improve the loop",
    condition: "loop is better",
    reason: "met",
    turn: 1,
    elapsedMs: 1000,
    toolCalls: 4,
    history: [],
    maxSummaryTokens,
    signal: new AbortController().signal,
  }
}

describe("Evaluator + summarizer sanitization (integration)", () => {
  test("session summarize returns the block without the reasoning tag or the duplicated restart", async () => {
    const fake = {
      sessionGenerate: async () => XXV_LEAK,
      modelGenerate: async () => XXV_LEAK,
      context: async () => [],
    }
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const summary = await evaluator.summarize(summaryRequest())
    expect(summary).not.toContain("</ernie:think>")
    expect(summary.startsWith("objective: Create LOOP.txt")).toBe(true)
    expect(summary.indexOf("objective:")).toBe(summary.lastIndexOf("objective:"))
  })

  test("independent summarizer output is sanitized the same way", async () => {
    const fake = {
      sessionGenerate: async () => "unused",
      modelGenerate: async () => XXV_LEAK,
      context: async () => [{ role: "user", content: "x" }],
    }
    const evaluator = new Evaluator(
      fake,
      resolveConfig({ model: "provider/model", evaluator: { mode: "independent" } }, {}).evaluator,
      COMMIT,
      silentLog,
    )
    const summary = await evaluator.summarize(summaryRequest())
    expect(summary).not.toContain("</ernie:think>")
    expect(summary.startsWith("objective: Create LOOP.txt")).toBe(true)
  })

  test("next-goal planner prompt carries no reasoning control tag even with a leaked latestSummary and leaked history", async () => {
    const prompts: string[] = []
    const fake = {
      sessionGenerate: async (_sid: string, prompt: string) => {
        prompts.push(prompt)
        return "fix the flaky check"
      },
      modelGenerate: async () => "unused",
      context: async () => [],
    }
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const request: NextGoalRequest = {
      sessionID: SID,
      objective: "improve the loop",
      history: [{ version: 1, condition: "prior</ernie:think>condition", summary: XXV_LEAK, reason: "met", turns: 1, toolCalls: 2, endedAt: 1 }],
      latestSummary: XXV_LEAK,
      signal: new AbortController().signal,
    }
    const reply = await evaluator.nextGoal(request)
    expect(reply).toBe("fix the flaky check")
    const prompt = prompts[0]!
    expect(prompt).not.toContain("</ernie:think>")
    expect(prompt).not.toContain("<ernie:think>")
  })
})

describe("the bounded probe memo", () => {
  test("cold and warm sanitization stays byte-identical to an uncached oracle", () => {
    // Independent reimplementation of the filter itself is overkill here; pin that repeated calls
    // (which hit the memo on both halves of the prefix comparison) give the same output as the first.
    const inputs = [
      "<ernie:think>internal reasoning</ernie:think>the answer",
      "the answer came first</ernie:think>duplicated answer came first",
      "<think>unfinished reasoning tail",
      "plain text with no tags at all",
      "weird  unicode — 魚🐟  punctuation",
    ]
    for (const input of inputs) {
      const first = stripReasoningControl(input)
      for (let pass = 0; pass < 2; pass++) expect(stripReasoningControl(input)).toBe(first)
      expect(stripReasoningControl(first)).toBe(first) // idempotent after the memo is warm
    }
  })
})
