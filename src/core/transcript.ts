/**
 * Renders session context into a compact, evidence-first digest for an independent evaluator.
 * Works on loosely typed messages so it tolerates schema additions across OpenCode releases.
 */

type Unknown = Record<string, unknown>

interface DigestOptions {
  readonly maxChars: number
  /** Per-tool-output cap. Tails are kept: test runners and builds report results last. */
  readonly maxToolChars?: number
  readonly maxInputChars?: number
}

const str = (value: unknown) => (typeof value === "string" ? value : "")

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * Largest code-unit index <= `n` that ends on a clean UTF-16 boundary. If a cut at `n` would end on a high surrogate
 * (its low partner sits just beyond the cut), back off one unit so the astral pair is excluded whole instead of
 * leaking a lone surrogate into the evaluator's evidence corpus.
 */
function safeFrontCut(text: string, n: number): number {
  let end = Math.max(0, Math.min(text.length, Math.floor(n)))
  if (isHigh(text.charCodeAt(end - 1))) end -= 1
  return end
}

/**
 * Smallest code-unit index >= `n` that starts on a clean UTF-16 boundary. If the cut would start on a low surrogate
 * (its high partner sits just before the cut), advance one unit so the orphan half is dropped, not emitted alone.
 */
function safeBackStart(text: string, n: number): number {
  let start = Math.max(0, Math.min(text.length, Math.floor(n)))
  if (isLow(text.charCodeAt(start))) start += 1
  return start
}

function head(text: string, max: number) {
  if (text.length <= max) return text
  const end = safeFrontCut(text, max)
  return `${text.slice(0, end)}\u2026 [${text.length - end} chars cut]`
}

function headTail(text: string, max: number) {
  if (text.length <= max) return text
  const cap = Math.max(1, Math.floor(max)) // a zero budget returns the cut marker plus a proven tail, never the whole input
  const front = safeFrontCut(text, Math.floor(cap * 0.25))
  const back = cap - Math.floor(cap * 0.25)
  const tailStart = safeBackStart(text, text.length - back)
  const tail = tailStart >= text.length ? "" : text.slice(tailStart) // slice(-0) would return the whole input
  return `${text.slice(0, front)}\n\u2026 [${text.length - cap} chars cut] \u2026\n${tail}`
}

function toolText(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return content
    .map((part: Unknown) => (part?.type === "text" ? str(part.text) : part?.type === "file" ? `[file ${str(part.name) || str(part.uri)}]` : ""))
    .filter(Boolean)
    .join("\n")
}

/**
 * Human-readable one-line summary of a tool call's arguments. The old digest dumped `JSON.stringify(input)`,
 * which filled the judge's prompt with escaped command strings and full file bodies — exactly the noise the
 * evidence rubric asks it to look past. Keep the identifying field per tool, cap it, and never spill raw JSON.
 */
function toolArgs(name: string, input: unknown, limit: number): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return ""
  const args = input as Unknown
  // One shared budget across all fields: two capped values must not double the old single-JSON cap.
  let remaining = Math.max(0, limit)
  const take = (text: string) => {
    const value = head(text, remaining)
    remaining = Math.max(0, remaining - value.length)
    return value
  }
  // Bash-family tools carry the whole command; that is the evidence, so keep it verbatim (capped).
  if (/^(bash|shell|terminal|execute)$/i.test(name)) {
    const command = str(args.command ?? args.cmd ?? args.script)
    return command ? `command: ${take(command.replace(/\s+/g, " ").trim())}` : ""
  }
  // Everything else is summarised by its most identifying scalar fields, in a stable order.
  const preferred = ["path", "file", "filePath", "pattern", "query", "url", "command", "name", "id", "message"]
  const parts: string[] = []
  for (const key of preferred) {
    const value = args[key]
    if (typeof value === "string" && value.trim()) parts.push(`${key}: ${take(value.replace(/\s+/g, " ").trim())}`)
    if (parts.length >= 2) break
  }
  return parts.join("  ·  ")
}

/** Indent a block under a tool header so output reads as evidence rather than a flat wall of text. */
function indent(block: string, prefix = "    ") {
  return block.split("\n").map((line) => (line ? `${prefix}${line}` : line)).join("\n")
}

function renderAssistant(message: Unknown, options: Required<DigestOptions>): string {
  const blocks: string[] = []
  const content = Array.isArray(message.content) ? (message.content as Unknown[]) : []
  for (const part of content) {
    if (part.type === "text") {
      // Trim once: the digest is rebuilt on every evaluator turn and this is its largest input.
      const text = str(part.text).trim()
      if (text) blocks.push(text)
    }
    if (part.type !== "tool") continue
    const state = (part.state ?? {}) as Unknown
    const name = str(part.name)
    const args = toolArgs(name, state.input, options.maxInputChars)
    const suffix = args ? ` ${args}` : ""
    if (state.status === "completed") {
      const output = headTail(toolText(state.content), options.maxToolChars)
      blocks.push(`[tool ${name}]${suffix}${output ? `\n  output:\n${indent(output)}` : ""}`)
    } else if (state.status === "error") {
      const error = (state.error ?? {}) as Unknown
      const detail = headTail(str(error.message) || toolText(state.content), options.maxToolChars)
      blocks.push(`[tool ${name} FAILED]${suffix}${detail ? `\n  error:\n${indent(detail)}` : ""}`)
    } else {
      blocks.push(`[tool ${name} ${str(state.status) || "pending"}]${suffix}`)
    }
  }
  const error = message.error as Unknown | undefined
  if (error && str(error.message)) blocks.push(`[turn error] ${str(error.message)}`)
  return blocks.length ? `ASSISTANT:\n${blocks.join("\n\n")}` : ""
}

