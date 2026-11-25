/** Unit tests for the pure helpers behind the append-only per-slug SPEC.md anchors. */
import { describe, expect, test } from "bun:test"
import { REGION_END, REGION_START, appendAnchor, ensureAnchor, listAnchors, validateAnchors } from "../scripts/spec-anchors.ts"

const base = (blocks = "") => `# SPEC\n\n${REGION_START}\n${blocks}${REGION_END}\n\n## Historical workstreams\n`

describe("ensureAnchor", () => {
  test("inserts a balanced empty anchor just before the region end", () => {
    const spec = base()
    const next = ensureAnchor(spec, "my-slug")
    expect(next).toContain("<!-- workstream:my-slug:start -->\n<!-- workstream:my-slug:end -->")
    expect(next.indexOf("my-slug")).toBeLessThan(next.indexOf(REGION_END))
  })

  test("is idempotent", () => {
    const once = ensureAnchor(base(), "my-slug")
    expect(ensureAnchor(once, "my-slug")).toBe(once)
  })

  test("two different slugs get two distinct blocks", () => {
    const spec = ensureAnchor(ensureAnchor(base(), "a"), "b")
    expect(listAnchors(spec)).toEqual(["a", "b"])
    expect(validateAnchors(spec)).toEqual([])
  })

  test("refuses an invalid slug and a missing region", () => {
    expect(() => ensureAnchor(base(), "bad slug")).toThrow(/invalid slug/)
    expect(() => ensureAnchor("# no region\n", "x")).toThrow(/region/)
  })
})

describe("appendAnchor", () => {
  test("rewrites only the target block and leaves other slugs untouched", () => {
    const spec = ensureAnchor(ensureAnchor(base(), "a"), "b")
    const next = appendAnchor(spec, "a", "### a prose\nline two")
    expect(next).toContain("<!-- workstream:a:start -->\n\n### a prose\nline two\n<!-- workstream:a:end -->")
    expect(next).toContain("<!-- workstream:b:start -->\n<!-- workstream:b:end -->")
    expect(validateAnchors(next)).toEqual([])
  })

  test("is idempotent for the same content", () => {
    const spec = appendAnchor(ensureAnchor(base(), "a"), "a", "same")
    expect(appendAnchor(spec, "a", "same")).toBe(spec)
  })

  test("throws when the slug has no anchor", () => {
    expect(() => appendAnchor(base(), "ghost", "x")).toThrow(/no anchor/)
  })
})

describe("validateAnchors", () => {
  test("flags an unbalanced anchor", () => {
    const spec = base("<!-- workstream:a:start -->\n").replace(REGION_END, "")
    expect(validateAnchors(spec).join(" ")).toMatch(/unbalanced|missing/)
  })

  test("flags duplicate slugs", () => {
    const spec = base()
      .replace(REGION_END, "<!-- workstream:a:start -->\n<!-- workstream:a:end -->\n<!-- workstream:a:start -->\n<!-- workstream:a:end -->\n" + REGION_END)
    expect(validateAnchors(spec).join(" ")).toContain("duplicate")
  })

  test("listAnchors returns only balanced slugs", () => {
    const spec = base("<!-- workstream:a:start -->\nonly start\n<!-- workstream:b:start -->\n<!-- workstream:b:end -->\n")
    expect(listAnchors(spec)).toEqual(["b"])
  })
})
