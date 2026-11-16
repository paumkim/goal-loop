/**
 * Pure model helpers for the goal HUD: the ambient pill (level a), the compact card (level b)
 * and the failure-first-class remediation rows shared by the card and the `/goal` dialog.
 * No I/O, no JSX; everything here is unit-tested headlessly. Presentation lives in
 * `src/hud-card.tsx` (card), `src/tui-history.tsx` (dialog sections) and `src/tui.tsx` (wiring).
 */
import { COMPACT_MISS_CAP, type GoalSnapshot } from "./types.ts"
import { formatDurationCoarse, GOAL_GLYPH, truncate } from "./format.ts"
import { renderPips, verdictStreak } from "./history.ts"

/**
 * Automatic retries since the last successful turn before the pill calls out the distress. One or two are
 * transient (provider hiccups, rate-limit windows); at this count the goal is almost certainly stuck — nothing
 * has executed — and the surface says so, the same way two compaction misses say so.
 */
export const RETRY_HOT_THRESHOLD = 3

/** Tone drives the pill/card accent color. `hot` means a compaction request keeps missing — amber, the "running hot" state. `retrying` means every turn keeps failing — amber, the "nothing is executing" state. `achieved`/`impossible`/`failed` are terminal acknowledgment tones (see `terminalPill`). */
export type HudTone = "armed" | "evaluating" | "waiting" | "paused" | "hot" | "retrying" | "achieved" | "impossible" | "failed"

/** Every turn keeps failing at the retry threshold or beyond: the goal is stuck, not merely slow. */
export const isRetryStuck = (goal: GoalSnapshot): boolean => goal.retries >= RETRY_HOT_THRESHOLD

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
  goal.status === "paused"
    ? "paused"
    : goal.evaluating
      ? "checking"
      : goal.waiting
        ? "waiting"
        : isRetryStuck(goal)
          ? "stuck"
          : "active"

/** The 1-row ambient pill label plus its tone. Mirrors the composer-top indicator; extracted so it can be unit-tested. */
export const pillModel = (goal: GoalSnapshot, elapsed: number): PillModel => {
  const state = stateWord(goal)
  const turns = goal.turns > 0 ? ` · ${goal.turns} turn${goal.turns === 1 ? "" : "s"}` : ""
  const retrying = isRetryStuck(goal) ? ` · retry ${goal.retries}` : ""
  // Paused outranks the retry counter (a pause IS the rate-limit story); a stuck-retrying goal outranks a hot compaction — nothing executes at all, so the compaction is not the urgent part.
  const tone: HudTone =
    goal.status === "paused"
      ? "paused"
      : isRetryStuck(goal)
        ? "retrying"
        : isCompactHot(goal)
          ? "hot"
          : goal.evaluating
            ? "evaluating"
            : goal.waiting
              ? "waiting"
              : "armed"
  if (goal.loopEnabled) {
    const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : ""
    const pips = renderPips(goal.loopHistory?.length ?? 0, goal.loopMaxLoops)
    const pending = goal.loopCompact && !goal.loopCompact.landedAt ? goal.loopCompact : undefined
    const compacting = pending ? ` · compact pending${pending.misses > 0 ? ` (${pending.misses}/${COMPACT_MISS_CAP})` : ""}` : ""
    return { text: `${GOAL_GLYPH} loop · v${goal.loopIteration ?? 1}${cap}${pips ? ` ${pips}` : ""} · ${state} · ${formatDurationCoarse(elapsed)}${turns}${compacting}${retrying}`, tone }
  }
  return { text: `${GOAL_GLYPH} goal ${state} · ${formatDurationCoarse(elapsed)}${turns}${retrying}`, tone }
}

/**
 * How long a terminal acknowledgment pill lingers on the jump row after a live→terminal transition.
 * Long enough to notice without becoming furniture; the entries cache may evict the goal itself sooner.
 */
export const TERMINAL_ACK_MS = 45_000

/**
 * How long the check-flash rides the terminal acknowledgment pill after a goal lands `achieved`:
 * the bold attribute flips on the same slow cadence as the evaluating pulse, then the flash ends and
 * the pill goes static for the rest of the ack window. Motion, not information — it exists so the eye
 * catches the completion moment where the user was already watching. Suppressed under reduced motion
 * (NO_COLOR / TERM=dumb) like every other pulse.
 */
export const ACK_FLASH_MS = 1_700

/**
 * The pill's pulse interval runs while any of the three transient conditions is live: the evaluator is
 * thinking, the compaction request is running hot, or the just-achieved flash window is open. Extracted
 * so the contract — a flash alone drives the pulse — is pinned in unit tests. Pure.
 */
export const pillMotionNeeded = (args: { readonly evaluating?: boolean; readonly hot?: boolean; readonly flashing?: boolean }): boolean =>
  args.evaluating === true || args.hot === true || args.flashing === true

