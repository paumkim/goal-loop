/**
 * The file half of the dossier: `goal.dossier.export` writes the same Markdown the
 * `goal.dossier.copy` palette command puts on the clipboard into a fresh file, so the
 * record can leave the process — an issue, a handoff, a review. Pure name and content
 * construction; the single I/O point is one synchronous `writeFileSync(..., "wx")`, which
 * is what makes "never overwrites" a guarantee of the filesystem rather than a promise of
 * this module. Unit-tested in `test/dossier-export.test.ts`.
 *
 * Honesty rules, same as the rest of the plugin: the file is the record's own bytes
 * (`buildLoopDossier` output, nothing added, nothing elided); a clock that cannot produce
 * a date renders the epoch stamp rather than throwing; a collision retries with a numeric
 * suffix instead of clobbering; a directory that cannot be written to throws with the
 * filesystem's own message for the host's error toast; no directory is created, moved, or
 * removed — the target is always an existing directory chosen by the caller.
 */
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildLoopDossier, fileStampOf } from "./dossier.ts"
import type { GoalSnapshot } from "./types.ts"

/** Retries granted to the `-n` filename suffix before the export gives up. The stem is 1 second wide; 100 collisions means the caller should look around. */
export const MAX_EXPORT_ATTEMPTS = 100

/**
 * `goal-dossier-20261116-172233.md` from a clock; attempt > 0 appends `-attempt` (`-2`, `-3`, ...).
 * Deterministic: the same (nowMs, attempt) always yields the same name. A non-finite or
 * unrepresentable clock stamps the epoch rather than throwing — the name stays honest.
 */
export const dossierExportName = (nowMs: number, attempt = 0): string => {
  const suffix = attempt > 0 ? `-${attempt + 1}` : ""
  return `goal-dossier-${fileStampOf(nowMs)}${suffix}.md`
}

interface DossierExportResult {
  /** Absolute path of the written file. */
  readonly path: string
  /** Bytes written (UTF-8). */
  readonly bytes: number
  /** How many candidate names were tried (1 = the plain name was free). */
  readonly attempts: number
}

/**
 * Writes the dossier for `goal` as one new file inside `dir` (the caller passes the host's
 * cwd). Never overwrites: the write is O_EXCL and collisions retry with a numeric suffix,
 * up to `MAX_EXPORT_ATTEMPTS`. Throws — never resolves partial — when no candidate name is
 * free or when the directory rejects the write; the message is the filesystem's own.
 */
export function exportLoopDossier(goal: GoalSnapshot, nowMs: number, dir: string): DossierExportResult {
  const content = buildLoopDossier(goal, nowMs)
  const targetDir = resolve(dir)
  const bytes = Buffer.byteLength(content, "utf8")
  for (let attempt = 0; attempt < MAX_EXPORT_ATTEMPTS; attempt++) {
    const path = join(targetDir, dossierExportName(nowMs, attempt))
    try {
      writeFileSync(path, content, { encoding: "utf8", flag: "wx" })
      return { path, bytes, attempts: attempt + 1 }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === "EEXIST") continue // the stem collided — try the next suffix, never clobber
      throw error
    }
  }
  throw new Error(`no free dossier filename after ${MAX_EXPORT_ATTEMPTS} attempts in ${targetDir}`)
}
