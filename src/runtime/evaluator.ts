import type { GoalConfig } from "../core/config.ts"
import {
  evaluateIndependently,
  evaluateInSession,
  nextGoalIndependently,
  nextGoalInSession,
  REPAIR,
  STRICT_REPAIR,
  summarizeIndependently,
  summarizeInSession,
} from "../core/prompts.ts"
import { renderTranscript } from "../core/transcript.ts"
import type { CommitPolicy, ModelRef, UsageSnapshot } from "../core/types.ts"
import { parseVerdict } from "../core/verdict.ts"
import type { EvaluationRequest, EvaluationResult, EvaluatorPort, Logger, LoopSummaryRequest, NextGoalRequest } from "./ports.ts"
import { truncate } from "../core/format.ts"
import { stripReasoningControl } from "../core/sanitize.ts"

interface EvaluatorDeps {
  /** Transient generation over the live session transcript; never persisted. */
  sessionGenerate(sessionID: string, prompt: string, signal: AbortSignal): Promise<string>
  /** Sessionless generation on a specific model. */
  modelGenerate(model: ModelRef, prompt: string, signal: AbortSignal): Promise<string>
  /** Current model-visible context of a session (post-compaction). */
  context(sessionID: string, signal: AbortSignal): Promise<readonly unknown[]>
  /**
   * Resolve the parent session's current active model from the host (`ctx.session.get(...).model`). Optional
   * so legacy callers/tests — which only use pinned or session mode — need not supply it. Used only when
   * `config.inheritModel` is true; resolution is per generation so a mid-goal model switch is followed.
   */
  sessionModel?(sessionID: string, signal: AbortSignal): Promise<ModelRef | undefined>
}

/** Harness-measured facts handed to the evaluator prompts; mirrors the (unexported) shape in core/prompts.ts. */
interface EvaluationFacts {
  readonly turn: number
  readonly elapsedMs: number
  readonly spend?: UsageSnapshot
}

export class EvaluationError extends Error {
  override readonly name: string = "EvaluationError"
}

/**
 * One generation outlived its per-attempt budget, or the SDK ignored the abort signal. Named so the
 * controller's retry notice reads "evaluator timed out after Ns" instead of a bare unreadable verdict,
 * and so a slow link retries with bounded backoff rather than hanging or failing as a parse error.
 */
export class EvaluationTimeoutError extends EvaluationError {
  override readonly name = "EvaluationTimeoutError"
}

/**
 * Judges a goal condition after each turn.
 *
 * `session` mode appends one question to the session's own transcript through `session.generate`: the provider
 * reuses the cached prefix, so evaluation costs roughly the question plus a short answer, with full-fidelity
 * evidence. `independent` mode sends a newest-first transcript digest to a separate (typically small, fast) model,
 * so completion is judged by a model other than the one doing the work. Independent failures fall back to session
 * mode once.
 */
export class Evaluator implements EvaluatorPort {
  private readonly inflight = new Map<string, number>()

  constructor(
    private readonly deps: EvaluatorDeps,
    private readonly config: GoalConfig["evaluator"],
    private readonly commit: CommitPolicy,
    private readonly log: Logger,
  ) {}

  /** True while this plugin has a `session.generate` evaluation in flight for the session. */
  isEvaluating(sessionID: string) {
    return (this.inflight.get(sessionID) ?? 0) > 0
  }

