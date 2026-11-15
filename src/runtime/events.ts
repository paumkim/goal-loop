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

/** Fans one server event out to the background tracker and the goal controller. */
export function createRouter(input: { controller: GoalController; background: BackgroundTracker; log: Logger; compactor: AutoCompactor }) {
  const { controller, background, log, compactor } = input
  const recent = new RecentIds()
  const fail = (error: unknown) => log.error("goal event handler failed", { error: String(error) })

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
    switch (event.type) {
      case "session.execution.started":
        if (!sessionID) return
        return guard(() => {
          background.executionStarted(sessionID)
          controller.onExecutionStarted(sessionID)
        })
      case "session.tool.called":
        if (sessionID) guard(() => controller.onToolCalled(sessionID))
        return
      case "session.execution.succeeded":
        if (!sessionID) return
        guard(() => background.executionEnded(sessionID))
        guard(() => compactor.maybeCompact(sessionID))
        return guard(() => controller.onExecutionSucceeded(sessionID))
      case "session.execution.failed":
        if (!sessionID) return
        return guard(() => {
          background.executionEnded(sessionID)
          controller.onExecutionFailed(sessionID, data.error as FailureInfo | undefined)
        })
      case "session.execution.interrupted":
        if (!sessionID) return
        return guard(() => {
          background.executionEnded(sessionID)
          controller.onExecutionInterrupted(sessionID, String(data.reason ?? "user"))
        })
      case "session.created":
        if (sessionID) guard(() => background.sessionCreated(sessionID, typeof data.parentID === "string" ? data.parentID : undefined))
        return
      case "session.deleted":
        if (!sessionID) return
        return guard(() => {
          background.sessionDeleted(sessionID)
          controller.onSessionDeleted(sessionID)
          compactor.onSessionDeleted(sessionID)
        })
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
        const info = asRecord(data.info)
        const createdId = typeof info.id === "string" ? info.id : undefined
        if (createdId) guard(() => background.shellCreated(createdId, String(info.status), asRecord(info.metadata).sessionID))
        return
      }
      case "shell.updated": {
        const info = asRecord(data.info ?? data)
        const id = typeof info.id === "string" ? info.id : typeof data.id === "string" ? data.id : undefined
        const owner = asRecord(info.metadata).sessionID ?? asRecord(data.metadata).sessionID
        if (id) guard(() => background.shellUpdated(id, String(info.status ?? data.status ?? ""), owner))
        return
      }
      case "shell.exited":
      case "shell.deleted": {
        // Exited/deleted always ends the shell, regardless of any status field on the event.
        const info = asRecord(data.info)
        const id = typeof data.id === "string" ? data.id : typeof info.id === "string" ? info.id : undefined
        if (id) guard(() => background.shellEnded(id))
        return
      }
    }
  }
}
