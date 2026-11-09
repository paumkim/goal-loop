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
  const storage = new Map<string, unknown>()
  const ctx = {
    options: {},
    location: { directory },
    session: {
      prompt: async (input: any) => void calls.prompts.push(input),
      synthetic: async (input: any) => void calls.prompts.push(input),
      get: async () => ({ id: "ses_1", parentID: undefined, tokens: {} }),
      hook: async () => {},
    },
    generate: { text: async () => ({ text: "{}" }) },
    rpc: {
      register: async () => ({ events: { emit: async (event: any) => void calls.notices.push(event) } }),
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
  return { ctx, calls }
}

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
