/**
 * Startup workflow scaffold: templates and layout logic for first-run / re-run bootstrap.
 *
 * Pure layout decisions and template content live here; all fs writes are intentional, idempotent,
 * and never overwrite existing user content. Callers wire this from bootstrap/setup entrypoints.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"

export interface WorkflowLayoutResult {
  readonly created: string[]
  readonly existing: string[]
  readonly notes: string[]
}

/** Minimal, repo-agnostic SPEC template seeded only when SPEC.md is absent. */
export function specTemplate(): string {
  return `# SPEC

## Purpose
Describe what this project does and the outcome this workflow should deliver.

## Acceptance criteria
- [ ] Define concrete, verifiable conditions for "done".
- [ ] List user-visible behavior, interfaces, or artifacts that must exist.
- [ ] Note any constraints (performance, compatibility, security, policy).

## Verification
Record how acceptance is proven (commands, tests, screenshots, manual checks) and capture fresh evidence in the transcript/output.

- [ ] Commands/checks to run:
- [ ] Expected results:

## Notes
- Keep this file updated as the source of truth for scope and acceptance.
`
}

/** Minimal docs index/maintenance note seeded only when docs/README.md is absent. */
export function docsReadmeTemplate(): string {
  return `# Docs

This directory holds project documentation.

## What belongs here
- User-facing guides, architecture notes, and maintenance/runbook docs.
- Keep docs close to the behavior they describe and update them with code changes.

## Maintenance
- Prefer small, factual docs over stale long-form prose.
- When behavior, setup, or workflows change, update the relevant doc in the same change.
- Link important docs from the project README if one exists.
`
}

/** Short maintainer/workflow guide seeded only when MAINTAINER.md is absent. */
export function maintainerTemplate(): string {
  return `# Maintainer workflow

A minimal, repeatable workflow for making changes safely.

## Where things go
- **Specs / acceptance:** define or update the task's acceptance and verification (see \`SPEC.md\` if present) before or alongside implementation.
- **Code & tests:** implement in the appropriate source locations; keep changes scoped to the task.
- **Docs:** update user/maintainer docs when behavior or workflow changes.
- **Runtime/state:** local runtime artifacts (caches, learnings, locks, scratch worktrees/state) are not source-of-truth and should stay untracked.

## How work moves
1. **Claim scope:** identify the task and the files/areas in scope.
2. **Isolate work:** do work in a dedicated branch/work area (e.g. a task worktree) rather than directly on the main integration branch.
3. **Implement & verify:** make the change, run the checks/tests the acceptance requires, and capture fresh evidence.
4. **Submit:** commit with a clear message and submit the work for integration/review.
5. **Merge/land:** only the designated integration/merge step lands changes on the target branch after required checks pass. "Done" means landed (or submitted per your process), not just edited locally.

## Handoff
- Leave a short note of what changed, how it was verified, and anything unfinished or risky for the next person.
`
}

function ensureDir(dir: string, rel: string, created: string[], existing: string[]): void {
  if (existsSync(dir)) {
    existing.push(rel)
    return
  }
  mkdirSync(dir, { recursive: true })
  created.push(rel)
}

