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

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return ""
  }
}

function renderAssistant(message: Unknown, options: Required<DigestOptions>): string {
  const blocks: string[] = []
  const content = Array.isArray(message.content) ? (message.content as Unknown[]) : []
  for (const part of content) {
    if (part.type === "text" && str(part.text).trim()) blocks.push(str(part.text).trim())
    if (part.type !== "tool") continue
    const state = (part.state ?? {}) as Unknown
    const input = head(compactJson(state.input), options.maxInputChars)
    if (state.status === "completed") {
      blocks.push(`[tool ${str(part.name)}] ${input}\n${headTail(toolText(state.content), options.maxToolChars)}`)
    } else if (state.status === "error") {
      const error = (state.error ?? {}) as Unknown
      blocks.push(`[tool ${str(part.name)} FAILED] ${input}\n${headTail(str(error.message) || toolText(state.content), options.maxToolChars)}`)
    } else {
      blocks.push(`[tool ${str(part.name)} ${str(state.status) || "pending"}] ${input}`)
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
    case "user":
      return str(m.text).trim() ? `USER:\n${head(str(m.text).trim(), options.maxToolChars)}` : ""
    case "synthetic":
      return str(m.text).trim() ? `NOTE:\n${head(str(m.text).trim(), options.maxToolChars)}` : ""
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
