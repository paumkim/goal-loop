import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  FAILURE_SIGNATURE_REPEAT_THRESHOLD,
  buildRepeatedFailureDiagnosticArtifact,
  detectRepeatedFailureSignature,
  failingChecksOf,
  failureEscalationReason,
  failureSignatureOf,
  persistFailureDiagnosticArtifact,
  summarizeFailureSignature,
} from "../src/core/failure-signature.ts"

const notMet = (reason: string, extra: Record<string, unknown> = {}) => ({
  verdict: "not_met" as const,
  reason,
  ...extra,
})

describe("failureSignatureOf", () => {
  test("returns undefined for non-not_met verdicts", () => {
    expect(failureSignatureOf({ verdict: "met", reason: "ok" })).toBeUndefined()
    expect(failureSignatureOf({ verdict: "impossible", reason: "no" })).toBeUndefined()
  })

  test("uses normalized reason when no verification failure dominates", () => {
    const a = failureSignatureOf(notMet("Missing  test  output!!"))
    const b = failureSignatureOf(notMet("missing test output"))
    expect(a?.kind).toBe("reason")
    expect(a?.key).toBe(b?.key)
  })

  test("distinguishes different reason signatures", () => {
    const a = failureSignatureOf(notMet("missing typecheck evidence"))
    const b = failureSignatureOf(notMet("missing commit evidence"))
    expect(a?.key).not.toBe(b?.key)
  })

  test("uses verification matrix signature for failing checks", () => {
    const sig = failureSignatureOf(
      notMet("verification failed", {
        verification: {
          profile: "default",
          broadGoal: false,
          pass: false,
          checks: [
            { id: "typecheck", type: "typecheck", command: "bunx tsc --noEmit", required: true, scoped: true, pass: false, code: 1, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 10 },
          ],
          missing: ["typecheck"],
        },
      }),
    )
    expect(sig?.kind).toBe("verification")
    expect(sig?.key).toContain("verify:")
    expect(sig?.key).toContain("typecheck")
  })

  test("same verification failure yields same signature", () => {
    const make = () =>
      failureSignatureOf(
        notMet("gate failed", {
          verification: {
            profile: "default",
            broadGoal: false,
            pass: false,
            checks: [
              { id: "build", type: "build", command: "bun run build", required: true, scoped: true, pass: false, code: 2, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 10 },
            ],
            missing: ["build"],
          },
        }),
      )
    expect(make()?.key).toBe(make()?.key)
  })

  test("different failing verification checks yield different signatures", () => {
    const a = failureSignatureOf(
      notMet("failed", {
        verification: {
          profile: "default",
          broadGoal: false,
          pass: false,
          checks: [{ id: "build", type: "build", command: "bun run build", required: true, scoped: true, pass: false, code: 2, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 1 }],
          missing: ["build"],
        },
      }),
    )
    const b = failureSignatureOf(
      notMet("failed", {
        verification: {
          profile: "default",
          broadGoal: false,
          pass: false,
          checks: [{ id: "tests", type: "tests", command: "bun test", required: true, scoped: true, pass: false, code: 1, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 1 }],
          missing: ["tests"],
        },
      }),
    )
    expect(a?.key).not.toBe(b?.key)
  })

  test("legacy verify failure produces verification signature", () => {
    const sig = failureSignatureOf(notMet("verify failed", { verify: { command: "bun run check", code: 1 } }))
    expect(sig?.kind).toBe("verification")
    expect(sig?.key).toContain("legacy:")
  })
})

