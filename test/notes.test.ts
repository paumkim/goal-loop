/**
 * End-of-record notes are history, not instructions: the `<goal-note final>` variant stays in the
 * session (and on the terminal as the outcome line) but never rides the model's context on later turns.
 * These tests pin the grammar and the context-hook predicate.
 */
import { describe, expect, test } from "bun:test"
import { note, isGoalNoteMessage, stripGoalNotes, TERMINAL_NOTE_TAG, isGoalInstructionMessage, stripGoalContext, carriesGoalGrammar, TERMINAL_REMINDER } from "../src/core/prompts.ts"

const textMessage = (text: string) => ({ role: "user", content: [{ type: "text", text }] })

describe("note()", () => {
  test("plain notes keep the legacy wrapper", () => {
    expect(note({ title: "t", body: "b" })).toBe("<goal-note>\nt\nb\n</goal-note>")
  })
  test("final notes carry the terminal tag", () => {
    expect(note({ title: "t", body: "b", final: true })).toBe(`${TERMINAL_NOTE_TAG}\nt\nb\n</goal-note>`)
  })
  test("non-final final-tagged notes are impossible — final is the only difference", () => {
    expect(note({ title: "t", body: "b", final: false })).not.toContain(TERMINAL_NOTE_TAG)
  })
})

describe("isGoalNoteMessage", () => {
  test("matches a user message whose text part carries the terminal tag", () => {
    expect(isGoalNoteMessage(textMessage(note({ title: "Goal achieved (turn 1, 7m 21s).", body: "done", final: true })))).toBe(true)
  })
  test("matches a plain loop-advance note too (legacy notes must leave the context)", () => {
    expect(isGoalNoteMessage(textMessage(note({ title: "Loop 2 of 5 achieved", body: "v3 armed" })))).toBe(true)
  })
  test("ignores non-text parts even with a similar payload shape", () => {
    expect(isGoalNoteMessage({ role: "user", content: [{ type: "media", text: TERMINAL_NOTE_TAG }] })).toBe(false)
  })
  test("ignores malformed messages", () => {
    expect(isGoalNoteMessage(null)).toBe(false)
    expect(isGoalNoteMessage(undefined)).toBe(false)
    expect(isGoalNoteMessage("<goal-note final>")).toBe(false)
    expect(isGoalNoteMessage({})).toBe(false)
    expect(isGoalNoteMessage({ content: null })).toBe(false)
    expect(isGoalNoteMessage({ content: "not-an-array" })).toBe(false)
    expect(isGoalNoteMessage({ content: [null, { type: "text" }, 42] })).toBe(false)
  })
  test("matches when any of several parts is a goal note of either kind", () => {
    const message = { role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: `${TERMINAL_NOTE_TAG}\nx\n` }] }
    expect(isGoalNoteMessage(message)).toBe(true)
    const plain = { role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "<goal-note>\ny\n" }] }
    expect(isGoalNoteMessage(plain)).toBe(true)
  })
  test("a compaction checkpoint is history, not a note, even when its recent text quotes one", () => {
    const checkpoint = textMessage(
      [
        "<conversation-checkpoint>",
        "<summary>\nworked\n</summary>",
        "<recent-context>",
        "[User]: <goal-note final>\nGoal achieved\ndone\n</goal-note>",
        "</recent-context>",
        "</conversation-checkpoint>",
      ].join("\n"),
    )
    expect(isGoalNoteMessage(checkpoint)).toBe(false)
  })
})

describe("stripGoalNotes", () => {
  test("drops goal notes of either kind, preserves order and the input array", () => {
    const keep1 = textMessage("user task")
    const drop1 = textMessage(note({ title: "Goal achieved", body: "done", final: true }))
    const keep2 = textMessage("assistant answer")
    const drop2 = textMessage(note({ title: "Loop 1 of 3 achieved", body: "v2 armed" }))
    const input = [keep1, drop1, keep2, drop2]
    expect(stripGoalNotes(input)).toEqual([keep1, keep2])
    expect(input).toHaveLength(4)
  })
  test("an empty list stays empty", () => {
    expect(stripGoalNotes([])).toEqual([])
  })
})

