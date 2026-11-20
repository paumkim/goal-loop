import { describe, expect, test } from "bun:test"
import {
  FAILURE_SIGNATURE_REPEAT_THRESHOLD,
  detectRepeatedFailureSignature,
  failureEscalationReason,
  failureSignatureOf,
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
