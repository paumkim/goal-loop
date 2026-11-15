type GoalCommand =
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
