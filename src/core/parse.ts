export type GoalCommand =
  | { readonly type: "status" }
  | { readonly type: "clear" }
  | { readonly type: "set"; readonly condition: string }
  | { readonly type: "invalid"; readonly message: string }

/** Same aliases Claude Code accepts for `/goal clear`. */
export const CLEAR_ALIASES: ReadonlySet<string> = new Set(["clear", "stop", "off", "reset", "none", "cancel"])

/** `/goal` -> status, `/goal clear|stop|...` -> clear, anything else sets (or replaces) the goal.
 *  A non-finite limit, or Number.MAX_SAFE_INTEGER (the default), means unlimited: whole pasted files are accepted.
 *  An explicit finite limit (e.g. 4000) is still enforced. */
export function parseGoalCommand(raw: string, maxChars: number): GoalCommand {
  const text = raw.replace(/\r\n?/g, "\n").trim()
  if (text === "") return { type: "status" }
  if (CLEAR_ALIASES.has(text.toLowerCase())) return { type: "clear" }
  const condition = unquote(text)
  if (condition === "") return { type: "status" }
  const unlimited = !Number.isFinite(maxChars) || maxChars >= Number.MAX_SAFE_INTEGER
  if (!unlimited && condition.length > maxChars)
    return { type: "invalid", message: `Goal condition is ${condition.length} characters; the limit is ${maxChars}.` }
  return { type: "set", condition }
}

function unquote(text: string) {
  const first = text[0]
  if (text.length >= 2 && (first === '"' || first === "'" || first === "`") && text.endsWith(first)) return text.slice(1, -1).trim()
  return text
}

/** A leading `/goal-loop[-N|=N]` directive in a raw user prompt (the unknown-slash-command path). */
export interface GoalLoopDirective {
  /** Everything after the directive token, trimmed: the objective/context. The directive and N are never part of it. */
  readonly objective: string
  /** Valid per-run override from the token (1..1000). Absent means the configured/default limit applies. */
  readonly maxLoops?: number
  /** Raw suffix when one was provided but is not an integer from 1 to 1000. */
  readonly invalidCount?: string
}

/** `/goal-loop` · `/goal-loop-<N>` · `/goal-loop=<N>` at the very beginning of the message. N must be ASCII digits, 1..1000. */
const GOAL_LOOP_DIRECTIVE = /^\/goal-loop(?:[-\=]([^\s]*))?(?=[\s]|$)/

/**
 * Parse a leading goal-loop directive out of raw prompt text. Returns undefined when the text does not start with one
 * (the `/goal` command, a plain prompt, `/goal-loopy ...`). Everything after the token is the objective; the count is
 * never part of the completion condition. Surrounding whitespace before/after the token is ignored.
 * An invalid suffix does not throw and does not get guessed: `invalidCount` is set and the caller falls back to the default.
 */
export function parseGoalLoopDirective(raw: string): GoalLoopDirective | undefined {
  const text = raw.replace(/\r\n?/g, "\n").trimStart()
  const match = GOAL_LOOP_DIRECTIVE.exec(text)
  if (!match) return undefined
  const objective = text.slice(match[0].length).trim()
  const suffix = match[1]
  if (suffix === undefined) return { objective }
  if (!/^[0-9]+$/.test(suffix)) return { objective, invalidCount: suffix }
  const maxLoops = Number.parseInt(suffix, 10)
  if (maxLoops < 1 || maxLoops > 1000) return { objective, invalidCount: suffix }
  return { objective, maxLoops }
}
