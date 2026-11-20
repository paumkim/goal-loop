import type { CommitRequest, ModelRef } from "./types.ts"

type EvaluatorMode = "auto" | "session" | "independent"

export type VerifyCheckType = "typecheck" | "tests" | "lint" | "build" | "smoke" | "custom" | "goal-declared"

export interface VerifyCheckConfig {
  readonly id: string
  readonly type: VerifyCheckType
  readonly command: string
  readonly timeoutMs?: number
  readonly required?: boolean
  readonly when?: "always" | "broad"
  readonly label?: string
  /** How this required check may be satisfied. Default: command (executed). */
  readonly evidence?: "command" | "artifact" | "either"
  /** Required literal patterns for fresh scoped transcript/artifact evidence (evidence artifact|either). */
  readonly artifactPatterns?: readonly string[]
}

export interface GoalConfig {
  readonly evaluator: {
    /** `session` reuses the session's model and cached prefix; `independent` uses `model` on a transcript digest. */
    readonly mode: Exclude<EvaluatorMode, "auto">
    readonly model?: ModelRef
    readonly maxTranscriptChars: number
    readonly maxOutputTokens: number
    readonly timeoutMs: number
    /** When set, a `met` verdict is not accepted until this command exits 0 (the verifier, not the transcriber). Empty disables. Env OPENCODE_GOAL_VERIFY_COMMAND. Backward-compatible single-check alias. */
    readonly verifyCommand: string
    /** Wall-clock budget for one verification run. */
    readonly verifyTimeoutMs: number
    /** Profile-aware verification matrix: required command checks run on candidate met verdicts. Legacy `verifyCommand` is synthesized when no explicit checks are provided. */
    readonly verifyChecks: readonly VerifyCheckConfig[]
    /** Verification profile label for matrix policy/reporting (e.g. "default", "broad"). */
    readonly verifyProfile: string
    /** Max concurrent verification-command executions per matrix run (independent checks). Capped 1..8. */
    readonly verifyConcurrency: number
    /** Second-opinion gate: `2` requires two independent verdicts (session evaluator + independent model) both rule `met`; any disagreement or second-opinion failure fails closed to `not_met` with the disagreement named in the reason. `1` (default) disables. Opt-in per repo/loop; doubles evaluator cost when enabled. */
    readonly consensus: 1 | 2
  }
  /** Hard turn cap; 0 disables the cap — the default; set explicitly as a hard safety limit. Conditions can still carry their own natural-language limit. */
  readonly maxTurns: number
  /** Evaluated turns without tool use before pausing; 0 disables — the default. */
  readonly stallTurns: number
  /** First check-in interval for background work; 0 disables idle check-in nudges (automatic retries never stop). */
  readonly checkinMinutes: number
  readonly maxIdleCheckins: number
  /** Maximum consecutive retries before the goal fails. Applies to evaluator failures and transient execution errors. 0 disables (unlimited retries with capped backoff). */
  readonly maxRetries: number
  readonly maxConditionChars: number
  /** Adds a stable system reminder while a goal is live. Costs one prompt-cache miss when toggled. */
  readonly systemReminder: boolean
  /** Auto-compact when the estimated model-visible context (last assistant token usage) is at or above this many tokens. 0 disables. Env OPENCODE_GOAL_COMPACT_AT_TOKENS. */
  readonly compactAtTokens: number
  /** Request a host compaction at every loop-iteration boundary so the next version arms with a fresh context. Env OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION. */
  readonly compactOnLoopIteration: boolean
  /** `/goal-loop` iteration cap; counts completed iterations. */
  readonly maxLoops: number
  /** Token budget for the per-iteration summary and the next-goal generation; enforced as max(200, tokens) * 4 characters. */
  readonly maxLoopSummaryTokens: number
  /** Durable learning/outcome journal (JSONL): logs what happened and lessons at loop/goal boundaries. */
  readonly learning: {
    readonly enabled: boolean
    /** Path relative to the goal working directory, or absolute. */
    readonly path: string
  }
  /** Finished work has to be committed before the goal counts as met. */
  readonly commit: CommitRequest
}

