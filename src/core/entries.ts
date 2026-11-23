/**
 * Bounded cache of per-session goal snapshots for the TUI. The "changed" RPC stream pushes a `changed`
 * event per session; over a long TUI session the map would grow without bound. Pruning runs inline in
 * the put path (no timers): the map is capped — oldest non-live entries are evicted first, live
 * (active/paused) entries are never evicted by the cap. Null-valued entries are retained on every
 * branch — the stale-chrome tick re-pulls them to notice a goal armed since the last pull — and only
 * the cap bounds how long a null entry lingers. Recently-terminal entries carry `terminalAt` (first
 * observed terminal stamp) so the tick can re-pull them inside a short window — a record cleared in
 * another process right after terminal converges instead of painting phantom chrome forever.
 */
import { isLive, type GoalSnapshot } from "./types.ts"

/**
 * Elapsed wall time is recomputed from `now - startedAt` by every server snapshot, so two pulls of an
 * otherwise-identical live goal never deep-equal — strip it or the unchanged-snapshot arm (and its
 * bumpReceivedAt dedup) never engages for live goals. Everything else on the snapshot is either
 * user-visible state or derived from the record's fields, so it stays part of the comparison.
 */
const stripVolatile = (key: string, value: unknown) => (key === "elapsedMs" ? undefined : value)

/**
 * Cheap inequality precheck. Every key here is part of the serialized comparison (`elapsedMs` is the
 * only stripped field and is deliberately absent), so any mismatch means the two snapshots really do
 * differ and the two full serializations below can be skipped. Live `changed` events almost always move
 * one of these — a new turn, a verdict, a status change — so this is the common path.
 */
const CHEAP_KEYS = [
  "version", "id", "sessionID", "directory", "condition", "status",
  "setAt", "startedAt", "turns", "stall", "retries", "checkins",
  "evaluating", "waiting", "queued",
] as const

/** Snapshots arrive over RPC and from local helpers, so compare by value (key order is stable) to keep redundant `changed` events from re-rendering. */
export const goalsEqual = (a: GoalSnapshot | null, b: GoalSnapshot | null) => {
  if (a === b) return true
  if (!a || !b) return false
  for (const key of CHEAP_KEYS) {
    if (a[key] !== b[key]) return false
  }
  if (a.history.length !== b.history.length) return false
  return JSON.stringify(a, stripVolatile) === JSON.stringify(b, stripVolatile)
}

export interface GoalSnapshotCacheEntry {
  readonly goal: GoalSnapshot | null
  /** Client clock when the snapshot arrived; elapsed time is extrapolated from it to avoid clock skew. */
  readonly receivedAt: number
  /**
   * Client clock when this entry's goal was FIRST observed non-live (`terminalStampOf`). Retained across
   * re-pulls and `bumpReceivedAt`, dropped when the goal is live or null. Anchors the recent-terminal
   * re-pull window (see `RECENT_TERMINAL_WINDOW_MS` in hud.ts) — the window ages from first sight of
   * terminal truth, not from the latest pull.
   */
  readonly terminalAt?: number | undefined
}

export const ENTRY_CAP = 64

/**
 * Returns the pruned map, or the same reference when nothing changed (keeps Solid's signal from
 * re-rendering). `keep` is the session an open dialog is rendering; it is never evicted. Null-valued
 * entries are always retained — the stale-chrome tick re-pulls them to notice a goal armed since the
 * last pull — and only the cap evicts them (oldest non-live first), so an observed clear stays a
 * re-pull target until real cap pressure pushes it out.
 */