/**
 * The completion moment: when a goal goes live→terminal the ambient pill would otherwise blink out
 * with no residual signal where the user was watching. Rendered for `TERMINAL_ACK_MS` after the
 * transition (wired in tui.tsx from the snapshot path). `cleared` and still-live statuses return
 * undefined — a deliberate user reset is silent, an active goal is not a completion. Same grammar
 * as `pillModel` so the jump-row text does not change shape.
 */
export const terminalPill = (goal: GoalSnapshot, elapsed: number): PillModel | undefined => {
  const tone: HudTone | undefined =
    goal.status === "achieved" ? "achieved" : goal.status === "impossible" ? "impossible" : goal.status === "failed" ? "failed" : undefined
  if (!tone) return undefined
  const word = goal.status === "achieved" ? (goal.loopEnabled ? "complete" : "achieved") : goal.status
  const turns = goal.turns > 0 ? ` · ${goal.turns} turn${goal.turns === 1 ? "" : "s"}` : ""
  const span = `${formatDurationCoarse(elapsed)}${turns}`
  if (goal.loopEnabled) {
    const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : ""
    const iteration = Math.max(1, goal.loopIteration ?? (goal.loopHistory?.length ?? 0) + 1)
    return { text: `${GOAL_GLYPH} loop ${word} · v${iteration}${cap} · ${span}`, tone }
  }
  return { text: `${GOAL_GLYPH} goal ${word} · ${span}`, tone }
}

/** Minimum cells a pinned condition needs before the pin suffix is worth rendering at all. */
export const PIN_MIN_WIDTH = 12
export const PIN_PREFIX = " · pin: "

/**
 * The pinned-condition suffix for the ambient pill: ` · pin: <condition>`, truncated so the whole
 * pill stays inside `conditionMax` cells for the condition itself. The pill lives on the jump row
 * directly above the prompt, so a pinned condition stays visible no matter how far the conversation
 * scrolls. Returns "" when the condition cannot get `PIN_MIN_WIDTH` cells — a lone hint is worse
 * than none. `conditionMax` is the caller's remaining width budget, not the total terminal width.
 */
export const pinSuffix = (condition: string, conditionMax: number): string => {
  const budget = Math.floor(conditionMax)
  if (!Number.isFinite(budget) || budget < PIN_MIN_WIDTH) return ""
  const flat = condition.replace(/\s+/g, " ").trim()
  if (flat.length === 0) return ""
  return `${PIN_PREFIX}${truncate(flat, budget)}`
}

/**
 * Motion guard for the evaluator-thinking pulse: no animation when the user asked for none
 * (NO_COLOR) or the terminal cannot animate (TERM=dumb). The host conversation renders in the
 * same terminal, so the common conventions apply without a plugin-specific variable.
 * Anything else gets the pulse — it only ever runs while `evaluating` is true.
 */
export const motionDisabled = (env: Record<string, string | undefined>): boolean =>
  env.NO_COLOR !== undefined || env.TERM === "dumb"

/**
 * Reduced-color surface: same env predicate as `motionDisabled` (NO_COLOR set, or a terminal that cannot
 * animate/color). The plugin drops every chromatic accent from its own chrome — glyph shapes, status words
 * and weight (bold) carry all meaning, and hover becomes an underline instead of a background fill. The
 * host's own chrome is out of scope: opencode renders full color regardless of NO_COLOR (verified live),
 * so the guarantee here covers plugin surfaces only.
 */
export const monochrome = (env: Record<string, string | undefined>): boolean =>
  env.NO_COLOR !== undefined || env.TERM === "dumb"

/** Minimal structural theme for the accent mappers: the host's ResolvedTheme subsets fit, and so do the minimal test themes. Generic over the color representation so RGBA and hex strings both type-check. */
export interface NeutralTheme<C> {
  readonly text: {
    readonly base: C
    readonly muted: C
    readonly faint: C
    readonly feedback: {
      readonly info: { readonly base: C }
      readonly warning: { readonly base: C }
      readonly error?: { readonly base: C }
    }
  }
}

/** Status-word accent. Mono returns `faint` for a cleared record and `base` otherwise — the word itself is the signal. */
export const stateAccentColor = <C>(theme: NeutralTheme<C>, status: string, stuck: boolean, mono: boolean): C => {
  if (mono) return status === "cleared" ? theme.text.faint : theme.text.base
  if (status === "paused" || status === "impossible") return theme.text.feedback.warning.base
  if (status === "active") return stuck ? theme.text.feedback.warning.base : theme.text.feedback.info.base
  if (status === "achieved") return theme.text.feedback.info.base
  if (status === "failed") return theme.text.feedback.error?.base ?? theme.text.feedback.warning.base
  return theme.text.faint
}

