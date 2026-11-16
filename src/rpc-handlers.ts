import { errorMessage } from "./core/errors.ts"
import type { GoalSnapshot, UsageSnapshot } from "./core/types.ts"
import { isRecord } from "./core/wire.ts"
import type { Logger } from "./runtime/ports.ts"

/** Structural view of the controller surface the RPC handlers need (GoalController satisfies it). */
export interface RpcGoalController {
  restoreOne(sessionID: string): Promise<boolean>
  restore(options?: { boundaryCompact?: boolean }): Promise<number>
  snapshot(sessionID: string, spend?: UsageSnapshot, contextSize?: number): GoalSnapshot | null
  spend(sessionID: string): Promise<UsageSnapshot | undefined>
  /** Absolute estimated prompt tokens; implementations without a context estimate simply omit it. */
  contextSize?(sessionID: string): Promise<number | undefined>
  list(): GoalSnapshot[]
  status(sessionID: string): Promise<void>
  clear(sessionID: string): boolean
}

const sessionIDOf = (input: unknown): string => {
  const id = isRecord(input) ? input.sessionID : undefined
  if (typeof id !== "string" || id === "") throw new Error("sessionID is required")
  return id
}

/**
 * Builds the RPC handlers for the goal plugin. Every handler is total: a missing or malformed input,
 * a broken controller or a storage failure yields a benign fallback (`goal: null`, `goals: []`, `cleared: false`)
 * instead of an exception that surfaces to the client as an HTTP 500.
 */
export function createRpcHandlers(deps: { controller: RpcGoalController; log: Logger }) {
  const { controller, log } = deps
  const warn = (what: string, error: unknown) => log.warn(`goal rpc ${what} failed`, { error: errorMessage(error) })

  const get = async (input: unknown): Promise<{ goal: GoalSnapshot | null }> => {
    try {
      const sessionID = sessionIDOf(input)
      // Read-through: after a plugin reload the in-memory map can miss a live goal that storage still holds.
      await controller.restoreOne(sessionID).catch((error) => warn("restore-one", error))
      const spend = await controller.spend(sessionID).catch(() => undefined)
      // Optional so lightweight implementations of the controller surface keep working.
      const contextSize = await controller.contextSize?.(sessionID).catch(() => undefined)
      return { goal: controller.snapshot(sessionID, spend, contextSize) }
    } catch (error) {
      warn("get", error)
      return { goal: null }
    }
  }

  const list = async (): Promise<{ goals: GoalSnapshot[] }> => {
    try {
      let goals = controller.list()
      // Empty list can mean in-memory records only (post-reload): restore from storage once before answering.
      if (goals.length === 0) {
        // Read-only answer: adopt records from storage without asking the host to compact anything.
        await controller.restore({ boundaryCompact: false }).catch((error) => warn("restore", error))
        goals = controller.list()
      }
      return { goals }
    } catch (error) {
      warn("list", error)
      return { goals: [] }
    }
  }

  const status = async (input: unknown): Promise<Record<string, never>> => {
    try {
      await controller.status(sessionIDOf(input))
    } catch (error) {
      warn("status", error)
    }
    return {}
  }

  const clear = async (input: unknown): Promise<{ cleared: boolean }> => {
    try {
      return { cleared: controller.clear(sessionIDOf(input)) }
    } catch (error) {
      warn("clear", error)
      return { cleared: false }
    }
  }

  return { get, list, status, clear }
}

