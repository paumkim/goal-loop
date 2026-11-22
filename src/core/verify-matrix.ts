import { formatValue } from "./errors.ts"
import { headSha, findRepository } from "./git.ts"
import { isBroadGoalCondition } from "./prompts.ts"
import type { VerifyCheckConfig, VerifyCheckType } from "./config.ts"

export type VerifyEvidenceMode = "command" | "artifact" | "either"
export type VerifyCheckSource = "configured" | "legacy" | "goal-declared"

interface ParsedGoalDeclaredCheck extends VerifyCheckConfig {
  readonly source: "goal-declared"
  readonly evidence: VerifyEvidenceMode
  readonly artifactPatterns?: readonly string[]
  readonly malformed?: false
}

interface MalformedGoalDeclaredCheck {
  readonly malformed: true
  readonly raw: string
  readonly reason: string
  readonly index: number
}

interface GoalDeclaredParseResult {
  readonly checks: ParsedGoalDeclaredCheck[]
  readonly malformed: MalformedGoalDeclaredCheck[]
}

interface ResolvedVerifyCheck extends VerifyCheckConfig {
  readonly source: VerifyCheckSource
  readonly evidence: VerifyEvidenceMode
  readonly artifactPatterns: readonly string[]
  readonly required: boolean
  readonly when: "always" | "broad"
}

interface ScopePolicy {
  readonly profile: string
  readonly broadGoal: boolean
  readonly requiredTypes: readonly VerifyCheckType[]
  readonly reason: string
}

const TYPES = new Set<VerifyCheckType>(["typecheck", "tests", "lint", "build", "smoke", "custom", "goal-declared"])
const WHENS = new Set(["always", "broad"])
const EVIDENCES = new Set<VerifyEvidenceMode>(["command", "artifact", "either"])

/**
 * Safe, explicit goal-declared check syntax (inline directives in goal condition):
 *   verify: type=<typecheck|tests|lint|build|smoke|goal-declared> cmd="<command>" [id=<id>] [when=always|broad] [evidence=command|artifact|either] [label="..."] [artifacts="p1||p2"]
 * - cmd is required and must be a double-quoted string (supports \" and \\ escapes). Never executed unless selected by verifier under existing constraints.
 * - artifacts are required literal patterns for evidence=artifact|either (||-separated inside one quoted value, or repeated artifact/artifacts keys).
 * - Malformed declarations are ignored and reported; they never execute.
 */
export function parseGoalDeclaredChecks(condition: string): GoalDeclaredParseResult {
  const checks: ParsedGoalDeclaredCheck[] = []
  const malformed: MalformedGoalDeclaredCheck[] = []
  const lines = condition.replace(/\r\n?/g, "\n").split("\n")
  let index = 0
  for (const line of lines) {
    const trimmed = line.trim()
    // support inline/fenced-ish lines beginning with verify:
    const m = /^`?verify\s*:\s*(.+)`?$/.exec(trimmed)
    if (!m) continue
    index++
    const body = m[1] ?? ""
    try {
      const parsed = parseDirectiveBody(body, index)
      checks.push(parsed)
    } catch (error) {
      malformed.push({ malformed: true, raw: trimmed, reason: error instanceof Error ? error.message : String(error), index })
    }
  }
  // also support multiple directives on same line separated? unlikely, but scan all "verify:" occurrences not at line start inside text
  // (kept simple/deterministic: line-oriented above)
  return { checks, malformed }
}

/** The one "missing required key" error shape. `formatValue` keeps key quoting consistent with every other verify-matrix error. */
const missingRequired = (key: string): Error => new Error(`missing required ${formatValue(key)}`)

