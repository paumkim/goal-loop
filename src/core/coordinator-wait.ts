/**
 * Coordinator merge-turn standby: the durable record an agent parks on after `coordinator submit`, and the
 * pure FIFO check that decides when the system should wake it.
 *
 * An agent used to "drain the merge queue itself": poll `merge-status`, then poll `merge-next --wait` until its
 * lease reached the head. That is busy work for the model and a whole turn spent on plumbing. With standby, the
 * agent submits, registers a wait, and ends its turn. The plugin watches the same coordinator state file the CLI
 * writes; when the parked lease becomes the FIFO head and no merge holds the lock, it sends the agent a message
 * through the existing functional message/session system, which wakes the session into its merge turn.
 *
 * Nothing here polls on the agent's behalf inside a turn: the watcher is a cheap background tick in the plugin,
 * and the wake is one `session.prompt`, the same delivery path `goal_msg_send` already uses.
 */
import { readFile } from "node:fs/promises"
import type { BackgroundPort } from "../runtime/ports.ts"

/** Storage prefix for standby records, deliberately separate from goal records and agent messages. */
export const STANDBY_PREFIX = "goal/standby/v1/"

export interface StandbyRecord {
  /** Submitted lease the agent is waiting to land. */
  readonly slug: string
  /** Message address of the waiting agent (its parent session id). */
  readonly address: string
  /** When the agent parked, epoch ms. */
  readonly at: number
}

export const standbyKey = (sessionID: string): string => `${STANDBY_PREFIX}${sessionID}`

export function isStandbyRecord(value: unknown): value is StandbyRecord {
  if (typeof value !== "object" || value === null) return false
  const r = value as Partial<StandbyRecord>
  return typeof r.slug === "string" && r.slug !== "" && typeof r.address === "string" && typeof r.at === "number"
}

/** Structural view of coordinator state; the CLI writes more fields, none of which matter to the wake check. */
export interface CoordinatorLease {
  readonly status?: unknown
  readonly submittedAt?: unknown
  readonly createdAt?: unknown
}
export interface CoordinatorState {
  readonly leases?: Record<string, CoordinatorLease>
  readonly mergeLock?: unknown
}

const turnStamp = (lease: CoordinatorLease | undefined): string => {
  if (!lease) return ""
  if (typeof lease.submittedAt === "string") return lease.submittedAt
  if (typeof lease.createdAt === "string") return lease.createdAt
  return ""
}

/**
 * Oldest submitted lease: the same key the coordinator's `merge-next` FIFO guard uses
 * (`sort_by(.value.submittedAt // .value.createdAt // "")`). `Object.entries` keeps JSON insertion order, so
 * equal stamps tie the same way jq's stable sort does.
 */
export function fifoHead(state: CoordinatorState): string | undefined {
  const leases = state.leases
  if (!leases || typeof leases !== "object") return undefined
  const submitted = Object.entries(leases)
    .filter(([, lease]) => lease && lease.status === "submitted")
    .sort(([, a], [, b]) => turnStamp(a).localeCompare(turnStamp(b)))
  return submitted[0]?.[0]
}

/**
 * True exactly when `slug` is the next lease the coordinator will land. A live merge lock defers the wake:
 * `merge-next` would refuse the lock anyway, and waking early would spend the resumed turn on another wait.
 */
export function isMergeTurn(state: CoordinatorState, slug: string): boolean {
  const lease = state.leases?.[slug]
  if (!lease || lease.status !== "submitted") return false
  if (state.mergeLock !== null && state.mergeLock !== undefined) return false
  return fifoHead(state) === slug
}

/**
 * Recognize the coordinator's `submitted wt/<slug>` line in a completed shell result. This is the delegation
 * flow's own signal: a worker that just submitted is the worker that has to stand by, whether or not it also
 * called `goal_standby`. Only the exact submit output counts — a transcript mention or a failed call does not.
 */
export function standbySlugFromSubmitOutput(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  const { output, content } = result as { output?: unknown; content?: unknown }
  const text =
    typeof output === "string"
      ? output
      : Array.isArray(content)
        ? content
            .map((part) => (part && typeof part === "object" ? (part as { text?: unknown }).text : undefined))
            .filter((part): part is string => typeof part === "string")
            .join("\n")
        : ""
  return /\bsubmitted wt\/([a-z0-9][a-z0-9-]*)\b/.exec(text)?.[1]
}

/**
 * A parked agent is still active work, not a stale session: the goal is live and the agent is waiting on a
 * submitted lease, so the evaluator must abstain instead of judging mid-wait. `GoalController.isActive` is that
 * signal, and it reads `BackgroundPort.busy`, so standby contributes one virtual worker there. This wrapper is
 * installed only on the controller's port — the compactor keeps the real tracker, whose job is physical work.
 */
export function withStandbyActivity(background: BackgroundPort, isStandby: (sessionID: string) => boolean): BackgroundPort {
  const ancestorsOf = background.ancestorsOf
  return {
    busy: async (sessionID) => {
      const work = await background.busy(sessionID)
      return isStandby(sessionID) ? { subagents: work.subagents + 1, shells: work.shells } : work
    },
    ...(ancestorsOf ? { ancestorsOf: (sessionID: string) => ancestorsOf.call(background, sessionID) } : {}),
  }
}

/** Read and minimally validate coordinator state. Any failure is "no turn yet", never a wake. */
export async function readCoordinatorState(statePath: string): Promise<CoordinatorState | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(statePath, "utf8"))
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    const leases = (value as { leases?: unknown }).leases
    if (leases !== undefined && (typeof leases !== "object" || leases === null || Array.isArray(leases))) return undefined
    return value as CoordinatorState
  } catch {
    return undefined
  }
}
