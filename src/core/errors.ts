import type { FailureInfo } from "./types.ts"

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

export interface Classified {
  readonly kind: FailureClass
  readonly label: string
}

const FATAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/insufficient[\s_-]*(quota|funds|balance|credit)|credit[\s_-]*balance|out of credits?|billing|payment[\s_-]*required|exceeded your current quota/i, "credit balance exhausted"],
  [/context[\s_-]*(length|window|overflow|limit)|prompt is too long|too many tokens|maximum context|reduce the length/i, "context overflow that compaction could not clear"],
  [/unauthori[sz]ed|authenticat|invalid[\s_-]*(api[\s_-]*)?key|api key|forbidden|permission[\s_-]*denied|access[\s_-]*denied|expired[\s_-]*token/i, "authentication failure"],
  [/model.{0,40}(not[\s_-]*found|not[\s_-]*available|unavailable|does not exist|not supported|unsupported|deprecated)|unknown[\s_-]*model|no such model/i, "model not available"],
]

const PAUSE: ReadonlyArray<readonly [RegExp, string]> = [
  [/rate[\s_-]*limit|too many requests|usage[\s_-]*limit|quota/i, "rate or usage limit"],
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
  if (status === 429) return { kind: "pause", label: "rate or usage limit" }
  if (status !== undefined && (status >= 500 || status === 408)) return { kind: "transient", label: "provider overloaded or unavailable" }
  for (const [pattern, label] of PAUSE) if (pattern.test(text)) return { kind: "pause", label }
  for (const [pattern, label] of TRANSIENT) if (pattern.test(text)) return { kind: "transient", label }
  const message = (error?.message ?? error?.type ?? "unknown error").replace(/\s+/g, " ").trim().slice(0, 160)
  return { kind: "pause", label: message || "unknown error" }
}
