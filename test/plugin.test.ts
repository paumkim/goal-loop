import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../index.ts"

/** A throwaway git repository with a `dev` branch. */
function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), "goal-plugin-"))
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
  const git = join(dir, ".git")
  mkdirSync(join(git, "refs", "heads"), { recursive: true })
  writeFileSync(join(git, "refs", "heads", "dev"), "0".repeat(40))
  writeFileSync(join(git, "HEAD"), "ref: refs/heads/dev\n")
  return dir
}
/** A throwaway git repository that ships the coordinator package, i.e. a coordinator repository. */
function coordinatorRepository(): string {
  const dir = repository()
  mkdirSync(join(dir, "packages/coordinator/bin"), { recursive: true })
  writeFileSync(join(dir, "packages/coordinator/bin/coordinator"), "#!/bin/sh\n")
  return dir
}

/**
 * A stand-in for the OpenCode plugin context.
 *
 * Only the parts the plugin touches are implemented, and every call is recorded so the test can assert on what
 * the plugin asked the host to do.
 */
function context(directory: string, options: Record<string, unknown> = {}) {
  const calls = { prompts: [] as any[], commands: [] as any[], notices: [] as any[] }
  const hooks: Record<string, (event: any) => any> = {}
  const storage = new Map<string, unknown>()
  const ctx = {
    options,
    location: { directory },
    session: {
      prompt: async (input: any) => void calls.prompts.push(input),
      synthetic: async (input: any) => void calls.prompts.push(input),
      get: async () => ({ id: "ses_1", parentID: undefined, tokens: {} }),
      compact: async () => ({}),
      context: async () => [],
      hook: async (name: string, callback: (event: any) => any) => void (hooks[name] = callback),
    },
    generate: { text: async () => ({ text: "{}" }) },
    rpc: {
      register: async () => ({ events: { emit: async (name: string, payload: any) => void calls.notices.push({ name, ...payload }) } }),
    },
    command: {
      transform: async (fn: (editor: any) => void) => fn({ add: (command: any) => calls.commands.push(command) }),
    },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => void storage.set(key, value),
      remove: async (key: string) => void storage.delete(key),
      scan: async () => ({ entries: [] }),
    },
    event: {
      subscribe: async function* () {
        // Nothing to report; the plugin's event pump keeps waiting.
      },
    },
  }
  return { ctx, calls, hooks, storage }
}