describe("detectRepeatedFailureSignature", () => {
  test("returns undefined below threshold", () => {
    const history = [notMet("same gap"), notMet("same gap")]
    const detected = detectRepeatedFailureSignature(history.slice(0, -1), history[1]!, 3)
    expect(detected).toBeUndefined()
  })

  test("detects threshold consecutive same reason signatures", () => {
    const history = [notMet("same gap"), notMet("same gap"), notMet("same gap")]
    const detected = detectRepeatedFailureSignature(history.slice(0, -1), history[2]!, 3)
    expect(detected).toBeDefined()
    expect(detected!.count).toBe(3)
    expect(detected!.kind).toBe("reason")
  })

  test("uses default threshold", () => {
    const entries = Array.from({ length: FAILURE_SIGNATURE_REPEAT_THRESHOLD }, () => notMet("unchanged missing evidence"))
    const detected = detectRepeatedFailureSignature(entries.slice(0, -1), entries.at(-1)!)
    expect(detected).toBeDefined()
    expect(detected!.count).toBe(FAILURE_SIGNATURE_REPEAT_THRESHOLD)
  })

  test("breaks on different signature", () => {
    const history = [notMet("gap A"), notMet("gap A"), notMet("gap B"), notMet("gap B"), notMet("gap B")]
    const detected = detectRepeatedFailureSignature(history.slice(0, -1), history[4]!, 3)
    expect(detected).toBeDefined()
    expect(detected!.count).toBe(3)
  })

  test("breaks on met verdict in history", () => {
    const history = [
      notMet("same gap"),
      { verdict: "met" as const, reason: "ok" },
      notMet("same gap"),
      notMet("same gap"),
    ]
    const detected = detectRepeatedFailureSignature(history.slice(0, -1), notMet("same gap"), 3)
    expect(detected).toBeUndefined()
  })

  test("detects repeated verification gate failures", () => {
    const mk = () =>
      notMet("verification failed", {
        verification: {
          profile: "default",
          broadGoal: false,
          pass: false,
          checks: [{ id: "tests", type: "tests", command: "bun test", required: true, scoped: true, pass: false, code: 1, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 5 }],
          missing: ["tests"],
        },
      })
    const history = [mk(), mk(), mk()]
    const detected = detectRepeatedFailureSignature(history.slice(0, -1), history[2]!, 3)
    expect(detected).toBeDefined()
    expect(detected!.kind).toBe("verification")
    expect(detected!.count).toBe(3)
  })
})

describe("failure escalation helpers", () => {
  test("summarizes verification failures", () => {
    const summary = summarizeFailureSignature(
      notMet("failed", {
        verification: {
          profile: "default",
          broadGoal: false,
          pass: false,
          checks: [{ id: "typecheck", type: "typecheck", label: "Typecheck", command: "bunx tsc --noEmit", required: true, scoped: true, pass: false, code: 1, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 1 }],
          missing: ["typecheck"],
        },
      }),
      "verification",
    )
    expect(summary.toLowerCase()).toContain("typecheck")
  })

  test("builds escalation reason with required guidance", () => {
    const reason = failureEscalationReason({ signature: "x", count: 3, kind: "reason", summary: "repeated not_met gap: missing tests" })
    expect(reason).toContain("Repeated failure signature detected")
    expect(reason).toContain("3 consecutive")
    expect(reason).toContain("rotate strategy")
    expect(reason).toContain("diagnostic artifact")
    expect(reason).toContain("instead of re-arming the same approach")
  })
})

