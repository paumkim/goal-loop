import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { DEFAULT_CONFIG } from "./defaults.ts"
import type { Config } from "./types.ts"
import { boolFrom, intFrom, numberFrom, parseModel, strFrom } from "./util.ts"

type Raw = Record<string, unknown>

/** Merge a partial raw config over defaults. Pure; validation happens in `normalize`. */
export const mergeConfig = (base: Config, raw: Raw): Config => ({
  backlog: strFrom(raw.backlog, base.backlog),
  configFile: strFrom(raw.configFile, base.configFile),
  stateFile: raw.stateFile === undefined ? base.stateFile : strFrom(raw.stateFile, ""),
  baseBranch: strFrom(raw.baseBranch, base.baseBranch),
  branchPrefix: strFrom(raw.branchPrefix, base.branchPrefix),
  promptLibrary: strFrom(raw.promptLibrary, base.promptLibrary),
  prompts: Array.isArray(raw.prompts) ? raw.prompts.map((p) => strFrom(p, "")) : [...base.prompts],
  plugin: strFrom(raw.plugin, base.plugin),
  model: raw.model === undefined ? base.model : strFrom(raw.model, ""),
  maxTasksPerTick: intFrom(raw.maxTasksPerTick, base.maxTasksPerTick, 1, 100),
  maxSpendUsd: numberFrom(raw.maxSpendUsd, base.maxSpendUsd, 0, 100_000),
  maxTokens: intFrom(raw.maxTokens, base.maxTokens, 0, 100_000_000),
  maxWallMsPerTick: intFrom(raw.maxWallMsPerTick, base.maxWallMsPerTick, 1_000, 86_400_000),
  maxWallMsPerTask: intFrom(raw.maxWallMsPerTask, base.maxWallMsPerTask, 1_000, 86_400_000),
  pollMs: intFrom(raw.pollMs, base.pollMs, 500, 60_000),
  verifyCommand: strFrom(raw.verifyCommand, base.verifyCommand),
  stopFiles: Array.isArray(raw.stopFiles) ? raw.stopFiles.map((p) => strFrom(p, "")) : [...base.stopFiles],
  allowedRepos: Array.isArray(raw.allowedRepos) ? raw.allowedRepos.map((p) => strFrom(p, "")) : [...base.allowedRepos],
  requireCleanTree: boolFrom(raw.requireCleanTree, base.requireCleanTree),
})

const list = (value: string | undefined): string[] | undefined =>
  value === undefined ? undefined : value.split(",").map((s) => s.trim()).filter(Boolean)

/** Apply `PROMPTER_*` environment overrides (highest precedence). */
export const envOverrides = (env: NodeJS.ProcessEnv): Raw => {
  const raw: Raw = {}
  const set = (key: string, value: string | undefined): void => {
    if (value !== undefined && value !== "") raw[key] = value
  }
  set("backlog", env.PROMPTER_BACKLOG)
  set("baseBranch", env.PROMPTER_BASE_BRANCH)
  set("branchPrefix", env.PROMPTER_BRANCH_PREFIX)
  set("promptLibrary", env.PROMPTER_PROMPT_LIBRARY)
  set("model", env.PROMPTER_MODEL)
  set("plugin", env.PROMPTER_PLUGIN)
  set("maxTasksPerTick", env.PROMPTER_MAX_TASKS)
  set("maxSpendUsd", env.PROMPTER_MAX_SPEND_USD)
  set("maxTokens", env.PROMPTER_MAX_TOKENS)
  set("maxWallMsPerTick", env.PROMPTER_MAX_WALL_MS)
  set("maxWallMsPerTask", env.PROMPTER_MAX_TASK_MS)
  set("pollMs", env.PROMPTER_POLL_MS)
  set("verifyCommand", env.PROMPTER_VERIFY_COMMAND)
  set("requireCleanTree", env.PROMPTER_REQUIRE_CLEAN_TREE)
  const prompts = list(env.PROMPTER_PROMPTS)
  if (prompts) raw.prompts = prompts
  const stops = list(env.PROMPTER_STOP_FILES)
  if (stops) raw.stopFiles = stops
  const repos = list(env.PROMPTER_ALLOWED_REPOS)
  if (repos) raw.allowedRepos = repos
  return raw
}

/** Resolve relative paths and validate cross-field constraints. */
export const normalize = (config: Config, repo: string): Config => {
  if (config.prompts.length === 0) throw new Error("config: prompts must contain at least one prompt file")
  if (config.model) parseModel(config.model)
  if (config.branchPrefix.includes("..") || path.isAbsolute(config.branchPrefix)) {
    throw new Error("config: branchPrefix must be a simple relative prefix")
  }
  const resolvedStops = config.stopFiles.map((p) => (path.isAbsolute(p) ? p : path.resolve(repo, p)))
  const resolvedRepos = config.allowedRepos.map((p) => path.resolve(repo, p))
  const resolvedLibrary = path.isAbsolute(config.promptLibrary)
    ? config.promptLibrary
    : path.resolve(repo, config.promptLibrary)
  const resolvedPlugin = !config.plugin
    ? ""
    : path.isAbsolute(config.plugin) || config.plugin.startsWith(".")
      ? path.resolve(repo, config.plugin)
      : config.plugin
  const resolvedStateFile = !config.stateFile
    ? config.stateFile
    : path.isAbsolute(config.stateFile)
      ? config.stateFile
      : path.resolve(repo, config.stateFile)
  return {
    ...config,
    promptLibrary: resolvedLibrary,
    plugin: resolvedPlugin,
    stopFiles: resolvedStops,
    allowedRepos: resolvedRepos,
    stateFile: resolvedStateFile,
  }
}

/**
 * True when a repo may be operated on. An empty whitelist is unrestricted; otherwise the resolved repo path
 * must be one of the configured entries. A CLI `--repo` flag must never rewrite this list — that would let the
 * flag silently defeat the guard it is supposed to be checked against.
 */
export const isRepoAllowed = (config: Config, repo: string): boolean =>
  config.allowedRepos.length === 0 || config.allowedRepos.includes(path.resolve(repo))

/** Read <repo>/.prompter/config.json (if any), then apply env overrides. */
export const loadConfig = (repo: string, env: NodeJS.ProcessEnv = process.env): Config => {
  const root = path.resolve(repo)
  const configPath = path.join(root, DEFAULT_CONFIG.configFile)
  let fromFile: Raw = {}
  if (existsSync(configPath)) {
    const text = readFileSync(configPath, "utf8")
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`config: ${configPath} must contain a JSON object`)
    }
    fromFile = parsed as Raw
  }
  const merged = mergeConfig(mergeConfig(DEFAULT_CONFIG, fromFile), envOverrides(env))
  return normalize(merged, root)
}
