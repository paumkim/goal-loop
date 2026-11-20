import type { Verdict } from "./types.ts"

export interface ParsedVerdict {
  readonly verdict: Verdict
  readonly reason: string
}

const MAX_REASON = 4000

/**
 * Workstream XLIV — the novelty / advancement gate, decidable from the verdict text alone.
 *
 * A "met" whose reason claims the already-satisfied / no-new-work path without naming a next concrete gap on the
 * established `next:`-line convention is not an advancement verdict; accepting it would credit duplicates as met.
 * It fails closed to not_met with the original reason quoted — exactly like the verification gate's downgrade.
 * Never upgrades a verdict, never touches not_met or impossible, never fires on a met that names its gap.
 */
const ALREADY_SATISFIED = /(already[-\s]satisfied|no new work|nothing[_\s-](new[_\s-])?to do|no work needed)/i
const NEXT_POINTER = /next\s*:/i
const DUPLICATE_REASON = "duplicate-without-forward-pointer"

export function applyForwardPointerGate(parsed: ParsedVerdict): ParsedVerdict {
  if (parsed.verdict !== "met") return parsed
  if (!ALREADY_SATISFIED.test(parsed.reason)) return parsed
  if (NEXT_POINTER.test(parsed.reason)) return parsed
  const original = parsed.reason
  const quoted = original.length > 240 ? `${original.slice(0, 240)}…` : original
  return {
    verdict: "not_met",
    reason: clampReason(
      `${DUPLICATE_REASON}: verdict "met" claims prior work was "Already satisfied" but names no next concrete gap on a "next:" line; name a specific file, symbol or workstream from this turn's audit. Original: ${quoted}`,
    ),
  }
}

// Only explicit permanent words count as impossible. "blocked"/"cannot" are ambiguous (usually temporary or
// "cannot yet"), so they count as not_met: ending the goal on them would be a false terminal verdict.
const SYNONYMS: ReadonlyArray<readonly [RegExp, Verdict]> = [
  [/^(not[\s_-]*(yet[\s_-]*)?met|unmet|not[\s_-]*done|incomplete|in[\s_-]*progress|continue|pending|no|blocked|cannot|can't)$/i, "not_met"],
  [/^(impossible|unachievable|unsatisfiable|infeasible)$/i, "impossible"],
  [/^(met|achieved|done|complete|completed|satisfied|success|yes|true|pass|passed)$/i, "met"],
]

function normalizeVerdict(value: unknown): Verdict | undefined {
  if (typeof value === "boolean") return value ? "met" : "not_met"
  if (typeof value !== "string") return undefined
  const text = value.trim()
  for (const [pattern, verdict] of SYNONYMS) if (pattern.test(text)) return verdict
  return undefined
}

/**
 * Extracts the evaluator's verdict from free-form model output. Accepts strict JSON, JSON in a code fence
 * or surrounded by prose, and a `VERDICT: x` fallback. Returns undefined when nothing trustworthy is found.
 */
export function parseVerdict(text: string): ParsedVerdict | undefined {
  const cleaned = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").trim()
  for (const candidate of jsonObjects(cleaned)) {
    const parsed = safeJson(candidate)
    if (typeof parsed !== "object" || parsed === null) continue
    const record = parsed as Record<string, unknown>
    const verdict = normalizeVerdict(record.verdict ?? record.status ?? record.result ?? record.met)
    if (!verdict) continue
    return applyForwardPointerGate({ verdict, reason: clampReason(record.reason ?? record.explanation ?? record.rationale) })
  }
  const line = /verdict\s*[:=]\s*["']?([a-z_\s-]+?)["']?\s*(?:[\n.;,]|$)/i.exec(cleaned)
  const verdict = line ? normalizeVerdict(line[1]) : undefined
  if (!verdict) return undefined
  const reason = /reason\s*[:=]\s*(.+)/i.exec(cleaned)?.[1]
  return applyForwardPointerGate({ verdict, reason: clampReason(reason) })
}

function clampReason(value: unknown) {
  if (typeof value !== "string") return ""
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (text.length <= MAX_REASON) return text
  return `${text.slice(0, MAX_REASON - 1)}\u2026`
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Yields balanced top-level `{...}` spans, string-aware, in order of appearance. */
function* jsonObjects(text: string): Generator<string> {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const char = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === "{") depth++
      else if (char === "}" && --depth === 0) {
        yield text.slice(start, i + 1)
        break
      }
    }
  }
}
