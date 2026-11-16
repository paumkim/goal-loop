/**
 * The `/goal` detail dialog body, extracted so it renders headlessly (scripts/render-dialog.tsx) and stays
 * verifiable without a live TUI. The host owns all chrome (dialog frame, backdrop, Esc) — this is just the
 * content: state line, wrapped condition/evaluator/spend rows, and the history sections. Everything is
 * presentational, rendered from the live snapshot passed in by the caller; theme tokens only.
 */
import { Show } from "solid-js"
import type { JSX } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { formatDurationCoarse, formatSpend, formatTokens } from "./core/format.ts"
import { remediationFor } from "./core/hud.ts"
import { contextMeter } from "./core/history.ts"
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
}): JSX.Element => {
  const theme = () => props.theme
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
  const stateColor = () =>
    props.goal?.status === "paused"
      ? theme().text.feedback.warning.base
      : props.goal?.status === "active"
        ? theme().text.feedback.info.base
        : theme().text.muted
  const g = () => props.goal
  const remediation = () => {
    const goal = g()
    return goal ? remediationFor(goal) : undefined
  }
  const copyCondition = (condition: string) => {
    try {
      props.onCopyCondition?.(condition)
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
          <box flexDirection="row" gap={2} onMouseUp={() => copyCondition(goal().condition)}>
            {label("goal")}
            <text wrapMode="word" fg={theme().text.base} flexGrow={1} attributes={props.onCopyCondition ? TextAttributes.UNDERLINE : undefined}>
              {goal().condition}
            </text>
          </box>
          <Show when={goal().reason}>{(reason) => field(goal().status === "active" ? "evaluator" : "reason", reason(), true)}</Show>
          {/* failure is a first-class screen: exact remediation, never a vague warning */}
          <Show when={remediation()}>
            {(fix) => (
              <box flexDirection="row" gap={2}>
                {label("fix")}
                <text wrapMode="word" flexGrow={1} fg={fix().tone === "error" ? (theme().text.feedback.error?.base ?? theme().text.feedback.warning.base) : theme().text.feedback.warning.base}>
                  {fix().text}
                </text>
              </box>
            )}
          </Show>
          <Show when={goal().spend}>{(spend) => field("spend", formatSpend(spend()))}</Show>
          {/* context estimate vs the auto-compact threshold — the dial the boundary compaction reads; omitted entirely when the server could not estimate */}
          <Show when={goal().contextSize !== undefined}>
            {(() => {
              const meter = () => contextMeter(goal().contextSize as number, goal().compactAtTokens)
              const hot = () => meter().hot
              const fg = () => hot() ? theme().text.feedback.warning.base : theme().text.feedback.info.base
              return (
                <box flexDirection="row" gap={2}>
                  {label("context")}
                  <Show
                    when={goal().compactAtTokens !== undefined}
                    fallback={<text wrapMode="none" fg={theme().text.muted}>{`~${formatTokens(goal().contextSize as number)} tokens`}</text>}
                  >
                    <text wrapMode="none" fg={fg()}>{meter().text}</text>
                    <text wrapMode="none" fg={hot() ? theme().text.feedback.warning.base : theme().text.muted}>
                      {`~${formatTokens(goal().contextSize as number)} of ${formatTokens(goal().compactAtTokens as number)} · ${meter().pct}%`}
                    </text>
                  </Show>
                </box>
              )
            })()}
          </Show>
          <Show when={goal().loopEnabled}>
            <LoopSection goal={goal()} theme={theme()} elapsedMs={props.elapsedMs} nowMs={props.nowMs} />
          </Show>
          <Show when={!goal().loopEnabled}>
            <HistoryBlock goal={goal()} theme={theme()} elapsedMs={props.elapsedMs} />
          </Show>
        </box>
      )}
    </Show>
  )
}
