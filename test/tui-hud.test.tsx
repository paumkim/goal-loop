/**
 * Headless tests for the HUD: pure model helpers in src/core/hud.ts (pill label/tone, hot
 * compaction detection, failure-first-class remediation) and the compact card in
 * src/hud-card.tsx, including real mouse clicks via the test renderer's mock mouse.
 * Card clicks are hit-test assertions: the callbacks must fire at the cell the label occupies.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { HudCard, hudCardRows, cardRowPlan, pinBudget, footerCopyLabel, footerPinLabel, footerButtonCells, dialogFooterTier, DIALOG_FOOTER_FULL_HINT, DIALOG_FOOTER_SHORT_HINT, type HudCardTheme } from "../src/hud-card.tsx"
import { isCompactHot, pillModel, pillCaret, landingSuffix, hudArmEnabled, remediationFor, pinSuffix, motionDisabled, terminalPill, TERMINAL_ACK_MS, ACK_FLASH_MS, LANDING_ACK_MS, LANDING_SUFFIX, pillMotionNeeded, stateAccentColor, borderAccentColor, verdictAccentColor, fixAccentColor, evaluatorHint, EVALUATOR_HINT_CARD, EVALUATOR_HINT_FULL } from "../src/core/hud.ts"
import stringWidth from "string-width"
import { GOAL_GLYPH, goalGlyph } from "../src/core/format.ts"
import { LoopSection, type HistoryTheme } from "../src/tui-history.tsx"
import type { GoalSnapshot, Verdict } from "../src/core/types.ts"

const theme: HudCardTheme = {
  text: {
    base: RGBA.fromHex("#e8e8e8"),
    muted: RGBA.fromHex("#a0a0a0"),
    faint: RGBA.fromHex("#6f6f6f"),
    feedback: {
      info: { base: RGBA.fromHex("#6cb6ff") },
      warning: { base: RGBA.fromHex("#e0af3c") },
      error: { base: RGBA.fromHex("#ff6c6c") },
    },
  },
  border: { base: RGBA.fromHex("#3f3f3f") },
  background: { raised: { high: RGBA.fromHex("#161616") } },
}

const now = 1_800_000_000_000
const baseline = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const verdicts = (list: Verdict[]): GoalSnapshot["history"] =>
  list.map((verdict, index) => ({ turn: index + 1, verdict, reason: verdict === "met" ? "done" : "not yet", at: now - 1000 * 60 * (list.length - index) }))

const loopedGoal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_hud",
  sessionID: "ses_hud",
  directory: "/tmp/hud",
  condition: "make every loop iteration visible at a glance",
  status: "active",
  reason: "Evaluator: not yet",
  setAt: now - 1000 * 60 * 42,
  startedAt: now - 1000 * 60 * 42,
  turns: 4,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline,
  history: verdicts(["met", "not_met", "met"]),
  loopEnabled: true,
  loopIteration: 3,
  loopObjective: "world-class mouse-first goal TUI",
  loopMaxLoops: 5,
  loopHistory: [
    { version: 1, condition: "add a progress bar", summary: "Added the bar.", reason: "met", turns: 9, toolCalls: 41, endedAt: now - 1000 * 60 * 27 },
    { version: 2, condition: "render the trail", summary: "Trail renders.", reason: "met", turns: 6, toolCalls: 23, endedAt: now - 1000 * 60 * 12 },
  ],
  loopNotProgress: 0,
  elapsedMs: 1000 * 60 * 12,
  evaluating: false,
  waiting: false,
  ...overrides,
})

const render = async (node: () => JSX.Element, width = 80, height = 12): Promise<{ frame: string; setup: Awaited<ReturnType<typeof testRender>> }> => {
  const setup = await testRender(node, { width, height })
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  return { frame, setup }
}

/** Locate the first cell of `needle` in the captured frame (row, column), or undefined. */
const find = (frame: string, needle: string): { x: number; y: number } | undefined => {
  const lines = frame.split("\n")
  for (let y = 0; y < lines.length; y += 1) {
    const x = lines[y]!.indexOf(needle)
    if (x >= 0) return { x, y }
  }
  return undefined
}

