/**
 * Host-label renames goal-loop owns.
 *
 * OpenCode renders a divider labelled "Provider compaction" when a native (provider) compaction
 * finishes. goal-loop calls that event "Context Cleared" everywhere it speaks to the user. The host
 * TUI has no plugin slot, theme token, or config key for this string, so the rename cannot live in a
 * slot claim: it has to be a patch on the host source. Keeping the patch here — in the plugin repo —
 * means an upstream `git pull` in the OpenCode checkout can overwrite the host file without losing
 * the change: `goal-loop patch-host` (and `goal-loop install`) re-apply it from this data.
 *
 * The patch is deliberately a literal string swap, not a line-number diff. Upstream refactors move
 * the line; they do not rename the string. A missing fragment is reported as "already patched"
 * only when the replacement is present, never silently ignored.
 */

/** One source-level rename in the host tree. `file` is relative to the OpenCode repo root. */
export interface HostLabelPatch {
  readonly file: string
  readonly from: string
  readonly to: string
}

/** The compaction divider: rename "Provider compaction" to the goal-loop wording. */
export const COMPACTION_DIVIDER_PATCH: HostLabelPatch = {
  file: "packages/tui/src/routes/session/index.tsx",
  from: '? "Provider compaction"',
  to: '? "Context Cleared"',
}

/** Every host-label rename goal-loop maintains. Add new ones here, never as ad-hoc edits. */
export const HOST_LABEL_PATCHES: readonly HostLabelPatch[] = Object.freeze([COMPACTION_DIVIDER_PATCH])

export interface HostLabelPatchResult {
  readonly text: string
  /** True when at least one occurrence of `from` was replaced. */
  readonly changed: boolean
  /** True when no `from` was left and `to` is present: the file already carries the rename. */
  readonly already: boolean
  readonly replacements: number
}

/**
 * Apply one literal rename to host source text. Pure: no I/O, no path handling, no global state.
 * Idempotent: applying it to already-patched text leaves the text byte-identical.
 */
export function applyHostLabelPatch(source: string, patch: HostLabelPatch): HostLabelPatchResult {
  const parts = source.split(patch.from)
  const replacements = parts.length - 1
  const text = parts.join(patch.to)
  const contains = (needle: string) => source.includes(needle)
  return {
    text,
    changed: replacements > 0,
    already: replacements === 0 && contains(patch.to),
    replacements,
  }
}

/** Resolve the host TUI source path: explicit argument, env override, then the usual local clone. */
export function hostLabelFile(arg?: string, env: NodeJS.ProcessEnv = process.env, homedir?: string): string {
  if (arg) return arg
  const override = env.GOAL_LOOP_OPENCODE_TUI
  if (override) return override
  const home = homedir ?? env.HOME ?? ""
  return `${home.replace(/\/$/, "")}/Projects/opencode/${COMPACTION_DIVIDER_PATCH.file}`
}
