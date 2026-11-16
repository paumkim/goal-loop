/**
 * Shared magic numbers for the boundary-compaction machinery. Single source of truth so the controller
 * (evidence checks, restore grace) and the compactor (request cooldown, minimum size) cannot drift apart.
 */

/** Minimum context size (tokens) for a boundary compaction to be worth requesting; also the drop-evidence floor. */
export const BOUNDARY_MIN_TOKENS = 10_000

/** Fraction of the estimated pending-request size below which the context is considered to have dropped (landed). A >=10% drop counts as landing. */
export const BOUNDARY_DROP_FACTOR = 0.9

/** Cooldown (ms) between boundary-compaction requests / re-anchors for one session. */
export const COMPACT_COOLDOWN_MS = 120_000

/** Grace period (ms) after a landing during which a restore must not re-request a fresh boundary compaction. */
export const BOUNDARY_LANDING_GRACE_MS = 10 * 60_000
