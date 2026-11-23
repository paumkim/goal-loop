/**
 * End-of-record notes are history, not instructions: the `<goal-note final>` variant stays in the
 * session (and on the terminal as the outcome line) but never rides the model's context on later turns.
 * These tests pin the grammar and the context-hook predicate.
 */
import { describe, expect, test } from "bun:test"
import { isGoalNoteMessage, stripGoalNotes, isGoalInstructionMessage, stripGoalContext, carriesGoalGrammar, TERMINAL_REMINDER, isGoalEvaluationMessage, stripGoalEvaluations } from "../src/core/prompts.ts"

const textMessage = (text: string) => ({ role: "user", content: [{ type: "text", text }] })
/** Grammar fixtures: the matchers must accept the exact bytes the host paints, tag and all. */
const terminalNote = (title: string, body: string) => `<goal-note final>\n${title}\n${body}\n</goal-note>`
const plainNote = (title: string, body: string) => `<goal-note>\n${title}\n${body}\n</goal-note>`

describe("isGoalNoteMessage", () => {
  test("matches a user message whose text part carries the terminal tag", () => {
    expect(isGoalNoteMessage(textMessage(terminalNote("Goal achieved (turn 1, 7m 21s).", "done")))).toBe(true)
  })
  test("matches a plain loop-advance note too (legacy notes must leave the context)", () => {
    expect(isGoalNoteMessage(textMessage(plainNote("Loop 2 of 5 achieved", "v3 armed")))).toBe(true)
  })
  test("ignores non-text parts even with a similar payload shape", () => {
    expect(isGoalNoteMessage({ role: "user", content: [{ type: "media", text: "<goal-note final>" }] })).toBe(false)
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
    const message = { role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "<goal-note final>\nx\n" }] }
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
    const drop1 = textMessage(terminalNote("Goal achieved", "done"))
    const keep2 = textMessage("assistant answer")
    const drop2 = textMessage(plainNote("Loop 1 of 3 achieved", "v2 armed"))
    const input = [keep1, drop1, keep2, drop2]
    expect(stripGoalNotes(input)).toEqual([keep1, keep2])
    expect(input).toHaveLength(4)
  })
  test("an empty list stays empty", () => {
    expect(stripGoalNotes([])).toEqual([])
  })
})

describe("isGoalEvaluationMessage / stripGoalEvaluations (CXV use-and-forget)", () => {
  const evalPrompt = (turn: number) => `<goal-evaluation>\nStep out of the agent role. Turn ${turn}.\n</goal-evaluation>`
  const msg = (...texts: string[]) => ({ role: "user", content: texts.map((text) => ({ type: "text", text })) })

  test("recognizes the evaluator's own prompt but not plain text or other goal grammar", () => {
    expect(isGoalEvaluationMessage(msg(evalPrompt(1)))).toBe(true)
    expect(isGoalEvaluationMessage(msg("the user's own line"))).toBe(false)
    expect(isGoalEvaluationMessage(msg("<goal>\nfinish the tree\n</goal>"))).toBe(false)
    expect(isGoalEvaluationMessage(msg("<goal-note final>\nGoal achieved\ndone\n</goal-note>"))).toBe(false)
  })

  test("matches the flat-text digest-source shape too (ctx.session.context())", () => {
    expect(isGoalEvaluationMessage({ type: "user", text: evalPrompt(1) })).toBe(true)
    expect(isGoalEvaluationMessage({ type: "user", text: "plain evidence" })).toBe(false)
    const flat = [
      { type: "user", text: evalPrompt(1) },
      { type: "user", text: "fresh evidence" },
      { type: "user", text: evalPrompt(2) },
    ]
    expect(stripGoalEvaluations(flat)).toEqual([{ type: "user", text: "fresh evidence" }])
    const checkpoint = { type: "synthetic", text: `<conversation-checkpoint><recent-context>${evalPrompt(1)}</recent-context></conversation-checkpoint>` }
    expect(isGoalEvaluationMessage(checkpoint)).toBe(false)
  })

  test("ignores malformed messages and non-text parts", () => {
    expect(isGoalEvaluationMessage(null)).toBe(false)
    expect(isGoalEvaluationMessage(undefined)).toBe(false)
    expect(isGoalEvaluationMessage("<goal-evaluation>")).toBe(false)
    expect(isGoalEvaluationMessage({})).toBe(false)
    expect(isGoalEvaluationMessage({ content: null })).toBe(false)
    expect(isGoalEvaluationMessage({ content: "not-an-array" })).toBe(false)
    expect(isGoalEvaluationMessage({ content: [null, { type: "media", text: evalPrompt(1) }, 42] })).toBe(false)
    expect(isGoalEvaluationMessage({ content: [{ type: "text" }] })).toBe(false)
  })

  test("a compaction checkpoint is history, not a live evaluation prompt", () => {
    const checkpoint = msg(
      [
        "<conversation-checkpoint>",
        "<summary>worked</summary>",
        "<recent-context>",
        `[User]: ${evalPrompt(1)}`,
        "</recent-context>",
        "</conversation-checkpoint>",
      ].join("\n"),
    )
    expect(isGoalEvaluationMessage(checkpoint)).toBe(false)
    expect(stripGoalEvaluations([checkpoint])).toEqual([checkpoint])
  })

  test("drops every evaluation prompt, preserves order and the input array", () => {
    const keep1 = msg("user task")
    const drop1 = msg(evalPrompt(1))
    const keep2 = msg("real evidence: bun run check green")
    const drop2 = msg(evalPrompt(2))
    const input = [keep1, drop1, keep2, drop2]
    expect(stripGoalEvaluations(input)).toEqual([keep1, keep2])
    expect(input).toHaveLength(4)
    expect(stripGoalEvaluations([])).toEqual([])
  })

  test("keepLast retains only the most recent evaluation prompt (the live rubric)", () => {
    const old1 = msg(evalPrompt(1))
    const old2 = msg(evalPrompt(2))
    const current = msg(evalPrompt(3))
    const evidence = msg("real evidence")
    // Current prompt is last: it survives, older echoes do not.
    expect(stripGoalEvaluations([old1, evidence, old2, current], { keepLast: true })).toEqual([evidence, current])
    // Most recent by position even when evidence trails it: never keep more than one.
    expect(stripGoalEvaluations([old1, current, evidence], { keepLast: true })).toEqual([current, evidence])
    // No evaluation prompt at all: nothing is invented.
    expect(stripGoalEvaluations([evidence], { keepLast: true })).toEqual([evidence])
    expect(stripGoalEvaluations([], { keepLast: true })).toEqual([])
  })

  test("keepLast:false is the default and drops all prompts even when one is last", () => {
    const current = msg(evalPrompt(1))
    expect(stripGoalEvaluations([msg("evidence"), current])).toEqual([msg("evidence")])
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