/** Card border accent. Color mode: quiet faint for a nominal/evaluating goal, amber family once the goal is hot/stuck/paused or impossible, outcome hues for terminal states, `border.base` override first. Mono: the host's border override or faint — chrome never carries the signal. */
export const borderAccentColor = <C>(
  theme: NeutralTheme<C> & { readonly border?: { readonly base: C } },
  status: string,
  accent: { readonly hot?: boolean; readonly stuck?: boolean },
  mono: boolean,
): C => {
  if (mono) return theme.border?.base ?? theme.text.faint
  if (status === "achieved") return theme.text.feedback.info.base
  if (status === "failed") return theme.text.feedback.error?.base ?? theme.text.feedback.warning.base
  if (status === "impossible" || status === "paused" || accent.hot === true || accent.stuck === true) return theme.text.feedback.warning.base
  return theme.border?.base ?? theme.text.faint
}

/** Verdict glyph accent. Mono: met and impossible render `base`, everything else faint — the glyph shape carries the verdict. */
export const verdictAccentColor = <C>(theme: NeutralTheme<C>, verdict: string, mono: boolean): C => {
  if (verdict === "met") return mono ? theme.text.base : theme.text.feedback.info.base
  if (verdict === "impossible") return mono ? theme.text.base : theme.text.feedback.warning.base
  return theme.text.faint
}

/** Remediation (`fix`) row accent. Mono: `base` — the remedy is exact either way, the tone never is. */
export const fixAccentColor = <C>(theme: NeutralTheme<C>, tone: "warning" | "error", mono: boolean): C => {
  if (mono) return theme.text.base
  return tone === "error" ? theme.text.feedback.error?.base ?? theme.text.feedback.warning.base : theme.text.feedback.warning.base
}

export interface Remediation {
  /** `warning` renders amber, `error` renders the faint/red family the theme exposes for failures. */
  readonly tone: "warning" | "error"
  readonly text: string
}

/**
 * Failure is a first-class screen: when the loop is hot, the goal is stuck failed or judged impossible,
 * say exactly what to do — never a vague warning. Returns undefined when everything is nominal.
 * Order matters: an unrecoverable failure outranks an impossible verdict, which outranks a paused goal
 * (the remedy depends on the persisted `pauseCause`), which outranks a stuck retry loop
 * (nothing executes at all), which outranks a hot compaction request, which outranks a verdict streak.
 */
// Remediation strings stay short: the HUD card wraps them at ~49 columns (two rows are budgeted in
// hudCardRows), the dialog has more room but shows the same line. One exact action, no hedging.
export const remediationFor = (goal: GoalSnapshot): Remediation | undefined => {
  if (goal.status === "failed") {
    // The classifier's label is short and stable; naming the cause beats a generic reset line. Falls back for records persisted before failureLabel existed.
    const label = goal.failureLabel
    return { tone: "error", text: label ? `${label} — /goal clear to reset` : `goal failed — /goal clear to reset` }
  }
  if (goal.status === "impossible") {
    return { tone: "warning", text: `judged impossible · rephrase the condition, else /goal clear` }
  }
  // A paused goal stopped executing for exactly one of three reasons; the record carries which one, so the remedy is exact rather than generic (records persisted before pauseCause existed fall through to the catch-all line).
  if (goal.status === "paused") {
    const cause = goal.pauseCause
    if (cause === "cap") return { tone: "warning", text: `turn cap reached · /goal clear or set a new goal — a message will not extend it` }
    if (cause === "stall") return { tone: "warning", text: `no tool use for ${Math.max(0, Math.floor(goal.stall))} turns · send a message to resume, or /goal clear` }
    if (cause === "user") return { tone: "warning", text: `interrupted · send a message to resume` }
    return { tone: "warning", text: `paused · send a message to resume, or /goal clear` }
  }
  if (isRetryStuck(goal)) {
    return { tone: "warning", text: `${goal.retries} failed turns in a row · check provider quota or settings · else /goal clear` }
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

/**
 * The teaching empty state. A freshly armed goal (no turns recorded, no evaluator verdicts, nothing
 * remedial to act on) is the one moment a user cannot know on their own that the evaluator reads only
 * what is visible in the conversation — it never runs commands or reads files. One faint line, gone
 * forever after the first recorded turn. `remediationFor` takes precedence: a goal hot enough to need
 * the remediation row does not need the onboarding hint. Looped or not — the rule is identical.
 */
export const EVALUATOR_HINT_CARD = "the evaluator reads only the transcript"
export const EVALUATOR_HINT_FULL = "the evaluator reads only the transcript — it cannot run commands; prove the condition with visible output"
export const evaluatorHint = (goal: GoalSnapshot): { readonly card: string; readonly full: string } | null => {
  // `evaluating` / `waiting` are boolean flags on an otherwise-`active` record; the hint applies while the status is active.
  if (goal.status !== "active") return null
  if (goal.turns > 0) return null
  if ((goal.history?.length ?? 0) > 0) return null
  if (remediationFor(goal)) return null
  return { card: EVALUATOR_HINT_CARD, full: EVALUATOR_HINT_FULL }
}
