/**
 * Pins the live activity-icon contract: the nine nerd codepoints from the design snippet, the ASCII arm
 * that stands in under reduced color, the tool-name → intent fold, and the one-cell swap into the pill
 * that keeps the HUD's width budget intact. Pure/headless: no host, no RPC, no timer dependency.
 */
import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { AGENT_ICONS, INTENT_TTL_MS, NO_ACTIVITY, NOTICE_SIGNALS, activityBadgeCells, activityWord, applyIntentSignal, fadeNotice, intentAccent, intentForActivity, intentGlyph, resolveToolIntent, withIntentGlyph, type AgentIntent, type ActivityMap, type IntentSignal } from "../src/tui.tsx"
import { pillModel, waitingOnSubagents } from "../src/core/hud.ts"
import type { GoalSnapshot } from "../src/core/types.ts"

const INTENTS: readonly AgentIntent[] = ["thinking", "reading", "writing", "executing", "web", "memory", "waiting", "done", "error", "delegating"]

const goal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  version: 1,
  id: "goal_icons",
  sessionID: "ses_icons",
  directory: "/tmp/icons",
  condition: "paint live intent icons",
  status: "active",
  setAt: 0,
  startedAt: 0,
  turns: 2,
  stall: 0,
  retries: 0,
  checkins: 0,
  baseline: { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  history: [],
  loopEnabled: false,
  elapsedMs: 60_000,
  evaluating: false,
  waiting: false,
  ...overrides,
})

describe("AGENT_ICONS", () => {
  test("the nine design glyphs plus the delegation glyph are exact one-cell codepoints", () => {
    const codepoints: Record<AgentIntent, string> = {
      thinking: "f06a9",
      reading: "f021e",
      writing: "f03eb",
      executing: "f489",
      web: "f059f",
      memory: "f02da",
      waiting: "f03e4",
      done: "f012c",
      error: "f0156",
      delegating: "f0c0",
    }
    for (const intent of INTENTS) {
      const glyph = AGENT_ICONS[intent].nerd
      expect([...glyph].length).toBe(1)
      expect(glyph.codePointAt(0)!.toString(16)).toBe(codepoints[intent])
    }
  })

  test("every nerd glyph is one terminal cell and every ascii glyph is one printable ASCII char", () => {
    for (const intent of INTENTS) {
      expect(stringWidth(AGENT_ICONS[intent].nerd)).toBe(1)
      expect(stringWidth(intentGlyph(intent))).toBe(1)
      expect(AGENT_ICONS[intent].ascii).toMatch(/^[\x21-\x7e]$/)
    }
  })

  test("the ascii arm demotes done/error to the HUD's + / x spelling, not ✓ / ✗", () => {
    expect(AGENT_ICONS.done.ascii).toBe("+")
    expect(AGENT_ICONS.error.ascii).toBe("x")
    expect(AGENT_ICONS.thinking.ascii).toBe("*") // same face as the breath's ascii arm
  })

  test("every intent carries a label that paints as its budgeted activity word", () => {
    for (const intent of INTENTS) {
      expect(AGENT_ICONS[intent].label.length).toBeGreaterThan(0)
      // The word is the lowercased label so the glyph and the word can never drift, and the badge
      // reserves exactly that word plus its two padding spaces from the pill's cell budget.
      expect(activityWord(intent)).toBe(AGENT_ICONS[intent].label.toLowerCase())
      expect(activityBadgeCells(intent)).toBe(stringWidth(` ${activityWord(intent)} `))
    }
    // Background delegation must read as a word, never as a silent thinking face.
    expect(activityWord(resolveToolIntent("task"))).toBe("delegating")
    expect(activityWord(resolveToolIntent("subagent"))).toBe("delegating")
  })
})