describe("pillModel", () => {
  test("armed looped goal renders vN/M, pips and the armed tone", () => {
    const pill = pillModel(loopedGoal(), 1000 * 60 * 12)
    expect(pill.text).toContain("loop · v3/5")
    expect(pill.text).toContain("●●")
    expect(pill.text).toContain("4 turns")
    expect(pill.tone).toBe("armed")
  })

  test("a budget walks the degradation ladder — retry drops first, then compact, then turns, then pips — and never exceeds the cells given", () => {
    const distress = loopedGoal({ loopIteration: 5, loopMaxLoops: 5, turns: 123, retries: 12, loopCompact: { requestedAt: now - 60_000, iteration: 3, misses: 4 } })
    const full = pillModel(distress, 1000 * 60 * 45)
    expect(stringWidth(full.text)).toBeLessThanOrEqual(Number.POSITIVE_INFINITY)
    // 70 cells: retry is dropped; turns and compact survive.
    const dropRetry = pillModel(distress, 1000 * 60 * 45, false, 70)
    expect(dropRetry.text).not.toContain("retry")
    expect(dropRetry.text).toContain("compact pending")
    expect(stringWidth(dropRetry.text)).toBeLessThanOrEqual(70)
    // 45 cells: retry and compact both go; turns survive.
    const dropCompact = pillModel(distress, 1000 * 60 * 45, false, 45)
    expect(dropCompact.text).not.toContain("compact")
    expect(dropCompact.text).not.toContain("retry")
    expect(dropCompact.text).toContain("turns")
    expect(stringWidth(dropCompact.text)).toBeLessThanOrEqual(45)
    // 33 cells: turns go too; the state core + pips remain.
    const dropTurns = pillModel(distress, 1000 * 60 * 45, false, 33)
    expect(dropTurns.text).not.toContain("turns")
    expect(stringWidth(dropTurns.text)).toBeLessThanOrEqual(33)
    // An absurdly small budget hard-truncates the core with an ellipsis instead of painting wide.
    const tiny = pillModel(distress, 1000 * 60 * 45, false, 8)
    expect(stringWidth(tiny.text)).toBeLessThanOrEqual(8)
    expect(tiny.text.endsWith("…")).toBe(true)
  })

  test("a budget on a non-loop goal drops retry, then turns, before truncating the core", () => {
    const plain = loopedGoal({ loopEnabled: false, loopHistory: [], turns: 321, retries: 7 }) as unknown as GoalSnapshot
    const dropRetry = pillModel(plain, 1000 * 60 * 41, false, 33)
    expect(dropRetry.text).not.toContain("retry")
    expect(dropRetry.text).toContain("turns")
    const dropTurns = pillModel(plain, 1000 * 60 * 41, false, 25)
    expect(dropTurns.text).not.toContain("retry")
    expect(dropTurns.text).not.toContain("turns")
    expect(stringWidth(dropTurns.text)).toBeLessThanOrEqual(25)
  })

  test("ascii mode demotes the pips and leaves the rest of the label untouched", () => {
    const pill = pillModel(loopedGoal(), 1000 * 60 * 12, true)
    expect(pill.text).toContain("##")
    expect(pill.text).not.toContain("●")
    expect(pill.text).not.toContain("○")
    expect(pill.text).toContain("loop · v3/5")
    expect(pill.tone).toBe("armed")
  })

  test("evaluating goal renders the checking state and evaluating tone", () => {
    const pill = pillModel(loopedGoal({ evaluating: true }), 1000 * 60 * 12)
    expect(pill.text).toContain("checking")
    expect(pill.tone).toBe("evaluating")
  })

  test("paused goal renders the paused tone", () => {
    expect(pillModel(loopedGoal({ status: "paused" }), 0).tone).toBe("paused")
  })

  test("hot compaction overrides the tone to hot and shows the miss counter", () => {
    const pill = pillModel(loopedGoal({ loopCompact: { requestedAt: now - 60_000, iteration: 3, misses: 2 } }), 1000 * 60 * 12)
    expect(pill.tone).toBe("hot")
    expect(pill.text).toContain("compact pending (2/4)")
  })

  test("one miss is not hot yet", () => {
    expect(pillModel(loopedGoal({ loopCompact: { requestedAt: now - 60_000, iteration: 3, misses: 1 } }), 0).tone).toBe("armed")
  })

  test("non-looped goal renders the plain pill", () => {
    const { loopEnabled: _a, loopIteration: _b, loopObjective: _c, loopMaxLoops: _d, loopHistory: _e, loopNotProgress: _f, ...plain } = loopedGoal()
    const pill = pillModel(plain as GoalSnapshot, 1000 * 60 * 41)
    expect(pill.text).toContain("goal active")
    expect(pill.text).not.toContain("loop")
  })

  test("a goal stuck at 3 failed turns renders the stuck word with the retry counter and the retrying tone", () => {
    const pill = pillModel(loopedGoal({ retries: 3 }), 1000 * 60 * 12)
    expect(pill.text).toContain("stuck")
    expect(pill.text).toContain("· retry 3")
    expect(pill.tone).toBe("retrying")
  })

  test("two retries are not stuck yet", () => {
    const pill = pillModel(loopedGoal({ retries: 2 }), 1000 * 60 * 12)
    expect(pill.text).not.toContain("retry")
    expect(pill.tone).toBe("armed")
  })

  test("paused outranks a stuck retry loop (the pause IS the rate-limit story)", () => {
    const pill = pillModel(loopedGoal({ retries: 5, status: "paused" }), 1000 * 60 * 12)
    expect(pill.tone).toBe("paused")
    expect(pill.text).toContain("· retry 5")
  })
})

describe("isCompactHot", () => {
  test("pending with >=2 misses is hot; landed or low misses are not", () => {
    expect(isCompactHot(loopedGoal({ loopCompact: { requestedAt: now, iteration: 3, misses: 2 } }))).toBe(true)
    expect(isCompactHot(loopedGoal({ loopCompact: { requestedAt: now, iteration: 3, misses: 4 } }))).toBe(true)
    expect(isCompactHot(loopedGoal({ loopCompact: { requestedAt: now, landedAt: now, iteration: 3, misses: 3 } }))).toBe(false)
    expect(isCompactHot(loopedGoal({ loopCompact: { requestedAt: now, iteration: 3, misses: 1 } }))).toBe(false)
    expect(isCompactHot(loopedGoal())).toBe(false)
  })
})

describe("remediationFor", () => {
  test("failed goal renders an error remediation with the reset hint", () => {
    const fix = remediationFor(loopedGoal({ status: "failed", reason: "provider exploded" }))
    expect(fix?.tone).toBe("error")
    expect(fix?.text).toContain("/goal clear")
  })

  test("an impossible verdict renders a rephrase-or-clear remediation", () => {
    const fix = remediationFor(loopedGoal({ status: "impossible", reason: "no feasible path" }))
    expect(fix?.tone).toBe("warning")
    expect(fix?.text).toContain("rephrase")
    expect(fix?.text).toContain("/goal clear")
  })

  test("hot compaction renders the /compact hint and the verifyCommand suggestion", () => {
    const fix = remediationFor(loopedGoal({ loopCompact: { requestedAt: now - 60_000, estimatedTokens: 182_000, iteration: 3, misses: 2 } }))
    expect(fix?.tone).toBe("warning")
    expect(fix?.text).toContain("compact pending 2/4")
    expect(fix?.text).toContain("evaluator.verifyCommand")
  })

  test("a 3x not_met streak renders the verifyCommand suggestion", () => {
    const fix = remediationFor(loopedGoal({ history: verdicts(["met", "not_met", "not_met", "not_met"]) }))
    expect(fix?.tone).toBe("warning")
    expect(fix?.text).toContain("3x not_met in a row")
    expect(fix?.text).toContain("evaluator.verifyCommand")
  })

  test("nominal goal renders no remediation", () => {
    expect(remediationFor(loopedGoal())).toBeUndefined()
  })

  test("an unrecoverable failure outranks a hot compaction", () => {
    const fix = remediationFor(loopedGoal({ status: "failed", loopCompact: { requestedAt: now, iteration: 3, misses: 3 } }))
    expect(fix?.tone).toBe("error")
  })

  test("3 failed turns in a row render the check-provider remediation", () => {
    const fix = remediationFor(loopedGoal({ retries: 4 }))
    expect(fix?.tone).toBe("warning")
    expect(fix?.text).toContain("4 failed turns in a row")
    expect(fix?.text).toContain("provider")
    expect(fix?.text).toContain("/goal clear")
  })

  test("two failed turns are not remediation-worthy yet", () => {
    expect(remediationFor(loopedGoal({ retries: 2 }))).toBeUndefined()
  })

  test("an impossible verdict outranks a stuck retry loop", () => {
    const fix = remediationFor(loopedGoal({ status: "impossible", retries: 5 }))
    expect(fix?.text).toContain("rephrase")
  })

  test("a stuck retry loop outranks a hot compaction", () => {
    const fix = remediationFor(loopedGoal({ retries: 3, loopCompact: { requestedAt: now, iteration: 3, misses: 3 } }))
    expect(fix?.text).toContain("failed turns")
  })
})

