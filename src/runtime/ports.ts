/**
 * Narrow interfaces the controller depends on. The plugin entry adapts OpenCode's context to them;
 * tests substitute fakes. Nothing in here imports OpenCode, so the core stays host-agnostic.
 */
import type { GoalSnapshot, LoopEntry, Notice, UsageSnapshot, Verdict } from "../core/types.ts"

export type Delivery = "steer" | "queue"

export interface PromptAttachments {
  readonly files?: ReadonlyArray<unknown>
  readonly agents?: ReadonlyArray<unknown>
  readonly skills?: ReadonlyArray<unknown>
}

export interface SessionPort {
  prompt(input: { sessionID: string; text: string; delivery: Delivery } & PromptAttachments): Promise<void>
  synthetic(input: {
    sessionID: string
    text: string
    description?: string
    metadata?: Record<string, string | number | boolean>
    delivery?: Delivery
    resume?: boolean
  }): Promise<void>
  /** Cumulative session spend, or undefined when unavailable. */
  usage(sessionID: string): Promise<UsageSnapshot | undefined>
  /**
   * Ask the host to compact the session's context. `cold` installs an empty replay window so the next turn sees no
   * conversation at all; used only at a goal-loop version boundary, never for ordinary auto-compaction.
   */
  compact(sessionID: string, opts?: { cold?: boolean }): Promise<void>
}

export interface EvaluationRequest {
  /** The goal-owning parent session whose work is being judged. Descendants never spawn a verdict. */
  readonly sessionID: string
  readonly condition: string
  readonly turn: number
  readonly elapsedMs: number
  readonly spend?: UsageSnapshot
  /** The session's current commit rule; a session that moved directories may no longer match the setup rule. */
  readonly commit?: import("../core/types.ts").CommitPolicy
  readonly signal: AbortSignal
}

export interface EvaluationResult {
  readonly verdict: Verdict
  readonly reason: string
  /**
   * Set by the pre-verdict abstention gate (core/evaluation-gate.ts). Marks a defer, not a verdict: the judge
   * child was never spawned and the controller must settle no turn state for it. Genuine met/not_met results
   * omit this field and stay byte-for-byte unchanged.
   */
  readonly abstain?: import("../core/evaluation-gate.ts").EvaluationAbstention
}

export interface LoopSummaryRequest {
  readonly sessionID: string
  readonly objective: string
  readonly condition: string
  readonly reason: string
  readonly turn: number
  readonly elapsedMs: number
  readonly toolCalls: number
  readonly history: ReadonlyArray<LoopEntry>
  readonly maxSummaryTokens: number
  readonly signal: AbortSignal
}

export interface BacklogSuggestion {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly priority: number
  readonly impact: "low" | "medium" | "high"
  readonly risk: "low" | "medium" | "high"
  readonly finding: string
  readonly improvement: string
  readonly evidence: ReadonlyArray<string>
}

export interface NextGoalRequest {
  readonly sessionID: string
  readonly objective: string
  readonly history: ReadonlyArray<LoopEntry>
  readonly latestSummary: string
  readonly signal: AbortSignal
  /** Optional backlog hint from docs/improvement-backlog.json (de-duplicated). */
  readonly backlogSuggestion?: BacklogSuggestion
  /** Recent learning journal entries (formatted) to apply in next iteration planning. */
  readonly recentLearnings?: string
}

export interface EvaluatorPort {
  evaluate(request: EvaluationRequest): Promise<EvaluationResult>
  /** Loop step: compact one achieved iteration. Optional so fakes/older implementations stay valid. */
  summarize?(request: LoopSummaryRequest): Promise<string>
  /** Loop step: generate the next condition, or reply LOOP_COMPLETE. Raw text; callers validate. */
  nextGoal?(request: NextGoalRequest): Promise<string>
}

export interface BackgroundWork {
  readonly subagents: number
  readonly shells: number
}

export interface VerifyRequest {
  readonly command: string
  readonly cwd: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
}

export interface VerifyResult {
  /** Process exit code; null when the process could not be spawned or was killed. */
  readonly code: number | null
  readonly output: string
  /** True when the run hit `timeoutMs` and was killed. */
  readonly timedOut: boolean
}

/**
 * Runs the configured verification command (`evaluator.verifyCommand`) for real, on the machine the
 * plugin runs on, against the current checkout in `cwd`. Read-only with respect to plugin storage:
 * implementations must not touch goal records. Used to gate a `met` verdict.
 */
export interface VerifierPort {
  verify(request: VerifyRequest): Promise<VerifyResult>
}

export interface BackgroundPort {
  busy(sessionID: string): Promise<BackgroundWork>
  /** Ancestor session ids of `sessionID`, nearest first. Optional so legacy/fake ports stay valid. */
  ancestorsOf?(sessionID: string): Promise<readonly string[]>
}

export interface StoragePort {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  scan(options: { prefix: string; after?: string; limit?: number }): Promise<{
    readonly entries: ReadonlyArray<{ readonly key: string; readonly value: unknown }>
    readonly next?: string
  }>
}

export interface EmitterPort {
  changed(sessionID: string, goal: GoalSnapshot | null): void
  notice(notice: Notice): void
}

export interface Clock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
  error(message: string, extra?: Record<string, unknown>): void
}


export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms)
    // Never keep the host process alive just for a goal timer.
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}
