/**
 * Pins .github/workflows/check.yml — the CI gate documented in README.md and SPEC.md Workstream D
 * ("runs on push to dev/main and on pull requests: bun install --frozen-lockfile, bun run check,
 * an npm pack --dry-run smoke test; oven-sh/setup-bun@v2; no secrets or network dependencies beyond
 * package registries"). Structural, line-based assertions — no YAML parser dependency, and every
 * documented claim maps to exactly one test.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const WORKFLOW = join(ROOT, ".github", "workflows", "check.yml")
const yaml = readFileSync(WORKFLOW, "utf8")
const lines = yaml.split("\n")

const hasLine = (pattern: RegExp): boolean => lines.some((line) => pattern.test(line))
const lineIndex = (pattern: RegExp): number => lines.findIndex((line) => pattern.test(line))

describe("CI workflow (.github/workflows/check.yml)", () => {
  test("exists and declares a workflow name", () => {
    expect(yaml.length).toBeGreaterThan(0)
    expect(hasLine(/^name:\s*\S/)).toBe(true)
  })

  test("triggers on push to exactly dev and main", () => {
    const pushIdx = lineIndex(/^on:/) === -1 ? lineIndex(/^on\s*:/) : lineIndex(/^on:/)
    expect(pushIdx).not.toBe(-1)
    const pushBranches = yaml.match(/push:\s*\n\s+branches:\s*\[([^\]]+)\]/)
    expect(pushBranches).not.toBeNull()
    const branches = (pushBranches?.[1] ?? "").split(",").map((b) => b.trim())
    expect(branches).toEqual(["dev", "main"])
  })

  test("also triggers on pull requests", () => {
    expect(hasLine(/^\s+pull_request:/)).toBe(true)
  })

  test("a check job runs on ubuntu-latest", () => {
    expect(hasLine(/^\s+check:/)).toBe(true)
    expect(hasLine(/^\s+runs-on:\s*ubuntu-latest/)).toBe(true)
  })

  test("uses actions/checkout before oven-sh/setup-bun@v2", () => {
    const checkout = lineIndex(/uses:\s*actions\/checkout@v4/)
    const setupBun = lineIndex(/uses:\s*oven-sh\/setup-bun@v2/)
    expect(checkout).not.toBe(-1)
    expect(setupBun).not.toBe(-1)
    expect(setupBun).toBeGreaterThan(checkout)
  })

  test("fetches full history (docs:check derives stamps and the changelog from git log)", () => {
    expect(hasLine(/^\s+fetch-depth:\s*0\s*$/)).toBe(true)
  })

  test("pins the bun version the dist byte-compare gate was verified with", () => {
    expect(hasLine(/^\s+bun-version:\s*1\.4\.2\s*$/)).toBe(true)
  })

  test("installs with a frozen lockfile", () => {
    expect(hasLine(/run:\s*bun install --frozen-lockfile\s*$/)).toBe(true)
  })

  test("runs the same `bun run check` gate as local development", () => {
    expect(hasLine(/run:\s*bun run check\s*$/)).toBe(true)
  })

  test("runs an npm pack dry-run smoke test", () => {
    expect(hasLine(/run:\s*npm pack --dry-run\s*$/)).toBe(true)
  })

  test("step order is install -> check -> pack", () => {
    const install = lineIndex(/bun install --frozen-lockfile/)
    const check = lineIndex(/bun run check/)
    const pack = lineIndex(/npm pack --dry-run/)
    expect(install).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(install)
    expect(pack).toBeGreaterThan(check)
  })

  test("carries no publish secrets and no publish step", () => {
    expect(yaml).not.toMatch(/secrets\./)
    expect(yaml).not.toMatch(/NPM_TOKEN/i)
    expect(yaml).not.toMatch(/npm publish/)
    expect(yaml).not.toMatch(/--access\s+public/)
    expect(yaml).not.toMatch(/NODE_AUTH_TOKEN/)
  })

  test("carries no credentials of any kind beyond package registries", () => {
    expect(yaml).not.toMatch(/password:/i)
    expect(yaml).not.toMatch(/token:/i)
    expect(yaml).not.toMatch(/authorization/i)
    expect(yaml).not.toMatch(/github\.com\/(settings|user\/keys)/i)
  })
})
