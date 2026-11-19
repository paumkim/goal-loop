/**
 * The verification gate's shell runner (`createVerifier`). The controller's `met` gate is only as
 * trustworthy as this port: it must report the real exit code and output, and it must honor its own
 * budget. These tests pin the spawn semantics directly, because a timeout that does not converge is
 * indistinguishable from a hang at the evaluator's layer.
 */
import { describe, expect, test } from "bun:test"
import { createVerifier } from "../src/index.ts"

const verifier = createVerifier()
const live = () => new AbortController().signal

describe("verification gate: the shell runner", () => {
  test("a passing command reports exit 0 with its output", async () => {
    const run = await verifier.verify({ command: "echo verified", cwd: "/tmp", timeoutMs: 5_000, signal: live() })
    expect(run.code).toBe(0)
    expect(run.timedOut).toBe(false)
    expect(run.output).toContain("verified")
  })
  test("a failing command keeps its exit code and reads stderr too", async () => {
    const run = await verifier.verify({ command: "echo boom >&2; exit 3", cwd: "/tmp", timeoutMs: 5_000, signal: live() })
    expect(run.code).toBe(3)
    expect(run.timedOut).toBe(false)
    expect(run.output).toContain("boom")
  })
  test("the budget is enforced even when the command leaves a child holding stdout", async () => {
    // The shell is not the only process in the tree: `sleep` inherits the pipe. Killing only the shell
    // left the drain waiting for a child that no longer had an owner (measured: 200ms budget, 3003ms wait).
    const started = Date.now()
    const run = await verifier.verify({ command: "sleep 3; echo late", cwd: "/tmp", timeoutMs: 200, signal: live() })
    expect(run.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(1_500)
  })
  test("a signal already aborted at the spawn kills the command instead of running it to completion", async () => {
    // An already-aborted signal never fires its listener, so arming only the listener ran the command anyway.
    const controller = new AbortController()
    controller.abort()
    const started = Date.now()
    await verifier.verify({ command: "sleep 3; echo late", cwd: "/tmp", timeoutMs: 10_000, signal: controller.signal })
    expect(Date.now() - started).toBeLessThan(1_500)
  })
})
