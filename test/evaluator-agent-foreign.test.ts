/**
 * Guards around a native evaluator report. `verdictFromNativeReport` must still reject a cached
 * verdict from a foreign rubric and must still accept a clean, authoritative one after the foreign
 * key patterns were precompiled instead of rebuilt per call.
 */
import { describe, expect, test } from "bun:test"
import { verdictFromNativeReport } from "../src/core/evaluator-agent.ts"

const candidate = (body: string) => ({ key: "ses_test", body, state: "completed" as const })

describe("native verdict foreign-rubric guard", () => {
  test("every foreign key still fails closed; a clean verdict still parses", () => {
    for (const key of ["rests_on", "target_files", "observed_evidence", "verified_this_turn"]) {
      const body = JSON.stringify({ status: "met", [key]: "x".repeat(200) })
      expect(() => verdictFromNativeReport(candidate(body))).toThrow(/different evaluation contract/)
    }
    const clean = JSON.stringify({ verdict: "met", reason: "ok", restsOnCaseOnly: "not a foreign key" })
    expect(verdictFromNativeReport(candidate(clean))).toEqual({ verdict: "met", reason: "ok" })
  })
})
