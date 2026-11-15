/**
 * Bounded cache of per-session goal snapshots for the TUI. The "changed" RPC stream pushes a `changed`
 * event per session; over a long TUI session the map would grow without bound. Pruning runs inline in
 * the put path (no timers): null-valued entries are dropped unless an open dialog is rendering that
 * session, and the map is capped — oldest non-live entries are evicted first, live (active/paused)
 * entries are never evicted by the cap.
 */
import { isLive, type GoalSnapshot } from "./types.ts"

export interface GoalSnapshotCacheEntry {
  readonly goal: GoalSnapshot | null
  /** Client clock when the snapshot arrived; elapsed time is extrapolated from it to avoid clock skew. */
  readonly receivedAt: number
}

export const ENTRY_CAP = 64

/**
 * Returns the pruned map, or the same reference when nothing changed (keeps Solid's signal from
 * re-rendering). `keep` is the session an open dialog is rendering; it is never dropped or evicted.
 */
export function pruneSnapshotEntries(
  entries: Readonly<Record<string, GoalSnapshotCacheEntry>>,
  keep: string | undefined,
  cap: number = ENTRY_CAP,
): Readonly<Record<string, GoalSnapshotCacheEntry>> {
  let changed = false
  const out: Record<string, GoalSnapshotCacheEntry> = {}
  for (const [sessionID, entry] of Object.entries(entries)) {
    // A null-valued entry carries no information anymore; drop it unless a dialog is rendering it.
    if (entry.goal === null && sessionID !== keep) {
      changed = true
      continue
    }
    out[sessionID] = entry
  }
  const keys = Object.keys(out)
  if (keys.length > cap) {
    const rank = (k: string): number => {
      const g = out[k]!.goal
      return g !== null && isLive(g.status) ? 1 : 0
    }
    // Non-live first (rank 0), oldest first; the cap never evicts a live goal and never drops `keep`.
    const sorted = keys.slice().sort((a, b) => rank(a) - rank(b) || out[a]!.receivedAt - out[b]!.receivedAt)
    let overflow = keys.length - cap
    for (const k of sorted) {
      if (overflow <= 0) break
      if (k === keep || rank(k) === 1) continue
      delete out[k]
      overflow--
      changed = true
    }
  }
  return changed ? out : entries
}
