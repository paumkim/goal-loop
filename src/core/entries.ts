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

/**
 * The `get` RPC carries the last-known context estimate; `changed` event snapshots usually do not.
 * When an event snapshot arrives without one, carry the cached value forward so the dialog's context
 * meter does not flicker to `unknown` on every background tick. Returns the same reference when there
 * is nothing to carry (keeps the hot path allocation-free).
 *
 * A pending→landed `loopCompact.landedAt` flip invalidates the cached total: it described the
 * pre-compaction context, which the host just replaced. The carried number is dropped instead of
 * painted as current; the meter renders nothing until the server sends the post-compaction count
 * (the estimate of the first assistant step after the landing).
 */
export function preserveContextSize(previous: GoalSnapshot | null | undefined, next: GoalSnapshot | null): GoalSnapshot | null {
  if (next === null) return next
  if (next.contextSize !== undefined) return next
  if (compactionJustLanded(previous, next)) return next
  const carried = previous?.contextSize
  return typeof carried === "number" && Number.isFinite(carried) && carried >= 0 ? { ...next, contextSize: carried } : next
}

/** True when `next` shows a boundary compaction landed that `previous` had pending (or unnoticed). */
function compactionJustLanded(previous: GoalSnapshot | null | undefined, next: GoalSnapshot): boolean {
  const landed = next.loopCompact?.landedAt
  if (landed === undefined) return false
  return previous?.loopCompact?.landedAt !== landed
}
