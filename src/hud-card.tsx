/**
 * The compact HUD card (level b of the goal TUI's progressive disclosure): a floating,
 * bordered panel painted above the jump-to-latest row by `session.composer.top` (absolute box,
 * same mount as the ambient pill). Presentational and headlessly testable — every side effect
 * (copy, open dialog, clear, dismiss) is a callback wired up in `src/tui.tsx`.
 *
 * Layout (width 64, fits the 80-column floor):
 *   ╭─ ◎ /goal-loop · v3/5 ──────────────────── [esc] ─╮
 *   │ condition  ship the release notes…        (copy) │
 *   │ now        v3 · checking · 4 turns · 12m elapsed │
 *   │ last       ✓ met · this turn                     │
 *   │ ! compact pending 1/4 · …verifyCommand           │  (only when hot / failed)
 *   │ [details] [pin] [clear goal]               esc      │
 *   ╰──────────────────────────────────────────────────╯
 */
import { TextAttributes, type ColorInput } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "@opentui/solid"
import { formatDurationCoarse, GOAL_GLYPH, truncate } from "./core/format.ts"
import { LABEL, lastVerdict, renderPips, turnsSinceVerdict, verdictGlyph } from "./core/history.ts"
import { isCompactHot, isRetryStuck, remediationFor, PIN_PREFIX } from "./core/hud.ts"
import type { GoalSnapshot, Verdict } from "./core/types.ts"

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
    }
  }
  readonly border?: { readonly base: ColorInput }
  readonly background?: { readonly raised?: { readonly high?: ColorInput } }
}

const CONDITION_MAX = 42
const stateWord = (goal: GoalSnapshot): string =>
  goal.status === "paused"
    ? "paused"
    : goal.status === "active"
      ? goal.evaluating
        ? "checking"
        : goal.waiting
          ? "waiting"
          : isRetryStuck(goal)
            ? "stuck"
            : "active"
      : goal.status // terminal statuses render truthfully: achieved / impossible / cleared / failed
const verdictColor = (theme: HudCardTheme, verdict: Verdict): ColorInput =>
  verdict === "met" ? theme.text.feedback.info.base : verdict === "impossible" ? theme.text.feedback.warning.base : theme.text.faint

const Hint = (props: { theme: HudCardTheme; text: string }): JSX.Element => (
  <text wrapMode="none" fg={props.theme.text.faint}>
    {props.text}
  </text>
)

/** Rows the card occupies including the border; the absolute mount above the jump row anchors with `top={-hudCardRows(goal)}`. */
export const hudCardRows = (goal: GoalSnapshot): number =>
  5 + (lastVerdict(goal.history ?? []) ? 1 : 0) + (remediationFor(goal) ? 2 : 0)

/** Width available to a pinned condition in the pill given the terminal width and the unpinned pill text (both in cells). */
export const pinBudget = (terminalWidth: number, pillTextLength: number): number =>
  Math.floor(terminalWidth) - Math.floor(pillTextLength) - PIN_PREFIX.length - 1

export const DIALOG_FOOTER_FULL_HINT = "up/down scroll · pgup/pgdn page · home/end start/end · p pin condition · esc close"
export const DIALOG_FOOTER_SHORT_HINT = "up/down scroll · p pin · esc close"

/**
 * The host dialog footer: the key hint plus the three mouse actions. The row clips mid-word when the
 * hint is longer than the cells the buttons leave behind (a broken-sentence hint reads as broken chrome),
 * so it degrades in two steps: full hint + full labels above 140 cells, short hint + full labels above 96,
 * short hint + compact labels below. The 80-column floor always fits.
 */
export const DialogFooter = (props: {
  theme: HudCardTheme
  pinned: () => boolean
  onCopy: () => void
  onTogglePin: () => void
  onClear: () => void
}): JSX.Element => {
  const dimensions = useTerminalDimensions()
  const wide = () => dimensions().width >= 140
  const roomy = () => dimensions().width >= 96
  return (
    <box flexDirection="row" gap={1}>
      <text fg={props.theme.text.faint} wrapMode="none">
        {wide() ? DIALOG_FOOTER_FULL_HINT : DIALOG_FOOTER_SHORT_HINT}
      </text>
      <box flexGrow={1} />
      <HudButton theme={props.theme} label={roomy() ? "copy condition" : "copy"} onPress={props.onCopy} />
      <HudButton theme={props.theme} label={props.pinned() ? "unpin" : roomy() ? "pin condition" : "pin"} onPress={props.onTogglePin} />
      <HudButton theme={props.theme} label={roomy() ? "clear goal" : "clear"} onPress={props.onClear} />
    </box>
  )
}

