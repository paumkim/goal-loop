import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../index.ts"
import { EVALUATOR_AGENT_ID, EVALUATOR_SYSTEM_PROMPT } from "../src/core/evaluator-agent.ts"
import { PLANNER_AGENT_ID } from "../src/core/planner.ts"

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
/** A throwaway git repository whose only branch is `branch` (HEAD points there). */
function repositoryWithBranch(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), "goal-plugin-moved-"))
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
  const git = join(dir, ".git")
  mkdirSync(join(git, "refs", "heads"), { recursive: true })
  writeFileSync(join(git, "refs", "heads", branch), "0".repeat(40))
  writeFileSync(join(git, "HEAD"), `ref: refs/heads/${branch}\n`)
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
  const calls = { prompts: [] as any[], commands: [] as any[], notices: [] as any[], agents: [] as any[], tools: [] as any[], compacts: [] as string[] }
  const hooks: Record<string, (event: any) => any> = {}
  const storage = new Map<string, unknown>()
  /** Tests can map a session id to its parent to exercise session-tagged message routing. */
  const sessionParents = new Map<string, string>()
  const ctx = {
    options,
    location: { directory },
    agent: {
      transform: async (fn: (editor: any) => void) => fn({
        update: (id: string, update: (agent: any) => void) => {
          const agent: any = { id, name: "", description: "", mode: "primary", hidden: false, permissions: [] }
          update(agent)
          calls.agents.push(agent)
        },
      }),
    },
    session: {
      prompt: async (input: any) => void calls.prompts.push(input),
      synthetic: async (input: any) => void calls.prompts.push(input),
      get: async (input: any) => {
        const id = typeof input?.sessionID === "string" ? input.sessionID : "ses_1"
        return { id, parentID: sessionParents.get(id), tokens: {} }
      },
      compact: async (input: any) => void calls.compacts.push(input.sessionID),
      context: async () => [],
      hook: async (name: string, callback: (event: any) => any) => void (hooks[name] = callback),
    },
    rpc: {
      register: async () => ({ events: { emit: async (name: string, payload: any) => void calls.notices.push({ name, ...payload }) } }),
    },
    command: {
      transform: async (fn: (editor: any) => void) => fn({ add: (command: any) => calls.commands.push(command) }),
    },
    tool: {
      transform: async (fn: (editor: any) => void) => fn({
        add: (tool: any) => calls.tools.push(tool),
        update: () => {},
        remove: () => {},
        list: () => calls.tools,
        namespace: () => {},
      }),
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
  return { ctx, calls, hooks, storage, sessionParents }
}

/**
 * The verdict JSON a harness-owned parent-linked judge child emits. Every current test arms "the parser is correct";
 * tests that need a different echo (or an unreadable body) pass `echo` / `body` explicitly.
 */
function judgeVerdict(options: { verdict?: "met" | "not_met"; reason?: string; body?: string; echo?: string } = {}) {
  return options.body ?? JSON.stringify({
    verdict: options.verdict ?? "met",
    reason: options.reason ?? "done",
    condition: options.echo ?? "the parser is correct",
  })
}

/** A host context message carrying real evidence so the harness builds a non-empty judge summary. */
function evidence(text: string) {
  return { type: "user", text, content: [{ type: "text", text }] }
}

/** Wait on wall-clock time: the judge child and its 250ms evidence-settle window are asynchronous. */
async function waitFor(predicate: () => boolean, timeoutMs = 6_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until && !predicate()) await new Promise((r) => setTimeout(r, 20))
}

describe("commit rules follow a session move", () => {
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
  }

  test("the system reminder uses the moved checkout's rule while the planned directive stays minimal", async () => {
    const setupDir = repository() // only `dev` exists here
    const movedDir = repositoryWithBranch("release") // config still says `dev`, so the rule falls back to `release`
    const { ctx, hooks } = context(setupDir, { systemReminder: true })
    ;(ctx as any).event = {
      subscribe: async function* () {
        yield { id: "move-1", type: "session.moved", data: { sessionID: "ses_1", location: { directory: movedDir } } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      await flush() // let the event pump route the move before the hooks render anything
      const promptEvent = {
        sessionID: "ses_1",
        messageID: "msg_1",
        prompt: { text: "/goal-loop 3 audit the parser" },
        metadata: {},
        delivery: "steer",
      }
      await hooks.prompt!(promptEvent)
      expect(promptEvent.prompt.text).toContain("audit the parser")
      expect(promptEvent.prompt.text).not.toContain("`dev`")
      expect(promptEvent.prompt.text).not.toContain("`release`")

      const contextEvent = { sessionID: "ses_1", agent: "build", model: {}, system: [], messages: [], tools: {}, options: {} }
      hooks.context!(contextEvent)
      const reminder = contextEvent.system.map((entry: any) => entry.text).join("\n")
      expect(reminder).toContain("`release`")
      expect(reminder).not.toContain("`dev`")
    } finally {
      await dispose?.()
    }
  })
})

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

  test("/goal-loop clear clears instead of arming a loop whose objective is 'clear'", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      // The registered-command path classifies clear aliases via parseGoalCommand. A raw directive line must
      // classify them the same way; otherwise `/goal-loop clear` armed a bogus "clear" loop.
      for (const text of ["/goal-loop clear", "/goal-loop-3 stop", "/goal-loop=2 cancel"]) {
        storage.clear()
        const event = promptEvent(text)
        await hooks.prompt!(event)
        expect(storage.get("goal/v1/ses_1")).toBeUndefined()
        expect(event.prompt.text).not.toContain("/goal-loop")
        expect(calls.notices.some((n: any) => n.title === "No goal set" || n.title === "Goal cleared")).toBe(true)
      }
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
      expect(directive.text).not.toContain("Coordinator repo")
      expect(directive.text).not.toContain("wt/<slug>")
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
      expect(existsSync(join(directory, "worktree"))).toBe(true)
      expect(existsSync(join(directory, ".term/goal-loop"))).toBe(true)
      expect(existsSync(join(directory, "SPEC.md"))).toBe(true)
      expect(existsSync(join(directory, "MAINTAINER.md"))).toBe(true)
      expect(existsSync(join(directory, "docs/README.md"))).toBe(true)
      expect(readFileSync(join(directory, ".gitignore"), "utf8")).toContain(".term/goal-loop/")
      const goal = calls.commands.find((command) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "all tests pass" }, delivery: "steer" })
      const directive = calls.prompts.at(-1)
      expect(directive.text).toContain("all tests pass")
      expect(directive.text).not.toContain("Coordinator repo")
    } finally {
      await dispose?.()
    }
  })
  test("bootstrap from a subfolder creates .term only at the repository root", async () => {
    const root = repository()
    const docs = join(root, "docs")
    mkdirSync(docs, { recursive: true })
    // OpenCode was launched from docs/, so the host reports the subfolder as the location.
    const { ctx, calls } = context(docs)
    const dispose = await (plugin as any).setup(ctx)
    try {
      // Repo root gets the full scaffold.
      expect(existsSync(join(root, ".term/coordinator/config.json"))).toBe(true)
      expect(existsSync(join(root, ".term/coordinator/state.json"))).toBe(true)
      expect(existsSync(join(root, ".term/goal-loop"))).toBe(true)
      expect(existsSync(join(root, "worktree"))).toBe(true)
      // The launch subfolder must never receive its own .term or worktree/.
      expect(existsSync(join(docs, ".term"))).toBe(false)
      expect(existsSync(join(docs, "worktree"))).toBe(false)
      expect(existsSync(join(docs, "SPEC.md"))).toBe(false)
      // The commit rule still resolves the coordinator at the repo root, not the subfolder.
      const goal = calls.commands.find((command) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "all tests pass" }, delivery: "steer" })
      expect(calls.prompts.at(-1).text).toContain("all tests pass")
      expect(calls.prompts.at(-1).text).not.toContain("Coordinator repo")
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

describe("the judge child's system prefix (CXXXVIII, opencode free gate)", () => {
  const systemParts = () => [
    { type: "text", text: "Project rules from AGENTS.md: dogfood, dev branch, merge to main." },
    { type: "text", text: "# Your Model\n- Name: Hy4 flash Free\n- Provider ID: opencode\n- Model ID: hy4-flash-free" },
    { type: "text", text: EVALUATOR_SYSTEM_PROMPT },
    { type: "text", text: "SPEC.md: another goal about a TUI footer fix." },
  ]

  test("evaluator children keep only their identity on third-party providers", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = { sessionID: "ses_judge", agent: EVALUATOR_AGENT_ID, model: { providerID: "9router-go", id: "KiloCode-Free" }, system: systemParts(), messages: [], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.system).toHaveLength(1)
      expect((event.system[0] as any).text).toContain("You are the Evaluator")
      expect(JSON.stringify(event.system)).not.toContain("dogfood")
      expect(JSON.stringify(event.system)).not.toContain("TUI footer")
    } finally {
      await dispose?.()
    }
  })

  test("evaluator children keep the full host prefix on the opencode provider (free-tier gate)", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = { sessionID: "ses_judge", agent: EVALUATOR_AGENT_ID, model: { providerID: "opencode", id: "hy4-flash-free" }, system: systemParts(), messages: [], tools: {}, options: {} }
      hooks.context!(event)
      // A trimmed judge on opencode/hy4-flash-free was rejected in ~6ms with provider.free-limit 429.
      expect(event.system).toHaveLength(4)
      expect(JSON.stringify(event.system)).toContain("You are the Evaluator")
      expect(JSON.stringify(event.system)).toContain("# Your Model")
      expect(JSON.stringify(event.system)).toContain("dogfood")
      expect(JSON.stringify(event.system)).toContain("TUI footer")
    } finally {
      await dispose?.()
    }
  })

  test("worker sessions keep their project rules untouched", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = { sessionID: "ses_worker", agent: "build", model: {}, system: systemParts(), messages: [], tools: {}, options: {} }
      hooks.context!(event)
      // 4 host parts + the standing coordinator claim rule (every worker activation, not just armed goals).
      expect(event.system).toHaveLength(5)
      expect(JSON.stringify(event.system)).toContain("dogfood")
      expect(JSON.stringify(event.system)).toContain("Before editing: claim first")
    } finally {
      await dispose?.()
    }
  })
})

