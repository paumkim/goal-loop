import { describe, expect, test } from "bun:test"
import {
  checkin,
  commitStatusSuffix,
  coordinatorFlow,
  DELEGATE_VERDICT,
  evaluateIndependently,
  evaluateInSession,
  nextGoalInSession,
  retry,
  systemReminder,
} from "../src/core/prompts.ts"
import type { CommitPolicy } from "../src/core/types.ts"

const direct: CommitPolicy = { required: true, branch: "dev", mode: "direct", reason: "test" }
const coordinator: CommitPolicy = { required: true, branch: "dev", mode: "coordinator", reason: "test" }
const off: CommitPolicy = { required: false, branch: "dev", mode: "direct", reason: "not a git repository" }

/**
 * Pins the exact bytes of every prompt builder that carries the commit rule, before and after the
 * `commitRuleSentence` extraction. If a prompt intentionally changes, update the expectations — do not weaken.
 */
describe("commit rule sentences (byte-identical)", () => {
  test("commitStatusSuffix", () => {
    expect(commitStatusSuffix(off)).toBe("")
    expect(commitStatusSuffix(direct)).toBe("commit the finished work to the `dev` branch and show the commit output: the commit hash and the branch it landed on")
    expect(commitStatusSuffix(coordinator)).toBe(
      "Commit on your wt/<slug> branch, submit, land with `coordinator merge-next --wait --target <slug>`, and confirm the lease is done before the goal counts as done.",
    )
  })

  test("retry", () => {
    expect(retry({ condition: "c", label: "credit balance exhausted" }, direct)).toBe([
      "<goal-retry>",
      "The previous turn failed (credit balance exhausted). The goal is still active; continue from where you left off.",
      "Goal: c",
      "Commit the finished work to the `dev` branch before the goal counts as done.",
      "</goal-retry>",
      DELEGATE_VERDICT,
    ].join("\n"))
    expect(retry({ condition: "c", label: "credit balance exhausted" }, coordinator)).toContain(
      "Commit on your wt/<slug> branch, submit, land with `coordinator merge-next --wait --target <slug>`, and confirm the lease is done before the goal counts as done.",
    )
  })

  test("checkin", () => {
    expect(checkin({ condition: "c", waitedMs: 60_000, subagents: 1, shells: 0 }, direct)).toContain(
      "Commit the finished work to the `dev` branch before the goal counts as done, and show the commit output.",
    )
    expect(checkin({ condition: "c", waitedMs: 60_000, subagents: 0, shells: 2 }, coordinator)).toContain(
      "Commit on your wt/<slug> branch, submit, land with `coordinator merge-next --wait --target <slug>`, and confirm the lease is done before the goal counts as done.",
    )
  })

  test("systemReminder", () => {
    expect(systemReminder("c", direct)).toBe([
      "An active /goal is set for this session: c",
      "Only command output and test results visible in this conversation count as evidence.",
      "Finished work has to be committed to the `dev` branch before the goal counts as met.",
      DELEGATE_VERDICT,
    ].join("\n"))
    expect(systemReminder("c", coordinator)).toContain(
      "Finished work has to be committed on your wt/<slug> branch, submitted, and landed into `dev` by merge-next with the lease done before the goal counts as met.",
    )
  })

  test("evaluator facts (via evaluateInSession / evaluateIndependently)", () => {
    const factsLine = "- This session runs inside a git repository. Finished work has to be committed to the `dev` branch before the goal counts as met."
    const factsCoordinator =
      "- This session runs inside a git repository managed by the coordinator. Finished work has to be committed on the agent's own `wt/<slug>` branch, submitted, and merged into `dev` by `coordinator merge-next` with the lease done (submitted alone is not completion) before the goal counts as met."
    const input = { turn: 2, elapsedMs: 90_000 }
    expect(evaluateInSession("c", input, direct)).toContain(factsLine)
    expect(evaluateIndependently("c", input, "digest", direct)).toContain(factsLine)
    expect(evaluateInSession("c", input, coordinator)).toContain(factsCoordinator)
    expect(evaluateIndependently("c", input, "digest", coordinator)).toContain(factsCoordinator)
  })

  test("the coordinator judge rubric enforces claim-before-edit, not just commit-on-wt", () => {
    const input = { turn: 2, elapsedMs: 90_000 }
    for (const text of [evaluateInSession("c", input, coordinator), evaluateIndependently("c", input, "digest", coordinator)]) {
      expect(text).toContain("Lease-first rule (coordinator)")
      expect(text).toContain("coordinator claim <slug> --agent <you> --paths <scope>")
      expect(text).toContain("BEFORE the first edit")
      expect(text).toContain("must be redone inside a claimed worktree")
      expect(text).toContain("Only the `coordinator` agent is exempt")
    }
    // A direct-git repo has no lease workflow, so it never receives the rule.
    expect(evaluateInSession("c", input, direct)).not.toContain("Lease-first rule")
  })

  test("the coordinator judge rubric requires landing evidence, not a bare submit", () => {
    const input = { turn: 2, elapsedMs: 90_000 }
    for (const text of [evaluateInSession("c", input, coordinator), evaluateIndependently("c", input, "digest", coordinator)]) {
      expect(text).toContain("Landing rule (coordinator)")
      expect(text).toContain("merge-ready, not done")
      expect(text).toContain("coordinator status --json")
      expect(text).toContain("worktree/wt-<slug>")
      expect(text).toContain('the verdict is "not_met"')
      expect(text).toContain("a bare submit output is only merge-ready")
    }
    expect(evaluateInSession("c", input, direct)).not.toContain("Landing rule (coordinator)")
    // The bounded completion condition used by the loop planner agrees with the judge rubric.
    const planner = nextGoalInSession({ objective: "o", history: [], latestSummary: "s" })
    expect(planner).toContain("submitted-but-unmerged lease is not completion")
    expect(planner).toContain("done at HEAD with its worktree removed")
  })

  test("coordinator flow tells the agent to drain the merge queue and verify done", () => {
    const flow = coordinatorFlow({ ...coordinator, coordinatorBin: "/usr/local/bin/coordinator" })
    expect(flow).toContain("Landing is part of the task")
    expect(flow).toContain("coordinator merge-status")
    expect(flow).toContain("coordinator merge-next --wait --target <slug>")
    expect(flow).toContain("rebase `wt/<slug>` onto `dev`")
    expect(flow).toContain("coordinator status --json")
    expect(flow).toContain("`worktree/wt-<slug>` is gone")
    expect(flow).toContain("only merge-ready, not done")
  })
})
