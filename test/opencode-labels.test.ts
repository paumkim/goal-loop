import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  COMPACTION_DIVIDER_PATCH,
  HOST_LABEL_PATCHES,
  applyHostLabelPatch,
  hostLabelFile,
} from "../src/core/opencode-labels.ts"
import { patchHost, runCli } from "../bin/goal-loop.mjs"

/**
 * "Provider compaction" → "Context Cleared" is a host-source rename goal-loop owns so it survives
 * an upstream OpenCode update. The patch is stored in this repo and re-applied by the standalone CLI.
 * These tests pin both halves: the pure rename in src/core, and the CLI that ships alone via install.sh.
 */

const SOURCE = `            {props.message.status === "completed" && props.message.native?.messages
              ? "Provider compaction"
              : "Compaction"}`

describe("host-label patch data", () => {
  test("renames the provider-compaction divider to Context Cleared", () => {
    expect(COMPACTION_DIVIDER_PATCH).toEqual({
      file: "packages/tui/src/routes/session/index.tsx",
      from: '? "Provider compaction"',
      to: '? "Context Cleared"',
    })
    expect(HOST_LABEL_PATCHES.length).toBeGreaterThan(0)
    expect(HOST_LABEL_PATCHES[0]).toBe(COMPACTION_DIVIDER_PATCH)
  })

  test("the durable patch file carries the same swap and the same host path", () => {
    const patch = readFileSync(new URL("../patches/context-cleared.patch", import.meta.url), "utf8")
    expect(patch).toContain(`--- a/${COMPACTION_DIVIDER_PATCH.file}`)
    expect(patch).toContain(`+++ b/${COMPACTION_DIVIDER_PATCH.file}`)
    expect(patch.split("\n").some((line) => line.startsWith("-") && line.includes(COMPACTION_DIVIDER_PATCH.from))).toBe(true)
    expect(patch.split("\n").some((line) => line.startsWith("+") && line.includes(COMPACTION_DIVIDER_PATCH.to))).toBe(true)
  })
})

describe("applyHostLabelPatch (pure)", () => {
  test("replaces the divider label and only that label", () => {
    const result = applyHostLabelPatch(SOURCE, COMPACTION_DIVIDER_PATCH)
    expect(result.changed).toBe(true)
    expect(result.already).toBe(false)
    expect(result.replacements).toBe(1)
    expect(result.text).toContain('? "Context Cleared"')
    expect(result.text).not.toContain('? "Provider compaction"')
    expect(result.text).toContain(': "Compaction"}')
  })

  test("is idempotent: a second application is a byte-identical no-op", () => {
    const once = applyHostLabelPatch(SOURCE, COMPACTION_DIVIDER_PATCH)
    const twice = applyHostLabelPatch(once.text, COMPACTION_DIVIDER_PATCH)
    expect(twice.text).toBe(once.text)
    expect(twice.changed).toBe(false)
    expect(twice.already).toBe(true)
    expect(twice.replacements).toBe(0)
  })

  test("does not report 'already' when the host string is absent for another reason", () => {
    const result = applyHostLabelPatch("no compaction divider here", COMPACTION_DIVIDER_PATCH)
    expect(result.changed).toBe(false)
    expect(result.already).toBe(false)
  })

  test("replaces every occurrence if upstream repeats the divider", () => {
    const result = applyHostLabelPatch(`${SOURCE}\n${SOURCE}`, COMPACTION_DIVIDER_PATCH)
    expect(result.replacements).toBe(2)
    expect(result.text).not.toContain('? "Provider compaction"')
  })
})

describe("hostLabelFile resolution", () => {
  test("explicit argument wins", () => {
    expect(hostLabelFile("/tmp/custom.tsx", {}, "/home/x")).toBe("/tmp/custom.tsx")
  })

  test("env override wins over the default clone", () => {
    expect(hostLabelFile(undefined, { GOAL_LOOP_OPENCODE_TUI: "/tmp/env.tsx" }, "/home/x")).toBe("/tmp/env.tsx")
  })

  test("default is the local dev clone relative to HOME", () => {
    expect(hostLabelFile(undefined, {}, "/home/pauk")).toBe(
      "/home/pauk/Projects/opencode/packages/tui/src/routes/session/index.tsx",
    )
  })
})

describe("standalone CLI patch-host", () => {
  const makeFile = () => {
    const dir = mkdtempSync(join(tmpdir(), "goal-loop-labels-"))
    const file = join(dir, "index.tsx")
    writeFileSync(file, SOURCE, "utf8")
    return { dir, file }
  }

  test("CLI constants match the core module (standalone copy cannot drift)", () => {
    const cli = readFileSync(new URL("../bin/goal-loop.mjs", import.meta.url), "utf8")
    expect(cli).toContain(`const LABEL_FROM = '${COMPACTION_DIVIDER_PATCH.from}';`)
    expect(cli).toContain(`const LABEL_TO = '${COMPACTION_DIVIDER_PATCH.to}';`)
    expect(cli).toContain(`const HOST_LABEL_FILE = "${COMPACTION_DIVIDER_PATCH.file}";`)
  })

  test("applies the rename, backs up first, and is idempotent", () => {
    const { dir, file } = makeFile()
    try {
      const first = patchHost([file])
      expect(first.code).toBe(0)
      expect(readFileSync(file, "utf8")).toContain('? "Context Cleared"')
      expect(readdirSync(dir).filter((n) => n.endsWith(".bak")).length).toBe(1)

      const second = patchHost([file])
      expect(second.code).toBe(0)
      expect(second.stdout).toContain("already patched")
      expect(readdirSync(dir).filter((n) => n.endsWith(".bak")).length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("--dry-run reports the change without writing or backing up", () => {
    const { dir, file } = makeFile()
    try {
      const result = patchHost([file, "--dry-run"])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("dry-run")
      expect(readFileSync(file, "utf8")).toBe(SOURCE)
      expect(readdirSync(dir).filter((n) => n.endsWith(".bak")).length).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("missing file and missing label both fail with a clear message", () => {
    const { dir, file } = makeFile()
    try {
      expect(patchHost([join(dir, "missing.tsx")]).code).toBe(1)
      writeFileSync(file, "unrelated\n", "utf8")
      const r = patchHost([file])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain("upstream moved it")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("runCli dispatches patch-host and includes it in --help", async () => {
    const { dir, file } = makeFile()
    try {
      const r = await runCli(["patch-host", file, "--dry-run"], { env: {}, cwd: dir })
      expect(r.code).toBe(0)
      expect(r.stdout).toContain("dry-run")
      const help = await runCli(["--help"])
      expect(help.stdout).toContain("goal-loop patch-host")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
