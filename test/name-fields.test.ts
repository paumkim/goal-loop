/**
 * Name-field consistency after the `goal-loop` rename (Workstream LXXIX).
 *
 * The rename touched the product, package, plugin ids, CLI file and mirror dir. Every field that names
 * the product must agree with the one shipped identity, so this suite pins the fields that can drift
 * independently: `package.json` `name`, the lockfile workspace `name`, the `bin` map (including the
 * legacy alias), the server/TUI plugin ids (source and shipped `dist/tui.js`), the mirror directory,
 * the docs search index, and the documented option floors against `resolveConfig()`.
 *
 * Deliberate legacy names are NOT asserted away: `OPENCODE_GOAL_*` env vars, the `opencode-goal` bin
 * alias, `PLUGIN_PACKAGE = "opencode-goalv2"` and the pre-rename GitHub repo slug are the
 * back-compat surface.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { resolveConfig } from "../src/core/config.ts"
const ROOT = join(import.meta.dir, "..")
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8")
const pkg = JSON.parse(read("package.json")) as {
  name: string
  version: string
  bin: Record<string, string>
  files: string[]
}
describe("name fields", () => {
  test("package.json names the package goal-loop", () => {
    expect(pkg.name).toBe("goal-loop")
  })
  test("bun.lock's workspace name equals package.json's name", () => {
    const locked = /"workspaces":\s*\{\s*"":\s*\{\s*"name":\s*"([^"]+)"/.exec(read("bun.lock"))?.[1]
    expect(locked).toBe(pkg.name)
  })
  test("bin maps goal-loop to the executable CLI and keeps opencode-goal as an alias", () => {
    expect(pkg.bin["goal-loop"]).toBe("./bin/goal-loop.mjs")
    expect(pkg.bin["opencode-goal"]).toBe("./bin/goal-loop.mjs")
    const cli = statSync(join(ROOT, "bin/goal-loop.mjs"))
    expect(cli.mode & 0o111).not.toBe(0)
    expect(read("bin/goal-loop.mjs")).toContain(`const FALLBACK_VERSION = "${pkg.version}"`)
    expect(pkg.files).toContain("install.sh")
  })
  test("plugin ids are goal-loop (server) and goal-loop.tui (TUI), in source and shipped dist", () => {
    expect(read("src/index.ts")).toContain('const PLUGIN_ID = "goal-loop"')
    expect(read("src/tui.tsx")).toContain('id: "goal-loop.tui"')
    expect(read("dist/tui.js")).toContain("goal-loop.tui")
    expect(read("dist/tui.js")).not.toContain("opencode-goal.tui")
  })
  test("the mirror directory is goal-loop-mirror in code and in the config docs", () => {
    expect(read("src/core/mirror.ts")).toContain('join(tmpdir(), "goal-loop-mirror")')
    expect(read("docs/config.html")).toContain("/goal-loop-mirror/")
  })
  test("the docs search index advertises the goal-loop CLI, not a removed npm global install", () => {
    const keywords = /keywords:"install ([^"]*)"/.exec(read("docs/index.html"))?.[1] ?? ""
    expect(keywords).toContain("goal-loop")
    expect(keywords).not.toContain("npm i -g")
  })
  test("maxConditionChars: documented floor (0) matches resolveConfig()", () => {
    expect(resolveConfig({ maxConditionChars: 0 }, {}).maxConditionChars).toBe(0)
    expect(read("README.md")).toContain("Condition length cap (min 0)")
    expect(read("docs/config.html")).toContain("<code>maxConditionChars</code></td><td>int ≥0</td>")
  })
})

/** SPEC's naming declaration: the one place that defines the current identity and the legacy map. */
const spec = read("SPEC.md")
const namingBlock = /<!-- naming:start -->([\s\S]*?)<!-- naming:end -->/.exec(spec)?.[1] ?? ""
describe("SPEC naming declaration", () => {
  test("the SPEC title and naming block name goal-loop, not the repo slug", () => {
    expect(spec.split("\n")[0]).toBe("# SPEC — current behavior of goal-loop")
    expect(namingBlock).toContain("bin/goal-loop.mjs")
    expect(namingBlock).toContain("goal-loop.tui")
    expect(namingBlock).toContain("goal-loop-mirror")
    expect(namingBlock).toContain("github:paumkim/goal-loop#v")
  })
  test("every pre-rename name SPEC still uses is mapped to a current name that exists", () => {
    const pairs: Array<[string, string]> = [
      ["bin/opencode-goal.mjs", "bin/goal-loop.mjs"],
      ["opencode-goal.tui", "goal-loop.tui"],
      ["opencode-goal-mirror", "goal-loop-mirror"],
      ["github:paumkim/opencode-goalv2", "github:paumkim/goal-loop"],
    ]
    for (const [legacy, current] of pairs) {
      expect(spec, `${legacy} still appears in SPEC history`).toContain(legacy)
      expect(namingBlock, `${legacy} is declared legacy`).toContain(legacy)
      expect(namingBlock, `${legacy} maps to ${current}`).toContain(current)
    }
    expect(existsSync(join(ROOT, "bin/goal-loop.mjs"))).toBe(true)
    expect(read("src/tui.tsx")).toContain("goal-loop.tui")
    expect(read("src/core/mirror.ts")).toContain("goal-loop-mirror")
  })
  test("shipped code carries no pre-rename product name outside the declared legacy surface", () => {
    for (const file of ["src/index.ts", "src/tui.tsx", "src/core/mirror.ts", "dist/tui.js", "bin/goal-loop.mjs"]) {
      const text = read(file)
      expect(text, file).not.toContain("opencode-goal.tui")
      expect(text, file).not.toContain("opencode-goal-mirror")
      expect(text, file).not.toContain('PLUGIN_ID = "opencode-goal"')
    }
  })
  test("the declared legacy surface is still what ships (alias, package spec, env prefix)", () => {
    expect(pkg.bin["opencode-goal"]).toBe("./bin/goal-loop.mjs")
    expect(read("bin/goal-loop.mjs")).toContain('export const PLUGIN_PACKAGE = "opencode-goalv2"')
    expect(read("bin/goal-loop.mjs")).toContain("github:paumkim/goal-loop#v")
    expect(read("src/core/config.ts")).toContain("OPENCODE_GOAL_")
  })

  test("evaluator vocabulary: judge is a prose verb, checking is UI-only, identifiers use evaluator", () => {
    expect(namingBlock).toContain("`evaluator`")
    expect(namingBlock).toContain("prose verb")
    expect(namingBlock).toContain("`checking` is the literal TUI label")
    expect(namingBlock).toContain("armPlanScope")
    for (const file of ["src/index.ts", "src/runtime/evaluator.ts", "src/core/evaluator-agent.ts", "src/core/prompts.ts"]) {
      const text = read(file)
      expect(text, `${file}: judgeChildren`).not.toMatch(/\bjudgeChildren\b/)
      expect(text, `${file}: pluginJudgeIDs`).not.toMatch(/\bpluginJudgeIDs\b/)
      expect(text, `${file}: spawnJudge`).not.toMatch(/\bspawnJudge\b/)
      expect(text, `${file}: judgeGenerate`).not.toMatch(/\bjudgeGenerate\b/)
      expect(text, `${file}: asJudgeError`).not.toMatch(/\basJudgeError\b/)
      expect(text, `${file}: armScope`).not.toMatch(/\barmScope\b/)
    }
    expect(read("src/index.ts")).toContain("evaluatorChildren")
    expect(read("src/index.ts")).toContain("nativeVerdict")
    expect(read("src/index.ts")).toContain("spawnEvaluator")
    expect(read("src/index.ts")).not.toContain("pluginEvaluatorIDs")
    expect(read("src/runtime/evaluator.ts")).toContain("evaluatorGenerate")
    expect(read("src/core/prompts.ts")).toContain("armPlanScope")
  })
})
