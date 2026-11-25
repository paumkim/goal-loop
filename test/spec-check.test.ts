/**
 * Unit tests for the pure helpers inside `scripts/spec-check.ts` (count diagnosis and report
 * formatting). Importing the module must have no side effects — `main()` only runs under
 * `import.meta.main`, so these tests never shell out to npm or bun test.
 */
import { describe, expect, test } from "bun:test"
import { BUN_RED_ERROR, PACK_PROBE_ERROR, TEST_SUMMARY_ERROR, diagnose, formatFailures, formatOk, parseBunTestPassCount } from "../scripts/spec-check.ts"

describe("diagnose", () => {
  test("empty failures when both probes are green and parseable", () => {
    expect(diagnose({ files: 41, testsGreen: true, tests: 488 })).toEqual([])
  })

  test("a red bun test is always a failure, whatever the counts", () => {
    expect(diagnose({ files: 41, testsGreen: false, tests: 999 })).toEqual([BUN_RED_ERROR])
  })

  test("an unparseable green summary is a failure (never claim a green suite without a count)", () => {
    expect(diagnose({ files: 41, testsGreen: true, tests: undefined })).toEqual([TEST_SUMMARY_ERROR])
  })

  test("a missing file count is a failure when no probe error already names it", () => {
    expect(diagnose({ files: undefined, testsGreen: true, tests: 488 })).toEqual([PACK_PROBE_ERROR])
    expect(diagnose({ files: -1, testsGreen: true, tests: 488 })).toEqual([PACK_PROBE_ERROR])
  })

  test("probe errors are preserved verbatim and are not double-reported as a missing file count", () => {
    const result = diagnose({ files: undefined, testsGreen: true, tests: 488 }, ["npm pack --dry-run --json failed: spawn npm ENOENT"])
    expect(result).toEqual(["npm pack --dry-run --json failed: spawn npm ENOENT"])
  })

  test("multiple independent failures are all listed, probe errors first", () => {
    const result = diagnose({ files: undefined, testsGreen: false }, ["warning: slow npm"])
    expect(result).toEqual(["warning: slow npm", BUN_RED_ERROR])
  })

  test("a bun launch failure is named as such, not as 'a test failed'", () => {
    expect(diagnose({ files: 41, testsGreen: false, bunLaunchError: "spawn bun ENOENT" })).toEqual([
      "bun test failed to launch: spawn bun ENOENT",
    ])
  })
})

describe("report formatting", () => {
  test("formatFailures prefixes every line with '  - ' under the header", () => {
    expect(formatFailures(["one", "two"])).toBe("spec-check: computed counts are not green:\n  - one\n  - two")
  })

  test("formatOk reports the computed counts as gate-time facts, with no stored marker", () => {
    expect(formatOk({ files: 41, tests: 488 })).toBe("spec-check: ok (41 files, 488 tests — computed at gate time)")
  })

  test("the error constants name the exact probes", () => {
    expect(PACK_PROBE_ERROR).toContain("npm pack --dry-run --json")
    expect(BUN_RED_ERROR).toContain("bun test")
    expect(TEST_SUMMARY_ERROR).toContain("bun test")
  })
})

describe("parseBunTestPassCount", () => {
  test("parses the summary line from merged reporter output", () => {
    expect(parseBunTestPassCount("\n 1373 pass\n 0 fail\n 28 snapshots, 4658 expect() calls\n")).toBe(1373)
  })

  test("a stray 'N passed'-like substring before the summary does not win", () => {
    const out = "test foo: 2 passed\n  somewhere else 5 pass\n\n  900 pass\n  0 fail\n"
    expect(parseBunTestPassCount(out)).toBe(900)
  })

  test("'passed' as a suffix never matches (word boundary)", () => {
    expect(parseBunTestPassCount("3 passed\n")).toBeUndefined()
  })

  test("takes the last anchored summary when more than one is printed", () => {
    expect(parseBunTestPassCount(" 1 pass\n 2 fail\n  42 pass\n 0 fail\n")).toBe(42)
  })

  test("returns undefined when the reporter output is unparseable", () => {
    expect(parseBunTestPassCount("")).toBeUndefined()
    expect(parseBunTestPassCount("no summary here\n")).toBeUndefined()
  })
})
