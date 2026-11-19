/**
 * Last-resort convergence file: a byte copy of the newest goal snapshot, written by the server plugin on
 * every `changed` emission and read by the TUI when both RPC paths (`goal/get` and the `changed` stream)
 * are dead. The 2026-11-17 background-service storm (77 consecutive HTTP 500s on `/api/rpc/goal/get`,
 * zero `changed` deliveries) and the 2026-11-18 standalone repro (25+ consecutive 500s on a fresh TUI
 * instance whose evaluator verdict never reached the pill) both ended with the user staring at a pill
 * stuck on "goal checking" — with the terminal truth sitting, unread, in the plugin's store.
 *
 * The TUI plugin does not share the server plugin's storage domain, so the server writes a small JSON
 * mirror of each snapshot into a private tmp dir instead. Everything about the mirror is defensive:
 * atomic tmp+rename writes (a reader never sees half a file), owner-only permissions (the snapshot carries
 * the user's condition text), a no-op disable flag, and reads that drop malformed or foreign records.
 * The RPC and event paths remain primary; the mirror only ever backstops them.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseGoalSnapshot, sameDirectory } from "./wire.ts"
import type { GoalSnapshot } from "./types.ts"

export interface GoalMirror {
  /** Best-effort atomic write; never throws. */
  readonly write: (snapshot: GoalSnapshot) => void
  /** Best-effort unlink (goal cleared); never throws. */
  readonly remove: (sessionID: string) => void
  /**
   * Parses the mirror for a session. `directory` scopes the read like the `changed` intake: a mismatch is
   * dropped (fail-open when absent). Returns undefined for a missing, unreadable or malformed mirror.
   */
  readonly read: (sessionID: string, directory?: string | undefined) => GoalSnapshot | undefined
}

const fileFor = (dir: string, sessionID: string) => {
  // A sessionID may not traverse: strip anything path-like rather than encode it.
  const safe = sessionID.replace(/[^a-zA-Z0-9_-]/g, "_")
  return join(dir, `${safe}.json`)
}

export const createGoalMirror = (dir: string = join(tmpdir(), "goal-loop-mirror")): GoalMirror => {
  const write = (snapshot: GoalSnapshot): void => {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const target = fileFor(dir, snapshot.sessionID)
      const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
      writeFileSync(tmp, JSON.stringify(snapshot), { mode: 0o600 })
      renameSync(tmp, target)
    } catch {
      // The mirror is a backstop; failing it must never affect the commit path.
    }
  }

  const remove = (sessionID: string): void => {
    try {
      rmSync(fileFor(dir, sessionID), { force: true })
    } catch {
      // Same posture.
    }
  }

  const read = (sessionID: string, directory?: string | undefined): GoalSnapshot | undefined => {
    try {
      const raw = readFileSync(fileFor(dir, sessionID), "utf8")
      const parsed = parseGoalSnapshot(JSON.parse(raw))
      if (!parsed) return undefined
      // A record whose sessionID disagrees with the requested one is corrupt, not usable optimism.
      if (parsed.sessionID !== sessionID) return undefined
      // Same directory discipline as the `changed` intake: a foreign project's record never paints here.
      if (directory && !sameDirectory(parsed.directory, directory)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  return { write, remove, read }
}