describe("the /goal-loop-<N> directive in a plain prompt", () => {
  const promptEvent = (text: string) => ({
    sessionID: "ses_1",
    messageID: "msg_1",
    prompt: { text },
    metadata: {},
    delivery: "steer",
  })

  test("/goal-loop-188 arms the loop with maxLoops 188 for this run only", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop-188 fix the whole release pipeline")
      await hooks.prompt!(event)
      // The admitted message is the directive with the token and count stripped from the objective.
      expect(event.prompt.text).toContain('iteration="1" max="188"')
      expect(event.prompt.text).toContain("fix the whole release pipeline")
      expect(event.prompt.text).not.toContain("/goal-loop-188")
      const stored = storage.get("goal/v1/ses_1") as any
      expect(stored.loopMaxLoops).toBe(188)
      expect(stored.loopEnabled).toBe(true)
      expect(stored.condition).toBe("fix the whole release pipeline")
      // One info toast announces the armed loop with the effective limit.
      const set = calls.notices.find((n: any) => n.kind === "set")
      expect(set?.message).toContain('max="188"')
    } finally {
      await dispose?.()
    }
  })

  test("/goal-loop=3 sets maxLoops 3", async () => {
    const directory = repository()
    const { ctx, hooks, storage } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop=3 audit the TUI")
      await hooks.prompt!(event)
      const stored = storage.get("goal/v1/ses_1") as any
      expect(stored.loopMaxLoops).toBe(3)
      expect(event.prompt.text).toContain('max="3"')
    } finally {
      await dispose?.()
    }
  })

  test("/goal-loop-abc is stated invalid and falls back to the configured default", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop-abc fix it")
      await hooks.prompt!(event)
      const stored = storage.get("goal/v1/ses_1") as any
      expect(stored.loopMaxLoops).toBe(5)
      expect(stored.condition).toBe("fix it")
      expect(event.prompt.text).toContain('max="5"')
      const warning = calls.notices.find((n: any) => /Loop count ignored/.test(n.title))
      expect(warning).toBeDefined()
    } finally {
      await dispose?.()
    }
  })

  test("/goal-loop-0 and /goal-loop-1001 are out of range: stated, not clamped", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      for (const bad of ["/goal-loop-0 fix it", "/goal-loop-1001 fix it"]) {
        storage.clear()
        const event = promptEvent(bad)
        await hooks.prompt!(event)
        const stored = storage.get("goal/v1/ses_1") as any
        expect(stored.loopMaxLoops).toBe(5)
      }
      expect(calls.notices.filter((n: any) => /Loop count ignored/.test(n.title)).length).toBe(2)
    } finally {
      await dispose?.()
    }
  })

  test("/goal-loop with no count keeps the objective text untouched (the 12 stays)", async () => {
    const directory = repository()
    const { ctx, hooks, storage } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop investigate the 12 failing tests")
      await hooks.prompt!(event)
      const stored = storage.get("goal/v1/ses_1") as any
      expect(stored.loopMaxLoops).toBe(5)
      expect(stored.condition).toBe("investigate the 12 failing tests")
    } finally {
      await dispose?.()
    }
  })

  test("/goal <objective> is not a loop directive and passes through untouched", async () => {
    const directory = repository()
    const { ctx, hooks, storage } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal all tests pass")
      await hooks.prompt!(event)
      expect(event.prompt.text).toBe("/goal all tests pass")
      expect(storage.get("goal/v1/ses_1")).toBeUndefined()
    } finally {
      await dispose?.()
    }
  })

  test("an objective longer than maxConditionChars is rejected, nothing armed, prompt untouched", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory, { maxConditionChars: 100 })
    const dispose = await (plugin as any).setup(ctx)
    try {
      const original = "/goal-loop-5 " + "this objective is far too long for the configured hundred character limit and keeps going " + "x".repeat(40)
      const event = promptEvent(original)
      await hooks.prompt!(event)
      // The prompt is left untouched; no goal is armed.
      expect(event.prompt.text).toBe(original)
      expect(storage.get("goal/v1/ses_1")).toBeUndefined()
      const error = calls.notices.find((n: any) => n.title === "Loop not set")
      expect(error?.level).toBe("error")
      expect(error?.message).toContain("100")
    } finally {
      await dispose?.()
    }
  })

  test("an astral-heavy objective is measured in code points: admitted at the code-point limit", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory, { maxConditionChars: 5 })
    const dispose = await (plugin as any).setup(ctx)
    try {
      // 5 code points (10 UTF-16 units): at the limit, not over it.
      const event = promptEvent("/goal-loop 🎉🎉🎉🎉🎉")
      expect("🎉🎉🎉🎉🎉".length).toBe(10)
      await hooks.prompt!(event)
      // Admitted: the loop is armed and the prompt carries the objective; no "Loop not set" toast.
      expect(event.prompt.text).toContain("🎉🎉🎉🎉🎉")
      const stored = storage.get("goal/v1/ses_1") as any
      expect(stored?.loopEnabled).toBe(true)
      expect(stored?.condition).toBe("🎉🎉🎉🎉🎉")
      expect(calls.notices.find((n: any) => n.title === "Loop not set")).toBeUndefined()
    } finally {
      await dispose?.()
    }
  })

  test("an invalid count whose suffix carries control bytes is sanitized in the toast", async () => {
    const directory = repository()
    const { ctx, hooks, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop-\u001b[2Jabc fix it")
      await hooks.prompt!(event)
      const warning = calls.notices.find((n: any) => /Loop count ignored/.test(n.title))
      expect(warning).toBeDefined()
      for (const ch of warning.message as string) expect(ch.charCodeAt(0)).toBeGreaterThanOrEqual(32)
    } finally {
      await dispose?.()
    }
  })

  test("a bare directive with an empty count (/goal-loop-) warns instead of echoing empty quotes", async () => {
    const directory = repository()
    const { ctx, hooks, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop- fix it")
      await hooks.prompt!(event)
      const warning = calls.notices.find((n: any) => /Loop count ignored/.test(n.title))
      expect(warning?.message).toContain("nothing was provided")
    } finally {
      await dispose?.()
    }
  })

  test("a bare /goal-loop-12 arms nothing, triggers an update check, and rewrites the admitted prompt", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop-12")
      await hooks.prompt!(event)
            expect(storage.get("goal/v1/ses_1")).toBeUndefined()
      expect(calls.notices.some((n: any) => n.title === "goal-loop update")).toBe(true)
      expect(event.prompt.text).toBe("A goal-loop update check was requested; acknowledge briefly and do not set a goal.")
      expect(event.prompt.text).not.toContain("/goal-loop")
    } finally {
      await dispose?.()
    }
  })

  test("a bare /goal-loop arms nothing, triggers an update check, and rewrites the admitted prompt", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop")
      await hooks.prompt!(event)
      expect(storage.get("goal/v1/ses_1")).toBeUndefined()
      expect(calls.notices.some((n: any) => n.title === "goal-loop update")).toBe(true)
      expect(event.prompt.text).toBe("A goal-loop update check was requested; acknowledge briefly and do not set a goal.")
      expect(event.prompt.text).not.toContain("/goal-loop")
    } finally {
      await dispose?.()
    }
  })

  test("a bare /goal-loop-3 arms nothing, triggers an update check, and rewrites the admitted prompt", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop-3")
      await hooks.prompt!(event)
            expect(storage.get("goal/v1/ses_1")).toBeUndefined()
      expect(calls.notices.some((n: any) => n.title === "goal-loop update")).toBe(true)
      expect(event.prompt.text).toBe("A goal-loop update check was requested; acknowledge briefly and do not set a goal.")
      expect(event.prompt.text).not.toContain("/goal-loop")
    } finally {
      await dispose?.()
    }
  })

  test("update.mode off restores the status-only bare directive", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory, { update: { channel: "dev", mode: "off" } })
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop")
      await hooks.prompt!(event)
      expect(storage.get("goal/v1/ses_1")).toBeUndefined()
      expect(calls.notices.some((n: any) => n.kind === "status")).toBe(true)
      expect(calls.notices.some((n: any) => n.title === "goal-loop update")).toBe(false)
      expect(event.prompt.text).toBe("Show the current goal loop status.")
    } finally {
      await dispose?.()
    }
  })

  test("a bare /goal-loop with an invalid count reports the count, triggers an update check, and rewrites the admitted prompt", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop-abc")
      await hooks.prompt!(event)
      expect(storage.get("goal/v1/ses_1")).toBeUndefined()
      expect(calls.notices.some((n: any) => /Loop count ignored/.test(n.title))).toBe(true)
      expect(calls.notices.some((n: any) => n.title === "goal-loop update")).toBe(true)
      expect(event.prompt.text).toBe("A goal-loop update check was requested; acknowledge briefly and do not set a goal.")
      expect(event.prompt.text).not.toContain("/goal-loop")
    } finally {
      await dispose?.()
    }
  })
})

