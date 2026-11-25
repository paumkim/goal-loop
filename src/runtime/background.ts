import type { BackgroundPort, BackgroundWork } from "./ports.ts"

interface BackgroundDeps {
  /** Parent session ID, or undefined for a root session. */
  parentOf(sessionID: string): Promise<string | undefined>
}

const MAX_DEPTH = 6

/**
 * Knows whether a session still has background work: running descendant sessions (subagents) or running shells
 * it started. Everything is fed from the event stream; parent links are immutable, so they are cached and only
 * looked up for sessions created before the plugin started listening.
 */
export class BackgroundTracker implements BackgroundPort {
  private readonly running = new Set<string>()
  private readonly shells = new Map<string, string>()
  private readonly parents = new Map<string, string | null>()
  /**
   * Sessions goal-loop itself spawned, keyed by session id with the agent identity as the value. Both the judge
   * and the arm-time planner are parent-linked children of the goal owner, so without this registry `busy()` would
   * count them as workers the parent delegated and is waiting on — the evaluator would defer on its own verdict
   * child (or on the planner) instead of judging the finished turn. Registration is explicit and by id: a worker
   * session that happens to run the same agent is still counted.
   */
  private readonly internal = new Map<string, string>()

  constructor(private readonly deps: BackgroundDeps) {}

  /** Mark a session as goal-loop-owned machinery, not a delegated worker. Idempotent for a reused child. */
  noteInternal(sessionID: string, agent: string): void {
    this.internal.set(sessionID, agent)
  }

  forgetInternal(sessionID: string): void {
    this.internal.delete(sessionID)
  }

  /** Agent identity of a goal-loop-owned session; undefined for a real worker session. */
  internalAgentOf(sessionID: string): string | undefined {
    return this.internal.get(sessionID)
  }

  executionStarted(sessionID: string) {
    this.running.add(sessionID)
  }

  executionEnded(sessionID: string) {
    this.running.delete(sessionID)
  }

  sessionCreated(sessionID: string, parentID: string | undefined) {
    this.parents.set(sessionID, parentID ?? null)
  }

  sessionDeleted(sessionID: string) {
    this.running.delete(sessionID)
    this.parents.delete(sessionID)
    this.forgetInternal(sessionID)
    for (const [id, owner] of this.shells) if (owner === sessionID) this.shells.delete(id)
  }

  shellCreated(id: string, status: string, owner: unknown) {
    if (status === "running" && typeof owner === "string") this.shells.set(id, owner)
  }

  shellUpdated(id: string, status: string, owner: unknown) {
    if (status === "running") {
      // Running with a known owner: track it. Running without an owner: keep any existing entry.
      if (typeof owner === "string") this.shells.set(id, owner)
      return
    }
    // No status at all (a metadata-only update): keep tracking — the same defensive posture as the
    // owner branch. `shell.exited`/`shell.deleted` always end the shell explicitly.
    if (status === "") return
    this.shells.delete(id)
  }

  shellEnded(id: string) {
    this.shells.delete(id)
  }

  /**
   * Addresses of other parent agents known to be alive, i.e. the parent session id of every session that is
   * not in this session's own family. An address is the session's parent id (`agentIdFor` in the plugin), or
   * the session id itself for a root. Goal-loop's own children (judge, planner) are machinery, not peers.
   *
   * Read-only and in-memory: derived from immutable `parentID` links delivered by `session.created` and
   * removed by `session.deleted`. No storage scan, no message bodies, no host calls — a probe instance can
   * surface the same hint without writing anything.
   */
  otherParentAddresses(exclude: string): readonly string[] {
    const out = new Set<string>()
    for (const [id, parent] of this.parents) {
      if (id === exclude || this.internal.has(id)) continue
      const address = parent && parent !== id ? parent : id
      if (address !== exclude) out.add(address)
    }
    return [...out]
  }

  /** Ancestor session ids, nearest first. Cached links are immutable; depth is capped like `descendsFrom`. */
  async ancestorsOf(sessionID: string): Promise<readonly string[]> {
    const ancestors: string[] = []
    let current: string | undefined = sessionID
    for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
      const parent = await this.parent(current)
      if (!parent) break
      ancestors.push(parent)
      current = parent
    }
    return ancestors
  }

  async busy(sessionID: string): Promise<BackgroundWork> {
    let shells = 0
    for (const owner of this.shells.values()) if (owner === sessionID) shells++
    // Exclude goal-loop's own children (judge, planner). They descend from the goal owner but are machinery,
    // not background work the owner delegated and is waiting on; counting them self-defers the verdict.
    const others = [...this.running].filter((id) => id !== sessionID && !this.internal.has(id))
    if (others.length === 0) return { subagents: 0, shells }
    const checks = await Promise.all(others.map((id) => this.descendsFrom(id, sessionID)))
    return { subagents: checks.filter(Boolean).length, shells }
  }

  private async descendsFrom(sessionID: string, ancestor: string): Promise<boolean> {
    let current: string | undefined = sessionID
    for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
      const parent = await this.parent(current)
      if (parent === ancestor) return true
      current = parent
    }
    return false
  }

  private async parent(sessionID: string): Promise<string | undefined> {
    const cached = this.parents.get(sessionID)
    if (cached !== undefined) return cached ?? undefined
    try {
      const parent = await this.deps.parentOf(sessionID)
      this.parents.set(sessionID, parent ?? null)
      return parent
    } catch {
      // Not cached: a failed lookup must not mark a subagent as a root forever.
      return undefined
    }
  }
}
