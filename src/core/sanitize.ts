/**
 * Deterministic filter for model-emitted reasoning control tags.
 *
 * Some models (observed live: `baidu/ernie-5.5-flash-preview` behind the KiloCode-Free alias, opencode
 * v2.3.2, Workstream XXV) wrap their inner monologue in namespaced tags such as `<ernie:think>…</ernie:think>`
 * — and sometimes emit only the closing half of the tag. Those tags are not goal tags, so `escape()` in
 * prompts.ts does not neutralize them, and the raw stream was persisted into `loopHistory[].summary` and
 * injected into the next-goal planner prompt as `latestSummary`. The observed leak also duplicated the
 * structured block after the stray closer before the summary hit the 1600-character slice.
 *
 * This module is the code half of the fix; the summarize prompts carry a matching plain-text rule. The
 * filter is conservative about content and aggressive about tags: when in doubt it keeps one copy of the
 * model's answer and discards the reasoning, never the reverse.
 *
 * Rules, in order (the function is idempotent):
 *  1. Remove every complete `<…tag…>…</…tag…>` pair (tag name `think`/`thinking`/`reasoning`/`thought`,
 *     case-insensitive, optional single namespace prefix such as `ernie:`).
 *  2. For each remaining stray closing tag, partition the text at the FIRST one:
 *     - if the part after it is empty, keep what came before;
 *     - if the part before it is empty, keep what came after;
 *     - if the post-tag text is a prefix of the pre-tag text (whitespace/punctuation-insensitive), the
 *       post-tag content is a truncated duplicate of the pre-tag block — keep the pre-tag part;
 *     - otherwise the pre-tag part was an unterminated reasoning preamble — keep the post-tag part.
 *     The kept part is re-cleaned, so earlier stray tags inside it are handled by the same rules.
 *  3. Drop any remaining unterminated opening tag to end-of-text: an opener with no closer means the
 *     model spent its budget reasoning, and everything after it is that reasoning, not the answer.
 *  4. Drop any leftover stray closing tag, then trim.
 */

const TAG_NAME = String.raw`(?:[A-Za-z][A-Za-z0-9_-]*:)?(?:think(?:ing)?|reasoning|thought)`
const PAIRED_RE = new RegExp(String.raw`<${TAG_NAME}>[\s\S]*?</${TAG_NAME}>`, "gi")
const OPEN_RE = new RegExp(String.raw`<${TAG_NAME}>`, "gi")
const CLOSE_RE = new RegExp(String.raw`</${TAG_NAME}>`, "gi")
const MAX_PASSES = 8

/** Whitespace/punctuation-insensitive probe for the prefix test. */
/**
 * The prefix comparison runs a lowercase + Unicode fold on both halves of a message on every pass;
 * the same halves recur when the filter is applied to streamed/duplicated reasoning. `probe` is pure,
 * so a bounded memo keyed by the raw half turns a repeat into one lookup.
 */
const PROBE_CACHE_LIMIT = 2048
const probeCache = new Map<string, string>()
const probe = (value: string): string => {
  const hit = probeCache.get(value)
  if (hit !== undefined) return hit
  const result = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
  if (probeCache.size < PROBE_CACHE_LIMIT) probeCache.set(value, result)
  return result
}

export function stripReasoningControl(text: string): string {
  let current = text
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const paired = current.replace(PAIRED_RE, "")
    if (paired !== current) {
      current = paired
      continue
    }
    const closes = [...current.matchAll(CLOSE_RE)]
    if (closes.length > 0) {
      const first = closes[0]!
      const before = current.slice(0, first.index)
      const after = current.slice(first.index + first[0].length)
      const beforeProbe = probe(before)
      const afterProbe = probe(after)
      if (afterProbe.length === 0) current = before
      else if (beforeProbe.length === 0) current = after
      else if (beforeProbe.startsWith(afterProbe)) current = before
      else current = after
      continue
    }
    const opens = [...current.matchAll(OPEN_RE)]
    if (opens.length > 0) {
      // Unterminated reasoning tail: drop from the first unmatched opener to end-of-text.
      current = current.slice(0, opens[0]!.index)
      continue
    }
    return current.trim()
  }
  return current.replace(OPEN_RE, "").replace(CLOSE_RE, "").trim()
}
