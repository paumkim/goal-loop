import { BOUNDARY_DROP_FACTOR, BOUNDARY_LANDING_GRACE_MS, BOUNDARY_MIN_TOKENS, COMPACT_COOLDOWN_MS } from "../core/constants.ts"
import type { GoalConfig } from "../core/config.ts"
import { classifyFailure, errorMessage, isNotFoundError } from "../core/errors.ts"
import { diffUsage, formatDuration, formatStatus, outcomeStory, statusLabel, stripControls, truncate } from "../core/format.ts"
import { parseGoalCommand } from "../core/parse.ts"
import * as Prompt from "../core/prompts.ts"
import {
  EMPTY_USAGE,
  isLive,
  type CommitPolicy,
  type FailureInfo,
  type GoalRecord,
  type GoalSnapshot,
  type GoalStatus,
  type LoopEntry,
  COMPACT_MISS_CAP,
  type LoopCompactState,
  type Notice,
  type NoticeKind,
  type NoticeLevel, type PauseCause, // may not become its own line: docs cite controller.ts:68 for the epoch field
  type UsageSnapshot,
} from "../core/types.ts"
import type { BackgroundPort, BackgroundWork, Clock, Delivery, EmitterPort, EvaluationResult, EvaluatorPort, Logger, PromptAttachments, SessionPort, VerifierPort } from "./ports.ts"
import type { BoundaryCompactResult } from "./compactor.ts"
import { findRepository, headSha } from "../core/git.ts"; import { sameDirectory, type GoalStore } from "./store.ts"

/**
 * Minimum gap between two re-anchors armed for the same session. A compaction can land for several
 * reasons at once (host auto-compact, a boundary request, a restart restore); each used to push its own
 * re-anchor line and the "goal-loop · re-anchor after compaction" entries stacked up in the transcript.
 * One re-anchor carries the same ground truth for all of them.
 */
// Re-anchor coalescing shares the compaction cooldown window (same "don't hammer the host" budget).
const REANCHOR_MIN_INTERVAL_MS = COMPACT_COOLDOWN_MS
// Conditions that name production of a thing: tests/files/merges/commits/artifacts. Used by the zero-tool
// met-rejection in evaluate(); "all tests pass" included — met with zero tool use is never accepted for these.
const PRODUCING_CONDITION = /\b(tests?|files?|merge|merged|commit|create|created|implement|write|fix|build|refactor)\b/i
// Consecutive measurable arms without a landing at which the plugin emits the one host-unwilling warning (2).
// Past that, re-requests drop to a trickle (every 3rd arm) and COMPACT_MISS_CAP stays as a backstop final warning.
// Applies to armed loops only; plain goals never request boundary compaction at all.
const COMPACT_MISS_RETRY = 2

interface ControllerDeps {
  readonly config: GoalConfig
  readonly directory: string
  /** The commit rule that applies to this session's directory. */
  readonly commit: CommitPolicy
  readonly session: SessionPort
  readonly evaluator: EvaluatorPort
  readonly background: BackgroundPort
  readonly store: GoalStore
  readonly emitter: EmitterPort
  /** Optional harness-side verifier for `evaluator.verifyCommand`. Required only when the command is configured; a `met` verdict is downgraded to `not_met` without one (fail closed). */
  readonly verifier?: VerifierPort
  /**
   * Asks the host to compact the session at a loop-iteration boundary so the next iteration arms with a fresh
   * context. Optional so tests/probes can omit it; awaiting only waits for the host's acceptance of the request.
   * `force` skips the cooldown (never the in-flight/busy gate): used to re-request a compaction that never landed.
   */
  readonly compactAtBoundary?: (sessionID: string, opts?: { force?: boolean }) => Promise<BoundaryCompactResult>
  /** Estimated model-visible context size in tokens, or undefined when unknown. Used to detect a landed boundary compaction. */
  readonly estimateContext?: (sessionID: string) => Promise<number | undefined>
  readonly clock: Clock
  readonly log: Logger
  readonly newId?: () => string
}

/** Volatile per-session state that never needs persisting. */
interface Runtime {
  /** Bumped by anything that invalidates in-flight async work (new turn, prompt, clear, replace). */
  epoch: number
  toolCalls: number
  /** Tool calls accumulated across the whole current loop iteration (resets when the iteration is armed). */
  iterationToolCalls: number
  /** Tool calls from turns whose evaluation was deferred by background work. */
  carriedToolCalls: number
  evaluating: boolean
  /** Set when a synthetic steer was dispatched (continuation, retry, check-in, loop arm): the next execution's succeeded event evaluates; any succeeded delivered before the next started is a straggler and is ignored. */
  awaitingExecution: boolean
  /** Set when this iteration deferred an evaluation because background work was running: background work is real work for the zero-tool not-progress guard. */
  iterationDeferred: boolean
  abort?: AbortController
  timer?: unknown
  deferredSince?: number
  lastCheckinAt?: number
  /** Backoff counter for retrying a failed loop-planner step. */
  loopRetries?: number
  /** One-shot notice flags for caps an armed loop runs past without pausing (never re-fired; anti-stacking). */
  capNotified?: boolean
  stallNotified?: boolean
  /** One-shot: the "paused at turn cap" courtesy warning already fired for this freeze. */
  capFreezeNotified?: boolean
  /** Cumulative usage snapshot captured when the current loop iteration was armed (arm / advance). Runtime-local like iterationToolCalls; a restored runtime drops it, so the next recorded iteration carries no spend — never estimated. */
  armUsage?: UsageSnapshot
  /** Cumulative usage reading from the previous evaluation turn (arm-time reading seeds it). Runtime-local like armUsage; a restored runtime drops it, so the first recorded verdict after a restore carries no turn spend — never estimated. */
  turnUsage?: UsageSnapshot
}

const HISTORY = 20
const RETRY_BASE_MS = 15_000
const RETRY_MAX_MS = 5 * 60_000
const REEVALUATE_BASE_MS = 10_000
/**
 * Exponential backoff with a cap. Two growth curves, intentionally different: evaluator retries use
 * `REEVALUATE_BASE_MS × 3ⁿ` (10s → 30s → 90s; evaluator failures are usually transient and cheap to retry),
 * planner/continue retries use `RETRY_BASE_MS × 4ⁿ` (15s → 60s → 240s; a failing planner or dispatch
 * burns a full model round-trip, so back off harder). Both are capped at RETRY_MAX_MS.
 */
const backoffMs = (base: number, growth: number, exponent: number) => Math.min(base * growth ** exponent, RETRY_MAX_MS)
/** Fixed backoff for rate/usage-limit-class failures; these windows clear on their own. */
const PAUSE_RETRY_MS = 15 * 60_000
/** Backoff for a failed synthetic-continue dispatch. */
const CONTINUE_RETRY_MS = 60_000
/** Token sets of a normalized string, deduplicated; input must already be normalized (lowercase, one space per separator run). */
const tokensOf = (normalized: string): Set<string> => new Set(normalized.split(" ").filter(Boolean))
/**
 * Near-duplicate test between two normalized token sets: containment (|A ∩ B| / min(|A|, |B|)) >= 0.7
 * or Jaccard >= 0.6. Empty token sets never match. Only meaningful for the loop planner gate, where the
 * history is bounded (HISTORY <= 20), so the O(n) scan over the completed set stays trivial.
 */
const isNearDuplicate = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size === 0 || b.size === 0) return false
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  const containment = intersection / Math.min(a.size, b.size)
  const union = a.size + b.size - intersection
  const jaccard = union === 0 ? 0 : intersection / union
  return containment >= 0.7 || jaccard >= 0.6
}

type InterruptReason = "user" | "shutdown" | "superseded" | "inactivity" | (string & {})

/**
 * The /goal state machine. Event-driven, one record per session:
 *
 *   set -> active --turn ends--> evaluate --not_met--> continue (synthetic turn) --> ...
 *                                         --met/impossible--> terminal
 *   active --interrupt | explicit opt-in cap (maxTurns/stallTurns)--> paused --user prompt--> active
 *   active --fatal provider error--> failed       any --clear--> cleared
 *   retryable failures are retried forever with capped backoff; the loop never pauses on its own.
 *
 * Async work is guarded by an epoch per session: whenever the world moves on (a new execution starts, the user
 * prompts, the goal is cleared or replaced), stale evaluations and timers drop their results instead of racing.
 */
export class GoalController {
  private readonly goals = new Map<string, GoalRecord>()
  private readonly runtimes = new Map<string, Runtime>()
  private readonly running = new Set<string>()
  private readonly newId: () => string
  /** sessionID -> serialized record as of the last store write; lets commit() skip no-op saves and emissions. */
  private readonly lastCommit = new Map<string, string>()
  private readonly lastReanchorAt = new Map<string, number>()
  private disposed = false