describe("the standing coordinator activation rule", () => {
  test("a worker in a coordinator repo gets the claim-before-edit flow with no goal and the reminder off", async () => {
    const directory = coordinatorRepository()
    const { ctx, hooks } = context(directory) // no /goal armed, systemReminder defaults off
    const dispose = await (plugin as any).setup(ctx)
    try {
      const activate = (sessionID: string) => {
        const event = { sessionID, agent: "build", model: {}, system: [] as any[], messages: [], tools: {}, options: {} }
        hooks.context!(event)
        return event.system.map((part: any) => part.text).join("\n")
      }
      const first = activate("ses_w1")
      expect(first).toContain("Coordinator repo. Before editing: claim first")
      expect(first).toContain("coordinator claim <goal-slug>")
      expect(first).toContain("work only there")
      expect(first).toContain("submit")
      expect(first).toContain("Never commit to dev/main directly.")
      // Not a one-shot: the same standing rule rides every later activation of the worker.
      expect(activate("ses_w1")).toBe(first)
    } finally {
      await dispose?.()
    }
  })

  test("judge and planner children never receive the standing worker rule", async () => {
    const directory = coordinatorRepository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      for (const agent of [EVALUATOR_AGENT_ID, PLANNER_AGENT_ID]) {
        const event = {
          sessionID: `ses_${agent}`,
          agent,
          model: { providerID: "opencode", id: "hy4-flash-free" },
          system: [] as any[],
          messages: [],
          tools: {},
          options: {},
        }
        hooks.context!(event)
        expect(JSON.stringify(event.system)).not.toContain("Before editing: claim first")
      }
    } finally {
      await dispose?.()
    }
  })

  test("a directory with no git repository gets no lease rule", async () => {
    const directory = mkdtempSync(join(tmpdir(), "goal-nogit-"))
    process.on("exit", () => rmSync(directory, { recursive: true, force: true }))
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = { sessionID: "ses_w", agent: "build", model: {}, system: [] as any[], messages: [], tools: {}, options: {} }
      hooks.context!(event)
      expect(event.system).toHaveLength(0)
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

  test("a host-delivered judge completion report never reaches the worker's model request", async () => {
    const directory = repository()
    const { ctx, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const steer = message("the user's own line")
      const report = {
        role: "user",
        type: "synthetic",
        metadata: { source: "subagent", childID: "ses_judge", agent: EVALUATOR_AGENT_ID, state: "completed" },
        content: [{ type: "text", text: '<subagent sessionID="ses_judge" state="completed" description="evaluator">{"verdict":"met","reason":"done"}</subagent>' }],
      }
      const event = {
        sessionID: "ses_1", agent: "build", model: {}, system: [] as any[],
        messages: [steer, report], tools: {}, options: {},
      }
      hooks.context!(event)
      // The verdict came from the judge's event stream; the report the host admits on wake is stripped, and the
      // trailing-user repair must not re-add it (CXLI position inversion).
      expect(event.messages).toEqual([steer])
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
    // Every verdict is now a harness-owned judge child; `consensus: 2` spawns a second one for the second vote,
    // and it is that child's prompt which carries the digest asserted below.
    const { ctx, calls, storage } = context(directory, { model: "provider/model", evaluator: { mode: "independent", consensus: 2 } })
    // host-shaped context as renderTranscript sees it: two self-talk prompts around real evidence. The judge's
    // own <goal-evaluation> prompts must never reach the digest.
    const feed = [
      { type: "user", text: evalPrompt(1) },
      evidence("fresh evidence: bun run check green at current HEAD"),
      { type: "user", text: evalPrompt(2) },
    ]
    ;(ctx.session as any).context = async () => feed
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    const prompts: string[] = []
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).remove = async () => {}
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID === "ses_judge") prompts.push(input.text)
      else void calls.prompts.push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: '{"verdict":"met","reason":"done"}' } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
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

describe("injected wakes never resume a paused goal", () => {
  const pausedRecord = (directory: string) => ({
    version: 1,
    id: "goal_paused",
    sessionID: "ses_1",
    directory,
    condition: "the parser is correct",
    status: "paused",
    setAt: 1_000_000,
    startedAt: 1_000_000,
    turns: 2,
    stall: 2,
    retries: 0,
    checkins: 0,
    baseline: { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    history: [],
    pauseCause: "stall",
    reason: "No progress: 2 turns in a row without tool use.",
  })
  const wake = (text: string, metadata: Record<string, unknown>) => ({
    sessionID: "ses_1",
    messageID: "msg_wake",
    prompt: { text },
    metadata,
    delivery: "steer",
  })

  test("child completion reports and synthetic wakes keep a paused goal paused; a real user prompt resumes it", async () => {
    const directory = repository()
    const { ctx, hooks, storage } = context(directory)
    storage.set("goal/v1/ses_1", pausedRecord(directory))
    // The mock store's scan() is empty by default; restore adopts live records through scan.
    ;(ctx.storage as any).scan = async () => ({ entries: [{ key: "goal/v1/ses_1", value: pausedRecord(directory) }] })
    const dispose = await (plugin as any).setup(ctx)
    // Restore is started without blocking setup; let it adopt the seeded paused record.
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
    try {
      const report = '<background-result kind="subagent" sessionID="ses_child" state="completed">work done</background-result>'
      await hooks.prompt!(wake(report, {}))
      expect((storage.get("goal/v1/ses_1") as any).status).toBe("paused")

      await hooks.prompt!(wake("Subagent completed without a text response", { source: "subagent", agent: "build", state: "completed" }))
      expect((storage.get("goal/v1/ses_1") as any).status).toBe("paused")

      const user = { sessionID: "ses_1", messageID: "msg_user", prompt: { text: "keep going" }, metadata: {}, delivery: "steer" }
      await hooks.prompt!(user)
      expect((storage.get("goal/v1/ses_1") as any).status).toBe("active")
      expect((storage.get("goal/v1/ses_1") as any).pauseCause).toBeUndefined()
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
    // the harness judge child rules the goal met, so the record finishes in memory here.
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).remove = async () => {}
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID !== "ses_judge") void calls.prompts.push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: '{"verdict":"met","reason":"done"}' } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
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
      // No goal-shaped system line, but the standing coordinator claim rule is present on every activation.
      expect(event.system).toHaveLength(1)
      expect((event.system[0] as any).text).toContain("Before editing: claim first")
    } finally {
      await dispose?.()
    }
  })
})

describe("host subagent reports cannot retrigger a finished goal", () => {
  const line = (text: string) => ({ role: "user", content: [{ type: "text", text }] })
  /** The shape the harness folds into context when a delegated child completes. */
  const report = (id: string, body = "done") =>
    line(`<background-result kind="subagent" sessionID="${id}" state="completed" description="evaluator">\n${body}\n</background-result>`)
  const contextEvent = (messages: any[]) => ({ sessionID: "ses_1", agent: "build", model: {}, system: [] as any[], messages, tools: {}, options: {} })
  const achieved = (directory: string) => ({
    version: 1,
    id: "goal_prior",
    sessionID: "ses_1",
    directory,
    condition: "the parser is correct",
    status: "achieved",
    setAt: 1_000_000,
    startedAt: 1_000_000,
    endedAt: 2_000_000,
    reason: "Loop complete after 1 iteration.",
    turns: 3,
    stall: 0,
    retries: 0,
    checkins: 0,
    baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    history: [],
  })

  test("terminal session: every injected subagent report is stripped from context", async () => {
    const directory = repository()
    const { ctx, hooks, storage } = context(directory)
    storage.set("goal/v1/ses_1", achieved(directory))
    const dispose = await (plugin as any).setup(ctx)
    try {
      const own = line("the user's own line")
      const event = contextEvent([own, report("ses_worker"), report("ses_worker_2", "another child")])
      hooks.context!(event)
      expect(event.messages).toEqual([own])
    } finally {
      await dispose?.()
    }
  })

  test("live session: a report is admitted on its first appearance", async () => {
    const directory = repository()
    const { ctx, calls, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      const own = line("the user's own line")
      const first = report("ses_worker")
      const event = contextEvent([own, first])
      hooks.context!(event)
      expect(event.messages).toEqual([own, first])
    } finally {
      await dispose?.()
    }
  })

  test("live session: a duplicate injection of the same report id is dropped", async () => {
    const directory = repository()
    const { ctx, calls, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      const own = line("the user's own line")
      const first = report("ses_worker")
      hooks.context!(contextEvent([own, first])) // admitted once
      const replay = contextEvent([own, first, report("ses_worker")]) // same id twice — both copies dropped now
      hooks.context!(replay)
      expect(replay.messages).toEqual([own])
      const fresh = report("ses_other", "a different child")
      const next = contextEvent([own, fresh])
      hooks.context!(next)
      expect(next.messages).toEqual([own, fresh])
    } finally {
      await dispose?.()
    }
  })

  test("a report seen while terminal stays stale after the session re-arms", async () => {
    const directory = repository()
    const { ctx, calls, hooks } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const own = line("the user's own line")
      const stale = report("ses_worker")
      hooks.context!(contextEvent([own, stale])) // no goal: stripped and marked as seen
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      const rearmed = contextEvent([own, stale])
      hooks.context!(rearmed)
      expect(rearmed.messages).toEqual([own]) // stale id is not admitted on re-arm
      const fresh = report("ses_new", "a fresh child")
      const next = contextEvent([own, fresh])
      hooks.context!(next)
      expect(next.messages).toEqual([own, fresh])
    } finally {
      await dispose?.()
    }
  })

  test("a subagent report is never re-added by the trailing-user repair", async () => {
    const directory = repository()
    const { ctx, hooks, storage } = context(directory)
    storage.set("goal/v1/ses_1", achieved(directory))
    const dispose = await (plugin as any).setup(ctx)
    try {
      const own = line("real user task")
      const event = contextEvent([own, report("ses_worker")]) // trailing message is the stripped report
      hooks.context!(event)
      expect(event.messages).toEqual([own])
      expect((event.messages.at(-1) as any).role).toBe("user")
    } finally {
      await dispose?.()
    }
  })
})

