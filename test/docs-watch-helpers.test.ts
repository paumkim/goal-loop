/**
 * Unit tests for the pure helpers inside `scripts/docs-watch.ts` (changelog-row derivation, stamp/freshness
 * verdicts, failure formatting). Importing the module must have no side effects — `main()` only runs under
 * `import.meta.main`, so these tests never touch git, the filesystem, or the clock.
 * Complements the spawn-based integration suite in `test/docs-watch.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import {
  CHANGE_END,
  CHANGE_START,
  changelogVerdict,
  esc,
  extractStamp,
  formatFailures,
  parseChangelogLog,
  renderRows,
  sliceChangelogRows,
  sortRows,
  stampVerdict,
} from "../scripts/docs-watch.ts"

describe("esc", () => {
  test("escapes &, <, > and double quotes", () => {
    expect(esc(`a & <b> "c"`)).toBe("a &amp; &lt;b&gt; &quot;c&quot;")
  })

  test("does not double-escape ampersand-entity text", () => {
    expect(esc("&lt;")).toBe("&amp;lt;")
  })

  test("passes plain text through unchanged", () => {
    expect(esc("fix(loop): normalize conditions")).toBe("fix(loop): normalize conditions")
  })
})

describe("parseChangelogLog", () => {
  test("parses %cd\\t%s lines into rows with source=commit", () => {
    const out = ["2026-11-15 18:44 UTC\tdocs: refresh stamps and changelog", "2026-11-15 18:42 UTC\tfeat(cli): installer registers github spec"].join("\n")
    expect(parseChangelogLog(out)).toEqual([
      { when: "2026-11-15 18:44 UTC", what: "docs: refresh stamps and changelog", source: "commit" },
      { when: "2026-11-15 18:42 UTC", what: "feat(cli): installer registers github spec", source: "commit" },
    ])
  })

  test("re-joins subjects containing tabs", () => {
    const out = "2026-11-15 18:44 UTC\tfix(a): first\tsecond"
    expect(parseChangelogLog(out)).toEqual([{ when: "2026-11-15 18:44 UTC", what: "fix(a): first\tsecond", source: "commit" }])
  })

  test("empty input yields no rows", () => {
    expect(parseChangelogLog("")).toEqual([])
    expect(parseChangelogLog("\n\n")).toEqual([])
  })
})

describe("sortRows / renderRows", () => {
  const rows = [
    { when: "2026-11-15 18:42 UTC", what: "older", source: "commit" },
    { when: "2026-11-15 18:44 UTC", what: "newest", source: "commit" },
    { when: "2026-11-15 18:43 UTC", what: "middle", source: "commit" },
  ]

  test("sortRows returns a newest-first copy and does not mutate the input", () => {
    const sorted = sortRows(rows)
    expect(sorted.map((r) => r.what)).toEqual(["newest", "middle", "older"])
    expect(rows[0]?.what).toBe("older")
  })

  test("renderRows emits one escaped <tr> per row, newest first", () => {
    const html = renderRows([{ when: "2026-11-15 18:44 UTC", what: "a & b <c>", source: "commit" }])
    expect(html).toBe(`<tr><td><code>2026-11-15 18:44 UTC</code></td><td>a &amp; b &lt;c&gt;</td><td>commit</td></tr>`)
  })

  test("renderRows of the empty set is the empty string", () => {
    expect(renderRows([])).toBe("")
  })
})

describe("extractStamp", () => {
  test("extracts the text inside the first stamp span", () => {
    expect(extractStamp(`<footer>stamp: <span class="stamp">2026-11-15 13:51 UTC</span></footer>`)).toBe("2026-11-15 13:51 UTC")
  })

  test("returns undefined when the marker is absent", () => {
    expect(extractStamp("<p>no stamp here</p>")).toBeUndefined()
  })

  test("returns the first of two stamps", () => {
    expect(extractStamp(`<span class="stamp">first</span><span class="stamp">second</span>`)).toBe("first")
  })
})

describe("stampVerdict", () => {
  test("undefined when the stamp matches the last commit", () => {
    expect(stampVerdict("docs/config.html", `<span class="stamp">2026-11-15 13:51 UTC</span>`, "2026-11-15 13:51 UTC")).toBeUndefined()
  })

  test("reports a missing stamp", () => {
    expect(stampVerdict("docs/config.html", "<p>none</p>", "2026-11-15 13:51 UTC")).toBe("docs/config.html: no <span class=\"stamp\"> found")
  })

  test("reports a trailing stamp with both values", () => {
    expect(stampVerdict("docs/runtime.html", `<span class="stamp">2026-11-15 13:51 UTC</span>`, "2026-11-15 18:44 UTC")).toBe(
      `docs/runtime.html: stamp "2026-11-15 13:51 UTC" trails last commit "2026-11-15 18:44 UTC"`,
    )
  })
})

describe("sliceChangelogRows", () => {
  const page = [`<!-- changes:start -->`, `<tr><td>one</td></tr>`, `<tr><td>two</td></tr>`, `<!-- changes:end -->`].join("\n")

  test("returns the trimmed rows between the markers", () => {
    expect(sliceChangelogRows(page)).toBe("<tr><td>one</td></tr>\n<tr><td>two</td></tr>")
  })

  test("undefined when a marker is missing", () => {
    expect(sliceChangelogRows(`<!-- changes:start -->\n<tr><td>one</td></tr>`)).toBeUndefined()
    expect(sliceChangelogRows(`<tr><td>one</td></tr>\n<!-- changes:end -->`)).toBeUndefined()
  })

  test("undefined when the end marker precedes the start marker", () => {
    expect(sliceChangelogRows(`${CHANGE_END}\nmiddle\n${CHANGE_START}`)).toBeUndefined()
  })
})

describe("changelogVerdict", () => {
  test("undefined when the committed rows match history", () => {
    expect(changelogVerdict("<tr><td>one</td></tr>", "<tr><td>one</td></tr>")).toBeUndefined()
  })

  test("the stale message otherwise", () => {
    expect(changelogVerdict("<tr><td>old</td></tr>", "<tr><td>new</td></tr>")).toBe(
      "docs/changelog.html: changelog rows are stale (run `bun scripts/docs-watch.ts once`)",
    )
  })
})

describe("formatFailures", () => {
  test("renders the header, one bullet per failure and the fix hint", () => {
    expect(formatFailures(["one", "two"])).toBe(
      "docs freshness check failed:\n  - one\n  - two\nfix: bun scripts/docs-watch.ts once   (then commit the result)",
    )
  })
})