describe("plugin setup", () => {
  test("a fresh coordinator repository resolves to the coordinator flow on first /goal", async () => {
    // First-run bootstrap creates .term/coordinator, so a fresh coordinator repo is coordinator-detected.
    const directory = coordinatorRepository()
    const { ctx, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      expect(calls.commands.map((command) => command.name)).toContain("goal")
      expect(existsSync(join(directory, ".term/coordinator/config.json"))).toBe(true)
      expect(existsSync(join(directory, ".term/coordinator/state.json"))).toBe(true)
      const goal = calls.commands.find((command) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "all tests pass" }, delivery: "steer" })
      const directive = calls.prompts.at(-1)
      expect(directive.text).toContain("all tests pass")
      expect(directive.text).toContain("Coordinator repo")
      expect(directive.text).toContain("wt/<slug>")
      expect(directive.text).toContain("submit")
      expect(directive.text).toContain("dev")
    } finally {
      await dispose?.()
    }
  })

  test("a plain git repository receives the startup scaffold and coordinator flow is ready", async () => {
    const directory = repository()
    const { ctx, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      expect(existsSync(join(directory, ".term/coordinator/config.json"))).toBe(true)
      expect(existsSync(join(directory, ".term/coordinator/state.json"))).toBe(true)
      expect(existsSync(join(directory, "worktrees"))).toBe(true)
      expect(existsSync(join(directory, ".term/goal-loop"))).toBe(true)
      expect(existsSync(join(directory, "SPEC.md"))).toBe(true)
      expect(existsSync(join(directory, "MAINTAINER.md"))).toBe(true)
      expect(existsSync(join(directory, "docs/README.md"))).toBe(true)
      expect(readFileSync(join(directory, ".gitignore"), "utf8")).toContain(".term/goal-loop/")
      const goal = calls.commands.find((command) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "all tests pass" }, delivery: "steer" })
      const directive = calls.prompts.at(-1)
      expect(directive.text).toContain("all tests pass")
      expect(directive.text).toContain("Coordinator repo")
    } finally {
      await dispose?.()
    }
  })
  test("no commit rule outside a git repository", async () => {
    const directory = mkdtempSync(join(tmpdir(), "goal-plain-"))
    process.on("exit", () => rmSync(directory, { recursive: true, force: true }))
    const { ctx, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "all tests pass" }, delivery: "steer" })
      expect(calls.prompts.at(-1).text).not.toContain("commit")
    } finally {
      await dispose?.()
    }
  })
})