describe("the generate hook makes evaluator replies text-only (empty-verdict root cause)", () => {
  test("tools are removed and output bounded only on the judge child, never on the working session", async () => {
    const directory = repository()
    // The primary verdict is native; `consensus: 2` + a pinned model is what still spawns the generation child
    // whose generate hook is asserted here (the second vote).
    const { ctx, calls, hooks, storage } = context(directory, { model: "provider/model", evaluator: { consensus: 2 } })
    let release!: (text: string) => void
    let onGenerate!: () => void
    const called = new Promise<void>((resolve) => (onGenerate = resolve))
    const verdict = new Promise<string>((resolve) => (release = resolve))
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    // A pending consensus judge child: the evaluation stays in flight so the hook can be inspected mid-request.
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).remove = async () => {}
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID === "ses_judge") onGenerate()
      else void calls.prompts.push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: await verdict } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await called // the judge child is in flight

      const buildEvent = (sessionID = "ses_judge") => ({
        sessionID,
        agent: "evaluator",
        model: {},
        system: [] as any[],
        messages: [] as any[],
        tools: { read: { description: "read", input: {} }, write: { description: "write", input: {} } } as any,
        options: {} as any,
      })
      const during = buildEvent()
      hooks.generate!(during)
      expect(Object.keys(during.tools)).toEqual([]) // no tool call can produce an empty text verdict
      expect(during.options.maxTokens).toBe(4096) // DEFAULTS.evaluator.maxOutputTokens, not any positive budget

      // A user prompt admitted mid-evaluation is a working turn, not a judge: it keeps its tools and budget.
      const parent = buildEvent("ses_1")
      hooks.generate!(parent)
      expect(Object.keys(parent.tools)).toEqual(["read", "write"])
      expect(parent.options.maxTokens).toBeUndefined()

      release(judgeVerdict())
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
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

describe("the judge child converges when the host prompt ignores its abort signal (CXXVIII)", () => {
  test("the signal reaches the host prompt, no wake is delivered, and the child persists", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory, {
      model: "provider/model",
      // The harness judge child is the only verdict path; its event stream closes with no text.
      evaluator: { mode: "independent", timeoutMs: 80, consensus: 2 },
    })
    let promptSignal: AbortSignal | undefined
    let removed = false
    const reports: any[] = []
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).remove = async () => { removed = true }
    ;(ctx.session as any).synthetic = async (input: any) => void reports.push(input)
    ;(ctx.session as any).prompt = async (input: any, opts?: any) => {
      if (input.sessionID === "ses_judge") {
        promptSignal = opts?.signal
        return new Promise(() => {}) // deliberately never settles — only convergence via `done` may release the judge
      }
      void calls.prompts.push(input)
    }
    let subscriptions = 0
    ;(ctx as any).event = {
      subscribe: async function* () {
        subscriptions++
        if (subscriptions > 1) return // a judge child whose event stream closes with no verdict
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
      // A closed judge event stream releases `done` with no text; spawnEvaluator must converge promptly even though
      // the host prompt never settles. The unreadable verdict pauses the goal with a typed verdict error.
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "paused", 3_000)
      expect(promptSignal).toBeInstanceOf(AbortSignal)
      // The verdict is read from the child's own event stream. The child has no parent link and the plugin admits no
      // completion into the working session — a queued synthetic is still durable input in the parent's inbox.
      expect(reports).toHaveLength(0)
      // Judge children persist and stay navigable (hung) — no `session.remove` on verdict.
      expect(removed).toBe(false)
    } finally {
      await dispose?.()
    }
  })
})

