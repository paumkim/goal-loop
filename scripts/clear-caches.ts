/**
 * Remove build/plugin caches so the plugin runs from fresh source, then rebuild
 * and verify the plugin build output.
 *
 * Run: bun scripts/clear-caches.ts
 *
 * Covers the cache locations that can make a plugin load stale bytes:
 *  - Go build cache (`go env GOCACHE`) and module cache (`go env GOMODCACHE`)
 *  - OpenCode's cached plugin packages (~/.cache/opencode/npm)
 *  - `dist/` build output in this checkout and in coordinator worktrees
 *
 * `dist/` is rebuilt from `src/tui.tsx` after removal because the plugin's
 * `./tui` entry point imports it; leaving it deleted would break the plugin.
 */
import { existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")
const home = process.env.HOME
if (!home) throw new Error("HOME is not set")

const run = (argv: readonly string[], cwd?: string): string => {
  const result = Bun.spawnSync([...argv], { cwd, stdout: "pipe", stderr: "pipe" })
  const text = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
  if (result.exitCode !== 0) {
    throw new Error(`${argv.join(" ")} failed (exit ${result.exitCode}): ${text}`)
  }
  return text
}

const cachePaths: Array<{ label: string; path: string }> = [
  { label: "Go build cache", path: run(["go", "env", "GOCACHE"]) },
  { label: "Go module cache", path: run(["go", "env", "GOMODCACHE"]) },
  { label: "OpenCode plugin package cache", path: join(home, ".cache", "opencode", "npm") },
]

const staleWorktreeDist = (): string[] => {
  const parent = join(repoRoot, "worktree")
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, "dist"))
    .filter((path) => existsSync(path))
}

for (const { label, path } of cachePaths) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true })
    console.log(`removed ${label}: ${path}`)
  } else {
    console.log(`already absent ${label}: ${path}`)
  }
}

for (const path of staleWorktreeDist()) {
  rmSync(path, { recursive: true, force: true })
  console.log(`removed stale worktree dist: ${path}`)
}

const repoDist = join(repoRoot, "dist")
if (existsSync(repoDist)) {
  rmSync(repoDist, { recursive: true, force: true })
  console.log(`removed plugin build output: ${repoDist}`)
}

console.log(run(["bun", "run", "compile"], repoRoot))
console.log(run(["bun", "run", "check:dist"], repoRoot))

for (const { label, path } of cachePaths) {
  if (existsSync(path)) throw new Error(`stale ${label} remains: ${path}`)
}
if (!existsSync(join(repoRoot, "dist", "tui.js"))) {
  throw new Error("dist/tui.js was not rebuilt from source")
}
if (staleWorktreeDist().length > 0) throw new Error("stale worktree dist remains")
console.log("verified: no stale build or plugin cache remains; dist rebuilt from source")
