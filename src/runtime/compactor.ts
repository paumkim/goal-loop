/**
 * Plugin-managed auto-compaction. When the estimated model-visible context of a session is at or above a
 * configurable absolute token threshold, the plugin itself asks the host to compact the session. This is a
 * window-independent complement to opencode's window-relative `compaction.buffer`.
 *
 * All guards are timestamp-based; the compactor keeps no timers alive.
 */
import { BOUNDARY_MIN_TOKENS, COMPACT_COOLDOWN_MS } from "../core/constants.ts"
import { estimateContextTokens } from "../core/context-size.ts"
import type { GoalConfig } from "../core/config.ts"
import { errorMessage } from "../core/errors.ts"
import { truncate } from "../core/format.ts"
import type { Clock, EmitterPort, Logger } from "./ports.ts"

interface CompactorDeps {
  readonly config: GoalConfig
  readonly compact: (sessionID: string) => Promise<void>
  readonly context: (sessionID: string) => Promise<readonly unknown[]>
  readonly emitter: EmitterPort
  readonly clock: Clock
  readonly log: Logger
  /**
   * True while the session has work in flight (a turn executing, or background subagents/shells running).
   * Every plugin-initiated compaction is deferred then: compacting mid-work truncates the work.
   * Optional so tests/probes can omit it; when omitted nothing is deferred.
   */
  readonly isBusy?: (sessionID: string) => Promise<boolean>
}

type BoundaryCompactMiss = "disabled" | "in-flight" | "cooldown" | "too-small" | "read-failed" | "busy" | "compact-failed" | "capped"
/** Outcome of a boundary-compaction request. `requested: false` carries why nothing was asked of the host. */
export type BoundaryCompactResult = { readonly requested: true; readonly estimatedTokens?: number } | { readonly requested: false; readonly reason: BoundaryCompactMiss }

/** Minimum gap between compact requests for the same session. */
const REQUEST_COOLDOWN_MS = COMPACT_COOLDOWN_MS
/** An in-flight entry older than this is considered lost and swept. */
const INFLIGHT_STALE_MS = 10 * 60_000

export class AutoCompactor {
  private readonly inFlight = new Map<string, number>()
  private readonly requestedAt = new Map<string, number>()

  constructor(private readonly deps: CompactorDeps) {}

  /** Fail closed: if the busy check itself errors, assume work is in flight and defer the compaction. */
  private async isBusy(sessionID: string): Promise<boolean> {
    if (!this.deps.isBusy) return false
    try {
      return await this.deps.isBusy(sessionID)
    } catch (error) {
      this.deps.log.warn("compact: busy check failed; deferring compaction", { sessionID, error: String(error) })
      return true
    }
  }

  /** Sweep stale in-flight entries; a compaction that never reported back is presumed lost. */
  private sweepStale(): void {
    const now = this.deps.clock.now()
    for (const [id, at] of this.inFlight) if (now - at >= INFLIGHT_STALE_MS) this.inFlight.delete(id)
  }

  /** Compact the session when the estimated context is at or above `config.compactAtTokens`. */
  async maybeCompact(sessionID: string): Promise<void> {
    const { config, compact, context, emitter, clock, log } = this.deps
    if (config.compactAtTokens <= 0) return
    const now = clock.now()
    this.sweepStale()
    if (await this.isBusy(sessionID)) {
      log.info("auto-compact deferred: session has work in flight", { sessionID })
      return
    }
    if (this.inFlight.has(sessionID)) return
    if (now - (this.requestedAt.get(sessionID) ?? 0) < REQUEST_COOLDOWN_MS) return

    let messages: readonly unknown[]
    try {
      messages = await context(sessionID)
    } catch (error) {
      log.warn("auto-compact: could not read the session context", { sessionID, error: String(error) })
      return
    }
    const size = estimateContextTokens(messages)
    if (size === undefined) {
      log.info("auto-compact: no assistant token usage in context; skipping", { sessionID })
      return
    }
    if (size < config.compactAtTokens) return
    // The context read above can take seconds; a turn started during that window would be compacted
    // mid-work. Re-check the busy gate before firing, the same invariant the first gate enforces.
    if (await this.isBusy(sessionID)) {
      log.info("auto-compact deferred: session has work in flight", { sessionID })
      return
    }

    this.requestedAt.set(sessionID, now)
    this.inFlight.set(sessionID, now)
    try {
      await compact(sessionID)
    } catch (error) {
      // Keep requestedAt for the cooldown; clear in-flight so a retry is possible later.
      this.inFlight.delete(sessionID)
      const message = truncate(errorMessage(error), 160)
      log.warn("auto-compact: compaction failed to start", { sessionID, error: message })
      emitter.notice({
        sessionID,
        kind: "compact",
        level: "warning",
        title: "Auto-compact failed to start",
        message,
      })
      return
    }
    emitter.notice({
      sessionID,
      kind: "compact",
      level: "info",
      title: "Auto-compact requested",
      message: `~${size} tokens estimated (threshold ${config.compactAtTokens})`,
    })
  }