function renderMessage(message: unknown, options: Required<DigestOptions>): string {
  if (typeof message !== "object" || message === null) return ""
  const m = message as Unknown
  switch (m.type) {
    case "user": {
      const text = str(m.text).trim()
      return text ? `USER:\n${head(text, options.maxToolChars)}` : ""
    }
    case "synthetic": {
      const text = str(m.text).trim()
      return text ? `NOTE:\n${head(text, options.maxToolChars)}` : ""
    }
    case "assistant":
      return renderAssistant(m, options)
    case "shell": {
      const output = (m.output ?? {}) as Unknown
      return `[user shell] ${str(m.command)} (exit ${String(m.exit ?? "?")})\n${headTail(str(output.output), options.maxToolChars)}`
    }
    case "compaction":
      return m.status === "completed" && str(m.summary) ? `EARLIER CONTEXT (summary):\n${str(m.summary)}` : ""
    case "system":
      return ""
    default:
      return ""
  }
}

/** Newest-first packing under the character budget, then restored to chronological order. */
export function renderTranscript(messages: readonly unknown[], options: DigestOptions): string {
  const resolved: Required<DigestOptions> = {
    maxChars: options.maxChars,
    maxToolChars: options.maxToolChars ?? Math.max(1_500, Math.floor(options.maxChars / 12)),
    maxInputChars: options.maxInputChars ?? 400,
  }
  const picked: string[] = []
  let used = 0
  let omitted = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const block = renderMessage(messages[i], resolved)
    if (!block) continue
    if (used + block.length + 2 > resolved.maxChars) {
      if (picked.length === 0) {
        picked.push(headTail(block, resolved.maxChars))
        used = resolved.maxChars
        continue
      }
      omitted = i + 1
      break
    }
    picked.push(block)
    used += block.length + 2
  }
  picked.reverse()
  if (omitted > 0) picked.unshift(`[${omitted} earlier messages omitted]`)
  return picked.join("\n\n")
}

/**
 * A tight "what the parent actually did" digest for a *native* evaluator child.
 *
 * {@link renderTranscript} packs the whole raw context for the generation judge, which has no other source of
 * truth. A native child is different: the enrichment hook already gives it the original goal in its own prompt.
 * Everything else in a long-lived session is noise — earlier goal directives, prior `<subagent>`
 * verdicts about *other* conditions, goal continuations quoting stale evaluator reasons, and the worker's own
 * narration of all of it. A small model will happily mistake one of those stale conditions for the armed one (that
 * is exactly what happened in ses_e0098ece6ffeTolK2m5fCkkGiE: four children judged four different old conditions).
 *
 * So keep only tool calls and their results from the worker's own messages, newest first, under a small budget.
 * Narration is not evidence and is deliberately dropped. Returns "" when the worker produced no tool evidence.
 */
export function renderParentSummary(messages: readonly unknown[], options: DigestOptions): string {
  const resolved: Required<DigestOptions> = {
    maxChars: options.maxChars,
    maxToolChars: options.maxToolChars ?? Math.max(800, Math.floor(options.maxChars / 6)),
    maxInputChars: options.maxInputChars ?? 200,
  }
  const picked: string[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || typeof message !== "object") continue
    const m = message as Unknown
    const content = Array.isArray(m.content) ? (m.content as Unknown[]) : []
    const blocks: string[] = []
    for (const part of content) {
      if (!part || part.type !== "tool") continue
      const state = (part.state ?? {}) as Unknown
      const name = str(part.name)
      const args = toolArgs(name, state.input, resolved.maxInputChars)
      const suffix = args ? ` ${args}` : ""
      if (state.status === "completed") {
        const output = headTail(toolText(state.content), resolved.maxToolChars)
        blocks.push(`[tool ${name}]${suffix}${output ? `\n  output:\n${indent(output)}` : ""}`)
      } else if (state.status === "error") {
        const error = (state.error ?? {}) as Unknown
        const detail = headTail(str(error.message) || toolText(state.content), resolved.maxToolChars)
        blocks.push(`[tool ${name} FAILED]${suffix}${detail ? `\n  error:\n${indent(detail)}` : ""}`)
      } else {
        blocks.push(`[tool ${name} ${str(state.status) || "pending"}]${suffix}`)
      }
    }
    if (!blocks.length) continue
    const block = blocks.join("\n\n")
    if (used + block.length + 2 > resolved.maxChars) {
      if (picked.length === 0) {
        picked.push(headTail(block, resolved.maxChars))
        used = resolved.maxChars
        continue
      }
      break
    }
    picked.push(block)
    used += block.length + 2
  }
  picked.reverse()
  return picked.join("\n\n")
}