describe("the generate hook strips tools on an inherited-model judge child (CXXVIII pin)", () => {
  test("the child is toolless even though the parent session is no longer marked in-flight", async () => {
    const directory = repository()
    const { ctx, calls, hooks, storage } = context(directory, { evaluator: { model: "inherit", consensus: 2 } })
    let judgeStarted!: () => void
    const started = new Promise<void>((resolve) => (judgeStarted = resolve))
    let deliverVerdict!: (text: string) => void
    const verdict = new Promise<string>((resolve) => (deliverVerdict = resolve))
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).get = async () => ({ id: "ses_1", parentID: undefined, tokens: {}, model: { providerID: "oc", id: "m" } })
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).remove = async () => {}
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID === "ses_judge") judgeStarted()
      else void calls.prompts.push(input)
    }
    let subscriptions = 0
    ;(ctx as any).event = {
      subscribe: async function* () {
        subscriptions++
        if (subscriptions > 1) {
          const text = await verdict
          yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: text } }
          yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
          return
        }
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
      await started
      const eventFor = (sessionID: string) => ({
        sessionID,
        agent: "general",
        model: {},
        system: [] as any[],
        messages: [] as any[],
        tools: { read: { description: "read", input: {} }, write: { description: "write", input: {} } } as any,
        options: {} as any,
      })
      const child = eventFor("ses_judge")
      hooks.generate!(child)
      expect(Object.keys(child.tools)).toEqual([])
      const parent = eventFor("ses_1")
      hooks.generate!(parent)
      expect(Object.keys(parent.tools)).toEqual(["read", "write"])
      deliverVerdict(judgeVerdict())
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
      expect((storage.get("goal/v1/ses_1") as any)?.status).toBe("achieved")
    } finally {
      await dispose?.()
    }
  })
})