  /**
   * Compacts at a loop-iteration boundary regardless of the token threshold, so the next iteration starts from a fresh context.
   * Never requested mid-work: a turn executing or background subagents/shells running defers the compaction.
   * Subject to in-flight and cooldown guards; skips tiny contexts. `force` skips only the cooldown — never the in-flight or busy gate.
   */
  async compactAtBoundary(sessionID: string, opts?: { force?: boolean }): Promise<BoundaryCompactResult> {
    const { config, compact, context, emitter, clock, log } = this.deps
    if (!config.compactOnLoopIteration) return { requested: false, reason: "disabled" }
    this.sweepStale()
    if (await this.isBusy(sessionID)) {
      log.info("boundary compact deferred: session has work in flight", { sessionID })
      return { requested: false, reason: "busy" }
    }
    const now = clock.now()
    if (this.inFlight.has(sessionID)) return { requested: false, reason: "in-flight" }
    if (!opts?.force && now - (this.requestedAt.get(sessionID) ?? 0) < REQUEST_COOLDOWN_MS) return { requested: false, reason: "cooldown" }
    let messages: readonly unknown[] | undefined
    try {
      messages = await context(sessionID)
    } catch (error) {
      log.warn("boundary compact: could not read the session context", { sessionID, error: String(error) })
      return { requested: false, reason: "read-failed" }
    }
    const size = estimateContextTokens(messages)
    if (size !== undefined && size < BOUNDARY_MIN_TOKENS) {
      log.info("boundary compact skipped: context is small", { sessionID, size })
      return { requested: false, reason: "too-small" }
    }
    // Same post-read re-check as maybeCompact: never fire over work that started during the context fetch.
    if (await this.isBusy(sessionID)) {
      log.info("boundary compact deferred: session has work in flight", { sessionID })
      return { requested: false, reason: "busy" }
    }
    this.requestedAt.set(sessionID, now)
    this.inFlight.set(sessionID, now)
    try {
      await compact(sessionID)
    } catch (error) {
      this.inFlight.delete(sessionID)
      const message = truncate(errorMessage(error), 160)
      log.warn("boundary compact failed to start", { sessionID, error: message })
      emitter.notice({ sessionID, kind: "compact", level: "warning", title: "Auto-compact failed to start", message })
      return { requested: false, reason: "compact-failed" }
    }
    emitter.notice({
      sessionID,
      kind: "compact",
      level: "info",
      title: "Auto-compact requested (loop boundary)",
      message: size !== undefined ? `~${size} tokens estimated at the loop boundary` : "context size unknown; compacting at the loop boundary",
    })
    return size !== undefined ? { requested: true, estimatedTokens: size } : { requested: true }
  }

  /** Mark the session as compacting; idempotent. */
  noteCompactionStarted(sessionID: string): void {
    this.inFlight.set(sessionID, this.deps.clock.now())
  }

  /** Clear the in-flight marker; on failure, notify. */
  noteCompactionEnded(sessionID: string, ok: boolean, error?: string): void {
    this.inFlight.delete(sessionID)
    this.deps.log.info("auto-compact: compaction ended", { sessionID, ok, ...(error ? { error } : {}) })
    if (ok) return
    this.deps.emitter.notice({
      sessionID,
      kind: "compact",
      level: "warning",
      title: "Auto-compact failed",
      message: truncate(error ?? "unknown error", 160),
    })
  }

  /** Forget all markers for a deleted session. */
  onSessionDeleted(sessionID: string): void {
    this.inFlight.delete(sessionID)
    this.requestedAt.delete(sessionID)
  }
}