describe("the context hook strips end-of-record notes", () => {
  const noteMessage = (text: string) => ({ role: "user", content: [{ type: "text", text }] })

  test("goal notes of either kind are removed; everything else survives in order", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const keep1 = noteMessage("real user task")
      const terminal = noteMessage("<goal-note final>\nGoal achieved (turn 1, 7m 21s).\ndone\n</goal-note>")
      const keep2 = noteMessage("<goal-note>\nLoop 1 of 3 achieved (turn 9); goal v2 armed.\nv2 armed\n</goal-note>")
      const event = { sessionID: "ses_1", agent: "build", model: {}, system: [], messages: [keep1, terminal, keep2], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.messages).toEqual([keep1])
    } finally {
      await dispose?.()
    }
  })

  test("messages without terminal notes pass through untouched (same contents, same order)", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const keep1 = noteMessage("alpha")
      const keep2 = noteMessage("beta")
      const event = { sessionID: "ses_1", agent: "build", model: {}, system: [], messages: [keep1, keep2], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.messages).toEqual([keep1, keep2])
    } finally {
      await dispose?.()
    }
  })

  test("a compaction checkpoint survives the terminal strip — it is history, not goal grammar", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const checkpoint = noteMessage(
        [
          "<conversation-checkpoint>",
          "<summary>\nworked\n</summary>",
          "<recent-context>",
          "[User]: <goal>\nfinish the tree\n</goal>",
          "</recent-context>",
          "</conversation-checkpoint>",
        ].join("\n"),
      )
      const event = { sessionID: "ses_1", agent: "build", model: {}, system: [], messages: [checkpoint], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.messages).toEqual([checkpoint])
    } finally {
      await dispose?.()
    }
  })

  test("stripping never leaves the request without a trailing user turn", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const assistant = { role: "assistant", content: [{ type: "text", text: "working" }] }
      const continuation = noteMessage('<goal-continuation turn="2">\nThe goal is not met yet.')
      const event = { sessionID: "ses_1", agent: "build", model: {}, system: [], messages: [assistant, continuation], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.messages).toHaveLength(2)
      expect((event.messages.at(-1) as any).role).toBe("user")
      expect(event.messages.at(-1)).toBe(continuation)
    } finally {
      await dispose?.()
    }
  })
})

describe("the context hook drops the evaluator's own self-echo (CXV use-and-forget)", () => {
  const message = (text: string) => ({ role: "user", content: [{ type: "text", text }] })
  const evalPrompt = (turn: number) => `<goal-evaluation>\nStep out of the agent role. Turn ${turn}.\nDo not call tools.\n</goal-evaluation>`

  test("a working turn keeps real evidence but not prior <goal-evaluation> prompts", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const steer = message("the user's own line")
      const evidence = message("fresh evidence: bun run check green")
      const event = {
        sessionID: "ses_1", agent: "build", model: {}, system: [] as any[],
        messages: [message(evalPrompt(1)), evidence, message(evalPrompt(2)), steer], tools: {}, options: {},
      }
      hooks.context!(event)
      expect(event.messages).toEqual([evidence, steer])
    } finally {
      await dispose?.()
    }
  })

  test("the trailing-user repair never re-adds a stripped evaluation prompt", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const assistant = { role: "assistant", content: [{ type: "text", text: "working" }] }
      const steer = message("continue with the fix")
      const event = {
        sessionID: "ses_1", agent: "build", model: {}, system: [] as any[],
        messages: [assistant, message(evalPrompt(1)), steer], tools: {}, options: {},
      }
      hooks.context!(event)
      expect(event.messages).toEqual([assistant, steer])
      expect((event.messages.at(-1) as any).role).toBe("user")
    } finally {
      await dispose?.()
    }
  })

  test("a compaction checkpoint quoting an evaluation prompt survives as history", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const checkpoint = message(
        ["<conversation-checkpoint>", "<summary>worked</summary>", "<recent-context>", `[User]: ${evalPrompt(1)}`, "</recent-context>", "</conversation-checkpoint>"].join("\n"),
      )
      const event = { sessionID: "ses_1", agent: "build", model: {}, system: [] as any[], messages: [checkpoint], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.messages).toEqual([checkpoint])
    } finally {
      await dispose?.()
    }
  })

  test("the independent digest feed carries evidence, never the evaluator's own prompts", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory, { model: "provider/model", evaluator: { mode: "independent" } })
    // host-shaped context as renderTranscript sees it: two self-talk prompts around real evidence.
    const feed = [
      { type: "user", text: evalPrompt(1) },
      { type: "user", text: "fresh evidence: bun run check green at current HEAD" },
      { type: "user", text: evalPrompt(2) },
    ]
    ;(ctx.session as any).context = async () => feed
    const prompts: string[] = []
    ;(ctx.generate as any).text = async ({ prompt }: any) => {
      prompts.push(prompt)
      return { text: '{"verdict":"met","reason":"done"}' }
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      for (let i = 0; i < 500 && (storage.get("goal/v1/ses_1") as any)?.status !== "achieved"; i++) {
        await new Promise((r) => setImmediate(r))
      }
      expect((storage.get("goal/v1/ses_1") as any)?.status).toBe("achieved")
      const digestPrompt = prompts.find((p) => p.includes("<transcript>"))
      expect(digestPrompt).toBeDefined()
      expect(digestPrompt).toContain("fresh evidence: bun run check green at current HEAD")
      expect(digestPrompt).not.toContain("<goal-evaluation>")
      expect(digestPrompt).not.toContain("Step out of the agent role")
    } finally {
      await dispose?.()
    }
  })
})