  /**
   * Judge a turn. In `consensus: 2` mode a `met` from the primary judge is not accepted until the *other* judge
   * (session evaluator <-> independent model) also rules `met`. Any disagreement — or a dead second judge — fails
   * closed to `not_met` with the disagreement named in the reason string. Opt-in per repo/loop; never a default.
   */
  async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
    // Each generation runs under its own per-attempt budget (see `underBudget`): one shared
    // `AbortSignal.timeout` across the escalating attempts starved the later ones on a slow link,
    // and a bare timeout with no app-level race hung forever when the SDK ignored the signal.
    const signal = request.signal
    const facts = { turn: request.turn, elapsedMs: request.elapsedMs, ...(request.spend ? { spend: request.spend } : {}) }
    const primary = await this.primary(request, facts, signal)
    if (this.config.consensus !== 2 || primary.result.verdict !== "met") return primary.result
    const secondPath = primary.via === "session" ? "independent" : "session"
    try {
      const second = secondPath === "session"
        ? await this.sessionVerdict(request, facts, signal)
        : await (async () => {
          const model = await this.resolveModel(request.sessionID, signal)
          if (!model) throw new EvaluationError("independent model not available for consensus; pin evaluator.model or use the inherit sentinel")
          return this.independentVerdict(request, facts, signal, model)
        })()
      if (second.verdict === "met") return primary.result
      return {
        verdict: "not_met",
        reason: `consensus disagreement: ${primary.via} evaluator ruled met; ${secondPath} evaluator ruled ${second.verdict}${second.reason ? ` (${second.reason})` : ""}; fail closed — met rejected`,
      }
    } catch (error) {
      if (signal.aborted) throw error
      return { verdict: "not_met", reason: `consensus: ${secondPath} evaluator failed (${truncate(String(error instanceof Error ? error.message : error), 120)}); fail closed — met rejected` }
    }
  }

  /**
   * Model for a stateless judge generation: the pinned `model` when configured, otherwise — when the `inherit`
   * sentinel is set — the parent session's current model. Called per generation so a mid-goal `/model` switch
   * is followed on the very next verdict. A missing or failing host port degrades to `undefined`, which routes
   * the caller to the session evaluator; the inherit path itself never hard-fails the evaluation.
   */
  private async resolveModel(sessionID: string, signal: AbortSignal): Promise<ModelRef | undefined> {
    const pinned = this.config.model
    if (pinned) return pinned
    const port = this.deps.sessionModel
    if (!this.config.inheritModel || !port) return undefined
    try {
      // The host lookup is bounded by the same budget as the generation it precedes: an inherited model
      // must never hang the evaluation with no timeout and no diagnostic (the catch below degrades instead).
      const current = await this.underBudget((s) => port(sessionID, s), signal, "model resolution")
      if (!current) this.log.warn("inherited evaluator model: parent session has no active model; using session evaluator")
      return current
    } catch (error) {
      if (signal.aborted) throw error
      this.log.warn("inherited evaluator model unavailable; using session evaluator", { error: String(error) })
      return undefined
    }
  }

  /** The configured primary path: independent-with-session-fallback, or plain session. Reports which path actually judged. */
  private async primary(request: EvaluationRequest, facts: EvaluationFacts, signal: AbortSignal): Promise<{ result: EvaluationResult; via: "session" | "independent" }> {
    const model = this.config.mode === "independent" ? await this.resolveModel(request.sessionID, signal) : undefined
    if (this.config.mode === "independent" && model) {
      try {
        return { result: await this.independentVerdict(request, facts, signal, model), via: "independent" }
      } catch (error) {
        if (signal.aborted) throw error
        this.log.warn("independent evaluator failed; falling back to session evaluator", { error: String(error) })
      }
    }
    return { result: await this.sessionVerdict(request, facts, signal), via: "session" }
  }

  private async independentVerdict(request: EvaluationRequest, facts: EvaluationFacts, signal: AbortSignal, model: ModelRef): Promise<EvaluationResult> {
    const messages = await this.underBudget((s) => this.deps.context(request.sessionID, s), signal, "transcript read")
    const transcript = renderTranscript(messages, { maxChars: this.config.maxTranscriptChars })
    const prompt = evaluateIndependently(request.condition, facts, transcript, request.commit ?? this.commit)
    return this.ask((text, s) => this.deps.modelGenerate(model, text, s), prompt, signal)
  }

  /** Track a session's in-flight generative work so maxTokens throttling can see contention. */
  private async trackInflight<T>(sessionID: string, run: () => Promise<T>): Promise<T> {
    this.inflight.set(sessionID, (this.inflight.get(sessionID) ?? 0) + 1)
    try {
      return await run()
    } finally {
      const left = (this.inflight.get(sessionID) ?? 1) - 1
      if (left > 0) this.inflight.set(sessionID, left)
      else this.inflight.delete(sessionID)
    }
  }

  private async sessionVerdict(request: EvaluationRequest, facts: EvaluationFacts, signal: AbortSignal): Promise<EvaluationResult> {
    const prompt = evaluateInSession(request.condition, facts, request.commit ?? this.commit)
    return this.trackInflight(request.sessionID, () => this.ask((text, s) => this.deps.sessionGenerate(request.sessionID, text, s), prompt, signal))
  }

  /** Loop step: compact one achieved iteration into a machine-consumable block. */
  async summarize(request: LoopSummaryRequest): Promise<string> {
    const signal = request.signal
    const model = this.config.mode === "independent" ? await this.resolveModel(request.sessionID, signal) : undefined
    if (this.config.mode === "independent" && model) {
      try {
        const messages = await this.underBudget((s) => this.deps.context(request.sessionID, s), signal, "transcript read")
        const transcript = renderTranscript(messages, { maxChars: this.config.maxTranscriptChars })
        const text = await this.underBudget((s) => this.deps.modelGenerate(model, summarizeIndependently(request, transcript), s), signal, "summary")
        return this.cap(stripReasoningControl(text), request.maxSummaryTokens)
      } catch (error) {
        if (signal.aborted) throw error
        this.log.warn("independent summarizer failed; falling back to session summarizer", { error: String(error) })
      }
    }
    return this.trackInflight(request.sessionID, async () => {
      const text = await this.underBudget((s) => this.deps.sessionGenerate(request.sessionID, summarizeInSession(request), s), signal, "summary")
      return this.cap(stripReasoningControl(text), request.maxSummaryTokens)
    })
  }

  /** Loop step: generate the next condition (or LOOP_COMPLETE). Returns the raw reply, trimmed. */
  async nextGoal(request: NextGoalRequest): Promise<string> {
    const signal = request.signal
    const model = this.config.mode === "independent" ? await this.resolveModel(request.sessionID, signal) : undefined
    if (this.config.mode === "independent" && model) {
      try {
        const text = await this.underBudget((s) => this.deps.modelGenerate(model, nextGoalIndependently(request), s), signal, "next-condition")
        return text.trim().slice(0, 4_000)
      } catch (error) {
        if (signal.aborted) throw error
        this.log.warn("independent next-goal generator failed; falling back to session generator", { error: String(error) })
      }
    }
    return this.trackInflight(request.sessionID, async () => {
      const text = await this.underBudget((s) => this.deps.sessionGenerate(request.sessionID, nextGoalInSession(request), s), signal, "next-condition")
      return text.trim().slice(0, 4_000)
    })
  }

  /** Hard budget per the documented formula: at most `max(200, tokens) * 4` characters, single trailing ellipsis when cut. */
  private cap(text: string, tokens: number): string {
    const limit = Math.max(200, tokens) * 4
    const flat = text.trim()
    return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
  }

  /**
   * Runs one generation under its own abort budget, and — because the SDK cannot be trusted to honour the
   * signal on a slow response — races it against the budget so the evaluator always converges. Escalating
   * attempts each get a fresh budget instead of sharing one, so a slow first attempt cannot starve, hang, or
   * empty-out the repair attempts. An abort caused by the budget is re-labelled a named
   * `EvaluationTimeoutError`; an abort caused by the caller (user interrupt / session change) propagates.
   */
  private async underBudget<T>(run: (signal: AbortSignal) => Promise<T>, caller: AbortSignal, scope: string): Promise<T> {
    const timeoutMs = this.config.timeoutMs
    const describe = () => `evaluator timed out after ${Math.round(timeoutMs / 1_000)}s (${scope})`
    if (caller.aborted) throw new EvaluationError(`evaluation aborted before the ${scope} completed`)
    const budget = AbortSignal.timeout(timeoutMs)
    const signal = AbortSignal.any([caller, budget])
    return await new Promise<T>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", onAbort)
        fn()
      }
      const onAbort = () => {
        if (caller.aborted) settle(() => reject(new EvaluationError(`evaluation aborted during the ${scope}`)))
        else settle(() => reject(new EvaluationTimeoutError(describe())))
      }
      signal.addEventListener("abort", onAbort)
      run(signal).then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => {
          // A rejection that lands at/after the budget fired is the timeout, whatever shape the SDK throws
          // (an AbortError, or an empty-text resolution turned into an error upstream). Name it as one.
          if (budget.aborted && !caller.aborted) reject(new EvaluationTimeoutError(describe()))
          else reject(error)
        }),
      )
    })
  }

  private async ask(generate: (prompt: string, signal: AbortSignal) => Promise<string>, prompt: string, caller: AbortSignal): Promise<EvaluationResult> {
    // Escalating retries: the second generation repeats the prompt plus REPAIR; the third adds
    // STRICT_REPAIR, which forbids tools and other text. An empty answer usually means the model
    // tried to call a tool, so the strict retry is the usual fix. Each attempt gets its own budget.
    const attempts = [prompt, `${prompt}\n\n${REPAIR}`, `${prompt}\n\n${STRICT_REPAIR}`]
    let text = ""
    for (const [index, next] of attempts.entries()) {
      text = await this.underBudget((signal) => generate(next, signal), caller, `attempt ${index + 1}/${attempts.length}`)
      const parsed = parseVerdict(text)
      if (parsed) return parsed
      // Never fail silently: every unreadable reply (especially an empty one) is recorded with its raw text so the
      // operator can see whether the judge emitted a tool call / reasoning with no text, garbage, or a truncated
      // verdict. The host strips tools from evaluator generations (see src/index.ts · generate hook); a bare "" here
      // means the provider still produced no text and is a provider/quirk to investigate, not a retry to hide.
      this.log.warn("evaluator reply unreadable; escalating", {
        attempt: index + 1,
        of: attempts.length,
        chars: text.length,
        preview: truncate(text, 200),
      })
      // An empty (or unreadable) reply escalates; only a genuine timeout/abort leaves this loop early.
    }
    throw new EvaluationError(
      `unreadable verdict after ${attempts.length} attempts: ${JSON.stringify(text.slice(0, 200))} (no text event in the judge reply — usually a tool call or reasoning-only response; evaluator requests are sent toolless)`,
    )
  }
}
