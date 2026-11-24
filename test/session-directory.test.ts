import { describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/core/config.ts"
import type { CommitPolicy, Notice, UsageSnapshot } from "../src/core/types.ts"
import { BackgroundTracker } from "../src/runtime/background.ts"
import { AutoCompactor } from "../src/runtime/compactor.ts"
import { GoalController } from "../src/runtime/controller.ts"
import { createRouter } from "../src/runtime/events.ts"
import type { BackgroundWork, Clock, EvaluationRequest, EvaluationResult, StoragePort, VerifyRequest, VerifyResult } from "../src/runtime/ports.ts"
import { GoalStore, keyFor } from "../src/runtime/store.ts"

const SID = "ses_1"
const OTHER = "ses_2"
const OLD_DIR = "/work/old-project"
const NEW_DIR = "/work/new-project"

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

class FakeClock implements Clock {
  t = 1_000_000
  now = () => this.t
  setTimeout = (fn: () => void, _ms: number) => {
    void fn
    return 1
  }
  clearTimeout = () => {}
}

class MemoryStorage implements StoragePort {
  data = new Map<string, unknown>()
  writes: string[] = []
  get = async (key: string) => structuredClone(this.data.get(key))
  set = async (key: string, value: unknown) => {
    this.writes.push(key)
    void this.data.set(key, structuredClone(value))
  }
  remove = async (key: string) => void this.data.delete(key)
  scan = async ({ prefix }: { prefix: string }) => ({
    entries: [...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })),
  })
}

const commit: CommitPolicy = { required: false, branch: "dev", reason: "test" }
const met = (): EvaluationResult => ({ verdict: "met", reason: "done" })

