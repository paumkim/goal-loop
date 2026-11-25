/**
 * Read-only re-anchor audit for the loop re-arm step.
 *
 * Run: bun scripts/rearm.ts [--check]
 *
 * Every armed /goal-loop iteration re-reads the same evidence before touching
 * anything (AGENTS.md "Loop re-arm", docs/runtime.html "Re-read HEAD first"):
 *   git log --oneline -5, git status --short, git branch --show-current,
 *   plus coordinator status --json and git worktree list in a coordinator repo,
 *   plus the current check output. This prints that sequence from any directory
 *   in the repo, with the repo root and coordinator bin resolved from git (no
 *   hardcoded absolute paths, no secrets, no writes).
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

type Command = readonly string[]

const HELP = `Usage: bun scripts/rearm.ts [--check]

Read-only re-anchor audit for the loop re-arm step. Resolves the repo root from
git and prints the same evidence the loop re-reads before touching anything:

  git log --oneline -5         HEAD history
  git status --short           working-tree state
  git branch --show-current    current branch
  coordinator status --json    leases (coordinator repos only)
  git worktree list            worktrees (coordinator repos only)

Options:
  --check    also run \`bun run check\` and print its output (the check-output
             part of the re-arm sequence). Off by default to keep this fast.
  -h, --help show this help

Read-only: no files are changed and no state is written.`

const fail = (message: string): never => {
  console.error(`rearm: ${message}`)
  process.exit(1)
}

const run = (argv: Command, cwd: string): { out: string; err: string; code: number } => {
  const result = Bun.spawnSync([...argv], { cwd, stdout: "pipe", stderr: "pipe" })
  return {
    out: result.stdout.toString().replace(/\n$/, ""),
    err: result.stderr.toString().replace(/\n$/, ""),
    code: result.exitCode ?? 1,
  }
}

const parseArgs = (): boolean => {
  let withCheck = false
  for (const arg of process.argv.slice(2)) {
    if (arg === "-h" || arg === "--help") {
      console.log(HELP)
      process.exit(0)
    }
    if (arg === "--check") {
      withCheck = true
      continue
    }
    fail(`unknown argument ${JSON.stringify(arg)} (try --help)`)
  }
  return withCheck
}

const section = (label: string, argv: Command, cwd: string): void => {
  console.log(`== ${label} ==`)
  const result = run(argv, cwd)
  if (result.out) console.log(result.out)
  if (result.err) console.error(result.err)
  if (result.code !== 0) fail(`${label} failed (exit ${result.code})${result.err ? `: ${result.err}` : ""}`)
  console.log()
}

const main = async (): Promise<void> => {
  const withCheck = parseArgs()

  const root = run(["git", "rev-parse", "--show-toplevel"], process.cwd())
  if (root.code !== 0) fail("not inside a git repository (git rev-parse --show-toplevel failed)")
  const repoRoot = root.out.trim()
  if (!repoRoot) fail("git rev-parse --show-toplevel returned an empty path")

  section("git log --oneline -5", ["git", "log", "--oneline", "-5"], repoRoot)
  section("git status --short", ["git", "status", "--short"], repoRoot)
  section("git branch --show-current", ["git", "branch", "--show-current"], repoRoot)

  const coordinatorBin = join(repoRoot, "packages", "coordinator", "bin", "coordinator")
  const coordinatorConfig = join(repoRoot, ".term", "coordinator", "config.json")
  if (existsSync(coordinatorBin) && existsSync(coordinatorConfig)) {
    section("coordinator status --json", [coordinatorBin, "status", "--json"], repoRoot)
    section("git worktree list", ["git", "worktree", "list"], repoRoot)
  } else {
    console.log("== coordinator ==\nskipped (no coordinator bin/config)\n")
  }

  if (withCheck) {
    console.log("== bun run check ==")
    const child = Bun.spawn(["bun", "run", "check"], {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
    })
    const code = await child.exited
    if (code !== 0) fail(`bun run check failed (exit ${code})`)
    console.log()
  }

  console.log("rearm: audit complete (read-only)")
}

await main()