function parseDirectiveBody(body: string, index: number): ParsedGoalDeclaredCheck {
  const tokens = tokenize(body)
  const map = new Map<string, Array<{ value: string; quoted: boolean }>>()
  for (const t of tokens) {
    const arr = map.get(t.key) ?? []
    arr.push({ value: t.value, quoted: t.quoted })
    map.set(t.key, arr)
  }
  const one = (key: string, required = false): { value: string; quoted: boolean } | undefined => {
    const vals = map.get(key)
    if (!vals || vals.length === 0) {
      if (required) throw missingRequired(key)
      return undefined
    }
    return vals[vals.length - 1]
  }
  const typeRaw = one("type", true)!.value
  if (!TYPES.has(typeRaw as VerifyCheckType)) throw new Error(`invalid type ${formatValue(typeRaw)}`)
  const type = typeRaw as VerifyCheckType
  const cmdTok = one("cmd") ?? one("command")
  if (!cmdTok) throw missingRequired("cmd")
  if (!cmdTok.quoted) throw new Error('cmd must be a quoted string (cmd="...")')
  const cmd = cmdTok.value
  if (!cmd.trim()) throw new Error("cmd must be a non-empty quoted command")
  const whenRaw = one("when")?.value ?? "always"
  if (!WHENS.has(whenRaw)) throw new Error(`invalid when ${formatValue(whenRaw)}`)
  const when = whenRaw as "always" | "broad"
  const evidenceRaw = (one("evidence")?.value ?? "command") as VerifyEvidenceMode
  if (!EVIDENCES.has(evidenceRaw)) throw new Error(`invalid evidence ${formatValue(evidenceRaw)}`)
  const id = (one("id")?.value ?? `goal-declared-${type}-${index}`).trim()
  if (!id) throw new Error("id must be non-empty")
  const labelTok = one("label")
  if (labelTok && !labelTok.quoted) throw new Error('label must be a quoted string (label="...")')
  const label = labelTok?.value
  const requiredRaw = one("required")?.value
  const required = requiredRaw === undefined ? true : requiredRaw === "true" ? true : requiredRaw === "false" ? false : (() => { throw new Error(`invalid required ${formatValue(requiredRaw)}`) })()
  const timeoutRaw = one("timeoutMs")?.value ?? one("timeout")?.value
  let timeoutMs: number | undefined
  if (timeoutRaw !== undefined) {
    const n = Number(timeoutRaw)
    if (!Number.isFinite(n) || n < 1) throw new Error(`invalid timeoutMs ${formatValue(timeoutRaw)}`)
    timeoutMs = Math.floor(n)
  }
  const artifactToks = [...(map.get("artifacts") ?? []), ...(map.get("artifact") ?? [])]
  for (const t of artifactToks) if (!t.quoted) throw new Error('artifact/artifacts values must be quoted strings')
  const artifactPatterns = artifactToks.flatMap((t) => t.value.split("||")).map((x) => x.trim()).filter(Boolean)
  if ((evidenceRaw === "artifact" || evidenceRaw === "either") && artifactPatterns.length === 0) {
    throw new Error(`evidence=${formatValue(evidenceRaw)} requires at least one artifact pattern (artifacts="..." or artifact="...")`)
  }
  return {
    id,
    type,
    command: cmd,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    required,
    when,
    ...(label ? { label } : {}),
    source: "goal-declared",
    evidence: evidenceRaw,
    ...(artifactPatterns.length ? { artifactPatterns } : {}),
    malformed: false,
  }
}

function tokenize(body: string): Array<{ key: string; value: string; quoted: boolean }> {
  const out: Array<{ key: string; value: string; quoted: boolean }> = []
  let i = 0
  const s = body.trim()
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++
    if (i >= s.length) break
    let key = ""
    while (i < s.length && /[A-Za-z0-9_.-]/.test(s[i]!)) key += s[i++]
    if (!key) throw new Error(`unexpected token near ${formatValue(s.slice(i, i + 20))}`)
    while (i < s.length && /\s/.test(s[i]!)) i++
    if (s[i] !== "=") throw new Error(`expected '=' after ${formatValue(key)}`)
    i++
    while (i < s.length && /\s/.test(s[i]!)) i++
    let value = ""
    let quoted = false
    if (s[i] === '"') {
      quoted = true
      i++
      let closed = false
      while (i < s.length) {
        const c = s[i++]!
        if (c === "\\") {
          if (i >= s.length) throw new Error("unterminated escape")
          const n = s[i++]!
          value += n === "n" ? "\n" : n === "t" ? "\t" : n
        } else if (c === '"') {
          closed = true
          break
        } else {
          value += c
        }
      }
      if (!closed) throw new Error(`unterminated quoted value for ${formatValue(key)}`)
    } else {
      while (i < s.length && !/\s/.test(s[i]!)) value += s[i++]
      if (!value) throw new Error(`missing value for ${formatValue(key)}`)
    }
    out.push({ key, value, quoted })
  }
  return out
}

