/**
 * Cold-start bootstrap for coordinator layout.
 *
 * A user who installs the plugin and runs /goal from a fresh project dir should
 * get `.term/coordinator` and `worktrees/` set up automatically. Everything
 * here is best effort and idempotent: existing files are never overwritten, and
 * any failure is swallowed so plugin setup cannot crash.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export interface BootstrapResult {
  readonly created: string[]
  readonly skipped: string[]
}

/**
 * The plugin root from the directory the plugin module lives in.
 *
 * Falls back to the parent of `metaDir` (the `src` directory's parent), but
 * walks up at most 5 levels looking for `packages/coordinator/bin/coordinator`
 * and returns the first directory that contains it.
 */
export function pluginRootFromMeta(metaDir: string): string {
  let dir = resolve(metaDir)
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "packages", "coordinator", "bin", "coordinator"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(metaDir, "..")
}

/**
 * Where the coordinator binary lives: the plugin checkout first, then the
 * project checkout. Returns an absolute path or `undefined` when neither
 * location has the binary.
 */
export function resolveCoordinatorBin(pluginRoot: string | undefined, projectRoot: string | undefined): string | undefined {
  const candidates: string[] = []
  if (pluginRoot) candidates.push(join(pluginRoot, "packages", "coordinator", "bin", "coordinator"))
  if (projectRoot) candidates.push(join(projectRoot, "packages", "coordinator", "bin", "coordinator"))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate)
  }
  return undefined
}

/** Whether `jq` is on PATH. Never throws. */
export function hasJq(): boolean {
  try {
    const result = spawnSync("sh", ["-c", "command -v jq"], { stdio: "ignore" })
    return result.status === 0
  } catch {
    return false
  }
}

/**
 * Creates `.term/coordinator` and `worktrees/` under `projectRoot` and seeds
 * `config.json` / `state.json` when they are missing. Never overwrites
 * existing files. Appends `worktrees/` and `.term/coordinator/*.lock` to
 * `.gitignore` when it exists and lacks them (idempotent). No-op outside a
 * git repository.
 */
export function ensureCoordinatorLayout(projectRoot: string, pluginRoot?: string): BootstrapResult {
  const created: string[] = []
  const skipped: string[] = []
  try {
    if (!existsSync(join(projectRoot, ".git"))) {
      return { created: [], skipped: ["not a git repository"] }
    }
    const coordDir = join(projectRoot, ".term", "coordinator")
    const worktreesDir = join(projectRoot, "worktrees")
    if (existsSync(coordDir)) skipped.push(".term/coordinator")
    else {
      mkdirSync(coordDir, { recursive: true })
      created.push(".term/coordinator")
    }
    if (existsSync(worktreesDir)) skipped.push("worktrees")
    else {
      mkdirSync(worktreesDir, { recursive: true })
      created.push("worktrees")
    }
    const configPath = join(coordDir, "config.json")
    if (existsSync(configPath)) skipped.push(".term/coordinator/config.json")
    else {
      writeFileSync(configPath, `${JSON.stringify({ devBranch: "dev", worktreeDir: "worktrees" })}\n`, "utf8")
      created.push(".term/coordinator/config.json")
    }
    const statePath = join(coordDir, "state.json")
    if (existsSync(statePath)) skipped.push(".term/coordinator/state.json")
    else {
      writeFileSync(statePath, `${JSON.stringify({ version: 1, leases: {}, mergeLock: null })}\n`, "utf8")
      created.push(".term/coordinator/state.json")
    }
    void pluginRoot
    const gitignorePath = join(projectRoot, ".gitignore")
    if (existsSync(gitignorePath)) {
      let content = ""
      try {
        content = readFileSync(gitignorePath, "utf8")
      } catch {
        content = ""
      }
      const lines = content.split("\n").map((line) => line.trim())
      const wanted = ["worktrees/", ".term/coordinator/*.lock"]
      const missing = wanted.filter((entry) => !lines.includes(entry))
      if (missing.length > 0) {
        const prefix = content.length === 0 || content.endsWith("\n") ? "" : "\n"
        writeFileSync(gitignorePath, content + prefix + missing.join("\n") + "\n", "utf8")
        created.push(".gitignore")
      } else {
        skipped.push(".gitignore")
      }
    }
  } catch {
    // Best effort: report whatever was done so far, never throw.
  }
  return { created, skipped }
}
