/**
 * The compact HUD card (level b of the goal TUI's progressive disclosure): a hanging-bar panel in the
 * opencode v2 composer's grammar — a 1-cell state-accent bar on the left, no frame on the other three
 * sides, the raised dark surface, and the title as an in-card row — painted above the jump-to-latest
 * row by `session.composer.top` (absolute box, same mount as the ambient pill). Presentational and
 * headlessly testable — every side effect (copy, open dialog, clear, dismiss) is a callback wired up
 * in `src/tui.tsx`.
 *
 * Layout (the composer mount's width, left bar in the state accent):
 *   ▎ ◎ /goal-loop · v3/5
 *   ▎ condition  ship the release notes…        (copy)
 *   ▎ now        active · v3/5 ○○○○● · 4 turns · 12m
 *   ▎ spend      $0.42 · 182k in · 21k out
 *   ▎ context    ████████░░░░░░░░ ~95k of 150k · 63%  (when the server can estimate)
 *   ▎ last       ✓ met · this turn
 *   ▎ why        docs build still fails…              (evaluator's reason; click to copy)
 *   ▎ fix        2x not_met in a row · consider evaluator.verifyCommand  (only when remediation exists)
 *   ▎ [details] [pin] [clear goal]                                     esc
 */
import { TextAttributes, type ColorInput } from "@opentui/core"
import stringWidth from "string-width"
import { createSignal, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "@opentui/solid"
import { formatDurationCoarse, formatSpend, formatTokens, goalGlyph, truncate, wrapLines } from "./core/format.ts"
import { LABEL, lastVerdict, renderPips, turnsSinceVerdict, verdictEntryGlyph, contextMeter, CONTEXT_BAR_CELLS } from "./core/history.ts"
import { isCompactHot, isRetryStuck, remediationFor, PIN_PREFIX, borderAccentColor, fixAccentColor, stateAccentColor, verdictEntryAccentColor, evaluatorHint, motionDisabled, compactMarker, contextMenuRows, CONTEXT_MENU_COPY_CONDITION, CONTEXT_MENU_COPY_REASON, CONTEXT_MENU_COPY_SUMMARY, CONTEXT_MENU_COPY_DOSSIER, CONTEXT_MENU_SAVE_DOSSIER, CONTEXT_MENU_CLEAR, type CompactMarkerTone } from "./core/hud.ts"
import { completedIterationCount, type GoalSnapshot, type Verdict } from "./core/types.ts"
import { Affordance } from "./affordance.tsx"

/** Structural subset of the host theme the card paints with; anything ColorInput-typed fits. Extra tokens degrade to sensible defaults. */
export interface HudCardTheme {
  readonly text: {
    readonly base: ColorInput
    readonly muted: ColorInput
    readonly faint: ColorInput
    readonly feedback: {
      readonly info: { readonly base: ColorInput }
      readonly warning: { readonly base: ColorInput }
      /** Present on the real theme; optional so minimal test themes still fit. Falls back to warning. */
      readonly error?: { readonly base: ColorInput }
      /** Present on many host themes; optional so minimal test themes fit. Falls back to info (the prior paint). */
      readonly success?: { readonly base: ColorInput }
    }
  }
  readonly border?: { readonly base: ColorInput }
  readonly background?: { readonly raised?: { readonly high?: ColorInput } }
}

const stateWord = (goal: GoalSnapshot): string =>
  goal.status === "paused"
    ? "paused"
    : goal.status === "active"
      ? goal.evaluating
        ? "checking"
        : goal.waiting
          ? "waiting"
          : goal.queued
            ? "queued"
            : isRetryStuck(goal)
              ? "stuck"
              : "active"
      : goal.status // terminal statuses render truthfully: achieved / impossible / cleared / failed
const verdictColor = (theme: HudCardTheme, entry: { verdict: Verdict; toolCalls?: number }, mono: boolean): ColorInput =>
  verdictEntryAccentColor(theme, entry, mono)

/** Rows the context menu occupies (one per action row, fixed so the mount anchor never shifts mid-toggle). */
const CONTEXT_MENU_ROWS = 6

/** Narrowest card the layout serves: left accent border (1) + padding (4) + LABEL (10) leaves a 37-cell content lane at the floor. */
const CARD_WIDTH_MIN = 52
/** Widest card the layout serves: past this the condition stops being a glance and the card stops being a HUD. */
const CARD_WIDTH_MAX = 88

/**
 * The card's width for a terminal of `terminalWidth` columns. The 64-cell design is preserved exactly at
 * the 80-column floor (80 − 16 = 64); narrower terminals compress toward CARD_WIDTH_MIN with the same
 * inner grammar, wider terminals expand to CARD_WIDTH_MAX so a 120-column editor does not stare at a
 * 64-cell panel in a dead gutter. NaN yields the 64-cell default — a host that cannot report
 * its size gets the conservative design, never a guess. +/-Infinity clamp to an edge. A `width` prop overrides this entirely.
 */
export const cardWidth = (terminalWidth: number): number => {
  if (Number.isNaN(terminalWidth)) return 64
  const fitted = Math.floor(terminalWidth) - 16
  return Math.max(CARD_WIDTH_MIN, Math.min(CARD_WIDTH_MAX, fitted))
}

/** Cells available to the remediation text for a card of `width` (left border 1, padding 4, LABEL 10, gap 1 = 16). `wrapMode="word"` wraps at this width. */
const remediationWidth = (width: number): number => Math.max(24, Math.floor(width) - 16)
/** Cells available to the spend line at `width` (left border 1, padding 4, LABEL 10, gap 1). Under the budget the spend line degrades by dropping cached, then out, then in — the cost is the anchor and never clips mid-figure. */
const spendWidth = (width: number): number => Math.max(5, Math.floor(width) - 16)

/** Cells available to the condition / why reason at `width` (the 25-cell fixed furniture: left border 1, padding 4, LABEL 10, gap 1, right affordance cell 8 + its gap 1). */
const conditionWidth = (width: number): number => Math.max(20, Math.floor(width) - 25)

interface CardRowPlan {
  /** Rows the card occupies (the 1-cell left accent is a full-height column, never a row). */
  readonly rows: number
  /** Whether the teaching hint row fits the budget. */
  readonly hint: boolean
  /** Whether the spend row fits the budget. */
  readonly spend: boolean
  /** Whether the context meter row fits the budget. */
  readonly context: boolean
  /** Whether the why row (the evaluator's one-line reason) fits the budget. */
  readonly why: boolean
  /** Whether the last-verdict row fits the budget. */
  readonly last: boolean
  /** Whether the remediation row fits the budget. It drops last, after hint, spend and last — first to come back, last to go. */
  readonly remediation: boolean
}

/**
 * The one place that decides the card's height. The remediation row wraps at remediationWidth(width) cells,
 * so its cost is the greedy word wrap of the actual text, never a flat guess. Under `maxRows` — the
 * viewport ceiling the mount computes (mirror of ClampedColumn's `height - 1`) — the plan drops whole
 * optional rows in a fixed, least-essential-first order: the teaching hint, then spend, then the context
 * meter, then the why row, then the last verdict, then the remediation. The context menu and the actions row never drop, so under a brutal
 * ceiling with the menu open (5 core rows + 6 menu rows > maxRows) the anchor still exceeds the ceiling;
 * rows are deliberately left unclamped in that pathological case — the absolute box is anchored
 * bottom-up at the dismiss affordance, so terminal-edge clipping eats the title row, never Esc.
 * Below maxRows = 9 the card always keeps enough rows to stay dismissible.
 */
export const cardRowPlan = (goal: GoalSnapshot, contextOpen = false, maxRows: number = Number.POSITIVE_INFINITY, width: number = 64): CardRowPlan => {
  const remediation = remediationFor(goal)
  const remediationWanted = Boolean(remediation)
  const remediationRows = remediation ? wrapLines(remediation.text, remediationWidth(width)) : 0
  const hintAvailable = Boolean(evaluatorHint(goal))
  const spendAvailable = Boolean(goal.spend)
  const contextAvailable = goal.contextSize !== undefined
  const whyAvailable = Boolean(goal.reason && goal.reason.trim())
  const lastAvailable = Boolean(lastVerdict(goal.history ?? []))
  const menu = contextOpen ? CONTEXT_MENU_ROWS : 0
  // Base rows: title row + condition + now + buttons (the left-accent card paints no top/bottom border).
  const fit = (hint: boolean, spend: boolean, context: boolean, why: boolean, last: boolean, fix: boolean): number =>
    4 + (spend && spendAvailable ? 1 : 0) + (context && contextAvailable ? 1 : 0) + (why && whyAvailable ? 1 : 0) + (last && lastAvailable ? 1 : 0) + (fix ? remediationRows : 0) + (hint && hintAvailable ? 1 : 0) + menu
  let hint = hintAvailable, spend = spendAvailable, context = contextAvailable, why = whyAvailable, last = lastAvailable, fix = remediationWanted
  let rows = fit(hint, spend, context, why, last, fix)
  if (rows <= maxRows) return { rows, hint, spend, context, why, last, remediation: fix }
  hint = false
  rows = fit(hint, spend, context, why, last, fix)
  if (rows <= maxRows) return { rows, hint, spend, context, why, last, remediation: fix }
  spend = false
  rows = fit(hint, spend, context, why, last, fix)
  if (rows <= maxRows) return { rows, hint, spend, context, why, last, remediation: fix }
  context = false
  rows = fit(hint, spend, context, why, last, fix)
  if (rows <= maxRows) return { rows, hint, spend, context, why, last, remediation: fix }
  why = false
  rows = fit(hint, spend, context, why, last, fix)
  if (rows <= maxRows) return { rows, hint, spend, context, why, last, remediation: fix }
  last = false
  rows = fit(hint, spend, context, why, last, fix)
  if (rows <= maxRows) return { rows, hint, spend, context, why, last, remediation: fix }
  fix = false
  rows = fit(hint, spend, context, why, last, fix)
  return { rows, hint, spend, context, why, last, remediation: fix }
}

/** Rows the card occupies (the 1-cell left accent consumes a column, not a row); the absolute mount above the jump row anchors with `top={-hudCardRows(goal, contextOpen, maxRows)}`. Pass `contextOpen` so the anchor grows with the menu, `maxRows` to cap at the viewport. */
export const hudCardRows = (goal: GoalSnapshot, contextOpen = false, maxRows: number = Number.POSITIVE_INFINITY, width: number = 64): number => cardRowPlan(goal, contextOpen, maxRows, width).rows

/** Width available to a pinned condition in the pill given the terminal width and the unpinned pill text — cells in, cells out (stringWidth on both sides; the pill carries multibyte glyphs). */
export const pinBudget = (terminalWidth: number, pillText: string): number =>
  Math.floor(terminalWidth) - stringWidth(pillText) - stringWidth(PIN_PREFIX) - 1

// Neither hint repeats the Esc chord — Esc stays in the host dialog chrome at every width tier; the hint spends its cells on scrolling and the three plugin chords.
export const DIALOG_FOOTER_FULL_HINT = "up/down scroll · pgup/pgdn · home/end · p pin · c copy · x older"
export const DIALOG_FOOTER_SHORT_HINT = "up/down scroll · p pin · c copy · x older"

/** Copy button label: transient in-modal acknowledgment wins; otherwise full at ≥96 cells, compact below. */
export const footerCopyLabel = (copied: boolean, roomy: boolean, ascii: boolean = false): string =>
  copied ? (ascii ? "+ copied" : "✓ copied") : roomy ? "copy condition" : "copy"

/** Pin button label: the object noun stays at the roomy tier across states (`pin condition` ↔ `unpin condition`) so the mouse target barely moves; compact tiers use the bare verbs. */
export const footerPinLabel = (pinned: boolean, roomy: boolean): string =>
  pinned ? (roomy ? "unpin condition" : "unpin") : roomy ? "pin condition" : "pin"

/** Cells a footer button paints: the label plus the brackets and one cell of horizontal padding each side (the HudButton chrome). */
export const footerButtonCells = (label: string): number => stringWidth(label) + 4

const footerClearLabel = (roomy: boolean): string => (roomy ? "clear goal" : "clear")

/**
 * The footer tier, computed from measured cells — an overfull row paints the rightmost (destructive)
 * button past the host dialog for every width in the band, so the tier switch reads the actual
 * arithmetic. `budget` is the terminal width minus BOTH ClampedColumn paddings (`paddingLeft={1}` and
 * `paddingRight={1}` — the footer row's left edge starts at x=1, so the content ceiling is width−2); the host owns its
 * own frame. full (FULL_HINT + noun labels) unlocks only when everything fits; roomy (SHORT_HINT +
 * noun labels) one notch below; below that the compact labels hold the 80-column floor (≈69 cells).
 * Copied/pinned flip the labels and re-measure — the tier never paints past budget in any state.
 */
export const dialogFooterTier = (width: number, copied: boolean, pinned: boolean): { wide: boolean; roomy: boolean } => {
  const budget = Math.floor(width) - 2
  const buttons = (roomy: boolean): number =>
    footerButtonCells(footerCopyLabel(copied, roomy)) + footerButtonCells(footerPinLabel(pinned, roomy)) + footerButtonCells(footerClearLabel(roomy)) + 4
  return {
    wide: stringWidth(DIALOG_FOOTER_FULL_HINT) + buttons(true) <= budget,
    roomy: stringWidth(DIALOG_FOOTER_SHORT_HINT) + buttons(true) <= budget,
  }
}

/**
 * The host dialog footer: the key hint plus the three mouse actions. The row clips mid-word when the
 * hint is longer than the cells the buttons leave behind (a broken-sentence hint reads as broken chrome),
 * so the tier degrades in two steps computed from measured cells (dialogFooterTier): full hint when the whole
 * row fits the budget, short hint + noun labels one notch below, compact labels at the 80-column floor.
 * No tier repeats the Esc chord — it stays visible in the host
 * dialog chrome; the hint spends its cells on scrolling and the three plugin chords instead.
 * `copied` flips the copy button's label to `✓ copied` (host toasts do not render above the modal).
 * The pin button keeps its object noun at the roomy tier across states (`pin condition` ↔ `unpin condition`),
 * so the mouse target does not shrink mid-toggle; compact tiers use `pin` ↔ `unpin`.
 */
export const DialogFooter = (props: {
  theme: HudCardTheme
  pinned: () => boolean
  copied: () => boolean
  mono?: boolean
  onCopy: () => void
  onTogglePin: () => void
  onClear: () => void
}): JSX.Element => {
  const dimensions = useTerminalDimensions()
  const ascii = () => motionDisabled(process.env) || props.mono === true
  const tier = () => dialogFooterTier(dimensions().width, props.copied(), props.pinned())
  const wide = () => tier().wide
  const roomy = () => tier().wide || tier().roomy
  return (
    <box flexDirection="row" gap={1}>
      <text fg={props.theme.text.faint} wrapMode="none">
        {wide() ? DIALOG_FOOTER_FULL_HINT : DIALOG_FOOTER_SHORT_HINT}
      </text>
      <box flexGrow={1} />
      <HudButton theme={props.theme} label={footerCopyLabel(props.copied(), roomy(), ascii())} mono={props.mono} onPress={props.onCopy} />
      <HudButton theme={props.theme} label={footerPinLabel(props.pinned(), roomy())} mono={props.mono} onPress={props.onTogglePin} />
      <HudButton theme={props.theme} label={footerClearLabel(roomy())} mono={props.mono} onPress={props.onClear} />
    </box>
  )
}

/** One hit-tested button: hover swaps the background and brightens the label; everything else is transparent. Under mono there is no background swap — the label boldens instead. `flushLeft`/`flushRight` drop the edge padding to zero cells so the actions row's outer buttons paint their first/last glyph exactly on the card's content column — the same edge every label, value and affordance cell snaps to. */
const HudButton = (props: { theme: HudCardTheme; label: string; mono?: boolean; onPress: () => void; flushLeft?: boolean; flushRight?: boolean }): JSX.Element => {
  const [hovered, setHovered] = createSignal(false)
  const mono = () => props.mono === true
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      height={1}
      paddingLeft={props.flushLeft === true ? 0 : 1}
      paddingRight={props.flushRight === true ? 0 : 1}
      backgroundColor={!mono() && hovered() ? props.theme.background?.raised?.high : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        // Left button only: a stray right/middle press must not fire the action. Non-left presses fall
        // through to ancestors (right-click anywhere on the card toggles the context menu).
        if (event.button !== 0) return
        event.stopPropagation()
        try {
          props.onPress()
        } catch {
          // A button callback must never take the panel down.
        }
      }}
    >
      <text wrapMode="none" fg={hovered() ? props.theme.text.base : props.theme.text.muted} attributes={mono() && hovered() ? TextAttributes.BOLD : undefined}>
        {`[${props.label}]`}
      </text>
    </box>
  )
}

