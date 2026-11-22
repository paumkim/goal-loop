import type { FailureInfo } from "./types.ts"

/**
 * The one rendering for a dynamic value named in an error message. JSON.stringify gives a single
 * unambiguous convention — strings double-quoted, numbers/booleans/null bare, arrays and objects as
 * JSON — instead of each throw site quoting by hand. Its few unserializable inputs get a stable
 * textual fallback, so the helper never throws while building an error.
 */
export function formatValue(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "symbol" || typeof value === "function") return String(value)
  const json = JSON.stringify(value)
  return json === undefined ? String(value) : json
}

/** Extracts a readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) return String((error as { message: unknown }).message)
  return String(error)
}

/**
 * - `fatal`: will not clear until the user fixes something; the goal fails (auth, credit, context, model).
 * - `transient`: tends to clear on its own; retried with backoff (overload, network, timeouts).
 * - `pause`: a retry would only repeat it; the goal waits for the user (rate/usage limits, unknown errors).
 */
export type FailureClass = "fatal" | "transient" | "pause"

interface Classified {
  readonly kind: FailureClass
  readonly label: string
}

const FATAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/insufficient[\s_-]*(quota|funds|balance|credit)|credit[\s_-]*balance|out of credits?|billing|payment[\s_-]*required|exceeded your current quota/i, "credit balance exhausted"],
  [/context[\s_-]*(length|window|overflow|limit)|prompt is too long|too many tokens|maximum context|reduce the length/i, "context overflow that compaction could not clear"],
  [/unauthori[sz]ed|authenticat|invalid[\s_-]*(api[\s_-]*)?key|api key|forbidden|permission[\s_-]*denied|access[\s_-]*denied|expired[\s_-]*token/i, "authentication failure"],
  [/model.{0,40}(not[\s_-]*found|not[\s_-]*available|unavailable|does not exist|not supported|unsupported|deprecated)|unknown[\s_-]*model|no such model/i, "model not available"],
]

/**
 * A genuine provider usage/rate limit is a quota *signal*, not a phrase that merely appears in an evaluator error.
 * Recognized signals: an HTTP 429 status (numeric `status`/`code`, or "HTTP 429" in text), a provider error code
 * such as `rate_limit_error` / `tpm_rate_limit_exceeded` / `freeusagelimit`, or an assertion that a limit was
 * actually hit ("rate limit exceeded", "free usage limit reached", "too many requests"). A bare "rate limit" in a
 * hint, a negation ("no usage limit"), or a provider name followed by "usage" ("KiloCode-Free usage") is NOT a
 * signal — matching those paused the goal on ordinary evaluator failures. A generic error must never pause a goal.
 */

/** 429 in a status/code field: numeric or a bare numeric string. */
function is429(value: unknown): boolean {
  return value === 429 || (typeof value === "string" && /^\s*429\s*$/.test(value))
}

/**
 * Compact provider error codes: the limit/quota words are joined without spaces (rate_limit_error,
 * tpm_rate_limit_exceeded, provider.free-limit, freeusagelimit, too_many_requests). A *prose* phrase like
 * "rate limit settings" has spaces and is NOT a code — matching it there was the false positive that
 * parked goals on ordinary evaluator failures. Prose is judged by QUOTA_HIT/hasUsageLimitText instead,
 * which requires an assertion that a limit was actually hit.
 */
const QUOTA_CODE = /\b(?:(?:rate|tpm|usage|free|request)[_-]*)+(?:limit|quota)(?:[_-]*(?:error|exceeded|reached|hit|exhausted))*\b|\bfreeusage(?:limit|error)(?:error)?\b|\btoo[_-]*many[_-]*requests\b|\bquota[_-]*(?:exceeded|reached|exhausted)\b|\binsufficient[_-]*quota\b/i

/** Free text asserting a limit was actually hit — not mentioned, negated, or merely configured. */
const QUOTA_HIT = /(?<!\bno\s)(?<!\bnot\s)(?<!\bnever\s)(?<!\bwithout\s)\b(?:free[\s_-]*)?(?:rate|usage|request|tpm|quota)[\s_-]*limit\b(?:\s+(?:was|is|has|have|were|been|of|for|by|at|to|the|a)){0,6}\s+(?:reached|exceeded|hit|exhausted|exceeds?)\b/i
const HTTP_429_TEXT = /\bHTTP[\s:/-]*429\b|\(\s*429\s*\)/i
const TOO_MANY_REQUESTS = /\btoo[\s_-]*many[\s_-]*requests\b/i
const FREE_USAGE_ERROR = /\bfreeusage(?:limit|error)(?:error)?\b|\bfree[\s_-]*usage[\s_-]*limit[\s_-]*error\b/i

