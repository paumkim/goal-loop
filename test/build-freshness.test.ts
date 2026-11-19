/**
 * The TUI artifact gate. `dist/tui.js` is shipped precompiled, and until this gate existed `bun run check`
 * rebuilt it without ever comparing the result to the committed copy — a stale artifact (committed TUI
 * behind `src/tui.tsx`) passed every check and shipped. These tests pin both directions: fresh passes,
 * stale and missing fail, and a failing check never repairs the file it is complaining about.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const root = join(import.meta.dir, "..")
const run = (args: string[]) => {
  const result = Bun.spawnSync(["bun", "scripts/build.ts", ...args], { cwd: root })
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "goal-dist-"))
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
  return dir
}
describe("dist/tui.js freshness gate", () => {
  test("the committed artifact matches a fresh build", () => {
    const result = run(["--check"])
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("matches a fresh build")
  })
  test("a stale artifact fails the check and is left exactly as it was", () => {
    const file = join(scratch(), "tui.js")
    writeFileSync(file, "// stale artifact\n")
    const result = run(["--check", "--target", file])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("is stale")
    expect(result.stderr).toContain("bun run compile")
    expect(readFileSync(file, "utf8")).toBe("// stale artifact\n") // never repaired by the check
  })
  test("a missing artifact fails the check with the repair instruction", () => {
    const file = join(scratch(), "absent.js")
    const result = run(["--check", "--target", file])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("is missing")
    expect(result.stderr).toContain("bun run compile")
  })
})
