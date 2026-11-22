import { describe, expect, test } from "bun:test"
import {
  checkin,
  commitStatusSuffix,
  DELEGATE_VERDICT,
  evaluateIndependently,
  evaluateInSession,
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
    expect(commitStatusSuffix(coordinator)).toBe("Commit on your wt/<slug> branch and submit before the goal counts as done.")
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
      "Commit on your wt/<slug> branch and submit before the goal counts as done.",
    )
  })

  test("checkin", () => {
    expect(checkin({ condition: "c", waitedMs: 60_000, subagents: 1, shells: 0 }, direct)).toContain(
      "Commit the finished work to the `dev` branch before the goal counts as done, and show the commit output.",
    )
    expect(checkin({ condition: "c", waitedMs: 60_000, subagents: 0, shells: 2 }, coordinator)).toContain(
      "Commit on your wt/<slug> branch and submit before the goal counts as done.",
    )
  })

  test("systemReminder", () => {
    expect(systemReminder("c", direct)).toBe([
      "An active /goal is set for this session: c",
      "An independent evaluator checks it after every turn from visible evidence only. Do the work and surface proof (command output, test results) in the conversation.",
      "Finished work has to be committed to the `dev` branch before the goal counts as met.",
      DELEGATE_VERDICT,
    ].join("\n"))
    expect(systemReminder("c", coordinator)).toContain(
      "Finished work has to be committed on your wt/<slug> branch and submitted before the goal counts as met.",
    )
  })

  test("evaluator facts (via evaluateInSession / evaluateIndependently)", () => {
    const factsLine = "- This session runs inside a git repository. Finished work has to be committed to the `dev` branch before the goal counts as met."
    const factsCoordinator =
      "- This session runs inside a git repository managed by the coordinator. Finished work has to be committed on the agent's own `wt/<slug>` branch and submitted (merge into `dev` by the coordinator) before the goal counts as met."
    const input = { turn: 2, elapsedMs: 90_000 }
    expect(evaluateInSession("c", input, direct)).toContain(factsLine)
    expect(evaluateIndependently("c", input, "digest", direct)).toContain(factsLine)
    expect(evaluateInSession("c", input, coordinator)).toContain(factsCoordinator)
    expect(evaluateIndependently("c", input, "digest", coordinator)).toContain(factsCoordinator)
  })
})
