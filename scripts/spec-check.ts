#!/usr/bin/env bun
/**
 * spec-check: read-only gate that keeps SPEC.md's count claims honest.
 *
 * What it does
 *   Reads the machine-readable marker `<!-- spec-check files=N tests=N -->` from SPEC.md and
 *   asserts both numbers against reality:
 *     files  `npm pack --dry-run --json` — the exact file count of the published tarball
 *     tests  `bun test` (run from `test/`) — the number of passing tests at the current HEAD
 *   Exits 1 and lists every mismatch when a claim trails reality. Exits 0 otherwise.
 *   Never writes anything. Wired into `bun run check` and CI.
 *
 * What it does not do
 *   - It does not judge whether the tests or the package are *good* — only that the counts
 *     written in SPEC.md match what the commands report right now.
 *   - It does not check sizes (kB drift across npm versions is noise); counts only.
 *   - It does not check historical workstreams' claims; only the marker counts.
 *
 * When you add/remove/rename a shipped file or a test, update the marker in SPEC.md in the
 * same commit. The gate fails otherwise — that is the point.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SPEC = join(ROOT, "SPEC.md");

const spec = readFileSync(SPEC, "utf8");
const marker = spec.match(/<!--\s*spec-check files=(\d+) tests=(\d+)\s*-->/);
if (!marker) {
  console.error("spec-check: no `<!-- spec-check files=N tests=N -->` marker found in SPEC.md");
  process.exit(1);
}
const claimedFiles = Number(marker[1]);
const claimedTests = Number(marker[2]);

const failures: string[] = [];

// files: npm pack --dry-run --json -> [{ files: [...] }]
try {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(out) as ReadonlyArray<{ files: ReadonlyArray<unknown> }>;
  const actual = parsed[0]?.files.length ?? -1;
  if (actual !== claimedFiles) failures.push(`npm pack lists ${actual} files, SPEC.md claims ${claimedFiles}`);
} catch (error) {
  failures.push(`npm pack --dry-run --json failed: ${error instanceof Error ? error.message : String(error)}`);
}

// tests: run bun test from inside test/ so a repo carrying opencode worktrees under worktrees/
// cannot double-count the suite; the reporter summary goes to stderr, not stdout; merge both.
{
  const run = spawnSync("bun", ["test"], { cwd: join(ROOT, "test"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const match = out.match(/(\d+) pass/);
  const actual = match ? Number(match[1]) : -1;
  if (run.status !== 0) failures.push(`bun test exits non-zero (a test failed); SPEC.md must not claim green while the suite is red`);
  else if (actual !== claimedTests) failures.push(`bun test reports ${actual} passing tests, SPEC.md claims ${claimedTests}`);
}

if (failures.length > 0) {
  console.error("spec-check: SPEC.md claims do not match reality:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`spec-check: ok (${claimedFiles} files, ${claimedTests} tests match SPEC.md)`);