describe("remediationFor paused", () => {
  test("a cap-paused goal gets the cap remedy, never a resume hint", () => {
    const fix = remediationFor(loopedGoal({ status: "paused", pauseCause: "cap" }))
    expect(fix?.tone).toBe("warning")
    expect(fix?.text).toContain("turn cap reached")
    expect(fix?.text).toContain("will not extend it")
    expect(fix?.text).not.toContain("message to resume")
  })

  test("a stall-paused goal gets the nudge remedy with the stall count", () => {
    const fix = remediationFor(loopedGoal({ status: "paused", pauseCause: "stall", stall: 4 }))
    expect(fix?.tone).toBe("warning")
    expect(fix?.text).toContain("no tool use for 4 turns")
    expect(fix?.text).toContain("send a message to resume")
  })

  test("a user-interrupted pause gets the resume remedy", () => {
    const fix = remediationFor(loopedGoal({ status: "paused", pauseCause: "user" }))
    expect(fix?.text).toBe("interrupted · send a message to resume")
  })

  test("a paused record persisted before pauseCause falls back to the generic remedy", () => {
    const fix = remediationFor(loopedGoal({ status: "paused" }))
    expect(fix?.text).toBe("paused · send a message to resume, or /goal clear")
  })

  test("a paused goal outranks a stuck retry loop", () => {
    const fix = remediationFor(loopedGoal({ status: "paused", pauseCause: "user", retries: 6 }))
    expect(fix?.text).toContain("interrupted")
  })
})

describe("remediationFor failed", () => {
  test("a failed goal with a classifier label names the cause, not just the state", () => {
    const fix = remediationFor(loopedGoal({ status: "failed", failureLabel: "authentication failure" }))
    expect(fix?.tone).toBe("error")
    expect(fix?.text).toBe("authentication failure - /goal clear to reset")
  })

  test("a failed record persisted before failureLabel falls back to the generic remedy", () => {
    const fix = remediationFor(loopedGoal({ status: "failed" }))
    expect(fix?.text).toBe("goal failed - /goal clear to reset")
  })
})

describe("pinSuffix", () => {
  test("returns empty when the condition budget is below PIN_MIN_WIDTH or not finite", () => {
    expect(pinSuffix("condition", 11)).toBe("")
    expect(pinSuffix("condition", Number.NaN)).toBe("")
    expect(pinSuffix("condition", -3)).toBe("")
  })

  test("appends the truncated condition and stays within the budget", () => {
    const budget = 12
    const suffix = pinSuffix("some very long condition that goes on and on", budget)
    expect(suffix.startsWith(" · pin: ")).toBe(true)
    expect(suffix.length).toBeLessThanOrEqual(" · pin: ".length + budget)
    const asciiSuffix = pinSuffix("some very long condition that goes on and on", budget, true)
    expect(asciiSuffix.endsWith("...")).toBe(true)
    expect(asciiSuffix.length).toBeLessThanOrEqual(" · pin: ".length + budget)
  })

  test("short condition renders whole without truncation", () => {
    expect(pinSuffix("ship it", 40)).toBe(" · pin: ship it")
  })

  test("empty and whitespace-only conditions yield empty", () => {
    expect(pinSuffix("   ", 40)).toBe("")
    expect(pinSuffix("", 40)).toBe("")
  })

  test("newlines are flattened before measuring", () => {
    expect(pinSuffix("line one\nline two", 40)).toBe(" · pin: line one line two")
  })
})

describe("pinBudget", () => {
  test("subtracts the pill text, the pin prefix and one cell of breathing room", () => {
    expect(pinBudget(80, "p".repeat(40))).toBe(80 - 40 - " · pin: ".length - 1)
    // Wide (East Asian) glyphs in the pill text budget by cells, not code units: 20 glyphs × 2 cells = 40 cells
    expect(pinBudget(80, "世".repeat(20))).toBe(80 - 40 - stringWidth(" · pin: ") - 1)
  })
})

describe("pillMotionNeeded", () => {
  test("all quiet is static — an armed, idle goal never pulses", () => {
    expect(pillMotionNeeded({})).toBe(false)
    expect(pillMotionNeeded({ evaluating: false, hot: false, flashing: false })).toBe(false)
  })

  test("the just-achieved flash alone drives the pulse — the flash rides the same cadence as the evaluating shimmer", () => {
    expect(pillMotionNeeded({ flashing: true })).toBe(true)
  })

  test("the just-landed window alone drives the pulse — a landing is worth catching even when nothing else moves", () => {
    expect(pillMotionNeeded({ landing: true })).toBe(true)
    expect(pillMotionNeeded({ evaluating: false, hot: false, flashing: false, landing: true })).toBe(true)
  })

  test("the landing acknowledgment is a bounded window longer than the met flash, with a compact suffix", () => {
    expect(LANDING_ACK_MS).toBeGreaterThan(ACK_FLASH_MS)
    expect(LANDING_ACK_MS).toBeLessThan(TERMINAL_ACK_MS)
    expect(LANDING_SUFFIX).toBe(" · landed ✓")
  })

  test("evaluating and a hot compaction drive the pulse independently", () => {
    expect(pillMotionNeeded({ evaluating: true })).toBe(true)
    expect(pillMotionNeeded({ hot: true })).toBe(true)
  })

  test("the flash window is a short, deliberate burst — sensible and bounded", () => {
    expect(ACK_FLASH_MS).toBeGreaterThan(0)
    expect(ACK_FLASH_MS).toBeLessThan(TERMINAL_ACK_MS)
  })
})

