/**
 * Repository inspection for the commit rule.
 *
 * The goal loop tells the agent to commit finished work before the goal counts as met, so the work survives
 * outside the working tree. The rule only means something inside a git repository, and the plugin cannot run git
 * commands, so it reads the repository's own files: `.git` for the repository, `HEAD` for the checked out branch,
 * `refs/heads` and `packed-refs` for the branches that exist.
 *
 * Everything here is best effort. A file that cannot be read is treated as absent, because a repository the
 * plugin cannot inspect is a repository it must not make promises about.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { CommitPolicy, CommitRequest } from "./types.ts"

export interface Repository {
  /** The directory that holds the repository. */
  readonly root: string
  /** The directory that holds the git metadata. */
  readonly gitDir: string
}

/** Walks up from `start` until it finds the directory that owns a repository. */
export function findRepository(start: string): Repository | undefined {
  let dir = resolve(start)
  for (;;) {
    const found = repositoryAt(dir)
    if (found) return found
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Resolve the directory that owns repo-scoped artifacts (`.term/...`) for a working directory.
 *
 * When `directory` is a subfolder of a git repository, this returns the repository root — never the
 * subfolder. Outside a repository it returns the resolved directory itself. Keeping this in one place
 * is what makes the plugin distinguish "launched from the repo root" from "launched from a subfolder":
 * every `.term` writer (bootstrap scaffold, learning log, failure diagnostics) anchors here, so a
 * first run started under `docs/` still creates `.term` at the project root and never scatters copies
 * into nested folders.
 */
export function resolveProjectRoot(directory: string): string {
  return findRepository(directory)?.root ?? resolve(directory)
}

function repositoryAt(dir: string): Repository | undefined {
  const marker = join(dir, ".git")
  if (!existsSync(marker)) return undefined
  try {
    if (statSync(marker).isDirectory()) return { root: dir, gitDir: marker }
    // A worktree or a submodule: `.git` is a file that points at the real git directory.
    const pointer = readFileSync(marker, "utf8")
    const match = /^gitdir:\s*(.+)$/m.exec(pointer)
    const target = match?.[1]?.trim()
    if (!target) return undefined
    const gitDir = isAbsolute(target) ? target : resolve(dir, target)
    return existsSync(gitDir) ? { root: dir, gitDir } : undefined
  } catch {
    return undefined
  }
}

/** The branch HEAD points at, or undefined when HEAD is detached or unreadable. */
export function currentBranch(gitDir: string): string | undefined {
  const head = read(join(gitDir, "HEAD"))
  if (!head) return undefined
  const match = /^ref:\s*refs\/heads\/(.+)$/m.exec(head.trim())
  return match?.[1]?.trim()
}

/** Whether the branch exists, either as a loose ref or inside `packed-refs`. */
export function branchExists(gitDir: string, branch: string): boolean {
  const ref = `refs/heads/${branch}`
  for (const dir of refDirs(gitDir)) {
    if (existsSync(join(dir, "refs", "heads", branch))) return true
    const packed = read(join(dir, "packed-refs"))
    if (!packed) continue
    for (const line of packed.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) continue
      const parts = trimmed.split(/\s+/)
      if (parts[1] === ref) return true
    }
  }
  return false
}

/**
 * The directories that hold `refs/heads`.
 *
 * A worktree keeps its own `HEAD` but shares the branches with the main repository, so a worktree's git
 * directory points at a `commondir` that holds the real refs. Both are checked.
 */
function refDirs(gitDir: string): string[] {
  const dirs = [gitDir]
  const common = read(join(gitDir, "commondir"))
  if (common) {
    const target = common.trim()
    if (target) dirs.push(isAbsolute(target) ? target : resolve(gitDir, target))
  }
  return dirs
}

/**
 * The sha HEAD resolves to right now, or undefined when it cannot be read.
 *
 * Contract: never throws. Detached HEAD answers the recorded sha; an attached HEAD resolves
 * through the loose ref first and `packed-refs` second (a worktree shares refs with its main
 * repository, so the same `commondir` fallback used for branches applies here too).
 */
export function headSha(gitDir: string): string | undefined {
  try {
    const head = read(join(gitDir, "HEAD"))?.trim()
    if (!head) return undefined
    if (/^[0-9a-f]{40}$/i.test(head) || /^[0-9a-f]{64}$/i.test(head)) return head.toLowerCase()
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1]
    if (!ref) return undefined
    for (const dir of refDirs(gitDir)) {
      const loose = read(join(dir, ref))?.trim()
      if (loose && (/^[0-9a-f]{40}$/i.test(loose) || /^[0-9a-f]{64}$/i.test(loose))) return loose.toLowerCase()
      const packed = read(join(dir, "packed-refs"))
      if (!packed) continue
      for (const line of packed.split("\n")) {
        const parts = line.trim().split(/\s+/)
        const packedSha = parts[0] ?? ""
        // SHA-1 repos pack 40-hex shas; SHA-256 repos pack 64-hex shas.
        if (parts.length === 2 && parts[1] === ref && (/^[0-9a-f]{40}$/i.test(packedSha) || /^[0-9a-f]{64}$/i.test(packedSha)))
          return packedSha.toLowerCase()
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Turns the user's request into the rule that applies to one session.
 *
 * The rule needs a repository to be meaningful, so it is switched off outside one. Inside a repository the
 * requested branch is used when it exists, and the checked out branch is used when it does not: telling the agent
 * to commit to a branch the repository has never had would make it create one, which is a change to the
 * repository the goal never asked for.
 */
export function resolveCommitPolicy(request: CommitRequest, directory: string, coordinatorBin?: string): CommitPolicy {
  if (!request.enabled) return { required: false, branch: request.branch, mode: "direct", reason: "disabled by configuration" }
  const repository = findRepository(directory)
  if (!repository) return { required: false, branch: request.branch, mode: "direct", reason: "not a git repository" }
  const coordinatorOn = request.coordinator === undefined || request.coordinator === "auto" || request.coordinator === true
  if (coordinatorOn) {
    const detected = detectCoordinator(repository.root, coordinatorBin)
    if (detected) {
      const target = detected.devBranch ?? (branchExists(repository.gitDir, request.branch) ? request.branch : undefined) ?? currentBranch(repository.gitDir) ?? request.branch
      return {
        required: true,
        branch: target,
        mode: "coordinator",
        reason: "coordinator repository detected; wt/<slug> + submit flow",
        ...(detected.coordinatorBin ? { coordinatorBin: detected.coordinatorBin } : {}),
        worktreeDir: detected.worktreeDir,
      }
    }
    if (request.coordinator === true) {
      const target = branchExists(repository.gitDir, request.branch) ? request.branch : currentBranch(repository.gitDir) ?? request.branch
      return {
        required: true,
        branch: target,
        mode: "coordinator",
        reason: "coordinator mode forced by configuration",
        ...(coordinatorBin ? { coordinatorBin } : {}),
        worktreeDir: "worktree",
      }
    }
  }
  if (branchExists(repository.gitDir, request.branch))
    return { required: true, branch: request.branch, mode: "direct", reason: "repository found" }
  const head = currentBranch(repository.gitDir)
  if (head)
    return { required: true, branch: head, mode: "direct", reason: `branch ${request.branch} does not exist; using ${head}` }
  return { required: true, branch: request.branch, mode: "direct", reason: "repository found" }
}

interface CoordinatorDetection {
  /** Absolute path to the coordinator wrapper; omitted when no binary can be located (never repo-relative). */
  readonly coordinatorBin?: string
  readonly worktreeDir: string
  readonly devBranch?: string
}

export function detectCoordinator(root: string, pluginBin?: string): CoordinatorDetection | undefined {
  const configPath = join(root, ".term", "coordinator", "config.json")
  const statePath = join(root, ".term", "coordinator", "state.json")
  const projectBin = join(root, "packages", "coordinator", "bin", "coordinator")
  const hasConfig = existsSync(configPath)
  const hasState = existsSync(statePath)
  const hasProjectBin = existsSync(projectBin)
  const binExists = hasProjectBin || (pluginBin ? existsSync(pluginBin) : false)
  const detected = (hasConfig && hasState) || (binExists && (hasConfig || hasState))
  if (!detected) return undefined
  let devBranch: string | undefined
  let worktreeDir = "worktree"
  try {
    const raw = readFileSync(configPath, "utf8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.devBranch === "string" && parsed.devBranch.trim() !== "") devBranch = parsed.devBranch.trim()
    if (typeof parsed.worktreeDir === "string" && parsed.worktreeDir.trim() !== "") worktreeDir = parsed.worktreeDir.trim()
  } catch {
    // Config unreadable: detection still holds on markers alone.
  }
  let coordinatorBin: string | undefined
  if (hasProjectBin) coordinatorBin = projectBin
  else if (pluginBin && existsSync(pluginBin)) coordinatorBin = pluginBin
  // No absolute bin anywhere: detection still holds on the json markers, but the policy carries no bin path.
  return { ...(coordinatorBin ? { coordinatorBin } : {}), worktreeDir, ...(devBranch ? { devBranch } : {}) }
}


function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}
