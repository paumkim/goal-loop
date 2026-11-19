/**
 * Pins the JSON examples in the user-facing docs (README.md, docs/install.html) to reality:
 *  1. every fenced-or-braced JSON block parses with JSON.parse, so the copy-pasted example is never
 *     malformed (both docs instruct the user to paste it into `opencode.json`);
 *  2. every occurrence of the plugin specifier form `github:paumkim/opencode-goalv2#…` in either file
 *     equals PLUGIN_SPEC exported by `bin/goal-loop.mjs` (and therefore `v` + package.json version).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PLUGIN_SPEC } from "../bin/goal-loop.mjs"

const ROOT = join(import.meta.dir, "..")
const readme = readFileSync(join(ROOT, "README.md"), "utf8")
const installHtml = readFileSync(join(ROOT, "docs", "install.html"), "utf8")
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }

const unescape = (html: string): string =>
  html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")

/** Extract every block whose content starts with `{`: README fences, plus `<pre><code>`/inline `<code>` in HTML. */
const extractJsonBlocks = (name: string, text: string, isHtml: boolean): Array<{ label: string; json: string }> => {
  const blocks: Array<{ label: string; json: string }> = []
  if (isHtml) {
    for (const match of text.matchAll(/<(pre|code)[^>]*>([^<]*)<\/\1>/g)) {
      const inner = unescape(match[2] ?? "").trim()
      if (inner.startsWith("{")) blocks.push({ label: `${name} <pre|code> #${blocks.length + 1}`, json: inner })
    }
    return blocks
  }
  // Line state machine: pair ```fences properly (every fence may carry an optional language tag).
  let inFence = false
  let tag = ""
  let buffer: string[] = []
  for (const line of text.split("\n")) {
    const fence = line.match(/^```([\w-]*)\s*$/)
    if (fence) {
      if (!inFence) {
        inFence = true
        tag = fence[1] ?? ""
        buffer = []
        continue
      }
      inFence = false
      const inner = buffer.join("\n").trim()
      if (inner.startsWith("{")) blocks.push({ label: `${name} fence#${blocks.length + 1} (${tag || "bare"})`, json: inner })
      continue
    }
    if (inFence) buffer.push(line)
  }
  return blocks
}

const readmeBlocks = extractJsonBlocks("README.md", readme, false)
const installBlocks = extractJsonBlocks("install.html", installHtml, true)

/** Every occurrence of the specifier in the two docs; returns the full specifier strings. */
const specifiersIn = (text: string): string[] =>
  [...text.matchAll(/github:paumkim\/opencode-goalv2#[^\s"'<>)`]+/g)].map((match) => match[0] as string)

describe("docs JSON examples", () => {
  test("README.md has at least one JSON options block and it parses", () => {
    expect(readmeBlocks.length).toBeGreaterThanOrEqual(1)
    for (const block of readmeBlocks) {
      expect(() => JSON.parse(block.json), `${block.label} must parse`).not.toThrow()
    }
  })

  test("docs/install.html has at least one JSON options block and it parses", () => {
    expect(installBlocks.length).toBeGreaterThanOrEqual(1)
    for (const block of installBlocks) {
      expect(() => JSON.parse(block.json), `${block.label} must parse`).not.toThrow()
    }
  })

  test("every JSON options block that names a plugin specifier pins it to PLUGIN_SPEC", () => {
    const blocks = [...readmeBlocks, ...installBlocks]
    const pinned = blocks.filter((block) => /github:paumkim\/opencode-goalv2/.test(block.json))
    expect(pinned.length).toBeGreaterThanOrEqual(2) // the documented install route in both files
    for (const block of pinned) {
      expect(block.json, `${block.label} must use PLUGIN_SPEC`).toContain(PLUGIN_SPEC)
      expect(block.json).not.toContain(`${PLUGIN_SPEC}-`) // no accidental suffix glued to the tag
    }
  })

  test("the README options block parses to an object whose plugin package is PLUGIN_SPEC", () => {
    const readme = readmeBlocks.find((block) => block.json.includes("plugins"))
    expect(readme).toBeDefined()
    const parsed = JSON.parse((readme as { json: string }).json) as {
      plugins: Array<{ package?: string } | string>
    }
    const packages = parsed.plugins.map((entry) => (typeof entry === "string" ? entry : entry.package))
    expect(packages).toEqual([PLUGIN_SPEC])
  })

  test("every plugin specifier occurrence in README.md equals PLUGIN_SPEC", () => {
    const specs = specifiersIn(readme)
    expect(specs.length).toBeGreaterThanOrEqual(2)
    for (const spec of specs) expect(spec).toBe(PLUGIN_SPEC)
  })

  test("every plugin specifier occurrence in docs/install.html equals PLUGIN_SPEC", () => {
    const specs = specifiersIn(installHtml)
    expect(specs.length).toBeGreaterThanOrEqual(4)
    for (const spec of specs) expect(spec).toBe(PLUGIN_SPEC)
  })

  test("PLUGIN_SPEC is the github specifier with package.json's version", () => {
    expect(PLUGIN_SPEC).toBe(`github:paumkim/opencode-goalv2#v${pkg.version}`)
  })
})
