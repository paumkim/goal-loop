import { describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/core/config.ts"
import { verdictFromNativeReport } from "../src/core/evaluator-agent.ts"
import type { CommitPolicy } from "../src/core/types.ts"
import type { EvaluationRequest, EvaluationResult, LoopSummaryRequest, NextGoalRequest } from "../src/runtime/ports.ts"
import { EvaluationError, Evaluator, EvaluatorVerdictError } from "../src/runtime/evaluator.ts"
import { REPAIR, STRICT_REPAIR } from "../src/core/prompts.ts"

const SID = "ses_test"
const COMMIT: CommitPolicy = { required: false, branch: "dev", mode: "direct", reason: "test" }
const silentLog = { info() {}, warn() {}, error() {} }

const verdictJson = (verdict: string, reason = "because") => JSON.stringify({ verdict, reason })

const sessionConfig = (overrides: Record<string, unknown> = {}) =>
  resolveConfig({ evaluator: { mode: "session", ...overrides } }, {}).evaluator

const independentConfig = (overrides: Record<string, unknown> = {}) =>
  resolveConfig({ model: "provider/model", evaluator: { mode: "independent", ...overrides } }, {}).evaluator

/** consensus: 2 with a pinned judge model — the native verdict is met, the model cast is the second vote. */
const consensusPinned = (overrides: Record<string, unknown> = {}) =>
  resolveConfig({ model: "provider/model", evaluator: { mode: "session", consensus: 2, ...overrides } }, {}).evaluator

/** consensus: 2 with an inherited second-vote model (the `inherit` sentinel). */
const consensusInherit = () =>
  resolveConfig({ evaluator: { model: "inherit", consensus: 2 } }, {}).evaluator

const nativeMet = (reason = "native says met") => async () => ({ verdict: "met" as const, reason })
const nativeNotMet = (reason = "native says not_met") => async () => ({ verdict: "not_met" as const, reason })

interface FakeDeps {
  nativeVerdict?: (sessionID: string, signal: AbortSignal, turn: number) => Promise<EvaluationResult | undefined>
  sessionGenerate: (sessionID: string, prompt: string, signal: AbortSignal) => Promise<string>
  modelGenerate: (model: unknown, prompt: string, signal: AbortSignal) => Promise<string>
  context: (sessionID: string, signal: AbortSignal) => Promise<readonly unknown[]>
  sessionModel?: (sessionID: string, signal: AbortSignal) => Promise<{ providerID: string; id: string; variant?: string } | undefined>
}

function deps(overrides: Partial<FakeDeps> = {}) {
  const calls = { session: [] as string[], model: [] as string[], context: 0 }
  const modelOverride = overrides.modelGenerate
  const base = {
    sessionGenerate: overrides.sessionGenerate ?? (async (_sid: string, prompt: string) => {
      calls.session.push(prompt)
      return verdictJson("met")
    }),
    modelGenerate: async (sessionID: string, model: unknown, prompt: string, signal: AbortSignal) => {
      void sessionID
      calls.model.push(prompt)
      return modelOverride ? modelOverride(model, prompt, signal) : verdictJson("met")
    },
    context: overrides.context ?? (async () => {
      calls.context++
      return [{ role: "user", content: "hello" }]
    }),
    sessionModel: overrides.sessionModel,
  }
  // Only supply the native port when a test opts in — absence is a real fail-closed case in evaluate().
  const fake = "nativeVerdict" in overrides ? { ...base, nativeVerdict: overrides.nativeVerdict } : base
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
  test("a native met verdict is consumed with no generation and leaves isEvaluating false", async () => {
    const { fake, calls } = deps({ nativeVerdict: nativeMet("fresh evidence") })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(result.reason).toBe("fresh evidence")
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(0)
    expect(evaluator.isEvaluating(SID)).toBe(false)
  })

  test("a native not_met verdict is returned verbatim with no generation", async () => {
    const { fake, calls } = deps({ nativeVerdict: nativeNotMet("more work needed") })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result).toEqual({ verdict: "not_met", reason: "more work needed" })
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(0)
  })

  test("consensus second vote judges on the transcript digest without touching session.generate", async () => {
    const { fake, calls } = deps({ nativeVerdict: nativeMet() })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(calls.context).toBe(1)
    expect(calls.model).toHaveLength(1)
    expect(calls.session).toHaveLength(0)
  })

  test("a failing consensus transcript read fails closed to not_met", async () => {
    const { fake, calls } = deps({
      nativeVerdict: nativeMet(),
      context: async () => {
        throw new Error("transcript unavailable")
      },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus")
    expect(result.reason).toContain("transcript unavailable")
    expect(result.reason).toContain("fail closed")
    expect(calls.session).toHaveLength(0)
  })

  test("an unreadable second-vote reply is retried once with the repair prompt, then parses", async () => {
    const prompts: string[] = []
    let n = 0
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      modelGenerate: async (_model, prompt) => {
        prompts.push(prompt)
        return ++n === 1 ? "garbage that is not a verdict" : verdictJson("met", "fixed on retry")
      },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    // met proves the repaired reply parsed: an unreadable reply fails the second vote closed to not_met.
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain(REPAIR)
  })

  test("a malformed second-vote verdict object is accepted on the first attempt instead of failing all three", async () => {
    let calls = 0
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      modelGenerate: async () => {
        calls++
        return `{"verdict":"met","reason":"(a) Clause-by-clause judgment with evidence refs
status=satisfied, source/turn=turn 1
next: none"}`
      },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(calls).toBe(1)
  })

  test("two unreadable second-vote replies fail the consensus closed, named", async () => {
    const { fake } = deps({ nativeVerdict: nativeMet(), modelGenerate: async () => "total garbage" })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus")
    expect(result.reason).toContain("unreadable verdict after 3 attempts")
    expect(result.reason).toContain("fail closed")
  })

  test("empty second-vote replies escalate through REPAIR then STRICT_REPAIR and parse once text returns", async () => {
    const prompts: string[] = []
    let n = 0
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      modelGenerate: async (_model, prompt) => {
        prompts.push(prompt)
        return ++n <= 2 ? "" : verdictJson("met", "recovered on the third attempt")
      },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).toContain(REPAIR)
    expect(prompts[2]).toContain(STRICT_REPAIR)
  })

  test("persistently empty second-vote replies fail closed naming the escalation", async () => {
    let calls = 0
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      modelGenerate: async () => {
        calls++
        return ""
      },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("unreadable verdict after 3 attempts")
    expect(calls).toBe(3)
  })

  test("unreadable second-vote replies are logged with their raw text (no silent failure)", async () => {
    const warnings: Array<Record<string, unknown>> = []
    const log = { ...silentLog, warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, ...fields }) }
    const { fake } = deps({ nativeVerdict: nativeMet(), modelGenerate: async () => "tool-call-only reply" })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, log)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(warnings).toHaveLength(3)
    expect(warnings.map((w) => w.attempt)).toEqual([1, 2, 3])
    expect(warnings[0]?.message).toContain("unreadable")
    expect(warnings[0]?.preview).toBe("tool-call-only reply")
    expect(warnings[0]?.chars).toBe("tool-call-only reply".length)
  })

  test("an already-aborted signal cuts the evaluation off and unwinds isEvaluating", async () => {
    const aborted = new AbortController()
    aborted.abort()
    const { fake } = deps({ nativeVerdict: nativeMet() })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    await expect(evaluator.evaluate(request({ signal: aborted.signal }))).rejects.toThrow(/aborted/)
    expect(evaluator.isEvaluating(SID)).toBe(false)
  })
})

