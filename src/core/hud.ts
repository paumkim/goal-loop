/**
 * Pure model helpers for the goal HUD: the ambient pill (level a), the compact card (level b)
 * and the failure-first-class remediation rows shared by the card and the `/goal` dialog.
 * No I/O, no JSX; everything here is unit-tested headlessly. Presentation lives in
 * `src/hud-card.tsx` (card), `src/tui-history.tsx` (dialog sections) and `src/tui.tsx` (wiring).
 */
import stringWidth from "string-width"
import { COMPACT_MISS_CAP, type GoalSnapshot, type LoopCompactState } from "./types.ts"
import { formatDurationCoarse, goalGlyph, truncate } from "./format.ts"
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

export type CompactMarkerTone = "landed" | "missed" | "pending" | "unknown"
export interface CompactMarker {
  /** Trailing clause; callers prepend their own separator. The ascii arm is plain words — no glyph dependence. */
  readonly text: string
  readonly tone: CompactMarkerTone
}

/**
 * The boundary-compaction bookkeeping the loop persists on the record, readable at a glance — the
 * compaction-landed indicator the HUD owes the user. Absent when no compact was requested at any
 * boundary (plain goals never reach the boundary-compaction path, and `compactAtTokens <= 0` disables
 * it). `landed` — the host compacted (landedAt is authoritative; kept until the next boundary arm
 * overwrites it). `missed ×N` — N measurable observations saw the pending request not land (at N >= 2
 * the failure-first remediation fires; this tag stays informational). `pending` — requested, no
 * observation yet. `unknown` — the landing can be ruled in or out neither: stalenessUnknown (repeated
 * unmeasurable arms) or `unmeasurableTicks > 0`. In the ascii arm every glyph demotes to a word.
 */
