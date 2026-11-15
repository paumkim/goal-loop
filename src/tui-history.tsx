/**
 * Goal-history rendering for the `/goal` detail dialog: for looped goals a progress bar, a
 * vertical iteration rail (completed iterations + the running one) and the evaluator verdict
 * trail; for non-looped goals a compact history block (last verdict glyph, totals, per-turn
 * verdict counts, elapsed) plus the same trail. Presentational only;
 * every value derives from the live `GoalSnapshot`. Theme tokens only — no borders, no hardcoded
 * RGBA, no absolute positioning. Pure layout math lives in `src/core/history.ts` (unit-tested).
 */
import { TextAttributes, type ColorInput } from "@opentui/core"
import { For, Show } from "solid-js"
import type { JSX } from "@opentui/solid"
import { BAR_CELLS, barCaption, iterationDurations, iterationVerdictMix, lastVerdict, paceEstimate, renderBar, trailWindow, verdictCounts, verdictGlyph, verdictStreak } from "./core/history.ts"
import { formatDuration, formatDurationCoarse, truncate } from "./core/format.ts"
import type { GoalSnapshot, Verdict, VerdictEntry } from "./core/types.ts"

/** Structural subset of the host's ResolvedTheme this component needs; anything ColorInput-typed fits (RGBA or hex string). */
export interface HistoryTheme {
  readonly text: {
    readonly base: ColorInput
    readonly muted: ColorInput
    readonly faint: ColorInput
    readonly feedback: {
      readonly info: { readonly base: ColorInput }
      readonly warning: { readonly base: ColorInput }
    }
  }
}

const LABEL = 10
const SUMMARY_MAX = 400

const label = (theme: HistoryTheme, text: string) => (
  <text fg={theme.text.faint} flexShrink={0} width={LABEL}>
    {text}
  </text>
)

const colorFor = (theme: HistoryTheme, verdict: Verdict): ColorInput =>
  verdict === "met" ? theme.text.feedback.info.base : verdict === "impossible" ? theme.text.feedback.warning.base : theme.text.faint

export const LoopSection = (props: {
  goal: GoalSnapshot
  theme: HistoryTheme
  /** Live extrapolated elapsed time for the running iteration, in ms. Getter form so it stays reactive. */
  elapsedMs: () => number
}): JSX.Element => {
  const theme = () => props.theme
  const history = () => props.goal.loopHistory ?? []
  const done = () => history().length
  const max = () => props.goal.loopMaxLoops
  const current = () => Math.max(1, props.goal.loopIteration ?? done() + 1)
  const bar = () => renderBar(done(), max())
  const durations = () => iterationDurations(history(), props.goal.setAt)
  const pace = () => paceEstimate(durations(), max())
  const mixes = () => iterationVerdictMix(props.goal.history ?? [], history(), props.goal.setAt)
  const mixSuffix = (index: number) => {
    const mix = mixes()[index]
    return mix ? ` · ${mix.met}✓ ${mix.not_met}✗${mix.impossible > 0 ? ` ${mix.impossible}⊘` : ""}` : ""
  }
  const paused = () => props.goal.status === "paused"
  const stateWord = () => (paused() ? "paused" : props.goal.evaluating ? "checking" : props.goal.waiting ? "waiting" : "active")
  const nowColor = () => (paused() ? theme().text.feedback.warning.base : theme().text.feedback.info.base)
  return (
    <box flexDirection="column" gap={1}>
      {/* progress: vN of at most M, then the block bar on its own row */}
      <box flexDirection="row" gap={2}>
        {label(theme(), "loop")}
        <text wrapMode="none" fg={theme().text.base} attributes={TextAttributes.BOLD}>
          {barCaption(current(), max(), done())}
        </text>
      </box>
      <box flexDirection="row" gap={2}>
        <box width={LABEL} flexShrink={0} />
        <box flexDirection="row" flexShrink={0}>
        <Show when={bar().filled > 0}>
          <text wrapMode="none" fg={theme().text.feedback.info.base}>
            {"█".repeat(bar().filled)}
          </text>
        </Show>
        <Show when={BAR_CELLS - bar().filled > 0}>
          <text wrapMode="none" fg={theme().text.faint}>
            {"░".repeat(BAR_CELLS - bar().filled)}
          </text>
        </Show>
        </box>
      </box>
      {/* pace: mean iteration duration and the estimated remaining wall time at that pace */}
      <Show when={pace()}>
        {(estimate) => (
          <box flexDirection="row" gap={2}>
            {label(theme(), "pace")}
            <text wrapMode="none" fg={theme().text.faint}>
              {`~${formatDurationCoarse(estimate().perIteration)}/iteration · ~${formatDurationCoarse(estimate().remaining)} left at this pace`}
            </text>
          </box>
        )}
      </Show>
      {/* objective */}
      <box flexDirection="row" gap={2}>
        {label(theme(), "objective")}
        <text wrapMode="word" fg={theme().text.base} flexGrow={1}>
          {props.goal.loopObjective ?? "?"}
        </text>
      </box>
      {/* iteration rail: one row per completed iteration, summaries hanging off a │ connector */}
      <For each={history()}>
        {(entry, index) => (
          <box flexDirection="column">
            <box flexDirection="row" gap={2}>
              {label(theme(), `v${entry.version}`)}
              <text wrapMode="none" flexShrink={0} fg={theme().text.feedback.info.base}>
                ✓
              </text>
              <text wrapMode="none" fg={theme().text.base}>
                {`met · ${entry.turns} turn${entry.turns === 1 ? "" : "s"} · ${entry.toolCalls} tool${entry.toolCalls === 1 ? "" : "s"} · ${formatDuration(durations()[index()] ?? 0)}${mixSuffix(index())}`}
              </text>
            </box>
            <Show when={entry.summary.trim().length > 0}>
              <box flexDirection="row" gap={2}>
                <text fg={theme().text.faint} flexShrink={0} width={LABEL}>
                  │
                </text>
                <text wrapMode="word" fg={theme().text.faint} flexGrow={1}>
                  {`│ ${truncate(entry.summary, SUMMARY_MAX)}`}
                </text>
              </box>
            </Show>
          </box>
        )}
      </For>
      {/* the running iteration closes the rail */}
      <box flexDirection="row" gap={2}>
        {label(theme(), "now")}
        <text wrapMode="none" flexShrink={0} fg={nowColor()} attributes={TextAttributes.BOLD}>
          ◎
        </text>
        <text wrapMode="none" fg={theme().text.base}>
          {`v${current()} · ${stateWord()} · ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"} · ${formatDurationCoarse(props.elapsedMs())} elapsed`}
        </text>
      </box>
      {/* evaluator verdict trail */}
      <VerdictTrail theme={theme()} history={props.goal.history ?? []} />
    </box>
  )
}

