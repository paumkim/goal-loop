/**
 * A parent-linked harness child (judge / arm-time planner) completes with a host `<subagent>` report that
 * wakes its owner. That wake is plumbing: judging it spawned a second evaluator and a continuation steer
 * after the verdict had already landed. Only that one wake turn is dropped; worker reports still wake and
 * are judged, and the child's own completion still routes normally.
 */
import { describe, expect, test } from "bun:test"
import { createRouter } from "../src/runtime/events.ts"

function harness() {
  const calls = { succeeded: [] as string[], started: [] as string[], drained: 0 }
  const internal = new Map<string, string>()
  const controller = {
    noteSessionDirectory: () => {},
    onExecutionStarted: (id: string) => void calls.started.push(id),
    onExecutionSucceeded: (id: string) => void calls.succeeded.push(id),
    onExecutionFailed: () => {},
    onExecutionInterrupted: () => {},
    onBackgroundDrained: () => void calls.drained++,
    onSessionDeleted: () => {},
    onSessionMoved: () => {},
    onCompactionLanded: () => {},
  }
  const background = {
    executionStarted: () => {},
    executionEnded: () => {},
    sessionCreated: () => {},
    sessionDeleted: () => {},
    internalAgentOf: (id: string) => internal.get(id),
    ancestorsOf: async () => [],
  }
  const compactor = {
    maybeCompact: () => {},
    onSessionDeleted: () => {},
    noteCompactionStarted: () => {},
    noteCompactionEnded: () => {},
  }
  const log = { info: () => {}, warn: () => {}, error: () => {} }
  const route = createRouter({ controller: controller as any, background: background as any, log: log as any, compactor: compactor as any })
  const event = (type: string, sessionID: string, extra: Record<string, unknown> = {}) => ({
    id: `${type}-${sessionID}-${calls.started.length}-${calls.succeeded.length}-${Math.random()}`,
    type,
    data: { sessionID, ...extra },
  })
  return { route, calls, internal, event }
}

describe("the event router drops only harness-child wake turns", () => {
  test("an evaluator child's completion wake is not judged again", () => {
    const { route, calls, internal, event } = harness()
    route(event("session.created", "ses_judge", { parentID: "ses_owner" }))
    internal.set("ses_judge", "evaluator")
    route(event("session.execution.succeeded", "ses_judge"))
    route(event("session.execution.started", "ses_owner"))
    route(event("session.execution.succeeded", "ses_owner"))
    expect(calls.succeeded).toEqual(["ses_judge"])
  })

  test("a real worker's completion wake still reaches evaluation", () => {
    const { route, calls, event } = harness()
    route(event("session.created", "ses_worker", { parentID: "ses_owner" }))
    route(event("session.execution.succeeded", "ses_worker"))
    route(event("session.execution.started", "ses_owner"))
    route(event("session.execution.succeeded", "ses_owner"))
    expect(calls.succeeded).toEqual(["ses_worker", "ses_owner"])
  })

  test("an ordinary owner turn is still evaluated", () => {
    const { route, calls, event } = harness()
    route(event("session.execution.started", "ses_owner"))
    route(event("session.execution.succeeded", "ses_owner"))
    expect(calls.succeeded).toEqual(["ses_owner"])
  })

  test("an interrupted wake cannot swallow the next genuine turn", () => {
    const { route, calls, internal, event } = harness()
    route(event("session.created", "ses_judge", { parentID: "ses_owner" }))
    internal.set("ses_judge", "evaluator")
    route(event("session.execution.succeeded", "ses_judge"))
    route(event("session.execution.started", "ses_owner"))
    route(event("session.execution.interrupted", "ses_owner", { reason: "user" }))
    route(event("session.execution.started", "ses_owner"))
    route(event("session.execution.succeeded", "ses_owner"))
    expect(calls.succeeded).toEqual(["ses_judge", "ses_owner"])
  })
})