export function pruneSnapshotEntries(
  entries: Readonly<Record<string, GoalSnapshotCacheEntry>>,
  keep: string | undefined,
  cap: number = ENTRY_CAP,
): Readonly<Record<string, GoalSnapshotCacheEntry>> {
  let changed = false
  const out: Record<string, GoalSnapshotCacheEntry> = {}
  for (const [sessionID, entry] of Object.entries(entries)) {
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

/** Drops the given session entries outright (end-of-life terminal records); `keep` is never dropped. */
export function dropSessions(
  entries: Readonly<Record<string, GoalSnapshotCacheEntry>>,
  ids: readonly string[],
  keep?: string,
): Readonly<Record<string, GoalSnapshotCacheEntry>> {
  if (ids.length === 0) return entries
  const out: Record<string, GoalSnapshotCacheEntry> = {}
  for (const [sessionID, entry] of Object.entries(entries)) {
    if (ids.includes(sessionID) && sessionID !== keep) continue
    out[sessionID] = entry
  }
  if (Object.keys(out).length === Object.keys(entries).length) return entries
  return out
}

/**
 * The `terminalAt` stamp for a fresh snapshot: the FIRST time this entry observed a non-live goal,
 * retained across re-pulls and `bumpReceivedAt`, dropped when the goal is live or null. A terminal
 * record can only move to cleared (and then a fresh goal may arm), so first-observation is the right
 * anchor: the recent-terminal re-pull window ages from when the TUI first saw terminal truth, not from
 * the latest pull (which would postpone the window on every tick). A live-again goal clears the stamp —
 * the terminal arc is over; a later terminal transition stamps afresh.
 */
export function terminalStampOf(
  existing: GoalSnapshotCacheEntry | undefined,
  goal: GoalSnapshot | null,
  now: number,
): number | undefined {
  if (goal !== null && !isLive(goal.status)) return existing?.terminalAt ?? now
  return undefined
}

/**
 * Marks an unchanged cache entry as freshly checked. The stale-chrome guard keys on `receivedAt`, and a
 * snapshot that compares equal never reaches the `setEntries` updater's fresh branch — so without this
 * the guard would re-pull a never-changing paused/null/terminal entry at every tick forever. Returns a
 * NEW map (new entry object, SAME goal reference) so the signal re-evaluates but goal-identical memos do not.
 */
export function bumpReceivedAt(entries: Readonly<Record<string, GoalSnapshotCacheEntry>>, sessionID: string, now: number): Readonly<Record<string, GoalSnapshotCacheEntry>> {
  const existing = entries[sessionID]
  if (!existing) return entries
  return { ...entries, [sessionID]: { ...existing, receivedAt: now } }
}

/**
 * The `get` RPC carries the last-known context estimate and spend; `changed` event snapshots usually do
 * not (both need a host call the hot path avoids). When an event snapshot arrives without one, carry the
 * cached value forward so the dialog's context meter and spend row do not flicker to `unknown` on every
 * background tick. The carry only applies within the same record (matched by `id`): a cleared-then-re-armed
 * goal in the same session never inherits the old record's figures. Spend is cumulative-since-baseline and
 * monotonically non-decreasing within a goal run,
 * so the carried figure is a lower bound, never a lie; the next `get` pull (dialog open, stale-chrome
 * re-pull) replaces it with the settled one. Returns the same reference when there is nothing to carry
 * (keeps the hot path allocation-free).
 *
 * A pending→landed `loopCompact.landedAt` flip invalidates the cached context total: it described the
 * pre-compaction context, which the host just replaced. The carried number is dropped instead of
 * painted as current; the meter renders nothing until the server sends the post-compaction count
 * (the estimate of the first assistant step after the landing). Spend is unaffected by a compaction.
 */
export function preserveCarriedFields(previous: GoalSnapshot | null | undefined, next: GoalSnapshot | null): GoalSnapshot | null {
  if (next === null) return next
  // Only the same record may lend its cached figures to the next snapshot; a cleared-then-armed goal
  // reuses the sessionID with a fresh id, and the old record's estimate must never paint the new one.
  const sameRecord = previous !== null && previous !== undefined && previous.id === next.id ? previous : undefined
  const landed = compactionJustLanded(sameRecord, next)
  let merged = next
  if (merged.contextSize === undefined && !landed) {
    const carried = sameRecord?.contextSize
    if (typeof carried === "number" && Number.isFinite(carried) && carried >= 0) merged = { ...merged, contextSize: carried }
  }
  if (merged.spend === undefined) {
    const carried = sameRecord?.spend
    if (carried) merged = { ...merged, spend: carried }
  }
  return merged
}


/** True when `next` shows a boundary compaction landed that `previous` had pending (or unnoticed). */
function compactionJustLanded(previous: GoalSnapshot | null | undefined, next: GoalSnapshot): boolean {
  const landed = next.loopCompact?.landedAt
  if (landed === undefined) return false
  return previous?.loopCompact?.landedAt !== landed
}

/**
 * The TUI's `changed`-event / re-pull intake, extracted pure from the render tree: store `goal` under
 * `sessionID`, or — when it compares equal to the cached copy (elapsedMs aside) — just re-stamp
 * `receivedAt` so the stale-chrome guard counts it as fresh. A live→terminal or evaluating→idle flip is
 * never equal, so terminal acknowledgment detection in the caller keeps working unchanged. Returns the
 * same reference when the cap evicts nothing, a new map otherwise.
 */
export const applySnapshot = (
  entries: Readonly<Record<string, GoalSnapshotCacheEntry>>,
  sessionID: string,
  goal: GoalSnapshot | null,
  nowMs: number,
  keep: string | undefined,
  cap: number = ENTRY_CAP,
): Readonly<Record<string, GoalSnapshotCacheEntry>> => {
  const existing = entries[sessionID]
  // Keep the old entry's elapsed baseline when nothing changed, but mark it freshly checked: elapsed time
  // still extrapolates (only active goals extrapolate); goal-identical memos stay untouched because the
  // render tree sees the same goal reference.
  if (existing && goalsEqual(existing.goal, goal)) return pruneSnapshotEntries(bumpReceivedAt(entries, sessionID, nowMs), keep, cap)
  const next = { ...entries, [sessionID]: { goal, receivedAt: nowMs, terminalAt: terminalStampOf(existing, goal, nowMs) } }
  return pruneSnapshotEntries(next, keep, cap)
}