describe("verdicts are delegated to a first-class evaluator agent (CXXX)", () => {
  test("setup registers a visible subagent with the shipped system prompt and deny-all permissions", async () => {
    const { ctx, calls } = context(repository())
    const dispose = await (plugin as any).setup(ctx)
    try {
      const evaluator = calls.agents.find((agent: any) => agent.id === EVALUATOR_AGENT_ID)
      expect(evaluator).toBeDefined()
      expect(evaluator.name).toBe("Evaluator")
      expect(evaluator.description).toContain("/goal condition")
      expect(evaluator.mode).toBe("subagent")
      expect(evaluator.hidden).toBe(false)
      expect(evaluator.color).toBe("#A78BFA") // the shipped accent, not any truthy color
      expect(evaluator.system).toBe(EVALUATOR_SYSTEM_PROMPT)
      expect(evaluator.system).toContain("You are the Evaluator")
      expect(evaluator.permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }])
    } finally {
      await dispose?.()
    }
  })

  test("a judge child echoing a stale condition fails closed instead of ruling the goal met", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory)
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).remove = async () => {}
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID !== "ses_judge") void (calls.prompts as any[]).push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.text.delta", data: {
          sessionID: "ses_judge",
          delta: judgeVerdict({ reason: "an unrelated goal was completed in another session", echo: "Verify the anti-dup marker in the installed plugin" }),
        } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      const until = Date.now() + 6000
      while (Date.now() < until && !(storage.get("goal/v1/ses_1") as any)?.reason?.includes("stale condition")) {
        await new Promise((r) => setTimeout(r, 20))
      }
      const record = storage.get("goal/v1/ses_1") as any
      expect(record.status).not.toBe("achieved")
      expect(record.reason).toContain("stale condition")
    } finally {
      await dispose?.()
    }
  })

  test("a judge child's text landing after the parent goes idle is judged in the same turn (delayed text)", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory)
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).remove = async () => {}
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID !== "ses_judge") void (calls.prompts as any[]).push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        // The judge finishes shortly after the parent goes idle. The harness reads its text from the child's
        // event stream (not a late parent-transcript report), so the delayed text is still this turn's verdict.
        await new Promise((r) => setTimeout(r, 50))
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: judgeVerdict({ reason: "late but fresh" }) } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
      const record = storage.get("goal/v1/ses_1") as any
      expect(record.status).toBe("achieved")
      expect(record.reason).toContain("late but fresh")
    } finally {
      await dispose?.()
    }
  })

  test("a judge child without a condition echo is still accepted (free-tier models omit it)", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory)
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).remove = async () => {}
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID !== "ses_judge") void (calls.prompts as any[]).push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: judgeVerdict({ body: '{"verdict":"met","reason":"the reply was DONE"}' }) } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
      expect((storage.get("goal/v1/ses_1") as any)?.status).toBe("achieved")
    } finally {
      await dispose?.()
    }
  })

  test("in the default mode the harness judge subagent child's text is the verdict", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory) // no options: evaluator mode defaults to session
    const created: any[] = []
    const reports: any[] = []
    let judgePrompt = ""
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence: DONE.txt contains exactly ok at current HEAD")]
    ;(ctx.session as any).create = async (input: any) => {
      created.push(input)
      return { id: "ses_judge" }
    }
    ;(ctx.session as any).synthetic = async (input: any) => void reports.push(input)
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID === "ses_judge") judgePrompt = input.text
      else void calls.prompts.push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: judgeVerdict({ reason: "harness judge verdict" }) } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
      const record = storage.get("goal/v1/ses_1") as any
      expect(record.status).toBe("achieved")
      // The verdict is the judge child's text, parsed through the authoritative contract guard.
      expect(record.reason).toContain("harness judge verdict")

      // The harness creates one evaluator subagent child under the goal session, not a new top-level session.
      // The plugin never admits a completion report into the parent's transcript either.
      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({ agent: EVALUATOR_AGENT_ID, model: { providerID: "provider", id: "model" } })
      expect(created[0].parentID).toBe("ses_1")
      expect(judgePrompt).toContain("<goal-evaluation>")
      expect(judgePrompt).toContain("<condition>the parser is correct</condition>")
      expect(judgePrompt).toContain("<parent-summary>")
      expect(judgePrompt).toContain("fresh evidence: DONE.txt contains exactly ok")
      // No `<subagent>` report is admitted to the working session: the parent must neither see the judge's context
      // nor be pulled into a new turn by a queued synthetic. The outcome stays visible as a non-waking toast.
      expect(reports).toHaveLength(0)
      expect(calls.notices.some((notice: any) => notice.kind === "achieved")).toBe(true)
    } finally {
      await dispose?.()
    }
  })

  test("evaluator and planner are reused parent-linked subagent children", () => {
    const root = join(import.meta.dir, "..")
    const read = (path: string) => readFileSync(join(root, path), "utf8")
    const host = read("src/index.ts")
    const code = host.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n")
    // Two session creators remain, both built-in subagent children of the goal session: one reused evaluator child
    // serves every verdict and loop step, one reused planner child serves every arm. Neither adds a top-level
    // "Goal planner" / "evaluator" session to the session list. Their completions are consumed from their own
    // event streams and stripped from the worker's context by child id, so a parent link cannot wake the worker.
    expect(code.match(/ctx\.session\.create\(/g) ?? []).toHaveLength(2)
    expect(code.match(/parentID: sessionID/g) ?? []).toHaveLength(2)
    expect(code.slice(code.indexOf("const planGoal =")).includes("parentID: sessionID")).toBe(true)
    // A host report from either harness-owned child is dropped by id, not only by agent metadata.
    expect(code).toContain("background.internalAgentOf(id) !== undefined")
    expect(code).toContain("return live && fresh && !isInternalChildReport(message)")
    expect(code).toContain("evaluatorChildBySession.set(sessionID, id)")
    expect(code).toContain("evaluatorChildBySession.get(sessionID)")
    expect(code).toContain("plannerChildBySession.set(sessionID, id)")
    expect(code).toContain("plannerChildBySession.get(sessionID)")
    expect(code).toContain("evaluatorChildBySession.clear()")
    expect(code).toContain("plannerChildBySession.clear()")
    // Both parent-linked children register their own id + agent identity with the background tracker, so a
    // verdict or arm cannot self-defer behind the plugin's own machinery. Real delegated workers stay counted.
    expect(code).toContain("background.noteInternal(id, EVALUATOR_AGENT_ID)")
    expect(code).toContain("background.noteInternal(id, PLANNER_AGENT_ID)")
    // The judge belongs to the goal-owning parent only: no descendant completion spawns a verdict, so no
    // child session needs owner routing and no verdict admits a `<subagent>` completion into the parent inbox.
    expect(code).not.toContain("ownerSessionID")
    expect(code).toContain("evaluatorContext(sessionID, signal)")
    const judgeBody = code.slice(code.indexOf("const spawnEvaluator ="), code.indexOf("const evaluatorContext ="))
    expect(judgeBody).not.toContain("session.synthetic")
    expect(judgeBody).not.toContain("Goal Achieved.")
    expect(code).not.toContain("session.remove")
    // Neither the judge nor the planner admits a completion into the working session. A queued synthetic is
    // durable parent-inbox input even with `resume: false`, so neither path emits one.
    expect(code.match(/delivery: "queue"/g) ?? []).toHaveLength(0)
    expect(code.match(/resume: false/g) ?? []).toHaveLength(0)
    expect(code).toContain("isEvaluatorReport(m.metadata)) return true")
    expect(code).toContain("md.agent.toLowerCase() === PLANNER_AGENT_ID")
    // The native-report ingestion helpers belonged to the removed worker-delegation path.
    const agent = read("src/core/evaluator-agent.ts")
    expect(agent).not.toContain("findNativeReport")
    expect(agent).not.toContain("parseSubagentReport")
  })

  test("loop summarizer and next-goal planner reuse the evaluator subagent child", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory)
    const created: any[] = []
    let judgePrompts = 0
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).create = async (input: any) => {
      created.push(input)
      return { id: "ses_judge" }
    }
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID === "ses_judge") judgePrompts++
      else void calls.prompts.push(input)
    }
    const tick = () => new Promise((r) => setImmediate(r))
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await tick()
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await tick()
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await tick()
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        while (judgePrompts < 1) await tick()
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: judgeVerdict({ reason: "iteration done" }) } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
        while (judgePrompts < 2) await tick()
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: "iteration 1 summary" } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
        while (judgePrompts < 3) await tick()
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: "LOOP_COMPLETE" } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
        await new Promise(() => {}) // keep the stream open; the plugin aborts each subscription on dispose
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const loop = calls.commands.find((command: any) => command.name === "goal-loop")
      await loop.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => judgePrompts >= 3, 3_000)
      // One parent-linked subagent child serves the verdict, the summary and the next-goal generation.
      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({ agent: EVALUATOR_AGENT_ID, parentID: "ses_1" })
      // No completion report is admitted to the working session; loop advances carry the next iteration's steer.
      const completionReports = calls.prompts.filter((p: any) => p.metadata?.source === "subagent")
      expect(completionReports).toHaveLength(0)
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.loopHistory?.length === 1, 3_000)
    } finally {
      await dispose?.()
    }
  })

  test("a foreign or unreadable judge child text throws a typed verdict error instead of ruling the goal met", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory)
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        // A cached completion from another rubric: `status` instead of the authoritative `verdict` key.
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: '{"status":"met","reason":"other rubric"}' } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "paused")
      const record = storage.get("goal/v1/ses_1") as any
      expect(record.status).toBe("paused")
      expect(record.reason).toContain("no authoritative verdict")
    } finally {
      await dispose?.()
    }
  })
})

