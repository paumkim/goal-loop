import type { FailureInfo } from "../core/types.ts"
import type { BackgroundTracker } from "./background.ts"
import type { GoalController } from "./controller.ts"
import type { Logger } from "./ports.ts"
import type { AutoCompactor } from "./compactor.ts"

/** Minimal structural view of a server event; payloads are read defensively. */
export interface ServerEvent {
  readonly id?: string
  readonly type: string
  readonly data?: unknown
  /** The host stamps most events with the directory of the session that produced them (OpenCode `location`). */
  readonly location?: { readonly directory?: string }
  /** Monotonic host sequence; used to reject a late event that would move a goal back to an old checkout. */
  readonly durable?: { readonly seq?: number }
}

type Data = Record<string, unknown>

/** Narrows a destructured payload field to a plain object for nested reads (shell info/metadata). */
const asRecord = (value: unknown): Data => (typeof value === "object" && value !== null ? (value as Data) : {})

/** Remembers recently seen event IDs so a stream reconnect that replays events cannot double-fire a turn. */
class RecentIds {
  private readonly seen = new Set<string>()
  constructor(private readonly capacity = 1024) {}

  /** Returns false if the ID was already seen. */
  add(id: string | undefined): boolean {
    if (!id) return true
    if (this.seen.has(id)) return false
    this.seen.add(id)
    if (this.seen.size > this.capacity) this.seen.delete(this.seen.values().next().value as string)
    return true
  }
}

/**
 * How long a harness child's completion may precede its owner's wake turn and still count as that wake.
 * A user prompt arriving later is a real turn and must still be evaluated.
 */
const INTERNAL_WAKE_WINDOW_MS = 5_000