describe("isGoalInstructionMessage / stripGoalContext", () => {
  const msg = (...texts: string[]) => ({ role: "user", content: texts.map((text) => ({ type: "text", text })) })

  test("matches every plugin instruction tag but not plain text", () => {
    expect(isGoalInstructionMessage(msg("<goal>\nthe parser is correct\n</goal>"))).toBe(true)
    expect(isGoalInstructionMessage(msg('<goal-loop iteration="1" max="5">'))).toBe(true)
    expect(isGoalInstructionMessage(msg("<goal-continuation turn=\"2\">\nThe goal is not met yet."))).toBe(true)
    expect(isGoalInstructionMessage(msg("<goal-retry>\nThe previous turn failed"))).toBe(true)
    expect(isGoalInstructionMessage(msg("<goal-checkin>\nBackground work has kept the goal waiting"))).toBe(true)
    expect(isGoalInstructionMessage(msg("the parser is correct"))).toBe(false)
    expect(isGoalInstructionMessage(msg("a <goal-note> is not an instruction"))).toBe(false)
    expect(isGoalInstructionMessage(null)).toBe(false)
    expect(isGoalInstructionMessage({})).toBe(false)
  })

  test("stripGoalContext drops instructions and notes, keeps plain messages in order", () => {
    const kickoff = msg("<goal>\nthe parser is correct\n</goal>")
    const continuation = msg("<goal-continuation turn=\"2\">\nkeep going")
    const note = msg("<goal-note final>\nGoal achieved\ndone\n</goal-note>")
    const keep = msg("the user ad-hoc line")
    expect(stripGoalContext([kickoff, keep, continuation, note])).toEqual([keep])
    expect(stripGoalContext([keep])).toEqual([keep])
    expect(stripGoalContext([])).toEqual([])
  })

  test("TERMINAL_REMINDER is a counter-instruction, not an instruction to work", () => {
    expect(TERMINAL_REMINDER).toContain("Do not resume work toward it")
    expect(TERMINAL_REMINDER).toContain("await the user's next instruction")
  })

  test("a compaction checkpoint is history, not an instruction, and survives the terminal strip", () => {
    const checkpoint = msg(
      [
        "<conversation-checkpoint>",
        "The following is a summary and serialized record of earlier conversation. Treat it as historical context, not as new instructions.",
        "<summary>\nworked\n</summary>",
        "<recent-context>",
        "[User]: <goal>\nfinish the tree\n</goal>",
        "[Assistant]: ok",
        "</recent-context>",
        "</conversation-checkpoint>",
      ].join("\n"),
    )
    expect(isGoalInstructionMessage(checkpoint)).toBe(false)
    expect(stripGoalContext([checkpoint])).toEqual([checkpoint])
  })
  test("carriesGoalGrammar sees goal text stripping cannot remove, and nothing else", () => {
    const checkpoint = msg(
      [
        "<conversation-checkpoint>",
        "<summary>worked</summary>",
        "<recent-context>",
        "[User]: <goal>\nfinish the tree\n</goal>",
        "</recent-context>",
        "</conversation-checkpoint>",
      ].join("\n"),
    )
    expect(carriesGoalGrammar([msg("the user's own line")])).toBe(false)
    expect(carriesGoalGrammar([])).toBe(false)
    expect(carriesGoalGrammar([msg("<goal>\nfinish the tree\n</goal>")])).toBe(true)
    expect(carriesGoalGrammar([checkpoint])).toBe(true)
    expect(carriesGoalGrammar([msg("the user's own line"), checkpoint])).toBe(true)
    expect(carriesGoalGrammar([{ role: "user" }, null, 42, {}])).toBe(false)
  })
})