describe("a failed evaluator subagent keeps its provider classification (CXXXI)", () => {
  test("a judge child failing on the provider's free-usage gate pauses the goal instead of retrying as an unreadable verdict", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory, {
      evaluator: { mode: "independent", model: "provider/model" },
      maxRetries: 1,
    })
    // The harness judge child failed on the provider's free-usage gate, so its execution reports the 429 message
    // instead of a verdict JSON. spawnEvaluator classifies it and the controller pauses with resume guidance.
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.execution.failed", data: { sessionID: "ses_judge", error: "Free usage limit reached. Subscribe to OpenCode Go to keep going. (HTTP 429)" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "paused")
      const record = storage.get("goal/v1/ses_1") as any
      expect(record.status).toBe("paused")
      expect(record.pauseCause).toBe("usage_limit")
      expect(record.reason).toContain("usage limit")
      expect(record.reason).toContain("resume")
    } finally {
      await dispose?.()
    }
  })

  test("a structured 429 with a generic message still pauses the goal (status is not flattened away)", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory, {
      evaluator: { mode: "independent", model: "provider/model" },
      maxRetries: 1,
    })
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    // A provider quota error is an object. Its 429 lives in `status`, not in the message text ("slow down").
    // asEvaluatorError must preserve the structured signal for isUsageLimitError to see it.
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.execution.failed", data: { sessionID: "ses_judge", error: { status: 429, type: "provider.free-limit", message: "slow down" } } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "paused")
      expect((storage.get("goal/v1/ses_1") as any)?.pauseCause).toBe("usage_limit")
    } finally {
      await dispose?.()
    }
  })

  test("a structured non-quota error that merely mentions a limit does not pause as usage_limit", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory, {
      evaluator: { mode: "independent", model: "provider/model" },
      maxRetries: 3,
    })
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence for the judge")]
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.execution.failed", data: { sessionID: "ses_judge", error: { status: 500, type: "Error", message: "rate limit settings are documented at example.com" } } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "active")
      const record = storage.get("goal/v1/ses_1") as any
      expect(record.status).toBe("active")
      expect(record.pauseCause).toBeUndefined()
    } finally {
      await dispose?.()
    }
  })
})

describe("the harness judge prompt carries a clean evidence contract (CXXXII)", () => {
  test("only this turn's fresh tool evidence reaches the parent-linked judge rubric", async () => {
    const directory = repository()
    const { ctx, calls, hooks, storage } = context(directory)
    let judgePrompt = ""
    ;(ctx.session as any).context = async () => [
      { type: "user", text: "fix the failing tests" },
      {
        type: "synthetic",
        text: '<subagent sessionID="ses_old" state="completed" description="Judge goal condition">{"verdict":"not_met","reason":"fix the failing tests"}</subagent>',
        metadata: { source: "subagent", agent: "evaluator" },
      },
      { type: "synthetic", text: '<goal-continuation turn="1">Evaluator: goal-loop was created, planned, or installed</goal-continuation>' },
      {
        type: "assistant",
        content: [{ type: "tool", name: "bash", state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: "12 pass 0 fail" }] } }],
      },
    ]
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID === "ses_judge") judgePrompt = input.text
      else void calls.prompts.push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: judgeVerdict() } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => judgePrompt.length > 0)
      expect(judgePrompt).toContain("<goal-evaluation>")
      expect(judgePrompt).toContain("<original-goal>")
      expect(judgePrompt).toContain("<condition>the parser is correct</condition>")
      expect(judgePrompt).toContain("<parent-summary>")
      expect(judgePrompt).toContain("command: bun test")
      expect(judgePrompt).not.toContain('{"command"')
      expect(judgePrompt).toContain("</goal-evaluation>")
      // The old raw-transcript digest carried prior verdicts about other conditions; a small model judged those
      // instead of the armed one. Only the worker's fresh tool evidence may reach the judge.
      expect(judgePrompt).not.toContain("fix the failing tests")
      expect(judgePrompt).not.toContain("goal-loop was created, planned, or installed")
      expect(judgePrompt).not.toContain("<subagent")
      // The scope guard makes the single original goal unambiguous.
      expect(judgePrompt).toContain("The only condition that exists for this verdict is the text inside <condition>")
      expect(judgePrompt).not.toContain("<conversation>")

      // The prompt hook no longer enriches delegated children — the harness owns the rubric. Every other prompt,
      // including a child's, is left untouched.
      const childEvent: any = { sessionID: "ses_child", prompt: { text: "arbitrary child prompt" } }
      await hooks.prompt!(childEvent)
      expect(childEvent.prompt.text).toBe("arbitrary child prompt")
      const workingEvent: any = { sessionID: "ses_1", prompt: { text: "keep going" } }
      await hooks.prompt!(workingEvent)
      expect(workingEvent.prompt.text).toBe("keep going")
    } finally {
      await dispose()
    }
  })
})

