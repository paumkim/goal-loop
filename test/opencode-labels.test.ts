import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  COMPACTION_DIVIDER_PATCH,
  HOST_LABEL_PATCHES,
  INSTALLED_BINARY_DIVIDER_PATCH,
  INSTALLED_BINARY_LABEL_PATCH,
  applyHostLabelPatch,
  applyInstalledBinaryLabelPatch,
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

  test("the running binary's divider is a separate, exact-match rename", () => {
    expect(INSTALLED_BINARY_DIVIDER_PATCH).toEqual({
      file: "bin/opencode",
      from: '?"Provider compaction":"Compaction"',
      to: '?"Context Cleared    ":"Compaction"',
    })
    expect(HOST_LABEL_PATCHES).toContain(INSTALLED_BINARY_DIVIDER_PATCH)
    // A Bun-compiled binary keeps string lengths in its metadata: a shorter replacement breaks it.
    expect(Buffer.byteLength(INSTALLED_BINARY_DIVIDER_PATCH.to)).toBe(
      Buffer.byteLength(INSTALLED_BINARY_DIVIDER_PATCH.from),
    )
    // The bare label also occurs in error messages; the patch must not match those.
    expect("Provider compaction is not supported".includes(INSTALLED_BINARY_DIVIDER_PATCH.from)).toBe(false)
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

  test("binary patch renames the code literal and the string-table entry, not error messages", () => {
    const source =
      `?"Provider compaction":"Compaction"` +
      `\x00Provider compaction\x00` +
      `Provider compaction is not supported by x/y (z)`
    const result = applyInstalledBinaryLabelPatch(source)
    expect(result.replacements).toBe(2)
    expect(result.text).toContain(INSTALLED_BINARY_DIVIDER_PATCH.to)
    expect(result.text).toContain(`\x00${INSTALLED_BINARY_LABEL_PATCH.to}\x00`)
    expect(result.text).toContain("Provider compaction is not supported by x/y (z)")
    expect(Buffer.byteLength(result.text)).toBe(Buffer.byteLength(source))
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
    expect(cli).toContain(`const BINARY_LABEL_FROM = '${INSTALLED_BINARY_DIVIDER_PATCH.from}';`)
    expect(cli).toContain(`const BINARY_LABEL_TO = '${INSTALLED_BINARY_DIVIDER_PATCH.to}';`)
    expect(cli).toContain(`const BINARY_STANDALONE_FROM = "${INSTALLED_BINARY_LABEL_PATCH.from}";`)
    expect(cli).toContain(`const BINARY_STANDALONE_TO = "${INSTALLED_BINARY_LABEL_PATCH.to}";`)
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

  test("runCli without a path uses the env override, not the command name", async () => {
    const { dir, file } = makeFile()
    try {
      const env = { GOAL_LOOP_OPENCODE_TUI: file }
      const dry = await runCli(["patch-host", "--dry-run"], { env, cwd: dir })
      expect(dry.code).toBe(0)
      expect(dry.stdout).toContain(file)
      expect(dry.stdout).toContain("dry-run")
      expect(readFileSync(file, "utf8")).toBe(SOURCE)

      const applied = await runCli(["patch-host"], { env, cwd: dir })
      expect(applied.code).toBe(0)
      expect(applied.stdout).toContain("Context Cleared")
      expect(readFileSync(file, "utf8")).toContain('? "Context Cleared"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("installed-binary divider patch", () => {
  // latin1 keeps the fixture byte-exact the way patchHost handles a real binary.
  const BINARY = Buffer.from(
    `\x00\xff${INSTALLED_BINARY_DIVIDER_PATCH.from}\x01` +
      `\x13\x00\x00\x80\x49\x37\xe6\x00${INSTALLED_BINARY_LABEL_PATCH.from}\x00\x0b\x00` +
      `Provider compaction is not supported by x/y (z)\x00` +
      `Provider compaction is not supported by a/b (c)\x00`,
    "latin1",
  )
  const makeBinary = () => {
    const dir = mkdtempSync(join(tmpdir(), "goal-loop-binary-"))
    const file = join(dir, "opencode")
    writeFileSync(file, BINARY)
    return { dir, file }
  }

  test("renames only the divider, keeping error-message bytes intact", () => {
    const { dir, file } = makeBinary()
    try {
      const first = patchHost([file, "--binary"])
      expect(first.code).toBe(0)
      const after = readFileSync(file)
      expect(after.toString("latin1")).toContain(INSTALLED_BINARY_DIVIDER_PATCH.to)
      expect(after.toString("latin1")).toContain(INSTALLED_BINARY_LABEL_PATCH.to)
      expect(after.toString("latin1")).not.toContain(INSTALLED_BINARY_DIVIDER_PATCH.from)
      expect(after.toString("latin1")).not.toContain(
        `\x00${INSTALLED_BINARY_LABEL_PATCH.from}\x00`,
      )
      expect(after.toString("latin1")).toContain("Provider compaction is not supported by x/y (z)")
      expect(after.toString("latin1")).toContain("Provider compaction is not supported by a/b (c)")
      expect(after.length).toBe(BINARY.length) // byte-exact, length-preserving
      expect(after[0]).toBe(0)
      expect(after[1]).toBe(0xff)

      const second = patchHost([file, "--binary"])
      expect(second.code).toBe(0)
      expect(second.stdout).toContain("already patched")
      expect(readFileSync(file)).toEqual(after)
      expect(readdirSync(dir).filter((n) => n.endsWith(".bak")).length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("dry-run reports without writing; CLI honors the binary env override and flag", async () => {
    const { dir, file } = makeBinary()
    try {
      const dry = await runCli(["patch-host", "--binary", "--dry-run"], {
        env: { GOAL_LOOP_OPENCODE_BIN: file },
        cwd: dir,
      })
      expect(dry.code).toBe(0)
      expect(dry.stdout).toContain("dry-run")
      expect(readFileSync(file)).toEqual(BINARY)

      const applied = await runCli(["patch-host", "--binary"], {
        env: { GOAL_LOOP_OPENCODE_BIN: file },
        cwd: dir,
      })
      expect(applied.code).toBe(0)
      expect(readFileSync(file).toString("latin1")).toContain(INSTALLED_BINARY_DIVIDER_PATCH.to)
      const help = await runCli(["--help"])
      expect(help.stdout).toContain("--binary")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