export const DEFAULTS = {
  maxTranscriptChars: 60_000,
  maxOutputTokens: 4_096,
  timeoutMs: 120_000,
  verifyTimeoutMs: 600_000,
  verifyProfile: "default",
  verifyConcurrency: 2,
  consensus: 1,
  maxTurns: 0,
  stallTurns: 0,
  checkinMinutes: 30,
  maxIdleCheckins: 3,
  maxRetries: 3,
  compactAtTokens: 0,
  compactOnLoopIteration: true,
  maxLoops: 5,
  maxLoopSummaryTokens: 400,
  learningPath: ".term/goal-loop/learnings.jsonl",
  // Effectively unlimited: goals are pasted from the clipboard and can run to whole files, so the default never rejects.
  maxConditionChars: Number.MAX_SAFE_INTEGER,
  commitBranch: "dev",
} as const

/** Busy-state check retries before giving up and evaluating with what we have. Not config-exposed; a failed busy check is a host bug, not a user-tunable scenario. */
export const MAX_BUSY_RETRIES = 5

/** Parses `provider/model` or `provider/model#variant`. Model IDs may contain further slashes. */
export function parseModelRef(value: unknown): ModelRef | undefined {
  if (typeof value === "object" && value !== null) {
    const { providerID, id, variant } = value as Record<string, unknown>
    if (typeof providerID === "string" && typeof id === "string" && providerID && id)
      return { providerID, id, ...(typeof variant === "string" && variant ? { variant } : {}) }
    return undefined
  }
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  const hash = trimmed.indexOf("#")
  const path = hash === -1 ? trimmed : trimmed.slice(0, hash)
  const variant = hash === -1 ? "" : trimmed.slice(hash + 1).trim()
  const slash = path.indexOf("/")
  if (slash <= 0 || slash === path.length - 1) return undefined
  return { providerID: path.slice(0, slash), id: path.slice(slash + 1), ...(variant ? { variant } : {}) }
}

const int = (value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback
}

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback)

/** A free-form string option: trimmed; anything else falls back. */
const str = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim() : fallback)

/** A branch name: a non-empty string with no whitespace. */
const branch = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  return trimmed && !/\s/.test(trimmed) ? trimmed : fallback
}


const VERIFY_TYPES = new Set(["typecheck", "tests", "lint", "build", "smoke", "custom", "goal-declared"])

function parseVerifyChecks(value: unknown, fallbackTimeoutMs: number): VerifyCheckConfig[] {
  if (!Array.isArray(value)) return []
  const out: VerifyCheckConfig[] = []
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue
    const v = item as Record<string, unknown>
    const command = typeof v.command === "string" ? v.command.trim() : ""
    if (!command) continue
    const typeRaw = typeof v.type === "string" ? v.type.trim().toLowerCase() : "custom"
    const type = (VERIFY_TYPES.has(typeRaw) ? typeRaw : "custom") as VerifyCheckType
    const idRaw = typeof v.id === "string" ? v.id.trim() : ""
    const id = idRaw || `${type}-${out.length + 1}`
    const when = v.when === "broad" ? "broad" : "always"
    const required = v.required === false ? false : true
    const timeoutMs = int(v.timeoutMs, fallbackTimeoutMs, 1_000)
    const label = typeof v.label === "string" && v.label.trim() ? v.label.trim() : undefined
    const evidence = v.evidence === "artifact" || v.evidence === "either" ? (v.evidence as "artifact" | "either") : "command"
    const artifactPatterns = Array.isArray(v.artifactPatterns)
      ? (v.artifactPatterns as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : typeof v.artifactPatterns === "string" && v.artifactPatterns.trim()
        ? v.artifactPatterns.split("||").map((x) => x.trim()).filter(Boolean)
        : []
    // artifact/either checks require at least one pattern; malformed definitions are dropped deterministically.
    if ((evidence === "artifact" || evidence === "either") && artifactPatterns.length === 0) continue
    out.push({
      id, type, command, timeoutMs, required, when,
      ...(label ? { label } : {}),
      ...(evidence !== "command" ? { evidence } : {}),
      ...(artifactPatterns.length ? { artifactPatterns } : {}),
    })
  }
  return out
}