describe("terminalPill", () => {
  test("a finished single goal renders the acknowledgment with frozen elapsed and turns", () => {
    const model = terminalPill(loopedGoal({ status: "achieved", loopEnabled: false, loopHistory: undefined, loopMaxLoops: undefined, turns: 4, elapsedMs: 1000 * 60 * 12 }), 1000 * 60 * 12)
    expect(model?.tone).toBe("achieved")
    expect(model?.text).toBe(`${GOAL_GLYPH} goal achieved · 12m · 4 turns`)
  })

  test("a finished loop renders the completion grammar with iteration and cap", () => {
    const model = terminalPill(loopedGoal({ status: "achieved", loopIteration: 5, loopMaxLoops: 5, turns: 31, elapsedMs: 1000 * 60 * 48 }), 1000 * 60 * 48)
    expect(model?.tone).toBe("achieved")
    expect(model?.text).toBe(`${GOAL_GLYPH} loop complete · v5/5 · 48m · 31 turns`)
  })

  test("an impossible verdict renders in the same grammar", () => {
    const model = terminalPill(loopedGoal({ status: "impossible", loopIteration: 3, turns: 9, elapsedMs: 1000 * 60 * 30 }), 1000 * 60 * 30)
    expect(model?.tone).toBe("impossible")
    expect(model?.text).toBe(`${GOAL_GLYPH} loop impossible · v3/5 · 30m · 9 turns`)
  })

  test("a failed goal renders the failure tone and zero-turn goals omit the turns segment", () => {
    const model = terminalPill(loopedGoal({ status: "failed", loopEnabled: false, loopHistory: undefined, loopMaxLoops: undefined, turns: 0, elapsedMs: 1000 * 60 * 2 }), 1000 * 60 * 2)
    expect(model?.tone).toBe("failed")
    expect(model?.text).toBe(`${GOAL_GLYPH} goal failed · 2m`)
  })

  test("a width budget caps the acknowledgment — it never paints past the cells it is given", () => {
    const wide = loopedGoal({ status: "achieved", loopIteration: 12, loopMaxLoops: 20, turns: 142, elapsedMs: 1000 * 60 * 60 * 30 })
    const unicode = terminalPill(wide, 1000 * 60 * 60 * 30, false, 24)
    expect(unicode?.text.endsWith("\u2026")).toBe(true)
    expect(stringWidth(unicode?.text ?? "")).toBeLessThanOrEqual(24)
    const ascii = terminalPill(wide, 1000 * 60 * 60 * 30, true, 24)
    expect(ascii?.text.endsWith("...")).toBe(true)
    expect(stringWidth(ascii?.text ?? "")).toBeLessThanOrEqual(24)
    // A budget the text fits stays byte-identical, and an absent budget keeps the wire-compatible output.
    expect(terminalPill(wide, 1000 * 60 * 60 * 30, true, 400)?.text).toBe(terminalPill(wide, 1000 * 60 * 60 * 30, true)?.text)
  })

  test("live and deliberately cleared goals render no acknowledgment", () => {
    expect(terminalPill(loopedGoal({ status: "active" }), 0)).toBeUndefined()
    expect(terminalPill(loopedGoal({ status: "paused" }), 0)).toBeUndefined()
    expect(terminalPill(loopedGoal({ status: "cleared" }), 0)).toBeUndefined()
  })

  test("the acknowledgment window lasts 45s — long enough to notice, never furniture", () => {
    expect(TERMINAL_ACK_MS).toBe(45_000)
  })
})

describe("motionDisabled", () => {
  test("NO_COLOR and TERM=dumb each disable motion; other terminals keep it", () => {
    expect(motionDisabled({ NO_COLOR: "" })).toBe(true)
    expect(motionDisabled({ NO_COLOR: "1" })).toBe(true)
    expect(motionDisabled({ TERM: "dumb" })).toBe(true)
    expect(motionDisabled({ TERM: "xterm-256color" })).toBe(false)
    expect(motionDisabled({})).toBe(false)
  })
})

describe("accent mappers (reduced color)", () => {
  test("stateAccentColor collapses to base for live/terminal words and faint for cleared under mono", () => {
    for (const status of ["active", "paused", "achieved", "impossible", "failed"]) {
      expect(stateAccentColor(theme, status, false, true)).toBe(theme.text.base)
    }
    expect(stateAccentColor(theme, "cleared", false, true)).toBe(theme.text.faint)
    // Color mode sanity: the mappings the mono path bypasses stay intact.
    expect(stateAccentColor(theme, "active", false, false)).toBe(theme.text.feedback.info.base)
    expect(stateAccentColor(theme, "active", true, false)).toBe(theme.text.feedback.warning.base)
    expect(stateAccentColor(theme, "failed", false, false)).toBe(theme.text.feedback.error!.base)
  })

  test("borderAccentColor under mono defers to the border override or faint, never the amber family", () => {
    expect(borderAccentColor(theme, "active", {}, true)).toBe(theme.border?.base ?? theme.text.faint)
    expect(borderAccentColor(theme, "impossible", {}, true)).toBe(theme.border?.base ?? theme.text.faint)
    expect(borderAccentColor(theme, "achieved", {}, false)).toBe(theme.text.feedback.info.base)
    expect(borderAccentColor(theme, "paused", {}, false)).toBe(theme.text.feedback.warning.base)
    expect(borderAccentColor(theme, "active", { hot: true }, false)).toBe(theme.text.feedback.warning.base)
  })

  test("verdictAccentColor under mono keeps met/impossible in base and others faint", () => {
    expect(verdictAccentColor(theme, "met", true)).toBe(theme.text.base)
    expect(verdictAccentColor(theme, "impossible", true)).toBe(theme.text.base)
    expect(verdictAccentColor(theme, "not_met", true)).toBe(theme.text.faint)
    expect(verdictAccentColor(theme, "met", false)).toBe(theme.text.feedback.info.base)
    expect(verdictAccentColor(theme, "not_met", false)).toBe(theme.text.faint)
  })

  test("fixAccentColor under mono renders base for both tones", () => {
    expect(fixAccentColor(theme, "warning", true)).toBe(theme.text.base)
    expect(fixAccentColor(theme, "error", true)).toBe(theme.text.base)
    expect(fixAccentColor(theme, "error", false)).toBe(theme.text.feedback.error!.base)
    expect(fixAccentColor(theme, "warning", false)).toBe(theme.text.feedback.warning.base)
  })
})

describe("evaluatorHint", () => {
  const fresh = () => loopedGoal({ turns: 0, history: [], loopIteration: 1, loopHistory: [], reason: undefined, spend: undefined })

  test("a freshly armed goal teaches — looped and plain alike", () => {
    const hint = evaluatorHint(fresh())
    expect(hint).not.toBeNull()
    expect(hint?.card).toBe(EVALUATOR_HINT_CARD)
    expect(hint?.full).toBe(EVALUATOR_HINT_FULL)
    // The card cell must fit the 56-cell card interior (64-wide panel minus label and gap).
    expect(hint?.card.length).toBeLessThanOrEqual(56)
  })

  test("gone forever after the first turn, the first verdict, or a pause — and when remediation owns the moment", () => {
    expect(evaluatorHint(loopedGoal({ turns: 0, history: [], loopCompact: { requestedAt: now, iteration: 3, misses: 2 } }))).toBeNull()
    expect(evaluatorHint(loopedGoal({ turns: 1, history: [] }))).toBeNull()
    expect(evaluatorHint(loopedGoal({ turns: 0, history: [{ turn: 1, verdict: "not_met", reason: "no", at: now }] }))).toBeNull()
    expect(evaluatorHint(loopedGoal({ turns: 0, history: [], status: "paused", pauseCause: "cap" }))).toBeNull()
    expect(evaluatorHint(loopedGoal({ turns: 0, history: [], status: "achieved" }))).toBeNull()
    expect(evaluatorHint(loopedGoal({ turns: 0, history: [], status: "failed" }))).toBeNull()
  })

  test("hudCardRows grows one row for the teaching hint while the goal is fresh", () => {
    expect(hudCardRows(fresh())).toBe(6)
    // After the first turn lands, the hint is gone and the card relaxes to its pre-hint size.
    expect(hudCardRows(loopedGoal({ turns: 1, history: [{ turn: 1, verdict: "not_met", reason: "no", at: now }] }))).toBe(7)
  })
})

