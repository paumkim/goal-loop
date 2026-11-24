/**
 * Host-label renames goal-loop owns.
 *
 * OpenCode renders a divider labelled "Provider compaction" when a native (provider) compaction
 * finishes. goal-loop calls that event "Context Cleared" everywhere it speaks to the user. The host
 * TUI has no plugin slot, theme token, or config key for this string, so the rename cannot live in a
 * slot claim: it has to be a patch on the host. The checkout is only a build input — the string that
 * reaches the user is compiled into the installed binary — so goal-loop owns both renames here. An
 * upstream `git pull` or binary update can overwrite either file without losing the change:
 * `goal-loop patch-host` re-applies the source rename and `goal-loop patch-host --binary` the one in
 * the running binary.
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

/**
 * The same divider inside the installed OpenCode binary — the code that actually renders the TUI.
 * `COMPACTION_DIVIDER_PATCH` above edits the source checkout, which is only a build input: renaming
 * it leaves the shipped binary's string untouched, so a running TUI still says "Provider compaction".
 * The match is the whole ternary, not the bare label: the binary also carries two error messages
 * that say "Provider compaction" and those describe the feature, not the divider.
 *
 * The replacement pads the label with four trailing spaces so it has exactly the same byte length as
 * the original. The installed binary is a Bun-compiled executable with length-prefixed string data;
 * a shorter replacement shifts every following offset and makes the executable fall through to Bun's
 * own CLI instead of OpenCode's. Keep the two fragments equal-length.
 */
export const INSTALLED_BINARY_DIVIDER_PATCH: HostLabelPatch = {
  file: "bin/opencode",
  from: '?"Provider compaction":"Compaction"',
  to: '?"Context Cleared    ":"Compaction"',
}

/**
 * The second copy of the divider label: a standalone, length-prefixed entry in the binary's string
 * table. The rendered TUI reads this entry even when the minified ternary above has been renamed.
 * Only standalone occurrences are swapped — the two error messages that continue with
 * " is not supported" describe the feature and must stay byte-identical.
 */
export const INSTALLED_BINARY_LABEL_PATCH: HostLabelPatch = {
  file: "bin/opencode",
  from: "Provider compaction",
  to: "Context Cleared    ",
}
export const INSTALLED_BINARY_LABEL_KEEP_SUFFIX = " is not supported"

/** Apply both binary copies of the rename. `source` is latin1-decoded bytes so lengths stay exact. */
export function applyInstalledBinaryLabelPatch(source: string): { text: string; replacements: number } {
  const code = applyHostLabelPatch(source, INSTALLED_BINARY_DIVIDER_PATCH)
  const guarded = new RegExp(`${INSTALLED_BINARY_LABEL_PATCH.from}(?!${INSTALLED_BINARY_LABEL_KEEP_SUFFIX})`, "g")
  const standalone = (code.text.match(guarded) ?? []).length
  return {
    text: code.text.replace(guarded, INSTALLED_BINARY_LABEL_PATCH.to),
    replacements: code.replacements + standalone,
  }
}

/** Every host-label rename goal-loop maintains. Add new ones here, never as ad-hoc edits. */
export const HOST_LABEL_PATCHES: readonly HostLabelPatch[] = Object.freeze([
  COMPACTION_DIVIDER_PATCH,
  INSTALLED_BINARY_DIVIDER_PATCH,
  INSTALLED_BINARY_LABEL_PATCH,
])

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
