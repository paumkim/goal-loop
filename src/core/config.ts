import type { CommitRequest, ModelRef } from "./types.ts"

export type EvaluatorMode = "auto" | "session" | "independent"

export interface GoalConfig {
  readonly evaluator: {
    /** `session` reuses the session's model and cached prefix; `independent` uses `model` on a transcript digest. */
    readonly mode: Exclude<EvaluatorMode, "auto">
    readonly model?: ModelRef
    readonly maxTranscriptChars: number
    readonly maxOutputTokens: number
    readonly timeoutMs: number
  }
  /** Hard turn cap; 0 disables. Conditions can still carry their own natural-language limit. */
  readonly maxTurns: number
  /** Consecutive evaluated turns without tool use before the loop pauses. */
  readonly stallTurns: number
  /** First check-in interval for background work; 0 disables check-ins and automatic retries. */
  readonly checkinMinutes: number
  readonly maxIdleCheckins: number
  readonly maxRetries: number
  readonly maxConditionChars: number
  /** Adds a stable system reminder while a goal is live. Costs one prompt-cache miss when toggled. */
  readonly systemReminder: boolean
  /** Records verdicts in the transcript as synthetic notes. */
  readonly transcriptNotes: boolean
  /** Finished work has to be committed before the goal counts as met. */
  readonly commit: CommitRequest
}

export const DEFAULTS = {
  maxTranscriptChars: 60_000,
  maxOutputTokens: 4_096,
  timeoutMs: 120_000,
  maxTurns: 200,
  stallTurns: 3,
  checkinMinutes: 30,
  maxIdleCheckins: 3,
  maxRetries: 3,
  // Effectively unlimited: goals are pasted from the clipboard and can run to whole files, so the default never rejects.
  maxConditionChars: Number.MAX_SAFE_INTEGER,
  commitBranch: "dev",
} as const

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

/** A branch name: a non-empty string with no whitespace. */
const branch = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  return trimmed && !/\s/.test(trimmed) ? trimmed : fallback
}

/**
 * Resolves plugin options (opencode.json `plugins[].options`) with environment overrides:
 * OPENCODE_GOAL_MODEL, OPENCODE_GOAL_CHECKIN_MINUTES, OPENCODE_GOAL_MAX_TURNS, OPENCODE_GOAL_COMMIT_BRANCH,
 * OPENCODE_GOAL_REQUIRE_COMMIT.
 */
export function resolveConfig(
  options: Readonly<Record<string, unknown>> = {},
  env: Readonly<Record<string, string | undefined>> = {},
): GoalConfig {
  const evaluator = (typeof options.evaluator === "object" && options.evaluator !== null ? options.evaluator : {}) as Record<string, unknown>
  const model = parseModelRef(env.OPENCODE_GOAL_MODEL ?? evaluator.model ?? options.model)
  const requested = evaluator.mode === "session" || evaluator.mode === "independent" ? evaluator.mode : "auto"
  const mode = requested === "auto" ? (model ? "independent" : "session") : requested === "independent" && !model ? "session" : requested
  return {
    evaluator: {
      mode,
      ...(model ? { model } : {}),
      maxTranscriptChars: int(evaluator.maxTranscriptChars, DEFAULTS.maxTranscriptChars, 4_000),
      maxOutputTokens: int(evaluator.maxOutputTokens, DEFAULTS.maxOutputTokens, 256),
      timeoutMs: int(evaluator.timeoutMs, DEFAULTS.timeoutMs, 5_000),
    },
    maxTurns: int(env.OPENCODE_GOAL_MAX_TURNS ?? options.maxTurns, DEFAULTS.maxTurns, 0),
    stallTurns: int(options.stallTurns, DEFAULTS.stallTurns, 1),
    checkinMinutes: int(env.OPENCODE_GOAL_CHECKIN_MINUTES ?? options.checkinMinutes, DEFAULTS.checkinMinutes, 0),
    maxIdleCheckins: int(options.maxIdleCheckins, DEFAULTS.maxIdleCheckins, 0),
    maxRetries: int(options.maxRetries, DEFAULTS.maxRetries, 0),
    maxConditionChars: int(options.maxConditionChars, DEFAULTS.maxConditionChars, 100),
    systemReminder: bool(options.systemReminder, false),
    transcriptNotes: bool(options.transcriptNotes, true),
    commit: {
      enabled: bool(options.requireCommit, envBool(env.OPENCODE_GOAL_REQUIRE_COMMIT, true)),
      branch: branch(env.OPENCODE_GOAL_COMMIT_BRANCH ?? options.commitBranch, DEFAULTS.commitBranch),
    },
  }
}

/** An environment flag: "1", "true", "yes" and "on" are true, "0", "false", "no" and "off" are false. */
function envBool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}