describe("prompt-hook arming refusal restores the user's own line (XLV, XLVI pin)", () => {
  const promptEvent = (text: string) => ({
    sessionID: "ses_1",
    messageID: "msg_1",
    prompt: { text },
    metadata: {},
    delivery: "steer",
  })

  test("a /goal-loop whose objective near-duplicates the session's durable completed-condition ledger is refused; the admitted message is the user's raw line, not the directive", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    // A prior loop for this session completed and its ledger was persisted (iteration 1's condition == objective).
    storage.set("goal/v1/ses_1", {
      version: 1,
      id: "goal_prior",
      sessionID: "ses_1",
      directory,
      condition: "investigate the 12 failing tests",
      status: "achieved",
      setAt: 1_000_000,
      startedAt: 1_000_000,
      endedAt: 2_000_000,
      reason: "Loop complete after 1 iteration.",
      turns: 3,
      stall: 0,
      retries: 0,
      checkins: 0,
      baseline: { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      history: [],
      loopEnabled: true,
      loopIteration: 2,
      loopObjective: "investigate the 12 failing tests",
      loopMaxLoops: 5,
      loopHistory: [{ version: 1, condition: "investigate the 12 failing tests", summary: "fixed", reason: "met", turns: 3, toolCalls: 12, endedAt: 2_000_000 }],
      completedConditions: ["investigate the 12 failing tests"],
    })
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop investigate the 12 failing tests")
      await hooks.prompt!(event)
      // The admitted message is restored to the user's raw line — never the armed-loop directive.
      expect(event.prompt.text).toBe("/goal-loop investigate the 12 failing tests")
      expect(event.prompt.text).not.toContain("iteration=")
      // The persisted record is the refusal: terminal, with the explicit no-new-gap reason, ledger carried forward.
      const stored = storage.get("goal/v1/ses_1") as any
      expect(stored.status).toBe("achieved")
      expect(stored.reason).toContain("no new gap")
      expect(stored.loopNotProgress).toBe(1)
      expect(stored.completedConditions).toContain("investigate the 12 failing tests")
      // One warning toast on the loop channel names the refusal.
      const toast = calls.notices.find((n: any) => n.kind === "loop")
      expect(toast?.title).toBe("Loop not armed: no new gap")
    } finally {
      await dispose?.()
    }
  })
})

