import type { GoalConfig } from "../core/config.ts"
import { classifyFailure, errorMessage, isNotFoundError } from "../core/errors.ts"
import { diffUsage, formatDuration, formatStatus, statusLabel, truncate } from "../core/format.ts"
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
  type Notice,
  type NoticeKind,
  type NoticeLevel,
  type UsageSnapshot,
} from "../core/types.ts"
import type { BackgroundPort, BackgroundWork, Clock, Delivery, EmitterPort, EvaluationResult, EvaluatorPort, Logger, PromptAttachments, SessionPort } from "./ports.ts"
import { sameDirectory, type GoalStore } from "./store.ts"

export interface ControllerDeps {
  readonly config: GoalConfig
  readonly directory: string
  /** The commit rule that applies to this session's directory. */
  readonly commit: CommitPolicy
  readonly session: SessionPort
  readonly evaluator: EvaluatorPort
  readonly background: BackgroundPort
  readonly store: GoalStore
  readonly emitter: EmitterPort
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
}

const HISTORY = 20
const RETRY_BASE_MS = 15_000
const RETRY_MAX_MS = 5 * 60_000
const REEVALUATE_BASE_MS = 10_000

export type InterruptReason = "user" | "shutdown" | "superseded" | "inactivity" | (string & {})

/**
 * The /goal state machine. Event-driven, one record per session:
 *
 *   set -> active --turn ends--> evaluate --not_met--> continue (synthetic turn) --> ...
 *                                         --met/impossible--> terminal
 *   active --interrupt | stall | limit | non-retryable error--> paused --user prompt--> active
 *   active --fatal error--> failed       any --clear--> cleared
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

  snapshot(sessionID: string, spend?: UsageSnapshot): GoalSnapshot | null {
    const record = this.goals.get(sessionID)
    if (!record) return null
    const runtime = this.runtimes.get(sessionID)
    return {
      ...structuredClone(record),
      elapsedMs: (record.endedAt ?? this.deps.clock.now()) - record.startedAt,
      evaluating: runtime?.evaluating ?? false,
      waiting: runtime?.deferredSince !== undefined,
      ...(spend ? { spend } : {}),
    }
  }

  list(): GoalSnapshot[] {
    return [...this.goals.keys()].map((id) => this.snapshot(id)).filter((s): s is GoalSnapshot => s !== null)
  }

  async spend(sessionID: string): Promise<UsageSnapshot | undefined> {
    const record = this.goals.get(sessionID)
    if (!record) return undefined
    if (record.final) return diffUsage(record.final, record.baseline)
    const usage = await this.deps.session.usage(sessionID).catch(() => undefined)
    return usage && diffUsage(usage, record.baseline)
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

  async set(input: { sessionID: string; condition: string; delivery: Delivery; loop?: boolean } & PromptAttachments): Promise<void> {
    const { sessionID, condition } = input
    const previous = this.live(sessionID)
    if (previous) this.finish(previous, "cleared", "Replaced by a new goal.")
    const now = this.deps.clock.now()
    const baseline = (await this.deps.session.usage(sessionID).catch(() => undefined)) ?? EMPTY_USAGE
    const loop = input.loop === true
    const maxLoops = this.deps.config.maxLoops
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
    this.commit(record)
    const loopLabel = loop ? "Loop" : "Goal"
    this.notify(sessionID, "set", "info", previous ? `${loopLabel} replaced` : `${loopLabel} set`, condition)
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
    const text = formatStatus(record, this.deps.clock.now(), spend)
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
      // Turn-cap freeze: a message does not extend the cap, so resume would re-pause after one turn.
      // Stay paused; the user must clear or set a new goal (a restart resets the turn counter).
      if (this.deps.config.maxTurns > 0 && record.turns >= this.deps.config.maxTurns) {
        this.clearDeferred(runtime)
        this.notify(sessionID, "paused", "warning", "Goal paused at turn cap", `${record.reason ?? "Reached the turn limit."} A message will not extend the cap; run /goal clear or set a new goal.`)
        this.commit(record)
        return
      }
      this.clearDeferred(runtime)
      record.status = "active"
      record.reason = undefined
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
    if (reason === "user") return this.pause(record, "Interrupted.")
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
    Object.assign(record, { startedAt: now, turns: 0, stall: 0, retries: 0, checkins: 0, baseline: usage ?? record.baseline ?? EMPTY_USAGE })
    this.goals.set(record.sessionID, record)
    // Create the runtime up front so tool events that arrive before the first execution-end are counted.
    this.runtime(record.sessionID)
    this.commit(record)
    return true
  }

  /** Restores live goals after a restart, resetting turn count, timer and spend baseline (Claude Code parity). */
  async restore(): Promise<number> {
    const records = await this.deps.store.loadLive(this.deps.directory)
    await Promise.all(records.map((record) => this.adoptRestored(record)))
    if (this.goals.size) this.deps.log.info("restored goals", { count: this.goals.size })
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
    await this.deps.store.flush()
  }

  // ---------------------------------------------------------------- turn evaluation

  private async evaluate(record: GoalRecord, runtime: Runtime, epoch: number, tools: number): Promise<void> {
    const { config, clock, session } = this.deps
    const sessionID = record.sessionID
    const turn = record.turns + 1
    const stall = tools > 0 ? 0 : record.stall + 1
    const usage = await session.usage(sessionID).catch(() => undefined)
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

    record.turns = turn
    record.stall = stall
    record.retries = 0
    record.verdict = result.verdict
    record.reason = result.reason || undefined
    // iterationToolCalls is maintained eagerly in onToolCalled; this evaluation only reads it (loop arming).
    record.history.push({ turn, verdict: result.verdict, reason: result.reason, at: clock.now() })
    if (record.history.length > HISTORY) record.history.splice(0, record.history.length - HISTORY)

    if (result.verdict === "met") {
      if (record.loopEnabled) return this.loopAdvance(record, runtime, epoch, result, turn)
      this.finish(record, "achieved", result.reason)
      this.notify(sessionID, "achieved", "success", `Goal achieved in ${turn} turn${turn === 1 ? "" : "s"}`, result.reason || record.condition)
      return this.note(record, `Goal achieved (turn ${turn}, ${formatDuration(clock.now() - record.startedAt)}).`, result.reason)
    }
    if (result.verdict === "impossible") {
      this.finish(record, "impossible", result.reason)
      this.notify(sessionID, "impossible", "error", "Goal judged impossible", result.reason || record.condition)
      return this.note(record, "Goal ended: the evaluator judged it impossible.", result.reason)
    }
    if (config.maxTurns > 0 && turn >= config.maxTurns) return this.pause(record, `Reached the ${config.maxTurns}-turn safety limit.`)
    if (stall >= config.stallTurns) return this.pause(record, `No progress: ${stall} turns in a row without tool use.`)
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
   * Loop step, run only on a `met` verdict for a looped goal. Summarizes the achieved iteration into a compact
   * machine-consumable block, then asks the evaluator for the next condition (or LOOP_COMPLETE). Arms the next
   * iteration under the same /goal rules, or ends the loop cleanly. Never runs on not_met/impossible/pause/retry.
   *
   * Loop bookkeeping is on the record: `loopHistory` carries completed iterations, `loopNotProgress` counts
   * consecutive iterations with zero tool calls (two pause the loop). Every await is epoch-guarded; a superseded
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
    const iteration = record.loopIteration ?? 1
    const maxLoops = record.loopMaxLoops ?? config.maxLoops
    const objective = record.loopObjective ?? record.condition
    // A resumed loop can re-enter advance for the same iteration; never record it twice.
    const history: LoopEntry[] = (record.loopHistory ?? []).filter((e) => e.version !== iteration)
    const now = clock.now()
    const iterationTools = runtime.iterationToolCalls
    const notProgress = iterationTools === 0 && !runtime.iterationDeferred ? (record.loopNotProgress ?? 0) + 1 : 0
    const makeEntry = (summary: string): LoopEntry => ({
      version: iteration,
      condition: record.condition,
      summary,
      reason: result.reason,
      turns: turn,
      toolCalls: iterationTools,
      endedAt: clock.now(),
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
      this.notify(sessionID, "achieved", "success", "Loop complete", reason)
      return this.note(record, `Loop complete after ${history.length} iteration${history.length === 1 ? "" : "s"}.`, reason)
    }

    if (!this.deps.evaluator.summarize || !this.deps.evaluator.nextGoal) {
      const reason = "The loop cannot advance: this evaluator cannot summarize. Send a message to retry, or /goal-loop clear."
      log.error("loop step unavailable", { sessionID })
      history.push(makeEntry("(loop summary unavailable: this evaluator cannot summarize)"))
      assignLoopState()
      await this.pause(record, reason)
      return
    }

    const summarize = new AbortController()
    runtime.abort = summarize
    let summary: string
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
      history.push(makeEntry(`(summary failed: ${truncate(errorMessage(error), 80)})`))
      assignLoopState()
      await this.pause(record, `The loop summary failed: ${truncate(errorMessage(error), 160)}`)
      return
    } finally {
      if (runtime.abort === summarize) runtime.abort = undefined
    }
    if (this.stale(record, runtime, epoch)) return

    const entry = makeEntry(summary.trim())
    history.push(entry)
    log.info("loop iteration met", { sessionID, iteration, toolCalls: iterationTools, history: history.length })

    if (notProgress >= 2) {
      assignLoopState()
      await this.pause(record, "Loop paused: two consecutive iterations without tool use. Send a message to resume, or /goal-loop clear.")
      return
    }
    if (history.length >= maxLoops) {
      return endClean(`Loop complete: reached the ${maxLoops}-iteration cap after ${history.length} achieved iteration${history.length === 1 ? "" : "s"}.`)
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
      assignLoopState()
      await this.pause(record, `The loop next-goal generator failed: ${truncate(errorMessage(error), 160)}`)
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
    const condition = Prompt.parseNextCondition(reply)
    if (!condition) {
      return endClean("Loop complete: the next-goal generator returned nothing usable.")
    }
    // A planner that repeats an already-completed condition would spin the loop on the same work; pause instead.
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase()
    const completed = new Set([
      normalize(record.condition),
      ...(record.loopObjective ? [normalize(record.loopObjective)] : []),
      ...history.map((entry) => normalize(entry.condition)),
    ])
    if (completed.has(normalize(condition))) {
      log.warn("loop next-goal generator repeated a completed condition", { sessionID, iteration })
      assignLoopState()
      await this.pause(
        record,
        `The loop planner returned the already-completed condition "${truncate(condition, 80)}"; the loop is paused rather than spun. Send a message to resume, or /goal-loop clear.`,
      )
      return
    }

    const nextIteration = iteration + 1
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
    // Single durable write: the achieved history and the armed iteration land together or not at all.
    // a restart from here restores either the pre-arm or the armed state, never a half-advanced one.
    await this.commit(record)
    if (this.stale(record, runtime, epoch)) return
    this.notify(sessionID, "loop", "info", `Loop ${iteration} achieved`, `→ v${nextIteration}: ${truncate(condition, 160)}`)
    await this.note(record, `Loop ${iteration} achieved (turn ${turn}); goal v${nextIteration} armed.`, condition)
    // The note round-trips through synthetic; the world may have moved on while it landed.
    if (this.stale(record, runtime, epoch)) return
    await this.continueWith(record, {
      text: Prompt.loopContinuation({ iteration: nextIteration, maxLoops, condition, previousSummary: entry.summary, reason: result.reason }, this.deps.commit),
      description: `goal-loop · arming v${nextIteration}`,
      turn: 1,
    })
  }

  private evaluationFailed(record: GoalRecord, runtime: Runtime, tools: number, error: unknown) {
    const { config, log } = this.deps
    log.warn("goal evaluation failed", { sessionID: record.sessionID, error: errorMessage(error) })
    if (config.checkinMinutes === 0 || record.retries >= config.maxRetries)
      return this.pause(record, `The evaluator failed: ${truncate(errorMessage(error), 160)}`)
    record.retries++
    const delay = Math.min(REEVALUATE_BASE_MS * 3 ** (record.retries - 1), RETRY_MAX_MS)
    this.commit(record)
    this.notify(record.sessionID, "retry", "warning", "Goal still active", `Evaluator failed (${truncate(errorMessage(error), 120)}); retrying in ${formatDuration(delay)}.`)
    this.schedule(runtime, delay, () => {
      if (this.goals.get(record.sessionID) !== record || record.status !== "active" || this.running.has(record.sessionID)) return
      void this.evaluate(record, runtime, ++runtime.epoch, tools).catch((e) => log.error("re-evaluation failed", { error: errorMessage(e) }))
    })
  }

  private handleFailure(record: GoalRecord, runtime: Runtime, failure: ReturnType<typeof classifyFailure>) {
    const { config } = this.deps
    if (failure.kind === "fatal") {
      const reason = `Goal failed after an unrecoverable error: ${failure.label}. Run /goal again to continue.`
      this.finish(record, "failed", reason)
      this.notify(record.sessionID, "failed", "error", "Goal failed", reason)
      return
    }
    if (failure.kind === "pause" || config.checkinMinutes === 0) return this.pause(record, `Turn failed: ${failure.label}.`)
    if (record.retries >= config.maxRetries) return this.pause(record, `Turn failed: ${failure.label} (after ${record.retries} automatic retries).`)
    record.retries++
    const delay = Math.min(RETRY_BASE_MS * 4 ** (record.retries - 1), RETRY_MAX_MS)
    this.commit(record)
    this.notify(record.sessionID, "retry", "warning", "Goal still active", `Turn failed (${failure.label}); retrying in ${formatDuration(delay)}.`)
    this.schedule(runtime, delay, () => {
      if (this.goals.get(record.sessionID) !== record || record.status !== "active" || this.running.has(record.sessionID)) return
      void this.continueWith(record, {
        text: Prompt.retry({ condition: record.condition, label: failure.label }, this.deps.commit),
        description: `goal \u00B7 retry ${record.retries}/${config.maxRetries}`,
        turn: record.turns + 1,
      })
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
    this.schedule(runtime, Math.max(0, due - clock.now()), () => void this.checkin(record, runtime, work))
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
      if (this.goals.get(record.sessionID) === record && record.status === "active") this.pause(record, `Could not continue: ${truncate(errorMessage(error), 160)}`)
    }
  }

  /**
   * Persists the paused record before returning; the returned promise resolves once the durable write lands.
   * Non-loop callers may ignore it (fire-and-forget, as before); loop call sites await it so a restart
   * cannot restore the pre-pause state.
   */
  private pause(record: GoalRecord, reason: string): Promise<void> {
    const runtime = this.runtime(record.sessionID)
    this.invalidate(runtime)
    this.clearDeferred(runtime)
    record.status = "paused"
    record.reason = reason
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
    const runtime = this.runtimes.get(record.sessionID)
    if (runtime) {
      this.invalidate(runtime)
      this.clearDeferred(runtime)
    }
    record.status = status
    if (reason) record.reason = reason
    record.endedAt = this.deps.clock.now()
    const saved = this.commit(record)
    void this.deps.session
      .usage(record.sessionID)
      .then((usage) => {
        if (this.goals.get(record.sessionID) !== record) return
        if (!usage) {
          this.deps.log.warn("final spend snapshot unavailable", { sessionID: record.sessionID })
          return
        }
        record.final = usage
        void this.deps.store.save(record)
      })
      .catch((error) => this.deps.log.warn("final spend snapshot failed", { sessionID: record.sessionID, error: errorMessage(error) }))
    return saved
  }

  /** Records a verdict in the transcript without waking the session (like a shell notification). */
  private async note(record: GoalRecord, title: string, body: string) {
    if (!this.deps.config.transcriptNotes) return
    await this.deps.session
      .synthetic({
        sessionID: record.sessionID,
        text: Prompt.note({ title, body: body || record.condition }),
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
   * Resolves once the write has been attempted. Most callers ignore the result; the loop arm awaits it so a restart
   * cannot restore the pre-arm state. A failed write drops the record from the no-op cache so the next identical
   * commit retries the durable write instead of assuming it landed.
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
    const saved = this.deps.store.save(record)
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