/** One hit-tested button: hover swaps the background and brightens the label; everything else is transparent. */
export const HudButton = (props: { theme: HudCardTheme; label: string; onPress: () => void }): JSX.Element => {
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={hovered() ? props.theme.background?.raised?.high : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => {
        try {
          props.onPress()
        } catch {
          // A button callback must never take the panel down.
        }
      }}
    >
      <text wrapMode="none" fg={hovered() ? props.theme.text.base : props.theme.text.muted}>
        {`[${props.label}]`}
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
}): JSX.Element => {
  const theme = () => props.theme
  const g = () => props.goal
  const [conditionHovered, setConditionHovered] = createSignal(false)
  const looped = () => Boolean(g().loopEnabled)
  const cap = () => {
    const max = g().loopMaxLoops
    return typeof max === "number" && max > 0 ? `/${max}` : ""
  }
  const iteration = () => Math.max(1, g().loopIteration ?? (g().loopHistory?.length ?? 0) + 1)
  const pips = () => (looped() ? renderPips(g().loopHistory?.length ?? 0, g().loopMaxLoops) : "")
  const title = () =>
    looped() ? `${GOAL_GLYPH} /goal-loop · v${iteration()}${cap()}` : `${GOAL_GLYPH} /goal`
  const borderColor = () => {
    const s = g().status
    if (s === "achieved") return theme().text.feedback.info.base
    if (s === "failed") return theme().text.feedback.error?.base ?? theme().text.feedback.warning.base
    // A stuck-retrying goal joins the amber family, mirroring a hot compaction: the card border is the one accent the eye scans first.
    if (s === "impossible" || s === "paused" || isCompactHot(g()) || isRetryStuck(g())) return theme().text.feedback.warning.base
    return theme().border?.base ?? theme().text.faint
  }
  const turns = () => g().turns
  const stateColor = () => {
    const s = g().status
    if (s === "paused") return theme().text.feedback.warning.base
    // A stuck-retrying active goal reads amber everywhere the pill does — word and accent stay coherent.
    if (s === "active") return isRetryStuck(g()) ? theme().text.feedback.warning.base : theme().text.feedback.info.base
    if (s === "achieved") return theme().text.feedback.info.base
    if (s === "impossible") return theme().text.feedback.warning.base
    if (s === "failed") return theme().text.feedback.error?.base ?? theme().text.feedback.warning.base
    return theme().text.faint
  }
  const last = () => lastVerdict(g().history ?? [])
  const turnsSince = () => {
    const entry = last()
    return entry ? turnsSinceVerdict(turns(), entry.turn) : 0
  }
  const remediation = () => remediationFor(g())
  const copyCondition = () => {
    try {
      props.onCopyCondition(g().condition)
    } catch {
      // Best-effort.
    }
  }
  return (
    <box
      flexDirection="column"
      width={props.width ?? 64}
      flexShrink={0}
      border
      borderStyle="single"
      borderColor={borderColor()}
      backgroundColor={theme().background?.raised?.high}
      title={` ${title()} `}
      titleColor={stateColor()}
      bottomTitle=" esc dismiss "
      bottomTitleAlignment="right"
      titleAlignment="left"
      paddingLeft={1}
      paddingRight={1}
    >
      {/* condition — click to copy */}
      <box
        flexDirection="row"
        gap={1}
        onMouseUp={copyCondition}
        onMouseOver={() => setConditionHovered(true)}
        onMouseOut={() => setConditionHovered(false)}
      >
        <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
          condition
        </text>
        <text wrapMode="none" flexGrow={1} fg={theme().text.base} attributes={conditionHovered() ? TextAttributes.UNDERLINE : undefined}>
          {truncate(g().condition, CONDITION_MAX)}
        </text>
        <Show when={conditionHovered()}>
          <Hint theme={theme()} text="copy" />
        </Show>
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
      </box>
      {/* last verdict — the evaluator's most recent call */}
      <Show when={last()}>
        {(entry) => (
          <box flexDirection="row" gap={1}>
            <text wrapMode="none" flexShrink={0} width={LABEL} fg={theme().text.faint}>
              last
            </text>
            <text wrapMode="none" flexShrink={0} fg={verdictColor(theme(), entry().verdict)} attributes={TextAttributes.BOLD}>
              {verdictGlyph(entry().verdict)}
            </text>
            <text wrapMode="none" fg={theme().text.muted}>
              {`${entry().verdict.replace("_", " ")}${turnsSince() === 0 ? " · this turn" : ` · ${turnsSince()} turn${turnsSince() === 1 ? "" : "s"} since`}`}
            </text>
          </box>
        )}
      </Show>
      {/* failure-first-class remediation — exactly what to do, never a vague warning */}
      <Show when={remediation()}>
        {(fix) => (
          <box flexDirection="row" gap={1}>
            <text wrapMode="none" flexShrink={0} width={LABEL} fg={fix().tone === "error" ? (theme().text.feedback.error?.base ?? theme().text.feedback.warning.base) : theme().text.feedback.warning.base}>
              fix
            </text>
            <text wrapMode="word" flexGrow={1} fg={fix().tone === "error" ? (theme().text.feedback.error?.base ?? theme().text.feedback.warning.base) : theme().text.feedback.warning.base}>
              {fix().text}
            </text>
          </box>
        )}
      </Show>
      {/* actions */}
      <box flexDirection="row" gap={1} marginTop={0}>
        <HudButton theme={theme()} label="details" onPress={props.onDetails} />
        <Show when={props.onTogglePin}>
          <HudButton theme={theme()} label={props.pinned ? "unpin" : "pin"} onPress={() => props.onTogglePin?.()} />
        </Show>
        <HudButton theme={theme()} label="clear goal" onPress={props.onClear} />
        <box flexGrow={1} />
        <HudButton theme={theme()} label="esc" onPress={props.onClose} />
      </box>
    </box>
  )
}