describe("Evaluator.evaluate — native delegated subagent report", () => {
  test("a delivered evaluator report is consumed as the verdict with no generation judge", async () => {
    const { fake, calls } = deps({ nativeVerdict: async () => ({ verdict: "met" as const, reason: "fresh evidence in the child report" }) })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result).toEqual({ verdict: "met", reason: "fresh evidence in the child report" })
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(0)
  })

  test("no native verdict port fails closed without telling the worker to delegate", async () => {
    const { fake, calls } = deps()
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("no usable verdict from the evaluator child")
    expect(result.reason).not.toContain("delegate")
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(0)
  })

  test("a missing verdict still fails closed so the turn is judged again", async () => {
    const { fake, calls } = deps({ nativeVerdict: async () => undefined })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("no verdict for this turn; continuing")
    expect(result.reason).not.toContain("delegate")
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(0)
  })

  test("an unreadable native report throws a verdict error with no generation fallback", async () => {
    const { fake, calls } = deps({ nativeVerdict: async () => { throw new Error("report read failed") } })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    await expect(evaluator.evaluate(request())).rejects.toThrow(/no usable evaluator subagent verdict: report read failed/)
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(0)
  })

  test("an unreadable report error is the typed verdict error the controller pauses on", async () => {
    const { fake } = deps({ nativeVerdict: async () => { throw new Error("report read failed") } })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    await expect(evaluator.evaluate(request())).rejects.toBeInstanceOf(EvaluatorVerdictError)
  })

  test("a quota error from the native report is rethrown so the controller pauses", async () => {
    const { fake } = deps({ nativeVerdict: async () => { throw new Error("Free usage limit reached (429)") } })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    await expect(evaluator.evaluate(request())).rejects.toThrow(/usage limit/i)
  })

  test("the current turn is passed to the native report reader so stale reports can be rejected", async () => {
    let seenTurn: number | undefined
    const { fake } = deps({
      nativeVerdict: async (_sessionID: string, _signal: AbortSignal, turn: number) => {
        seenTurn = turn
        return undefined
      },
    })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    await evaluator.evaluate(request({ turn: 7 }))
    expect(seenTurn).toBe(7)
  })
})

