import type { Verdict } from "./types.ts"

interface ParsedVerdict {
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
// A forward pointer must name a concrete gap. `next: none` (the rubric's own no-gap output) and an empty
// pointer are not advancement: accepting them would let a zero-work "already satisfied" claim advance the loop.
const NEXT_POINTER = /next\s*:\s*(?!none\b|n\s*\/\s*a\b|$)\S/i
const DUPLICATE_REASON = "duplicate-without-forward-pointer"

/**
 * True for an "already satisfied at HEAD" met landing that names a concrete next gap. The zero-tool guard in
 * controller.ts must not downgrade such a verdict — it is the sanctioned forward-pointer path, not state
 * inspection posing as work. Uses the same regexes as applyForwardPointerGate so the two cannot drift.
 */
export function isAlreadySatisfiedLanding(reason: string): boolean {
  return ALREADY_SATISFIED.test(reason) && NEXT_POINTER.test(reason)
}

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

/** A model sometimes emits `JSON.stringify({verdict,reason})` instead of the object; peel at most this many layers. */
const MAX_JSON_UNWRAP = 3

const VERDICT_KEYS = ["verdict", "status", "result", "met"] as const
const REASON_KEYS = ["reason", "explanation", "rationale"] as const

// lenientFields runs for every malformed evaluator verdict (a raw newline or stray quote inside the reason
// that strict JSON.parse rejects), and used to build 4 field + up to 3 reason RegExp objects per call.
// Compile them once. Field patterns keep `g` (they scan every occurrence), so each use resets lastIndex —
// matching the old fresh-regex behavior exactly, including the object-key guard skipping quoted matches.
const LENIENT_FIELD_PATTERNS: readonly RegExp[] = VERDICT_KEYS.map((key) =>
  new RegExp(`"${key}"\\s*:\\s*"?([A-Za-z_][A-Za-z_\\s-]*?)"?\\s*(?=,|}|$)`, "gi"),
)
const LENIENT_REASON_PATTERNS: readonly RegExp[] = REASON_KEYS.map((key) =>
  new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)(?:"\\s*[,}]|$)`, "i"),
)

/**
 * Extracts the evaluator's verdict from free-form model output. Accepts strict JSON, JSON in a code fence
 * or surrounded by prose, and a `VERDICT: x` fallback. Returns undefined when nothing trustworthy is found.
 *
 * If strict JSON fails, a narrow lenient pass reads the same fields out of a JSON-ish object. Live evaluators
 * have emitted an otherwise well-formed verdict whose reason contained raw newlines or an unescaped quote;
 * `JSON.parse` rejects the whole object, and the old parser burned all three repair attempts on a verdict
 * it already had in hand. The lenient pass only accepts a recognized verdict token behind an object brace —
 * garbage, unknown tokens and the `VERDICT:`-less prose case still yield undefined. Strict parsing always wins.
 */
export function parseVerdict(text: string): ParsedVerdict | undefined {
  const cleaned = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").trim()
  const candidates = verdictCandidates(cleaned)

  for (const candidate of candidates) {
    const parsed = safeJson(candidate)
    if (typeof parsed !== "object" || parsed === null) continue
    const record = parsed as Record<string, unknown>
    const verdict = normalizeVerdict(record.verdict ?? record.status ?? record.result ?? record.met)
    if (!verdict) continue
    return applyForwardPointerGate({ verdict, reason: clampReason(record.reason ?? record.explanation ?? record.rationale) })
  }

  for (const candidate of candidates) {
    const lenient = lenientFields(candidate)
    if (!lenient) continue
    return applyForwardPointerGate({ verdict: lenient.verdict, reason: clampReason(lenient.reason) })
  }

  const line = /verdict\s*[:=]\s*["']?([a-z_\s-]+?)["']?\s*(?:[\n.;,]|$)/i.exec(cleaned)
  const verdict = line ? normalizeVerdict(line[1]) : undefined
  if (!verdict) return undefined
  const reason = /reason\s*[:=]\s*(.+)/i.exec(cleaned)?.[1]
  return applyForwardPointerGate({ verdict, reason: clampReason(reason) })
}

/** JSON-string layers (a verdict double-encoded by the model) plus balanced object spans and the raw layer. */
function verdictCandidates(cleaned: string): string[] {
  const candidates: string[] = []
  let layer = cleaned
  for (let depth = 0; depth < MAX_JSON_UNWRAP; depth++) {
    candidates.push(...jsonObjects(layer), layer)
    const unwrapped = safeJson(layer)
    if (typeof unwrapped !== "string") break
    layer = unwrapped.trim()
  }
  return candidates
}

/**
 * True when `index` (the start of a quoted key) sits outside any string value in the first object span of
 * `text` — i.e. it is a real object key, not text a model quoted inside a reason. Escaped quotes do not toggle
 * string state. A missing or later brace means there is no enclosing object at that position.
 */
function isObjectKeyPosition(text: string, index: number): boolean {
  const brace = text.indexOf("{")
  if (brace === -1 || brace > index) return false
  let inString = false
  let escaped = false
  for (let i = brace; i < index; i++) {
    const char = text[i]
    if (escaped) escaped = false
    else if (char === "\\") escaped = true
    else if (char === '"') inString = !inString
  }
  return !inString
}

/**
 * Reads `verdict`/`reason` fields from a JSON-ish object that strict JSON rejected. The verdict regex is
 * anchored to a quoted key after an object brace; the reason regex spans raw newlines and stops at the next
 * field (or end of text, which covers an object truncated mid-reason). No verdict token means no verdict.
 */
function lenientFields(text: string): { verdict: Verdict; reason: string } | undefined {
  for (const fieldPattern of LENIENT_FIELD_PATTERNS) {
    // Scan *every* occurrence, not just the first: a malformed reason can quote `"verdict":"met"` before
    // the real field. The first occurrence fails the object-key guard below; the real one must still be seen.
    fieldPattern.lastIndex = 0 // shared `g` regex: reset state left by an earlier early return/call
    for (let field = fieldPattern.exec(text); field; field = fieldPattern.exec(text)) {
      // The quoted key must sit at an object key position, not inside a string value. A model can quote
      // `"verdict":"met"` in its reason (discussing another evaluation); without this guard the lenient pass
      // manufactures a met out of a reason with no verdict field at all.
      if (!isObjectKeyPosition(text, field.index)) continue
      const verdict = normalizeVerdict(field[1])
      if (!verdict) return undefined
      let reason = ""
      for (const reasonPattern of LENIENT_REASON_PATTERNS) {
        const match = reasonPattern.exec(text)
        if (match?.[1] !== undefined) {
          reason = unescapeJsonText(match[1])
          break
        }
      }
      return { verdict, reason }
    }
  }
  return undefined
}

/** Decode the escapes a model did use, leaving raw newlines and stray quotes as they appeared. */
function unescapeJsonText(value: string): string {
  return value.replace(/\\(n|r|t|"|\\)/g, (_match, code: string) => ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" })[code] ?? code)
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

/**
 * Yields balanced top-level `{...}` spans, string-aware, in order of appearance. One left-to-right pass:
 * a `{` inside a string value is not a candidate object. Restarting the scan at every `{` used to promote
 * a quoted `{"verdict":"met"}` inside a malformed reason into a strict candidate, overriding the real verdict.
 */
function* jsonObjects(text: string): Generator<string> {
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") {
      if (depth === 0) start = i
      depth++
    } else if (char === "}" && depth > 0) {
      depth--
      if (depth === 0 && start !== -1) {
        yield text.slice(start, i + 1)
        start = -1
      }
    }
  }
}
