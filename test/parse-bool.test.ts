/**
 * Equivalence proof for the parseBool consolidation (workstream CXLVI).
 *
 * The three pre-consolidation classifiers had different policies around the same spelling table:
 *   - config.ts `flag`          tri-state — boolean passthrough, string trim/lower + both tables, else undefined
 *   - index.ts  `probeFlag`     default-off — same truthy table, everything else false
 *   - prompter  `boolFrom`      fallback or throw, with String() coercion of non-string values
 * They are reproduced verbatim below as ORACLES, not used by production code. The suite checks that
 * the single shared `parseBool` classifier plus each site's thin policy adapter reproduce the old
 * results exactly over a broad corpus — including which inputs throw and the thrown message.
 */
import { describe, expect, test } from "bun:test"
import { parseBool } from "../src/core/parse.ts"
import { resolveConfig } from "../src/core/config.ts"
import { boolFrom } from "../src/prompter/util.ts"

// ---- Pre-consolidation oracles (verbatim from the pre-change files) ----
const oldFlag = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return undefined
}

const oldProbeFlag = (value: string | undefined): boolean => {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(normalized)
}

const oldBoolFrom = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  const s = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(s)) return true
  if (["0", "false", "no", "off"].includes(s)) return false
  throw new Error(`expected a boolean, got ${JSON.stringify(value)}`)
}

/** Inputs spanning booleans, every canonical spelling with case/whitespace, unrecognized tokens and non-strings. */
const corpus: unknown[] = [
  true, false,
  "1", "true", "yes", "on", "TRUE", "YeS", " ON ", "\ttrue\n", " 1 ",
  "0", "false", "no", "off", "FALSE", "nO", " OFF ", "\tno\n", " 0 ",
  "", "   ", "maybe", "2", "-1", "y", "n", "enabled", "null", "undefined", "NaN",
  undefined, null, 0, 1, 2, NaN, Number.POSITIVE_INFINITY,
  [], {}, ["true"], new String("true"), new String(" off "),
  { toString: () => "YES" }, { toString: () => "  maybe  " },
]

/** Capture either a return value or the thrown error message, so throws are compared too. */
const outcome = (fn: () => unknown): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: fn() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

describe("parseBool consolidation", () => {
  test("the shared classifier is tri-state and matches the former config flag exactly", () => {
    for (const value of corpus) {
      expect(parseBool(value)).toBe(oldFlag(value))
    }
    expect(parseBool(" TRUE ")).toBe(true)
    expect(parseBool(" off ")).toBe(false)
    expect(parseBool("maybe")).toBeUndefined()
    expect(parseBool(1)).toBeUndefined() // strict: only booleans and strings are classified
  })

  test("the probe default-off policy is unchanged for every string input", () => {
    const strings = corpus.filter((v): v is string | undefined => typeof v === "string" || v === undefined)
    for (const value of strings) {
      expect(parseBool(value) === true).toBe(oldProbeFlag(value))
    }
    expect(oldProbeFlag("0")).toBe(false)
    expect(parseBool("0") === true).toBe(false)
  })

  test("boolFrom keeps its fallback and throw policy, including String() coercion", () => {
    for (const fallback of [true, false]) {
      for (const value of corpus) {
        expect(outcome(() => boolFrom(value, fallback))).toEqual(outcome(() => oldBoolFrom(value, fallback)))
      }
    }
    // Non-string coercion really is preserved, not dropped by the consolidation.
    expect(boolFrom(1, false)).toBe(true)
    expect(boolFrom(new String(" off "), true)).toBe(false)
    expect(outcome(() => boolFrom("maybe", true))).toEqual({ ok: false, error: 'expected a boolean, got "maybe"' })
  })

  test("config call sites still resolve env flags and coordinator options identically", () => {
    for (const token of ["1", "true", "yes", "ON", "0", "false", "no", "OFF", "maybe", "", " TRUE "]) {
      expect(resolveConfig({}, { OPENCODE_GOAL_REQUIRE_COMMIT: token }).commit.enabled)
        .toBe((oldFlag(token) ?? true) === true)
      const coordinator = resolveConfig({}, { OPENCODE_GOAL_COORDINATOR: token }).commit.coordinator
      expect(coordinator).toBe(token === undefined || token === "auto" || token === "" ? "auto" : (oldFlag(token) ?? "auto"))
    }
  })
})
