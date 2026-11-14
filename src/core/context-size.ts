/**
 * Estimates the model-visible context size of a session from loosely typed messages.
 * Pure and dependency-free so it stays unit-testable. Works on the raw context payload
 * (messages after the last compaction) and tolerates schema drift across OpenCode releases.
 */

type Unknown = Record<string, unknown>

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/** Token numbers carried by an assistant message; any subset may be present. */
interface TokenUsage {
  input?: number
  cacheRead?: number
  cacheWrite?: number
}

/** Reads `tokens` off an assistant-ish message. Returns undefined when there is nothing usable. */
function readTokens(message: Unknown): TokenUsage | undefined {
  const tokens = message.tokens
  if (typeof tokens !== "object" || tokens === null) return undefined
  const t = tokens as Unknown
  const cache = (typeof t.cache === "object" && t.cache !== null ? t.cache : {}) as Unknown
  const input = num(t.input)
  const cacheRead = num(cache.read)
  const cacheWrite = num(cache.write)
  if (input === undefined && cacheRead === undefined && cacheWrite === undefined) return undefined
  return { input, cacheRead, cacheWrite }
}

/**
 * Estimates the prompt tokens the model would see next from the last assistant message's usage:
 * `input + cache.read + cache.write`. Reasoning and output are not part of the prompt context;
 * the output already became (part of) the input of the next step. Returns undefined when no
 * assistant message with usable token numbers is present.
 */
export function estimateContextTokens(messages: readonly unknown[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (typeof message !== "object" || message === null) continue
    const m = message as Unknown
    if (m.type !== "assistant") continue
    const usage = readTokens(m)
    if (!usage) return undefined
    return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  }
  return undefined
}
