import { describe, expect, test } from "bun:test"
import { BackgroundTracker } from "../src/runtime/background.ts"

/** Parent links are delivered by session.created in the real host; the stub only serves pre-plugin sessions. */
function tracker(parents: Record<string, string | undefined> = {}) {
  const background = new BackgroundTracker({
    parentOf: async (sessionID) => parents[sessionID],
  })
  const create = (sessionID: string, parentID?: string) => background.sessionCreated(sessionID, parentID)
  return { background, create }
}

describe("peer parent addresses", () => {
  test("an empty host has no peers", () => {
    const { background } = tracker()
    expect(background.otherParentAddresses("ses_A")).toEqual([])
  })

  test("two root sessions see each other as other parents", () => {
    const { background, create } = tracker()
    create("ses_A")
    create("ses_B")
    expect(background.otherParentAddresses("ses_A")).toEqual(["ses_B"])
    expect(background.otherParentAddresses("ses_B")).toEqual(["ses_A"])
  })

  test("a worker sees its own parent's family as itself and other roots as peers", () => {
    const { background, create } = tracker()
    create("ses_parent_A")
    create("ses_worker_A", "ses_parent_A")
    create("ses_worker_A2", "ses_parent_A")
    create("ses_parent_B")
    // The caller passes its own address (`agentIdFor`), so every member of its parent's family is excluded.
    expect(background.otherParentAddresses("ses_parent_A")).toEqual(["ses_parent_B"])
    expect(background.otherParentAddresses("ses_parent_B")).toEqual(["ses_parent_A"])
  })

  test("a nested worker is addressed by its immediate parent, not its root", () => {
    const { background, create } = tracker()
    create("ses_root_A")
    create("ses_worker_A", "ses_root_A")
    create("ses_nested_A", "ses_worker_A")
    create("ses_root_B")
    expect(background.otherParentAddresses("ses_worker_A")).toEqual(["ses_root_A", "ses_root_B"])
  })

  test("goal-loop's own children are machinery, not peer parents", () => {
    const { background, create } = tracker()
    create("ses_A")
    create("ses_child", "ses_B")
    background.noteInternal("ses_child", "evaluator")
    expect(background.otherParentAddresses("ses_A")).toEqual([])
  })

  test("a deleted session stops being a peer", () => {
    const { background, create } = tracker()
    create("ses_A")
    create("ses_B")
    expect(background.otherParentAddresses("ses_A")).toEqual(["ses_B"])
    background.sessionDeleted("ses_B")
    expect(background.otherParentAddresses("ses_A")).toEqual([])
  })
})
