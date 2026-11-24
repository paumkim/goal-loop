import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { COLD_REPLAY } from "../src/index.ts"

/**
 * The upstream host TUI renders the compaction divider as
 *   status === "completed" && message.native?.messages ? "Provider compaction" : "Compaction"
 * with no slot, theme token or config key to override the label. goal-loop cannot rename that text
 * from a plugin without writing outside this repo (host source or installed binary), so a cold reset
 * avoids the trigger instead. These tests pin the exact condition and the replacement replay shape.
 */
describe("cold replay avoids the provider-compaction divider", () => {
  test("no native window reaches the host", () => {
    expect(COLD_REPLAY).not.toHaveProperty("native")
    expect((COLD_REPLAY as { native?: unknown }).native).toBeUndefined()
  })

  test("the upstream divider condition is false for a cold checkpoint", () => {
    const message: { status: string; native?: { messages?: unknown[] } } = {
      status: "completed",
      ...COLD_REPLAY,
    }
    // The condition read out of the installed upstream binary.
    const providerCompaction = message.status === "completed" && Boolean(message.native?.messages)
    expect(providerCompaction).toBe(false)
  })

  test("replays as an empty checkpoint, not a native window", () => {
    expect(COLD_REPLAY.summary).toBe("")
    // SessionRecentText.kept() reads metadata.recent; an empty value keeps old text out of the checkpoint.
    expect(COLD_REPLAY.metadata.recent).toBe("")
  })

  test("the CLI owns no out-of-directory patch command", () => {
    const cli = readFileSync(new URL("../bin/goal-loop.mjs", import.meta.url), "utf8")
    expect(cli).not.toContain("patch-host")
    expect(cli).not.toContain("GOAL_LOOP_OPENCODE_TUI")
    expect(cli).not.toContain(".opencode/bin")
    expect(cli).not.toContain("Projects/opencode")
  })

  test("the plugin ships no host-source patch file", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      files: string[]
    }
    expect(pkg.files).not.toContain("patches")
  })
})
