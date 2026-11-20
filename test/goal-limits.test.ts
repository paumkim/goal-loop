import { describe, expect, test } from "bun:test"
import { DEFAULTS, resolveConfig } from "../src/core/config.ts"
import { CLEAR_ALIASES, parseGoalCommand } from "../src/core/parse.ts"
import { GoalController } from "../src/runtime/controller.ts"
import { GoalStore } from "../src/runtime/store.ts"
import type { Clock, StoragePort } from "../src/runtime/ports.ts"
import type { Notice } from "../src/core/types.ts"

/** Multi-line paste that stands in for a whole file copied from the clipboard. */
const PASTE_100K = Array.from({ length: 100_000 / 20 }, () => "line of file content").join("\n")

function clock(): Clock {
  return { now: () => 1_000_000, setTimeout: () => 0, clearTimeout: () => {} }
}

class MemoryStorage implements StoragePort {
  data = new Map<string, unknown>()
  get = async (key: string) => structuredClone(this.data.get(key))
  set = async (key: string, value: unknown) => void this.data.set(key, structuredClone(value))
  remove = async (key: string) => void this.data.delete(key)
  scan = async ({ prefix }: { prefix: string }) => ({
    entries: [...this.data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ key: k, value: structuredClone(v) })),
  })
}

describe("goal condition limits", () => {
  test("default is effectively unlimited", () => {
    expect(DEFAULTS.maxConditionChars).toBe(Number.MAX_SAFE_INTEGER)
    expect(resolveConfig({}).maxConditionChars).toBe(Number.MAX_SAFE_INTEGER)
    expect(resolveConfig({}).maxConditionChars).toBeGreaterThan(1_000_000)
  })

  test("MAX_SAFE_INTEGER accepts a 100k-char multi-line paste", () => {
    expect(PASTE_100K.length).toBeGreaterThan(90_000)
    const result = parseGoalCommand(PASTE_100K, Number.MAX_SAFE_INTEGER)
    expect(result.type).toBe("set")
    if (result.type === "set") expect(result.condition.length).toBe(PASTE_100K.length)
  })

  test("Infinity accepts long text", () => {
    const result = parseGoalCommand(PASTE_100K, Number.POSITIVE_INFINITY)
    expect(result.type).toBe("set")
  })

  test("explicit small limit still rejects (signature compatible with old callers)", () => {
    const result = parseGoalCommand("x".repeat(4001), 4000)
    expect(result.type).toBe("invalid")
    if (result.type === "invalid") expect(result.message).toContain("4000")
  })

  test("explicit small limit via config is honored", () => {
    const config = resolveConfig({ maxConditionChars: 4000 })
    expect(config.maxConditionChars).toBe(4000)
    expect(parseGoalCommand("x".repeat(4001), config.maxConditionChars).type).toBe("invalid")
    expect(parseGoalCommand("x".repeat(4000), config.maxConditionChars).type).toBe("set")
  })

  test("empty/clear aliases unchanged", () => {
    const unlimited = Number.MAX_SAFE_INTEGER
    expect(parseGoalCommand("", unlimited)).toEqual({ type: "status" })
    expect(parseGoalCommand("   \n ", unlimited)).toEqual({ type: "status" })
    for (const word of CLEAR_ALIASES) expect(parseGoalCommand(word, unlimited)).toEqual({ type: "clear" })
    expect(parseGoalCommand("stop the server", unlimited).type).toBe("set")
  })

  test("GoalController.command accepts a 100k-char condition through the default config", async () => {
    const notices: Notice[] = []
    const controller = new GoalController({
      config: resolveConfig({ learning: { enabled: false } }),
      directory: "C:/work/project",
      commit: { required: false, branch: "dev", reason: "test" },
      clock: clock(),
      store: new GoalStore(new MemoryStorage(), () => {}),
      log: { info() {}, warn() {}, error() {} },
      session: { prompt: async () => {}, synthetic: async () => {}, usage: async () => ({ cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }), compact: async () => {} },
      evaluator: { evaluate: async () => ({ verdict: "met" as const, reason: "done" }) },
      background: { busy: async () => ({ subagents: 0, shells: 0 }) },
      emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
    })
    await controller.command({ sessionID: "ses_1", text: PASTE_100K, delivery: "steer" })
    expect(notices.some((n) => n.kind === "error" && n.title === "Goal not set")).toBeFalse()
    expect(controller.get("ses_1")?.status).toBe("active")
    expect(controller.get("ses_1")?.condition.length).toBe(PASTE_100K.length)
  })

  test("explicit small limit through controller rejects long paste", async () => {
    const notices: Notice[] = []
    const controller = new GoalController({
      config: resolveConfig({ learning: { enabled: false }, maxConditionChars: 4000 }),
      directory: "C:/work/project",
      commit: { required: false, branch: "dev", reason: "test" },
      clock: clock(),
      store: new GoalStore(new MemoryStorage(), () => {}),
      log: { info() {}, warn() {}, error() {} },
      session: { prompt: async () => {}, synthetic: async () => {}, usage: async () => ({ cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }), compact: async () => {} },
      evaluator: { evaluate: async () => ({ verdict: "met" as const, reason: "done" }) },
      background: { busy: async () => ({ subagents: 0, shells: 0 }) },
      emitter: { changed: () => {}, notice: (n) => void notices.push(n) },
    })
    await controller.command({ sessionID: "ses_1", text: "x".repeat(4001), delivery: "steer" })
    expect(controller.get("ses_1")).toBeUndefined()
    expect(notices.some((n) => n.kind === "error")).toBeTrue()
  })
})

describe("condition length regression: astral characters", () => {
  test("an astral-plane condition counts each character once, not two UTF-16 units", () => {
    const limit = 4_000
    const over = `${"𝄞".repeat(limit)}𝄞`
    const result = parseGoalCommand(over, limit)
    expect(result.type).toBe("invalid")
    if (result.type === "invalid") expect(result.message).toContain("4001 characters")
    expect(parseGoalCommand("𝄞".repeat(limit), limit).type).toBe("set")
  })
})
