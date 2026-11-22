/**
 * Pure helpers for `scripts/e2e.ts`, split out so the end-to-end harness's decision points can be
 * unit-tested without spawning a server. The executable (`e2e.ts`) owns all I/O: process spawn,
 * filesystem writes, network, exit codes. Everything here is deterministic and import-safe.
 * Not shipped (scripts/ is not in package.json `files`); this file lives in scripts/ only.
 */

import { formatValue } from "../src/core/errors.ts"

/** The default model, used when neither the positional argument nor E2E_MODEL is set. */
export const DEFAULT_MODEL = "opencode/deepseek-v4.1-flash-free"

/** What the harness should do with the target project's `.opencode/opencode.json`. */
type ConfigAction = "write" | "skip" | "refuse"

/**
 * Precedence for the model selection: positional argument wins over the E2E_MODEL environment
 * variable, which wins over the built-in default.
 */
export const resolveModel = (arg: string | undefined, env: string | undefined, fallback: string = DEFAULT_MODEL): string =>
  arg ?? env ?? fallback

/**
 * Parse a "provider/model" string. The model id may itself contain slashes
 * (`openrouter/anthropic/claude-3` is provider `openrouter`, id `anthropic/claude-3`), but the
 * provider segment must be a single slash-free, non-blank token and the id must be non-blank.
 * A trailing slash, a leading slash, an empty provider, an empty id (`opencode//`) and blanks
 * inside the provider are all rejected here instead of failing later with an opaque server error.
 */
export const parseModelArg = (modelArg: string): { providerID: string; modelID: string } => {
  const slash = modelArg.indexOf("/")
  const providerID = slash === -1 ? modelArg : modelArg.slice(0, slash)
  const modelID = slash === -1 ? "" : modelArg.slice(slash + 1)
  const providerOk = providerID.length > 0 && !providerID.includes("/") && !/\s/.test(providerID) && providerID.trim() === providerID
  // The id may carry slashes (org/model), but never a leading slash or an empty segment.
  const idOk =
    modelID.trim().length > 0 && !/\s/.test(modelID) && modelID.trim() === modelID && !modelID.startsWith("/") && !modelID.includes("//")
  if (slash <= 0 || !providerOk || !idOk) {
    throw new Error(`model must be "provider/model" (got ${formatValue(modelArg)})`)
  }
  return { providerID, modelID }
}

/** The exact bytes the harness wants in `.opencode/opencode.json` (single source of truth). */
export const buildIntendedConfig = (pluginPath: string): string =>
  JSON.stringify({ plugins: [pluginPath] }, null, 2)

/**
 * Decide what to do with the existing config:
 *   null (no file)   -> "write"   create it
 *   identical bytes   -> "skip"   rerun is idempotent — do not rewrite (also keeps a read-only
 *                                 but up-to-date file from failing with EACCES for no reason)
 *   different bytes   -> "refuse" never clobber the project's own plugin configuration
 */
export const decideConfigAction = (existing: string | null, intended: string): ConfigAction => {
  if (existing === null) return "write"
  return existing === intended ? "skip" : "refuse"
}

/** Error message for the refuse case; the pre-existing bytes are never touched. */
export const refuseConfigMessage = (opencodeJson: string): string =>
  `refusing to overwrite ${opencodeJson}: the target project already carries a different opencode.json; point the harness at an empty directory instead`

/** Process exit code for the run: 0 only when the goal resolved as achieved. */
export const goalExitCode = (status: string | undefined): number => (status === "achieved" ? 0 : 1)
