/**
 * Cold-start bootstrap for startup/workflow layout.
 *
 * On first bootstrap in a git repo (and safely on subsequent runs), provisions an idempotent
 * workflow scaffold: coordinator/workplace layout, goal runtime dirs, workflow docs/templates, and
 * gitignore rules for runtime artifacts. Everything is best effort and idempotent: existing files
 * are never overwritten, and failures are swallowed so plugin setup/goal arming cannot crash.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  appendGitignoreRules,
  ensureCoordinatorWorkplaceLayout,
  ensureGitRepoStartup,
  ensureRuntimeOnlyStartup,
  RUNTIME_GITIGNORE_RULES,
  type WorkflowLayoutResult,
} from "./workflow.ts"

interface BootstrapResult {
  readonly created: string[]
  readonly skipped: string[]
  readonly notes?: string[]
}

/**
 * The plugin root from the directory the plugin module lives in.
 *
 * Walks up at most 5 levels looking for `packages/coordinator/bin/coordinator`
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
 * Ensures coordinator/workplace layout in a git repository (`.term/coordinator/{config,state}.json`,
 * `worktrees/`) and appends missing runtime gitignore rules. Idempotent and never overwrites
 * existing files. No-op outside a git repository.
 *
 * This provisions the layout for any git repo so the claim → worktree → submit → merge-next flow
 * can be ready (subject to coordinator bin availability and commit/coordinator policy).
 */
export function ensureCoordinatorLayout(projectRoot: string, pluginRoot?: string): BootstrapResult {
  void pluginRoot
  const created: string[] = []
  const skipped: string[] = []
  try {
    if (!existsSync(join(projectRoot, ".git"))) {
      return { created: [], skipped: ["not a git repository"] }
    }
    const coord = ensureCoordinatorWorkplaceLayout(projectRoot)
    created.push(...coord.created)
    skipped.push(...coord.existing)
    const gi = appendGitignoreRules(projectRoot, RUNTIME_GITIGNORE_RULES)
    if (gi.added.length > 0) created.push(".gitignore")
    else skipped.push(".gitignore")
  } catch {
    // Best effort: report whatever was done so far, never throw.
  }
  return { created, skipped }
}

interface StartupScaffoldOptions {
  readonly projectRoot: string
  readonly pluginRoot?: string
  /** Learning log path from config (relative to project root or absolute). */
  readonly learningPath?: string
}

/**
 * Full startup scaffold for plugin bootstrap / goal arming. In git repos provisions coordinator
 * workplace layout, goal runtime dirs, workflow docs/templates (SPEC.md, docs/README.md, MAINTAINER.md),
 * and appends missing gitignore rules for runtime artifacts. Outside git repos provisions runtime-only
 * goal dirs with a clear note. Always idempotent, never overwrites, never throws.
 */
export function ensureStartupScaffold(options: StartupScaffoldOptions): WorkflowLayoutResult {
  const { projectRoot, pluginRoot, learningPath } = options
  void pluginRoot
  try {
    if (!existsSync(join(projectRoot, ".git"))) {
      return ensureRuntimeOnlyStartup({ projectRoot, learningPath })
    }
    return ensureGitRepoStartup({ projectRoot, learningPath })
  } catch (error) {
    return { created: [], existing: [], notes: [`startup scaffold failed: ${String(error)}`] }
  }
}

// Re-export workflow helpers for direct use/tests.
export {
  appendGitignoreRules,
  docsReadmeTemplate,
  ensureCoordinatorWorkplaceLayout,
  ensureGoalRuntimeLayout,
  ensureWorkflowDocs,
  maintainerTemplate,
  RUNTIME_GITIGNORE_RULES,
  specTemplate,
} from "./workflow.ts"
