/**
 * Opt-in file sink for the plugin's logger.
 *
 * The plugin logs through raw `console.*`, which the host swallows (documented in SPEC): an operator
 * whose goal silently fails to adopt has no log anywhere to look at. `OPENCODE_GOAL_LOG_FILE` names a
 * file every log line is appended to as JSON Lines — one object per line with `ts` (ISO), `level`,
 * `message` and optional `data`. The sink is strictly best-effort: a logging failure never throws into
 * the caller, and the base logger is always called first.
 *
 * Very long sessions are the target case, so the file cannot grow without bound: when the target
 * exceeds `maxBytes` (default 5 MiB) it is rotated to `<file>.1` before the next append, replacing any
 * previous `.1`. One generation of history is kept; older lines are dropped by design.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { dirname } from "node:path"
import type { Logger } from "../runtime/ports.ts"

export const FILE_LOG_MAX_BYTES = 5 * 1024 * 1024

export interface FileSinkOptions {
  /** Clock override for tests; defaults to Date.now. */
  readonly now?: () => number
  /** Rotation threshold in bytes; defaults to FILE_LOG_MAX_BYTES. */
  readonly maxBytes?: number
}

/** JSON.stringify that survives anything a log site might hand it: cycles, bigints, Errors. */
function safeStringify(value: unknown): string | undefined {
  const seen = new Set<object>()
  try {
    return JSON.stringify(value, (_key, nested: unknown) => {
      if (typeof nested === "bigint") return nested.toString()
      if (nested instanceof Error) return { name: nested.name, message: nested.message }
      if (typeof nested === "object" && nested !== null) {
        if (seen.has(nested)) return "[circular]"
        seen.add(nested)
      }
      return nested
    })
  } catch {
    return undefined
  }
}

function rotateIfNeeded(file: string, maxBytes: number): void {
  try {
    if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`)
  } catch {
    // Missing file (first write) or a failed stat/rename: append below will surface real errors.
  }
}

/**
 * Wraps `base` so every line also lands in `file` as JSONL. Returns `base` unchanged when `file` is
 * unset or blank — the sink is strictly opt-in.
 */
export function withFileSink(base: Logger, file: string | undefined, options: FileSinkOptions = {}): Logger {
  const target = file?.trim()
  if (!target) return base
  const now = options.now ?? Date.now
  const maxBytes = options.maxBytes ?? FILE_LOG_MAX_BYTES

  const write = (level: "info" | "warn" | "error", message: string, value?: Record<string, unknown>): void => {
    try {
      rotateIfNeeded(target, maxBytes)
      const line =
        safeStringify({ ts: new Date(now()).toISOString(), level, message, ...(value !== undefined ? { data: value } : {}) }) ??
        safeStringify({ ts: new Date(now()).toISOString(), level, message, data: "[unserializable]" })
      try {
        appendFileSync(target, `${line}\n`)
      } catch {
        // Parent directory may not exist yet; create it once and retry. Beyond that, give up silently.
        mkdirSync(dirname(target), { recursive: true })
        appendFileSync(target, `${line}\n`)
      }
    } catch {
      // Logging must never break the caller.
    }
  }

  return {
    info: (message, value) => {
      base.info(message, value)
      write("info", message, value)
    },
    warn: (message, value) => {
      base.warn(message, value)
      write("warn", message, value)
    },
    error: (message, value) => {
      base.error(message, value)
      write("error", message, value)
    },
  }
}
