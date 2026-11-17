/**
 * Unit tests for the pure helpers inside `scripts/spec-check.ts` (marker parsing, mismatch
 * diagnosis, report formatting). Importing the module must have no side effects — `main()`
 * only runs under `import.meta.main`, so these tests never shell out to npm or bun test.
 */
import { describe, expect, test } from "bun:test"
import { BUN_RED_ERROR, NO_MARKER_ERROR, diagnose, formatFailures, formatOk, parseBunTestPassCount, parseMarker } from "../scripts/spec-check.ts"

const SPEC_FRAGMENT = [
  "# SPEC",
  "",
  "Status: current as of v1.1.0.",
  "",
  "<!-- spec-check files=41 tests=488 -->",
  "",
  "## Acceptance criteria",
].join("\n")

describe("parseMarker", () => {
  test("parses the canonical marker mid-document", () => {
    expect(parseMarker(SPEC_FRAGMENT)).toEqual({ files: 41, tests: 488 })
  })

  test("tolerates flexible whitespace inside the comment", () => {
    expect(parseMarker("<!--   spec-check files=41   tests=488   -->")).toEqual({ files: 41, tests: 488 })
  })

  test("returns undefined when the marker is absent", () => {
    expect(parseMarker("# SPEC\nno marker here\n")).toBeUndefined()
  })

  test("returns undefined for non-numeric counts", () => {
    expect(parseMarker("<!-- spec-check files=41 tests=many -->")).toBeUndefined()
  })

  test("returns undefined when the counts are in the wrong order", () => {
    expect(parseMarker("<!-- spec-check tests=488 files=41 -->")).toBeUndefined()
  })

  test("returns the first marker when SPEC carries a stray second one", () => {
    const spec = "<!-- spec-check files=41 tests=488 -->\n<!-- spec-check files=99 tests=999 -->\n"
    expect(parseMarker(spec)).toEqual({ files: 41, tests: 488 })
  })
})

describe("diagnose", () => {
  const claimed = { files: 41, tests: 488 }

  test("empty failures when everything matches", () => {
    expect(diagnose(claimed, { files: 41, testsGreen: true, tests: 488 })).toEqual([])
  })

  test("files mismatch yields the npm-pack message", () => {
    expect(diagnose(claimed, { files: 42, testsGreen: true, tests: 488 })).toEqual([
      "npm pack lists 42 files, SPEC.md claims 41",
    ])
  })

  test("tests mismatch yields the bun-test message", () => {
    expect(diagnose(claimed, { files: 41, testsGreen: true, tests: 489 })).toEqual([
      "bun test reports 489 passing tests, SPEC.md claims 488",
    ])
  })

  test("both mismatch, probe errors preserved verbatim and listed first", () => {
    const result = diagnose(claimed, { files: 40, testsGreen: true, tests: 400 }, ["npm pack warning: slow but fine"])
    expect(result).toEqual([
      "npm pack warning: slow but fine",
      "npm pack lists 40 files, SPEC.md claims 41",
      "bun test reports 400 passing tests, SPEC.md claims 488",
    ])
  })

  test("a red bun test is always a failure, whatever the marker claims", () => {
    expect(diagnose(claimed, { files: 41, testsGreen: true, tests: 488 })).toEqual([])
    expect(diagnose(claimed, { files: 41, testsGreen: false, tests: 999 })).toEqual([BUN_RED_ERROR])
  })

  test("unparseable reporter output with a green run reports -1 passing tests", () => {
    expect(diagnose(claimed, { files: 41, testsGreen: true, tests: undefined })).toEqual([
      "bun test reports -1 passing tests, SPEC.md claims 488",
    ])
  })

  test("a failed npm probe reports only the probe error, no npm-pack line", () => {
    const result = diagnose(claimed, { files: undefined, testsGreen: true, tests: 488 }, ["npm pack --dry-run --json failed: spawn npm ENOENT"])
    expect(result).toEqual(["npm pack --dry-run --json failed: spawn npm ENOENT"])
  })

  test("probe reporting -1 files (unparseable npm output) is a mismatch, not a pass", () => {
    expect(diagnose(claimed, { files: -1, testsGreen: true, tests: 488 })).toEqual([
      "npm pack lists -1 files, SPEC.md claims 41",
    ])
  })
})

describe("report formatting", () => {
  test("formatFailures prefixes every line with '  - ' under the header", () => {
    expect(formatFailures(["one", "two"])).toBe("spec-check: SPEC.md claims do not match reality:\n  - one\n  - two")
  })

  test("formatOk renders the single-line success report", () => {
    expect(formatOk({ files: 41, tests: 488 })).toBe("spec-check: ok (41 files, 488 tests match SPEC.md)")
  })

  test("NO_MARKER_ERROR names the exact marker syntax", () => {
    expect(NO_MARKER_ERROR).toContain("<!-- spec-check files=N tests=N -->")
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

describe("diagnose with a bun launch failure", () => {
  const claimed = { files: 41, tests: 488 }

  test("a launch failure is named as such, not as 'a test failed'", () => {
    expect(diagnose(claimed, { files: 41, testsGreen: false, bunLaunchError: "spawn bun ENOENT" })).toEqual([
      "bun test failed to launch: spawn bun ENOENT",
    ])
  })

  test("without bunLaunchError the red-suite message is unchanged", () => {
    expect(diagnose(claimed, { files: 41, testsGreen: false })).toEqual([BUN_RED_ERROR])
  })
})
