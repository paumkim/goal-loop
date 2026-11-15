/**
 * Plugin-managed auto-compaction. When the estimated model-visible context of a session is at or above a
 * configurable absolute token threshold, the plugin itself asks the host to compact the session. This is a
 * window-independent complement to opencode's window-relative `compaction.buffer`.
 *
 * All guards are timestamp-based; the compactor keeps no timers alive.
 */
import { estimateContextTokens } from "../core/context-size.ts"
import type { GoalConfig } from "../core/config.ts"
import { errorMessage } from "../core/errors.ts"
import { truncate } from "../core/format.ts"
import type { Clock, EmitterPort, Logger } from "./ports.ts"

export interface CompactorDeps {
  readonly config: GoalConfig
  readonly compact: (sessionID: string) => Promise<void>
  readonly context: (sessionID: string) => Promise<readonly unknown[]>
  readonly emitter: EmitterPort
  readonly clock: Clock
  readonly log: Logger
}

/** Minimum gap between compact requests for the same session. */
const REQUEST_COOLDOWN_MS = 120_000
/** An in-flight entry older than this is considered lost and swept. */
const INFLIGHT_STALE_MS = 10 * 60_000

export class AutoCompactor {
  private readonly inFlight = new Map<string, number>()
  private readonly requestedAt = new Map<string, number>()

  constructor(private readonly deps: CompactorDeps) {}

  /** Compact the session when the estimated context is at or above `config.compactAtTokens`. */
  async maybeCompact(sessionID: string): Promise<void> {
    const { config, compact, context, emitter, clock, log } = this.deps
    if (config.compactAtTokens <= 0) return
    const now = clock.now()
    // Sweep stale in-flight entries; a compaction that never reported back is presumed lost.
    for (const [id, at] of this.inFlight) if (now - at >= INFLIGHT_STALE_MS) this.inFlight.delete(id)
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