function resolveVerifyMatrix(evaluator: Record<string, unknown>, env: Readonly<Record<string, string | undefined>>) {
  const verifyCommand = str(env.OPENCODE_GOAL_VERIFY_COMMAND ?? evaluator.verifyCommand, "")
  const verifyTimeoutMs = int(env.OPENCODE_GOAL_VERIFY_TIMEOUT_MS ?? evaluator.verifyTimeoutMs, DEFAULTS.verifyTimeoutMs, 1_000)
  const verifyProfile = str(env.OPENCODE_GOAL_VERIFY_PROFILE ?? evaluator.verifyProfile, DEFAULTS.verifyProfile)
  const verifyConcurrency = int(env.OPENCODE_GOAL_VERIFY_CONCURRENCY ?? evaluator.verifyConcurrency, DEFAULTS.verifyConcurrency, 1, 8)
  const explicit = parseVerifyChecks(evaluator.verifyChecks, verifyTimeoutMs)
  const verifyChecks = explicit.length > 0
    ? explicit
    : verifyCommand
      ? [{ id: "verify-command", type: "custom" as const, command: verifyCommand, timeoutMs: verifyTimeoutMs, required: true, when: "always" as const, label: "verifyCommand", evidence: "command" as const }]
      : []
  return { verifyCommand, verifyTimeoutMs, verifyProfile, verifyChecks, verifyConcurrency }
}


/**
 * Resolves plugin options (opencode.json `plugins[].options`) with environment overrides:
 * OPENCODE_GOAL_MODEL, OPENCODE_GOAL_CHECKIN_MINUTES, OPENCODE_GOAL_MAX_TURNS, OPENCODE_GOAL_COMMIT_BRANCH,
 * OPENCODE_GOAL_REQUIRE_COMMIT, OPENCODE_GOAL_COORDINATOR, OPENCODE_GOAL_COMPACT_AT_TOKENS,
 * OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION, OPENCODE_GOAL_MAX_LOOPS, OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS,
 * OPENCODE_GOAL_MAX_RETRIES, OPENCODE_GOAL_VERIFY_COMMAND, OPENCODE_GOAL_VERIFY_TIMEOUT_MS, OPENCODE_GOAL_VERIFY_PROFILE,
 * OPENCODE_GOAL_VERIFY_CONCURRENCY, OPENCODE_GOAL_LEARNING_LOG, OPENCODE_GOAL_LEARNING_LOG_PATH.
 */