describe("hudCardRows", () => {
  test("grows by exactly one row when the snapshot carries a spend estimate", () => {
    const spend = { cost: 0.42, input: 120_000, output: 8_400, reasoning: 0, cacheRead: 30_000, cacheWrite: 0 }
    expect(hudCardRows(loopedGoal({ spend }))).toBe(8)
    const { history: _h, spend: _s, ...bare } = loopedGoal({ spend })
    expect(hudCardRows(bare as unknown as GoalSnapshot)).toBe(6)
  })

  test("grows by one row for the last-verdict line and one for the remediation", () => {
    expect(hudCardRows(loopedGoal())).toBe(7)
    expect(hudCardRows(loopedGoal({ loopCompact: { requestedAt: now, iteration: 3, misses: 2 } }))).toBe(9)
    expect(hudCardRows(loopedGoal({ status: "paused", pauseCause: "cap" }))).toBe(9)
    const { history: _h, ...noHistory } = loopedGoal()
    expect(hudCardRows(noHistory as GoalSnapshot)).toBe(6)
  })
})

describe("footerButtonCells / dialogFooterTier", () => {
  test("a button costs its label plus four cells of chrome (brackets + 1 cell padding each side)", () => {
    expect(footerButtonCells("clear")).toBe(9)
    expect(footerButtonCells("clear goal")).toBe(14)
    expect(footerButtonCells("pin condition")).toBe(17)
    expect(footerButtonCells("✓ copied")).toBe(12)
  })

  test("80 columns paints compact in every state — the floor always holds", () => {
    for (const copied of [false, true]) for (const pinned of [false, true]) {
      expect(dialogFooterTier(80, copied, pinned)).toEqual({ wide: false, roomy: false })
    }
  })

  test("chrome glyphs demote to ASCII under reduced color (goal marker, landing suffix, copy ack)", () => {
    expect(goalGlyph(false)).toBe(GOAL_GLYPH)
    expect(goalGlyph(true)).toBe("*")
    expect(landingSuffix(false)).toBe(LANDING_SUFFIX)
    expect(landingSuffix(true)).toBe(" · landed +")
    // the pill budget math subtracts the landing suffix in CELLS (stringWidth) on either surface — the arms must agree
    expect(landingSuffix(true).length).toBe(LANDING_SUFFIX.length)
    expect(stringWidth(landingSuffix(true))).toBe(stringWidth(LANDING_SUFFIX))
    expect(footerCopyLabel(true, true, true)).toBe("+ copied")
    expect(footerCopyLabel(true, true, false)).toBe("✓ copied")
    // both acknowledgment labels measure the same cells — the tier arithmetic is state-independent
    expect(footerButtonCells("+ copied")).toBe(footerButtonCells("✓ copied"))
  })

  test("under ASCII the pill and terminal acknowledgment paint *, never a broken glyph", () => {
    const achieved = loopedGoal({ status: "achieved", loopEnabled: false, loopHistory: undefined, loopMaxLoops: undefined, turns: 4, elapsedMs: 1000 * 60 * 12 })
    expect(terminalPill(achieved, 1000 * 60 * 12, true)?.text.startsWith("* goal achieved")).toBe(true)
    expect(terminalPill(achieved, 1000 * 60 * 12, false)?.text.startsWith(`${GOAL_GLYPH} goal achieved`)).toBe(true)
    const looped = loopedGoal({ status: "active" })
    expect(pillModel(looped, 1000 * 60 * 12, true).text.startsWith("* loop · v3/5")).toBe(true)
    expect(pillModel(looped, 1000 * 60 * 12, false).text.startsWith(`${GOAL_GLYPH} loop · v3/5`)).toBe(true)
  })

  test("the compact band prices in BOTH ClampedColumn paddings (width−6) — the audit's A1 frame-accounting fix", () => {
    expect(dialogFooterTier(96, false, false)).toEqual({ wide: false, roomy: false })
    expect(dialogFooterTier(96, false, true)).toEqual({ wide: false, roomy: false })
    // the copied label is narrower than "copy condition", so a copied button already fits at 94
    expect(dialogFooterTier(94, true, false).roomy).toBe(true)
    expect(dialogFooterTier(99, false, false).roomy).toBe(false)
    expect(dialogFooterTier(100, false, false).roomy).toBe(true)  // 41 + 53 == width−6
    expect(dialogFooterTier(101, false, true).roomy).toBe(false)  // unpin condition costs two more cells
    expect(dialogFooterTier(102, false, true).roomy).toBe(true)   // 41 + 55 == width−6
  })

  test("the full hint unlocks only when the whole row fits the budget (width−6)", () => {
    expect(dialogFooterTier(116, true, false).wide).toBe(false)
    expect(dialogFooterTier(117, true, false).wide).toBe(true)   // copied: 64 + 47 == width−6
    expect(dialogFooterTier(122, false, false).wide).toBe(false)
    expect(dialogFooterTier(123, false, false).wide).toBe(true)  // 64 + 53 == width−6
    expect(dialogFooterTier(124, false, true).wide).toBe(false)  // unpin condition costs two more cells
    expect(dialogFooterTier(125, false, true).wide).toBe(true)   // 64 + 55 == width−6
    expect(dialogFooterTier(140, false, false)).toEqual({ wide: true, roomy: true })
  })
})

describe("footerPinLabel", () => {
  test("the object noun survives the toggle at the roomy tier; compact tiers use the bare verbs", () => {
    expect(footerPinLabel(false, true)).toBe("pin condition")
    expect(footerPinLabel(true, true)).toBe("unpin condition")
    expect(footerPinLabel(false, false)).toBe("pin")
    expect(footerPinLabel(true, false)).toBe("unpin")
  })
})

describe("dialog footer hints", () => {
  test("no tier repeats the Esc chord — it stays in the host dialog chrome", () => {
    expect(DIALOG_FOOTER_FULL_HINT).not.toContain("esc")
    expect(DIALOG_FOOTER_SHORT_HINT).not.toContain("esc")
  })

  test("both hints document the two plugin chords; the full hint also documents paging", () => {
    for (const hint of [DIALOG_FOOTER_FULL_HINT, DIALOG_FOOTER_SHORT_HINT]) {
      expect(hint).toContain("p pin")
      expect(hint).toContain("c copy")
    }
    expect(DIALOG_FOOTER_FULL_HINT).toContain("pgup/pgdn")
    expect(DIALOG_FOOTER_SHORT_HINT).not.toContain("pgup")
  })
})