function ensureFile(path: string, rel: string, content: string, created: string[], existing: string[]): void {
  if (existsSync(path)) {
    existing.push(rel)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`, "utf8")
  created.push(rel)
}

/** Append missing gitignore lines (exact trimmed-line match). Never removes existing lines. */
export function appendGitignoreRules(projectRoot: string, wanted: readonly string[]): { created: boolean; added: string[]; existed: boolean } {
  const gitignorePath = join(projectRoot, ".gitignore")
  const existed = existsSync(gitignorePath)
  let content = ""
  if (existed) {
    try {
      content = readFileSync(gitignorePath, "utf8")
    } catch {
      content = ""
    }
  }
  const lines = content.split("\n").map((line) => line.trim())
  const missing = wanted.filter((entry) => !lines.includes(entry))
  if (missing.length === 0) return { created: false, added: [], existed }
  const prefix = content.length === 0 || content.endsWith("\n") ? "" : "\n"
  writeFileSync(gitignorePath, content + prefix + missing.join("\n") + "\n", "utf8")
  return { created: !existed, added: missing, existed }
}

/** Runtime/state gitignore rules that must stay untracked. Tracked workflow docs are never added here. */
export const RUNTIME_GITIGNORE_RULES: readonly string[] = [
  "worktrees/",
  ".term/goal-loop/",
  ".term/coordinator/*.lock",
  ".term/coordinator/.claim-lock-file",
  ".term/coordinator/.merge-lock-file",
  ".term/coordinator/.claim-lock/",
  ".term/coordinator/.merge-lock/",
  ".term/coordinator/.state-stash.*",
  ".term/coordinator/.state.*",
]

interface StartupOptions {
  /** Absolute project root. */
  readonly projectRoot: string
  /** Absolute plugin root, if known (for coordinator bin resolution context; not written). */
  readonly pluginRoot?: string
  /** Learning log path from config (relative to project root or absolute); used to ensure its runtime dir exists. */
  readonly learningPath?: string
}

/**
 * Ensure goal runtime directories exist (idempotent). Does not create or overwrite learnings/state files.
 * Returns relative paths created vs already present.
 */
export function ensureGoalRuntimeLayout(projectRoot: string, learningPath?: string): { created: string[]; existing: string[] } {
  const created: string[] = []
  const existing: string[] = []
  const runtimeDir = join(projectRoot, ".term", "goal-loop")
  ensureDir(runtimeDir, ".term/goal-loop", created, existing)
  if (learningPath && learningPath.trim()) {
    const abs = isAbsolute(learningPath) ? learningPath : resolve(projectRoot, learningPath)
    // Ensure the parent directory of the configured learning file exists (may differ from default).
    const parent = dirname(abs)
    if (parent.startsWith(resolve(projectRoot))) {
      const rel = parent.slice(resolve(projectRoot).length).replace(/^\/+/, "") || "."
      if (rel !== ".term/goal-loop" && rel !== ".term" && rel !== ".") {
        if (existsSync(parent)) existing.push(rel)
        else {
          mkdirSync(parent, { recursive: true })
          created.push(rel)
        }
      }
    } else if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true })
      // Outside project root: report absolute for clarity.
      created.push(parent)
    } else {
      existing.push(parent)
    }
  }
  return { created, existing }
}

/** Ensure coordinator/workplace layout in a git repo (create-if-missing, never overwrite). */
export function ensureCoordinatorWorkplaceLayout(projectRoot: string): { created: string[]; existing: string[] } {
  const created: string[] = []
  const existing: string[] = []
  const coordDir = join(projectRoot, ".term", "coordinator")
  const worktreesDir = join(projectRoot, "worktrees")
  ensureDir(coordDir, ".term/coordinator", created, existing)
  ensureDir(worktreesDir, "worktrees", created, existing)
  ensureFile(join(coordDir, "config.json"), ".term/coordinator/config.json", JSON.stringify({ devBranch: "dev", worktreeDir: "worktrees" }), created, existing)
  ensureFile(join(coordDir, "state.json"), ".term/coordinator/state.json", JSON.stringify({ version: 1, leases: {}, mergeLock: null }), created, existing)
  return { created, existing }
}

/** Seed workflow docs/templates only if absent. Never overwrites. */
export function ensureWorkflowDocs(projectRoot: string): { created: string[]; existing: string[] } {
  const created: string[] = []
  const existing: string[] = []
  ensureFile(join(projectRoot, "SPEC.md"), "SPEC.md", specTemplate(), created, existing)
  // Seed docs/README.md (and docs/ dir) as a lightweight index/maintenance note.
  const docsDir = join(projectRoot, "docs")
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true })
    created.push("docs/")
  } else {
    existing.push("docs/")
  }
  ensureFile(join(docsDir, "README.md"), "docs/README.md", docsReadmeTemplate(), created, existing)
  ensureFile(join(projectRoot, "MAINTAINER.md"), "MAINTAINER.md", maintainerTemplate(), created, existing)
  return { created, existing }
}

/**
 * Provision the full startup scaffold for a git repository. Idempotent, never overwrites user content.
 * Safe to call on every bootstrap/run.
 */
export function ensureGitRepoStartup(options: StartupOptions): WorkflowLayoutResult {
  const { projectRoot, learningPath } = options
  const created: string[] = []
  const existing: string[] = []
  const notes: string[] = []
  try {
    if (!existsSync(join(projectRoot, ".git"))) {
      return { created: [], existing: [], notes: ["not a git repository"] }
    }
    const coord = ensureCoordinatorWorkplaceLayout(projectRoot)
    created.push(...coord.created)
    existing.push(...coord.existing)

    const runtime = ensureGoalRuntimeLayout(projectRoot, learningPath)
    created.push(...runtime.created)
    existing.push(...runtime.existing)

    const docs = ensureWorkflowDocs(projectRoot)
    created.push(...docs.created)
    existing.push(...docs.existing)

    const gi = appendGitignoreRules(projectRoot, RUNTIME_GITIGNORE_RULES)
    if (gi.added.length > 0) {
      created.push(".gitignore")
      notes.push(`gitignore: added ${gi.added.join(", ")}`)
    } else {
      existing.push(".gitignore")
    }
  } catch (error) {
    notes.push(`startup scaffold error: ${String(error)}`)
  }
  return { created, existing, notes }
}

/**
 * Provision runtime-only startup outside a git repo (or when git-specific layout is not applicable).
 * Ensures goal runtime dirs and never fails goal arming.
 */
export function ensureRuntimeOnlyStartup(options: Pick<StartupOptions, "projectRoot" | "learningPath">): WorkflowLayoutResult {
  const { projectRoot, learningPath } = options
  const created: string[] = []
  const existing: string[] = []
  const notes: string[] = ["runtime-only (not a git repository)"]
  try {
    const runtime = ensureGoalRuntimeLayout(projectRoot, learningPath)
    created.push(...runtime.created)
    existing.push(...runtime.existing)
  } catch (error) {
    notes.push(`runtime startup error: ${String(error)}`)
  }
  return { created, existing, notes }
}
