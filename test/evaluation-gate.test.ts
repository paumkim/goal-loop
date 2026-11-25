/**
 * The pre-verdict abstention gate. A bare evaluation request (no <condition>, no fresh evidence, or live sessions)
 * must defer instead of emitting a verdict. The empty-request trigger is harness-owned: the repo cannot arm an
 * empty condition; the host assembles the judge's model request. These tests pin the exact predicate and its
 * precedence so a genuine met/not_met request is never mistaken for an abstention.
 */
import { describe, expect, test } from "bun:test"
import { ABSTENTION_REASON, evaluationAbstention } from "../src/core/evaluation-gate.ts"

const complete = { condition: "all tests pass", hasFreshEvidence: true, activeSessions: false }

describe("evaluationAbstention", () => {
  test("a complete finished-turn request is judged (no abstention)", () => {
    expect(evaluationAbstention(complete)).toBeUndefined()
  })

  test("no <condition> text abstains", () => {
    for (const condition of ["", "   ", "\n\t"]) {
      expect(evaluationAbstention({ ...complete, condition })).toBe("empty-condition")
    }
  })

  test("a request with no condition field at all abstains instead of throwing", () => {
    // A harness-injected bare request can omit the field entirely; the gate must defer, not crash the evaluator
    // (a TypeError here would fail closed and pause the goal rather than abstain).
    expect(evaluationAbstention({ hasFreshEvidence: true, activeSessions: false })).toBe("empty-condition")
    expect(evaluationAbstention({ hasFreshEvidence: false, activeSessions: true })).toBe("empty-condition")
  })

  test("no fresh evidence abstains", () => {
    expect(evaluationAbstention({ ...complete, hasFreshEvidence: false })).toBe("no-fresh-evidence")
  })

  test("active sessions abstain", () => {
    expect(evaluationAbstention({ ...complete, activeSessions: true })).toBe("active-sessions")
  })

  test("precedence: empty condition wins over missing evidence and active sessions", () => {
    expect(evaluationAbstention({ condition: "", hasFreshEvidence: false, activeSessions: true })).toBe("empty-condition")
    expect(evaluationAbstention({ ...complete, hasFreshEvidence: false, activeSessions: true })).toBe("no-fresh-evidence")
  })

  test("an omitted evidence signal (controller's early guard) does not abstain by itself", () => {
    expect(evaluationAbstention({ condition: "all tests pass", activeSessions: false })).toBeUndefined()
    expect(evaluationAbstention({ condition: "", activeSessions: false })).toBe("empty-condition")
  })

  test("every abstention has one operator-facing reason", () => {
    for (const reason of ["empty-condition", "no-fresh-evidence", "active-sessions"] as const) {
      expect(ABSTENTION_REASON[reason]).toContain("evaluation deferred")
    }
  })
})
