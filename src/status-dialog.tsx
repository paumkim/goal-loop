/**
 * The `/goal` detail dialog body, extracted so it renders headlessly (scripts/render-dialog.tsx) and stays
 * verifiable without a live TUI. The host owns all chrome (dialog frame, backdrop, Esc) — this is just the
 * content: state line, wrapped condition/evaluator/spend rows, and the history sections. Everything is
 * presentational, rendered from the live snapshot passed in by the caller; theme tokens only.
 */
import { Show, createSignal, onCleanup } from "solid-js"
import type { JSX } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { formatDurationCoarse, formatSpend, formatTokens } from "./core/format.ts"
import { remediationFor, stateAccentColor, fixAccentColor, evaluatorHint, motionDisabled } from "./core/hud.ts"
import { contextMeter, CONTEXT_BAR_CELLS } from "./core/history.ts"
import type { GoalSnapshot } from "./core/types.ts"
import { HistoryBlock, LoopSection, type HistoryTheme } from "./tui-history.tsx"
import { LABEL } from "./core/history.ts"

export const StatusDialogBody = (props: {
  goal: GoalSnapshot | undefined
  fallback: string
  theme: HistoryTheme
  /** Live extrapolated elapsed time in ms. */
  elapsedMs: () => number
  /** Reference clock for relative timestamps. */
  nowMs: () => number
  /** When set, clicking the condition row copies the full condition via this callback (host wires clipboard + toast). */
  onCopyCondition?: (condition: string) => void
  /** Reduced-color surface (NO_COLOR / TERM=dumb): drop chromatic accents; weight and glyphs carry meaning. */
  mono?: boolean
  /** When set, clicking the evaluator/reason row copies the raw reason. The row underlines on hover to advertise it (same pattern as the condition row). */
  onCopyReason?: (reason: string) => void
  /** When set, clicking an iteration summary line in the loop rail copies the full summary (the line underlines on hover). */
  onCopySummary?: (summary: string, version: number) => void
}): JSX.Element => {
  const theme = () => props.theme
  // ASCII demotion for dumb terminals (NO_COLOR / TERM=dumb): the context meter becomes ink-density ASCII. Evaluated once per mount.
  const ascii = motionDisabled(process.env)
  const mono = () => props.mono === true
  const label = (text: string) => (
    <text fg={theme().text.faint} flexShrink={0} width={LABEL}>
      {text}
    </text>
  )
  const field = (name: string, children: JSX.Element, wide = false) => (
    <box flexDirection="row" gap={2}>
      {label(name)}
      <text wrapMode="word" fg={theme().text.base} flexGrow={wide ? 1 : 0}>
        {children}
      </text>
    </box>
  )
  // Terminal states carry the same accents as the HUD card so the dialog header never reads muted-gray on an outcome: achieved reads info, impossible and paused read warning, failed reads error (falling back to warning where the theme has no error token).
  const stateColor = () => (props.goal?.status ? stateAccentColor(theme(), props.goal.status, false, mono()) : theme().text.muted)
  const g = () => props.goal
  const remediation = () => {
    const goal = g()
    return goal ? remediationFor(goal) : undefined
  }
  // A freshly armed goal teaches one thing: the evaluator reads only the transcript. Gone after turn 1.
  const hint = () => {
    const goal = g()
    return goal ? evaluatorHint(goal) : null
  }
  // Host toasts do not render above the modal, so row copies acknowledge in place: a transient
  // `✓ copied` suffix on the row that was clicked (same grammar as the footer's copy button).
  const [copied, setCopied] = createSignal<string | null>(null)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  const acknowledge = (key: string) => {
    setCopied(key)
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => setCopied(null), 1600)
  }
  onCleanup(() => {
    if (copiedTimer) clearTimeout(copiedTimer)
  })
  const copiedSuffix = (key: string) => (copied() === key ? " ✓ copied" : "")
  const [reasonHovered, setReasonHovered] = createSignal(false)
  const [conditionHovered, setConditionHovered] = createSignal(false)
  const copyCondition = (condition: string) => {
    try {
      props.onCopyCondition?.(condition)
      acknowledge("condition")
    } catch {
      // Best-effort.
    }
  }
  const copyReason = (reason: string) => {
    if (!props.onCopyReason) return
    try {
      props.onCopyReason(reason)
      acknowledge("reason")
    } catch {
      // Best-effort.
    }
  }
  return (
    <Show when={g()} fallback={<text wrapMode="word" fg={theme().text.base}>{props.fallback}</text>}>
      {(goal) => (
        <box flexDirection="column" gap={1} paddingRight={3}>
          <box flexDirection="row" gap={2}>
            <text fg={stateColor()} attributes={TextAttributes.BOLD}>
              {goal().status}
            </text>
            <text fg={theme().text.muted}>
              {formatDurationCoarse(props.elapsedMs())} · {goal().turns} turn{goal().turns === 1 ? "" : "s"}
              {goal().evaluating ? " · checking" : goal().waiting ? " · waiting" : ""}
            </text>
          </box>
          {/* condition — click to copy the full text (host wires clipboard + toast via onCopyCondition) */}
          <box flexDirection="row" gap={2} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); copyCondition(goal().condition) }} onMouseOver={() => setConditionHovered(true)} onMouseOut={() => setConditionHovered(false)}>
            {label("goal")}
            <text wrapMode="word" fg={theme().text.base} flexGrow={1} attributes={conditionHovered() ? TextAttributes.UNDERLINE : undefined}>
              {goal().condition}{copiedSuffix("condition")}
            </text>
            <Show when={conditionHovered()}>
              <text wrapMode="none" flexShrink={0} fg={theme().text.faint}>copy</text>
            </Show>
          </box>
          {/* evaluator/reason — click to copy the raw text (host wires clipboard + toast via onCopyReason) */}
          <Show when={goal().reason}>
            {(reason) => (
              <Show
                when={props.onCopyReason}
                fallback={field(goal().status === "active" ? "evaluator" : "reason", reason(), true)}
              >
                <box flexDirection="row" gap={2} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); copyReason(reason()) }} onMouseOver={() => setReasonHovered(true)} onMouseOut={() => setReasonHovered(false)}>
                  {label(goal().status === "active" ? "evaluator" : "reason")}
                  <text wrapMode="word" fg={theme().text.base} flexGrow={1} attributes={reasonHovered() ? TextAttributes.UNDERLINE : undefined}>
                    {reason()}{copiedSuffix("reason")}
                  </text>
                  <Show when={reasonHovered()}>
                    <text wrapMode="none" flexShrink={0} fg={theme().text.faint}>copy</text>
                  </Show>
                </box>
              </Show>
            )}
          </Show>
          {/* teaching empty state — freshly armed goal, gone after the first turn */}
          <Show when={hint()}>
            {(h) => (
              <box flexDirection="row" gap={2}>
                {label("hint")}
                <text wrapMode="word" flexGrow={1} fg={theme().text.muted}>
                  {h().full}
                </text>
              </box>
            )}
          </Show>
          {/* failure is a first-class screen: exact remediation, never a vague warning */}
          <Show when={remediation()}>
            {(fix) => (
              <box flexDirection="row" gap={2}>
                {label("fix")}
                <text wrapMode="word" flexGrow={1} fg={fixAccentColor(theme(), fix().tone === "error" ? "error" : "warning", mono())}>
                  {fix().text}
                </text>
              </box>
            )}
          </Show>
          <Show when={goal().spend}>{(spend) => field("spend", formatSpend(spend()))}</Show>
          {/* context estimate vs the auto-compact threshold — the dial the boundary compaction reads; omitted entirely when the server could not estimate */}
          <Show when={goal().contextSize !== undefined}>
            {(() => {
              const meter = () => contextMeter(goal().contextSize as number, goal().compactAtTokens, CONTEXT_BAR_CELLS, ascii)
              const hot = () => meter().hot
              const fg = () => (mono() ? theme().text.base : hot() ? theme().text.feedback.warning.base : theme().text.feedback.info.base)
              return (
                <box flexDirection="row" gap={2}>
                  {label("context")}
                  <Show
                    when={goal().compactAtTokens !== undefined}
                    fallback={<text wrapMode="none" fg={theme().text.muted}>{`~${formatTokens(goal().contextSize as number)} tokens`}</text>}
                  >
                    <text wrapMode="none" fg={fg()}>{meter().text}</text>
                    <text wrapMode="none" fg={mono() ? theme().text.muted : hot() ? theme().text.feedback.warning.base : theme().text.muted}>
                      {`~${formatTokens(goal().contextSize as number)} of ${formatTokens(goal().compactAtTokens as number)} · ${meter().pct}%`}
                    </text>
                  </Show>
                </box>
              )
            })()}
          </Show>
          <Show when={goal().loopEnabled}>
            <LoopSection goal={goal()} theme={theme()} elapsedMs={props.elapsedMs} nowMs={props.nowMs} mono={mono()} onCopySummary={props.onCopySummary} />
          </Show>
          <Show when={!goal().loopEnabled}>
            <HistoryBlock goal={goal()} theme={theme()} elapsedMs={props.elapsedMs} mono={mono()} />
          </Show>
        </box>
      )}
    </Show>
  )
}