describe("hudCardRows viewport ceiling (maxRows) — optional rows drop until the core fits", () => {
  // hint-only goal: freshly armed, one spend estimate, no verdicts, no remediation (evaluatorHint yields to remediation)
  const hinted = () =>
    loopedGoal({ turns: 0, history: [], loopHistory: [], spend: { cost: 0.42, input: 120_000, output: 8_400, reasoning: 0, cacheRead: 30_000, cacheWrite: 0 } })
  // remediation-only goal: hot compaction (hint yields to remediation by rule), no spend, no verdicts
  const hot = () =>
    loopedGoal({ turns: 0, history: [], loopHistory: [], loopCompact: { requestedAt: now, iteration: 1, misses: 2 } })

  test("a one-line remediation costs one row, not the flat two it reserved before", () => {
    // 'goal failed — /goal clear to reset' is 34 cells — one row at the 49-cell remediation width
    const failed = loopedGoal({ status: "failed", history: undefined as unknown as GoalSnapshot["history"] })
    expect(hudCardRows(failed)).toBe(7)
  })

  test("a long failureLabel costs the rows it actually wraps to, not a flat two", () => {
    const failed = loopedGoal({ status: "failed", failureLabel: "x".repeat(100), history: undefined as unknown as GoalSnapshot["history"] })
    expect(hudCardRows(failed)).toBe(9) // 5 + why 1 + 3 wrapped remediation rows
  })

  test("under a ceiling the teaching hint drops first, then spend", () => {
    const goal = hinted()
    // full: 5 + spend 1 + hint 1 + why 1 = 8
    expect(hudCardRows(goal)).toBe(8)
    expect(hudCardRows(goal, false, 7)).toBe(7) // hint gone, spend and why kept
    expect(hudCardRows(goal, false, 6)).toBe(6) // hint and spend gone, why kept
    expect(hudCardRows(goal, false, 5)).toBe(5) // hint, spend and why gone
    expect(hudCardRows(goal, false, 4)).toBe(5)
  })

  test("under a ceiling the remediation drops only after hint, spend and last", () => {
    const goal = hot() // 5 + why 1 + remediation 2 = 8 (hot compaction wraps to two rows at 49 cells)
    expect(hudCardRows(goal)).toBe(8)
    expect(hudCardRows(goal, false, 6)).toBe(5) // why and remediation gone: hint/spend/context/last all unavailable
    expect(hudCardRows(goal, false, 4)).toBe(5) // remediation gone: the irreducible core remains
  })

  test("the last-verdict row drops after spend; the menu never drops", () => {
    const paused = loopedGoal({ status: "paused", pauseCause: "cap", spend: { cost: 1, input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 } })
    // 5 + spend 1 + why 1 + last 1 + remediation('turn cap…' 79 cells → 2 rows) = 10
    expect(hudCardRows(paused)).toBe(10)
    expect(hudCardRows(paused, false, 8)).toBe(8) // spend and why gone
    expect(hudCardRows(paused, false, 6)).toBe(5) // spend, why, last and remediation gone: the irreducible core
    expect(hudCardRows(paused, true, 3)).toBe(9) // menu rows never drop; remediation gone: 5 + menu 4
  })

  test("cardRowPlan and hudCardRows agree — the painted rows are the anchored rows", () => {
    expect(cardRowPlan(hinted())).toEqual({ rows: 8, hint: true, spend: true, context: false, why: true, last: false, remediation: false })
    expect(cardRowPlan(hinted(), false, 7)).toEqual({ rows: 7, hint: false, spend: true, context: false, why: true, last: false, remediation: false })
    expect(cardRowPlan(hinted(), false, 6)).toEqual({ rows: 6, hint: false, spend: false, context: false, why: true, last: false, remediation: false })
    expect(cardRowPlan(hinted(), false, 5)).toEqual({ rows: 5, hint: false, spend: false, context: false, why: false, last: false, remediation: false })
    expect(cardRowPlan(hot(), false, 6)).toEqual({ rows: 5, hint: false, spend: false, context: false, why: false, last: false, remediation: false })
    expect(cardRowPlan(hot())).toEqual({ rows: 8, hint: false, spend: false, context: false, why: true, last: false, remediation: true })
  })
})

describe("hudCardRows context meter row", () => {
  const metered = () =>
    loopedGoal({ turns: 0, history: [], loopHistory: [], spend: { cost: 0.42, input: 120_000, output: 8_400, reasoning: 0, cacheRead: 30_000, cacheWrite: 0 }, contextSize: 95_000, compactAtTokens: 150_000 })

  test("grows by exactly one row when the snapshot carries a context estimate", () => {
    // hinted() shape (5 + spend 1 + hint 1 + why 1 = 8) plus the context row = 9; without spend = 8
    expect(hudCardRows(metered())).toBe(9)
    const { spend: _s, ...noSpend } = metered()
    expect(hudCardRows(noSpend as GoalSnapshot)).toBe(8) // hint 1 + context 1 + why 1
    const { contextSize: _c, ...noContext } = metered()
    expect(hudCardRows(noContext as GoalSnapshot)).toBe(8) // unchanged from the pre-context plan
  })

  test("under a ceiling the context row drops after spend and before the last-verdict row", () => {
    const goal = metered()
    expect(hudCardRows(goal, false, 7)).toBe(7) // hint and spend gone; context and why kept
    expect(hudCardRows(goal, false, 6)).toBe(6) // hint, spend and context gone; why kept
    expect(hudCardRows(goal, false, 5)).toBe(5) // hint, spend, context and why gone: the irreducible core
    // a verdicts-bearing goal: why drops after context, before the last-verdict row
    const withLast = loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, spend: undefined })
    expect(hudCardRows(withLast)).toBe(8) // 5 + context 1 + why 1 + last 1
    expect(hudCardRows(withLast, false, 6)).toBe(6) // context and why gone, last kept
    expect(cardRowPlan(withLast, false, 6)).toEqual({ rows: 6, hint: false, spend: false, context: false, why: false, last: true, remediation: false })
  })
})

describe("hudCardRows why row", () => {
  test("grows by exactly one row when the snapshot carries an evaluator reason", () => {
    expect(hudCardRows(loopedGoal())).toBe(7) // 5 + why 1 + last 1
    const { reason: _r, ...noReason } = loopedGoal()
    expect(hudCardRows(noReason as GoalSnapshot)).toBe(6) // last kept
    expect(hudCardRows(loopedGoal({ reason: "   " }))).toBe(6) // whitespace-only reason paints no row
  })

  test("under a ceiling the why row drops after context and before the last-verdict row", () => {
    const goal = loopedGoal({ contextSize: 95_000, compactAtTokens: 150_000, spend: undefined })
    // full: 5 + context 1 + why 1 + last 1 = 8
    expect(hudCardRows(goal)).toBe(8)
    expect(hudCardRows(goal, false, 7)).toBe(7) // context gone, why and last kept
    expect(hudCardRows(goal, false, 6)).toBe(6) // why gone too, last kept
    expect(cardRowPlan(goal, false, 6)).toEqual({ rows: 6, hint: false, spend: false, context: false, why: false, last: true, remediation: false })
  })
})

