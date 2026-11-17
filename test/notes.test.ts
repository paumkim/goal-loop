/**
 * End-of-record notes are history, not instructions: the `<goal-note final>` variant stays in the
 * session (and on the terminal as the outcome line) but never rides the model's context on later turns.
 * These tests pin the grammar and the context-hook predicate.
 */
import { describe, expect, test } from "bun:test"
import { note, isTerminalGoalNoteMessage, stripTerminalGoalNotes, TERMINAL_NOTE_TAG } from "../src/core/prompts.ts"

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

describe("isTerminalGoalNoteMessage", () => {
  test("matches a user message whose text part carries the terminal tag", () => {
    expect(isTerminalGoalNoteMessage(textMessage(note({ title: "Goal achieved (turn 1, 7m 21s).", body: "done", final: true })))).toBe(true)
  })
  test("ignores plain goal notes (loop advance)", () => {
    expect(isTerminalGoalNoteMessage(textMessage(note({ title: "Loop 2 of 5 achieved", body: "v3 armed" })))).toBe(false)
  })
  test("ignores non-text parts even with a similar payload shape", () => {
    expect(isTerminalGoalNoteMessage({ role: "user", content: [{ type: "media", text: TERMINAL_NOTE_TAG }] })).toBe(false)
  })
  test("ignores malformed messages", () => {
    expect(isTerminalGoalNoteMessage(null)).toBe(false)
    expect(isTerminalGoalNoteMessage(undefined)).toBe(false)
    expect(isTerminalGoalNoteMessage("<goal-note final>")).toBe(false)
    expect(isTerminalGoalNoteMessage({})).toBe(false)
    expect(isTerminalGoalNoteMessage({ content: null })).toBe(false)
    expect(isTerminalGoalNoteMessage({ content: "not-an-array" })).toBe(false)
    expect(isTerminalGoalNoteMessage({ content: [null, { type: "text" }, 42] })).toBe(false)
  })
  test("matches when any of several parts is the terminal note", () => {
    const message = { role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: `${TERMINAL_NOTE_TAG}\nx\n` }] }
    expect(isTerminalGoalNoteMessage(message)).toBe(true)
  })
})

describe("stripTerminalGoalNotes", () => {
  test("drops only the terminal notes, preserves order and the input array", () => {
    const keep1 = textMessage("user task")
    const drop = textMessage(note({ title: "Goal achieved", body: "done", final: true }))
    const keep2 = textMessage("assistant answer")
    const keep3 = textMessage(note({ title: "Loop 1 of 3 achieved", body: "v2 armed" }))
    const input = [keep1, drop, keep2, keep3]
    expect(stripTerminalGoalNotes(input)).toEqual([keep1, keep2, keep3])
    expect(input).toHaveLength(4)
  })
  test("an empty list stays empty", () => {
    expect(stripTerminalGoalNotes([])).toEqual([])
  })
})