describe("a terminal goal is inert in later context (LXVII)", () => {
  const message = (text: string) => ({ role: "user", content: [{ type: "text", text }] })

  test("no live goal: goal-grammar messages leave context, and the terminal line rides only a request that still carries goal text", async () => {
    const directory = repository()
    const { ctx, calls, hooks, storage } = context(directory)
    // Deliver one full turn (started -> tool -> succeeded) through the event pump once the arm lands;
    // the mocked evaluator rules the goal met, so the record finishes in memory during this test.
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
      },
    }
    ;(ctx.session as any).generate = async () => ({ text: '{"verdict":"met","reason":"done"}' })
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      for (let i = 0; i < 500 && (storage.get("goal/v1/ses_1") as any)?.status !== "achieved"; i++) {
        await new Promise((r) => setImmediate(r))
      }
      expect((storage.get("goal/v1/ses_1") as any)?.status).toBe("achieved")
      const event = {
        sessionID: "ses_1",
        agent: "build",
        model: {},
        system: [] as any[],
        messages: [message("<goal>\nthe parser is correct\n</goal>"), message("the user's own line")],
        tools: {},
        options: {},
      }
      hooks.context!(event)
      expect(event.messages).toEqual([message("the user's own line")])
      // Nothing goal-shaped survives, so the counter-instruction has nothing to counter: no session-long
      // stale system line on every later request.
      expect(event.system.some((part: any) => typeof part?.text === "string" && part.text.includes("Do not resume work toward it"))).toBe(false)
      // A compaction checkpoint that quotes the expired `<goal>` kickoff is the one shape stripping keeps,
      // so the terminal line still rides that request.
      const checkpoint = message(
        ["<conversation-checkpoint>", "<summary>worked</summary>", "<recent-context>", "[User]: <goal>", "the parser is correct", "</goal>", "</recent-context>", "</conversation-checkpoint>"].join("\n"),
      )
      const quoting = { sessionID: "ses_1", agent: "build", model: {}, system: [] as any[], messages: [checkpoint], tools: {}, options: {} }
      hooks.context!(quoting)
      expect(quoting.messages).toEqual([checkpoint])
      expect(quoting.system.some((part: any) => typeof part?.text === "string" && part.text.includes("Do not resume work toward it"))).toBe(true)
    } finally {
      await dispose?.()
    }
  })

  test("a live goal keeps its instruction messages and gets no terminal line", async () => {
    const directory = repository()
    const { ctx, calls, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      const kickoff = message("<goal>\nthe parser is correct\n</goal>")
      const event = { sessionID: "ses_1", agent: "build", model: {}, system: [] as any[], messages: [kickoff], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.messages).toEqual([kickoff])
      expect(event.system.some((part: any) => typeof part?.text === "string" && part.text.includes("Do not resume work toward it"))).toBe(false)
    } finally {
      await dispose?.()
    }
  })

  test("no goal has ever been set: goal-grammar messages are dropped and nothing is injected", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const kickoff = message("<goal>\nthe parser is correct\n</goal>")
      const keep = message("hello")
      const event = { sessionID: "ses_1", agent: "build", model: {}, system: [] as any[], messages: [kickoff, keep], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.messages).toEqual([keep])
      expect(event.system).toHaveLength(0)
    } finally {
      await dispose?.()
    }
  })
})

describe("the generate hook makes evaluator replies text-only (empty-verdict root cause)", () => {
  test("tools are removed and output bounded only while a session evaluation is in flight", async () => {
    const directory = repository()
    const { ctx, calls, hooks, storage } = context(directory)
    let release!: (text: string) => void
    let onGenerate!: () => void
    const called = new Promise<void>((resolve) => (onGenerate = resolve))
    // A pending judge reply: the evaluation stays in flight so the hook can be inspected mid-request.
    // The real port reads `.text` off the host result, so return that shape.
    ;(ctx.session as any).generate = async () => {
      onGenerate()
      const text = await new Promise<string>((resolve) => (release = resolve))
      return { text }
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await called // the evaluator's session.generate is pending; isEvaluating(SID) is true

      const buildEvent = () => ({
        sessionID: "ses_1",
        agent: "build",
        model: {},
        system: [] as any[],
        messages: [] as any[],
        tools: { read: { description: "read", input: {} }, write: { description: "write", input: {} } } as any,
        options: {} as any,
      })
      const during = buildEvent()
      hooks.generate!(during)
      expect(Object.keys(during.tools)).toEqual([]) // no tool call can produce an empty text verdict
      expect(during.options.maxTokens).toBeGreaterThan(0)

      release('{"verdict":"met","reason":"done"}')
      for (let i = 0; i < 500 && (storage.get("goal/v1/ses_1") as any)?.status !== "achieved"; i++) {
        await new Promise((r) => setImmediate(r))
      }
      expect((storage.get("goal/v1/ses_1") as any)?.status).toBe("achieved")

      const after = buildEvent()
      hooks.generate!(after)
      expect(Object.keys(after.tools)).toEqual(["read", "write"]) // ordinary turns keep their tools
      expect(after.options.maxTokens).toBeUndefined()
    } finally {
      await dispose?.()
    }
  })
})