function harness(
  options: Record<string, unknown> = {},
  { directory = OLD_DIR, storage = new MemoryStorage(), withVerifier = false, commitFor }: {
    directory?: string; storage?: MemoryStorage; withVerifier?: boolean; commitFor?: (dir: string) => CommitPolicy
  } = {},
) {
  const clock = new FakeClock()
  const changes: Array<{ sessionID: string; directory?: string }> = []
  const evaluations: boolean[] = []
  const logs: Array<{ level: string; message: string; extra?: Record<string, unknown> }> = []
  const verdicts: EvaluationResult[] = []
  const evaluationRequests: EvaluationRequest[] = []
  const verifyCalls: VerifyRequest[] = []
  const prompts: any[] = []
  const log = {
    info: (message: string, extra?: Record<string, unknown>) => void logs.push({ level: "info", message, extra }),
    warn: (message: string, extra?: Record<string, unknown>) => void logs.push({ level: "warn", message, extra }),
    error: (message: string, extra?: Record<string, unknown>) => void logs.push({ level: "error", message, extra }),
  }
  const store = new GoalStore(storage, (error) => { throw error })
  const controller = new GoalController({
    config: resolveConfig({ learning: { enabled: false }, ...options }),
    directory,
    commit,
    ...(commitFor ? { commitFor } : {}),
    clock,
    log,
    store,
    newId: (() => { let n = 0; return () => `goal_${++n}` })(),
    session: {
      prompt: async (input: any) => void prompts.push(input),
      synthetic: async () => {},
      usage: async (): Promise<UsageSnapshot | undefined> => ({ cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
      compact: async () => {},
    },
    evaluator: {
      evaluate: async (request: EvaluationRequest) => {
        evaluationRequests.push(request)
        const next = verdicts.shift()
        if (!next) throw new Error("no verdict queued")
        return next
      },
    },
    background: { busy: async (): Promise<BackgroundWork> => ({ subagents: 0, shells: 0 }) },
    emitter: {
      changed: (sessionID, goal) => {
        changes.push({ sessionID, directory: goal?.directory })
        evaluations.push(goal?.evaluating ?? false)
      },
      notice: (_n: Notice) => {},
    },
    ...(withVerifier
      ? {
          verifier: {
            verify: async (request: VerifyRequest): Promise<VerifyResult> => {
              verifyCalls.push(request)
              return { code: 0, output: "ok", timedOut: false }
            },
          },
        }
      : {}),
  })
  const route = createRouter({
    controller,
    background: new BackgroundTracker({ parentOf: async () => undefined }),
    log,
    compactor: new AutoCompactor({
      config: resolveConfig({}),
      compact: async () => {},
      context: async () => [],
      emitter: { changed: () => {}, notice: () => {} },
      clock,
      log,
    }),
  })
  const turn = async (sessionID = SID) => {
    controller.onExecutionStarted(sessionID)
    controller.onToolCalled(sessionID)
    await controller.onExecutionSucceeded(sessionID)
    await flush()
  }
  const set = async (sessionID = SID, condition = "tests pass") =>
    controller.command({ sessionID, text: condition, delivery: "steer" })
  return { controller, route, storage, store, changes, evaluations, logs, verdicts, evaluationRequests, verifyCalls, prompts, clock, turn, set, log }
}

describe("a goal follows the session that armed it across directory moves", () => {
  test("session.moved prefers the destination in data.location over a stale top-level location", async () => {
    const h = harness()
    await h.set()
    h.route({
      id: "move-precedence",
      type: "session.moved",
      location: { directory: OLD_DIR }, // host envelope stamped before the move
      data: { sessionID: SID, location: { directory: NEW_DIR } }, // the actual destination
    })
    await flush()
    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
  })

  test("session.moved moves the persisted record, emits one changed snapshot, and logs", async () => {
    const h = harness()
    await h.set()
    expect(h.controller.get(SID)!.directory).toBe(OLD_DIR)
    const writesBefore = h.storage.writes.length
    const changesBefore = h.changes.length

    h.route({ id: "move-1", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()

    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
    expect((h.storage.data.get(keyFor(SID)) as { directory: string }).directory).toBe(NEW_DIR)
    expect(h.storage.writes.length).toBe(writesBefore + 1)
    expect(h.changes.at(-1)).toEqual({ sessionID: SID, directory: NEW_DIR })
    expect(h.changes.length).toBe(changesBefore + 1)
    expect(h.logs.some((l) => l.message === "goal followed session to a new directory" && l.extra?.sessionID === SID)).toBe(true)
  })

  test("a move during an in-flight evaluation aborts it and paints the pill off", async () => {
    const h = harness()
    await h.set()
    let release!: (result: EvaluationResult) => void
    const pending = new Promise<EvaluationResult>((resolve) => { release = resolve })
    h.verdicts.push(pending as unknown as EvaluationResult)
    h.controller.onExecutionStarted(SID)
    h.controller.onToolCalled(SID)
    void h.controller.onExecutionSucceeded(SID) // deliberately not awaited: the verdict is pending
    await flush()
    expect(h.evaluations.at(-1)).toBe(true)

    h.route({ id: "move-mid", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()

    // The stale verdict can no longer land, and the "checking" pill is flipped off in the same move.
    expect(h.evaluations.at(-1)).toBe(false)
    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
    release(met())
    await flush()
    expect(h.evaluations.at(-1)).toBe(false)
    expect(h.controller.get(SID)!.verdict).toBeUndefined()
  })

  test("the new directory is also read from the event's top-level location", async () => {
    const h = harness()
    await h.set()
    h.route({ id: "move-top", type: "session.moved", location: { directory: NEW_DIR }, data: { sessionID: SID } })
    await flush()
    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
  })

  test("a move for one session never touches another session's goal", async () => {
    const h = harness()
    await h.set(SID, "session one goal")
    await h.set(OTHER, "session two goal")
    h.route({ id: "move-one", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()
    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
    expect(h.controller.get(OTHER)!.directory).toBe(OLD_DIR)
  })

  test("a repeated or malformed move is a no-op", async () => {
    const h = harness()
    await h.set()
    h.route({ id: "move-a", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()
    const writes = h.storage.writes.length
    const changes = h.changes.length
    const logs = h.logs.length

    h.route({ id: "move-b", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    h.route({ id: "move-c", type: "session.moved", data: { location: { directory: "/work/no-session" } } })
    h.route({ id: "move-d", type: "session.moved", data: { sessionID: SID } })
    h.route({ id: "move-a", type: "session.moved", data: { sessionID: SID, location: { directory: "/work/replayed" } } })
    await flush()

    expect(h.storage.writes.length).toBe(writes)
    expect(h.changes.length).toBe(changes)
    expect(h.logs.length).toBe(logs)
    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
  })

  test("a late event with an older host sequence cannot move the goal back", async () => {
    const h = harness()
    await h.set()
    h.route({ id: "m-new", type: "session.moved", durable: { seq: 10 }, data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()
    h.route({ id: "m-old", type: "session.moved", durable: { seq: 9 }, data: { sessionID: SID, location: { directory: OLD_DIR } } })
    h.route({ id: "g-old", type: "session.execution.started", durable: { seq: 8 }, location: { directory: OLD_DIR }, data: { sessionID: SID } })
    await flush()
    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
  })

  test("a sequence-less generic report cannot undo an explicit move", async () => {
    const h = harness()
    await h.set()
    h.route({ id: "explicit", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()
    h.route({ id: "generic", type: "session.execution.started", location: { directory: OLD_DIR }, data: { sessionID: SID } })
    await flush()
    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
  })

  test("any location-bearing event reconciles a goal when session.moved is missed", async () => {
    const h = harness()
    await h.set()
    h.route({ id: "beat-1", type: "session.execution.started", location: { directory: NEW_DIR }, data: { sessionID: SID } })
    await flush()
    expect(h.controller.get(SID)!.directory).toBe(NEW_DIR)
    expect(h.logs.some((l) => l.message === "goal directory reconciled from session event")).toBe(true)
  })

  test("arming a replacement in the moved session records the new directory and re-resolves the commit rule", async () => {
    const movedCommit: CommitPolicy = { required: true, branch: "release/moved", mode: "coordinator", reason: "new repo" }
    const h = harness({}, { commitFor: (dir) => (dir === NEW_DIR ? movedCommit : commit) })
    h.route({ id: "pre-move", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await h.set()
    const record = h.controller.get(SID)!
    expect(record.directory).toBe(NEW_DIR)
    expect(h.prompts[0].text).toContain("`release/moved`")
  })

  test("deleting a session drops its directory override so a reused ID starts clean", async () => {
    const h = harness()
    await h.set()
    h.route({ id: "move-delete", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()
    h.controller.onSessionDeleted(SID)
    await h.set()
    expect(h.controller.get(SID)!.directory).toBe(OLD_DIR)
  })

  test("the evaluator rubric gets the session's moved commit rule", async () => {
    const movedCommit: CommitPolicy = { required: true, branch: "main", reason: "new repo" }
    const h = harness({}, { commitFor: (dir) => (dir === NEW_DIR ? movedCommit : commit) })
    h.route({ id: "move-eval", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await h.set()
    h.verdicts.push(met())
    await h.turn()
    expect(h.evaluationRequests[0]?.commit).toEqual(movedCommit)
  })

  test("a verify-gated met runs its command in the session's new directory", async () => {
    const h = harness({ evaluator: { verifyCommand: "true" } }, { withVerifier: true })
    await h.set()
    h.route({ id: "move-v", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()
    h.verdicts.push(met())
    await h.turn()

    expect(h.verifyCalls).toEqual([expect.objectContaining({ cwd: NEW_DIR })])
  })

  test("read surfaces follow the move; a reload in the new directory restores the goal", async () => {
    const h = harness()
    await h.set()
    h.route({ id: "move-read", type: "session.moved", data: { sessionID: SID, location: { directory: NEW_DIR } } })
    await flush()

    expect((await h.controller.peekSnapshot(SID))!.directory).toBe(NEW_DIR)
    expect((await h.controller.peekList()).map((s) => s.sessionID)).toContain(SID)
    expect(await h.store.loadLive(OLD_DIR)).toHaveLength(0)
    expect(await h.store.loadLive(NEW_DIR)).toHaveLength(1)

    // A fresh plugin in the new directory adopts the moved record; one in the old directory does not.
    const store = new GoalStore(h.storage, () => {})
    const fresh = (directory: string) => new GoalController({
      config: resolveConfig({ learning: { enabled: false } }),
      directory,
      commit,
      clock: new FakeClock(),
      log: { info() {}, warn() {}, error() {} },
      store,
      session: {
        prompt: async () => {}, synthetic: async () => {}, usage: async () => undefined, compact: async () => {},
      },
      evaluator: { evaluate: async () => { throw new Error("no evaluation expected") } },
      background: { busy: async () => ({ subagents: 0, shells: 0 }) },
      emitter: { changed: () => {}, notice: () => {} },
    })
    const inNew = fresh(NEW_DIR)
    await inNew.restore({ resume: false })
    expect(inNew.get(SID)!.directory).toBe(NEW_DIR)

    const inOld = fresh(OLD_DIR)
    await inOld.restore({ resume: false })
    expect(inOld.get(SID)).toBeUndefined()
  })
})
