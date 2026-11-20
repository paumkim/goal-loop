import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isWindowsDrivePathOnPosix } from "./wire.ts"
import type { Verdict, VerdictEntry, VerdictVerificationMatrix, VerifyCheckEvidence } from "./types.ts"

/**
 * Repeated failure-signature detection for goal/loop evaluations.
 *
 * "Same failure signature" means the same failing gate/check pattern, or the same normalized
 * not_met reason/gap when no structured verification failure dominates. A recurring pattern
 * (consecutive same-signature not_met verdicts at/above the threshold) must escalate instead of
 * re-arming the same approach.
 */

export const FAILURE_SIGNATURE_REPEAT_THRESHOLD = 3

interface FailureSignatureInfo {
  readonly verdict: Verdict
  readonly reason: string
  readonly verification?: VerdictVerificationMatrix
  readonly verify?: VerdictEntry["verify"]
}

interface RepeatedFailureSignature {
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

interface FailingCheckDiagnostic {
  readonly id?: string
  readonly type?: string
  readonly label?: string
  readonly command?: string
  readonly code?: number | null
  readonly timedOut?: boolean
  readonly tail?: string
  readonly pass?: boolean
  readonly required?: boolean
  readonly scoped?: boolean
  readonly source?: string
  readonly evidenceMode?: string
  readonly runState?: string
  readonly missing?: boolean
  readonly unscoped?: boolean
}

interface RepeatedFailureDiagnosticArtifact {
  readonly signature: string
  readonly count: number
  readonly reason: string
  readonly failingChecks: readonly FailingCheckDiagnostic[]
  readonly kind: "verification" | "reason"
  readonly summary: string
  readonly verdictReason: string
  readonly at: string
  readonly turn?: number
  readonly sessionID?: string
  readonly goalID?: string
  readonly condition?: string
  readonly directory?: string
  readonly verificationMissing?: readonly string[]
  readonly verificationCoverageReasons?: readonly string[]
}

function isFailingMatrixCheck(check: VerifyCheckEvidence, v: VerdictVerificationMatrix): boolean {
  if (!check.pass) return true
  if (v.missing.includes(check.id)) return true
  if (v.missing.includes(check.type)) return true
  return !!check.required && !check.scoped
}

export function failingChecksOf(info: FailureSignatureInfo): FailingCheckDiagnostic[] {
  if (info.verification) {
    const v = info.verification
    const failed = v.checks.filter((c) => isFailingMatrixCheck(c, v))
    const relevant = failed.length ? failed : (!v.pass || v.missing.length ? v.checks.filter((c) => c.required || !c.pass) : [])
    return relevant.map((c) => ({
      id: c.id,
      type: c.type,
      ...(c.label ? { label: c.label } : {}),
      command: c.command,
      ...(c.code !== undefined ? { code: c.code } : {}),
      ...(c.timedOut ? { timedOut: true } : {}),
      ...(c.tail ? { tail: c.tail } : {}),
      pass: c.pass,
      required: c.required,
      scoped: c.scoped,
      source: c.source,
      evidenceMode: c.evidenceMode,
      runState: c.runState,
      ...(v.missing.includes(c.id) || v.missing.includes(c.type) ? { missing: true } : {}),
      ...(c.required && !c.scoped ? { unscoped: true } : {}),
    }))
  }
  if (info.verify && info.verify.code !== 0) {
    return [{
      id: "verify-command",
      type: "legacy",
      command: info.verify.command,
      code: info.verify.code,
      ...(info.verify.timedOut ? { timedOut: true } : {}),
      ...(info.verify.tail ? { tail: info.verify.tail } : {}),
      pass: false,
      required: true,
      scoped: true,
      source: "legacy",
      evidenceMode: "command",
      runState: "executed",
    }]
  }
  return []
}

export function buildRepeatedFailureDiagnosticArtifact(input: {
  detected: RepeatedFailureSignature
  escalationReason: string
  info: FailureSignatureInfo
  atMs?: number
  turn?: number
  sessionID?: string
  goalID?: string
  condition?: string
  directory?: string
}): RepeatedFailureDiagnosticArtifact {
  const at = new Date(input.atMs ?? Date.now()).toISOString()
  return {
    signature: input.detected.signature,
    count: input.detected.count,
    reason: input.escalationReason,
    failingChecks: failingChecksOf(input.info),
    kind: input.detected.kind,
    summary: input.detected.summary,
    verdictReason: input.info.reason ?? "",
    at,
    ...(typeof input.turn === "number" ? { turn: input.turn } : {}),
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    ...(input.goalID ? { goalID: input.goalID } : {}),
    ...(input.condition ? { condition: input.condition } : {}),
    ...(input.directory ? { directory: input.directory } : {}),
    ...(input.info.verification?.missing?.length ? { verificationMissing: [...input.info.verification.missing] } : {}),
    ...(input.info.verification?.coverageReasons?.length ? { verificationCoverageReasons: [...input.info.verification.coverageReasons] } : {}),
  }
}

function safeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x"
}

const ensuredDiagnosticsDirs = new Set<string>()

function writeFailureDiagnosticArtifact(dir: string, artifact: RepeatedFailureDiagnosticArtifact): string {
  const diagnosticsDir = join(dir, ".term", "goal-loop", "diagnostics")
  const stamp = artifact.at.replace(/[:.]/g, "-")
  const session = safeToken(artifact.sessionID ?? "session")
  const turn = typeof artifact.turn === "number" ? `-t${artifact.turn}` : ""
  const name = `${stamp}-${session}${turn}-repeated-failure.json`
  const file = join(diagnosticsDir, name)
  const body = JSON.stringify(artifact, null, 2) + "\n"
  try {
    if (!ensuredDiagnosticsDirs.has(diagnosticsDir)) {
      mkdirSync(diagnosticsDir, { recursive: true })
      ensuredDiagnosticsDirs.add(diagnosticsDir)
    }
    writeFileSync(file, body, "utf8")
  } catch (error) {
    if (ensuredDiagnosticsDirs.has(diagnosticsDir) && (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      ensuredDiagnosticsDirs.delete(diagnosticsDir)
      mkdirSync(diagnosticsDir, { recursive: true })
      ensuredDiagnosticsDirs.add(diagnosticsDir)
      writeFileSync(file, body, "utf8")
    } else {
      throw error
    }
  }
  return file
}

export function persistFailureDiagnosticArtifact(input: {
  directory: string
  detected: RepeatedFailureSignature
  escalationReason: string
  info: FailureSignatureInfo
  atMs?: number
  turn?: number
  sessionID?: string
  goalID?: string
  condition?: string
}): string | undefined {
  // Avoid creating literal "C:" directories on POSIX when tests pass Windows-style fixture paths.
  if (isWindowsDrivePathOnPosix(input.directory)) return undefined
  try {
    const artifact = buildRepeatedFailureDiagnosticArtifact({ ...input, directory: input.directory })
    return writeFailureDiagnosticArtifact(input.directory, artifact)
  } catch {
    return undefined
  }
}
