/**
 * Regression: the judge child's own `<goal-evaluation>` request must survive the `context` hook's
 * goal-grammar strip. When the armed condition quotes a rendered `<goal>` kickoff (users paste one into
 * `/goal`), `isGoalInstructionMessage` matched the embedded tag and deleted the judge's request, so the
 * judge saw only the system prefix and answered not_met claiming no `<condition>` was provided.
 */
import { describe, expect, test } from "bun:test"
import { isGoalEvaluationMessage, stripGoalContext, stripGoalEvaluations, nativeEvaluationRequest } from "../src/core/prompts.ts"

const userMessage = (text: string) => ({ role: "user", content: [{ type: "text", text }] })

// A condition that embeds a pasted kickoff — exactly the shape that triggered the bug.
const condition =
  'review this summary "The repetition came from directive().\n' +
  "<goal>\n<loop iteration=\"1\" max=\"5\">\n...\n</loop>\nObjective: improve the repo.\n</goal>\n" +
  "<goal-continuation turn=\"2\">Evaluator: not met</goal-continuation>"

const request = nativeEvaluationRequest({ condition, summary: "[tool bash] command: bun test\n  output:\n    12 pass 0 fail" })

describe("judge request survives goal-grammar stripping", () => {
  test("the request embeds a literal <goal> tag in its condition", () => {
    expect(request).toContain("<goal-evaluation>")
    expect(request).toContain("<condition>")
    expect(request).toContain("<goal>")
    expect(isGoalEvaluationMessage(userMessage(request))).toBe(true)
  })

  test("stripGoalContext keeps the evaluation request even when its condition quotes <goal>", () => {
    const judge = userMessage(request)
    expect(stripGoalContext([judge])).toEqual([judge])
  })

  test("the full hook chain keeps the live request for the judge child", () => {
    const judge = userMessage(request)
    const kept = stripGoalEvaluations(stripGoalContext([judge]), { keepLast: true })
    expect(kept).toEqual([judge])
    const text = (kept[0] as { content: Array<{ type: string; text?: string }> }).content[0]?.text ?? ""
    expect(text).toContain("<condition>")
    expect(text).toContain("<parent-summary>")
  })

  test("a genuine <goal> instruction message is still stripped", () => {
    const kickoff = userMessage("<goal>fix the failing tests</goal>")
    expect(stripGoalContext([kickoff])).toEqual([])
  })

  test("a finished worker session still drops evaluation echoes", () => {
    const judge = userMessage(request)
    const kept = stripGoalEvaluations(stripGoalContext([judge]), { keepLast: false })
    expect(kept).toEqual([])
  })
})