export const compactMarker = (compact: LoopCompactState | undefined, ascii: boolean = false): CompactMarker | undefined => {
  if (!compact) return undefined
  if (compact.landedAt !== undefined) return { text: ascii ? "landed" : "landed ✓", tone: "landed" }
  if (compact.stalenessUnknown === true) return { text: "unknown", tone: "unknown" }
  if (compact.misses >= 1) return { text: ascii ? `missed x${compact.misses}` : `missed ×${compact.misses}`, tone: "missed" }
  if ((compact.unmeasurableTicks ?? 0) > 0) return { text: "unmeasurable", tone: "unknown" }
  return { text: "pending", tone: "pending" }
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

/**
 * May the HUD card arm right now? A goal must be eligible to paint (live record on disk or in cache),
 * AND the status dialog — the deeper zoom level — must not own the screen. The palette `goal.hud.toggle`,
 * the pill's left click and the HUD Esc layer all consult this one predicate rather than re-deriving a
 * local copy, so there is exactly one place the "dialog owns the screen" rule lives.
 */
export const hudArmEnabled = (hasGoal: boolean, statusDialogOpen: boolean): boolean => hasGoal && !statusDialogOpen

/** The pill's open/closed affordance: a leading caret, `▾` while the card is painted, `▸` while it is not.
 * Truthful to the card's presence (the caller keys it to the card actually rendering, not merely to the session's
 * hud slot). ASCII demotes to `v`/`>` under NO_COLOR / TERM=dumb — the same predicate the pips, bar and sparkline use.
 */
export const pillCaret = (open: boolean, ascii: boolean = false): string => open ? (ascii ? "v" : "▾") : (ascii ? ">" : "▸")

/**
 * Walk a degradation ladder (fullest first) and pick the first rung that fits `budget` terminal cells,
 * width-aware via stringWidth. The final rung — the irreducible state core — is hard-truncated with the
 * caller's ellipsis when even it cannot fit; the pill never paints wider than `budget` cells.
 */
const fitLadder = (rungs: readonly string[], budget: number, ellipsis: string = "\u2026"): string => {
  for (const rung of rungs) {
    if (stringWidth(rung) <= budget) return rung
  }
  return truncate(rungs[rungs.length - 1]!, Math.max(0, Math.floor(budget)), ellipsis)
}

/**
 * The HUD card's context menu, as data. Right-click the card paints four rows in a fixed order —
 * the power copies without leaving the hand — and until now the set existed only as JSX, out of
 * reach of the keymap: the menu was the card's one mouse-only island. The rows live here so the
 * paint path (hud-card.tsx maps them), the keyboard path (tui.tsx activates by id) and the tests
 * all read one source instead of three hand-mirrored copies of the enabled predicates.
 *
 * `enabled` mirrors the mouse grammar: rows whose payload does not exist (no evaluator reason on
 * the record, no landed summary in loopHistory) render faint, light up never, and the click is
 * swallowed. The keyboard twin skips disabled rows by the same contract — selection can rest on a
 * disabled row only transiently if every row is disabled (index stays put).
 */
export type ContextMenuId = "copy-condition" | "copy-reason" | "copy-summary" | "clear"

export interface ContextMenuRow {
  readonly id: ContextMenuId
  readonly text: string
  readonly enabled: boolean
  readonly danger: boolean
}

export const CONTEXT_MENU_COPY_CONDITION: ContextMenuId = "copy-condition"
export const CONTEXT_MENU_COPY_REASON: ContextMenuId = "copy-reason"
export const CONTEXT_MENU_COPY_SUMMARY: ContextMenuId = "copy-summary"
export const CONTEXT_MENU_CLEAR: ContextMenuId = "clear"

export const contextMenuRows = (args: { readonly hasReason: boolean; readonly hasSummary: boolean }): readonly ContextMenuRow[] => [
  { id: CONTEXT_MENU_COPY_CONDITION, text: "copy condition", enabled: true, danger: false },
  { id: CONTEXT_MENU_COPY_REASON, text: "copy evaluator reason", enabled: args.hasReason, danger: false },
  { id: CONTEXT_MENU_COPY_SUMMARY, text: "copy latest summary", enabled: args.hasSummary, danger: false },
  { id: CONTEXT_MENU_CLEAR, text: "clear goal", enabled: true, danger: true },
]

/**
 * Arrow-key selection: wraps at both ends and skips disabled rows (the mouse grammar — inert rows
 * never light up). Falls back to the resting index when every row is disabled, so the loop always
 * terminates. Always returns a valid in-range index for a non-empty rows array.
 */
export const nextMenuIndex = (index: number, delta: number, rows: readonly { readonly enabled: boolean }[]): number => {
  const count = rows.length
  if (count === 0) return 0
  let next = ((index % count) + count) % count
  for (let step = 0; step < count; step += 1) {
    next = (((next + delta) % count) + count) % count
    if (rows[next]!.enabled) return next
  }
  return ((index % count) + count) % count
}

/** The 1-row ambient pill label plus its tone. Mirrors the composer-top indicator; extracted so it can be unit-tested. */
/**
 * `budget` caps the label at this many terminal cells, degrading by dropping whole segments in priority
 * order — `retry`, then `compact pending`, then `turns`, then the pips — before hard-truncating the
 * core with the surface's ellipsis. An unbounded budget (the default) composes exactly the historical
 * full label.
 */
export const pillModel = (goal: GoalSnapshot, elapsed: number, ascii: boolean = false, budget: number = Number.POSITIVE_INFINITY): PillModel => {
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
  const glyph = goalGlyph(ascii)
  if (goal.loopEnabled) {
    const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : ""
    const pips = renderPips(goal.loopHistory?.length ?? 0, goal.loopMaxLoops, ascii)
    const pending = goal.loopCompact && !goal.loopCompact.landedAt ? goal.loopCompact : undefined
    const compacting = pending ? ` · compact pending${pending.misses > 0 ? ` (${pending.misses}/${COMPACT_MISS_CAP})` : ""}` : ""
    const core = `${glyph} loop · v${goal.loopIteration ?? 1}${cap}`
    const head = ` · ${state} · ${formatDurationCoarse(elapsed)}`
    const pipSeg = pips ? ` ${pips}` : ""
    const text = fitLadder(
      [`${core}${pipSeg}${head}${turns}${compacting}${retrying}`, `${core}${pipSeg}${head}${turns}${compacting}`, `${core}${pipSeg}${head}${turns}`, `${core}${pipSeg}${head}`, `${core}${head}`],
      budget,
      ascii ? "..." : "\u2026",
    )
    return { text, tone }
  }
  const core = `${glyph} goal ${state} · ${formatDurationCoarse(elapsed)}`
  const text = fitLadder([`${core}${turns}${retrying}`, `${core}${turns}`, core], budget, ascii ? "..." : "\u2026")
  return { text, tone }
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
 * How long the landing acknowledgment rides the ambient pill after a boundary compaction is observed to
 * land (`loopCompact.pending → landed`): the pill appends ` · landed ✓`, reads in the info tone and
 * flips bold on the same 850ms cadence, then goes static. Deliberately longer than the met flash —
 * a background win worth catching, not a celebration. Suppressed under reduced motion like every pulse.
 */
export const LANDING_ACK_MS = 3_000

export const LANDING_SUFFIX = " · landed \u2713"
/** ASCII arm of the landing acknowledgment suffix (NO_COLOR / TERM=dumb): `+` stands in for the tick. Same 11-cell width — the pill budget math is unchanged. */
export const LANDING_SUFFIX_ASCII = " · landed +"
/** The landing suffix for the current surface; identical cell width in both arms. */
export const landingSuffix = (ascii: boolean = false): string => (ascii ? LANDING_SUFFIX_ASCII : LANDING_SUFFIX)

/**
 * The pill's pulse interval runs while any of the transient conditions is live: the evaluator is
 * thinking, the compaction request is running hot, the just-achieved flash window is open, or the
 * boundary compaction is observed to have landed (the landing acknowledgment window). Extracted so the
 * contract — one of these alone drives the pulse — is pinned in unit tests. Pure.
 */
export const pillMotionNeeded = (args: { readonly evaluating?: boolean; readonly hot?: boolean; readonly flashing?: boolean; readonly landing?: boolean }): boolean =>
  args.evaluating === true || args.hot === true || args.flashing === true || args.landing === true

/**
 * The completion moment: when a goal goes live→terminal the ambient pill would otherwise blink out
 * with no residual signal where the user was watching. Rendered for `TERMINAL_ACK_MS` after the
 * transition (wired in tui.tsx from the snapshot path). `cleared` and still-live statuses return
 * undefined — a deliberate user reset is silent, an active goal is not a completion. Same grammar
 * as `pillModel` so the jump-row text does not change shape.
 */
/**
 * The terminal acknowledgment pill. `budget` (cells) is optional: when provided and the armed text would
 * exceed it, the text truncates to the budget with the surface's ellipsis instead of painting past the
 * row. Mirrors `pillModel`'s contract — the pill never exceeds the cells it is given.
 */
export const terminalPill = (goal: GoalSnapshot, elapsed: number, ascii: boolean = false, budget?: number): PillModel | undefined => {
  const glyph = goalGlyph(ascii)
  const tone: HudTone | undefined =
    goal.status === "achieved" ? "achieved" : goal.status === "impossible" ? "impossible" : goal.status === "failed" ? "failed" : undefined
  if (!tone) return undefined
  const word = goal.status === "achieved" ? (goal.loopEnabled ? "complete" : "achieved") : goal.status
  const turns = goal.turns > 0 ? ` · ${goal.turns} turn${goal.turns === 1 ? "" : "s"}` : ""
  const span = `${formatDurationCoarse(elapsed)}${turns}`
  const text = goal.loopEnabled
    ? (() => {
        const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : ""
        const iteration = Math.max(1, goal.loopIteration ?? (goal.loopHistory?.length ?? 0) + 1)
        return `${glyph} loop ${word} · v${iteration}${cap} · ${span}`
      })()
    : `${glyph} goal ${word} · ${span}`
  if (budget !== undefined && Number.isFinite(budget)) {
    const cap = Math.max(1, Math.floor(budget))
    if (stringWidth(text) > cap) return { text: truncate(text, cap, ascii ? "..." : "\u2026"), tone }
  }
  return { text, tone }
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
export const pinSuffix = (condition: string, conditionMax: number, ascii: boolean = false): string => {
  const budget = Math.floor(conditionMax)
  if (!Number.isFinite(budget) || budget < PIN_MIN_WIDTH) return ""
  const flat = condition.replace(/\s+/g, " ").trim()
  if (flat.length === 0) return ""
  return `${PIN_PREFIX}${truncate(flat, budget, ascii ? "..." : "\u2026")}`
}

/**
 * Motion guard for the evaluator-thinking pulse: no animation when the user asked for none
 * (NO_COLOR) or the terminal cannot animate (TERM=dumb). The host conversation renders in the
 * same terminal, so the common conventions apply without a plugin-specific variable.
 * Anything else gets the pulse — it only ever runs while `evaluating` is true.
 */
export const motionDisabled = (env: Record<string, string | undefined>): boolean =>
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
      /** Present on many host themes; optional so minimal test themes fit. Falls back to info (the prior paint). */
      readonly success?: { readonly base: C }
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

/**
 * Work-ledger accent for one recorded verdict — the three-way grammar of the loop ledger:
 * work produced (green, `success`, falling back to info), already satisfied at HEAD (blue,
 * info — the same hue CJ/CL paint the hollow glyph with), and state inspection only
 * (yellow/amber, warning — a zero-tool turn that still has not met). Mono drops the hue and
 * defers to verdictAccentColor's mono path: the glyph shape carries the signal, as everywhere
 * else. A met verdict with work paints success only when the theme exposes it; hosts without a
 * success token paint exactly the pre-existing info blue.
 */
export const verdictEntryAccentColor = <C>(theme: NeutralTheme<C>, entry: { verdict: string; toolCalls?: number }, mono: boolean): C => {
  if (mono) return verdictAccentColor(theme, entry.verdict, true)
  if (entry.verdict === "impossible") return theme.text.feedback.warning.base
  // Only a measured worked turn paints green; a met from before toolCalls existed (unknown) keeps the prior info paint — the ledger never claims work it cannot see.
  if (entry.verdict === "met") return entry.toolCalls === undefined || entry.toolCalls === 0 ? theme.text.feedback.info.base : (theme.text.feedback.success?.base ?? theme.text.feedback.info.base)
  if (entry.verdict === "not_met" && entry.toolCalls === 0) return theme.text.feedback.warning.base
  return verdictAccentColor(theme, entry.verdict, false)
}

/**
 * The just-achieved acknowledgment pill — the split second the user watches for. A recorded met verdict that MEASURED work flashes green on hosts exposing success (the pre-existing info blue everywhere else); a zero-work satisfaction at HEAD, an absent/unreadable history, or a non-met final verdict all stay info blue — the flash never claims work it cannot see. Mono paints base (met's mono posture in the accent mappers); reduced-color callers short-circuit before this runs.
 */
export const achievedAckAccentColor = <C>(
  theme: NeutralTheme<C>,
  history: readonly { readonly verdict: string; readonly toolCalls?: number }[] | undefined,
  mono: boolean = false,
): C => {
  if (mono) return theme.text.base
  const last = history && history.length > 0 ? history[history.length - 1] : undefined
  const worked = last?.verdict === "met" && typeof last.toolCalls === "number" && last.toolCalls > 0
  return worked ? (theme.text.feedback.success?.base ?? theme.text.feedback.info.base) : theme.text.feedback.info.base
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
    return { tone: "error", text: label ? `${label} - /goal clear to reset` : `goal failed - /goal clear to reset` }
  }
  if (goal.status === "impossible") {
    return { tone: "warning", text: `judged impossible · rephrase the condition, else /goal clear` }
  }
  // A paused goal stopped executing for exactly one of three reasons; the record carries which one, so the remedy is exact rather than generic (records persisted before pauseCause existed fall through to the catch-all line).
  if (goal.status === "paused") {
    const cause = goal.pauseCause
    if (cause === "cap") return { tone: "warning", text: `turn cap reached · /goal clear or set a new goal - a message will not extend it` }
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
      text: `${streak.count}x not_met in a row · consider evaluator.verifyCommand`,
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
export const EVALUATOR_HINT_FULL = "the evaluator reads only the transcript - it cannot run commands; prove the condition with visible output"
export const evaluatorHint = (goal: GoalSnapshot): { readonly card: string; readonly full: string } | null => {
  // `evaluating` / `waiting` are boolean flags on an otherwise-`active` record; the hint applies while the status is active.
  if (goal.status !== "active") return null
  if (goal.turns > 0) return null
  if ((goal.history?.length ?? 0) > 0) return null
  if (remediationFor(goal)) return null
  return { card: EVALUATOR_HINT_CARD, full: EVALUATOR_HINT_FULL }
}