describe("repeated failure diagnostic artifacts", () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  test("failingChecksOf extracts matrix failures and missing/unscoped checks", () => {
    const checks = failingChecksOf(
      notMet("verification failed", {
        verification: {
          profile: "broad",
          broadGoal: true,
          pass: false,
          checks: [
            { id: "typecheck", type: "typecheck", label: "Typecheck", command: "bunx tsc --noEmit", required: true, scoped: true, pass: false, code: 2, timedOut: false, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 10, tail: "TS2322" },
            { id: "tests", type: "tests", label: "Tests", command: "bun test", required: true, scoped: false, pass: true, code: 0, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 20 },
            { id: "lint", type: "lint", label: "Lint", command: "bun run lint", required: true, scoped: true, pass: true, code: 0, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 5 },
          ],
          missing: ["tests"],
          coverageReasons: ["broad goal requires scoped tests evidence"],
        },
      }),
    )
    expect(checks).toHaveLength(2)
    expect(checks.find((c) => c.id === "typecheck")).toMatchObject({ pass: false, code: 2, command: "bunx tsc --noEmit", tail: "TS2322" })
    expect(checks.find((c) => c.id === "tests")).toMatchObject({ missing: true, unscoped: true, pass: true })
  })

  test("failingChecksOf extracts legacy verify command failures", () => {
    const checks = failingChecksOf(notMet("verify failed", { verify: { command: "bun run check", code: 1, tail: "boom" } }))
    expect(checks).toEqual([{ id: "verify-command", type: "legacy", command: "bun run check", code: 1, tail: "boom", pass: false, required: true, scoped: true, source: "legacy", evidenceMode: "command", runState: "executed" }])
  })

  test("buildRepeatedFailureDiagnosticArtifact captures signature, count, reason, failing checks, and context", () => {
    const info = notMet("same gap", {
      verification: {
        profile: "default",
        broadGoal: false,
        pass: false,
        checks: [{ id: "tests", type: "tests", label: "Tests", command: "bun test", required: true, scoped: true, pass: false, code: 1, source: "configured", evidenceMode: "command", runState: "executed", durationMs: 3 }],
        missing: ["tests"],
      },
    })
    const detected = detectRepeatedFailureSignature([info, info], info, 3)!
    const artifact = buildRepeatedFailureDiagnosticArtifact({
      detected,
      escalationReason: failureEscalationReason(detected),
      info,
      atMs: 1_700_000_000_000,
      turn: 4,
      sessionID: "ses_1",
      goalID: "goal_1",
      condition: "fix tests",
      directory: "/tmp/project",
    })
    expect(artifact.signature).toBe(detected.signature)
    expect(artifact.count).toBe(3)
    expect(artifact.reason).toContain("rotate strategy")
    expect(artifact.failingChecks).toHaveLength(1)
    expect(artifact.failingChecks[0]).toMatchObject({ id: "tests", pass: false, code: 1 })
    expect(artifact.kind).toBe("verification")
    expect(artifact.summary.toLowerCase()).toContain("tests")
    expect(artifact.verdictReason).toBe("same gap")
    expect(artifact.at).toBe("2023-11-14T22:13:20.000Z")
    expect(artifact.turn).toBe(4)
    expect(artifact.sessionID).toBe("ses_1")
    expect(artifact.goalID).toBe("goal_1")
    expect(artifact.condition).toBe("fix tests")
    expect(artifact.verificationMissing).toEqual(["tests"])
  })

  test("persistFailureDiagnosticArtifact writes JSON under .term/goal-loop/diagnostics/", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-loop-diag-"))
    dirs.push(dir)
    const info = notMet("same missing evidence")
    const detected = detectRepeatedFailureSignature([info, info], info, 3)!
    const file = persistFailureDiagnosticArtifact({
      directory: dir,
      detected,
      escalationReason: failureEscalationReason(detected),
      info,
      atMs: 1_700_000_000_000,
      turn: 5,
      sessionID: "ses_diag",
      goalID: "goal_diag",
      condition: "fix it",
    })
    expect(file).toBeDefined()
    expect(file!).toContain(".term/goal-loop/diagnostics/")
    const files = await readdir(join(dir, ".term", "goal-loop", "diagnostics"))
    expect(files.length).toBe(1)
    expect(files[0]).toContain("ses_diag")
    expect(files[0]).toContain("-t5-")
    const saved = JSON.parse(await readFile(file!, "utf8"))
    expect(saved.signature).toBe(detected.signature)
    expect(saved.count).toBe(3)
    expect(saved.reason).toContain("diagnostic artifact")
    expect(Array.isArray(saved.failingChecks)).toBe(true)
    expect(saved.verdictReason).toBe("same missing evidence")
  })
})