describe("cardRowPlan under a ceiling (render)", () => {
  // fresh goal with one spend estimate: hint + spend both painted by default
  const hinted = () =>
    loopedGoal({ turns: 0, history: [], loopHistory: [], spend: { cost: 0.42, input: 120_000, output: 8_400, reasoning: 0, cacheRead: 30_000, cacheWrite: 0 } })

  test("under a ceiling the teaching hint gives way to the rows below it", async () => {
    const { frame } = await render(() => (
      <HudCard goal={hinted()} theme={theme} elapsedMs={() => 1000 * 60 * 3} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} maxRows={7} />
    ), 80, 12)
    expect(frame).not.toContain("the evaluator reads only the transcript") // teaching row dropped
    expect(frame).toContain("spend") // cost row still painted
    expect(frame).toContain("esc")
  })

  test("tightened further, the spend row also gives way — the actions row never does", async () => {
    const { frame } = await render(() => (
      <HudCard goal={hinted()} theme={theme} elapsedMs={() => 1000 * 60 * 3} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} maxRows={5} />
    ), 80, 12)
    expect(frame).not.toContain("the evaluator reads only the transcript")
    expect(frame).not.toContain("spend")
    expect(frame).toContain("clear goal")
    expect(frame).toContain("esc")
  })

  test("a brutal ceiling drops the remediation — the actions row and esc always survive", async () => {
    const hot = loopedGoal({ turns: 0, history: [], loopHistory: [], loopCompact: { requestedAt: now, iteration: 1, misses: 2 } })
    const { frame } = await render(() => (
      <HudCard goal={hot} theme={theme} elapsedMs={() => 1000 * 60 * 3} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} maxRows={5} />
    ), 80, 12)
    expect(frame).not.toContain("compact pending") // remediation (last rung) gave way
    expect(frame).toContain("esc") // the dismiss affordance never drops
  })

  test("a ceiling with one row to spare keeps the remediation", async () => {
    const hot = loopedGoal({ turns: 0, history: [], loopHistory: [], loopCompact: { requestedAt: now, iteration: 1, misses: 2 } })
    const { frame } = await render(() => (
      <HudCard goal={hot} theme={theme} elapsedMs={() => 1000 * 60 * 3} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} maxRows={7} />
    ), 80, 12)
    expect(frame).toContain("compact pending")
    expect(frame).toContain("esc")
  })

  test("under mono the last-verdict row paints the ASCII glyph, not Unicode", async () => {
    const { frame } = await render(() => (
      <HudCard goal={loopedGoal({ turns: 3 })} theme={theme} elapsedMs={() => 1000 * 60 * 3} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} mono />
    ), 80, 12)
    expect(frame).toContain("+")
    expect(frame).not.toContain("✓")
    expect(frame).toContain("met · this turn")
  })

  test("without a ceiling every row paints — nothing regresses", async () => {
    const { frame } = await render(() => (
      <HudCard goal={hinted()} theme={theme} elapsedMs={() => 1000 * 60 * 3} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ), 80, 14)
    expect(frame).toContain("the evaluator reads only the transcript")
    expect(frame).toContain("spend")
  })
})

describe("hudCardRows with the context menu", () => {
  test("the menu adds exactly four rows to the absolute-mount anchor; the default stays unchanged", () => {
    const base = hudCardRows(loopedGoal())
    expect(hudCardRows(loopedGoal(), true)).toBe(base + 4)
    expect(hudCardRows(loopedGoal(), false)).toBe(base)
    expect(hudCardRows(loopedGoal())).toBe(base)
  })
})

describe("footerCopyLabel", () => {
  test("a fresh copy button reads copy condition with cells to spare and copy below 96", () => {
    expect(footerCopyLabel(false, true)).toBe("copy condition")
    expect(footerCopyLabel(false, false)).toBe("copy")
  })

  test("after a copy the button acknowledges with ✓ copied at either width", () => {
    expect(footerCopyLabel(true, true)).toBe("✓ copied")
    expect(footerCopyLabel(true, false)).toBe("✓ copied")
  })
})

