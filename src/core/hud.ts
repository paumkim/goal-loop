/**
 * Pure model helpers for the goal HUD: the ambient pill (level a), the compact card (level b)
 * and the failure-first-class remediation rows shared by the card and the `/goal` dialog.
 * No I/O, no JSX; everything here is unit-tested headlessly. Presentation lives in
 * `src/hud-card.tsx` (card), `src/tui-history.tsx` (dialog sections) and `src/tui.tsx` (wiring).
 */
import { COMPACT_MISS_CAP, type GoalSnapshot } from "./types.ts"
import { formatDurationCoarse, GOAL_GLYPH } from "./format.ts"
import { renderPips, verdictStreak } from "./history.ts"

/** Tone drives the pill/card accent color. `hot` means a compaction request keeps missing — amber, the "running hot" state. */
export type HudTone = "armed" | "evaluating" | "waiting" | "paused" | "hot"

export interface PillModel {
  readonly text: string
  readonly tone: HudTone
}

/** A pending boundary compaction that keeps missing is "hot" once misses reach half the cap (2 of 4). */
export const isCompactHot = (goal: GoalSnapshot): boolean => {
  const pending = goal.loopCompact
  return Boolean(pending && pending.landedAt === undefined && pending.misses >= 2)
}

const stateWord = (goal: GoalSnapshot): string =>
  goal.status === "paused" ? "paused" : goal.evaluating ? "checking" : goal.waiting ? "waiting" : "active"

/** The 1-row ambient pill label plus its tone. Mirrors the composer-top indicator; extracted so it can be unit-tested. */
export const pillModel = (goal: GoalSnapshot, elapsed: number): PillModel => {
  const state = stateWord(goal)
  const turns = goal.turns > 0 ? ` · ${goal.turns} turn${goal.turns === 1 ? "" : "s"}` : ""
  const tone: HudTone =
    goal.status === "paused" ? "paused" : isCompactHot(goal) ? "hot" : goal.evaluating ? "evaluating" : goal.waiting ? "waiting" : "armed"
  if (goal.loopEnabled) {
    const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : ""
    const pips = renderPips(goal.loopHistory?.length ?? 0, goal.loopMaxLoops)
    const pending = goal.loopCompact && !goal.loopCompact.landedAt ? goal.loopCompact : undefined
    const compacting = pending ? ` · compact pending${pending.misses > 0 ? ` (${pending.misses}/${COMPACT_MISS_CAP})` : ""}` : ""
    return { text: `${GOAL_GLYPH} loop · v${goal.loopIteration ?? 1}${cap}${pips ? ` ${pips}` : ""} · ${state} · ${formatDurationCoarse(elapsed)}${turns}${compacting}`, tone }
  }
  return { text: `${GOAL_GLYPH} goal ${state} · ${formatDurationCoarse(elapsed)}${turns}`, tone }
}

export interface Remediation {
  /** `warning` renders amber, `error` renders the faint/red family the theme exposes for failures. */
  readonly tone: "warning" | "error"
  readonly text: string
}

/**
 * Failure is a first-class screen: when the loop is hot or a verdict keeps coming back failed,
 * say exactly what to do — never a vague warning. Returns undefined when everything is nominal.
 * Order matters: an unrecoverable failure outranks a hot compaction request, which outranks a verdict streak.
 */
// Remediation strings stay short: the HUD card wraps them at ~49 columns (two rows are budgeted in
// hudCardRows), the dialog has more room but shows the same line. One exact action, no hedging.
export const remediationFor = (goal: GoalSnapshot): Remediation | undefined => {
  if (goal.status === "failed") {
    return { tone: "error", text: `goal failed — /goal clear to reset` }
  }
  const pending = goal.loopCompact && goal.loopCompact.landedAt === undefined ? goal.loopCompact : undefined
  if (pending && pending.misses >= 2) {
    return {
      tone: "warning",
      text: `compact pending ${pending.misses}/${COMPACT_MISS_CAP} · send a message for a safe point · else set evaluator.verifyCommand`,
    }
  }
  const streak = verdictStreak(goal.history ?? [])
  if (streak.verdict === "not_met" && streak.count >= 3) {
    return {
      tone: "warning",
      text: `${streak.count}× not_met in a row · consider evaluator.verifyCommand`,
    }
  }
  return undefined
}
