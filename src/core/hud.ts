/**
 * Pure model helpers for the goal HUD: the ambient pill (level a), the compact card (level b)
 * and the failure-first-class remediation rows shared by the card and the `/goal` dialog.
 * No I/O, no JSX; everything here is unit-tested headlessly. Presentation lives in
 * `src/hud-card.tsx` (card), `src/tui-history.tsx` (dialog sections) and `src/tui.tsx` (wiring).
 */
import { COMPACT_MISS_CAP, isLive, completedIterationCount, totalVerdictCount, type GoalSnapshot, type LoopCompactState } from "./types.ts"
import { cellWidth, formatDurationCoarse, nonNegative, truncate } from "./format.ts"
import { renderPips, verdictStreak } from "./history.ts"

/**
 * Automatic retries since the last successful turn before the pill calls out the distress. One or two are
 * transient (provider hiccups, rate-limit windows); at this count the goal is almost certainly stuck — nothing
 * has executed — and the surface says so, the same way two compaction misses say so.
 */
const RETRY_HOT_THRESHOLD = 3

/** Tone drives the pill/card accent color. `hot` means a compaction request keeps missing — amber, the "running hot" state. `retrying` means every turn keeps failing — amber, the "nothing is executing" state. `achieved`/`impossible`/`failed` are terminal acknowledgment tones (see `terminalPill`). */
type HudTone = "armed" | "evaluating" | "waiting" | "paused" | "hot" | "retrying" | "achieved" | "impossible" | "failed"

/** Every turn keeps failing at the retry threshold or beyond: the goal is stuck, not merely slow. */
export const isRetryStuck = (goal: GoalSnapshot): boolean => goal.retries >= RETRY_HOT_THRESHOLD

/**
 * How many turns the agent has actually been evaluated on the goal the pill is showing — the count the
 * user wants at a glance ("14 turns evaluated"), and the same verdict trail that produces the detail
 * card's "14x not_met in a row". The trail (via `totalVerdictCount`, which includes entries the retention
 * cap dropped) is authoritative, NOT the per-iteration `turns` counter: a loop advance resets `turns` to 0
 * while the trail keeps every evaluation, and a snapshot restored or re-armed out of band can read 0 turns
 * beside a trail that already holds 14 verdicts — the exact state that made the live pill say "1 turn"
 * next to a detail card saying "14x not_met in a row". `max` keeps legacy records (a trail absent but
 * `turns` present) honest. Pure; the snapshot carries the trail, so the count moves on every changed event.
 */
export const currentTurnCount = (goal: GoalSnapshot): number =>
  // A corrupt/non-finite legacy turns counter must not make the pill read "NaN turns"; the verdict
  // trail stays authoritative and the clamp is a no-op for every finite counter.
  Math.max(totalVerdictCount(goal), nonNegative(goal.turns))

interface PillModel {
  readonly text: string
  readonly tone: HudTone
}

/** A pending boundary compaction that keeps missing is "hot" once misses reach half the cap (2 of 4). */
export const isCompactHot = (goal: GoalSnapshot): boolean => {
  const pending = goal.loopCompact
  return Boolean(pending && pending.landedAt === undefined && pending.misses >= 2)
}

