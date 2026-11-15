import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

/**
 * A stand-in for the OpenCode plugin context.
 *
 * Only the parts the plugin touches are implemented, and every call is recorded so the test can assert on what
 * the plugin asked the host to do.
 */
function context(directory: string) {
  const calls = { prompts: [] as any[], commands: [] as any[], notices: [] as any[] }
  const hooks: Record<string, (event: any) => any> = {}
  const storage = new Map<string, unknown>()
  const ctx = {
    options: {},
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

  test("a bare /goal-loop-12 arms nothing and shows status instead", async () => {
    const directory = repository()
    const { ctx, hooks, storage, calls } = context(directory)
    const dispose = await (plugin as any).setup(ctx)
    try {
      const event = promptEvent("/goal-loop-12")
      await hooks.prompt!(event)
      expect(storage.get("goal/v1/ses_1")).toBeUndefined()
      expect(event.prompt.text).toBe("/goal-loop-12")
      expect(calls.notices.some((n: any) => n.kind === "status")).toBe(true)
    } finally {
      await dispose?.()
    }
  })
})

describe("plugin setup", () => {
  test("a fresh git repository resolves to the coordinator flow on first /goal", async () => {
    // First-run bootstrap creates .term/coordinator, so a fresh repo is coordinator-detected.
    const directory = repository()
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
