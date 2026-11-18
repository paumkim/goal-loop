/**
 * Docs citation guard. SPEC.md still cites `file.ts[x]:N` (Appendix A is explicitly frozen to the
 * Phase-1 commit, so its ranges are asserted structurally: file exists, range in bounds, range
 * contains code; single-line refs must land on a non-empty line). SPEC.md refs keep that guard.
 *
 * docs/*.html cites `file · symbol` instead of file:line (re-anchored 2026-11-17): line citations
 * drifted semantically on every workstream — lines existed but pointed at the wrong constructs —
 * while the docs:check freshness gate only verifies stamps and the changelog, so the rot passed CI
 * invisibly. This test therefore forbids `file.ts[x]:N` citations in docs/*.html outright: if one
 * reappears, point it at a symbol instead of a line.
 *
 * Bare `:NNN` fragments without an attached `file.ts[x]` token cannot be attributed to a file and are
 * ignored by both scopes.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..")

/** Root-relative first, then the source-tree fallbacks for refs written without a directory prefix (`git.ts:146`). */
const CANDIDATE_DIRS = [".", "src", "src/core", "src/runtime", "test", "scripts", "bin", "docs"]

const resolve = (ref: string): string | undefined => {
  for (const dir of CANDIDATE_DIRS) {
    const candidate = join(ROOT, dir, ref)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const docHtml = readdirSync(join(ROOT, "docs"))
  .filter((name) => name.endsWith(".html"))
  .map((name) => join("docs", name))
const docFiles = [...docHtml, "SPEC.md"].sort()

interface Ref {
  readonly where: string
  readonly file: string
  readonly start: number
  readonly end: number
  readonly source: string
}

const collectRefs = (): Ref[] => {
  const refs: Ref[] = []
  const pattern = /([A-Za-z0-9_./-]+\.tsx?):([0-9]+)(?:-([0-9]+))?/g
  for (const file of docFiles) {
    const text = readFileSync(join(ROOT, file), "utf8")
    for (const match of text.matchAll(pattern)) {
      const [source, refFile, startS, endS] = match as unknown as [string, string, string, string | undefined]
      const start = Number(startS)
      const end = endS === undefined ? start : Number(endS)
      refs.push({ where: file, file: refFile, start, end, source })
    }
  }
  return refs
}

const refs = collectRefs()
const docsRefs = refs.filter((ref) => ref.where.startsWith("docs/"))
const specRefs = refs.filter((ref) => ref.where === "SPEC.md")

describe("docs line references", () => {
  test("docs/*.html cite file · symbol, never file:line (SPEC.md keeps its frozen Appendix A refs)", () => {
    // The line-ref class drifted semantically between workstreams while the freshness gate stayed green;
    // symbol citations cannot. Forbid it here so it cannot creep back in through edits.
    expect(docsRefs.map((ref) => `${ref.where}: ${ref.source}`)).toEqual([])
    // Guards against the SPEC.md extraction silently going empty (Appendix A is frozen: refs must not shrink).
    expect(specRefs.length).toBeGreaterThanOrEqual(20)
  })

  test("every cited SPEC.md file exists on disk", () => {
    const missing = specRefs.filter((ref) => resolve(ref.file) === undefined)
    expect(missing.map((ref) => `${ref.where}: ${ref.source}`)).toEqual([])
  })

  test("every cited SPEC.md range is ordered and in bounds", () => {
    const out: string[] = []
    for (const ref of specRefs) {
      const resolved = resolve(ref.file)
      if (!resolved) continue // reported by the exists test
      if (ref.start < 1) out.push(`${ref.where}: ${ref.source} -> line numbers start at 1`)
      if (ref.end < ref.start) out.push(`${ref.where}: ${ref.source} -> range end before start`)
      const lineCount = readFileSync(resolved, "utf8").split("\n").length
      if (ref.end > lineCount) out.push(`${ref.where}: ${ref.source} -> line ${ref.end} out of range (${lineCount} lines)`)
    }
    expect(out).toEqual([])
  })

  test("every single-line SPEC.md ref lands on a non-empty line", () => {
    const out: string[] = []
    for (const ref of specRefs) {
      if (ref.start !== ref.end) continue // ranges handled below
      const resolved = resolve(ref.file)
      if (!resolved) continue
      const lines = readFileSync(resolved, "utf8").split("\n")
      if (!(lines[ref.start - 1] ?? "").trim()) out.push(`${ref.where}: ${ref.source} -> line ${ref.start} is blank`)
    }
    expect(out).toEqual([])
  })

  test("every ranged SPEC.md ref covers at least one non-empty line", () => {
    const out: string[] = []
    for (const ref of specRefs) {
      if (ref.start === ref.end) continue
      const resolved = resolve(ref.file)
      if (!resolved) continue
      const lines = readFileSync(resolved, "utf8").split("\n")
      const covered = lines.slice(ref.start - 1, ref.end).some((line) => line.trim().length > 0)
      if (!covered) out.push(`${ref.where}: ${ref.source} -> every line in ${ref.start}-${ref.end} is blank`)
    }
    expect(out).toEqual([])
  })
})

describe("docs path references", () => {
  test("every source path cited in docs/*.html exists on disk", () => {
    // The docs re-anchor sweep (2026-11-17) moved line refs to symbols, but a symbol migration that
    // mistypes a path (or renames a module) leaves a citation pointing at nothing. Pin the contract:
    // any `src/...`/`packages/...` token ending in a source extension must resolve.
    const pattern = /(?:src|packages)\/[A-Za-z0-9_.\-/]+\.(?:tsx|ts|js|mjs)/g
    const offenders: string[] = []
    for (const file of docFiles) {
      if (!file.startsWith("docs/")) continue
      const text = readFileSync(join(ROOT, file), "utf8")
      for (const match of text.matchAll(pattern)) {
        if (!existsSync(join(ROOT, match[0]))) offenders.push(`${file}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * The docs symbol-export contract.
 *
 * Every card in docs/*.html ends with the path of the module it describes, and most carry an
 * `<p>Exports: ...</p>` line naming the symbols a reader can import from that module. The 2026-11-17
 * re-anchor made those lines symbol-citations; a symbol renamed or removed without updating the card
 * leaves the docs teaching a wrong import. The path contract above pins that the cited *file* exists;
 * this pins that the cited *symbols* are real exports of it.
 *
 * Method-style listings are allowed for a class's own methods — e.g. `AutoCompactor` (`maybeCompact`,
 * `compactAtBoundary`) — because naming a class and its main methods on one line reads correctly.
 * Those entries are listed in SYMBOL_EXPORT_ALLOWLIST below keyed by (module, symbol), and this test
 * additionally requires each allowlisted method to appear as a method definition in the module
 * (`  async name(` / `  name(`), so the allowlist is a documented exception that is still checked —
 * never a way to silence a stale claim.
 *
 * Adding an entry is a docs-shape decision: the symbol must be a method of the exported class the card
 * names. If a card wants to name something that is neither an export nor a listed class method, the
 * card is wrong — fix the card, not the allowlist.
 */
const SYMBOL_EXPORT_ALLOWLIST: ReadonlyArray<readonly [string, string]> = [
  // Methods of the exported class `AutoCompactor` (the class is what docs/core.html names and checks).
  ["src/runtime/compactor.ts", "maybeCompact"],
  ["src/runtime/compactor.ts", "compactAtBoundary"],
]

describe("docs symbol-export contract", () => {
  test("every symbol in a card's Exports line is exported by the module it names (or allowlisted method-style)", () => {
    const cardPattern = /<div class="card">(.*?)<\/div>/gs
    const pathPattern = /<code>((?:src|packages)\/[^<]+\.(?:tsx|ts|js|mjs))<\/code>/
    const codePattern = /<code>([^<]+)<\/code>/g
    const exportDeclPattern = /export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
    const exportListPattern = /export\s+(?:type\s+)?\{([^}]*)\}/gs
    const symbolPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

    const exportedNames = (module: string): Set<string> => {
      const source = readFileSync(join(ROOT, module), "utf8")
      const names = new Set<string>()
      for (const match of source.matchAll(exportDeclPattern)) names.add(match[1] as string)
      for (const match of source.matchAll(exportListPattern)) {
        for (const part of (match[1] as string).split(",")) {
          const specifier = part.trim()
          if (!specifier) continue
          const alias = specifier.match(/^(?:type\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/)
          const bare = specifier.match(/^(?:type\s+)?([A-Za-z_$][A-Za-z0-9_$]*)$/)
          if (alias?.[1]) names.add(alias[1])
          else if (bare?.[1]) names.add(bare[1])
        }
      }
      return names
    }

    const offenders: string[] = []
    for (const file of docFiles) {
      if (!file.startsWith("docs/")) continue
      const text = readFileSync(join(ROOT, file), "utf8")
      for (const card of text.matchAll(cardPattern)) {
        const body = card[1] as string
        const pathMatch = body.match(pathPattern)
        const exportsMatch = body.match(/<p>Exports:\s*(.*?)<\/p>/s)
        if (!pathMatch || !exportsMatch) continue // no Exports claim to pin (card may describe a non-module)
        const module = pathMatch[1] as string
        const names = exportedNames(module)
        for (const symbolMatch of (exportsMatch[1] as string).matchAll(codePattern)) {
          const symbol = (symbolMatch[1] as string).trim()
          if (!symbolPattern.test(symbol)) continue // a note or list fragment inside a code tag; not an importable name
          if (names.has(symbol)) continue // the happy path
          const allowlisted = SYMBOL_EXPORT_ALLOWLIST.some(([m, s]) => m === module && s === symbol)
          if (allowlisted) {
            // The allowlist is still checked: the method must be defined in the module (two-space-or-deeper indent,
            // like every other method in this codebase), so a renamed method cannot ride the exception.
            const methodPattern = new RegExp(`(^|\\n)\\s+(async\\s+)?${symbol}\\s*\\(`)
            if (!methodPattern.test(readFileSync(join(ROOT, module), "utf8"))) {
              offenders.push(`${file}: ${module} -> ${symbol} (allowlisted method-style, but no method definition found in the module)`)
            }
            continue
          }
          offenders.push(`${file}: ${module} -> ${symbol} (not exported by the module, not allowlisted method-style)`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * The docs inline-citation contract.
 *
 * The 2026-11-17 re-anchor made docs/*.html cite `file · symbol` instead of file:line, but until this
 * pin nothing checked those citations: a citation could name a nonexistent module, or a symbol that no
 * longer exists, and no gate would notice. The path contract above pins that the cited file exists; the
 * symbol-export contract pins the `Exports:` card lines; this pins the inline `file · symbol` citations
 * in prose — every problem a reader would hit when following them.
 *
 * Scope and semantics (deliberately textual, not an AST walk):
 *   - Only citations inside <code>...</code> tags whose file part starts with `src/` or `packages/` and
 *     carries a source extension are in scope. UI copy with a middle dot ("loop · vN/M", footer texts)
 *     cites no module and is ignored.
 *   - The citation's symbol portion is split on `·` and `/`; each alternative (`evaluate()/finish()`) and
 *     each additional `·`-separated symbol (`types.ts · A · B`, all drawn from the cited module) is a
 *     claim against the same module. A trailing `()` on a part is dropped.
 *   - A part may be dotted (`GoalStore.pruneAllDirectories`, `Runtime.epoch`). Every dotted component
 *     must appear in the cited module's source (so a renamed or deleted symbol cannot hide behind its
 *     qualifier). In addition, when the part's first component resolves to a class or interface declared
 *     in the cited module, the LAST component must be defined in that construct's body — a field, method,
 *     accessor, constructor parameter property, or interface member. The body is located by finding
 *     `class|interface <Qualifier>` and brace-matching its opening `{` (skipping strings and comments).
 *     Other dotted parts (a qualifier that names no class/interface in the module — e.g. a free-function
 *     namespace or a re-export) keep the component-presence check.
 *   - The cited file must exist (root-relative to this repo).
 *
 * Adding a pass means the citation is checkable; a false offender means the citation is written in a
 * shape this test cannot attribute to the module — reword the citation to `file · symbol` form, not
 * the other way round.
 */
/**
 * Locate the body of `class <Name>` / `interface <Name>` in a TypeScript source text and return it
 * (between the outer braces). Brace matching skips string literals and comments. Returns undefined
 * when no such construct is declared in the module.
 */
const constructBody = (source: string, name: string): string | undefined => {
  const decl = new RegExp(`\\b(?:abstract\\s+|declare\\s+|export\\s+)*(?:class|interface)\\s+${name}\\b`)
  const match = decl.exec(source)
  if (!match) return undefined
  const open = source.indexOf("{", match.index)
  if (open === -1) return undefined
  let depth = 0
  let i = open
  let state: "code" | "sq" | "dq" | "tpl" | "line" | "block" = "code"
  while (i < source.length) {
    const ch = source[i] as string
    const next = source[i + 1]
    if (state === "code") {
      if (ch === "/" && next === "/") { state = "line"; i += 2; continue }
      if (ch === "/" && next === "*") { state = "block"; i += 2; continue }
      if (ch === "'") { state = "sq"; i += 1; continue }
      if (ch === '"') { state = "dq"; i += 1; continue }
      if (ch === "`") { state = "tpl"; i += 1; continue }
      if (ch === "{") depth += 1
      else if (ch === "}") { depth -= 1; if (depth === 0) return source.slice(open + 1, i) }
      i += 1
      continue
    }
    if (state === "line") { if (ch === "\n") state = "code"; i += 1; continue }
    if (state === "block") { if (ch === "*" && next === "/") { state = "code"; i += 2; continue } i += 1; continue }
    const closer = state === "sq" ? "'" : state === "dq" ? '"' : "`"
    if (ch === "\\") { i += 2; continue }
    if (ch === closer) state = "code"
    i += 1
  }
  return undefined
}

/** Is `member` defined in a class/interface body? Textual, anchored at line start / after `{` or `;`. */
const memberDefinedInBody = (body: string, member: string): boolean => {
  const pattern = new RegExp(`(?:^|[\n{;])\\s*(?:(?:public|private|protected|readonly|static|abstract|override|declare|async|get|set|accessor)\\s+)*${member}\\s*(?:[?(<:=;]|$)`, "m")
  return pattern.test(body)
}

describe("docs inline-citation contract", () => {
  test("every `file · symbol` citation in docs/*.html resolves (file exists; symbol components appear in that module)", () => {
    const codePattern = /<code>([^<]+)<\/code>/g
    const citationPattern = /((?:src|packages)\/[^<·]+?\.(?:tsx|ts|js|mjs))\s*·\s*([^<]+)/
    const componentPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

    const offenders: string[] = []
    for (const file of docHtml) {
      const text = readFileSync(join(ROOT, file), "utf8")
      for (const codeMatch of text.matchAll(codePattern)) {
        const inner = codeMatch[1] as string
        const citation = inner.match(citationPattern)
        if (!citation) continue // no file · symbol citation inside this code tag
        const module = citation[1] as string
        const modulePath = join(ROOT, module)
        if (!existsSync(modulePath)) {
          offenders.push(`${file}: cited module does not exist: ${module} (in <code>${inner.trim()}</code>)`)
          continue
        }
        const source = readFileSync(modulePath, "utf8")
        for (const rawPart of (citation[2] as string).split("·")) {
          for (const rawAlternative of rawPart.split("/")) {
            const part = rawAlternative.trim().replace(/\(\)/g, "").trim()
            if (!part || part === ".") continue
            for (const component of part.split(".")) {
              const name = component.trim()
              if (!name) continue
              if (!componentPattern.test(name)) {
                offenders.push(`${file}: ${module} -> ${part} (component ${JSON.stringify(name)} is not a plausible symbol; reword the citation)`)
                continue
              }
              if (!source.includes(name)) {
                offenders.push(`${file}: ${module} -> ${part} (component ${name} does not appear in the module's source)`)
              }
            }
            // Membership-grade check: if the first component resolves to a class or interface in the
            // cited module, the last component must be defined in that construct's body.
            const dotted = part.split(".").map((c) => c.trim()).filter(Boolean)
            if (dotted.length >= 2) {
              const qualifier = dotted[0] as string
              const member = dotted[dotted.length - 1] as string
              const body = constructBody(source, qualifier)
              if (body !== undefined && !memberDefinedInBody(body, member)) {
                offenders.push(`${file}: ${module} -> ${part} (${qualifier} resolves to a class/interface there, but ${member} is not defined in its body — not a field, method, accessor, parameter property, or interface member)`)
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * The src-wide wildcard re-export absence pin.
 *
 * The symbol-export and inline-citation contracts above read a cited module's *source text*. A
 * wildcard re-export (`export * from`, `export * as ns from`, `export type * from`) would let a
 * module export a symbol its own text never names, which is the one shape neither contract can
 * see — the recorded blind spot in both ("none exist in src/ today", a future one would need the
 * tests taught re-export resolution). Closing the hole by resolution would mean teaching both pins
 * to walk re-export chains; closing it by absence is simpler and just as strong: the construct
 * cannot land unnoticed, and if a module ever genuinely needs one, this pin forces the citation
 * contracts to be taught re-export resolution in the same change instead of silently weakening
 * them. Root entry surfaces (`index.ts` re-exports `src/index.ts`, `rpc.ts` wildcard-re-exports
 * `src/rpc.ts`) are out of scope because docs citations only ever name `src/`/`packages/` modules.
 *
 * Textual by design, like the rest of this file: strings and comments are blanked before the scan
 * so prose mentioning the construct (or a commented-out example) cannot trip it — only code can.
 * Named re-exports (`export { A } from "./a.ts"`, with or without `as`) are deliberately allowed:
 * the symbol-export contract already honors their aliasing.
 */
const SOURCE_FILE = /\.(?:ts|tsx)$/

const walkSources = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      out.push(...walkSources(abs))
      continue
    }
    if (entry.isFile() && SOURCE_FILE.test(entry.name)) out.push(abs)
  }
  return out
}

/** Blank string literals and comments (newlines preserved) so only code tokens remain. */
const codeOnly = (source: string): string => {
  let out = ""
  let i = 0
  let state: "code" | "sq" | "dq" | "tpl" | "line" | "block" = "code"
  while (i < source.length) {
    const ch = source[i] as string
    const next = source[i + 1]
    if (state === "code") {
      if (ch === "/" && next === "/") { state = "line"; out += "  "; i += 2; continue }
      if (ch === "/" && next === "*") { state = "block"; out += "  "; i += 2; continue }
      if (ch === "'") { state = "sq"; out += " "; i += 1; continue }
      if (ch === '"') { state = "dq"; out += " "; i += 1; continue }
      if (ch === "`") { state = "tpl"; out += " "; i += 1; continue }
      out += ch
      i += 1
      continue
    }
    if (state === "line") { out += ch === "\n" ? "\n" : " "; if (ch === "\n") state = "code"; i += 1; continue }
    if (state === "block") { out += ch === "\n" ? "\n" : " "; if (ch === "*" && next === "/") { state = "code"; out += " "; i += 2; continue } i += 1; continue }
    const closer = state === "sq" ? "'" : state === "dq" ? '"' : "`"
    if (ch === "\\") { out += next === "\n" ? "\n" : "  "; i += 2; continue }
    if (ch === closer) { state = "code"; out += " "; i += 1; continue }
    out += ch === "\n" ? "\n" : " "
    i += 1
  }
  return out
}

describe("src-wide wildcard re-export absence", () => {
  test("no module in src/ or packages/ wildcard-re-exports (`export * from` / `export * as ns from` / `export type * from`)", () => {
    const wildcard = /\bexport\s+(?:type\s+)?\*/
    const offenders: string[] = []
    const roots = [join(ROOT, "src"), join(ROOT, "packages")].filter((dir) => existsSync(dir))
    for (const root of roots) {
      for (const abs of walkSources(root)) {
        const code = codeOnly(readFileSync(abs, "utf8"))
        const at = code.search(wildcard)
        if (at !== -1) {
          const line = code.slice(0, at).split("\n").length
          offenders.push(`${relative(ROOT, abs)}:${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