describe("resolveToolIntent", () => {
  test("each tool family folds to its intent", () => {
    const cases: ReadonlyArray<readonly [string, AgentIntent]> = [
      ["read", "reading"], ["grep", "reading"], ["glob", "reading"], ["ls", "reading"],
      ["write", "writing"], ["edit", "writing"], ["patch", "writing"], ["create", "writing"],
      ["bash", "executing"], ["exec", "executing"], ["shell", "executing"], ["test", "executing"],
      ["webfetch", "web"], ["websearch", "web"], ["fetch", "web"], ["curl", "web"],
      ["memory", "memory"], ["compact", "memory"], ["history", "memory"], ["rag", "memory"],
      ["task", "delegating"], ["subagent", "delegating"], ["delegate", "delegating"],
      ["spawn", "delegating"], ["agent", "delegating"],
    ]
    for (const [tool, intent] of cases) expect(resolveToolIntent(tool)).toBe(intent)
  })

  test("unknown and malformed names think rather than throwing or painting a wrong icon", () => {
    for (const tool of ["todo", "unknown", "", "   "]) expect(resolveToolIntent(tool)).toBe("thinking")
    expect(resolveToolIntent(undefined as unknown as string)).toBe("thinking")
  })

  test("tool names are folded case-insensitively", () => {
    expect(resolveToolIntent("WebFetch")).toBe("web")
    expect(resolveToolIntent("BASH")).toBe("executing")
  })

  test("first matching family wins", () => {
    // "websearch" matches both the web and search regexes of the same family; no cross-family tool wins twice.
    expect(resolveToolIntent("websearch")).toBe("web")
    expect(resolveToolIntent("memory-read")).toBe("reading")
  })
})

describe("withIntentGlyph", () => {
  test("swaps only the leading cell of a real pill line and leaves the rest byte-identical", () => {
    const text = pillModel(goal(), 60_000, false, 80, 2)!.text
    const swapped = withIntentGlyph(text, "writing")
    expect(swapped.glyph).toBe(AGENT_ICONS.writing.nerd)
    expect(swapped.rest).toBe(text.slice(1))
    expect(stringWidth(swapped.glyph + swapped.rest)).toBe(stringWidth(text))
  })

  test("the ascii swap keeps the same width", () => {
    const text = pillModel(goal(), 60_000, true, 80)!.text
    const swapped = withIntentGlyph(text, "executing", true)
    expect(swapped.glyph).toBe("$")
    expect(stringWidth(swapped.glyph + swapped.rest)).toBe(stringWidth(text))
  })

  test("an unknown intent falls back to the thinking cell instead of an empty glyph", () => {
    expect(intentGlyph("bogus" as AgentIntent)).toBe(AGENT_ICONS.thinking.nerd)
  })
})

describe("intentAccent", () => {
  test("maps every intent onto an available theme-token key", () => {
    expect(intentAccent("reading")).toBe("info")
    expect(intentAccent("web")).toBe("info")
    expect(intentAccent("writing")).toBe("warning")
    expect(intentAccent("executing")).toBe("warning")
    expect(intentAccent("waiting")).toBe("warning")
    expect(intentAccent("delegating")).toBe("info")
    expect(intentAccent("done")).toBe("success")
    expect(intentAccent("error")).toBe("error")
    expect(intentAccent("thinking")).toBe("muted")
    expect(intentAccent("memory")).toBe("muted")
  })

  test("the expiry window is short enough to feel live but long enough to read the icon", () => {
    expect(INTENT_TTL_MS).toBeGreaterThan(0)
    expect(INTENT_TTL_MS).toBeLessThanOrEqual(10_000)
  })
})

