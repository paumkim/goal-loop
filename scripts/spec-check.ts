#!/usr/bin/env bun
/**
 * spec-check: read-only gate that COMPUTES the package/test counts at check time.
 *
 * What it does
 *   Runs two probes on the current tree and reports their counts:
 *     files  `npm pack --dry-run --json` — the exact file count of the published tarball
 *     tests  `bun test` (run from `test/`) — the number of passing tests at the current HEAD
 *   It fails when a probe cannot run, when the reporter summary is unparseable, or when
 *   `bun test` is red. It never writes anything.
 *
 * What changed
 *   Counts are no longer stored in SPEC.md. A stored marker made every shipped-file or test
 *   change also edit SPEC.md, and parallel leases raced on that one line, forcing a re-count
 *   commit in merge-next on every merge. The gate now derives the counts itself from reality,
 *   so there is nothing to bump and nothing to re-count. SPEC.md keeps its prose only.
 *
 * Compatibility
 *   `--write` is accepted as a no-op so an older merge-next pipeline that still calls
 *   `bun scripts/spec-check.ts --write` keeps working. It runs the same probes, prints the
 *   computed counts, and exits 0 on a green tree; it never touches SPEC.md.
 *
 * The pure helpers are exported so `test/spec-check.test.ts` can unit-test them without
 * shelling out; the I/O stays in `main()`, which only runs when the file is executed directly.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Counts computed by the two probes at check time. */
export interface SpecCounts {
  readonly files: number;
  readonly tests: number;
}

/** Outcome of the two probes; `undefined` members mean the probe itself failed. */
export interface ProbeResult {
  /** File count from `npm pack --dry-run --json`; undefined when the probe threw or was unparseable. */
  readonly files?: number;
  /** True when `bun test` exited 0. */
  readonly testsGreen: boolean;
  /** Pass count parsed from the reporter output; undefined when the reporter was unparseable. */
  readonly tests?: number;
  /** Set when `bun test` could not even start (binary missing). */
  readonly bunLaunchError?: string;
}

export const BUN_RED_ERROR = "bun test exits non-zero (a test failed); spec-check never claims green while the suite is red";
export const PACK_PROBE_ERROR = "npm pack --dry-run --json did not report a file list";
export const TEST_SUMMARY_ERROR = "bun test summary line was unparseable; refusing to claim a green suite";

/**
 * Parse the `  N pass` summary line out of bun test's merged output. Anchored to line start so a
 * stray substring cannot win; the last match is the reporter's own summary when it prints more than one.
 */
export function parseBunTestPassCount(out: string): number | undefined {
  const matches = [...out.matchAll(/(?:^|\n)\s*(\d+) pass\b/g)];
  const last = matches[matches.length - 1];
  const digits = last?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/**
 * Pure diagnosis: turn probe results into human-readable failure lines. Empty means green.
 * `probeErrors` (already formatted, e.g. `npm pack --dry-run --json failed: …`) are carried through.
 * A red `bun test` is always a failure; a missing file count or an unparseable summary is too.
 */
export function diagnose(probe: ProbeResult, probeErrors: readonly string[] = []): string[] {
  const failures: string[] = [...probeErrors];
  if (probe.files === undefined || probe.files < 0) {
    if (probeErrors.length === 0) failures.push(PACK_PROBE_ERROR);
  }
  if (!probe.testsGreen) {
    failures.push(probe.bunLaunchError ? `bun test failed to launch: ${probe.bunLaunchError}` : BUN_RED_ERROR);
  } else if (probe.tests === undefined) {
    failures.push(TEST_SUMMARY_ERROR);
  }
  return failures;
}

/** The multi-line failure report. */
export function formatFailures(failures: readonly string[]): string {
  return ["spec-check: computed counts are not green:", ...failures.map((failure) => `  - ${failure}`)].join("\n");
}

/** The single-line success report. */
export function formatOk(counts: SpecCounts): string {
  return `spec-check: ok (${counts.files} files, ${counts.tests} tests — computed at gate time)`;
}

function main(): void {
  const argv = process.argv.slice(2);
  const legacyWrite = argv.includes("--write");
  const probeErrors: string[] = [];

  // files: npm pack --dry-run --json -> [{ files: [...] }]
  let files: number | undefined;
  try {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const parsed = JSON.parse(out) as ReadonlyArray<{ files?: ReadonlyArray<unknown> }>;
    files = parsed[0]?.files?.length ?? -1;
  } catch (error) {
    probeErrors.push(`npm pack --dry-run --json failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // tests: run from inside test/ so worktree forks under worktree/ cannot double-count the suite;
  // the reporter summary goes to stderr, so merge both streams. A bun that fails to start is
  // reported as such, not as "a test failed".
  const run = spawnSync("bun", ["test"], { cwd: join(ROOT, "test"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const launchError = run.error?.message;
  const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const tests = parseBunTestPassCount(out);

  const failures = diagnose({ files, testsGreen: run.status === 0, tests, bunLaunchError: launchError }, probeErrors);
  if (failures.length > 0) {
    console.error(formatFailures(failures));
    process.exit(1);
  }

  if (legacyWrite) console.log("spec-check: note: counts are computed at gate time; --write is a no-op (SPEC.md untouched)");
  console.log(formatOk({ files: files!, tests: tests! }));
}

if (import.meta.main) main();