describe("Evaluator.evaluate — abstention is a defer, not a verdict", () => {
  test("an abstain result passes through unchanged with no generation and no second vote", async () => {
    const abstain = { verdict: "not_met" as const, reason: "evaluation deferred: request has no <condition> text", abstain: "empty-condition" as const }
    const { fake, calls } = deps({ nativeVerdict: async () => abstain })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result).toEqual(abstain)
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(0)
    expect(calls.context).toBe(0)
  })

  test("a genuine verdict keeps its exact shape (no abstain field)", async () => {
    const { fake } = deps({ nativeVerdict: nativeMet("fresh evidence in the child report") })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    expect(await evaluator.evaluate(request())).toEqual({ verdict: "met", reason: "fresh evidence in the child report" })
  })
})

describe("Evaluator.evaluate — a native report still passes through consensus: 2", () => {
  test("a native met needs the second judge before it can pass", async () => {
    const { fake, calls } = deps({
      nativeVerdict: nativeMet("native says done"),
      modelGenerate: async () => verdictJson("met", "independent confirms"),
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(1)
  })

  test("a native met fails closed when the second judge disagrees", async () => {
    const { fake, calls } = deps({
      nativeVerdict: nativeMet("native says done"),
      modelGenerate: async () => verdictJson("not_met", "independent disagrees"),
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus disagreement")
    expect(calls.session).toHaveLength(0)
  })

  test("a native not_met is returned as-is without calling the second judge", async () => {
    const { fake, calls } = deps({
      nativeVerdict: nativeNotMet("native says no"),
      modelGenerate: async () => verdictJson("met", "independent disagrees"),
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(calls.model).toHaveLength(0)
  })
})

describe("Evaluator.evaluate — slow / hanging provider (per-attempt budget + app-level race)", () => {
  // Bypass the config floor so a test can use a sub-second budget; the evaluator only reads timeoutMs.
  const slowConfig = (timeoutMs: number) => ({ ...consensusPinned(), timeoutMs })
  const delay = (ms: number, value: string) => new Promise<string>((resolve) => setTimeout(() => resolve(value), ms))

  test("a second-vote verdict that arrives within its budget still parses (the budget does not over-trigger)", async () => {
    const { fake } = deps({ nativeVerdict: nativeMet(), modelGenerate: () => delay(20, verdictJson("met", "in time")) })
    const evaluator = new Evaluator(fake, slowConfig(500), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
  })

  test("each escalating second-vote attempt gets its own budget — a slow garbage first attempt does not starve the repair", async () => {
    let n = 0
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      modelGenerate: (_model, _prompt, signal) => {
        n++
        const value = n === 1 ? "not a verdict" : verdictJson("met", "recovered on repair")
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => resolve(value), 200)
          const abort = () => {
            clearTimeout(timer)
            reject(new Error("aborted by timeout"))
          }
          if (signal.aborted) abort()
          else signal.addEventListener("abort", abort, { once: true })
        })
      },
    })
    const evaluator = new Evaluator(fake, slowConfig(300), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    // met proves the repair attempt finished: with a shared budget it would have been cut off.
    expect(result.verdict).toBe("met")
    expect(n).toBe(2)
  })

  test("a second vote that ignores the abort signal and never settles is cut off by the app-level race, named a timeout", async () => {
    const { fake } = deps({ nativeVerdict: nativeMet(), modelGenerate: () => new Promise<string>(() => {}) })
    const evaluator = new Evaluator(fake, slowConfig(1000), COMMIT, silentLog)
    const started = Date.now()
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("timed out after 1s (attempt 1/3)")
    expect(Date.now() - started).toBeLessThan(3000) // bounded — no indefinite hang
    expect(evaluator.isEvaluating(SID)).toBe(false)
  })

  test("empty-on-slow: a second-vote reply that lands only after the budget fired is a timeout, never a bare unreadable verdict", async () => {
    const { fake } = deps({ nativeVerdict: nativeMet(), modelGenerate: () => delay(120, "") })
    const evaluator = new Evaluator(fake, slowConfig(50), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toMatch(/timed out after/)
    expect(result.reason).not.toMatch(/unreadable verdict/)
  })

  test("a caller abort during a slow second vote aborts the evaluation, not a timeout", async () => {
    const aborter = new AbortController()
    const { fake } = deps({ nativeVerdict: nativeMet(), modelGenerate: () => new Promise<string>(() => {}) })
    const evaluator = new Evaluator(fake, slowConfig(30_000), COMMIT, silentLog)
    const inflight = evaluator.evaluate(request({ signal: aborter.signal }))
    await new Promise((resolve) => setImmediate(resolve))
    aborter.abort()
    const error = await inflight.then(
      () => undefined,
      (e: unknown) => e as Error,
    )
    expect(error).toBeInstanceOf(EvaluationError)
    expect(error?.message).toMatch(/aborted/)
    expect(error?.message).not.toMatch(/timed out/)
  })
})

describe("Evaluator.summarize", () => {
  test("isEvaluating is true while a session summarization (loop generation) is in flight", async () => {
    let release!: (text: string) => void
    const pending = new Promise<string>((resolve) => (release = resolve))
    const { fake } = deps({ sessionGenerate: async () => pending })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const inflight = evaluator.summarize(summaryRequest(400))
    await new Promise((resolve) => setImmediate(resolve))
    expect(evaluator.isEvaluating(SID)).toBe(true)
    release("done")
    await inflight
    expect(evaluator.isEvaluating(SID)).toBe(false)
  })

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
  test("both judges met: verdict met", async () => {
    let modelCalls = 0
    const { fake } = deps({
      nativeVerdict: nativeMet("native says done"),
      modelGenerate: async () => {
        modelCalls++
        return verdictJson("met", "independent says done")
      },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(modelCalls).toBe(1)
  })

  test("disagreement fails closed to not_met, with the disagreement named in the reason", async () => {
    const { fake } = deps({
      nativeVerdict: nativeMet("looks done to me"),
      modelGenerate: async () => verdictJson("not_met", "no test output anywhere"),
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus disagreement")
    expect(result.reason).toContain("native evaluator ruled met")
    expect(result.reason).toContain("independent evaluator ruled not_met")
    expect(result.reason).toContain("no test output anywhere")
  })

  test("a dead second judge fails closed to not_met, named — met never passes on one vote", async () => {
    const { fake } = deps({
      nativeVerdict: nativeMet("native says done"),
      modelGenerate: async () => {
        throw new Error("model unreachable")
      },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus")
    expect(result.reason).toContain("fail closed")
  })

  test("native met with no independent model configured fails closed, named", async () => {
    const { fake, calls } = deps({ nativeVerdict: nativeMet("native says done") })
    const evaluator = new Evaluator(fake, resolveConfig({ evaluator: { mode: "session", consensus: 2 } }, {}).evaluator, COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus")
    expect(result.reason).toContain("fail closed")
    expect(result.reason).toContain("independent model not available")
    expect(calls.model).toHaveLength(0) // no model to ask; never a silent pass
  })

  test("a native not_met is returned as-is; the second judge is never called", async () => {
    const { fake, calls } = deps({
      nativeVerdict: nativeNotMet("still broken"),
      modelGenerate: async () => verdictJson("met", "independent disagrees"),
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(calls.model).toHaveLength(0)
  })

  test("consensus 1 (default) keeps the single native verdict behavior", async () => {
    const { fake, calls } = deps({ nativeVerdict: nativeMet("native says done") })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(calls.model).toHaveLength(0)
  })
})

describe("Evaluator.evaluate — novelty / advancement, forward-pointer gate (Workstream XLIV)", () => {
  // Native report bodies are parsed by verdictFromNativeReport (which calls parseVerdict), so the
  // duplicate-without-forward-pointer gate still fires on a met delivered by the evaluator subagent.
  const nativeFromBody = (body: string) => async () =>
    verdictFromNativeReport({ key: "native-report", body, state: "completed" })
  const transcriptWith = (messages: Array<[string, string]>) => [
    { role: "user", content: "/goal-loop iteration 1 armed" },
    ...messages.map(([role, content]) => ({ role, content })),
  ]

  test("duplicate-with-pointer: met on the already-satisfied path with a next: gap is accepted (native report)", async () => {
    const { fake, calls } = deps({
      nativeVerdict: nativeFromBody(verdictJson("met", "Already satisfied at HEAD 3f3e1eb. No new work is produced by this iteration. next: arming-side near-duplicate gate in the loop's arm path")),
    })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(result.reason).toContain("next:")
    expect(calls.model).toHaveLength(0)
  })

  test("duplicate-without-pointer: bare already-satisfied met fails closed to not_met, quoted", async () => {
    const { fake } = deps({
      nativeVerdict: nativeFromBody(verdictJson("met", "Already satisfied at HEAD 3f3e1eb. No new work is produced by this iteration.")),
    })
    const evaluator = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("duplicate-without-forward-pointer")
    expect(result.reason).toContain("Already satisfied at HEAD 3f3e1eb")
  })

  test("duplicate-without-pointer through the repair path fails closed the same way", async () => {
    let n = 0
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      modelGenerate: async () =>
        ++n === 1 ? "not json at all" : verdictJson("met", "Already satisfied at HEAD 3f3e1eb."),
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("duplicate-without-forward-pointer")
  })

  test("fresh-but-irrelevant merged work: rubric clause visible to the judge; a not_met verdict passes through untouched", async () => {
    let seen = ""
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      context: async () => transcriptWith([["assistant", "merged aa5e196: unified the XL finish-time prune with the XLI restore prune"], ["assistant", "bun run check\n1693 pass\n0 fail"]]),
      modelGenerate: async (_model, prompt) => {
        seen = prompt
        return verdictJson("not_met", "merged aa5e196 unified the finish prune; the armed condition asked for the stale docs/core.html cards.\nnext:\n1. [high] Fix stale cards on docs/core.html — gap: condition requires docs/core.html update but only unrelated merge/check evidence shown — proof: diff/commit and rendered docs showing updated cards.")
      },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request({ condition: "fix the stale cards on docs/core.html" }))
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("docs/core.html")
    // Clause-by-clause evidence, novelty/forward-pointer, and next-action contract are visible to the judge.
    expect(seen).toContain("Clause-by-clause judgment")
    expect(seen).toContain("evidence matrix")
    expect(seen).toContain("duplicate-without-forward-pointer")
    expect(seen).toContain("next:")
  })

  test("real merged gap: fresh in-turn evidence with a named gap verdicts met", async () => {
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      context: async () => transcriptWith([["assistant", "git log --oneline -2\naa5e196 merge wt/finish-prune-all-directories into dev"], ["assistant", "bun run check\n1693 pass\n0 fail"]]),
      modelGenerate: async () => verdictJson("met", "merged aa5e196 unifies the finish-time and restore-time prunes; bundle rebuilt; bun run check green at the post-merge HEAD. next: arming-side near-duplicate gate"),
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request({ condition: "unify the XL finish-time prune with the XLI all-directory restore prune" }))
    expect(result.verdict).toBe("met")
  })

  test("the independent judge's rubric carries the clause-matrix, adversarial, and structured-next contract", async () => {
    const modelPrompts: string[] = []
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      modelGenerate: async (_model, prompt) => { modelPrompts.push(prompt); return verdictJson("not_met", "x") },
    })
    const evaluator = new Evaluator(fake, consensusPinned(), COMMIT, silentLog)
    await evaluator.evaluate(request())
    // The session-mode rubric is covered byte-for-byte in test/core.test.ts; here we check the
    // independent (consensus second-vote) prompt that Evaluator actually builds.
    for (const prompt of [modelPrompts[0]!]) {
      expect(prompt).toContain("evidence matrix")
      expect(prompt).toContain("satisfied|missing|contradicted|unscoped")
      expect(prompt).toContain("What would falsify met?")
      expect(prompt).toContain("What important risk is untested?")
      expect(prompt).toContain("Green but unscoped")
      expect(prompt).toContain("Broad-condition verifier corroboration")
      expect(prompt).toContain("repeated failure signatures")
      expect(prompt).toContain("strategy escalation")
      expect(prompt).toContain("next: none")
      expect(prompt).toContain("duplicate-without-forward-pointer")
      // CXXV: deliberation is bounded at the prompt level in both judge paths.
      expect(prompt).toContain("Decide from the evidence actually shown, not from exhaustive hypotheticals")
      expect(prompt).toContain("keep the reason short (a few lines)")
      expect(prompt).toContain("do not enumerate every edge case")
    }
  })
})

describe("Evaluator — inherit the parent session's model", () => {
  const inheritConfig = (overrides: Record<string, unknown> = {}) =>
    resolveConfig({ evaluator: { model: "inherit", ...overrides } }, {}).evaluator

  test("uses the current session model for the independent second vote, not a pinned model", async () => {
    const models: unknown[] = []
    const { fake, calls } = deps({
      nativeVerdict: nativeMet(),
      sessionModel: async () => ({ providerID: "oc", id: "mimo-v2.6-flash-free" }),
      modelGenerate: async (model, _prompt) => {
        models.push(model)
        return verdictJson("met", "inherited judge says done")
      },
    })
    const evaluator = new Evaluator(fake, consensusInherit(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(models).toEqual([{ providerID: "oc", id: "mimo-v2.6-flash-free" }])
    expect(calls.context).toBe(1)
    expect(calls.session).toHaveLength(0)
  })

  test("resolves per generation — a mid-goal /model switch is followed on the next verdict", async () => {
    const models: unknown[] = []
    let active: { providerID: string; id: string; variant?: string } = { providerID: "oc", id: "first-model" }
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      sessionModel: async () => active,
      modelGenerate: async (model) => {
        models.push(model)
        return verdictJson("not_met", "keep working")
      },
    })
    const evaluator = new Evaluator(fake, consensusInherit(), COMMIT, silentLog)
    await evaluator.evaluate(request({ turn: 1 }))
    active = { providerID: "oc", id: "second-model", variant: "high" }
    await evaluator.evaluate(request({ turn: 2 }))
    expect(models).toEqual([
      { providerID: "oc", id: "first-model" },
      { providerID: "oc", id: "second-model", variant: "high" },
    ])
  })

  test("a missing session model fails consensus closed with a warning", async () => {
    const warnings: Array<Record<string, unknown>> = []
    const log = { ...silentLog, warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, ...fields }) }
    const { fake, calls } = deps({ nativeVerdict: nativeMet(), sessionModel: async () => undefined })
    const evaluator = new Evaluator(fake, consensusInherit(), COMMIT, log)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus")
    expect(result.reason).toContain("fail closed")
    expect(calls.session).toHaveLength(0)
    expect(calls.model).toHaveLength(0)
    expect(warnings.some((w) => String(w.message).includes("no active model"))).toBe(true)
  })

  test("a failing host port fails consensus closed with a warning", async () => {
    const warnings: Array<Record<string, unknown>> = []
    const log = { ...silentLog, warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, ...fields }) }
    const { fake, calls } = deps({
      nativeVerdict: nativeMet(),
      sessionModel: async () => {
        throw new Error("host unavailable")
      },
    })
    const evaluator = new Evaluator(fake, consensusInherit(), COMMIT, log)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("not_met")
    expect(result.reason).toContain("consensus")
    expect(calls.session).toHaveLength(0)
    expect(warnings.some((w) => String(w.message).includes("unavailable"))).toBe(true)
  })

  test("loop summary and next-goal generation inherit the same model", async () => {
    const models: unknown[] = []
    const { fake } = deps({
      sessionModel: async () => ({ providerID: "oc", id: "session-active" }),
      modelGenerate: async (model) => {
        models.push(model)
        return "a short inherited reply"
      },
    })
    const evaluator = new Evaluator(fake, inheritConfig(), COMMIT, silentLog)
    expect(await evaluator.summarize(summaryRequest(400))).toBe("a short inherited reply")
    expect(await evaluator.nextGoal(nextGoalRequest())).toBe("a short inherited reply")
    expect(models).toEqual([
      { providerID: "oc", id: "session-active" },
      { providerID: "oc", id: "session-active" },
    ])
  })

  test("a hung session-model lookup is bounded by the evaluator timeout", async () => {
    const warnings: Array<Record<string, unknown>> = []
    const log = { ...silentLog, warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, ...fields }) }
    const { fake, calls } = deps({
      nativeVerdict: nativeMet(),
      // Ignore the signal and never settle: a pathological host session lookup must not hang the goal.
      sessionModel: () => new Promise(() => {}),
    })
    const evaluator = new Evaluator(fake, { ...consensusInherit(), timeoutMs: 50 }, COMMIT, log)
    const started = Date.now()
    const outcome = await Promise.race([
      evaluator.evaluate(request()).then(
        (result) => result as { verdict: string },
        (error: unknown) => ({ verdict: `error: ${String(error)}` }),
      ),
      new Promise<{ verdict: string }>((resolve) => setTimeout(() => resolve({ verdict: "HUNG" }), 1_000)),
    ])
    expect(outcome.verdict).not.toBe("HUNG")
    expect(Date.now() - started).toBeLessThan(1_000)
    // Bounded resolution fails consensus closed instead of hard-failing or hanging the evaluation.
    expect(calls.session).toHaveLength(0)
    expect(warnings.some((w) => String(w.message).includes("unavailable"))).toBe(true)
  })

  test("pinned and session modes never consult the session-model port", async () => {
    let portCalls = 0
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      sessionModel: async () => {
        portCalls++
        return { providerID: "oc", id: "should-not-be-used" }
      },
    })
    const pinned = new Evaluator(fake, independentConfig(), COMMIT, silentLog)
    await pinned.evaluate(request())
    const session = new Evaluator(fake, sessionConfig(), COMMIT, silentLog)
    await session.evaluate(request())
    const inheritSession = new Evaluator(fake, inheritConfig({ mode: "session" }), COMMIT, silentLog)
    await inheritSession.evaluate(request())
    expect(portCalls).toBe(0)
  })

  test("inherit mode resolves the model once and generates on it — no second host lookup", async () => {
    let lookups = 0
    const models: unknown[] = []
    const prompts: string[] = []
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      sessionModel: async () => {
        lookups++
        return { providerID: "oc", id: "hy4-flash-free" }
      },
      modelGenerate: async (model, prompt) => {
        models.push(model)
        prompts.push(prompt)
        return verdictJson("met", "child judge says done")
      },
    })
    const evaluator = new Evaluator(fake, consensusInherit(), COMMIT, silentLog)
    const result = await evaluator.evaluate(request())
    expect(result.verdict).toBe("met")
    expect(lookups).toBe(1)
    expect(models).toEqual([{ providerID: "oc", id: "hy4-flash-free" }])
    expect(prompts[0]).toContain("all tests pass")
  })

  test("loop summary and next-goal use one inherited model lookup per generation", async () => {
    let lookups = 0
    const models: unknown[] = []
    const { fake } = deps({
      sessionModel: async () => {
        lookups++
        return { providerID: "oc", id: "session-active" }
      },
      modelGenerate: async (model) => {
        models.push(model)
        return "child judge reply"
      },
    })
    const evaluator = new Evaluator(fake, inheritConfig(), COMMIT, silentLog)
    expect(await evaluator.summarize(summaryRequest(400))).toBe("child judge reply")
    expect(await evaluator.nextGoal(nextGoalRequest())).toBe("child judge reply")
    expect(lookups).toBe(2)
    expect(models).toEqual([
      { providerID: "oc", id: "session-active" },
      { providerID: "oc", id: "session-active" },
    ])
  })

  test("a pinned independent second vote ignores the session-model port", async () => {
    let lookups = 0
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      sessionModel: async () => {
        lookups++
        return { providerID: "oc", id: "session-active" }
      },
      modelGenerate: async (model) => {
        expect(model).toEqual({ providerID: "provider", id: "model" })
        return verdictJson("met", "pinned child judge")
      },
    })
    const evaluator = new Evaluator(fake, resolveConfig({ model: "provider/model", evaluator: { mode: "independent", consensus: 2 } }, {}).evaluator, COMMIT, silentLog)
    await evaluator.evaluate(request())
    expect(lookups).toBe(0)
  })

  test("an inherited-model judge does not mark the parent session in-flight (the host tracks the child)", async () => {
    let release!: (text: string) => void
    const pending = new Promise<string>((resolve) => (release = resolve))
    let sawInflight: boolean | undefined
    let probe!: Evaluator
    const { fake } = deps({
      nativeVerdict: nativeMet(),
      sessionModel: async () => ({ providerID: "oc", id: "m" }),
      modelGenerate: async () => {
        sawInflight = probe.isEvaluating(SID)
        return pending
      },
    })
    probe = new Evaluator(fake, consensusInherit(), COMMIT, silentLog)
    const inflight = probe.evaluate(request())
    await new Promise((resolve) => setImmediate(resolve))
    expect(sawInflight).toBe(false)
    release(verdictJson("met"))
    await inflight
    expect(probe.isEvaluating(SID)).toBe(false)
  })

  test("inherit always generates the second vote through the model port — no legacy session-bound fallback", async () => {
    const models: unknown[] = []
    const { fake, calls } = deps({
      nativeVerdict: nativeMet(),
      sessionModel: async () => ({ providerID: "oc", id: "legacy-model" }),
      modelGenerate: async (model) => {
        models.push(model)
        return verdictJson("met")
      },
    })
    const evaluator = new Evaluator(fake, consensusInherit(), COMMIT, silentLog)
    expect((await evaluator.evaluate(request())).verdict).toBe("met")
    expect(models).toEqual([{ providerID: "oc", id: "legacy-model" }])
    expect(calls.session).toHaveLength(0)
  })
})
