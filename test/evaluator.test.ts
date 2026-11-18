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

describe("Evaluator.evaluate — evaluator.consensus: 2", () => {
  const consensusSession = (overrides: Record<string, unknown> = {}) =>
    resolveConfig({ model: "provider/model", evaluator: { mode: "session", consensus: 2, ...overrides } }, {}).evaluator
  const consensusIndependent = (overrides: Record<string, unknown> = {}) =>
    resolveConfig({ model: "provider/model", evaluator: { mode: "independent", consensus: 2, ...overrides } }, {}).evaluator

  test("both judges met: verdict met", async () => {
    let modelCalls = 0
    const { fake } = deps({
      sessionGenerate: async () => verdictJson("met", "session says done"),
      modelGenerate: async () => {
        modelCalls++
        return verdictJson("met", "independent says done")
      },
    })
    const evaluator = new Evaluator(fake, consensusSession(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(modelCalls).toBe(1)
  })

  test("disagreement fails closed to not_met, with the disagreement named in the reason", async () => {
    const { fake } = deps({
      sessionGenerate: async () => verdictJson("met", "looks done to me"),
      modelGenerate: async () => verdictJson("not_met", "no test output anywhere"),
    })
    const evaluator = new Evaluator(fake, consensusSession(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus disagreement")
    expect(result.reason).toContain("session evaluator ruled met")
    expect(result.reason).toContain("independent evaluator ruled not_met")
    expect(result.reason).toContain("no test output anywhere")
  })

  test("independent primary disagreeing with the session second opinion fails closed the same way", async () => {
    const { fake } = deps({
      modelGenerate: async () => verdictJson("met", "independent says done"),
      sessionGenerate: async () => verdictJson("not_met", "transcript shows no green run"),
    })
    const evaluator = new Evaluator(fake, consensusIndependent(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus disagreement")
    expect(result.reason).toContain("independent evaluator ruled met")
    expect(result.reason).toContain("session evaluator ruled not_met")
  })

  test("a dead second judge fails closed to not_met, named — met never passes on one vote", async () => {
    const { fake } = deps({
      sessionGenerate: async () => verdictJson("met", "session says done"),
      modelGenerate: async () => {
        throw new Error("model unreachable")
      },
    })
    const evaluator = new Evaluator(fake, consensusSession(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus")
    expect(result.reason).toContain("fail closed")
  })

  test("session primary with no independent model configured fails closed, named", async () => {
    const { fake, calls } = deps({
      sessionGenerate: async () => verdictJson("met", "session says done"),
    })
    const evaluator = new Evaluator(fake, resolveConfig({ evaluator: { mode: "session", consensus: 2 } }, {}).evaluator, COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus")
    expect(result.reason).toContain("fail closed")
    expect(calls.model).toHaveLength(0) // no model to ask; never a silent pass
  })

  test("a not_met primary is returned as-is; the second judge is never called", async () => {
    const { fake, calls } = deps({
      sessionGenerate: async () => verdictJson("not_met", "still broken"),
      modelGenerate: async () => verdictJson("met", "independent disagrees"),
    })
    const evaluator = new Evaluator(fake, consensusSession(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(calls.model).toHaveLength(0)
  })

  test("consensus 1 (default) keeps the single-judge behavior", async () => {
    const { fake, calls } = deps({
      sessionGenerate: async () => verdictJson("met", "session says done"),
    })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(calls.model).toHaveLength(0)
  })
})

describe("Evaluator.evaluate — novelty / advancement, forward-pointer gate (Workstream XLIV)", () => {
  const transcriptWith = (messages: Array<[string, string]>) => [
    { role: "user", content: "/goal-loop iteration 1 armed" },
    ...messages.map(([role, content]) => ({ role, content })),
  ]

  test("duplicate-with-pointer: met on the already-satisfied path with a next: gap is accepted (mock transcript)", async () => {
    const { fake } = deps({
      context: async () => transcriptWith([["assistant", "git log --oneline -5\n3f3e1eb chore(coordinator)"], ["assistant", "bun run check\n1693 pass\n0 fail"]]),
      modelGenerate: async () => verdictJson("met", "Already satisfied at HEAD 3f3e1eb. No new work is produced by this iteration. next: arming-side near-duplicate gate in the loop's arm path"),
    })
    const evaluator = new Evaluator(fake, independentConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(result.reason).toContain("next:")
  })

  test("duplicate-without-pointer: bare already-satisfied met fails closed to not_met, quoted", async () => {
    const { fake } = deps({
      context: async () => transcriptWith([["assistant", "git log --oneline -5\n3f3e1eb chore(coordinator)"]]),
      modelGenerate: async () => verdictJson("met", "Already satisfied at HEAD 3f3e1eb. No new work is produced by this iteration."),
    })
    const evaluator = new Evaluator(fake, independentConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("duplicate-without-forward-pointer")
    expect(result.reason).toContain("Already satisfied at HEAD 3f3e1eb")
  })

  test("duplicate-without-pointer through the repair path fails closed the same way", async () => {
    let n = 0
    const { fake } = deps({
      sessionGenerate: async () => {
        n++
        return n === 1 ? "not json at all" : verdictJson("met", "Already satisfied at HEAD 3f3e1eb.")
      },
    })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("duplicate-without-forward-pointer")
  })

  test("fresh-but-irrelevant merged work: rubric clause visible to the judge; a not_met verdict passes through untouched", async () => {
    let seen = ""
    const { fake } = deps({
      context: async () => transcriptWith([["assistant", "merged aa5e196: unified the XL finish-time prune with the XLI restore prune"], ["assistant", "bun run check\n1693 pass\n0 fail"]]),
      modelGenerate: async (_model, prompt) => {
        seen = prompt
        return verdictJson("not_met", "merged aa5e196 unified the finish prune; the armed condition asked for the stale docs/core.html cards. next: docs/core.html stale cards")
      },
    })
    const evaluator = new Evaluator(fake, independentConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request({ condition: "fix the stale cards on docs/core.html" }))
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("docs/core.html")
    // Condition fit and novelty clauses are printed in the prompt the judge sees; the downgrade decision is the judge's.
    expect(seen).toContain("Condition fit")
    expect(seen).toContain("Novelty / no-duplicate")
    expect(seen).toContain("Honest next gap")
  })

  test("real merged gap: fresh in-turn evidence with a named gap verdicts met", async () => {
    const { fake } = deps({
      context: async () => transcriptWith([["assistant", "git log --oneline -2\naa5e196 merge wt/finish-prune-all-directories into dev"], ["assistant", "bun run check\n1693 pass\n0 fail"]]),
      modelGenerate: async () => verdictJson("met", "merged aa5e196 unifies the finish-time and restore-time prunes; bundle rebuilt; bun run check green at the post-merge HEAD. next: arming-side near-duplicate gate"),
    })
    const evaluator = new Evaluator(fake, independentConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request({ condition: "unify the XL finish-time prune with the XLI all-directory restore prune" }))
    expect(result.verdict).toBe("met")
  })

  test("the rubric both judges see carries the three new clauses (session and independent)", async () => {
    const sessionPrompts: string[] = []
    const modelPrompts: string[] = []
    const { fake } = deps({
      sessionGenerate: async (_sid, prompt) => { sessionPrompts.push(prompt); return verdictJson("not_met", "x") },
      modelGenerate: async (_model, prompt) => { modelPrompts.push(prompt); return verdictJson("not_met", "x") },
    })
    const session = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    await session.evaluate(request())
    const independent = new Evaluator(fake, independentConfig(), COMMIT, silentLog)
    await independent.evaluate(request())
    for (const prompt of [sessionPrompts[0]!, modelPrompts[0]!]) {
      expect(prompt).toContain("Condition fit")
      expect(prompt).toContain("Novelty / no-duplicate")
      expect(prompt).toContain("duplicate-without-forward-pointer")
      expect(prompt).toContain("Honest next gap")
    }
  })
})
