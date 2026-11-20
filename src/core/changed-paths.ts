import { execFileSync } from "node:child_process"

type GitRun = (args: string[]) => string | undefined

interface CollectChangedPathsOptions {
  /** How to report untracked files in porcelain. "all" lists each file individually. Default "normal" (git default). */
  readonly untrackedFiles?: "normal" | "all"
  /** Integration base refs to diff against, in preference order. */
  readonly baseRefs?: readonly string[]
  /** Return [] on any failure instead of throwing. */
  readonly bestEffort?: boolean
}

/** Integration refs consulted (in order) to find the merge-base for committed changes. */
const DEFAULT_INTEGRATION_BASE_REFS = ["dev", "origin/dev", "main", "origin/main"] as const

/**
 * Create a git command runner bound to `cwd`.
 * Returns stdout with the trailing newline stripped, or `undefined` on error.
 * Preserves leading whitespace (porcelain status uses significant leading space).
 */
export function createGitRun(cwd: string): GitRun {
  return (args) => {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).replace(/\n$/, "")
    } catch {
      return undefined
    }
  }
}

/** Stable, de-duplicated list of changed paths (repo-root relative, POSIX) parsed from git output lines. */
export function pathsOf(lines: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "")
    if (!line.trim()) continue
    // porcelain "XY path" or "XY orig -> path" (leading status chars are significant)
    if (/^.. /.test(line)) {
      const body = line.slice(3)
      const renamed = body.includes(" -> ") ? body.split(" -> ").pop()! : body
      out.add(renamed.trim())
      continue
    }
    out.add(line.trim())
  }
  return [...out].sort()
}

/** Resolve the merge-base of HEAD with the first matching integration ref. */
export function resolveIntegrationBase(
  run: GitRun,
  refs: readonly string[] = DEFAULT_INTEGRATION_BASE_REFS,
): string | undefined {
  for (const ref of refs) {
    const mb = run(["merge-base", "HEAD", ref])
    if (mb?.trim()) return mb.trim()
  }
  return undefined
}

/**
 * Collect changed paths in a git working directory.
 * Union of working-tree/index changes (`git status --porcelain`) and commits on HEAD
 * not reachable from the merge-base with an integration ref.
 */
export function collectChangedPaths(cwd = process.cwd(), options: CollectChangedPathsOptions = {}): string[] {
  const run = (): string[] => {
    const git = createGitRun(cwd)
    const lines: string[] = []
    const statusArgs = ["status", "--porcelain"]
    if (options.untrackedFiles === "all") statusArgs.push("--untracked-files=all")
    const porcelain = git(statusArgs)
    if (porcelain) lines.push(...porcelain.split("\n"))
    const base = resolveIntegrationBase(git, options.baseRefs ?? DEFAULT_INTEGRATION_BASE_REFS)
    if (base) {
      const committed = git(["diff", "--name-only", "--diff-filter=ACMRD", `${base}..HEAD`])
      if (committed?.trim()) lines.push(...committed.split("\n"))
    }
    return pathsOf(lines)
  }
  if (options.bestEffort) {
    try {
      return run()
    } catch {
      return []
    }
  }
  return run()
}