export function resolveConfig(
  options: Readonly<Record<string, unknown>> = {},
  env: Readonly<Record<string, string | undefined>> = {},
): GoalConfig {
  const evaluator = (typeof options.evaluator === "object" && options.evaluator !== null ? options.evaluator : {}) as Record<string, unknown>
  const model = parseModelRef([env.OPENCODE_GOAL_MODEL, evaluator.model, options.model].find((v) => (typeof v === "string" ? v.trim() !== "" : v != null))) // empty/whitespace strings read as unset — the `str`/`int` posture
  const requested = evaluator.mode === "session" || evaluator.mode === "independent" ? evaluator.mode : "auto"
  const mode = requested === "auto" ? (model ? "independent" : "session") : requested === "independent" && !model ? "session" : requested
  const verify = resolveVerifyMatrix(evaluator, env)
  const learning = (typeof options.learning === "object" && options.learning !== null ? options.learning : {}) as Record<string, unknown>
  const learningEnabled = envBool(env.OPENCODE_GOAL_LEARNING_LOG, bool(learning.enabled ?? options.learningLog, true))
  const learningPath = str(env.OPENCODE_GOAL_LEARNING_LOG_PATH ?? learning.path ?? options.learningLogPath, DEFAULTS.learningPath)
  return {
    evaluator: {
      mode,
      ...(model ? { model } : {}),
      maxTranscriptChars: int(evaluator.maxTranscriptChars, DEFAULTS.maxTranscriptChars, 4_000),
      maxOutputTokens: int(evaluator.maxOutputTokens, DEFAULTS.maxOutputTokens, 256),
      timeoutMs: int(evaluator.timeoutMs, DEFAULTS.timeoutMs, 5_000),
      verifyCommand: verify.verifyCommand,
      verifyTimeoutMs: verify.verifyTimeoutMs,
      verifyChecks: verify.verifyChecks,
      verifyProfile: verify.verifyProfile,
      verifyConcurrency: verify.verifyConcurrency,
      consensus: int(evaluator.consensus, DEFAULTS.consensus, 1, 2) as 1 | 2,
    },
    maxTurns: int(env.OPENCODE_GOAL_MAX_TURNS ?? options.maxTurns, DEFAULTS.maxTurns, 0),
    stallTurns: int(options.stallTurns, DEFAULTS.stallTurns, 0),
    checkinMinutes: int(env.OPENCODE_GOAL_CHECKIN_MINUTES ?? options.checkinMinutes, DEFAULTS.checkinMinutes, 0),
    maxIdleCheckins: int(options.maxIdleCheckins, DEFAULTS.maxIdleCheckins, 0),
    maxRetries: int(env.OPENCODE_GOAL_MAX_RETRIES ?? options.maxRetries, DEFAULTS.maxRetries, 0),
    maxConditionChars: int(options.maxConditionChars, DEFAULTS.maxConditionChars, 0),
    systemReminder: bool(options.systemReminder, false),
    compactAtTokens: int(env.OPENCODE_GOAL_COMPACT_AT_TOKENS ?? options.compactAtTokens, DEFAULTS.compactAtTokens, 0),
    compactOnLoopIteration: envBool(env.OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION, bool(options.compactOnLoopIteration, DEFAULTS.compactOnLoopIteration)),
    maxLoops: int(env.OPENCODE_GOAL_MAX_LOOPS ?? options.maxLoops, DEFAULTS.maxLoops, 1, 100),
    maxLoopSummaryTokens: int(env.OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS ?? options.maxLoopSummaryTokens, DEFAULTS.maxLoopSummaryTokens, 50, 4_000),
    learning: {
      enabled: learningEnabled,
      path: learningPath,
    },
    commit: {
      enabled: bool(options.requireCommit, envBool(env.OPENCODE_GOAL_REQUIRE_COMMIT, true)),
      branch: branch(env.OPENCODE_GOAL_COMMIT_BRANCH ?? options.commitBranch, DEFAULTS.commitBranch),
      coordinator: parseCoordinator(env.OPENCODE_GOAL_COORDINATOR ?? options.coordinator),
    },
  }
}

/** Truthy spellings are `1/true/yes/on`, falsy are `0/false/no/off` (case-insensitive); anything else is unrecognized. */
const TRUTHY = ["1", "true", "yes", "on"]
const FALSY = ["0", "false", "no", "off"]
const flag = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (TRUTHY.includes(normalized)) return true
  if (FALSY.includes(normalized)) return false
  return undefined
}

/** Coordinator option: `"auto"` (default, detect from repo), `true` (force), `false` (off). */
function parseCoordinator(value: unknown): "auto" | boolean {
  if (value === undefined || value === "auto" || value === "") return "auto"
  return flag(value) ?? "auto"
}

/** An environment flag: "1", "true", "yes" and "on" are true, "0", "false", "no" and "off" are false. */
function envBool(value: string | undefined, fallback: boolean) {
  return (value === undefined ? undefined : flag(value)) ?? fallback
}