describe("live tool-use lifecycle", () => {
  const SID = "ses_live"
  const fold = (signals: readonly IntentSignal[]): ActivityMap =>
    signals.reduce<ActivityMap>((state, signal) => applyIntentSignal(state, signal), {})
  const input = (callID: string, name: string): IntentSignal => ({ type: "tool-input", sessionID: SID, callID, name })

  test("a tool's name sets the icon when its input starts, not on a timer", () => {
    const state = fold([input("c1", "read"), input("c2", "bash")])
    expect(intentForActivity(state[SID])).toBe("executing") // newest call wins
    expect(state[SID]?.calls).toEqual({ c1: "reading", c2: "executing" })
  })

  test("a progress beat keeps a long-running tool visible and marks an unknown in-flight call as executing", () => {
    const started = fold([input("c1", "read")])
    expect(applyIntentSignal(started, { type: "tool-progress", sessionID: SID, callID: "c1" })).toBe(started)
    // Mounted mid-call: no name was ever seen, but progress is still live activity.
    const resumed = fold([{ type: "tool-progress", sessionID: SID, callID: "c9" }])
    expect(intentForActivity(resumed[SID])).toBe("executing")
  })

  test("a finished tool falls back to the next still-running tool, then to the breath", () => {
    const two = fold([input("c1", "read"), input("c2", "bash")])
    const afterBash = applyIntentSignal(two, { type: "tool-success", sessionID: SID, callID: "c2" })
    expect(intentForActivity(afterBash[SID])).toBe("reading")
    const afterRead = applyIntentSignal(afterBash, { type: "tool-success", sessionID: SID, callID: "c1" })
    expect(intentForActivity(afterRead[SID])).toBeUndefined()
  })

  test("failure flips to the error face and removes the failed call", () => {
    const failed = fold([input("c1", "bash"), { type: "tool-failed", sessionID: SID, callID: "c1" }])
    expect(intentForActivity(failed[SID])).toBe("error")
    expect(failed[SID]?.calls).toEqual({})
  })

  test("a permission prompt shows approval until the human replies", () => {
    const asked = fold([input("c1", "read"), { type: "permission-asked", sessionID: SID }])
    expect(intentForActivity(asked[SID])).toBe("waiting")
    const replied = applyIntentSignal(asked, { type: "permission-replied", sessionID: SID })
    expect(intentForActivity(replied[SID])).toBe("reading")
  })

  test("execution boundaries clear stale tools and report the turn's outcome", () => {
    const started = fold([input("c1", "read"), { type: "execution-started", sessionID: SID }])
    expect(started[SID]).toEqual({ calls: {}, notice: "thinking" })
    expect(intentForActivity(applyIntentSignal(started, { type: "execution-succeeded", sessionID: SID })[SID])).toBe("done")
    expect(intentForActivity(applyIntentSignal(started, { type: "execution-failed", sessionID: SID })[SID])).toBe("error")
    expect(intentForActivity(applyIntentSignal(started, { type: "execution-interrupted", sessionID: SID })[SID])).toBeUndefined()
  })

  test("sessions stay isolated — another session's tool never steals this pill's icon", () => {
    const state = applyIntentSignal({ [SID]: NO_ACTIVITY }, { type: "tool-input", sessionID: "ses_other", callID: "c1", name: "bash" })
    expect(intentForActivity(state[SID])).toBeUndefined()
    expect(intentForActivity(state["ses_other"])).toBe("executing")
  })

  test("irrelevant completion signals do not mutate the map", () => {
    const state = fold([input("c1", "read")])
    const staleSuccess = applyIntentSignal(state, { type: "tool-success", sessionID: SID, callID: "never-started" })
    expect(staleSuccess).toBe(state)
  })
})

