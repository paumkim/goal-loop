/**
 * End-of-record notes are history, not instructions: the `<goal-note final>` variant stays in the
 * session (and on the terminal as the outcome line) but never rides the model's context on later turns.
 * These tests pin the grammar and the context-hook predicate.
 */
import { describe, expect, test } from "bun:test"
import { note, isGoalNoteMessage, stripGoalNotes, TERMINAL_NOTE_TAG } from "../src/core/prompts.ts"

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