describe("judge and planner child prompts must wake their own execution (CXLII P0)", () => {
  test("the judge child is prompted with { sessionID, text } and no resume opt-out before its verdict lands", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory, { model: "provider/model" })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence: bun run check green at current HEAD")]
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).create = async () => ({ id: "ses_judge" })
    const judgeCalls: any[] = []
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID === "ses_judge") judgeCalls.push(input)
      else void calls.prompts.push(input)
    }
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await new Promise((r) => setImmediate(r))
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: judgeVerdict() } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
      expect((storage.get("goal/v1/ses_1") as any)?.status).toBe("achieved")
      expect(judgeCalls.length).toBe(1)
      expect(judgeCalls[0]).toMatchObject({ sessionID: "ses_judge" })
      expect(typeof judgeCalls[0].text).toBe("string")
      expect(judgeCalls[0].text).toContain("<goal-evaluation>")
      // The host only wakes execution when resume !== false. A judge admitted with a resume opt-out never runs,
      // so no terminal event arrives and the verdict only survives via the external timeout — this pin fails there.
      expect("resume" in judgeCalls[0]).toBe(false)
      expect(judgeCalls[0].resume).toBeUndefined()
    } finally {
      await dispose?.()
    }
  })

  test("the planner is a parent-linked subagent child, prompted without a resume opt-out, and never delivers early", async () => {
    const directory = repository()
    const { ctx, calls, storage } = context(directory, { model: "provider/model" })
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = "production" // planGoal deliberately skips under bun test; this pin needs the real path.
    try {
      ;(ctx.session as any).context = async () => [evidence("fresh evidence: bun run check green at current HEAD")]
      ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
      const created: any[] = []
      ;(ctx.session as any).create = async (input: any) => {
        created.push(input)
        return { id: input.agent === PLANNER_AGENT_ID ? "ses_planner" : "ses_judge" }
      }
      const childCalls: any[] = []
      ;(ctx.session as any).prompt = async (input: any) => {
        if (input.sessionID === "ses_planner" || input.sessionID === "ses_judge") childCalls.push(input)
        else void calls.prompts.push(input)
      }
      // Hold the planner's terminal event: while planning is in flight — even well past a minute — neither the
      // host nor the plugin may deliver the user's kickoff into the working session.
      let releasePlan!: () => void
      const planGate = new Promise<void>((resolve) => { releasePlan = resolve })
      ;(ctx as any).event = {
        subscribe: async function* () {
          for (let i = 0; i < 1000 && !childCalls.some((c) => c.sessionID === "ses_planner"); i++) await new Promise((r) => setImmediate(r))
          await planGate
          yield { type: "session.text.delta", data: { sessionID: "ses_planner", delta: JSON.stringify({ condition: "the parser is correct", scope: "code" }) } }
          yield { type: "session.execution.succeeded", data: { sessionID: "ses_planner" } }
          for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await new Promise((r) => setImmediate(r))
          yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
          await new Promise((r) => setImmediate(r))
          yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
          yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: judgeVerdict() } }
          yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
        },
      }
      const dispose = await (plugin as any).setup(ctx)
      try {
        const goal = calls.commands.find((command: any) => command.name === "goal")
        const executing = goal.execute({ sessionID: "ses_1", prompt: { text: "raw goal body pasted by a user" }, delivery: "steer" })
        await waitFor(() => childCalls.some((c) => c.sessionID === "ses_planner"))
        // The planner is still running: no user message, directive or completion may reach the parent yet.
        expect(calls.prompts.filter((p: any) => p.sessionID === "ses_1")).toHaveLength(0)
        releasePlan()
        await executing
        await waitFor(() => (storage.get("goal/v1/ses_1") as any)?.status === "achieved")
        const plannerCall = childCalls.find((c) => c.sessionID === "ses_planner")
        expect(plannerCall).toBeDefined()
        expect(typeof plannerCall.text).toBe("string")
        expect(plannerCall.text).toContain("<raw>")
        // Same P0 pin as the judge: no resume opt-out may suppress the planner child's execution.
        expect("resume" in plannerCall).toBe(false)
        expect(plannerCall.resume).toBeUndefined()
        // The planner is a built-in parent-linked subagent child of the goal session, not a new top-level session.
        // The plan is consumed from its own event stream; a host completion report from this child is stripped
        // from the worker's context by child id, so the parent link cannot feed the raw plan to the worker.
        const plannerCreate = created.find((input: any) => input.agent === PLANNER_AGENT_ID)
        expect(plannerCreate).toBeDefined()
        expect(plannerCreate.parentID).toBe("ses_1")
        // No completion is admitted to the working session: not a host delivery, and not a queued synthetic
        // either (a queued synthetic is durable parent-inbox input even with `resume: false`).
        expect(calls.prompts.some((p: any) => p.metadata?.agent === PLANNER_AGENT_ID)).toBe(false)
        expect(calls.prompts.some((p: any) => p.type === "synthetic" || p.metadata?.source === "subagent")).toBe(false)
        // The planned condition, not the raw body, reached the worker and the judge.
        expect((storage.get("goal/v1/ses_1") as any)?.condition).toBe("the parser is correct")
      } finally {
        await dispose?.()
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })
})

describe("harness-owned child reports never reach the worker", () => {
  test("a live session drops a subagent report by internal child id even without agent metadata", async () => {
    const directory = repository()
    const { ctx, calls, hooks, storage } = context(directory)
    ;(ctx.session as any).get = async () => ({ id: "ses_1", model: { providerID: "provider", id: "model" }, tokens: {} })
    ;(ctx.session as any).context = async () => [evidence("fresh evidence: the file contains ok")]
    ;(ctx.session as any).create = async (input: any) => ({ id: input.agent === EVALUATOR_AGENT_ID ? "ses_judge" : "ses_planner" })
    let judged = false
    ;(ctx.session as any).prompt = async (input: any) => {
      if (input.sessionID === "ses_judge") judged = true
      else void calls.prompts.push(input)
    }
    const tick = () => new Promise((r) => setImmediate(r))
    ;(ctx as any).event = {
      subscribe: async function* () {
        for (let i = 0; i < 1000 && !storage.has("goal/v1/ses_1"); i++) await tick()
        yield { type: "session.execution.started", data: { sessionID: "ses_1" } }
        await tick()
        yield { type: "session.tool.called", data: { sessionID: "ses_1" } }
        await tick()
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
        for (let i = 0; i < 1000 && !judged; i++) await tick()
        yield { type: "session.text.delta", data: { sessionID: "ses_judge", delta: judgeVerdict({ verdict: "not_met" }) } }
        yield { type: "session.execution.succeeded", data: { sessionID: "ses_judge" } }
        await new Promise(() => {}) // keep the stream open; the plugin aborts each subscription on dispose
      },
    }
    const dispose = await (plugin as any).setup(ctx)
    try {
      const goal = calls.commands.find((command: any) => command.name === "goal")
      await goal.execute({ sessionID: "ses_1", prompt: { text: "the parser is correct" }, delivery: "steer" })
      await waitFor(() => judged && (storage.get("goal/v1/ses_1") as any)?.status === "active")
      const line = (text: string) => ({ role: "user", content: [{ type: "text", text }] })
      const own = line("the user's own line")
      const internal = line('<background-result kind="subagent" sessionID="ses_judge" state="completed">verdict echo</background-result>')
      const worker = line('<background-result kind="subagent" sessionID="ses_worker" state="completed">worker done</background-result>')
      const event: any = { sessionID: "ses_1", agent: "build", model: {}, system: [], messages: [own, internal, worker], tools: {}, options: {} }
      await hooks.context!(event)
      // The judge child is harness machinery registered by id, so its completion is dropped even though its
      // metadata does not name the agent. A real delegated worker's completion is still admitted on first sight.
      expect(event.messages).toEqual([own, worker])
    } finally {
      await dispose?.()
    }
  })
})