  constructor(private readonly deps: ControllerDeps) {
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  // ---------------------------------------------------------------- queries

  get(sessionID: string): GoalRecord | undefined {
    return this.goals.get(sessionID)
  }

  /** The active or paused goal, if any. */
  live(sessionID: string): GoalRecord | undefined {
    const record = this.goals.get(sessionID)
    return record && isLive(record.status) ? record : undefined
  }

  activeCondition(sessionID: string): string | undefined {
    const record = this.goals.get(sessionID)
    return record?.status === "active" ? record.condition : undefined
  }

  snapshot(sessionID: string, spend?: UsageSnapshot, contextSize?: number): GoalSnapshot | null {
    const record = this.goals.get(sessionID)
    if (!record) return null
    const runtime = this.runtimes.get(sessionID)
    // The auto-compact threshold is constant per session, so it rides every snapshot — cheap, and it lets
    // the dialog render the context meter without knowing anything about the server's configuration.
    const compactAtTokens = this.deps.config.compactAtTokens
    return {
      ...structuredClone(record),
      elapsedMs: (record.endedAt ?? this.deps.clock.now()) - record.startedAt,
      evaluating: runtime?.evaluating ?? false,
      waiting: runtime?.deferredSince !== undefined,
      ...(spend ? { spend } : {}),
      ...(typeof compactAtTokens === "number" && compactAtTokens > 0 ? { compactAtTokens } : {}),
      ...(contextSize !== undefined && Number.isFinite(contextSize) && contextSize >= 0 ? { contextSize } : {}),
    }
  }

  list(): GoalSnapshot[] {
    return [...this.goals.keys()].map((id) => this.snapshot(id)).filter((s): s is GoalSnapshot => s !== null)
  }

  /** True while a turn is executing for the session. Used to defer mid-work compaction. */
  isExecuting(sessionID: string): boolean {
    return this.running.has(sessionID)
  }

  /**
   * Shared drop heuristic: true when the estimated context has dropped at least 10% from what it was when the
   * boundary request was made (or below an absolute floor when no estimate was recorded). An unknown/unestimable
   * size is not a drop. Used by the arm-time settle; the ended event is authoritative and needs no estimate.
   * Heuristic, not proof: a landed compaction whose context restores large history is invisible to this test,
   * which is why the ended-event path is preferred.
   */
  private contextDropped(pending: LoopCompactState, size: number | undefined): boolean {
    return size !== undefined && (pending.estimatedTokens === undefined ? size < BOUNDARY_MIN_TOKENS : size <= Math.max(BOUNDARY_MIN_TOKENS, Math.floor(pending.estimatedTokens * BOUNDARY_DROP_FACTOR)))
  }

  /** Reset a pending boundary request to its just-landed form: bookkeeping cleared, misses reset, fresh requests re-enabled. */
  private landPending(record: GoalRecord, pending: LoopCompactState): void {
    record.loopCompact = {
      ...pending,
      landedAt: this.deps.clock.now(),
      misses: 0,
      unmeasurableTicks: undefined,
      stalenessUnknown: undefined,
      unwillingWarned: undefined,
    }
  }

  /**
   * The host reported a compaction ended for the session. An ended event is authoritative — it means the host
   * compacted, so any pending boundary-compaction request is recorded as landed (misses reset, fresh requests
   * re-enabled, one success notice), regardless of what the size estimate says. The landing also re-anchors
   * a live loop immediately: the re-stated ground truth rides the SYSTEM part of the next model request
   * (one-shot injection via the `context` hook), never the transcript. A landing is never silent. Plain
   * goals are re-anchored nowhere: they carry no loop ground truth to restore, and plain (non-loop) records
   * never arm boundary requests at all.
   */
  async onCompactionLanded(sessionID: string): Promise<void> {
    const record = this.goals.get(sessionID)
    const pending = record?.loopCompact
    if (record && pending && !pending.landedAt) {
      this.landPending(record, pending)
      try {
        await this.commit(record)
      } catch (error) {
        this.deps.log.warn("compaction-landed record failed to persist", { sessionID, error: errorMessage(error) })
      }
      this.deps.log.info("compaction landed via the compaction-ended event", { sessionID })
      this.notify(sessionID, "compact", "success", "Compaction landed", "The host compacted the session (compaction-ended event); loop boundary state reset.")
    }
    // The await above can span a `session.deleted` event: the record would have been removed from the
    // map and storage, and re-anchoring now would re-create it. Only continue for the adopted record.
    if (this.goals.get(sessionID) !== record) return
    // A landed compaction replaces history with a lossy summary; a live loop re-states its ground truth
    // so the armed condition, the objective and the completed iterations survive the cut. Queued
    // (resume: false): never wakes the session, never interrupts an in-flight turn — the arm/continuation
    // steers that keep the loop moving carry it into the model's view.
    if (record && record.loopEnabled && record.status === "active") this.reanchor(record)
  }

  /** Final-usage snapshots in flight; dispose() awaits them so the last record write is durable before flush. */
  private readonly pendingUsage = new Set<Promise<void>>()

  /** Re-anchor texts awaiting the next model request; one-shot, volatile (a restart drops a pending one — the next landing re-arms it). */
  private readonly pendingAnchors = new Map<string, string>()

  /**
   * The re-anchor the host never sees as a message: after a landed compaction the ground truth is
   * one-shot-injected into the SYSTEM part on the next model request (via the `context` hook in the
   * plugin's wiring), so the transcript stays clean and the model still gets the full re-statement.
   * Consumed on read — the text fires exactly once. Volatile by design.
   */
  consumeAnchor(sessionID: string): string | undefined {
    const text = this.pendingAnchors.get(sessionID)
    if (text !== undefined) this.pendingAnchors.delete(sessionID)
    return text
  }

  /** Arm the post-compaction ground-truth re-anchor; fire-and-forget like `note()`. Coalesced: at most one per session per {@link REANCHOR_MIN_INTERVAL_MS}. */
  private reanchor(record: GoalRecord) {
    // Never arm (or commit) for a record that is no longer the adopted one — deleted mid-flight above.
    if (this.goals.get(record.sessionID) !== record) return
    const now = this.deps.clock.now()
    const last = this.lastReanchorAt.get(record.sessionID)
    if (last !== undefined && now - last < REANCHOR_MIN_INTERVAL_MS) {
      this.deps.log.info("loop re-anchor coalesced: one was armed recently", { sessionID: record.sessionID })
      return
    }
    this.lastReanchorAt.set(record.sessionID, now)
    this.pendingAnchors.set(
      record.sessionID,
      Prompt.loopReanchor({
        iteration: record.loopIteration ?? 1,
        maxLoops: record.loopMaxLoops ?? this.deps.config.maxLoops,
        objective: record.loopObjective ?? record.condition,
        condition: record.condition,
        history: record.loopHistory ?? [],
      }),
    )
    // The card counts these; the transcript does not. One quiet number instead of one notice per landing.
    record.reanchorCount = (record.reanchorCount ?? 0) + 1
    void this.commit(record).catch((error) => this.deps.log.warn("re-anchor record update failed", { sessionID: record.sessionID, error: errorMessage(error) }))
  }

  async spend(sessionID: string): Promise<UsageSnapshot | undefined> {
    const record = this.goals.get(sessionID)
    if (!record) return undefined
    if (record.final) return diffUsage(record.final, record.baseline)
    const usage = await this.deps.session.usage(sessionID).catch(() => undefined)
    return usage && diffUsage(usage, record.baseline)
  }

  /** Absolute estimated prompt tokens; undefined when unestimable. Pure passthrough — never estimated on the hot path. */
  async contextSize(sessionID: string): Promise<number | undefined> {
    if (!this.goals.has(sessionID)) return undefined
    if (!this.deps.estimateContext) return undefined
    const size = await this.deps.estimateContext(sessionID).catch(() => undefined)
    return size !== undefined && Number.isFinite(size) && size >= 0 ? size : undefined
  }

  // ---------------------------------------------------------------- commands

  /** Entry point for `/goal <args>` and `/goal-loop <args>`. */
  async command(input: { sessionID: string; text: string; delivery: Delivery; loop?: boolean } & PromptAttachments): Promise<void> {
    const parsed = parseGoalCommand(input.text, this.deps.config.maxConditionChars)
    switch (parsed.type) {
      case "status":
        return this.status(input.sessionID)
      case "clear":
        this.clear(input.sessionID)
        return
      case "invalid":
        this.notify(input.sessionID, "error", "error", `${input.loop ? "Loop" : "Goal"} not set`, parsed.message)
        return
      case "set":
        return this.set({ ...input, condition: parsed.condition, ...(input.loop ? { loop: true } : {}) })
    }
  }

  /**
   * Create, persist and announce a goal/loop record. Shared by the command path (`set()`, which then asks the host
   * to admit a synthetic directive message) and the prompt-hook path (`armFromPrompt()`, where the host admits the
   * user's own directive-carrying prompt as the kickoff, so no synthetic message is sent). Returns the record.
   */
  private async arm(input: { sessionID: string; condition: string; loop: boolean; maxLoops?: number }): Promise<GoalRecord> {
    const { sessionID, condition } = input
    const previous = this.live(sessionID)
    if (previous) this.finish(previous, "cleared", "Replaced by a new goal.")
    const now = this.deps.clock.now()
    const measured = await this.deps.session.usage(sessionID).catch(() => undefined)
    const baseline = measured ?? EMPTY_USAGE
    const loop = input.loop
    // Per-run override only: this never touches config.maxLoops, so a later /goal-loop-<N> applies to that run alone.
    const maxLoops = input.maxLoops ?? this.deps.config.maxLoops
    const record: GoalRecord = {
      version: 1,
      id: this.newId(),
      sessionID,
      directory: this.deps.directory,
      condition,
      status: "active",
      setAt: now,
      startedAt: now,
      turns: 0,
      stall: 0,
      retries: 0,
      checkins: 0,
      baseline,
      history: [],
      ...(loop
        ? { loopEnabled: true, loopIteration: 1, loopObjective: condition, loopMaxLoops: maxLoops, loopHistory: [], loopNotProgress: 0 }
        : {}),
    }
    this.goals.set(sessionID, record)
    this.reset(sessionID)
    const armRuntime = this.runtimes.get(sessionID)
    if (armRuntime && measured) {
      if (loop) armRuntime.armUsage = measured
      armRuntime.turnUsage = measured
    }
    // Await the initial write: a crash between arm() returning and the record landing would silently un-set the goal.
    await this.commit(record)
    const loopLabel = loop ? "Loop" : "Goal"
    const detail = loop ? `iteration="1" max="${maxLoops}" · ${condition}` : condition
    this.notify(sessionID, "set", "info", previous ? `${loopLabel} replaced` : `${loopLabel} set`, detail)
    return record
  }

  async set(input: { sessionID: string; condition: string; delivery: Delivery; loop?: boolean; maxLoops?: number } & PromptAttachments): Promise<void> {
    const { sessionID, condition } = input
    const loop = input.loop === true
    const maxLoops = input.maxLoops ?? this.deps.config.maxLoops
    const record = await this.arm({ sessionID, condition, loop, ...(input.maxLoops !== undefined ? { maxLoops: input.maxLoops } : {}) })
    const loopLabel = loop ? "Loop" : "Goal"
    try {
      await this.deps.session.prompt({
        sessionID,
        text: Prompt.directive(
          condition,
          this.deps.commit,
          loop ? { iteration: 1, maxLoops, objective: condition, history: [] } : undefined,
        ),
        delivery: input.delivery,
        ...(input.files?.length ? { files: input.files } : {}),
        ...(input.agents?.length ? { agents: input.agents } : {}),
        ...(input.skills?.length ? { skills: input.skills } : {}),
      })
    } catch (error) {
      if (this.goals.get(sessionID) === record) this.finish(record, "failed", `Could not start the ${loopLabel.toLowerCase()}: ${errorMessage(error)}`)
      throw error
    }
  }

  /** User-visible notice for a present-but-invalid loop count suffix. Stated, never guessed; the default applies. */
  noteInvalidLoopCount(sessionID: string, invalidCount: string): void {
    const shown = sanitizeCountEcho(invalidCount)
    const reason =
      shown === "" ? "nothing was provided after `/goal-loop-` or `/goal-loop=`" : `"${shown}" is not a valid loop count (an integer from 1 to 1000)`
    this.notify(sessionID, "set", "warning", "Loop count ignored", `${reason}; using the default limit of ${this.deps.config.maxLoops}.`)
  }

  /** Report an objective that exceeds the configured condition limit. Called before the directive is rewritten; nothing is armed and the prompt is left untouched. */
  noteConditionTooLong(sessionID: string, length: number, limit: number): void {
    this.notify(sessionID, "error", "error", "Loop not set", `Goal condition is ${length} characters; the limit is ${limit}.`)
  }

  /**
   * Arm a loop from a raw user prompt that carried the `/goal-loop[-N|=N]` directive (the unknown-slash-command
   * path). The host admits the rewritten prompt as the kickoff message, so unlike `set()` this does not ask the host
   * to send a synthetic directive — it only creates the record. `maxLoops` is a per-run cap; config.maxLoops is untouched.
   */
  async armFromPrompt(input: { sessionID: string; condition: string; maxLoops?: number; invalidCount?: string }): Promise<GoalRecord> {
    if (input.invalidCount !== undefined) this.noteInvalidLoopCount(input.sessionID, input.invalidCount)
    return this.arm({ sessionID: input.sessionID, condition: input.condition, loop: true, ...(input.maxLoops !== undefined ? { maxLoops: input.maxLoops } : {}) })
  }

  clear(sessionID: string): boolean {
    const record = this.live(sessionID)
    if (!record) {
      this.notify(sessionID, "cleared", "info", "No goal set", "There is no active goal in this session.")
      return false
    }
    this.finish(record, "cleared")
    this.notify(sessionID, "cleared", "info", "Goal cleared", record.condition)
    return true
  }

  async status(sessionID: string): Promise<void> {
    const record = this.goals.get(sessionID)
    if (!record) {
      this.notify(sessionID, "status", "info", "No goal set", "Set one with /goal <condition>.")
      return
    }
    const spend = await this.spend(sessionID)
    const text = formatStatus(record, this.deps.clock.now(), spend, this.deps.config.maxLoops)
    const title = isLive(record.status) ? `Goal ${statusLabel(record.status)}` : record.status === "achieved" ? "No goal set \u00B7 last goal achieved" : "No goal set"
    this.notify(sessionID, "status", "info", title, text)
  }

  // ---------------------------------------------------------------- session events

  onExecutionStarted(sessionID: string) {
    this.running.add(sessionID)
    // Lazy-create the runtime when a goal exists: after a restart/plugin reload the runtime map is empty,
    // and every tool event before the first execution-end would otherwise be dropped.
    const runtime = this.goals.has(sessionID) ? this.runtime(sessionID) : this.runtimes.get(sessionID)
    if (!runtime) return
    this.invalidate(runtime)
    runtime.toolCalls = 0
    runtime.awaitingExecution = false
  }

  onToolCalled(sessionID: string) {
    // Same lazy-create as onExecutionStarted: a session with a live goal must never silently drop tool events.
    if (!this.goals.has(sessionID)) return
    const runtime = this.runtime(sessionID)
    runtime.toolCalls++
    // Counted eagerly so a turn whose evaluation is later superseded or dropped still counts as work for the loop.
    runtime.iterationToolCalls++
  }

  /** A user prompt was admitted (not synthetic). Resumes a paused goal and re-arms idle check-ins. */
  onUserPrompt(sessionID: string) {
    const record = this.live(sessionID)
    if (!record) return
    const runtime = this.runtime(sessionID)
    this.invalidate(runtime)
    record.checkins = 0
    runtime.lastCheckinAt = undefined
    if (record.status === "paused") {
      // Turn-cap freeze (plain goals only): a message does not extend the cap, so resume would re-pause
      // after one turn. An armed /goal-loop resumes on a message even past the cap.
      // Stay paused; the user must clear or set a new goal (a restart resets the turn counter).
      if (!record.loopEnabled && this.deps.config.maxTurns > 0 && record.turns >= this.deps.config.maxTurns) {
        this.clearDeferred(runtime)
        // One courtesy warning per freeze; later prompts in the same pause stay silent.
        if (!runtime.capFreezeNotified) {
          runtime.capFreezeNotified = true
          this.notify(sessionID, "paused", "warning", "Goal paused at turn cap", `${record.reason ?? "Reached the turn limit."} A message will not extend the cap; run /goal clear or set a new goal.`)
        }
        this.commit(record)
        return
      }
      this.clearDeferred(runtime)
      record.status = "active"
      record.reason = undefined
      record.pauseCause = undefined
      record.stall = 0
      record.retries = 0
      // A resumed /goal-loop starts the not-progress count fresh, so a benign zero-tool iteration cannot instantly re-pause it.
      if (record.loopEnabled) record.loopNotProgress = 0
      this.notify(sessionID, "resumed", "info", "Goal resumed", record.condition)
    } else {
      this.clearDeferred(runtime)
    }
    this.commit(record)
  }

  async onExecutionSucceeded(sessionID: string): Promise<void> {
    this.running.delete(sessionID)
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") return
    const runtime = this.runtime(sessionID)
    if (runtime.awaitingExecution) {
      // Straggler duplicate of the turn the plugin just steered: an evaluation must wait for the next started.
      this.deps.log.info("goal evaluation straggler dropped", { sessionID })
      return
    }
    const epoch = ++runtime.epoch
    const tools = runtime.toolCalls
    runtime.toolCalls = 0
    const work = await this.deps.background.busy(sessionID).catch((): BackgroundWork => ({ subagents: 0, shells: 0 }))
    if (this.stale(record, runtime, epoch)) return
    if (work.subagents + work.shells > 0) return this.defer(record, runtime, work, tools)
    const carried = runtime.carriedToolCalls
    runtime.carriedToolCalls = 0
    runtime.deferredSince = undefined
    await this.evaluate(record, runtime, epoch, tools + carried)
  }

  onExecutionFailed(sessionID: string, error: FailureInfo | undefined) {
    this.running.delete(sessionID)
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") return
    const runtime = this.runtime(sessionID)
    this.invalidate(runtime)
    this.clearDeferred(runtime)
    runtime.toolCalls = 0
    // The execution is over; a straggler succeeded for it must not evaluate. The retry steer re-arms evaluation.
    runtime.awaitingExecution = true
    this.handleFailure(record, runtime, classifyFailure(error))
  }

  onExecutionInterrupted(sessionID: string, reason: InterruptReason) {
    this.running.delete(sessionID)
    const record = this.goals.get(sessionID)
    if (!record || record.status !== "active") return
    const runtime = this.runtime(sessionID)
    this.invalidate(runtime)
    this.clearDeferred(runtime)
    if (reason === "user") return this.pause(record, "Interrupted.", "user")
    if (reason === "inactivity") {
      runtime.awaitingExecution = true
      return this.handleFailure(record, runtime, { kind: "transient", label: "inactivity timeout" })
    }
    // shutdown: the goal persists and is restored; superseded: a newer execution owns the turn, its events must evaluate.
    if (reason !== "superseded") runtime.awaitingExecution = true
  }

  onSessionDeleted(sessionID: string) {
    this.running.delete(sessionID)
    const runtime = this.runtimes.get(sessionID)
    if (runtime) this.invalidate(runtime)
    this.runtimes.delete(sessionID)
    // Finished goals are not kept in memory after a restart, so always drop the stored record.
    void this.deps.store.remove(sessionID)
    this.lastCommit.delete(sessionID)
    this.lastReanchorAt.delete(sessionID)
    this.pendingAnchors.delete(sessionID)
    if (this.goals.delete(sessionID)) this.deps.emitter.changed(sessionID, null)
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Adopts one live record from storage into memory, resetting turn count, timer and spend baseline.
   * Returns true when the record was adopted. Used by the bulk restore and by the RPC read-through.
   */
  private async adoptRestored(record: GoalRecord): Promise<boolean> {
    if (this.goals.has(record.sessionID)) return true
    let usage: UsageSnapshot | undefined
    let notFound = false
    try {
      usage = await this.deps.session.usage(record.sessionID)
    } catch (error) {
      if (isNotFoundError(error)) notFound = true
      else this.deps.log.warn("restore kept goal after transient usage failure", { sessionID: record.sessionID, error: errorMessage(error) })
    }
    if (notFound) {
      // Definitive not-found only: the session no longer exists, drop the stale goal.
      void this.deps.store.remove(record.sessionID)
      return false
    }
    // Transient failure or unavailable usage (undefined) is not proof the session is gone: keep the goal
    // with its previous baseline rather than deleting it.
    const now = this.deps.clock.now()
    // A legacy record missing `history` would throw on the first `record.history.push(...)` in
    // evaluate() — after the bookkeeping mutations but before the commit, so the goal wedged
    // silently, forever. Normalize on adoption instead.
    if (!Array.isArray(record.history)) record.history = []
    Object.assign(record, { startedAt: now, turns: 0, stall: 0, retries: 0, checkins: 0, baseline: usage ?? record.baseline ?? EMPTY_USAGE })
    this.goals.set(record.sessionID, record)
    // Create the runtime up front so tool events that arrive before the first execution-end are counted.
    this.runtime(record.sessionID)
    this.commit(record)
    return true
  }

  /**
   * Restores live goals after a restart, resetting turn count, timer and spend baseline (Claude Code parity).
   * `boundaryCompact: false` adopts only (the read-only RPC list path): no host side effects are triggered.
   * The default keeps the restart fan-out, restricted to armed loops: compact live loop sessions once so a
   * restarted loop resumes on a fresh context. Plain `/goal` goals never reach the boundary-compaction path;
   * the request is recorded as pending so the next arm can detect where it landed.
   */
  async restore(options?: { boundaryCompact?: boolean }): Promise<number> {
    const boundaryCompact = options?.boundaryCompact ?? true
    const records = await this.deps.store.loadLive(this.deps.directory)
    await Promise.all(records.map((record) => this.adoptRestored(record)))
    if (this.goals.size) this.deps.log.info("restored goals", { count: this.goals.size })
    if (boundaryCompact) {
      for (const record of this.goals.values()) {
        if (record.status !== "active" || !record.loopEnabled || !this.deps.compactAtBoundary) continue
        // Do not stack a restore-time request on top of one already in flight, nor on top of one that just
        // landed: the arm-time settle re-requests an unlanded one (forced at 2 misses), and the host answers
        // "nothing to compact yet" for the rest. Reloading the plugin must not queue another compaction.
        const existing = record.loopCompact
        if (existing && !existing.landedAt) continue
        if (existing?.landedAt && this.deps.clock.now() - existing.landedAt < BOUNDARY_LANDING_GRACE_MS) continue
        void this.deps
          .compactAtBoundary(record.sessionID)
          .then(async (result) => {
            if (!result.requested) return
            if (this.goals.get(record.sessionID) !== record || record.status !== "active") return
            record.loopCompact = {
              requestedAt: this.deps.clock.now(),
              ...(result.estimatedTokens !== undefined ? { estimatedTokens: result.estimatedTokens } : {}),
              iteration: record.loopIteration ?? 1,
              misses: 0,
            }
            await this.commit(record).catch(() => {})
          })
          .catch((e) => this.deps.log.warn("restore boundary compact failed", { sessionID: record.sessionID, error: errorMessage(e) }))
      }
    }
    return this.goals.size
  }

  /**
   * RPC read-through: adopt one live record from storage when it is not in memory.
   * After a plugin reload the in-memory map can be empty for a directory while an active record
   * exists in plugin storage; the goal RPC uses this so `get`/`list` never report a live goal as missing.
   */
  async restoreOne(sessionID: string): Promise<boolean> {
    if (this.goals.has(sessionID)) return true
    const record = await this.deps.store.load(sessionID).catch(() => undefined)
    // Like the bulk restore, only adopt records owned by this instance's directory; a foreign-directory
    // record belongs to another plugin instance and must not be driven twice.
    if (!record || !isLive(record.status)) return false
    if (!sameDirectory(record.directory, this.deps.directory)) return false
    return this.adoptRestored(record)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const runtime of this.runtimes.values()) this.invalidate(runtime)
    // Let final-usage snapshots land first; their commits enqueue store writes that flush() must see.
    await Promise.allSettled([...this.pendingUsage])
    await this.deps.store.flush()
  }

  // ---------------------------------------------------------------- turn evaluation

  private async evaluate(record: GoalRecord, runtime: Runtime, epoch: number, tools: number): Promise<void> {
    const { config, clock, session } = this.deps
    const sessionID = record.sessionID
    const turn = record.turns + 1
    const stall = tools > 0 ? 0 : record.stall + 1
    const usage = await session.usage(sessionID).catch(() => undefined)
    // Per-turn spend: the delta against the previous reading (the arm-time reading seeds the first turn). Runtime-local — after a restore there is no previous reading, so the verdict carries no spend rather than a cumulative-since-set number.
    const turnSpend = usage && runtime.turnUsage ? diffUsage(usage, runtime.turnUsage) : undefined
    if (usage) runtime.turnUsage = usage
    if (this.stale(record, runtime, epoch)) return
    const abort = new AbortController()
    runtime.abort = abort
    runtime.evaluating = true
    this.emit(record)
    let result
    try {
      result = await this.deps.evaluator.evaluate({
        sessionID,
        condition: record.condition,
        turn,
        elapsedMs: clock.now() - record.startedAt,
        ...(usage ? { spend: diffUsage(usage, record.baseline) } : {}),
        signal: abort.signal,
      })
    } catch (error) {
      if (abort.signal.aborted || this.stale(record, runtime, epoch)) return
      runtime.evaluating = false
      return this.evaluationFailed(record, runtime, tools, error)
    } finally {
      if (runtime.abort === abort) {
        runtime.abort = undefined
        runtime.evaluating = false
      }
    }
    if (this.stale(record, runtime, epoch)) return

    // A met verdict on a turn with zero tool calls, where the condition names production of a thing, is not a
    // verdict — it is state inspection. Downgrade to not_met; the next turn re-attempts with tools in hand.
    // The "already satisfied at HEAD" wording is exempt: that met is the workstream BT already-satisfied landing,
    // and rejecting it would strand the loop on a completed condition (the v18 near-duplicate gate is the escape).
    if (result.verdict === "met" && tools === 0 && PRODUCING_CONDITION.test(record.condition) && !/already satisfied at head/i.test(result.reason ?? "")) {
      result = {
        verdict: "not_met" as const,
        reason: "no evidence of work toward the condition, only state inspection (zero tool calls this turn; the condition names production of a thing).",
      }
    }

    // Verifier, not transcriber: a met verdict is not accepted until the configured
    // verification command exits 0 against the current checkout. The output tail rides the
    // not_met reason, so the next turn sees exactly what failed.
    if (result.verdict === "met" && config.evaluator.verifyCommand) {
      result = await this.verifyMet(record, runtime, result)
      if (this.stale(record, runtime, epoch)) return
    }

    record.turns = turn
    record.stall = stall
    record.retries = 0
    record.verdict = result.verdict
    record.reason = result.reason || undefined
    // iterationToolCalls is maintained eagerly in onToolCalled; this evaluation only reads it (loop arming).
    // The why ledger stamps the same HEAD sha the loop rail stamps at advance — the verdict lands on a commit the reader can inspect. Guarded like headAtAdvance: outside a repository or when HEAD cannot be read, the sha is absent, never guessed.
    const shaAtEvaluation = (() => {
      try {
        const repo = findRepository(this.deps.directory)
        return repo ? headSha(repo.gitDir) : undefined
      } catch {
        return undefined
      }
    })()
    record.history.push({ turn, verdict: result.verdict, reason: result.reason, at: clock.now(), toolCalls: tools, ...(turnSpend ? { spend: turnSpend } : {}), ...(shaAtEvaluation ? { sha: shaAtEvaluation } : {}) })
    if (record.history.length > HISTORY) record.history.splice(0, record.history.length - HISTORY)

    if (result.verdict === "met") {
      if (record.loopEnabled) return this.loopAdvance(record, runtime, epoch, result, turn)
      this.finish(record, "achieved", result.reason)
      const story = outcomeStory({ turns: turn, elapsedMs: (record.endedAt ?? clock.now()) - record.startedAt })
      this.notify(sessionID, "achieved", "success", `Goal achieved in ${turn} turn${turn === 1 ? "" : "s"}`, `${story} · ${result.reason || record.condition}`)
      return this.note(record, `Goal achieved (turn ${turn}, ${formatDuration(clock.now() - record.startedAt)}).`, result.reason, { final: true })
    }
    if (result.verdict === "impossible") {
      this.finish(record, "impossible", result.reason)
      const story = outcomeStory({ turns: turn, elapsedMs: (record.endedAt ?? clock.now()) - record.startedAt })
      this.notify(sessionID, "impossible", "error", "Goal judged impossible", `${story} · ${result.reason || record.condition}`)
      return this.note(record, "Goal ended: the evaluator judged it impossible.", result.reason, { final: true })
    }
    if (config.maxTurns > 0 && turn >= config.maxTurns && !record.loopEnabled) {
      return this.pause(record, `Reached the ${config.maxTurns}-turn safety limit.`, "cap")
    }
    if (config.maxTurns > 0 && turn >= config.maxTurns && record.loopEnabled && !runtime.capNotified) {
      // Armed loops never pause at the turn cap: one notice, then the loop keeps running.
      runtime.capNotified = true
      this.notify(sessionID, "loop", "warning", "Turn cap passed — loop keeps running", `Reached the ${config.maxTurns}-turn safety limit; an armed /goal-loop does not pause. Run /goal clear to stop it.`)
    }
    if (stall >= config.stallTurns && config.stallTurns > 0 && !record.loopEnabled) {
      return this.pause(record, `No progress: ${stall} turns in a row without tool use.`, "stall")
    }
    if (stall >= config.stallTurns && config.stallTurns > 0 && record.loopEnabled && !runtime.stallNotified) {
      // Armed loops never pause at the stall guard: one notice, then the loop keeps running.
      runtime.stallNotified = true
      this.notify(sessionID, "loop", "warning", "No progress — loop keeps running", `${stall} turns in a row without tool use; an armed /goal-loop does not pause. Run /goal clear to stop it.`)
    }
    this.commit(record)
    // A user turn already started: it gets evaluated when it ends, so don't stack a continuation on it.
    if (this.running.has(sessionID)) return
    await this.continueWith(record, {
      text: Prompt.continuation({ condition: record.condition, turn: turn + 1, reason: result.reason }, this.deps.commit),
      description: `goal \u00B7 turn ${turn + 1} \u00B7 ${truncate(result.reason || "not met yet", 90)}`,
      turn: turn + 1,
    })
  }

  /**
   * Runs the configured verification command and returns the (possibly downgraded) verdict.
   * A missing verifier is a fail-closed error, not a pass: the whole point of the gate is that
   * met claims are backed by fresh command output, not transcript summaries.
   */
  private async verifyMet(
    record: GoalRecord,
    runtime: Runtime,
    result: EvaluationResult,
  ): Promise<EvaluationResult> {
    const { config, log } = this.deps
    const sessionID = record.sessionID
    const command = config.evaluator.verifyCommand
    // The dashboard paints the gate's own output, so persist a display-safe tail on the record at every exit.
    const mark = (entry: { code: number | null; timedOut?: boolean; output?: string }) => {
      const cleaned = entry.output ? stripControls(entry.output).trim() : ""
      const tail = cleaned ? cleaned.split("\n").slice(-12).join("\n").slice(-1200) : undefined
      record.lastVerify = { command, code: entry.code, ...(entry.timedOut ? { timedOut: true } : {}), ...(tail ? { tail } : {}), at: this.deps.clock.now() }
    }
    const fail = (detail: string): EvaluationResult => {
      log.warn("met verdict downgraded to not_met by the verification gate", { sessionID, command, detail })
      this.notify(sessionID, "retry", "warning", "Verification failed", `${command}: ${truncate(detail, 160)}`)
      return { verdict: "not_met", reason: `Verification \`${truncate(command, 120)}\` did not pass: ${truncate(detail, 240)}` }
    }
    const verifier = this.deps.verifier
    if (!verifier) {
      const detail = "no verifier port is wired for this plugin instance (fail closed)"
      mark({ code: null, output: detail })
      return fail(detail)
    }
    runtime.evaluating = true
    this.emit(record)
    try {
      const signal = AbortSignal.timeout(config.evaluator.verifyTimeoutMs)
      const run = await verifier.verify({ command, cwd: this.deps.directory, timeoutMs: config.evaluator.verifyTimeoutMs, signal })
      if (run.code === 0) {
        mark({ code: 0, output: run.output })
        return result
      }
      const tail = stripControls(run.output).trim().split("\n").slice(-12).join("\n")
      mark({ code: run.code ?? null, timedOut: run.timedOut, output: run.output })
      return fail(run.timedOut ? `timed out after ${formatDuration(config.evaluator.verifyTimeoutMs)}` : `exit ${run.code ?? "unknown"}: ${tail || "(no output)"}`)
    } catch (error) {
      const detail = `verification errored: ${errorMessage(error)}`
      mark({ code: null, output: detail })
      return fail(detail)
    } finally {
      if (runtime.abort === undefined) runtime.evaluating = false
    }
  }

  /**
   * Loop step, run only on a `met` verdict for a looped goal. Summarizes the achieved iteration into a compact
   * machine-consumable block, then asks the evaluator for the next condition (or LOOP_COMPLETE). Arms the next
   * iteration under the same /goal rules, or ends the loop cleanly. Never runs on not_met/impossible/pause/retry.
   *
   * Loop bookkeeping is on the record: `loopHistory` carries completed iterations, `loopNotProgress` counts
   * consecutive iterations with zero tool calls (recorded, never a pause). Every await is epoch-guarded; a superseded
   * loop step drops its result without saving.
   */
  private async loopAdvance(
    record: GoalRecord,
    runtime: Runtime,
    epoch: number,
    result: EvaluationResult,
    turn: number,
  ): Promise<void> {
    const { config, clock, log } = this.deps
    const sessionID = record.sessionID
    // Cumulative usage at the advance (met verdict). The delta against armUsage is this iteration's
    // spend; one extra usage() call per advance, same posture as the context estimate. Best-effort.
    const advanceUsage = await this.deps.session.usage(sessionID).catch(() => undefined)
    const iteration = record.loopIteration ?? 1
    const maxLoops = record.loopMaxLoops ?? config.maxLoops
    const objective = record.loopObjective ?? record.condition
    // A resumed loop can re-enter advance for the same iteration; never record it twice.
    const history: LoopEntry[] = (record.loopHistory ?? []).filter((e) => e.version !== iteration)
    const now = clock.now()
    const iterationTools = runtime.iterationToolCalls
    const notProgress = iterationTools === 0 && !runtime.iterationDeferred ? (record.loopNotProgress ?? 0) + 1 : 0
    // Stamp the arm-time context estimate (measured when this iteration was armed, tagged with its number by the boundary-compaction settle/restore writes) onto the entry. Only a matching iteration tag with a finite estimate qualifies; anything else stays absent — the row renders the gap honestly.
    const armedEstimate =
      record.loopCompact && record.loopCompact.iteration === iteration && typeof record.loopCompact.estimatedTokens === "number" && Number.isFinite(record.loopCompact.estimatedTokens)
        ? record.loopCompact.estimatedTokens
        : undefined
    // Stamp the commit HEAD had landed on when this iteration was recorded. Read once per advance; outside a repository (or on any read failure) the field stays absent — the ledger never fabricates a sha.
    const headAtAdvance = (() => {
      try {
        const repo = record.directory ? findRepository(record.directory) : undefined
        return repo ? headSha(repo.gitDir) : undefined
      } catch {
        return undefined
      }
    })()
    // Spend attribution: the diff between the arm-time cumulative and the advance-time cumulative is
    // this iteration's cost. Absent when the arm never saw a stamp (restored runtime) or the advance
    // could not measure — never estimated, never fabricated. Clamped at zero per field (diffUsage).
    const armDelta = advanceUsage && runtime.armUsage ? diffUsage(advanceUsage, runtime.armUsage) : undefined
    const makeEntry = (summary: string): LoopEntry => ({
      version: iteration,
      condition: record.condition,
      summary,
      reason: result.reason,
      turns: turn,
      toolCalls: iterationTools,
      endedAt: clock.now(),
      ...(armDelta !== undefined ? { spend: armDelta } : {}),
      ...(armedEstimate !== undefined ? { contextTokens: armedEstimate } : {}),
      ...(headAtAdvance !== undefined ? { sha: headAtAdvance } : {}),
    })
    // Loop bookkeeping lives only in locals until every await is behind us; a superseded loop step drops without saving.
    // The armed/terminal record is built in one shot and persisted with a single commit so a restart mid-loop
    // restores either the pre-step or the fully-advanced state, never a half-advanced one.
    const assignLoopState = () => {
      record.loopHistory = history
      record.loopNotProgress = notProgress
    }

    const endClean = async (reason: string) => {
      assignLoopState()
      await this.finish(record, "achieved", reason)
      const story = outcomeStory({ turns: record.turns, elapsedMs: (record.endedAt ?? this.deps.clock.now()) - record.startedAt, iterations: history.length })
      this.notify(sessionID, "achieved", "success", "Loop complete", `${story} · ${reason}`)
      return this.note(record, `Loop complete after ${history.length} iteration${history.length === 1 ? "" : "s"}.`, reason, { final: true })
    }

    if (!this.deps.evaluator.summarize && !this.deps.evaluator.nextGoal) {
      log.error("loop step unavailable", { sessionID })
      history.push(makeEntry("(loop advance unavailable: this evaluator cannot summarize or plan)"))
      return endClean("Loop complete: this evaluator cannot summarize or plan the next iteration.")
    }

    let summary: string
    if (this.deps.evaluator.summarize) {
      const summarize = new AbortController()
      runtime.abort = summarize
      try {
        summary = (
          await this.deps.evaluator.summarize({
            sessionID,
            objective,
            condition: record.condition,
            reason: result.reason,
            turn,
            elapsedMs: now - record.startedAt,
            toolCalls: iterationTools,
            history,
            maxSummaryTokens: config.maxLoopSummaryTokens,
            signal: summarize.signal,
          })
        ).slice(0, Math.max(200, config.maxLoopSummaryTokens) * 4)
      } catch (error) {
        if (runtime.abort === summarize) runtime.abort = undefined
        if (this.stale(record, runtime, epoch)) return
        log.error("loop summary failed", { sessionID, error: errorMessage(error) })
        summary = `(summary failed: ${truncate(errorMessage(error), 80)})`
      } finally {
        if (runtime.abort === summarize) runtime.abort = undefined
      }
    } else {
      // A planner without a summarizer still works: carry a placeholder instead of pausing.
      log.warn("loop summary unavailable: this evaluator cannot summarize", { sessionID })
      summary = "(summary unavailable: this evaluator cannot summarize)"
    }
    if (this.stale(record, runtime, epoch)) return

    const entry = makeEntry(summary.trim())
    history.push(entry)
    log.info("loop iteration met", { sessionID, iteration, toolCalls: iterationTools, history: history.length })

    if (history.length >= maxLoops) {
      return endClean(`Loop complete: reached the ${maxLoops}-iteration cap after ${history.length} achieved iteration${history.length === 1 ? "" : "s"}.`)
    }

    if (!this.deps.evaluator.nextGoal) {
      log.error("loop next-goal generation unavailable", { sessionID })
      return endClean("Loop complete: this evaluator cannot plan the next iteration.")
    }
    const generate = new AbortController()
    runtime.abort = generate
    let reply: string
    try {
      reply = await this.deps.evaluator.nextGoal({ sessionID, objective, history, latestSummary: entry.summary, signal: generate.signal })
    } catch (error) {
      if (runtime.abort === generate) runtime.abort = undefined
      if (this.stale(record, runtime, epoch)) return
      log.error("loop next-goal generation failed", { sessionID, error: errorMessage(error) })
      // The summary and history stay local until the arm lands, so a retry recomputes them identically;
      // record.loopNotProgress is untouched here on purpose.
      const attempt = runtime.loopRetries ?? 0
      const delay = backoffMs(RETRY_BASE_MS, 4, attempt)
      runtime.loopRetries = attempt + 1
      this.notify(
        sessionID,
        "retry",
        "warning",
        "Loop still active",
        `Could not plan the next iteration (${truncate(errorMessage(error), 160)}); retrying in ${formatDuration(delay)}.`,
      )
      this.schedule(runtime, delay, () => {
        if (this.goals.get(record.sessionID) !== record || record.status !== "active") return
        void this.loopAdvance(record, runtime, ++runtime.epoch, result, turn).catch((e) => log.error("loop retry failed", { error: errorMessage(e) }))
      })
      return
    } finally {
      if (runtime.abort === generate) runtime.abort = undefined
    }
    if (this.stale(record, runtime, epoch)) return
    // A met verdict advances the loop exactly once: if this iteration was already armed while we awaited
    // (duplicate delivery), drop the step instead of re-arming the same objective.
    if (record.loopIteration !== iteration) {
      log.warn("loop arm dropped: iteration already advanced", { sessionID, iteration, armed: record.loopIteration })
      return
    }

    if (Prompt.isLoopComplete(reply)) {
      return endClean(`Loop complete after ${history.length} iteration${history.length === 1 ? "" : "s"}: the evaluator found nothing worth improving.`)
    }
    const condition = Prompt.parseNextCondition(reply, Math.max(1, Math.floor(this.deps.config.maxConditionChars)))
    if (!condition) {
      return endClean("Loop complete: the next-goal generator returned nothing usable.")
    }
    // A planner that repeats an already-completed condition would spin the loop on the same work; end instead.
    // Punctuation-insensitive: collapse every run of non-alphanumerics to one space (unicode letters/numbers kept).
    const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    const completed = new Set([
      normalize(record.condition),
      ...(record.loopObjective ? [normalize(record.loopObjective)] : []),
      ...history.map((entry) => normalize(entry.condition)),
    ])
    if (completed.has(normalize(condition))) {
      log.warn("loop next-goal generator repeated a completed condition", { sessionID, iteration })
      return endClean(`Loop complete: the planner keeps offering the already-completed condition "${truncate(condition, 80)}"; nothing new to plan.`)
    }
    // Near-duplicate gate: a planner proposing work that materially overlaps an already-completed condition
    // would burn the iteration on a no-op. Token containment >= 0.7 or Jaccard >= 0.6 is a near-duplicate.
    const candidateTokens = tokensOf(normalize(condition))
    if (candidateTokens.size > 0) {
      for (const entry of completed) {
        const entryTokens = tokensOf(entry)
        if (entryTokens.size === 0) continue
        if (isNearDuplicate(candidateTokens, entryTokens)) {
          log.warn("loop next-goal generator offered a near-duplicate of an already-completed condition", { sessionID, iteration })
          return endClean(`Loop complete: the planner keeps offering a near-duplicate of an already-completed condition ("${truncate(condition, 80)}"); nothing new to plan.`)
        }
      }
    }

    const nextIteration = iteration + 1
    runtime.loopRetries = 0
    assignLoopState()
    record.condition = condition
    record.loopIteration = nextIteration
    record.turns = 0
    record.stall = 0
    record.retries = 0
    record.checkins = 0
    record.verdict = undefined
    record.reason = undefined
    record.startedAt = clock.now()
    this.clearDeferred(runtime)
    runtime.iterationToolCalls = 0
    runtime.iterationDeferred = false
    runtime.armUsage = advanceUsage
    // Single durable write: the achieved history and the armed iteration land together or not at all.
    // a restart from here restores either the pre-arm or the armed state, never a half-advanced one.
    await this.commit(record)
    if (this.stale(record, runtime, epoch)) return
    this.notify(sessionID, "loop", "info", `Loop ${iteration} of ${maxLoops} achieved`, `→ v${nextIteration}: ${truncate(condition, 160)}`)
    await this.note(record, `Loop ${iteration} of ${maxLoops} achieved (turn ${turn}); goal v${nextIteration} armed.`, condition)
    // The note round-trips through synthetic; the world may have moved on while it landed.
    if (this.stale(record, runtime, epoch)) return
    // Queue a boundary compaction BEFORE the armed iteration's synthetic steer, so the next version arms
    // with a fresh context. Awaiting only waits for the host's acceptance of the request. Any request made at
    // an earlier arm is settled first, here, before any other bookkeeping: a landed compaction is recorded as
    // such (success notice, misses reset, fresh requests re-enabled); an unmeasurable context never counts as
    // a miss nor a landing (one forced re-request at the first unmeasurable tick, then staleness-unknown with
    // a trickle of at most one forced re-request per 2 arms — never a full suspension); a measurable no-drop
    // counts a miss — the host-unwilling warning fires once at 2 misses, re-requests drop to a trickle every
    // 3rd arm, and COMPACT_MISS_CAP stays as a backstop final warning rather than the only signal.
    // An unlanded pending request is NOT re-issued on every arm, and a fresh request is not made on the arm
    // that just observed the landing: every arm stacking a request is what piled up "Nothing to compact yet"
    // dividers and their re-anchor notes. The loop keeps running throughout.
    if (this.deps.compactAtBoundary) {
      const pending = record.loopCompact && !record.loopCompact.landedAt ? record.loopCompact : undefined
      let force = false
      let misses = 0
      let staleness = pending?.stalenessUnknown === true
      let skipRequest: "landed" | "pending" | undefined
      if (pending) {
        const size = this.deps.estimateContext ? await this.deps.estimateContext(sessionID).catch(() => undefined) : undefined
        if (this.stale(record, runtime, epoch)) return
        if (this.contextDropped(pending, size)) {
          this.landPending(record, pending)
          skipRequest = "landed"
          await this.commit(record)
          this.notify(sessionID, "compact", "success", "Compaction landed", `Context dropped to ~${size} tokens at the loop boundary.`)
        } else if (size === undefined) {
          // Unmeasurable is not a miss and never a landing. Track the streak; the first tick forces one
          // re-request past cooldown, repeated ticks mark the pending request staleness-unknown — never a
          // full suspension while the armed iteration is below maxLoops.
          const unmeasurableTicks = (pending.unmeasurableTicks ?? 0) + 1
          if (unmeasurableTicks === 1) {
            record.loopCompact = { ...pending, unmeasurableTicks }
            force = true
            log.info("loop boundary compact: context unestimable; one forced re-request past cooldown", { sessionID })
          } else {
            if (!staleness) {
              staleness = true
              this.notify(sessionID, "compact", "warning", "Compaction landing unknown", "The context size is unavailable, so the boundary compaction cannot be confirmed landed or missed; the loop keeps running with at most one forced re-request per 2 arms.")
            }
            record.loopCompact = { ...pending, unmeasurableTicks, stalenessUnknown: true }
            // At most one forced re-request per 2 arms under unknown staleness; never the hard cap.
            force = unmeasurableTicks % 2 === 0
            log.info("loop boundary compact: staleness unknown; re-requesting on the 2-arm trickle", { sessionID, unmeasurableTicks, force })
          }
          await this.commit(record)
        } else {
          misses = pending.misses + 1
          const unwillingWarned = pending.unwillingWarned === true || misses >= COMPACT_MISS_RETRY
          record.loopCompact = { ...pending, misses, unmeasurableTicks: undefined, stalenessUnknown: undefined, unwillingWarned }
          if (misses === COMPACT_MISS_RETRY && pending.unwillingWarned !== true) {
            // The host will not compact (2 measurable arms, no landing): say it once, exactly.
            this.notify(sessionID, "compact", "warning", "Compaction not landing", "compaction did not land; loop is running hot; consider /compact manually")
          } else if (misses === COMPACT_MISS_CAP) {
            // Backstop only: one final warning at the cap crossing; re-requests continue as a trickle.
            this.notify(sessionID, "compact", "warning", "Compaction not landing", `The boundary compaction has not landed after ${COMPACT_MISS_CAP} armed iterations; re-requests drop to a trickle every 3rd arm. The loop keeps running.`)
          }
          // misses 1: silent count. misses 2: forced re-request (just warned). misses >= 3: trickle every 3rd arm.
          force = misses === COMPACT_MISS_RETRY || misses % 3 === 0
          log.info("loop boundary compact miss counted at arm", { sessionID, misses, force })
          await this.commit(record)
        }
        if (this.stale(record, runtime, epoch)) return
      }
      if (pending && !skipRequest && !force) skipRequest = "pending"
      if (skipRequest) {
        log.info("loop boundary compact skipped at this arm", { sessionID, reason: skipRequest })
      }
      const result: BoundaryCompactResult =
        skipRequest !== undefined
          ? { requested: false, reason: skipRequest === "landed" ? "too-small" : "cooldown" }
          : await this.deps
              .compactAtBoundary(sessionID, force ? { force: true } : undefined)
              .catch((error): BoundaryCompactResult => {
                log.warn("loop boundary compact failed", { sessionID, error: errorMessage(error) })
                return { requested: false, reason: "read-failed" }
              })
      if (this.stale(record, runtime, epoch)) return
      if (result.requested) {
        // Carry the miss count forward until a compaction actually lands: re-requesting is not evidence of landing.
        // Reads the post-settle record, not the pre-settle pending: spread it so misses, the once-per-pending
        // warning flag, and the unmeasurable/staleness state survive the rewrite. The stale estimate is dropped
        // when the fresh request carries none (it would anchor the drop heuristic to an old number).
        const settled = record.loopCompact && !record.loopCompact.landedAt ? record.loopCompact : undefined
        const { estimatedTokens: _staleEstimate, ...carried } = settled ?? {}
        record.loopCompact = {
          ...carried,
          requestedAt: clock.now(),
          ...(result.estimatedTokens !== undefined ? { estimatedTokens: result.estimatedTokens } : {}),
          iteration: nextIteration,
          misses,
        }
        await this.commit(record)
        if (this.stale(record, runtime, epoch)) return
      }
      // A denied request stays as-is: the settle step already counted this arm as a miss when a pending request exists,
      // and a busy deferral never forces an unsafe compact.
    }
    await this.continueWith(record, {
      text: Prompt.loopContinuation({ iteration: nextIteration, maxLoops, condition, previousSummary: entry.summary, reason: result.reason }, this.deps.commit),
      description: `goal-loop · arming v${nextIteration}`,
      turn: 1,
    })
  }

  private evaluationFailed(record: GoalRecord, runtime: Runtime, tools: number, error: unknown) {
    const { log } = this.deps
    log.warn("goal evaluation failed", { sessionID: record.sessionID, error: errorMessage(error) })
    record.retries++
    const delay = backoffMs(REEVALUATE_BASE_MS, 3, record.retries - 1)
    this.commit(record)
    this.notify(record.sessionID, "retry", "warning", "Goal still active", `Evaluator failed (${truncate(errorMessage(error), 120)}); retrying in ${formatDuration(delay)}.`)
    this.schedule(runtime, delay, () => {
      if (this.goals.get(record.sessionID) !== record || record.status !== "active" || this.running.has(record.sessionID)) return
      void this.evaluate(record, runtime, ++runtime.epoch, tools).catch((e) => log.error("re-evaluation failed", { error: errorMessage(e) }))
    })
  }

  private handleFailure(record: GoalRecord, runtime: Runtime, failure: ReturnType<typeof classifyFailure>) {
    if (failure.kind === "fatal") {
      const reason = `Goal failed after an unrecoverable error: ${failure.label}. Run /goal again to continue.`
      record.failureLabel = failure.label
      this.finish(record, "failed", reason)
      const story = outcomeStory({ turns: record.turns, elapsedMs: (record.endedAt ?? this.deps.clock.now()) - record.startedAt })
      this.notify(record.sessionID, "failed", "error", "Goal failed", `${story} · ${reason}`)
      return
    }
    record.retries++
    // Rate/usage-limit windows clear on their own, so a fixed long backoff beats burning evaluations;
    // transient errors use capped exponential backoff. Both retry forever.
    const delay = failure.kind === "pause" ? PAUSE_RETRY_MS : backoffMs(RETRY_BASE_MS, 4, record.retries - 1)
    this.commit(record)
    this.notify(record.sessionID, "retry", "warning", "Goal still active", `Turn failed (${failure.label}); retrying in ${formatDuration(delay)}.`)
    this.schedule(runtime, delay, () => {
      if (this.goals.get(record.sessionID) !== record || record.status !== "active" || this.running.has(record.sessionID)) return
      void this.continueWith(record, {
        text: Prompt.retry({ condition: record.condition, label: failure.label }, this.deps.commit),
        description: `goal \u00B7 retry ${record.retries}`,
        turn: record.turns + 1,
      }).catch((e) => this.deps.log.error("retry continuation failed", { error: errorMessage(e) }))
    })
  }

  /** Background work is running: skip this evaluation and arm an idle check-in (30m, then x2 up to x4). */
  private defer(record: GoalRecord, runtime: Runtime, work: BackgroundWork, tools: number) {
    const { config, clock } = this.deps
    runtime.carriedToolCalls += tools
    runtime.iterationDeferred = true
    const firstDefer = runtime.deferredSince === undefined
    runtime.deferredSince ??= clock.now()
    if (firstDefer) this.emit(record)
    if (config.checkinMinutes === 0 || record.checkins >= config.maxIdleCheckins) return
    const interval = config.checkinMinutes * 60_000 * Math.min(2 ** record.checkins, 4)
    const due = (runtime.lastCheckinAt ?? runtime.deferredSince) + interval
    this.schedule(runtime, Math.max(0, due - clock.now()), () => void this.checkin(record, runtime, work).catch((e) => this.deps.log.error("goal check-in failed", { error: errorMessage(e) })))
  }

  private async checkin(record: GoalRecord, runtime: Runtime, previous: BackgroundWork) {
    const { config, clock, background } = this.deps
    if (this.goals.get(record.sessionID) !== record || record.status !== "active" || this.running.has(record.sessionID)) return
    const epoch = runtime.epoch
    const work = await background.busy(record.sessionID).catch(() => previous)
    if (this.stale(record, runtime, epoch)) return
    record.checkins++
    runtime.lastCheckinAt = clock.now()
    const waitedMs = clock.now() - (runtime.deferredSince ?? clock.now())
    const last = record.checkins >= config.maxIdleCheckins
    this.commit(record)
    this.notify(
      record.sessionID,
      "checkin",
      "info",
      "Goal check-in",
      `Background work has kept the goal waiting ${formatDuration(waitedMs)}.${last ? " Idle check-ins are paused until you send another prompt." : ""}`,
    )
    await this.continueWith(record, {
      text: Prompt.checkin({ condition: record.condition, waitedMs, ...work }, this.deps.commit),
      description: `goal \u00B7 check-in ${record.checkins}`,
      turn: record.turns + 1,
    })
  }

  // ---------------------------------------------------------------- transitions

  private async continueWith(record: GoalRecord, input: { text: string; description: string; turn: number }) {
    const runtime = this.runtime(record.sessionID)
    // Every completion event after this dispatch belongs to the execution the steer starts; a succeeded delivered
    // before its started is a straggler from the previous turn. Marked before the dispatch (not after) so a user
    // turn started during the dispatch wins the flag via onExecutionStarted and its succeeded is evaluated.
    runtime.awaitingExecution = true
    try {
      await this.deps.session.synthetic({
        sessionID: record.sessionID,
        text: input.text,
        description: input.description,
        metadata: { source: Prompt.MARKER, goal: record.id, turn: input.turn },
        delivery: "steer",
      })
    } catch (error) {
      // A synthetic steer that fails to land must not stop the goal: drop the straggler flag and retry the dispatch.
      // onUserPrompt/clear/isDisposed all call invalidate(runtime), which clears runtime.timer, so a user prompt
      // cancels the pending retry.
      runtime.awaitingExecution = false
      if (this.goals.get(record.sessionID) === record && record.status === "active") {
        this.notify(record.sessionID, "retry", "warning", "Goal still active", `Could not continue (${truncate(errorMessage(error), 160)}); retrying in ${formatDuration(CONTINUE_RETRY_MS)}.`)
        this.schedule(runtime, CONTINUE_RETRY_MS, () => {
          if (this.goals.get(record.sessionID) !== record || record.status !== "active") return
          void this.continueWith(record, input).catch((e) => this.deps.log.error("continuation retry failed", { error: errorMessage(e) }))
        })
      }
    }
  }

  /**
   * Persists the paused record before returning; the returned promise resolves once the durable write lands.
   * Non-loop callers may ignore it (fire-and-forget, as before); loop call sites await it so a restart
   * cannot restore the pre-pause state.
   */
  private pause(record: GoalRecord, reason: string, cause: PauseCause): Promise<void> {
    const runtime = this.runtime(record.sessionID)
    this.invalidate(runtime)
    this.clearDeferred(runtime)
    record.status = "paused"
    record.reason = reason
    record.pauseCause = cause
    const saved = this.commit(record)
    const atCap = this.deps.config.maxTurns > 0 && record.turns >= this.deps.config.maxTurns
    this.notify(
      record.sessionID,
      "paused",
      "warning",
      "Goal paused",
      atCap
        ? `${reason} It stays paused at the turn cap until you /goal clear or set a new goal; a message will not extend the cap.`
        : `${reason} Send a message to resume, or /goal clear.`,
    )
    return saved
  }

  /**
   * Persists the terminal status before returning; the returned promise resolves once the durable write lands.
   * Non-loop callers may ignore it (fire-and-forget, as before); the goal-loop end path awaits it so a crash
   * between the loop's last met verdict and the write cannot restore an active loop and re-evaluate the condition.
   * The final spend snapshot still resolves in the background and re-saves the record.
   */
  private finish(record: GoalRecord, status: Exclude<GoalStatus, "active" | "paused">, reason?: string): Promise<void> {
    record.pauseCause = undefined
    const runtime = this.runtimes.get(record.sessionID)
    if (runtime) {
      this.invalidate(runtime)
      this.clearDeferred(runtime)
    }
    record.status = status
    if (reason) record.reason = reason
    record.endedAt = this.deps.clock.now()
    const saved = this.commit(record)
    const usageSnapshot = this.deps.session
      .usage(record.sessionID)
      .then((usage) => {
        if (this.goals.get(record.sessionID) !== record) return
        if (!usage) {
          this.deps.log.warn("final spend snapshot unavailable", { sessionID: record.sessionID })
          return
        }
        record.final = usage
        // Route the final snapshot through commit so the no-op cache mirrors the stored record exactly;
        // a direct store.save left lastCommit holding the pre-`final` serialized string.
        void this.commit(record)
        // The commit-path `changed` event carries no spend (a usage() call per event is not affordable on the
        // hot path), and terminal goals are never re-pulled by the TUI's stale-chrome guard. Emit one more
        // snapshot with the settled spend so an open card/dialog shows the final figure immediately.
        this.deps.emitter.changed(record.sessionID, this.snapshot(record.sessionID, diffUsage(usage, record.baseline)))
      })
      .catch((error) => this.deps.log.warn("final spend snapshot failed", { sessionID: record.sessionID, error: errorMessage(error) }))
      .finally(() => this.pendingUsage.delete(usageSnapshot))
    this.pendingUsage.add(usageSnapshot)
    return saved
  }

  /** Records a verdict in the transcript without waking the session (like a shell notification). */
  private async note(record: GoalRecord, title: string, body: string, opts?: { final?: boolean }) {
    if (!this.deps.config.transcriptNotes) return
    await this.deps.session
      .synthetic({
        sessionID: record.sessionID,
        text: Prompt.note({ title, body: body || record.condition, ...(opts?.final ? { final: true } : {}) }),
        description: title,
        metadata: { source: Prompt.MARKER, goal: record.id, final: true },
        delivery: "queue",
        resume: false,
      })
      .catch((error) => this.deps.log.warn("could not record goal note", { error: errorMessage(error) }))
  }

  // ---------------------------------------------------------------- plumbing

  private runtime(sessionID: string): Runtime {
    let runtime = this.runtimes.get(sessionID)
    if (!runtime) {
      runtime = { epoch: 0, toolCalls: 0, iterationToolCalls: 0, carriedToolCalls: 0, evaluating: false, awaitingExecution: false, iterationDeferred: false }
      this.runtimes.set(sessionID, runtime)
    }
    return runtime
  }

  /** Fresh runtime for a new goal; keeps the tool counter of a turn already in flight. */
  private reset(sessionID: string) {
    const previous = this.runtimes.get(sessionID)
    if (previous) this.invalidate(previous)
    this.runtimes.set(sessionID, {
      epoch: (previous?.epoch ?? 0) + 1,
      toolCalls: previous?.toolCalls ?? 0,
      iterationToolCalls: 0,
      carriedToolCalls: 0,
      evaluating: false,
      awaitingExecution: false,
      iterationDeferred: false,
    })
  }

  /** Deferred background-wait state must not survive resume, failure, interrupt, pause or finish. */
  private clearDeferred(runtime: Runtime) {
    runtime.deferredSince = undefined
    runtime.carriedToolCalls = 0
    runtime.lastCheckinAt = undefined
  }

  private invalidate(runtime: Runtime) {
    runtime.epoch++
    runtime.abort?.abort()
    runtime.abort = undefined
    runtime.evaluating = false
    if (runtime.timer !== undefined) this.deps.clock.clearTimeout(runtime.timer)
    runtime.timer = undefined
  }

  private schedule(runtime: Runtime, ms: number, callback: () => void) {
    if (runtime.timer !== undefined) this.deps.clock.clearTimeout(runtime.timer)
    runtime.timer = this.deps.clock.setTimeout(() => {
      runtime.timer = undefined
      if (!this.disposed) callback()
    }, ms)
  }

  private stale(record: GoalRecord, runtime: Runtime, epoch: number) {
    return this.disposed || runtime.epoch !== epoch || this.goals.get(record.sessionID) !== record || record.status !== "active"
  }

  /**
   * Resolves once the write has been attempted; a rejecting durable write is normalized to "did not land"
   * (and logged), so the promise never rejects and fire-and-forget call sites are safe by construction.
   * Most callers ignore the result; the loop arm awaits it so a restart cannot restore the pre-arm state.
   * A failed write drops the record from the no-op cache so the next identical commit retries the durable write instead of assuming it landed.
   */
  private commit(record: GoalRecord): Promise<void> {
    let serialized: string
    try {
      serialized = JSON.stringify(record)
    } catch {
      serialized = "" // Unserializable record: never skip the save.
    }
    if (serialized && this.lastCommit.get(record.sessionID) === serialized) return Promise.resolve()
    this.lastCommit.set(record.sessionID, serialized)
    const saved = this.deps.store.save(record).catch((error: unknown) => {
      // The store's own contract is "resolves with whether it landed", but a save() that itself rejects
      // (storage fault at the port boundary) would otherwise propagate: every un-awaited this.commit call site
      // in the state machine would become an unhandled rejection, and the no-op marker would keep claiming
      // the write landed. Treat it as unwritten: drop the marker (below), retry on the next identical commit.
      this.deps.log.warn("goal record save failed; treated as unwritten", { sessionID: record.sessionID, error: errorMessage(error) })
      return false
    })
    this.emit(record)
    return saved.then((ok) => {
      // Keep the marker only when the write landed; otherwise the next identical commit retries.
      if (serialized && !ok) this.lastCommit.delete(record.sessionID)
    })
  }

  private emit(record: GoalRecord) {
    if (this.goals.get(record.sessionID) !== record) return
    this.deps.emitter.changed(record.sessionID, this.snapshot(record.sessionID))
  }

  private notify(sessionID: string, kind: NoticeKind, level: NoticeLevel, title: string, body: string) {
    const notice: Notice = { sessionID, kind, level, title, message: body }
    this.deps.log.info(`${title}: ${truncate(body, 200)}`, { sessionID, kind })
    this.deps.emitter.notice(notice)
  }
}

/** Sanitize an invalid count suffix before it is echoed into a notice: printable ASCII only, capped. */
function sanitizeCountEcho(value: string): string {
  let out = ""
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (out.length >= 32) return `${out}…`
    out += code >= 32 && code <= 126 ? ch : "?"
  }
  return out
}
