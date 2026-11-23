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
 *   Never writes anything, except with `--write`: the merge pipeline
 *   (`coordinator merge-next`) calls it on the merged tree to re-count the
 *   marker itself (`--write`); it refuses to write over a red suite or a failed probe.
 *   Plain mode is wired into `bun run check` and CI.
 *
 * What it does not do
 *   - It does not judge whether the tests or the package are *good* — only that the counts
 *     written in SPEC.md match what the commands report right now.
 *   - It does not check sizes (kB drift across npm versions is noise); counts only.
 *   - It does not check historical workstreams' claims; only the marker counts.
 *
 * The marker parsing and the mismatch diagnosis are exported pure helpers (`parseMarker`,
 * `diagnose`, `formatFailures`, `formatOk`) so `test/spec-check.test.ts` can unit-test them
 * without shelling out; the I/O stays in `main()`, which only runs when the file is executed
 * directly (`import.meta.main`), never on import.
 *
 * When you add/remove/rename a shipped file or a test, update the marker in SPEC.md in the
 * same commit. The gate fails otherwise — that is the point.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SPEC = join(ROOT, "SPEC.md");

/** Counts claimed by the SPEC marker. */
interface SpecCounts {
  readonly files: number;
  readonly tests: number;
}

/** Outcome of the two probes against reality; `undefined` members mean the probe itself failed (see `probeErrors`). */
interface ProbeResult {
  /** File count from `npm pack --dry-run --json`; undefined when the probe threw. */
  readonly files?: number;
  /** True when `bun test` exited 0. */
  readonly testsGreen: boolean;
  /** Pass count parsed from the reporter output; undefined when the reporter was unparseable. */
  readonly tests?: number;
  /** Set when `bun test` could not even start (binary missing); the failure report names it as such. */
  readonly bunLaunchError?: string;
}

export const NO_MARKER_ERROR = "spec-check: no `<!-- spec-check files=N tests=N -->` marker found in SPEC.md";
export const BUN_RED_ERROR = "bun test exits non-zero (a test failed); SPEC.md must not claim green while the suite is red";

/**
 * Parse the `  N pass` summary line out of bun test's merged output. Anchored to line start so a
 * stray substring (an earlier "N passed"-like token anywhere in the stream) cannot win; the last
 * match is the reporter's own summary when it prints more than one.
 */
export function parseBunTestPassCount(out: string): number | undefined {
  const matches = [...out.matchAll(/(?:^|\n)\s*(\d+) pass\b/g)];
  const last = matches[matches.length - 1];
  const digits = last?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/**
 * Parse the `<!-- spec-check files=N tests=N -->` marker out of the SPEC text.
 * Returns undefined when the marker is absent, malformed (non-numeric counts), or has the
 * counts in the wrong order — the marker format is deliberately strict so SPEC cannot
 * contain a near-miss that silently never checks.
 */
export function parseMarker(spec: string): SpecCounts | undefined {
  const match = spec.match(/<!--\s*spec-check\s+files=(\d+)\s+tests=(\d+)\s*-->/);
  if (!match) return undefined;
  return { files: Number(match[1]), tests: Number(match[2]) };
}

/**
 * Pure diagnosis: turn the claimed counts and the probe results into the human-readable
 * failure lines. Empty array means the gate passes. `probeErrors` (already formatted, e.g.
 * `npm pack --dry-run --json failed: …`) are carried through verbatim and listed first.
 * A red `bun test` is always a failure even if the SPEC claims green — the gate never
 * accepts a red suite.
 */
export function diagnose(claimed: SpecCounts, probe: ProbeResult, probeErrors: readonly string[] = []): string[] {
  const failures: string[] = [...probeErrors];
  if (probe.files !== undefined && probe.files !== claimed.files) {
    failures.push(`npm pack lists ${probe.files} files, SPEC.md claims ${claimed.files}`);
  }
  if (!probe.testsGreen) {
    failures.push(probe.bunLaunchError ? `bun test failed to launch: ${probe.bunLaunchError}` : BUN_RED_ERROR);
  } else {
    const reported = probe.tests ?? -1;
    if (reported !== claimed.tests) {
      failures.push(`bun test reports ${reported} passing tests, SPEC.md claims ${claimed.tests}`);
    }
  }
  return failures;
}

/** The multi-line failure report: header, then one `  - <failure>` line per failure. */
export function formatFailures(failures: readonly string[]): string {
  return ["spec-check: SPEC.md claims do not match reality:", ...failures.map((failure) => `  - ${failure}`)].join("\n");
}

/**
 * Rewrite the marker inside the SPEC text to `counts`. Pure. Throws when the marker
 * is absent or malformed — a --write pass never invents a marker, it only re-counts.
 */
export function writeMarker(spec: string, counts: SpecCounts): string {
  const pattern = /<!--\s*spec-check\s+files=\d+\s+tests=\d+\s*-->/;
  if (!pattern.test(spec)) {
    throw new Error(NO_MARKER_ERROR);
  }
  return spec.replace(pattern, `<!-- spec-check files=${counts.files} tests=${counts.tests} -->`);
}

/** The single-line success report. */
export function formatOk(claimed: SpecCounts): string {
  return `spec-check: ok (${claimed.files} files, ${claimed.tests} tests match SPEC.md)`;
}

function main(): void {
  const write = process.argv.slice(2).includes("--write");
  const spec = readFileSync(SPEC, "utf8");
  const claimed = parseMarker(spec);
  if (!claimed) {
    console.error(NO_MARKER_ERROR);
    process.exit(1);
  }

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

  // tests: run bun test from inside test/ so a repo carrying opencode worktrees under worktree/
  // cannot double-count the suite; the reporter summary goes to stderr, not stdout; merge both.
  // A bun that fails to start is reported as such, not as "a test failed".
  const run = spawnSync("bun", ["test"], { cwd: join(ROOT, "test"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const launchError = run.error?.message;
  const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const tests = parseBunTestPassCount(out);

  const failures = diagnose(claimed, { files, testsGreen: run.status === 0, tests, bunLaunchError: launchError }, probeErrors);

  if (write) {
    // --write: never convict, always heal. But never heal over a red suite or a failed probe.
    if (run.status !== 0) {
      console.error(formatFailures([launchError ? `bun test failed to launch: ${launchError}` : BUN_RED_ERROR, ...probeErrors]));
      process.exit(1);
    }
    if (files === undefined || tests === undefined) {
      console.error(formatFailures(probeErrors.length > 0 ? probeErrors : ["probe failed; SPEC.md left untouched"]));
      process.exit(1);
    }
    const next = { files, tests };
    const updated = writeMarker(spec, next);
    if (updated === spec) {
      console.log(`spec-check: marker already accurate (${files} files, ${tests} tests); SPEC.md untouched`);
      return;
    }
    writeFileSync(SPEC, updated);
    console.log(`spec-check: SPEC.md marker re-counted (${claimed.files}/${claimed.tests} -> ${files}/${tests})`);
    return;
  }

  if (failures.length > 0) {
    console.error(formatFailures(failures));
    process.exit(1);
  }
  console.log(formatOk(claimed));
}

if (import.meta.main) main();