type CompactMarkerTone = "landed" | "missed" | "pending" | "unknown"
interface CompactMarker {
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

/**
 * The pill should wear the delegation icon when the parent is waiting on a delegated subagent. A shell-only
 * wait (or a restored record without the additive count) keeps the plain hollow ring: nothing to attribute
 * the wait to, so no borrowed icon. One source for the TUI's glyph swap and the tests that pin it.
 */
export const waitingOnSubagents = (goal: GoalSnapshot): boolean =>
  goal.status === "active" && goal.waiting === true && (goal.waitingSubagents ?? 0) > 0

const stateWord = (goal: GoalSnapshot): string => {
  if (goal.status === "paused") return "paused"
  if (goal.evaluating) return "checking"
  if (goal.waiting) {
    const count = goal.waitingSubagents ?? 0
    // Name what the parent is waiting on. One child reads as "waiting for subagent"; more than one shows
    // the count so the pill agrees with the host's subagent tally. Unknown/zero stays the honest "waiting".
    return count > 1 ? `waiting for ${count} subagents` : count === 1 ? "waiting for subagent" : "waiting"
  }
  if (goal.queued) return "queued"
  return isRetryStuck(goal) ? "stuck" : "active"
}

/**
 * May the HUD card arm right now? A goal must be eligible to paint (live record on disk or in cache),
 * AND the status dialog — the deeper zoom level — must not own the screen. The palette `goal.hud.toggle`,
 * the pill's left click and the HUD Esc layer all consult this one predicate rather than re-deriving a
 * local copy, so there is exactly one place the "dialog owns the screen" rule lives.
 */
/** Boundary-compaction marker accent — the shared mapping behind the card's and the dialog's compaction-landed indicator. Mono drops the hue (the summary owns the words); color mode uses success/info for landed, warning for missed, faint for unresolvable. Structural theme so the card and the dialog share one mapping. */
export const compactMarkerFg = <C>(theme: NeutralTheme<C>, tone: CompactMarkerTone, mono: boolean): C => {
  if (mono) return theme.text.muted
  const fb = theme.text.feedback
  if (tone === "landed") return (fb.success ?? fb.info).base
  if (tone === "missed") return fb.warning.base
  return theme.text.faint
}

export const hudArmEnabled = (hasGoal: boolean, statusDialogOpen: boolean): boolean => hasGoal && !statusDialogOpen

/**
 * Walk a degradation ladder (fullest first) and pick the first rung that fits `budget` terminal cells,
 * width-aware via cellWidth. The final rung — the irreducible state core — is hard-truncated with the
 * caller's ellipsis when even it cannot fit; the pill never paints wider than `budget` cells. The
 * evaluated-turn count is the last detail dropped before the core, so the number the user watches stays
 * visible for as long as the width allows.
 */
const fitLadder = (rungs: readonly string[], budget: number, ellipsis: string = "\u2026"): string => {
  for (const rung of rungs) {
    if (cellWidth(rung) <= budget) return rung
  }
  return truncate(rungs[rungs.length - 1]!, Math.max(0, Math.floor(budget)), ellipsis)
}

/**
 * The HUD card's context menu, as data. Right-click the card paints six rows in a fixed order —
 * the power copies and the record's file doors without leaving the hand — and until recently the set
 * existed only as JSX, out of reach of the keymap: the menu was the card's one mouse-only island.
 * The rows live here so the paint path (hud-card.tsx maps them), the keyboard path (tui.tsx
 * activates by id) and the tests all read one source instead of three hand-mirrored copies of the
 * enabled predicates.
 *
 * `enabled` mirrors the mouse grammar: rows whose payload does not exist (no evaluator reason on
 * the record, no landed summary in loopHistory) render faint, light up never, and the click is
 * swallowed. The keyboard twin skips disabled rows by the same contract — selection can rest on a
 * disabled row only transiently if every row is disabled (index stays put).
 */
type ContextMenuId = "copy-condition" | "copy-reason" | "copy-summary" | "copy-dossier" | "save-dossier" | "clear"

export interface ContextMenuRow {
  readonly id: ContextMenuId
  readonly text: string
  readonly enabled: boolean
  readonly danger: boolean
}

export const CONTEXT_MENU_COPY_CONDITION: ContextMenuId = "copy-condition"
export const CONTEXT_MENU_COPY_REASON: ContextMenuId = "copy-reason"
export const CONTEXT_MENU_COPY_SUMMARY: ContextMenuId = "copy-summary"
export const CONTEXT_MENU_COPY_DOSSIER: ContextMenuId = "copy-dossier"
export const CONTEXT_MENU_SAVE_DOSSIER: ContextMenuId = "save-dossier"
export const CONTEXT_MENU_CLEAR: ContextMenuId = "clear"

export const contextMenuRows = (args: { readonly hasReason: boolean; readonly hasSummary: boolean; readonly hasDossier: boolean }): readonly ContextMenuRow[] => [
  { id: CONTEXT_MENU_COPY_CONDITION, text: "copy condition", enabled: true, danger: false },
  { id: CONTEXT_MENU_COPY_REASON, text: "copy evaluator reason", enabled: args.hasReason, danger: false },
  { id: CONTEXT_MENU_COPY_SUMMARY, text: "copy latest summary", enabled: args.hasSummary, danger: false },
  { id: CONTEXT_MENU_COPY_DOSSIER, text: "copy dossier", enabled: args.hasDossier, danger: false },
  { id: CONTEXT_MENU_SAVE_DOSSIER, text: "save dossier file", enabled: args.hasDossier, danger: false },
  { id: CONTEXT_MENU_CLEAR, text: "clear goal", enabled: true, danger: true },
]

/**
 * Arrow-key selection: wraps at both ends and skips disabled rows (the mouse grammar — inert rows
 * never light up). `delta` is read as a direction (negative = up, positive = down): its magnitude
 * carries no meaning here, and honouring it made a multiple of the row count orbit a residue class
 * of rows — falling back to a disabled resting index while an enabled row existed. Falls back to
 * the resting index when every row is disabled, so the loop always terminates. Always returns a
 * valid in-range index for a non-empty rows array.
 */
export const nextMenuIndex = (index: number, delta: number, rows: readonly { readonly enabled: boolean }[]): number => {
  const count = rows.length
  if (count === 0) return 0
  const norm = ((index % count) + count) % count
  if (delta === 0) return norm
  // A delta that is a multiple of the row count would step in place on every pass and fall back to the
  // resting index — which may be disabled while an enabled row exists. Reduce it to its direction
  // instead, so the walk always advances and the inert-row contract holds for any integer delta.
  const step = Math.sign(delta)
  let next = norm
  for (let pass = 0; pass < count; pass += 1) {
    next = (((next + step) % count) + count) % count
    if (rows[next]!.enabled) return next
  }
  return norm
}

/**
 * The 1-row ambient pill label plus its tone. Mirrors the composer-top indicator; extracted so it can
 * be unit-tested. `budget` caps the label at this many terminal cells, degrading by dropping whole segments in priority
 * order — `retry`, then `compact pending`, then `turns`, then the pips — before hard-truncating the
 * core with the surface's ellipsis. An unbounded budget (the default) composes exactly the historical
 * full label. `phase` is the breath cycle index (0..3, advanced by the caller's slow timer); an
 * undefined phase paints the static resting face — the reduced-motion contract. The dot costs the
 * same single cell at every phase, so the budget math is phase-independent.
 */
export const pillModel = (goal: GoalSnapshot, elapsed: number, ascii: boolean = false, budget: number = Number.POSITIVE_INFINITY, phase?: number): PillModel => {
  const state = stateWord(goal)
  const count = currentTurnCount(goal)
  // "N turns evaluated" names what the number counts: completed evaluations of this goal, not the
  // turn currently being run. A bare "N turns" read as "turn N" and left users expecting the number to
  // advance in place while a turn was in flight; the verdict trail only moves when a verdict lands.
  const turns = count > 0 ? ` · ${count} turn${count === 1 ? "" : "s"} evaluated` : ""
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
  const glyph = stateGlyph(goal, ascii, phase)
  if (goal.loopEnabled) {
    const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : ""
    const pips = renderPips(completedIterationCount(goal), goal.loopMaxLoops, ascii)
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
 * A cached live snapshot older than this is re-pulled on the TUI tick. The ambient pill paints from
 * the entries cache and nothing else: one dropped `changed` event strands "goal checking · Nm" on the
 * jump row forever, because the cache never re-pulls on its own. Thirty seconds is far longer than the
 * events a working goal emits (turn boundaries, tool-call commit hooks) yet short enough that a stale
 * "checking" line converges to the server's terminal truth within a tick or two.
 */
export const STALE_LIVE_ENTRY_MS = 30_000

/**
 * Everything the tick's re-pull should cover: entries older than the cadence whose goal is live OR
 * absent. The null arm closes the hole a live-only predicate cannot see: a goal armed (or disarmed)
 * since the last pull — the `changed` stream missed the event, it happened in another process on the
 * same directory, or this TUI latched its one-shot fetch while the goal did not exist yet. `receivedAt`
 * rides every re-pull (see bumpReceivedAt in entries.ts), so an unchanged null or live entry costs one
 * pull per window, not one per tick.
 */
export const staleUnprovenSessionIDs = (
  entries: Readonly<Record<string, { readonly goal?: GoalSnapshot | null | undefined; readonly receivedAt?: number | undefined }>>,
  nowMs: number,
  minAgeMs: number = STALE_LIVE_ENTRY_MS,
): string[] =>
  Object.entries(entries)
    .filter(([, entry]) => nowMs - (entry?.receivedAt ?? 0) >= minAgeMs)
    .filter(([, entry]) => entry?.goal == null || isLive(entry.goal.status))
    .map(([sessionID]) => sessionID)

/**
 * How long after its FIRST observed terminal stamp a terminal entry stays in the tick's re-pull
 * window. Ten minutes: the realistic clear-after-terminal moment (glance at the result, tidy up,
 * start the next task) usually lands inside it, while permanent terminal history — which nothing
 * will clear — stops costing a pull per window once the window lapses. Past the window the record
 * can still be cleared silently, but the residue is the entries cache's own bound (ENTRY_CAP) and
 * every dialog open re-pulls anyway; only a never-opened stale view past the window can linger.
 */
export const RECENT_TERMINAL_WINDOW_MS = 10 * 60_000

/**
 * The terminal arm of the stale-chrome guard: entries observed terminal recently (first-observation
 * `terminalAt` within `RECENT_TERMINAL_WINDOW_MS`) that are older than the cadence and not live or
 * null — `staleUnprovenSessionIDs` deliberately covers only those. A record cleared in another
 * process right after the goal went terminal used to strand its terminal snapshot forever (no re-pull
 * was ever scheduled; the `changed(null)` might be dropped). Re-pulling inside the window lets the
 * normal intake store the null and every chrome path converges. Entries without a `terminalAt`
 * (cached before this stamp existed, or cleared since) are skipped — never stamped, never polled.
 */
export const staleRecentlyTerminalSessionIDs = (
  entries: Readonly<Record<string, { readonly goal?: GoalSnapshot | null | undefined; readonly receivedAt?: number | undefined; readonly terminalAt?: number | undefined }>>,
  nowMs: number,
  minAgeMs: number = STALE_LIVE_ENTRY_MS,
  windowMs: number = RECENT_TERMINAL_WINDOW_MS,
): string[] =>
  Object.entries(entries)
    .filter(([, entry]) => entry?.goal != null && !isLive(entry.goal.status))
    .filter(([, entry]) => entry?.terminalAt !== undefined && nowMs - entry.terminalAt <= windowMs)
    .filter(([, entry]) => nowMs - (entry?.receivedAt ?? 0) >= minAgeMs)
    .map(([sessionID]) => sessionID)

/**
 * The expiry arm of the stale-chrome guard: entries observed terminal whose re-pull window has lapsed
 * (`terminalAt` older than `RECENT_TERMINAL_WINDOW_MS`) are dropped from the entries cache outright.
 * The palette predicates, the pill memos and every `entries()[sid]?.goal` consumer stop seeing the
 * finished record — instead of staying enabled on it forever, which is the "doesn't stick around for
 * new requests and new version goals" contract. The session an open status dialog is rendering (`keep`)
 * is never dropped, and null (goal-cleared) entries are never dropped — they mark "maybe armed
 * elsewhere" for the 15s tick re-pull, the same reason they are retained under ENTRY_CAP pressure.
 * Entries without a `terminalAt` (cached before the stamp existed) are kept — never expired on a guess.
 */
export const expiredTerminalSessionIDs = (
  entries: Readonly<Record<string, { readonly goal?: GoalSnapshot | null | undefined; readonly terminalAt?: number | undefined }>>,
  nowMs: number,
  keep?: string,
  windowMs: number = RECENT_TERMINAL_WINDOW_MS,
): string[] =>
  Object.entries(entries)
    .filter(([sessionID]) => sessionID !== keep)
    .filter(([, entry]) => entry?.goal != null && !isLive(entry.goal.status))
    .filter(([, entry]) => entry?.terminalAt !== undefined && nowMs - entry.terminalAt > windowMs)
    .map(([sessionID]) => sessionID)

/**
 * How long a terminal acknowledgment pill lingers on the jump row after a live→terminal transition.
 * Long enough to notice without becoming furniture; the entries cache may evict the goal itself sooner.
 */
export const TERMINAL_ACK_MS = 45_000

/**
 * How long the check-flash rides the terminal acknowledgment pill after a goal lands `achieved`:
 * the bold attribute crests on the same slow cadence as the evaluating breath, then the flash ends and
 * the pill goes static for the rest of the ack window. Motion, not information — it exists so the eye
 * catches the completion moment where the user was already watching. Suppressed under reduced motion
 * (NO_COLOR / TERM=dumb) like every other breath.
 */
export const ACK_FLASH_MS = 1_700

/**
 * How long the landing acknowledgment rides the ambient pill after a boundary compaction is observed to
 * land (`loopCompact.pending → landed`): the pill appends ` · landed ✓`, reads in the info tone and
 * crests bold on the same slow cadence as the evaluating breath, then goes static. Deliberately longer than the met flash —
 * a background win worth catching, not a celebration. Suppressed under reduced motion like every breath.
 */
export const LANDING_ACK_MS = 3_000

export const LANDING_SUFFIX = " · landed \u2713"
/** ASCII arm of the landing acknowledgment suffix (NO_COLOR / TERM=dumb): `+` stands in for the tick. Same 11-cell width — the pill budget math is unchanged. */
const LANDING_SUFFIX_ASCII = " · landed +"
/** The landing suffix for the current surface; identical cell width in both arms. */
export const landingSuffix = (ascii: boolean = false): string => (ascii ? LANDING_SUFFIX_ASCII : LANDING_SUFFIX)

/**
 * The pill's breath interval runs while the loop is genuinely alive: a live goal that is working
 * (armed and not blocked, or the evaluator is thinking — `working`), a compaction request running
 * hot, the just-achieved flash window, or the boundary-compaction landing window. Waiting, paused,
 * a stuck-retrying loop and every terminal state are static by design — amplitude tracks how alive,
 * never how urgent. Extracted so the contract is pinned in unit tests. Pure.
 */
export const pillMotionNeeded = (args: { readonly working?: boolean; readonly evaluating?: boolean; readonly hot?: boolean; readonly flashing?: boolean; readonly landing?: boolean }): boolean =>
  args.working === true || args.evaluating === true || args.hot === true || args.flashing === true || args.landing === true

/**
 * The completion moment: when a goal goes live→terminal the ambient pill would otherwise blink out
 * with no residual signal where the user was watching. Rendered for `TERMINAL_ACK_MS` after the
 * transition (wired in tui.tsx from the snapshot path). `cleared` and still-live statuses return
 * undefined — a deliberate user reset is silent, an active goal is not a completion. Same grammar
 * as `pillModel` so the jump-row text does not change shape.
 * The terminal acknowledgment pill. `budget` (cells) is optional: when provided and the armed text would
 * exceed it, the text truncates to the budget with the surface's ellipsis instead of painting past the
 * row. Mirrors `pillModel`'s contract — the pill never exceeds the cells it is given.
 */
export const terminalPill = (goal: GoalSnapshot, elapsed: number, ascii: boolean = false, budget?: number): PillModel | undefined => {
  const tone: HudTone | undefined =
    goal.status === "achieved" ? "achieved" : goal.status === "impossible" ? "impossible" : goal.status === "failed" ? "failed" : undefined
  if (!tone) return undefined
  const glyph = terminalGlyph(goal.status, ascii)
  const word = goal.status === "achieved" ? (goal.loopEnabled ? "complete" : "achieved") : goal.status
  const turns = goal.turns > 0 ? ` · ${goal.turns} turn${goal.turns === 1 ? "" : "s"}` : ""
  const span = `${formatDurationCoarse(elapsed)}${turns}`
  const text = goal.loopEnabled
    ? (() => {
        const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : ""
        const iteration = Math.max(1, goal.loopIteration ?? completedIterationCount(goal) + 1)
        return `${glyph} loop ${word} · v${iteration}${cap} · ${span}`
      })()
    : `${glyph} goal ${word} · ${span}`
  if (budget !== undefined && Number.isFinite(budget)) {
    const cap = Math.max(1, Math.floor(budget))
    if (cellWidth(text) > cap) return { text: truncate(text, cap, ascii ? "..." : "\u2026"), tone }
  }
  return { text, tone }
}

/** Minimum cells a pinned condition needs before the pin suffix is worth rendering at all. */
export const PIN_MIN_WIDTH = 12

/**
 * The breath — the ambient dot's entire motion vocabulary. Four phases of 600ms (a 2.4s period,
 * about a quarter-minute per cycle): a sleeping-cat cadence, never a heartbeat. The ring swells from
 * `◦` through `○` to a full `◎` bullseye crest and eases back, nothing else on the line moves, and no phase
 * is brighter-or-more-frantic than its neighbors. Reduced motion (NO_COLOR / TERM=dumb) never
 * advances the phase at all — the ring paints its resting face, static, and the glyph family
 * (plus weight) carries every state.
 */
export const BREATH_PERIOD_MS = 2_400
export const BREATH_PHASE_MS = BREATH_PERIOD_MS / 4
/** The four faces of the ring, indexed by phase: exhale floor, rising, crest (the bullseye), falling. */
const BREATH_WAVE = ["\u25E6", "\u25CB", "\u25CE", "\u25CB"] as const
/** The static resting face — painted whenever the phase is not advanced (reduced motion) and as the frame the motion dissolves into. */
export const BREATH_REST = "\u25CB"

/** The ring's face at breath phase `phase` (any number; wraps). An undefined or non-finite phase paints the static resting face — the reduced-motion contract. ASCII demotes the whole family to `*`. */
export const breathGlyph = (phase: number | undefined, ascii: boolean = false): string => {
  if (ascii) return "*"
  if (phase === undefined || !Number.isFinite(phase)) return BREATH_REST
  return BREATH_WAVE[((Math.floor(phase) % 4) + 4) % 4]!
}

/** True only on the crest phase — the single beat that may carry bold. Every other phase renders at normal weight. */
export const breathCrest = (phase: number | undefined): boolean =>
  phase !== undefined && Number.isFinite(phase) && ((Math.floor(phase) % 4) + 4) % 4 === 2

/**
 * The leading state glyph for the pill, by state family — shape carries the state before color or
 * word ever get a say, so the family holds under NO_COLOR:
 *   - a live goal that is working (armed, or the evaluator is thinking) swells through the breath wave;
 *   - `waiting` (background work holding evaluation back) paints a hollow `◯` (U+25EF) — nothing is in flight;
 *     the large empty ring stays distinct from every face of the wave (◦ ○ ◎) and from the resting face (○);
 *   - `paused` paints `‖` — stopped, two bars, the same metaphor as every media key;
 *   - a stuck-retrying goal paints a solid-but-static `●` — nothing executes, so nothing breathes;
 * the terminal acknowledgments paint `●` / `◌` / `✗` (achieved / impossible / failed), static.
 */
const stateGlyph = (goal: GoalSnapshot, ascii: boolean, phase: number | undefined): string => {
  if (goal.status === "paused") return ascii ? "|" : "\u2016" // ‖
  if (isRetryStuck(goal)) return ascii ? "*" : "\u25CF" // ●
  if ((goal.waiting === true || goal.queued === true) && goal.evaluating !== true) return ascii ? "o" : "\u25EF" // ◯ — large empty ring, distinct from the wave; also the queued kickoff's face: nothing is executing yet
  return breathGlyph(phase, ascii)
}

/** The terminal acknowledgment's leading glyph — static, one per outcome, ASCII-demoted under reduced color. */
const terminalGlyph = (status: string, ascii: boolean): string => {
  if (ascii) return status === "achieved" ? "+" : status === "impossible" ? "?" : "x"
  return status === "achieved" ? "\u25CF" : status === "impossible" ? "\u25CC" : "\u2717" // ● ◌ ✗
}
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
 * Motion guard for the breath: no animation when the user asked for none
 * (NO_COLOR) or the terminal cannot animate (TERM=dumb). The host conversation renders in the
 * same terminal, so the common conventions apply without a plugin-specific variable.
 * Anything else gets the breath — it only ever runs while the loop is alive (see pillMotionNeeded).
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

interface Remediation {
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
  // A paused goal stopped executing for a known reason; the record carries which one, so the remedy is exact rather than generic (records persisted before pauseCause existed fall through to the catch-all line).
  if (goal.status === "paused") {
    const cause = goal.pauseCause
    if (cause === "cap") return { tone: "warning", text: `turn cap reached · /goal clear or set a new goal - a message will not extend it` }
    if (cause === "stall") return { tone: "warning", text: `no tool use for ${Math.floor(nonNegative(goal.stall))} turns · send a message to resume, or /goal clear` }
    if (cause === "repeated_failure") return { tone: "warning", text: `repeated not_met failure signature · rotate strategy, narrow scope, or produce a diagnostic artifact, then send a message to resume (or /goal clear)` }
    if (cause === "usage_limit") return { tone: "warning", text: `free usage limit on the judge · set a separate evaluator.model or wait for the quota window, then send a message to resume (or /goal clear)` }
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
  // Retention cap: when the whole retained window is one verdict and older entries were dropped, the true streak is at least the window — never reported as an exact count.
  const streakIsLowerBound = (goal.historyDropped ?? 0) > 0 && streak.count >= (goal.history?.length ?? 0)
  if (streak.verdict === "not_met" && streak.count >= 3) {
    return {
      tone: "warning",
      text: streakIsLowerBound
        ? `at least ${streak.count} not_met in a row · consider evaluator.verifyCommand`
        : `${streak.count}x not_met in a row · consider evaluator.verifyCommand`,
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
export const EVALUATOR_HINT_FULL = `${EVALUATOR_HINT_CARD} - it cannot run commands; prove the condition with visible output`
export const evaluatorHint = (goal: GoalSnapshot): { readonly card: string; readonly full: string } | null => {
  // `evaluating` / `waiting` are boolean flags on an otherwise-`active` record; the hint applies while the status is active.
  if (goal.status !== "active") return null
  if (goal.turns > 0) return null
  if ((goal.history?.length ?? 0) > 0) return null
  if (remediationFor(goal)) return null
  return { card: EVALUATOR_HINT_CARD, full: EVALUATOR_HINT_FULL }
}
