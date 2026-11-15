import { describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/core/config.ts"
import type { CommitPolicy } from "../src/core/types.ts"
import type { EvaluationRequest, LoopSummaryRequest, NextGoalRequest } from "../src/runtime/ports.ts"
import { EvaluationError, Evaluator } from "../src/runtime/evaluator.ts"

const SID = "ses_test"
const COMMIT: CommitPolicy = { required: false, branch: "dev", mode: "direct", reason: "test" }
const silentLog = { info() {}, warn() {}, error() {} }

const verdictJson = (verdict: string, reason = "because") => JSON.stringify({ verdict, reason })

const sessionConfig = (overrides: Record<string, unknown> = {}) =>
  resolveConfig({ evaluator: { mode: "session", ...overrides } }, {}).evaluator

const independentConfig = (overrides: Record<string, unknown> = {}) =>
  resolveConfig({ model: "provider/model", evaluator: { mode: "independent", ...overrides } }, {}).evaluator

interface FakeDeps {
  sessionGenerate: (sessionID: string, prompt: string, signal: AbortSignal) => Promise<string>
  modelGenerate: (model: unknown, prompt: string, signal: AbortSignal) => Promise<string>
  context: (sessionID: string, signal: AbortSignal) => Promise<readonly unknown[]>
}

function deps(overrides: Partial<FakeDeps> = {}) {
  const calls = { session: [] as string[], model: [] as string[], context: 0 }
  const fake: FakeDeps = {
    sessionGenerate: async (_sid, prompt) => {
      calls.session.push(prompt)
      return verdictJson("met")
    },
    modelGenerate: async (_model, prompt) => {
      calls.model.push(prompt)
      return verdictJson("met")
    },
    context: async () => {
      calls.context++
      return [{ role: "user", content: "hello" }]
    },
    ...overrides,
  }
  return { fake, calls }
}

const request = (overrides: Partial<EvaluationRequest> = {}): EvaluationRequest => ({
  sessionID: SID,
  condition: "all tests pass",
  turn: 3,
  elapsedMs: 12_000,
  signal: new AbortController().signal,
  ...overrides,
})

const summaryRequest = (maxSummaryTokens: number): LoopSummaryRequest => ({
  sessionID: SID,
  objective: "improve the docs",
  condition: "docs are better",
  reason: "met",
  turn: 2,
  elapsedMs: 5_000,
  toolCalls: 4,
  history: [],
  maxSummaryTokens,
  signal: new AbortController().signal,
})

const nextGoalRequest = (): NextGoalRequest => ({
  sessionID: SID,
  objective: "improve the docs",
  latestSummary: "did things",
  history: [],
  signal: new AbortController().signal,
})

describe("Evaluator.evaluate", () => {
  test("session mode returns the parsed verdict and leaves isEvaluating false afterwards", async () => {
    const { fake, calls } = deps()
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(calls.session).toHaveLength(1)
    expect(evaluator.isEvaluating(SID)).toBe(false)
  })

  test("isEvaluating is true while a session evaluation is in flight", async () => {
    let release!: (text: string) => void
    const pending = new Promise<string>((resolve) => (release = resolve))
    const { fake } = deps({ sessionGenerate: async () => pending })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const inflight = evaluator.evaluate(request())
    await new Promise((resolve) => setImmediate(resolve))
    expect(evaluator.isEvaluating(SID)).toBe(true)
    release(verdictJson("not_met", "more work"))
    const result = await inflight
    expect(result.verdict).toBe("not_met")
    expect(evaluator.isEvaluating(SID)).toBe(false)
  })

  test("independent mode judges on the transcript digest without touching session.generate", async () => {
    const { fake, calls } = deps()
    const evaluator = new Evaluator(fake, independentConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(calls.context).toBe(1)
    expect(calls.model).toHaveLength(1)
    expect(calls.session).toHaveLength(0)
  })

  test("independent failure falls back to the session evaluator once", async () => {
    const { fake, calls } = deps({
      context: async () => {
        throw new Error("transcript unavailable")
      },
    })
    const evaluator = new Evaluator(fake, independentConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(calls.session).toHaveLength(1)
  })

  test("unreadable verdict is retried once with the repair prompt, then parses", async () => {
    let turn = 0
    const prompts: string[] = []
    const { fake } = deps({
      sessionGenerate: async (_sid, prompt) => {
        prompts.push(prompt)
        turn++
        return turn === 1 ? "garbage that is not a verdict" : verdictJson("met", "fixed on retry")
      },
    })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(result.reason).toBe("fixed on retry")
    expect(prompts).toHaveLength(2)
  })

  test("two unreadable verdicts raise EvaluationError", async () => {
    const { fake } = deps({ sessionGenerate: async () => "total garbage" })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    await expect(evaluator.evaluate(request())).rejects.toThrow(EvaluationError)
  })

  test("an already-aborted signal cuts the evaluation off and unwinds isEvaluating", async () => {
    const { fake } = deps({
      sessionGenerate: (_sid, _prompt, signal) =>
        new Promise<string>((_resolve, reject) => {
          if (signal.aborted) return reject(new Error("aborted by timeout"))
          signal.addEventListener("abort", () => reject(new Error("aborted by timeout")))
        }),
    })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const aborted = new AbortController()
    aborted.abort()
    await expect(evaluator.evaluate(request({ signal: aborted.signal }))).rejects.toThrow("aborted by timeout")
    expect(evaluator.isEvaluating(SID)).toBe(false)
  })
})

describe("Evaluator.summarize", () => {
  test("caps the summary at max(200, tokens) * 4 characters with an ellipsis", async () => {
    const { fake } = deps({ sessionGenerate: async () => "word ".repeat(2_000) })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const small = await evaluator.summarize(summaryRequest(10))
    // max(200, 10) * 4 = 800 — the documented formula, not max(200, 40)
    expect(small.length).toBe(800)
    expect(small.endsWith("…")).toBe(true)
    const large = await evaluator.summarize(summaryRequest(300))
    // max(200, 300) * 4 = 1200
    expect(large.length).toBe(1_200)
  })

  test("leaves short summaries untouched", async () => {
    const { fake } = deps({ sessionGenerate: async () => "short and sweet" })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    expect(await evaluator.summarize(summaryRequest(400))).toBe("short and sweet")
  })
})

describe("Evaluator.nextGoal", () => {
  test("trims and caps the reply at 4000 characters", async () => {
    const { fake } = deps({ sessionGenerate: async () => `  ${"x".repeat(5_000)}  ` })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const reply = await evaluator.nextGoal(nextGoalRequest())
    expect(reply.length).toBe(4_000)
  })
})