/** Fans one server event out to the background tracker and the goal controller. */
export function createRouter(input: { controller: GoalController; background: BackgroundTracker; log: Logger; compactor: AutoCompactor }) {
  const { controller, background, log, compactor } = input
  const recent = new RecentIds()
  const fail = (error: unknown) => log.error("goal event handler failed", { error: String(error) })
  /** Parent links from `session.created`, read synchronously when a child completes (the host lookup is async). */
  const childParents = new Map<string, string>()
  /** Owner sessions whose harness child just completed, stamped so a late wake cannot consume a real turn. */
  const wakePending = new Map<string, number>()
  /** Owner sessions whose current execution is that injected wake: its succeeded is not a turn to judge. */
  const wakeRunning = new Set<string>()

  /**
   * One safety rule for every handler, sync or async: a throwing handler is reported via `fail` and never
   * propagates into the event stream. Sync throws are caught at call time; async rejections are chained.
   */
  const guard = (fn: () => void | Promise<unknown>) => {
    try {
      const out = fn()
      if (out) void Promise.resolve(out).catch(fail)
    } catch (error) {
      fail(error)
    }
  }

  return (event: ServerEvent) => {
    if (!recent.add(event.id)) return
    const data = (event.data ?? {}) as Data
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
    // A goal belongs to the session that armed it, so the directory that matters is the session's current
    // one, not the directory captured when this plugin instance was set up. The host carries it on the event
    // (top-level `location`) and, for `session.moved`, inside `data.location` too — accept both shapes.
    const locationData = asRecord(data.location)
    const envelopeDirectory = typeof event.location?.directory === "string" ? event.location.directory : undefined
    const dataDirectory = typeof locationData.directory === "string" ? locationData.directory : undefined
    // For `session.moved` the destination lives in `data.location`. The envelope `location` is stamped from
    // the producer's location at publish time and can be the PRE-move directory (the host bus itself keys the
    // move transition off `data.location`), so prefer the data copy for moves; other events keep the old
    // envelope-first precedence.
    const locationDirectory = event.type === "session.moved" ? (dataDirectory ?? envelopeDirectory) : (envelopeDirectory ?? dataDirectory)
    const seq = typeof event.durable?.seq === "number" ? event.durable.seq : undefined
    if (event.type !== "session.moved" && sessionID && locationDirectory)
      guard(() => controller.noteSessionDirectory(sessionID, locationDirectory, "event", seq))
    switch (event.type) {
      case "session.moved":
        // The goal follows the session: move its record to the new checkout before anything else runs.
        if (sessionID && locationDirectory) guard(() => controller.onSessionMoved(sessionID, locationDirectory, seq))
        return
      case "session.execution.started":
        if (!sessionID) return
        return guard(() => {
          // The host wakes a goal owner when one of its harness children completes. That turn is plumbing,
          // not work: judging it spawned a second evaluator and a continuation steer after the verdict had
          // already landed. Consume the pending wake only inside the window so a later user turn is judged.
          const at = wakePending.get(sessionID)
          if (at !== undefined) {
            wakePending.delete(sessionID)
            if (Date.now() - at <= INTERNAL_WAKE_WINDOW_MS) wakeRunning.add(sessionID)
          }
          background.executionStarted(sessionID)
          controller.onExecutionStarted(sessionID)
        })
      case "session.tool.called":
        if (sessionID) guard(() => controller.onToolCalled(sessionID))
        return
      case "session.execution.succeeded":
        if (!sessionID) return
        // A parent-linked evaluator/planner child finished. Its completion report will wake the owner;
        // remember the owner now, from the cached parent link, before that wake's started event arrives.
        if (background.internalAgentOf(sessionID) !== undefined) {
          const owner = childParents.get(sessionID)
          if (owner) wakePending.set(owner, Date.now())
        }
        guard(() => background.executionEnded(sessionID))
        guard(() => compactor.maybeCompact(sessionID))
        // The owner's wake turn carries no new work. Drop this one succeeded without judging a second verdict;
        // the child's own succeeded above still routes normally and can drain a genuinely deferred evaluation.
        if (wakeRunning.delete(sessionID)) return
        guard(() => controller.onExecutionSucceeded(sessionID))
        // Background work may have just ended — re-run any evaluation this session deferred on it.
        return guard(() => controller.onBackgroundDrained())
      case "session.execution.failed":
        if (!sessionID) return
        wakeRunning.delete(sessionID)
        guard(() => {
          background.executionEnded(sessionID)
          controller.onExecutionFailed(sessionID, data.error as FailureInfo | undefined)
        })
        return guard(() => controller.onBackgroundDrained())
      case "session.execution.interrupted":
        if (!sessionID) return
        wakeRunning.delete(sessionID)
        guard(() => {
          background.executionEnded(sessionID)
          controller.onExecutionInterrupted(sessionID, String(data.reason ?? "user"))
        })
        return guard(() => controller.onBackgroundDrained())
      case "session.created":
        if (sessionID) {
          const parent = typeof data.parentID === "string" ? data.parentID : undefined
          if (parent) childParents.set(sessionID, parent)
          guard(() => background.sessionCreated(sessionID, parent))
        }
        return
      case "session.deleted":
        if (!sessionID) return
        childParents.delete(sessionID)
        wakePending.delete(sessionID)
        wakeRunning.delete(sessionID)
        guard(() => {
          background.sessionDeleted(sessionID)
          controller.onSessionDeleted(sessionID)
          compactor.onSessionDeleted(sessionID)
        })
        return guard(() => controller.onBackgroundDrained())
      case "session.compaction.started":
        if (sessionID) guard(() => compactor.noteCompactionStarted(sessionID))
        return
      case "session.compaction.ended":
        if (!sessionID) return
        guard(() => compactor.noteCompactionEnded(sessionID, true))
        // A landed compaction also settles any pending loop-boundary request.
        return guard(() => controller.onCompactionLanded(sessionID))
      case "session.compaction.failed":
        if (sessionID)
          guard(() => {
            const raw = data.error
            const message =
              typeof raw === "string"
                ? raw
                : typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>).message === "string"
                  ? String((raw as Record<string, unknown>).message)
                  : undefined
            compactor.noteCompactionEnded(sessionID, false, message)
          })
        return
      case "shell.created": {
        // Mirror shell.updated: the id/owner/status may ride `info` or the event's top-level `data`.
        // Reading only `info` dropped a created event whose id lived at the top level — the shell never
        // registered, so busy() undercounted and the evaluator could run while a shell was still live.
        const info = asRecord(data.info ?? data)
        const createdId = typeof info.id === "string" ? info.id : typeof data.id === "string" ? data.id : undefined
        const owner = asRecord(info.metadata).sessionID ?? asRecord(data.metadata).sessionID
        if (createdId) guard(() => background.shellCreated(createdId, String(info.status ?? data.status ?? ""), owner))
        return
      }
      case "shell.updated": {
        const info = asRecord(data.info ?? data)
        const id = typeof info.id === "string" ? info.id : typeof data.id === "string" ? data.id : undefined
        const owner = asRecord(info.metadata).sessionID ?? asRecord(data.metadata).sessionID
        if (id) guard(() => background.shellUpdated(id, String(info.status ?? data.status ?? ""), owner))
        return guard(() => controller.onBackgroundDrained())
      }
      case "shell.exited":
      case "shell.deleted": {
        // Exited/deleted always ends the shell, regardless of any status field on the event.
        const info = asRecord(data.info)
        const id = typeof data.id === "string" ? data.id : typeof info.id === "string" ? info.id : undefined
        if (id) guard(() => background.shellEnded(id))
        return guard(() => controller.onBackgroundDrained())
      }
    }
  }
}
