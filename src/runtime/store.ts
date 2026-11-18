import { isLive, selectTerminalRecordsToPrune, type GoalRecord } from "../core/types.ts"
import { sameDirectory } from "../core/wire.ts"
import type { StoragePort } from "./ports.ts"

// Re-exported from core/wire.ts (the boundary-validation module) so existing importers and tests keep working.
export { sameDirectory }

const PREFIX = "goal/v1/"

export const keyFor = (sessionID: string) => `${PREFIX}${sessionID}`

function isRecord(value: unknown): value is GoalRecord {
  if (typeof value !== "object" || value === null) return false
  const r = value as Partial<GoalRecord>
  // `directory` is required by the type but absent on corrupt/legacy records; an unvalidated
  // `sameDirectory()` call would throw and kill the whole bulk restore.
  return (
    r.version === 1 &&
    typeof r.sessionID === "string" &&
    typeof r.condition === "string" &&
    typeof r.status === "string" &&
    typeof r.directory === "string"
  )
}

/**
 * Durable goal persistence on plugin storage, one key per session. Writes per session are chained so they
 * land in order without blocking callers; the in-memory record stays the source of truth.
 *
 * Probe mode (`readOnly`): saves and removes are dropped (and logged via `onError` is NOT called; the caller
 * gets `true` so callers behave as if the write landed). A probe instance (e.g. a headless opencode server
 * booted to exercise the plugin) therefore cannot mutate the live goal records, even by accident. Reads are
 * unaffected.
 */
export class GoalStore {
  private readonly chains = new Map<string, Promise<void>>()

  constructor(
    private readonly storage: StoragePort,
    private readonly onError: (error: unknown) => void,
    private readonly options: { readonly readOnly?: boolean } = {},
  ) {}

  save(record: GoalRecord): Promise<boolean> {
    if (this.options.readOnly) return Promise.resolve(true)
    const snapshot = structuredClone(record)
    return this.enqueue(record.sessionID, () => this.storage.set(keyFor(record.sessionID), snapshot))
  }

  remove(sessionID: string): Promise<boolean> {
    if (this.options.readOnly) return Promise.resolve(true)
    return this.enqueue(sessionID, () => this.storage.remove(keyFor(sessionID)))
  }

  /** Reads one record; undefined when missing or malformed. */
  async load(sessionID: string): Promise<GoalRecord | undefined> {
    const value = await this.storage.get(keyFor(sessionID)).catch(() => undefined)
    return isRecord(value) ? value : undefined
  }

  /**
   * Restore-time hygiene across the whole store: apply the same age/count caps per directory to every directory
   * at plugin storage, not just the calling controller's own. Scans once, groups terminal records by their
   * `directory`, and applies `selectTerminalRecordsToPrune` to each group independently (a cap in one directory
   * never evicts another directory's records). Live records (active/paused) are never touched anywhere.
   * Oldest entries go first; reports exactly what it did (counts only — the dropped records are gone by design).
   * `directories` counts every directory that had at least one record (live or terminal) in the scan.
   * In probe mode (`readOnly`) nothing is removed and the report says so.
   */
  async pruneAllDirectories(
    nowMs: number,
  ): Promise<{ scanned: number; pruned: number; droppedAged: number; droppedBeyondCap: number; unstampedKept: number; readOnly: boolean; directories: number }> {
    const byDirectory = new Map<string, GoalRecord[]>()
    let after: string | undefined
    do {
      const page = await this.storage.scan({ prefix: PREFIX, limit: 200, ...(after ? { after } : {}) })
      for (const entry of page.entries) {
        if (!isRecord(entry.value)) continue
        const dir = entry.value.directory
        const list = byDirectory.get(dir)
        if (list) list.push(entry.value)
        else byDirectory.set(dir, [entry.value])
      }
      after = page.next
    } while (after)
    let scanned = 0
    let unstampedKept = 0
    let droppedAged = 0
    let droppedBeyondCap = 0
    const pruned: string[] = []
    for (const records of byDirectory.values()) {
      const selection = selectTerminalRecordsToPrune(records, nowMs)
      scanned += selection.offered
      unstampedKept += selection.unstampedKept
      droppedAged += selection.droppedAged
      droppedBeyondCap += selection.droppedBeyondCap
      pruned.push(...selection.pruned)
    }
    if (this.options.readOnly)
      return { scanned, pruned: 0, droppedAged: 0, droppedBeyondCap: 0, unstampedKept, readOnly: true, directories: byDirectory.size }
    for (const sessionID of pruned) await this.remove(sessionID)
    return { scanned, pruned: pruned.length, droppedAged, droppedBeyondCap, unstampedKept, readOnly: false, directories: byDirectory.size }
  }

  /** Live goals owned by `directory`, for restore after a restart or plugin reload. */
  async loadLive(directory: string): Promise<GoalRecord[]> {
    const found: GoalRecord[] = []
    let after: string | undefined
    do {
      const page = await this.storage.scan({ prefix: PREFIX, limit: 200, ...(after ? { after } : {}) })
      for (const entry of page.entries)
        if (isRecord(entry.value) && isLive(entry.value.status) && sameDirectory(entry.value.directory, directory)) found.push(entry.value)
      after = page.next
    } while (after)
    return found
  }

  /** Resolves once every queued write has settled. */
  async flush(): Promise<void> {
    await Promise.all(this.chains.values())
  }

  /**
   * Every queued write resolves with whether it landed. The onError hook observes failures for logging; a throwing
   * hook must not wedge the chain or surface as an unhandled rejection, so both are fenced off here.
   */
  private enqueue(sessionID: string, write: () => Promise<void>): Promise<boolean> {
    const previous = this.chains.get(sessionID) ?? Promise.resolve()
    const run = previous.then(async () => {
      try {
        await write()
        return true
      } catch (error) {
        try {
          this.onError(error)
        } catch {
          // A throwing error hook is not allowed to break write ordering.
        }
        return false
      }
    })
    const chain = run.then(() => {})
    this.chains.set(sessionID, chain)
    void chain.then(() => {
      if (this.chains.get(sessionID) === chain) this.chains.delete(sessionID)
    })
    return run
  }
}