export function resolveVerifyChecks(opts: {
  configured: readonly VerifyCheckConfig[]
  condition: string
}): { checks: ResolvedVerifyCheck[]; malformed: MalformedGoalDeclaredCheck[] } {
  const parsed = parseGoalDeclaredChecks(opts.condition)
  const out: ResolvedVerifyCheck[] = []
  const seen = new Set<string>()
  const push = (check: VerifyCheckConfig & { source: VerifyCheckSource; evidence?: VerifyEvidenceMode; artifactPatterns?: readonly string[] }) => {
    const id = check.id
    if (seen.has(id)) return // deterministic: first wins (configured/legacy before goal-declared duplicates?) keep configured precedence
    seen.add(id)
    out.push({
      id,
      type: check.type,
      command: check.command,
      ...(check.timeoutMs !== undefined ? { timeoutMs: check.timeoutMs } : {}),
      required: check.required !== false,
      when: check.when ?? "always",
      ...(check.label ? { label: check.label } : {}),
      source: check.source,
      evidence: check.evidence ?? "command",
      artifactPatterns: check.artifactPatterns ?? [],
    })
  }
  for (const c of opts.configured) {
    push({ ...c, source: c.id === "verify-command" && c.label === "verifyCommand" ? "legacy" : "configured" })
  }
  for (const c of parsed.checks) push(c)
  return { checks: out, malformed: parsed.malformed }
}

export function computeScopePolicy(opts: {
  condition: string
  profile: string
  checks: readonly ResolvedVerifyCheck[]
}): ScopePolicy {
  const broadGoal = opts.profile === "broad" || isBroadGoalCondition(opts.condition)
  const effectiveProfile = opts.profile || (broadGoal ? "broad" : "default")
  const requiredNow = opts.checks.filter((c) => c.required && (c.when === "broad" ? broadGoal : true))
  const requiredTypes = [...new Set(requiredNow.map((c) => c.type))]
  const reason = broadGoal
    ? "broad goal/profile: required checks must provide fresh scoped executed or allowed artifact evidence for each required type in scope; generic-only/unscoped coverage is insufficient"
    : "scoped goal: required applicable checks must provide fresh scoped evidence per policy"
  return { profile: effectiveProfile, broadGoal, requiredTypes, reason }
}

/** Deterministic coverage decision independent of evaluator rubric text. */
export function evaluateCoveragePolicy(opts: {
  condition: string
  profile: string
  checks: readonly ResolvedVerifyCheck[]
}, policy: ScopePolicy = computeScopePolicy(opts)): { policy: ScopePolicy; ok: boolean; missing: string[]; unscoped: string[]; reasons: string[] } {
  const reasons: string[] = []
  const missing: string[] = []
  const unscoped: string[] = []
  if (policy.broadGoal) {
    const requiredNow = opts.checks.filter((c) => c.required && (c.when === "broad" ? policy.broadGoal : true))
    if (requiredNow.length === 0) {
      reasons.push("broad goal has no required verification checks in scope")
    }
    const hasTypedScoped = requiredNow.some((c) => c.type !== "custom" || c.id !== "verify-command")
    if (requiredNow.length > 0 && !hasTypedScoped) {
      reasons.push("broad goal coverage is generic-only/unscoped (legacy verifyCommand alone is insufficient)")
      for (const c of requiredNow) unscoped.push(c.id)
    }
    // deterministic type coverage: for broad goals, required scoped coverage must include at least one non-generic typed check category
    // (typecheck/tests/lint/build/smoke/goal-declared) when checks exist; custom-only typed coverage is allowed only if explicitly goal-declared/typed.
    const typed = requiredNow.filter((c) => c.type === "typecheck" || c.type === "tests" || c.type === "lint" || c.type === "build" || c.type === "smoke" || c.type === "goal-declared")
    if (requiredNow.length > 0 && typed.length === 0 && hasTypedScoped) {
      reasons.push("broad goal requires scoped typed coverage (typecheck, targeted tests, lint/build as applicable, or goal-declared checks)")
    }
  }
  const ok = reasons.length === 0
  return { policy, ok, missing, unscoped, reasons }
}

export function currentHead(directory: string): string | undefined {
  try {
    const repo = findRepository(directory)
    return repo ? headSha(repo.gitDir) : undefined
  } catch {
    return undefined
  }
}

export function checkReuseKey(check: ResolvedVerifyCheck): string {
  // identical fresh result reuse key within same evaluated turn/HEAD (safe to share when command/semantics identical)
  return JSON.stringify({ type: check.type, command: check.command, evidence: check.evidence, artifacts: [...check.artifactPatterns].sort(), timeoutMs: check.timeoutMs ?? null, required: check.required, when: check.when })
}

export function artifactEvidenceSatisfied(text: string, patterns: readonly string[]): { ok: boolean; matched: string[]; missing: string[] } {
  const matched: string[] = []
  const missing: string[] = []
  for (const p of patterns) {
    if (p && text.includes(p)) matched.push(p)
    else missing.push(p)
  }
  return { ok: missing.length === 0 && matched.length > 0, matched, missing }
}