/** One context-menu row: same hover grammar as HudButton (raised background, brightened label; bold under mono), full card width, faint gutter keeping the LABEL column. Inert rows never light up and swallow the click silently — a disabled action is visibly disabled, never a trap. */
const HudMenuRow = (props: { theme: HudCardTheme; gutter: string; text: string; mono?: boolean; danger?: boolean; enabled?: boolean; selected?: boolean; onPress: () => void }): JSX.Element => {
  const [hovered, setHovered] = createSignal(false)
  const mono = () => props.mono === true
  const enabled = () => props.enabled !== false
  // The keyboard twin of hover: while the menu is open the keymap layer drives a selection index; a selected row paints exactly like a hovered one (raised background, bold label) — weight is the NO_COLOR contract, never a glyph or an underline.
  const active = () => enabled() && (hovered() || props.selected === true)
  const fg = () =>
    !enabled() ? props.theme.text.faint : props.danger ? props.theme.text.feedback.warning.base : active() ? props.theme.text.base : props.theme.text.muted
  return (
    <box
      flexDirection="row"
      gap={1}
      height={1}
      backgroundColor={!mono() && active() ? props.theme.background?.raised?.high : undefined}
      onMouseOver={() => enabled() && setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (event.button !== 0) return
        if (!enabled()) return
        event.stopPropagation()
        try {
          props.onPress()
        } catch {
          // A menu action must never take the panel down.
        }
      }}
    >
      <text wrapMode="none" flexShrink={0} width={LABEL} fg={props.theme.text.faint}>
        {props.gutter}
      </text>
      <text wrapMode="none" fg={fg()} attributes={mono() && active() ? TextAttributes.BOLD : undefined}>
        {props.text}
      </text>
    </box>
  )
}