function hasUsageLimitText(text: string): boolean {
  return HTTP_429_TEXT.test(text) || TOO_MANY_REQUESTS.test(text) || FREE_USAGE_ERROR.test(text) || QUOTA_HIT.test(text)
}

export function isUsageLimitError(error: unknown): boolean {
  if (typeof error === "string") return hasUsageLimitText(error)
  if (typeof error !== "object" || error === null) return false
  const record = error as { status?: unknown; code?: unknown; type?: unknown; name?: unknown; message?: unknown; error?: unknown }
  if (is429(record.status) || is429(record.code)) return true
  // Structured provider codes/types are unambiguous; free text must assert a hit, not merely name a limit.
  const codes = [record.type, record.code, record.name].filter((v): v is string => typeof v === "string").join(" ")
  if (QUOTA_CODE.test(codes) || hasUsageLimitText(codes)) return true
  const text = [record.message, record.error].filter((v): v is string => typeof v === "string").join(" ")
  return hasUsageLimitText(text)
}

const PAUSE: ReadonlyArray<readonly [RegExp, string]> = [
  [/hook/i, "a hook ended the turn"],
]

const TRANSIENT: ReadonlyArray<readonly [RegExp, string]> = [
  [/overload|capacity|server[\s_-]*error|internal[\s_-]*error|bad[\s_-]*gateway|service[\s_-]*unavailable|temporar/i, "provider overloaded or unavailable"],
  [/timeout|timed[\s_-]*out|econnreset|econnrefused|enotfound|socket|network|fetch failed|connection|stream[\s_-]*(closed|ended|error)|aborted|eai_again/i, "dropped connection"],
]

/** Definitive not-found: the session/model genuinely does not exist (404 / "not found" / "no such session"). */
export function isNotFoundError(error: unknown): boolean {
  if (typeof error === "string") return /not[\s_-]*found|no[\s_-]*such[\s_-]*session|unknown[\s_-]*session/i.test(error)
  if (typeof error !== "object" || error === null) return false
  const record = error as { status?: unknown; code?: unknown; type?: unknown; message?: unknown; name?: unknown }
  if (record.status === 404) return true
  const text = `${typeof record.type === "string" ? record.type : ""} ${typeof record.message === "string" ? record.message : ""} ${typeof record.name === "string" ? record.name : ""} ${typeof record.code === "string" ? record.code : ""}`
  return /not[\s_-]*found|no[\s_-]*such[\s_-]*session|unknown[\s_-]*session|session[\s_-]*(?:not[\s_-]*found|missing|deleted)/i.test(text)
}

export function classifyFailure(error: FailureInfo | undefined): Classified {
  const text = `${error?.type ?? ""} ${error?.message ?? ""}`
  const status = error?.status
  // A missing session is not a missing model: it pauses for the user, it must not be labelled "model".
  if (/session[\s_-]*(?:not[\s_-]*found|missing|deleted)|no[\s_-]*such[\s_-]*session/i.test(text)) return { kind: "pause", label: "session not found" }
  // Credit errors arrive as 402 or as 429 with a quota message; check them before rate limits.
  for (const [pattern, label] of FATAL) if (pattern.test(text)) return { kind: "fatal", label }
  if (status === 401 || status === 403) return { kind: "fatal", label: "authentication failure" }
  if (status === 402) return { kind: "fatal", label: "credit balance exhausted" }
  if (status === 404) return { kind: "fatal", label: "model not available" }
  if (status === 413) return { kind: "fatal", label: "context overflow that compaction could not clear" }
  // A genuine quota signal (429 / quota code / asserted hit) pauses with the long window. Check it before the
  // generic 5xx branch so a provider that wraps a quota hit in a 500 is not retried on the short transient
  // backoff. A mere mention of a limit in an unrelated error must NOT get this label/branch — it would park the
  // goal for 15m and mask a transient failure. isUsageLimitError is the single tight detector shared with the
  // evaluator path, so both paths agree on what counts as a quota.
  if (isUsageLimitError(error)) return { kind: "pause", label: "rate or usage limit" }
  if (status === 429) return { kind: "pause", label: "rate or usage limit" }
  if (status !== undefined && (status >= 500 || status === 408)) return { kind: "transient", label: "provider overloaded or unavailable" }
  for (const [pattern, label] of PAUSE) if (pattern.test(text)) return { kind: "pause", label }
  for (const [pattern, label] of TRANSIENT) if (pattern.test(text)) return { kind: "transient", label }
  const message = (error?.message ?? error?.type ?? "unknown error").replace(/\s+/g, " ").trim().slice(0, 160)
  return { kind: "pause", label: message || "unknown error" }
}
