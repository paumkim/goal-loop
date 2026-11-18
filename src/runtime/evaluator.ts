import type { GoalConfig } from "../core/config.ts"
import {
  evaluateIndependently,
  evaluateInSession,
  nextGoalIndependently,
  nextGoalInSession,
  REPAIR,
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
}

/** Harness-measured facts handed to the evaluator prompts; mirrors the (unexported) shape in core/prompts.ts. */
interface EvaluationFacts {
  readonly turn: number
  readonly elapsedMs: number
  readonly spend?: UsageSnapshot
}

export class EvaluationError extends Error {
  override readonly name = "EvaluationError"
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
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(this.config.timeoutMs)])
    const facts = { turn: request.turn, elapsedMs: request.elapsedMs, ...(request.spend ? { spend: request.spend } : {}) }
    const primary = await this.primary(request, facts, signal)
    if (this.config.consensus !== 2 || primary.result.verdict !== "met") return primary.result
    const secondPath = primary.via === "session" ? "independent" : "session"
    try {
      const second = secondPath === "session" ? await this.sessionVerdict(request, facts, signal) : await this.independentVerdict(request, facts, signal)
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

  /** The configured primary path: independent-with-session-fallback, or plain session. Reports which path actually judged. */
  private async primary(request: EvaluationRequest, facts: EvaluationFacts, signal: AbortSignal): Promise<{ result: EvaluationResult; via: "session" | "independent" }> {
    const model = this.config.model
    if (this.config.mode === "independent" && model) {
      try {
        return { result: await this.independentVerdict(request, facts, signal), via: "independent" }
      } catch (error) {
        if (signal.aborted) throw error
        this.log.warn("independent evaluator failed; falling back to session evaluator", { error: String(error) })
      }
    }
    return { result: await this.sessionVerdict(request, facts, signal), via: "session" }
  }

  private async independentVerdict(request: EvaluationRequest, facts: EvaluationFacts, signal: AbortSignal): Promise<EvaluationResult> {
    const model = this.config.model
    if (!model) throw new EvaluationError("independent model not configured; set evaluator.model")
    const messages = await this.deps.context(request.sessionID, signal)
    const transcript = renderTranscript(messages, { maxChars: this.config.maxTranscriptChars })
    const prompt = evaluateIndependently(request.condition, facts, transcript, this.commit)
    return this.ask((text) => this.deps.modelGenerate(model, text, signal), prompt)
  }

  private async sessionVerdict(request: EvaluationRequest, facts: EvaluationFacts, signal: AbortSignal): Promise<EvaluationResult> {
    const prompt = evaluateInSession(request.condition, facts, this.commit)
    this.inflight.set(request.sessionID, (this.inflight.get(request.sessionID) ?? 0) + 1)
    try {
      return await this.ask((text) => this.deps.sessionGenerate(request.sessionID, text, signal), prompt)
    } finally {
      const left = (this.inflight.get(request.sessionID) ?? 1) - 1
      if (left > 0) this.inflight.set(request.sessionID, left)
      else this.inflight.delete(request.sessionID)
    }
  }

  /** Loop step: compact one achieved iteration into a machine-consumable block. */
  async summarize(request: LoopSummaryRequest): Promise<string> {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(this.config.timeoutMs)])
    const model = this.config.model
    if (this.config.mode === "independent" && model) {
      try {
        const messages = await this.deps.context(request.sessionID, signal)
        const transcript = renderTranscript(messages, { maxChars: this.config.maxTranscriptChars })
        const text = await this.deps.modelGenerate(model, summarizeIndependently(request, transcript), signal)
        return this.cap(stripReasoningControl(text), request.maxSummaryTokens)
      } catch (error) {
        if (signal.aborted) throw error
        this.log.warn("independent summarizer failed; falling back to session summarizer", { error: String(error) })
      }
    }
    this.inflight.set(request.sessionID, (this.inflight.get(request.sessionID) ?? 0) + 1)
    try {
      const text = await this.deps.sessionGenerate(request.sessionID, summarizeInSession(request), signal)
      return this.cap(stripReasoningControl(text), request.maxSummaryTokens)
    } finally {
      const left = (this.inflight.get(request.sessionID) ?? 1) - 1
      if (left > 0) this.inflight.set(request.sessionID, left)
      else this.inflight.delete(request.sessionID)
    }
  }

  /** Loop step: generate the next condition (or LOOP_COMPLETE). Returns the raw reply, trimmed. */
  async nextGoal(request: NextGoalRequest): Promise<string> {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(this.config.timeoutMs)])
    const model = this.config.model
    if (this.config.mode === "independent" && model) {
      try {
        const text = await this.deps.modelGenerate(model, nextGoalIndependently(request), signal)
        return text.trim().slice(0, 4_000)
      } catch (error) {
        if (signal.aborted) throw error
        this.log.warn("independent next-goal generator failed; falling back to session generator", { error: String(error) })
      }
    }
    this.inflight.set(request.sessionID, (this.inflight.get(request.sessionID) ?? 0) + 1)
    try {
      const text = await this.deps.sessionGenerate(request.sessionID, nextGoalInSession(request), signal)
      return text.trim().slice(0, 4_000)
    } finally {
      const left = (this.inflight.get(request.sessionID) ?? 1) - 1
      if (left > 0) this.inflight.set(request.sessionID, left)
      else this.inflight.delete(request.sessionID)
    }
  }

  /** Hard budget per the documented formula: at most `max(200, tokens) * 4` characters, single trailing ellipsis when cut. */
  private cap(text: string, tokens: number): string {
    const limit = Math.max(200, tokens) * 4
    const flat = text.trim()
    return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
  }

  private async ask(generate: (prompt: string) => Promise<string>, prompt: string): Promise<EvaluationResult> {
    const first = await generate(prompt)
    const parsed = parseVerdict(first)
    if (parsed) return parsed
    // An empty answer usually means the model tried to call a tool; one stricter retry fixes most cases.
    const second = await generate(`${prompt}\n\n${REPAIR}`)
    const repaired = parseVerdict(second)
    if (repaired) return repaired
    throw new EvaluationError(`unreadable verdict: ${JSON.stringify((second || first).slice(0, 200))}`)
  }
}
