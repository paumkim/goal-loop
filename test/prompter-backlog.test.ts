import { describe, expect, test } from "bun:test"
import { parseBacklog, selectNextTask, summarizeBacklog, writeLineStatus } from "../src/prompter/backlog.ts"
import { shortId } from "../src/prompter/util.ts"
import type { TaskState } from "../src/prompter/types.ts"

const BASE = `# Backlog

- [ ] first task with a clear condition
- [x] already done
- [ ] second task
`

describe("backlog", () => {
  test("parses checkbox lines and ignores prose", () => {
    const lines = parseBacklog(BASE)
    expect(lines.length).toBe(3)
    expect(lines[0]?.objective).toBe("first task with a clear condition")
    expect(lines[0]?.checked).toBe(false)
    expect(lines[1]?.checked).toBe(true)
    expect(lines[0]?.id).toBe(shortId("first task with a clear condition"))
  })

  test("extracts prompter markers from the objective text", () => {
    const text = "- [ ] keep me <!-- prompter: in_review id=abc123 -->\n"
    const line = parseBacklog(text)[0]!
    expect(line.objective).toBe("keep me")
    expect(line.marker?.status).toBe("in_review")
    expect(line.marker?.id).toBe("abc123")
    expect(line.id).toBe("abc123")
  })

  test("selectNextTask picks the first unattempted unchecked line", () => {
    const states = new Map<string, TaskState>()
    expect(selectNextTask(parseBacklog(BASE), states)?.objective).toBe("first task with a clear condition")

    const marked = "- [ ] marked <!-- prompter: failed id=xyz -->\n- [ ] available\n"
    const lines = parseBacklog(marked)
    expect(selectNextTask(lines, states)?.objective).toBe("available")
  })

  test("a terminal state record does not block retry once its marker is removed", () => {
    const lines = parseBacklog(BASE)
    const id = lines[0]!.id
    for (const status of ["failed", "rejected", "interrupted", "merged"]) {
      const states = new Map<string, TaskState>([[id, { id, status } as TaskState]])
      expect(selectNextTask(lines, states)?.objective).toBe("first task with a clear condition")
    }
  })

  test("live state records still block a line with no marker", () => {
    const lines = parseBacklog(BASE)
    const id = lines[0]!.id
    for (const status of ["running", "in_review"]) {
      const states = new Map<string, TaskState>([[id, { id, status } as TaskState]])
      expect(selectNextTask(lines, states)?.objective).toBe("second task")
    }
  })

  test("writeLineStatus updates the marker and checkbox in place", () => {
    const lines = parseBacklog(BASE)
    const next = writeLineStatus(BASE, lines[0]!, "merged", lines[0]!.id, true)
    expect(next).toContain("- [x] first task with a clear condition <!-- prompter: merged id=")
    expect(next.split("\n")[3]).toBe("- [x] already done")

    const retry = writeLineStatus(BASE, lines[0]!, "failed", lines[0]!.id, false)
    expect(retry).toContain("- [ ] first task with a clear condition <!-- prompter: failed id=")
  })

  test("summarizeBacklog shows current status", () => {
    const lines = parseBacklog(BASE)
    const states = new Map<string, TaskState>([[lines[0]!.id, { id: lines[0]!.id, status: "in_review" } as TaskState]])
    const summary = summarizeBacklog(lines, states)
    expect(summary).toContain("[in_review]")
    expect(summary).toContain("[done]")
    expect(summary).toContain("[todo]")
  })
})