describe("tool-result-timed icons", () => {
  const SID = "ses_preparing"
  const fold = (signals: readonly IntentSignal[]): ActivityMap =>
    signals.reduce<ActivityMap>((state, signal) => applyIntentSignal(state, signal), {})

  test("only notices arm the fade timer — an in-flight tool has no local expiry", () => {
    for (const type of ["permission-asked", "execution-started", "execution-succeeded", "execution-failed", "tool-failed"]) {
      expect(NOTICE_SIGNALS.has(type as IntentSignal["type"])).toBe(true)
    }
    for (const type of ["tool-input", "tool-progress", "tool-success", "permission-replied", "execution-interrupted"]) {
      expect(NOTICE_SIGNALS.has(type as IntentSignal["type"])).toBe(false)
    }
  })

  test("a delegated task keeps its icon across expiry beats while the child prepares", () => {
    let activity = fold([
      { type: "execution-started", sessionID: SID },
      { type: "tool-input", sessionID: SID, callID: "task-1", name: "task" },
    ])
    expect(intentForActivity(activity[SID])).toBe("delegating")
    // Every TTL beat is a no-op: no tool result has been emitted yet, so the pill must not fall back
    // to the goal-active breath. This is the screenshot case — a still-preparing delegated child.
    for (let beat = 0; beat < 100; beat++) {
      const faded = fadeNotice(activity, SID)
      expect(faded).toBe(activity)
      expect(intentForActivity(faded[SID])).toBe("delegating")
    }
    // The host's tool result is what retires the icon, not the clock.
    activity = applyIntentSignal(activity, { type: "tool-success", sessionID: SID, callID: "task-1" })
    expect(intentForActivity(activity[SID])).toBeUndefined()
  })

  test("an expiry beat fades a notice but leaves other tools visible", () => {
    const withNotice = fold([
      { type: "tool-input", sessionID: SID, callID: "c1", name: "read" },
      { type: "tool-input", sessionID: SID, callID: "c2", name: "write" },
      { type: "tool-failed", sessionID: SID, callID: "c1" },
    ])
    expect(intentForActivity(withNotice[SID])).toBe("error") // notice outranks the running tool
    const faded = fadeNotice(withNotice, SID)
    expect(faded[SID]?.notice).toBeUndefined()
    expect(faded[SID]?.calls).toEqual({ c2: "writing" })
    expect(intentForActivity(faded[SID])).toBe("writing")
    expect(fadeNotice(faded, SID)).toBe(faded) // idempotent
  })

  test("no session or no notice means the expiry beat does not allocate a map", () => {
    const calls = fold([{ type: "tool-input", sessionID: SID, callID: "c1", name: "bash" }])
    expect(fadeNotice(calls, SID)).toBe(calls)
    expect(fadeNotice(calls, "ses_other")).toBe(calls)
  })

  test("a preparing delegation swaps the rotating goal-active ring for the delegating glyph", () => {
    const preparing = goal({ sessionID: SID })
    // Phase 2 is the breath crest (◎): the face the screenshot caught rotating on an active goal.
    const text = pillModel(preparing, 60_000, false, 80, 2)!.text
    expect(text.slice(0, 1)).toBe("\u25CE")
    expect(text).toContain("goal active")
    const activity = fold([{ type: "tool-input", sessionID: SID, callID: "task-1", name: "task" }])
    const swapped = withIntentGlyph(text, intentForActivity(activity[SID])!)
    expect(swapped.glyph).toBe(AGENT_ICONS.delegating.nerd)
    expect(swapped.rest).toContain("goal active") // the state word is untouched
    expect(stringWidth(swapped.glyph + swapped.rest)).toBe(stringWidth(text))
  })
})

describe("waiting-for-subagent pill", () => {
  const waiting = (count?: number): GoalSnapshot => goal({ waiting: true, waitingSubagents: count })

  test("one delegated child names what the parent waits on instead of a bare 'waiting'", () => {
    const text = pillModel(waiting(1), 240_000, false, 80)!.text
    expect(text).toContain("goal waiting for subagent")
    expect(text).not.toContain("waiting ·")
  })

  test("more than one child shows the count so the pill agrees with the host tally", () => {
    const text = pillModel(waiting(4), 240_000, false, 80)!.text
    expect(text).toContain("goal waiting for 4 subagents")
    expect(text).not.toContain("waiting for subagent ·")
  })

  test("shell-only and restored legacy waits keep the honest 'waiting' word", () => {
    expect(pillModel(waiting(0), 240_000, false, 80)!.text).toContain("goal waiting ·")
    expect(pillModel(waiting(), 240_000, false, 80)!.text).toContain("goal waiting ·")
  })

  test("the delegating icon swaps the ring without changing the state word or the line width", () => {
    const text = pillModel(waiting(2), 240_000, false, 80)!.text
    const swapped = withIntentGlyph(text, "delegating")
    expect(swapped.glyph).toBe(AGENT_ICONS.delegating.nerd)
    expect(swapped.rest).toContain("goal waiting for 2 subagents")
    expect(stringWidth(swapped.glyph + swapped.rest)).toBe(stringWidth(text))
  })

  test("the icon predicate fires only for a live wait with a known subagent", () => {
    expect(waitingOnSubagents(waiting(1))).toBe(true)
    expect(waitingOnSubagents(waiting(4))).toBe(true)
    expect(waitingOnSubagents(waiting(0))).toBe(false)
    expect(waitingOnSubagents(waiting())).toBe(false)
    expect(waitingOnSubagents(goal({ waitingSubagents: 1 }))).toBe(false) // not waiting
    expect(waitingOnSubagents(goal({ status: "paused", waiting: true, waitingSubagents: 1 }))).toBe(false)
    expect(waitingOnSubagents(goal({ evaluating: true, waitingSubagents: 1 }))).toBe(false)
  })
})
