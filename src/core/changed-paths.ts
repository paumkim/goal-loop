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

/**
 * Decode a git C-style quoted path (the default `core.quotePath` rendering) into a real path.
 * Unquoted paths are returned unchanged. Escapes: `\"`, `\\`, `\a\b\f\n\r\t\v`, and octal byte runs
 * (up to three digits) which are decoded as UTF-8. An unknown escape keeps its backslash.
 */
function decodeGitPath(path: string): string {
  if (path.length < 2 || path[0] !== '"' || path[path.length - 1] !== '"') return path
  const inner = path.slice(1, -1)
  const simple: Record<string, string> = {
    a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"',
  }
  let out = ""
  let octal: number[] = []
  const flushOctal = () => {
    if (octal.length) {
      out += Buffer.from(octal).toString("utf8")
      octal = []
    }
  }
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (ch !== "\\") {
      flushOctal()
      out += ch
      continue
    }
    const next = inner[++i]
    if (next === undefined) {
      flushOctal()
      out += "\\"
      break
    }
    if (next in simple) {
      flushOctal()
      out += simple[next]!
      continue
    }
    if (/[0-7]/.test(next)) {
      let digits = next
      while (digits.length < 3 && i + 1 < inner.length && /[0-7]/.test(inner[i + 1]!)) digits += inner[++i]
      octal.push(parseInt(digits, 8))
      continue
    }
    flushOctal()
    out += `\\${next}`
  }
  flushOctal()
  return out
}

/** Rename/copy status chars in porcelain v1 (`XY`), in either the index or worktree column. */
function isRenameOrCopy(status: string): boolean {
  return status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C"
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
      // Only renames/copies use the "orig -> dest" rendering; split on the FIRST separator so a destination
      // path that itself contains " -> " survives intact. Every other status line keeps its full path.
      if (isRenameOrCopy(line.slice(0, 2))) {
        const sep = body.indexOf(" -> ")
        if (sep !== -1) {
          out.add(decodeGitPath(body.slice(sep + 4).trim()))
          continue
        }
      }
      out.add(decodeGitPath(body.trim()))
      continue
    }
    out.add(decodeGitPath(line.trim()))
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
