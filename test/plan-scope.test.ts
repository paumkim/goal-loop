/**
 * Regression guard for a fix-from-session-history: the evaluator/planner subagent-child rework kept the
 * planner's scope in a per-session map that was only written on success. A later /goal whose planner failed
 * (quota, timeout) inherited the previous goal's scope, so the judge read an unrelated rubric. The scope is
 * now paired with the condition it was distilled for and ignored for any other condition.
 */
import { describe, expect, test } from "bun:test"
import { planScopeFor } from "../src/index.ts"

describe("planner scope is bound to its own condition", () => {
  test("a scope from a different condition never leaks into the new verdict", () => {
    expect(planScopeFor({ condition: "fix the parser", scope: "code" }, "say hello")).toBeUndefined()
  })

  test("a matching condition keeps its distilled scope", () => {
    expect(planScopeFor({ condition: "fix the parser", scope: "code" }, "fix the parser")).toBe("code")
    expect(planScopeFor({ condition: "say hello", scope: "trivial" }, "say hello")).toBe("trivial")
  })

  test("a goal armed without a fresh plan has no scope", () => {
    expect(planScopeFor(undefined, "say hello")).toBeUndefined()
  })
})
