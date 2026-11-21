import { describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG } from "../src/prompter/defaults.ts"
import { budgetStop, killSwitch, newBudget, noteUsage, stopReason } from "../src/prompter/safety.ts"
import { globalStopFile } from "../src/prompter/util.ts"

const existsNone = (): boolean => false

describe("safety", () => {
  test("kill switch triggers on env, global file, and extra files", () => {
    expect(killSwitch(DEFAULT_CONFIG, "/repo", { exists: existsNone, env: { PROMPTER_STOP: "1" } })).toMatch(/PROMPTER_STOP/)
    expect(killSwitch(DEFAULT_CONFIG, "/repo", { exists: (p) => p === globalStopFile(), env: {} })).toMatch(/STOP/)

    const config = { ...DEFAULT_CONFIG, stopFiles: ["/custom/STOP"] }
    expect(killSwitch(config, "/repo", { exists: (p) => p === "/custom/STOP", env: {} })).toContain("/custom/STOP")
  })

  test("kill switch ignores false-like env values", () => {
    expect(killSwitch(DEFAULT_CONFIG, "/repo", { exists: existsNone, env: { PROMPTER_STOP: "0" } })).toBeUndefined()
    expect(killSwitch(DEFAULT_CONFIG, "/repo", { exists: existsNone, env: {} })).toBeUndefined()
  })

  test("budget stops on task count, spend, tokens, and wall clock", () => {
    const config = { ...DEFAULT_CONFIG, maxTasksPerTick: 10, maxSpendUsd: 5, maxTokens: 1000, maxWallMsPerTick: 60_000 }
    const budget = newBudget(0)
    expect(budgetStop(config, budget, 0)).toBeUndefined()
    noteUsage(budget, 2, 400)
    expect(budgetStop(config, budget, 0)).toBeUndefined()
    noteUsage(budget, 3, 700)
    expect(budgetStop(config, budget, 0)).toMatch(/spent/)
    expect(budgetStop({ ...config, maxSpendUsd: 0 }, budget, 0)).toMatch(/tokens/)
    expect(budgetStop({ ...config, maxSpendUsd: 0, maxTokens: 0, maxTasksPerTick: 2 }, budget, 0)).toMatch(/tasks/)
    expect(budgetStop({ ...config, maxSpendUsd: 0, maxTokens: 0 }, budget, 61_000)).toMatch(/wall clock/)
  })

  test("zero caps mean unlimited for spend and tokens", () => {
    const config = { ...DEFAULT_CONFIG, maxTasksPerTick: 100, maxSpendUsd: 0, maxTokens: 0, maxWallMsPerTick: 86_400_000 }
    const budget = newBudget(0)
    noteUsage(budget, 9999, 999_999)
    expect(budgetStop(config, budget, 0)).toBeUndefined()
  })

  test("stopReason gives signals priority over kill switch", () => {
    const reason = stopReason(DEFAULT_CONFIG, "/repo", { exists: existsNone, env: { PROMPTER_STOP: "1" } }, newBudget(), () => true)
    expect(reason).toContain("signal")
  })
})