describe("/reset-context drops context in place", () => {
  test("the command compacts the same session and the hook installs an empty checkpoint", async () => {
    const { ctx, calls, hooks } = context(repository())
    const dispose = await (plugin as any).setup(ctx)
    try {
      const command = calls.commands.find((command: any) => command.name === "reset-context")
      expect(command).toBeDefined()
      expect(command.description).toContain("same session ID")
      await command.execute({ sessionID: "ses_1", prompt: { text: "" }, delivery: "steer" })
      // The host is asked to compact this session — no new session is created.
      expect(calls.compacts).toEqual(["ses_1"])
      const event: any = { sessionID: "ses_1", result: undefined }
      await hooks.compaction!(event)
      // An empty checkpoint replays with no conversation messages: a cold-start context with the same
      // session ID, and no native window to trigger the upstream "Provider compaction" divider.
      expect(event.result?.summary).toBe("")
      expect(event.result?.native).toBeUndefined()
      expect(event.result?.metadata).toEqual({ recent: "" })
      expect(calls.notices.some((notice: any) => notice.message.includes("no conversation history"))).toBe(true)
    } finally {
      await dispose?.()
    }
  })

  test("the override is consumed once, so a later automatic compaction keeps the harness summary", async () => {
    const { ctx, calls, hooks } = context(repository())
    const dispose = await (plugin as any).setup(ctx)
    try {
      const command = calls.commands.find((command: any) => command.name === "reset-context")
      await command.execute({ sessionID: "ses_1", prompt: { text: "" }, delivery: "steer" })
      const first: any = { sessionID: "ses_1", result: undefined }
      await hooks.compaction!(first)
      expect(first.result?.native).toBeUndefined()
      expect(first.result?.metadata).toEqual({ recent: "" })
      const second: any = { sessionID: "ses_1", result: undefined }
      await hooks.compaction!(second)
      expect(second.result).toBeUndefined()
      const other: any = { sessionID: "ses_other", result: undefined }
      await hooks.compaction!(other)
      expect(other.result).toBeUndefined()
    } finally {
      await dispose?.()
    }
  })
})

describe("restore cannot outlive plugin teardown", () => {
  test("a restore still awaiting storage does not write after dispose", async () => {
    const directory = repository()
    const { ctx, storage } = context(directory)
    const record = {
      version: 1,
      id: "goal_restored",
      sessionID: "ses_1",
      directory,
      condition: "the parser is correct",
      status: "active",
      setAt: 1_000_000,
      startedAt: 1_000_000,
      turns: 1,
      stall: 0,
      retries: 0,
      checkins: 0,
      baseline: { cost: 1, input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      history: [],
      pendingEvaluation: { phase: "evaluate", condition: "the parser is correct", turn: 1, tools: [] },
    }
    storage.set("goal/v1/ses_1", structuredClone(record))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    ;(ctx.storage as any).scan = async () => {
      await gate
      return { entries: [{ key: "goal/v1/ses_1", value: structuredClone(record) }] }
    }
    const dispose = await (plugin as any).setup(ctx)
    let writes = 0
    const originalSet = ctx.storage.set
    ;(ctx.storage as any).set = async (key: string, value: unknown) => {
      writes++
      return originalSet(key, value)
    }
    // Teardown begins while restore is parked on the scan. Release the gate shortly afterwards:
    // a correct disposer waits for restore and all writes land before it resolves.
    const disposing = dispose()
    setTimeout(() => release(), 20)
    await disposing
    const writesAtTeardown = writes
    await new Promise((r) => setTimeout(r, 50))
    // Without awaiting restore, adopt + resumePendingEvaluations commit after dispose's flush.
    expect(writes).toBe(writesAtTeardown)
  })
})

describe("agent-to-agent messaging (enabled with the plugin)", () => {
  const toolContext = (sessionID: string) => ({
    sessionID,
    agent: "goal-loop",
    messageID: "msg_messaging",
    id: "call_messaging",
    signal: new AbortController().signal,
    progress: async () => {},
  })

  test("the plugin registers both messaging tools while it is enabled", async () => {
    const { ctx, calls } = context(repository())
    const dispose = await (plugin as any).setup(ctx)
    try {
      const names = calls.tools.map((tool: any) => tool.name)
      expect(names).toContain("goal_msg_send")
      expect(names).toContain("goal_msg_read")
    } finally {
      await dispose()
    }
  })

  test("a worker sends as its parent and the recipient's parent reads and replies", async () => {
    const { ctx, calls, sessionParents, storage } = context(repository())
    sessionParents.set("ses_worker_A", "ses_parent_A")
    sessionParents.set("ses_worker_B", "ses_parent_B")
    const dispose = await (plugin as any).setup(ctx)
    try {
      const send = calls.tools.find((tool: any) => tool.name === "goal_msg_send")
      const read = calls.tools.find((tool: any) => tool.name === "goal_msg_read")
      expect(send).toBeDefined()
      expect(read).toBeDefined()

      await send.execute({ to: "ses_parent_B", text: "question from A" }, toolContext("ses_worker_A"))
      // The message lands in the recipient parent's inbox, tagged with the sender parent's id.
      expect(storage.has("goal/msg/v1/ses_parent_B")).toBe(true)
      expect(storage.has("goal/msg/v1/ses_parent_A")).toBe(false)

      const forB = await read.execute({}, toolContext("ses_worker_B"))
      expect(forB.content).toContain("question from A")
      expect(forB.content).toContain("ses_parent_A")
      // Reading drains: a second read sees nothing.
      expect((await read.execute({}, toolContext("ses_worker_B"))).content).toContain("No messages")

      await send.execute({ to: "ses_parent_A", text: "answer from B" }, toolContext("ses_worker_B"))
      const forA = await read.execute({}, toolContext("ses_worker_A"))
      expect(forA.content).toContain("answer from B")
      expect(forA.content).toContain("ses_parent_B")
    } finally {
      await dispose()
    }
  })

  test("the unread hint appears for the addressed parent and clears after a read", async () => {
    const { ctx, calls, hooks, sessionParents } = context(repository())
    sessionParents.set("ses_worker_B", "ses_parent_B")
    const dispose = await (plugin as any).setup(ctx)
    try {
      const send = calls.tools.find((tool: any) => tool.name === "goal_msg_send")
      const read = calls.tools.find((tool: any) => tool.name === "goal_msg_read")
      await send.execute({ to: "ses_parent_B", text: "ping" }, toolContext("ses_worker_A"))

      const event = () => ({ sessionID: "ses_worker_B", agent: "goal-loop", system: [] as any[], messages: [] as any[], model: { providerID: "test" } })
      const before = event()
      await hooks.context!(before)
      expect(before.system.some((s: any) => String(s.text).includes("unread agent message"))).toBe(true)

      await read.execute({}, toolContext("ses_worker_B"))
      const after = event()
      await hooks.context!(after)
      expect(after.system.some((s: any) => String(s.text).includes("unread agent message"))).toBe(false)
    } finally {
      await dispose()
    }
  })
})
