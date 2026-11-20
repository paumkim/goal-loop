import type { Verdict, VerdictEntry, VerdictVerificationMatrix } from "./types.ts"

/**
 * Repeated failure-signature detection for goal/loop evaluations.
 *
 * "Same failure signature" means the same failing gate/check pattern, or the same normalized
 * not_met reason/gap when no structured verification failure dominates. A recurring pattern
 * (consecutive same-signature not_met verdicts at/above the threshold) must escalate instead of
 * re-arming the same approach.
 */

export const FAILURE_SIGNATURE_REPEAT_THRESHOLD = 3

export interface FailureSignatureInfo {
  readonly verdict: Verdict
  readonly reason: string
  readonly verification?: VerdictVerificationMatrix
  readonly verify?: VerdictEntry["verify"]
}

export interface RepeatedFailureSignature {
  readonly signature: string
  readonly count: number
  readonly kind: "verification" | "reason"
  readonly summary: string
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

function verificationSignature(v: VerdictVerificationMatrix): string | undefined {
  const failed = v.checks.filter((c) => {
    if (!c.pass) return true
    if (v.missing.includes(c.id)) return true
    if (v.missing.includes(c.type)) return true
    return c.required && !c.scoped
  })
  const relevant = failed.length ? failed : (!v.pass || v.missing.length ? v.checks.filter((c) => c.required) : [])
  if (!relevant.length && v.pass && !v.missing.length && !(v.coverageReasons?.length)) return undefined
  const checks = relevant
    .map((c) => `${c.id}|${c.type}|${c.code ?? "n"}|${c.timedOut ? "t" : "f"}|${c.required ? "r" : "o"}|${c.scoped ? "s" : "u"}|${c.pass ? "p" : "x"}`)
    .sort()
    .join(",")
  const missing = [...v.missing].map(normalize).sort().join(",")
  const coverage = (v.coverageReasons ?? []).map(normalize).sort().join("|")
  return `verify:${checks}#missing:${missing}#coverage:${clamp(coverage, 240)}`
}

function legacyVerifySignature(verify: NonNullable<VerdictEntry["verify"]>): string {
  return `legacy:${normalize(verify.command)}:${verify.code ?? "n"}:${verify.timedOut ? "t" : "f"}`
}

export function failureSignatureOf(info: FailureSignatureInfo): { key: string; kind: "verification" | "reason" } | undefined {
  if (info.verdict !== "not_met") return undefined
  if (info.verification && (!info.verification.pass || info.verification.missing.length > 0)) {
    const key = verificationSignature(info.verification)
    if (key) return { key, kind: "verification" }
  }
  if (info.verify && info.verify.code !== 0) {
    return { key: legacyVerifySignature(info.verify), kind: "verification" }
  }
  const reason = normalize(info.reason)
  return { key: `reason:${clamp(reason || "empty", 500)}`, kind: "reason" }
}

export function detectRepeatedFailureSignature(
  history: readonly Pick<VerdictEntry, "verdict" | "reason" | "verification" | "verify">[],
  current: FailureSignatureInfo & { verdict: "not_met" },
  threshold = FAILURE_SIGNATURE_REPEAT_THRESHOLD,
): RepeatedFailureSignature | undefined {
  if (threshold <= 1) return undefined
  const sig = failureSignatureOf(current)
  if (!sig) return undefined
  let count = 1
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]!
    if (entry.verdict !== "not_met") break
    const prev = failureSignatureOf(entry)
    if (!prev || prev.key !== sig.key) break
    count++
  }
  if (count < threshold) return undefined
  const summary = summarizeFailureSignature(current, sig.kind)
  return { signature: sig.key, count, kind: sig.kind, summary }
}

export function summarizeFailureSignature(info: FailureSignatureInfo, kind: "verification" | "reason"): string {
  if (kind === "verification") {
    if (info.verification) {
      const failed = info.verification.checks
        .filter((c) => !c.pass || info.verification!.missing.includes(c.id) || info.verification!.missing.includes(c.type))
        .map((c) => c.label || c.id || c.type)
      const parts = [...new Set(failed)].filter(Boolean)
      if (parts.length) return `repeated failing verification: ${parts.slice(0, 4).join(", ")}`
      if (info.verification.missing.length) return `repeated missing/unscoped verification: ${info.verification.missing.slice(0, 4).join(", ")}`
      return "repeated verification failure"
    }
    if (info.verify) return `repeated verification command failure (${info.verify.code ?? "no-exit"}${info.verify.timedOut ? ", timeout" : ""})`
  }
  const reason = normalize(info.reason)
  return reason ? `repeated not_met gap: ${clamp(reason, 160)}` : "repeated not_met with empty reason"
}

export function failureEscalationReason(detected: RepeatedFailureSignature): string {
  return [
    `Repeated failure signature detected (${detected.count} consecutive not_met evaluations, same ${detected.kind} pattern): ${detected.summary}.`,
    `Escalation required instead of re-arming the same approach: rotate strategy (narrow scope, change approach), produce a diagnostic artifact with concrete evidence of the blocker, or mark blocked with the blocking cause.`,
    `Do not repeat the same failing strategy. Send a message after changing strategy/evidence to resume, or /goal clear.`,
  ].join(" ")
}
