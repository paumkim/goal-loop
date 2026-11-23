/**
 * Plain-language error text for user-visible surfaces (toasts and the `/goal` dialog fallback).
 *
 * `src/core/errors.ts · errorMessage` is the repo's one extractor for "what does this thrown value
 * say"; this module only decides what is SAFE TO SHOW. Stack frames and an `Error:` prefix never reach
 * the user, an object with no message never dumps as `[object Object]`, raw Node system codes get a
 * human phrase (and lose the host path), and the width is bounded so one bad filesystem error cannot
 * flood a toast. The full error — stack included — is logged separately at the catch site
 * (`tui.tsx · logUiError`); only the text produced here is rendered.
 */
import { errorMessage } from "./core/errors.ts"

/** Default cap for a user-visible error line (matches the old toast slices, minus the raw stack). */
export const USER_ERROR_MAX_LENGTH = 200

const STACK_FRAME = /^\s*at\s+/
const ERROR_PREFIX = /^(?:[A-Za-z][A-Za-z0-9]*Error):\s*/
const NULLISH = new Set(["null", "undefined", "[object Object]"])

/** Well-known Node system errors: plain phrase only, no code and no host path (paths can be sensitive). */
const SYSTEM_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^ENOENT\b/, "file or directory not found"],
  [/^EACCES\b/, "permission denied"],
  [/^EPERM\b/, "operation not permitted"],
  [/^ENOTDIR\b/, "path is not a directory"],
  [/^EISDIR\b/, "path is a directory"],
  [/^EEXIST\b/, "file already exists"],
]

export function userFacingError(error: unknown, maxLength = USER_ERROR_MAX_LENGTH): string {
  const raw = errorMessage(error)
  const plain = raw
    .split("\n")
    .filter((line) => !STACK_FRAME.test(line))
    .join(" ")
    .replace(ERROR_PREFIX, "")
    .replace(/\s+/g, " ")
    .trim()

  const friendly = SYSTEM_PHRASES.find(([pattern]) => pattern.test(plain))?.[1] ?? plain
  if (!friendly || NULLISH.has(friendly)) return "an unexpected error occurred"

  const width = Number.isFinite(maxLength) && maxLength > 1 ? Math.floor(maxLength) : USER_ERROR_MAX_LENGTH
  return friendly.length > width ? `${friendly.slice(0, width - 1)}…` : friendly
}
