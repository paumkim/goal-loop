/**
 * The stale-chrome guard's re-pull, extracted pure: the TUI tick re-fetches sessions whose cached
 * snapshot still reads live but has not been proven fresh for STALE_LIVE_ENTRY_MS, so one dropped
 * `changed` event can no longer strand the ambient pill on "goal checking · Nm" past the guard's
 * cadence. The returned function is async by construction and NEVER throws synchronously: an RPC
 * rejection, an unparseable payload (resolves false), a host-lookup throw and a `put` failure all
 * surface inside the promise, so the caller's `.catch(() => {})` is the real boundary. Before this
 * module existed, `refresh` in src/tui.tsx was an arrow whose body evaluated `rpc.get(...)` — with
 * the `at(sessionID)` host lookup — at call time: a synchronous host throw escaped before `.catch`
 * existed, broke the guard's re-pull for-loop at the first affected session, and the strand was
 * silent. Pure wiring; the I/O lives at the call site.
 */
import { parseGetGoalOutput } from "./wire.ts"
import type { GoalSnapshot } from "./types.ts"

export interface GoalRefreshDeps {
  /** Fetch the session's current snapshot from the server. May reject (RPC failure) — the caller treats it as "try again next tick". */
  readonly get: (sessionID: string) => Promise<unknown>
  /** Feed a parsed snapshot (or an explicit null) into the TUI's normal `changed` intake — the live→terminal transition arms the acknowledgment pill there. */
  readonly put: (sessionID: string, goal: GoalSnapshot | null) => void
}

/**
 * Builds the re-pull. Resolves false when the payload is malformed — treated exactly like a rejection
 * (stale chrome must never pass as fresh, but the entry stays cached and the next tick retries).
 */
export const makeGoalRefresh = (deps: GoalRefreshDeps): ((sessionID: string) => Promise<boolean>) =>
  async (sessionID) => {
    const output = parseGetGoalOutput(await deps.get(sessionID))
    if (!output) return false
    deps.put(sessionID, output.goal)
    return true
  }
