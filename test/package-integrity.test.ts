/**
 * Package integrity: pins package.json to the ACTUAL tarball npm would publish.
 * Every files/bin/exports entry must exist on disk; the bin stub must be executable; test files, CI config,
 * coordinator state and worktree must not leak into the tarball; the dry-run listing must match the real
 * packed artifact; and the packed plugin must load through the same path `bun run check:tui` uses
 * (scripts/tui-load-check.ts). Temp artifacts live in a throwaway dir inside the repo (module resolution
 * walks up from the extracted package to the repo's node_modules) and are removed afterwards.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const MAX = 64 * 1024 * 1024
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  files: string[]
  bin: Record<string, string>
  exports: Record<string, { types?: string; default?: string } | string>
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** Artefacts that must never end up in the published tarball. */
const FORBIDDEN: readonly RegExp[] = [
  /(^|\/)test(\/|$)/,
  /(^|\/)\.github(\/|$)/,
  /(^|\/)\.term(\/|$)/,
  /(^|\/)worktree(\/|$)/,
  /(^|\/)worktrees(\/|$)/, // legacy dir must not leak into the tarball either
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)scripts(\/|$)/,
  /(^|\/)opencode\.jsonc?$/,
  /\.test\.tsx?$/,
]
const forbiddenIn = (paths: readonly string[]): string[] => paths.filter((path) => FORBIDDEN.some((pattern) => pattern.test(path)))

const packPaths = (args: string[]): { filename: string; paths: string[] } => {
  const out = execFileSync("npm", ["pack", "--ignore-scripts", "--json", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: MAX,
  })
  const parsed = JSON.parse(out) as ReadonlyArray<{ filename: string; files: ReadonlyArray<{ path: string }> }>
  const entry = parsed[0]
  if (!entry) throw new Error("npm pack returned no entry")
  return { filename: entry.filename, paths: entry.files.map((file) => file.path) }
}

let cleanup: string[] = []
afterEach(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
  cleanup = []
})

describe("package integrity", () => {
  test("every files entry exists on disk", () => {
    for (const entry of pkg.files) {
      expect(existsSync(join(ROOT, entry)), `missing files entry: ${entry}`).toBe(true)
    }
  })

  test("every exports target exists on disk", () => {
    for (const [name, entry] of Object.entries(pkg.exports)) {
      if (typeof entry === "string") {
        expect(existsSync(join(ROOT, entry)), `missing exports[${name}] target: ${entry}`).toBe(true)
        continue
      }
      for (const [condition, target] of Object.entries(entry)) {
        expect(existsSync(join(ROOT, target)), `missing exports[${name}].${condition} target: ${target}`).toBe(true)
      }
    }
  })

  test("every exports entry declares a types condition before its default target", () => {
    for (const [name, entry] of Object.entries(pkg.exports)) {
      expect(typeof entry).toBe("object")
      if (typeof entry === "string") throw new Error(`exports[${name}] should not be a bare string`)
      expect(entry.types, `exports[${name}] is missing a types condition`).toBeDefined()
      expect(entry.default, `exports[${name}] is missing a default condition`).toBeDefined()
    }
    expect(readFileSync(join(ROOT, "dist/tui.d.ts"), "utf8").length).toBeGreaterThan(0) // dist/tui.js types are real
  })

  test("runtime-imported shipped code has its dependencies declared (string-width)", () => {
    expect(pkg.dependencies?.["string-width"]).toBe("7.2.0")
    expect(pkg.devDependencies?.["string-width"]).toBeUndefined()
  })

  test("the test script runs the suite from test/ (root-run breaks bunfig resolution)", () => {
    expect(pkg.scripts.test).toBe("cd test && bun test")
    expect(pkg.scripts.prepublishOnly).toContain("cd test && bun test")
  })

  test(".gitignore covers the coordinator lock artifacts the bin creates", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8")
    for (const pattern of [".term/coordinator/.claim-lock-file", ".term/coordinator/.merge-lock-file", ".term/coordinator/.claim-lock/", ".term/coordinator/.merge-lock/", ".term/coordinator/.state-stash.*", ".term/coordinator/.state.*"]) {
      expect(gitignore, `.gitignore is missing ${pattern}`).toContain(pattern)
    }
  })

  test("bin/goal-loop.mjs exists and carries the executable bit", () => {
    const bin = pkg.bin["goal-loop"]
    expect(bin).toBe("./bin/goal-loop.mjs")
    if (!bin) throw new Error("bin entry missing")
    const full = join(ROOT, bin)
    expect(existsSync(full)).toBe(true)
    expect(statSync(full).mode & 0o111).not.toBe(0)
  })

  test("packages/coordinator/bin/coordinator is shipped executable (invoked by direct path)", () => {
    const coordinator = join(ROOT, "packages/coordinator/bin/coordinator")
    expect(existsSync(coordinator)).toBe(true)
    expect(statSync(coordinator).mode & 0o111, "coordinator bin lost its executable bit").not.toBe(0)
  })

  test("npm pack --dry-run --json lists exactly package.json's declared coverage, nothing forbidden", () => {
    const { paths } = packPaths(["--dry-run"])
    for (const path of paths) expect(existsSync(join(ROOT, path)), `tarball file missing on disk: ${path}`).toBe(true)
    expect(forbiddenIn(paths)).toEqual([])
    for (const required of ["LICENSE", "README.md", "package.json", "index.ts", "tui.ts", "rpc.ts", "dist/tui.js", "bin/goal-loop.mjs", "install.sh", "packages/coordinator/bin/coordinator", "packages/coordinator/README.md"]) {
      expect(paths, `tarball is missing ${required}`).toContain(required)
    }
    expect(paths.length).toBe(159)
  })

  test("a real npm pack produces the identical file list as the dry-run", () => {
    const dry = packPaths(["--dry-run"]).paths.sort()
    const dir = mkdtempSync(join(ROOT, ".package-integrity-test-"))
    cleanup.push(dir)
    const real = packPaths(["--pack-destination", dir]).paths.sort()
    expect(real).toEqual(dry)
  })

  test("CHANGELOG and test spec-check marker files are not in the tarball", () => {
    const { paths } = packPaths(["--dry-run"])
    expect(paths).not.toContain("CHANGELOG")
    expect(paths).not.toContain("CHANGELOG.md")
    expect(paths).not.toContain("RELEASE-CHECKLIST.md")
    expect(forbiddenIn(paths)).toEqual([])
  })

  test("the packed plugin loads through the check:tui path", () => {
    const dir = mkdtempSync(join(ROOT, ".package-integrity-test-"))
    cleanup.push(dir)
    const { filename } = packPaths(["--pack-destination", dir])
    const extracted = join(dir, "extracted")
    mkdirSync(extracted)
    const unpack = spawnSync("tar", ["-xzf", join(dir, filename), "-C", extracted], { encoding: "utf8" })
    expect(unpack.status).toBe(0)
    const tuiEntry = join(extracted, "package", "tui.ts")
    expect(existsSync(tuiEntry)).toBe(true)
    const load = spawnSync("bun", ["scripts/tui-load-check.ts", tuiEntry], { cwd: ROOT, encoding: "utf8", maxBuffer: MAX })
    expect(load.status).toBe(0)
    expect(load.stdout).toContain('ok: loaded TUI plugin "goal-loop.tui"')
  }, 180_000)
})
