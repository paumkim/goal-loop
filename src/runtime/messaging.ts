/**
 * Minimal agent-to-agent messaging for parallel goal-loop sessions.
 *
 * The address of an agent is the session id of its parent agent: a top-level session uses its own id, and a
 * worker subagent uses the id of the session that spawned it (`parentID`). That makes each distinct parent
 * agent both a sender and a receiver — a worker can send as its parent, and a reply addressed to that parent
 * lands in the same inbox. Messages live in plugin storage, one inbox per parent session id, so they survive
 * a turn boundary and are visible from every session in the host.
 *
 * This module is instantiated inside the goal-loop plugin's `setup()`, so the whole system exists only while
 * the goal-plugin is enabled. No standalone service, no routing table, no delivery guarantees beyond a
 * durable per-inbox queue: send appends, read drains.
 */
import type { Clock, StoragePort } from "./ports.ts"

/** Storage prefix, deliberately separate from `goal/v1/` goal records. */
export const MESSAGE_PREFIX = "goal/msg/v1/"

/** Bound an inbox so a forgotten address cannot grow storage without limit. Oldest messages drop first. */
export const MAX_MESSAGES_PER_INBOX = 100

export interface AgentMessage {
  /** Sender's parent agent session id. */
  readonly from: string
  /** Recipient's parent agent session id (the inbox key). */
  readonly to: string
  readonly text: string
  readonly at: number
  readonly id: string
}

function isMessage(value: unknown): value is AgentMessage {
  if (typeof value !== "object" || value === null) return false
  const m = value as Partial<AgentMessage>
  return (
    typeof m.id === "string" &&
    typeof m.from === "string" &&
    typeof m.to === "string" &&
    typeof m.text === "string" &&
    typeof m.at === "number"
  )
}

/**
 * Durable, per-recipient message queues on plugin storage.
 *
 * Writes to one inbox are chained so two senders finishing in either order cannot lose each other's message.
 * Probe mode (`readOnly`) drops writes and drains and reports counts as zero, matching `GoalStore`: a probe
 * instance must not mutate live session data.
 */
export class AgentMessaging {
  private readonly chains = new Map<string, Promise<unknown>>()
  private sequence = 0

  constructor(
    private readonly storage: StoragePort,
    private readonly clock: Clock,
    private readonly options: { readonly readOnly?: boolean } = {},
  ) {}

  keyFor(agentID: string): string {
    return `${MESSAGE_PREFIX}${agentID}`
  }

  /** Append a message to `to`'s inbox, tagged with `from`. Returns the stored message. */
  send(from: string, to: string, text: string): Promise<AgentMessage> {
    if (this.options.readOnly) {
      return Promise.resolve(this.compose(from, to, text))
    }
    return this.enqueue(to, async () => {
      const inbox = await this.load(to)
      const message = this.compose(from, to, text)
      const next = [...inbox, message].slice(-MAX_MESSAGES_PER_INBOX)
      await this.storage.set(this.keyFor(to), next)
      return message
    })
  }

  /** Number of messages waiting for `agentID`. Used for the unread hint in the context hook. */
  async count(agentID: string): Promise<number> {
    if (this.options.readOnly) return 0
    return (await this.load(agentID)).length
  }

  /** Return all messages for `agentID` and clear its inbox in one chained write. */
  drain(agentID: string): Promise<readonly AgentMessage[]> {
    if (this.options.readOnly) return Promise.resolve([])
    return this.enqueue(agentID, async () => {
      const inbox = await this.load(agentID)
      if (inbox.length > 0) await this.storage.set(this.keyFor(agentID), [])
      return inbox
    })
  }

  private compose(from: string, to: string, text: string): AgentMessage {
    const at = this.clock.now()
    return { id: `${at.toString(36)}-${(this.sequence++).toString(36)}`, from, to, text, at }
  }

  private async load(agentID: string): Promise<AgentMessage[]> {
    const value = await this.storage.get(this.keyFor(agentID)).catch(() => undefined)
    if (!Array.isArray(value)) return []
    return value.filter(isMessage)
  }

  /** Serialize writes per inbox; a failure is logged by the caller's storage adapter and never wedges the chain. */
  private enqueue<T>(agentID: string, write: () => Promise<T>): Promise<T> {
    const key = this.keyFor(agentID)
    const previous = this.chains.get(key) ?? Promise.resolve()
    const run = previous.then(write, write)
    const chain = run.then(() => {}, () => {})
    this.chains.set(key, chain)
    void chain.then(() => {
      if (this.chains.get(key) === chain) this.chains.delete(key)
    })
    return run
  }
}
