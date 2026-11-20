#!/usr/bin/env bun
/**
 * invariant-sweep: standing gate for behavior-change hygiene.
 *
 * What it does
 *   Fails when `src/core/**` or `src/runtime/**` behavior changes lack matching
 *   `SPEC.md` and `docs/changelog.html` updates in the same change set.
 *
 * How "change set" is detected
 *   Union of: working-tree/index changes (`git status --porcelain`, including
 *   untracked files) and commits on HEAD not reachable from the merge-base with
 *   the primary integration ref (`dev`, else `origin/dev`, else `main`,
 *   else `origin/main`). On a clean tree whose HEAD is at that base, the set is
 *   empty and the gate passes.
 *
 * What counts
 *   - behavior change: any changed path under `src/core/` or `src/runtime/`
 *   - required companions: `SPEC.md` and `docs/changelog.html`
 *
 * Read-only. Never writes anything. Wired into `bun run check`.
 *
 * Pure helpers (`pathsOf`, `behaviorChanges`, `diagnose`, `formatFailures`,
 * `formatOk`) are exported for unit tests; I/O lives in `main()` which runs only
 * under `import.meta.main`.
 */
import { execFileSync } from "node:child_process";

/** Paths that constitute a behavior change requiring spec/changelog alignment. */
export const BEHAVIOR_PREFIXES = ["src/core/", "src/runtime/"] as const;
export const SPEC_PATH = "SPEC.md";
export const CHANGELOG_PATH = "docs/changelog.html";

export const isBehaviorPath = (path: string): boolean =>
  BEHAVIOR_PREFIXES.some((prefix) => path.startsWith(prefix));

/** Stable, de-duplicated list of changed paths (repo-root relative, POSIX). */
export function pathsOf(lines: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    // porcelain "XY path" or "XY orig -> path" (leading status chars are significant)
    if (/^.. /.test(line)) {
      const body = line.slice(3);
      const renamed = body.includes(" -> ") ? body.split(" -> ").pop()! : body;
      out.add(renamed.trim());
      continue;
    }
    out.add(line.trim());
  }
  return [...out].sort();
}

export function behaviorChanges(paths: readonly string[]): string[] {
  return paths.filter(isBehaviorPath).sort();
}

/** Missing required companion docs for a non-empty behavior-change set. */
export function diagnose(changed: readonly string[]): string[] {
  const touched = behaviorChanges(changed);
  if (touched.length === 0) return [];
  const set = new Set(changed);
  const failures: string[] = [];
  if (!set.has(SPEC_PATH)) failures.push(`${SPEC_PATH} not updated for src/core|src/runtime behavior changes`);
  if (!set.has(CHANGELOG_PATH)) failures.push(`${CHANGELOG_PATH} not updated for src/core|src/runtime behavior changes`);
  if (failures.length > 0) {
    failures.push(`behavior changes: ${touched.join(", ")}`);
  }
  return failures;
}

export function formatFailures(failures: readonly string[]): string {
  return ["invariant-sweep: behavior changes missing required doc updates:", ...failures.map((f) => `  - ${f}`)].join("\n");
}

export function formatOk(): string {
  return "invariant-sweep: ok (no src/core|src/runtime behavior changes without SPEC.md and docs/changelog.html updates)";
}

type Git = (args: string[]) => string | undefined;

const makeGit = (cwd: string): Git => (args) => {
  try {
    // Preserve leading whitespace (porcelain status uses a significant leading space).
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(/\n$/, "");
  } catch {
    return undefined;
  }
};

function resolveBase(git: Git): string | undefined {
  for (const ref of ["dev", "origin/dev", "main", "origin/main"]) {
    const mb = git(["merge-base", "HEAD", ref]);
    if (mb?.trim()) return mb.trim();
  }
  return undefined;
}

export function collectChangedPaths(cwd = process.cwd()): string[] {
  const git = makeGit(cwd);
  const lines: string[] = [];
  // Working tree + index (includes untracked)
  const porcelain = git(["status", "--porcelain"]);
  if (porcelain) lines.push(...porcelain.split("\n"));
  // Committed changes ahead of integration base
  const base = resolveBase(git);
  if (base) {
    const committed = git(["diff", "--name-only", "--diff-filter=ACMRD", `${base}..HEAD`]);
    if (committed?.trim()) lines.push(...committed.split("\n"));
  }
  return pathsOf(lines);
}

function main(): void {
  try {
    const failures = diagnose(collectChangedPaths(process.cwd()));
    if (failures.length > 0) {
      console.error(formatFailures(failures));
      process.exit(1);
    }
    console.log(formatOk());
  } catch (error) {
    console.error(`invariant-sweep: failed to evaluate: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