export const HudCard = (props: {
  goal: GoalSnapshot
  theme: HudCardTheme
  /** Live extrapolated elapsed time in ms. Getter form so it stays reactive. */
  elapsedMs: () => number
  /** Reference clock for "N turns since" labels. Defaults to Date.now(). */
  nowMs?: () => number
  width?: number
  onClose: () => void
  onDetails: () => void
  onClear: () => void
  onCopyCondition: (condition: string) => void
  /** When true the ambient pill appends the (truncated) condition so it stays visible while scrolling. Rendered as `unpin`; false renders `pin`. Omit both to hide the button (tests, embeds). */
  pinned?: boolean
  onTogglePin?: () => void
  /** Reduced-color surface (NO_COLOR / TERM=dumb): drop chromatic accents; weight and glyphs carry meaning. */
  mono?: boolean
  /** Context menu (right-click the card) open state; controlled by the mount so the absolute anchor can grow with it. */
  contextOpen?: boolean
  /** Controlled selection index for the open menu — the keyboard arm (↑/↓ move it, enter activates). Unwired defaults to the first row. */
  menuSelected?: () => number
  /** Right-click anywhere on the card toggles the menu open/closed. */
  onToggleContext?: () => void
  /** Called after any menu action so the mount can collapse the menu. */
  onCloseMenu?: () => void
  /** Wired by the host; absent callback renders the reason row inert. */
  onCopyReason?: (reason: string) => void
  /** Wired by the host; absent callback renders the summary row inert. */
  onCopySummary?: (summary: string) => void
  /** Wired by the host; absent callback renders both dossier rows inert (never a trap — the host wires both or neither). */
  onCopyDossier?: () => void
  /** Wired by the host; absent callback renders both dossier rows inert. Writes the record as a file through the host (`goal.dossier.export` path) — one O_EXCL write, one receipt. */
  onSaveDossier?: () => void
  /** Viewport ceiling for the card's total rows (mirror of ClampedColumn's `height - 1`). The plan drops the
   * teaching hint, then spend, then the context meter, then the why row, then the last-verdict row, then remediation (the final rung). Absent: unlimited. */
  maxRows?: number
}): JSX.Element => {
  const theme = () => props.theme
  const mono = () => props.mono === true
  const ascii = () => motionDisabled(process.env) || mono()
  const g = () => props.goal
  // Resolved card width: the caller's fixed `width` prop wins; otherwise the card measures the terminal (fluid, clamped CARD_WIDTH_MIN..CARD_WIDTH_MAX, 64 at 80 cols). Inner budgets derive from it.
  const dimensions = useTerminalDimensions()
  const width = () => props.width ?? cardWidth(dimensions().width)
  const conditionCells = () => conditionWidth(width())
  const [conditionHovered, setConditionHovered] = createSignal(false)
  const [whyHovered, setWhyHovered] = createSignal(false)
  const looped = () => Boolean(g().loopEnabled)
  const cap = () => {
    const max = g().loopMaxLoops
    return typeof max === "number" && max > 0 ? `/${max}` : ""
  }
  const iteration = () => Math.max(1, g().loopIteration ?? completedIterationCount(g()) + 1)
  const pips = () => (looped() ? renderPips(completedIterationCount(g()), g().loopMaxLoops, mono()) : "")
  const title = () =>
    looped() ? `${goalGlyph(ascii())} /goal-loop · v${iteration()}${cap()}` : `${goalGlyph(ascii())} /goal`
  // A stuck-retrying goal joins the amber family, mirroring a hot compaction: the card border is the one accent the eye scans first. Under mono the border override or faint — chrome never carries the signal.
  const borderColor = () => borderAccentColor(theme(), g().status, { hot: isCompactHot(g()), stuck: isRetryStuck(g()) }, mono())
  const turns = () => g().turns
  // A stuck-retrying active goal reads amber everywhere the pill does — word and accent stay coherent. Mono: `base` for any live/terminal word, faint for a cleared record.
  const stateColor = () => stateAccentColor(theme(), g().status, isRetryStuck(g()), mono())
  const last = () => lastVerdict(g().history ?? [])
  // The evaluator's one-line reason, whitespace-collapsed for a single-row paint; absent/blank reasons paint no row.
  const whyReason = () => g().reason?.replace(/\s+/g, " ").trim() ?? ""
  const turnsSince = () => {
    const entry = last()
    return entry ? turnsSinceVerdict(turns(), entry.turn) : 0
  }
  // One plan, same arithmetic as hudCardRows(): rows the mount anchors with == rows painted here.
  // Measured against the same resolved width the rows paint at, so a wide card reserves the rows
  // its remediation actually wraps to, not the 64-cell default's.
  const plan = () => cardRowPlan(g(), props.contextOpen === true, props.maxRows ?? Number.POSITIVE_INFINITY, width())
  const remediation = () => remediationFor(g())
  // A freshly armed goal teaches one thing: the evaluator reads only the transcript. Gone after turn 1.
  const hint = () => (plan().hint ? evaluatorHint(g()) : undefined)
  const latestSummary = () => g().loopHistory?.at(-1)?.summary
  const copyCondition = () => {
    try {
      props.onCopyCondition(g().condition)
    } catch {
      // Best-effort.
    }
  }
  const menuAction = (run: () => void) => () => {
    run()
    try {
      props.onCloseMenu?.()
    } catch {
      // Collapse best-effort.
    }
  }
  // Left-accent grammar (the opencode v2 composer's own shape): a 1-cell hanging bar in the state
  // accent, no top/bottom/right frame, a dark raised surface underneath, and the title as an in-card
  // row — the composer's grammar, not a floating bordered popup.
  return (
    <box
      flexDirection="column"
      width={width()}
      flexShrink={0}
      border={["left"]}
      borderStyle="single"
      borderColor={borderColor()}
      backgroundColor={theme().background?.raised?.high}
      paddingLeft={2}
      paddingRight={2}
      onMouseUp={(event) => {
        // Right-click anywhere on the card toggles the context menu; left clicks fall through to the rows/buttons.
        if (event.button === 2) {
          try {
            props.onToggleContext?.()
          } catch {
            // Never take the panel down.
          }
        }
      }}
    >
      {/* title row — the state glyph and the loop position, bold, left aligned; the card is framed by the hanging bar, not by a border */}
      <box flexDirection="row" height={1} flexShrink={0} gap={1}>
        <text wrapMode="none" flexShrink={0} fg={stateColor()} attributes={TextAttributes.BOLD}>
          {title()}
        </text>
      </box>
      {/* condition — click to copy */}
      <box
        flexDirection="row"
        gap={1}
        onMouseUp={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          copyCondition()
        }}
        onMouseOver={() => setConditionHovered(true)}
        onMouseOut={() => setConditionHovered(false)}
      >
        <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
          condition
        </text>
        <text wrapMode="none" flexGrow={1} fg={theme().text.base}>
          {truncate(g().condition, conditionCells(), ascii() ? "..." : "\u2026")}
        </text>
        <Affordance theme={theme()} mono={mono} verb="copy" hovered={conditionHovered()} />
      </box>
      {/* now — state, turns, elapsed, pips */}
      <box flexDirection="row" gap={1}>
        <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
          now
        </text>
        <text wrapMode="none" fg={stateColor()} attributes={TextAttributes.BOLD}>
          {stateWord(g())}
        </text>
        <text wrapMode="none" fg={theme().text.muted}>
          {`${looped() ? `v${iteration()}${cap()}${pips() ? ` ${pips()}` : ""} · ` : ""}${turns()} turn${turns() === 1 ? "" : "s"} · ${formatDurationCoarse(props.elapsedMs())}`}
        </text>
        {/* re-anchors — the count, not the notice: one quiet glyph+number instead of a transcript line per landing. looped goals only; absent at zero and on legacy records. */}
        <Show when={looped() && (g().reanchorCount ?? 0) > 0}>
          <text wrapMode="none" flexShrink={0} fg={theme().text.faint}>{ascii() ? ` · re-anchor ${g().reanchorCount}` : ` · ⟲ ${g().reanchorCount}`}</text>
        </Show>
      </box>
      {/* spend — what this loop is costing, from the session usage RPC; omitted when the server cannot estimate (same contract as the dialog's spend row), and by the row plan under a viewport ceiling */}
      <Show when={plan().spend ? g().spend : undefined}>
        {(spend) => (
          <box flexDirection="row" gap={1}>
            <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
              spend
            </text>
            <text wrapMode="none" fg={theme().text.muted}>
              {formatSpend(spend(), spendWidth(width()))}
            </text>
          </box>
        )}
      </Show>
      {/* context — the estimate against the auto-compact threshold, the same dial the boundary compaction reads. Omitted when the server cannot estimate (same contract as the dialog's context row); dropped by the row plan under a viewport ceiling, after spend. */}
      <Show when={plan().context && g().contextSize !== undefined}>
        {(() => {
          const size = () => g().contextSize as number
          const meter = () => contextMeter(size(), g().compactAtTokens, CONTEXT_BAR_CELLS, ascii())
          const hot = () => meter().hot
          const barFg = () => (mono() ? theme().text.base : hot() ? theme().text.feedback.warning.base : theme().text.feedback.info.base)
          const trailFg = () => (mono() ? theme().text.muted : hot() ? theme().text.feedback.warning.base : theme().text.muted)
          // The boundary-compaction outcome of the latest request this goal made, at a glance — the
          // compaction-landed indicator. Informational; at misses >= 2 the failure-first remediation rides
          // the same card. mono keeps the words, drops the hue; ascii demotions already live in the text.
          const marker = () => compactMarker(g().loopCompact, ascii())
          const markerFg = (tone: CompactMarkerTone) => {
            if (mono()) return theme().text.muted
            const fb = theme().text.feedback
            if (tone === "landed") return (fb.success ?? fb.info).base
            if (tone === "missed") return fb.warning.base
            return theme().text.faint
          }
          return (
            <Show
              when={g().compactAtTokens !== undefined}
              fallback={
                <box flexDirection="row" gap={1}>
                  <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
                    context
                  </text>
                  <text wrapMode="none" fg={theme().text.muted}>{`~${formatTokens(size())} tokens`}</text>
                  <Show when={marker()}>{(m) => <text wrapMode="none" flexShrink={0} fg={markerFg(m().tone)}>{`· ${m().text}`}</text>}</Show>
                </box>
              }
            >
              <box flexDirection="row" gap={1}>
                <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
                  context
                </text>
                <text wrapMode="none" flexShrink={0} fg={barFg()}>{meter().text}</text>
                <text wrapMode="none" fg={trailFg()}>{`~${formatTokens(size())} of ${formatTokens(g().compactAtTokens as number)} · ${meter().pct}%`}</text>
                <Show when={marker()}>{(m) => <text wrapMode="none" flexShrink={0} fg={markerFg(m().tone)}>{`· ${m().text}`}</text>}</Show>
              </box>
            </Show>
          )
        })()}
      </Show>
      {/* teaching empty state — freshly armed goal, gone after the first turn */}
      <Show when={hint()}>
        {(h) => (
          <box flexDirection="row" gap={1}>
            <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
              hint
            </text>
            <text wrapMode="none" flexGrow={1} fg={theme().text.muted}>
              {h().card}
            </text>
          </box>
        )}
      </Show>
      {/* last verdict — the evaluator's most recent call; dropped by the row plan under a viewport ceiling */}
      <Show when={plan().last && last()}>
        {(entry) => (
          <box flexDirection="row" gap={1}>
            <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
              last
            </text>
            <text wrapMode="none" flexShrink={0} fg={verdictColor(theme(), entry(), mono())} attributes={TextAttributes.BOLD}>
              {verdictEntryGlyph(entry(), ascii())}
            </text>
            <text wrapMode="none" fg={theme().text.muted}>
              {`${entry().verdict.replace("_", " ")}${turnsSince() === 0 ? " · this turn" : ` · ${turnsSince()} turn${turnsSince() === 1 ? "" : "s"} since`}`}
            </text>
          </box>
        )}
      </Show>
      {/* why — the evaluator's one-line reason, whitespace-collapsed; dropped by the row plan under a viewport ceiling, after context, before the last-verdict row. When the host wires onCopyReason the row is a click-to-copy affordance (same grammar as the condition row and the dialog's evaluator row); otherwise it paints inert. */}
      <Show when={plan().why && whyReason()}>
        {(() => {
          const copyable = () => Boolean(props.onCopyReason)
          return (
            <box
              flexDirection="row"
              gap={1}
              onMouseUp={copyable() ? (event) => { if (event.button !== 0) return; event.stopPropagation(); props.onCopyReason?.(whyReason()) } : undefined}
              onMouseOver={copyable() ? () => setWhyHovered(true) : undefined}
              onMouseOut={copyable() ? () => setWhyHovered(false) : undefined}
            >
              <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
                why
              </text>
              <text wrapMode="none" flexGrow={1} fg={theme().text.muted}>
                {truncate(whyReason(), conditionCells(), ascii() ? "..." : "\u2026")}
              </text>
              {copyable() ? <Affordance theme={theme()} mono={mono} verb="copy" hovered={whyHovered()} /> : null}
            </box>
          )
        })()}
      </Show>
      {/* failure-first-class remediation — exactly what to do, never a vague warning */}
      <Show when={plan().remediation && remediation()}>
        {(fix) => (
          <box flexDirection="row" gap={1}>
            <text wrapMode="none" flexShrink={0} width={LABEL} fg={fixAccentColor(theme(), fix().tone === "error" ? "error" : "warning", mono())}>
              fix
            </text>
            <text wrapMode="word" flexGrow={1} fg={fixAccentColor(theme(), fix().tone === "error" ? "error" : "warning", mono())}>
              {fix().text}
            </text>
          </box>
        )}
      </Show>
      {/* actions — the outer buttons flush to the content column / right edge so the row hangs on the same 1-cell grid as every label and affordance cell above it */}
      <box flexDirection="row" gap={1} marginTop={0}>
        <HudButton theme={theme()} label="details" mono={mono()} flushLeft onPress={props.onDetails} />
        <Show when={props.onTogglePin}>
          <HudButton theme={theme()} label={props.pinned ? "unpin" : "pin"} mono={mono()} onPress={() => props.onTogglePin?.()} />
        </Show>
        <HudButton theme={theme()} label="clear goal" mono={mono()} onPress={props.onClear} />
        <box flexGrow={1} />
        <HudButton theme={theme()} label="esc" mono={mono()} flushRight onPress={props.onClose} />
      </box>
      {/* context menu — right-click the card; power copies without leaving the hand. In-flow so the mount anchor grows with it (hudCardRows 6 extra). Rows fixed in number and position; inert rows render faint and do nothing. */}
      <Show when={props.contextOpen}>
        <box flexDirection="column" marginTop={0}>
          {contextMenuRows({ hasReason: Boolean(g().reason && props.onCopyReason), hasSummary: Boolean(latestSummary() && props.onCopySummary), hasDossier: Boolean(props.onCopyDossier && props.onSaveDossier) }).map((row, index) => {
            const gutter = index === 0 ? "menu" : ""
            const selected = () => (props.menuSelected?.() ?? 0) === index
            switch (row.id) {
              case CONTEXT_MENU_COPY_CONDITION:
                return <HudMenuRow theme={theme()} mono={mono()} gutter={gutter} text={row.text} enabled={row.enabled} selected={selected()} onPress={menuAction(copyCondition)} />
              case CONTEXT_MENU_COPY_REASON:
                return <HudMenuRow theme={theme()} mono={mono()} gutter={gutter} text={row.text} enabled={row.enabled} selected={selected()} onPress={menuAction(() => { const r = g().reason; if (r) props.onCopyReason?.(r) })} />
              case CONTEXT_MENU_COPY_SUMMARY:
                return <HudMenuRow theme={theme()} mono={mono()} gutter={gutter} text={row.text} enabled={row.enabled} selected={selected()} onPress={menuAction(() => { const s = latestSummary(); if (s) props.onCopySummary?.(s) })} />
              case CONTEXT_MENU_COPY_DOSSIER:
                return <HudMenuRow theme={theme()} mono={mono()} gutter={gutter} text={row.text} enabled={row.enabled} selected={selected()} onPress={menuAction(() => props.onCopyDossier?.())} />
              case CONTEXT_MENU_SAVE_DOSSIER:
                return <HudMenuRow theme={theme()} mono={mono()} gutter={gutter} text={row.text} enabled={row.enabled} selected={selected()} onPress={menuAction(() => props.onSaveDossier?.())} />
              case CONTEXT_MENU_CLEAR:
                return <HudMenuRow theme={theme()} mono={mono()} gutter={gutter} text={row.text} danger={row.danger} enabled={row.enabled} selected={selected()} onPress={menuAction(() => props.onClear())} />
            }
          })}
        </box>
      </Show>
    </box>
  )
}
