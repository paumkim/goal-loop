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
import { HudCard, hudCardRows, pinBudget, type HudCardTheme } from "../src/hud-card.tsx"
import { isCompactHot, pillModel, remediationFor, pinSuffix, motionDisabled, terminalPill, TERMINAL_ACK_MS } from "../src/core/hud.ts"
import { GOAL_GLYPH } from "../src/core/format.ts"
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
    expect(fix?.text).toContain("3× not_met in a row")
    expect(fix?.text).toContain("evaluator.verifyCommand")
  })

  test("nominal goal renders no remediation", () => {
    expect(remediationFor(loopedGoal())).toBeUndefined()
  })

  test("an unrecoverable failure outranks a hot compaction", () => {
    const fix = remediationFor(loopedGoal({ status: "failed", loopCompact: { requestedAt: now, iteration: 3, misses: 3 } }))
    expect(fix?.tone).toBe("error")
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
    expect(pinBudget(80, 40)).toBe(80 - 40 - " · pin: ".length - 1)
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

describe("hudCardRows", () => {
  test("grows by one row for the last-verdict line and one for the remediation", () => {
    expect(hudCardRows(loopedGoal())).toBe(6)
    expect(hudCardRows(loopedGoal({ loopCompact: { requestedAt: now, iteration: 3, misses: 2 } }))).toBe(8)
    const { history: _h, ...noHistory } = loopedGoal()
    expect(hudCardRows(noHistory as GoalSnapshot)).toBe(5)
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

  test("a zero-tool iteration renders the muted inspection-only row", async () => {
    const goal = loopedGoal({
      loopHistory: [{ version: 1, condition: "c", summary: " looked around ", reason: "met", turns: 2, toolCalls: 0, endedAt: now - 1000 * 60 * 5 }],
      loopIteration: 2,
    })
    const setup = await testRender(() => <LoopSection goal={goal} theme={historyTheme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />, { width: 112, height: 24 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("no tools · inspection only")
    expect(frame).toContain("○")
    await setup.renderer.destroy()
  })

  test("a work-produced iteration keeps the check glyph and no inspection tag", async () => {
    const goal = loopedGoal()
    const setup = await testRender(() => <LoopSection goal={goal} theme={historyTheme} elapsedMs={() => 1000 * 60 * 2} nowMs={() => now} />, { width: 112, height: 24 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("✓")
    expect(frame).not.toContain("inspection only")
    await setup.renderer.destroy()
  })
})
