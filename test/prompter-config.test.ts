import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_CONFIG } from "../src/prompter/defaults.ts"
import { envOverrides, isRepoAllowed, loadConfig, mergeConfig, normalize } from "../src/prompter/config.ts"

describe("config", () => {
  test("defaults are the review-gated, capped baseline", () => {
    expect(DEFAULT_CONFIG.maxTasksPerTick).toBe(1)
    expect(DEFAULT_CONFIG.maxSpendUsd).toBeGreaterThan(0)
    expect(DEFAULT_CONFIG.requireCleanTree).toBe(true)
    expect(DEFAULT_CONFIG.prompts.length).toBeGreaterThan(0)
  })

  test("mergeConfig applies partial overrides and clamps ranges", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      maxSpendUsd: 999_999,
      maxTasksPerTick: 50,
      pollMs: 1,
      prompts: ["a.md", "b.md"],
    })
    expect(merged.maxSpendUsd).toBe(100_000)
    expect(merged.maxTasksPerTick).toBe(50)
    expect(merged.pollMs).toBe(500)
    expect(merged.prompts).toEqual(["a.md", "b.md"])
  })

  test("envOverrides reads PROMPTER_* variables", () => {
    const raw = envOverrides({
      PROMPTER_BACKLOG: "TASKS.md",
      PROMPTER_MAX_SPEND_USD: "1.5",
      PROMPTER_PROMPTS: "a.md,b.md",
      PROMPTER_REQUIRE_CLEAN_TREE: "false",
      PROMPTER_STOP_FILES: "/tmp/STOP,/var/STOP",
      PROMPTER_MODEL: "provider/model",
    } as NodeJS.ProcessEnv)
    expect(raw.backlog).toBe("TASKS.md")
    expect(raw.maxSpendUsd).toBe("1.5")
    expect(raw.prompts).toEqual(["a.md", "b.md"])
    expect(raw.requireCleanTree).toBe("false")
    expect(raw.stopFiles).toEqual(["/tmp/STOP", "/var/STOP"])
  })

  test("normalize resolves relative paths and validates model", () => {
    const config = normalize(mergeConfig(DEFAULT_CONFIG, {
      promptLibrary: "./prompts",
      plugin: "./plugin",
      stopFiles: ["STOP"],
      allowedRepos: ["."],
      model: "opencode/deepseek-v4.1-flash-free",
    }), "/repo")
    expect(config.promptLibrary).toBe("/repo/prompts")
    expect(config.plugin).toBe("/repo/plugin")
    expect(config.stopFiles).toEqual(["/repo/STOP"])
    expect(config.allowedRepos).toEqual(["/repo"])
    expect(() => normalize(mergeConfig(DEFAULT_CONFIG, { model: "nope" }), "/repo")).toThrow(/provider\/model/)
  })

  test("isRepoAllowed enforces the configured whitelist without a CLI override", () => {
    const config = normalize(mergeConfig(DEFAULT_CONFIG, { allowedRepos: ["/repos/safe"] }), "/repos/safe")
    expect(isRepoAllowed(config, "/repos/safe")).toBe(true)
    expect(isRepoAllowed(config, "/repos/other")).toBe(false)
    // An empty whitelist is unrestricted — the default for local, single-repo use.
    expect(isRepoAllowed({ ...config, allowedRepos: [] }, "/repos/other")).toBe(true)
  })

  test("loadConfig reads config file then env, with env winning", () => {
    const repo = mkdtempSync(join(tmpdir(), "prompter-cfg-"))
    mkdirSync(join(repo, ".prompter"), { recursive: true })
    writeFileSync(join(repo, ".prompter", "config.json"), JSON.stringify({ backlog: "FILE.md", maxSpendUsd: 3 }))
    const config = loadConfig(repo, { PROMPTER_BACKLOG: "ENV.md" } as NodeJS.ProcessEnv)
    expect(config.backlog).toBe("ENV.md")
    expect(config.maxSpendUsd).toBe(3)
    rmSync(repo, { recursive: true, force: true })
  })
})