/** The evaluator verdict trail: ✓ met / ✗ not_met / ⊘ impossible, oldest → newest. Shared by looped and non-looped goals. */
export const VerdictTrail = (props: { theme: HistoryTheme; history: readonly VerdictEntry[] }): JSX.Element => {
  const trail = () => trailWindow(props.history, 24)
  return (
    <Show when={trail().shown.length > 0}>
      <box flexDirection="row" gap={2}>
        {label(props.theme, "trail")}
        <box flexDirection="row" flexShrink={0}>
          <For each={trail().shown}>{(entry) => <text wrapMode="none" fg={colorFor(props.theme, entry.verdict)}>{verdictGlyph(entry.verdict)}</text>}</For>
        </box>
        <text wrapMode="none" fg={props.theme.text.muted} flexShrink={0}>
          {" "}
          {trail().shown.length} of {trail().total} verdict{trail().total === 1 ? "" : "s"}
        </text>
      </box>
    </Show>
  )
}

/**
 * Compact history block for non-looped goals: last verdict glyph, totals (evaluated turns, elapsed),
 * per-turn verdict counts, then the shared verdict trail. Rendered whenever the goal is not looped;
 * with no verdicts yet it degrades to a single "no verdicts yet" line plus elapsed.
 */
export const HistoryBlock = (props: {
  goal: GoalSnapshot
  theme: HistoryTheme
  /** Live extrapolated elapsed time in ms. Getter form so it stays reactive. */
  elapsedMs: () => number
}): JSX.Element => {
  const theme = () => props.theme
  const history = () => props.goal.history ?? []
  const counts = () => verdictCounts(history())
  const last = () => lastVerdict(history())
  const streak = () => verdictStreak(history())
  const streakSuffix = () => {
    const s = streak()
    return s.count >= 2 && s.verdict ? ` · ${s.count}× ${s.verdict.replace("_", " ")} in a row` : ""
  }
  const elapsed = () => formatDurationCoarse(props.elapsedMs())
  const countsText = () => {
    const c = counts()
    const parts = [`${c.met} met`, `${c.not_met} not_met`]
    if (c.impossible > 0) parts.push(`${c.impossible} impossible`)
    return parts.join(" · ")
  }
  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={2}>
        {label(theme(), "history")}
        <Show
          when={last()}
          fallback={
            <text wrapMode="none" fg={theme().text.faint}>
              no verdicts yet · {elapsed()} elapsed
            </text>
          }
        >
          {(entry) => (
            <box flexDirection="row" gap={2} flexGrow={1}>
              <text wrapMode="none" flexShrink={0} fg={colorFor(theme(), entry().verdict)} attributes={TextAttributes.BOLD}>
                {verdictGlyph(entry().verdict)}
              </text>
              <text wrapMode="word" fg={theme().text.base} flexGrow={1}>
                {`last ${entry().verdict.replace("_", " ")} (turn ${entry().turn}) · ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"} · ${countsText()} · ${elapsed()} elapsed${streakSuffix()}`}
              </text>
            </box>
          )}
        </Show>
      </box>
      <VerdictTrail theme={theme()} history={history()} />
    </box>
  )
}