describe("HudCard", () => {
  test("armed state renders condition, now row, last verdict and both actions", async () => {
    const { frame, setup } = await render(() => (
      <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ))
    expect(frame).toContain("condition")
    expect(frame).toContain("make every loop iter")
    expect(frame).toContain("now")
    expect(frame).toContain("active")
    expect(frame).toContain("v3/5")
    expect(frame).toContain("last")
    expect(frame).toContain("met")
    expect(frame).toContain("[details]")
    expect(frame).toContain("[clear goal]")
    expect(frame).toContain("[esc]")
    expect(frame).not.toContain("fix")
    await setup.renderer.destroy()
  })

  test("stuck-retrying state renders the stuck word and the retry remediation", async () => {
    const goal = loopedGoal({ retries: 4 })
    const { frame, setup } = await render(() => (
      <HudCard goal={goal} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ))
    expect(frame).toContain("stuck")
    expect(frame).toContain("4 failed turns in a row")
    expect(frame).not.toContain("active")
    await setup.renderer.destroy()
  })

  test("hot state renders the exact remediation, never a vague warning", async () => {
    const goal = loopedGoal({ loopCompact: { requestedAt: now - 1000 * 60 * 3, estimatedTokens: 182_000, iteration: 3, misses: 2 } })
    const { frame, setup } = await render(() => (
      <HudCard goal={goal} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ))
    expect(frame).toContain("fix")
    expect(frame).toContain("2/4")
    expect(frame).toContain("evaluator.verifyCommand")
    await setup.renderer.destroy()
  })

  test("a snapshot with spend renders the spend row with tokens and cost", async () => {
    const goal = loopedGoal({ spend: { cost: 0.42, input: 120_000, output: 8_400, reasoning: 0, cacheRead: 30_000, cacheWrite: 0 } })
    const { frame, setup } = await render(() => (
      <HudCard goal={goal} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ))
    expect(frame).toContain("spend")
    expect(frame).toContain("in ·")
    expect(frame).toContain("out")
    expect(frame).toContain("$0.42")
    await setup.renderer.destroy()
  })

  test("a snapshot without spend renders no spend row — the row is a promise, not a placeholder", async () => {
    const { frame, setup } = await render(() => (
      <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ))
    expect(frame).not.toContain("spend")
    await setup.renderer.destroy()
  })

  test("failed state renders the reset remediation", async () => {
    const goal = loopedGoal({ status: "failed", reason: "provider exploded" })
    const { frame, setup } = await render(() => (
      <HudCard goal={goal} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ))
    expect(frame).toContain("fix")
    expect(frame).toContain("/goal clear")
    expect(frame).toContain("failed")
    expect(frame).not.toContain("active")
    await setup.renderer.destroy()
  })

  test("achieved terminal goal renders a truthful now row, never a live-looking one", async () => {
    const goal = loopedGoal({ status: "achieved", turns: 9, reason: "all checks pass" })
    const { frame, setup } = await render(() => (
      <HudCard goal={goal} theme={theme} elapsedMs={() => 1000 * 60 * 38} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ))
    expect(frame).toContain("achieved")
    expect(frame).not.toContain("active")
    await setup.renderer.destroy()
  })

  test("clicking the condition row copies the full condition", async () => {
    let copied: string | undefined
    const goal = loopedGoal()
    const { frame, setup } = await render(() => (
      <HudCard goal={goal} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={(c) => { copied = c }} />
    ))
    const at = find(frame, "make every loop")
    expect(at).toBeDefined()
    await setup.mockMouse.click(at!.x + 2, at!.y)
    await setup.renderOnce()
    expect(copied).toBe(goal.condition)
    await setup.renderer.destroy()
  })

  test("clicking [details], [clear goal] and [esc] fires the wired callbacks", async () => {
    const fired: string[] = []
    const { frame, setup } = await render(() => (
      <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => fired.push("close")} onDetails={() => fired.push("details")} onClear={() => fired.push("clear")} onCopyCondition={() => {}} />
    ))
    const details = find(frame, "[details]")
    const clear = find(frame, "[clear goal]")
    const esc = find(frame, "[esc]")
    expect(details && clear && esc).toBeDefined()
    await setup.mockMouse.click(details!.x + 2, details!.y)
    await setup.mockMouse.click(clear!.x + 2, clear!.y)
    await setup.mockMouse.click(esc!.x + 2, esc!.y)
    await setup.renderOnce()
    expect(fired).toEqual(["details", "clear", "close"])
    await setup.renderer.destroy()
  })

  test("unpinned card renders [pin]; clicking it fires onTogglePin", async () => {
    const fired: string[] = []
    const { frame, setup } = await render(() => (
      <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} pinned={false} onTogglePin={() => fired.push("pin")} />
    ))
    expect(frame).toContain("[pin]")
    expect(frame).not.toContain("[unpin]")
    const pin = find(frame, "[pin]")
    expect(pin).toBeDefined()
    await setup.mockMouse.click(pin!.x + 1, pin!.y)
    await setup.renderOnce()
    expect(fired).toEqual(["pin"])
    await setup.renderer.destroy()
  })

  test("pinned card renders [unpin]; clicking it fires onTogglePin", async () => {
    const fired: string[] = []
    const { frame, setup } = await render(() => (
      <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} pinned={true} onTogglePin={() => fired.push("unpin")} />
    ))
    expect(frame).toContain("[unpin]")
    const unpin = find(frame, "[unpin]")
    expect(unpin).toBeDefined()
    await setup.mockMouse.click(unpin!.x + 2, unpin!.y)
    await setup.renderOnce()
    expect(fired).toEqual(["unpin"])
    await setup.renderer.destroy()
  })

  test("without onTogglePin the card renders no pin button (back-compat)", async () => {
    const { frame, setup } = await render(() => (
      <HudCard goal={loopedGoal()} theme={theme} elapsedMs={() => 1000 * 60 * 12} onClose={() => {}} onDetails={() => {}} onClear={() => {}} onCopyCondition={() => {}} />
    ))
    expect(frame).not.toContain("[pin]")
    expect(frame).not.toContain("[unpin]")
    await setup.renderer.destroy()
  })
})

describe("zero-tool iterations in the ledger", () => {
  const historyTheme: HistoryTheme = theme

  test("a zero-tool met iteration renders the already-satisfied-at-HEAD row", async () => {
    const goal = loopedGoal({
      loopHistory: [{ version: 1, condition: "c", summary: " looked around ", reason: "met", turns: 2, toolCalls: 0, endedAt: now - 1000 * 60 * 5 }],
      loopIteration: 2,
    })
    const setup = await testRender(() => <LoopSection goal={goal} theme={historyTheme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />, { width: 112, height: 24 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("no tools · already satisfied at HEAD")
    expect(frame).toContain("○")
    expect(frame).not.toContain("inspection only")
    await setup.renderer.destroy()
  })

  test("a work-produced iteration keeps the check glyph and no inspection tag", async () => {
    const goal = loopedGoal()
    const setup = await testRender(() => <LoopSection goal={goal} theme={historyTheme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />, { width: 112, height: 24 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("✓")
    expect(frame).not.toContain("inspection only")
    expect(frame).not.toContain("already satisfied at HEAD")
    await setup.renderer.destroy()
  })

  test("mono drops the hue but keeps the hollow glyph and the satisfied-at-HEAD tag", async () => {
    const goal = loopedGoal({
      loopHistory: [{ version: 1, condition: "c", summary: " already done ", reason: "met", turns: 2, toolCalls: 0, endedAt: now - 1000 * 60 * 5 }],
      loopIteration: 2,
    })
    const setup = await testRender(() => <LoopSection goal={goal} theme={historyTheme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} mono />, { width: 112, height: 24 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("no tools · already satisfied at HEAD")
    expect(frame).toContain(".")   // ASCII ink-density glyph in the mono arm
    expect(frame).not.toContain("○")
    await setup.renderer.destroy()
  })
})

describe("pillCaret", () => {
  test("the glyph is ▾ while the card is painted, ▸ while it is not", () => {
    expect(pillCaret(true)).toBe("▾")
    expect(pillCaret(false)).toBe("▸")
  })

  test("ASCII demotes to v and > under NO_COLOR / TERM=dumb", () => {
    expect(pillCaret(true, true)).toBe("v")
    expect(pillCaret(false, true)).toBe(">")
  })
})

describe("hudArmEnabled", () => {
  test("the card arms only with a live goal and no dialog owning the screen", () => {
    expect(hudArmEnabled(true, false)).toBe(true)
    expect(hudArmEnabled(false, false)).toBe(false)
    expect(hudArmEnabled(true, true)).toBe(false)
    expect(hudArmEnabled(false, true)).toBe(false)
  })
})

describe("per-iteration spend attribution in the rail", () => {
  const historyTheme: HistoryTheme = theme

  test("a completed iteration paints its arm-to-advance cost in the row", async () => {
    const goal = loopedGoal({
      loopHistory: [{ version: 1, condition: "c", summary: "s", reason: "met", turns: 3, toolCalls: 7, endedAt: now - 1000 * 60 * 5, spend: { cost: 0.42, input: 1200, output: 300, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }],
      loopIteration: 2,
    })
    const setup = await testRender(() => <LoopSection goal={goal} theme={historyTheme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />, { width: 112, height: 24 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("$0.42")
    await setup.renderer.destroy()
  })

  test("an iteration without spend paints no cost tag", async () => {
    const goal = loopedGoal()
    const setup = await testRender(() => <LoopSection goal={goal} theme={historyTheme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />, { width: 112, height: 24 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("$")
    await setup.renderer.destroy()
  })
})
