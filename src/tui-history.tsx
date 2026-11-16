/**
 * Goal-history rendering for the `/goal` detail dialog: for looped goals a progress bar, a
 * vertical iteration rail (completed iterations + the running one) and the evaluator verdict
 * trail; for non-looped goals a compact history block (last verdict glyph, totals, per-turn
 * verdict counts, elapsed) plus the same trail. Presentational only;
 * every value derives from the live `GoalSnapshot`. Theme tokens only — no borders, no hardcoded
 * RGBA, no absolute positioning. Pure layout math lives in `src/core/history.ts` (unit-tested).
 */
import { TextAttributes, type ColorInput } from "@opentui/core"
import { For, Show, createSignal, onCleanup } from "solid-js"
import type { JSX } from "@opentui/solid"
import { BAR_CELLS, LABEL, barCaption, contextSparkline, currentIterationVerdict, durationShares, iterationDurations, iterationVerdictMix, lastVerdict, localTime, loopTotals, paceEstimate, relativeTime, pauseDiagnostics, renderBar, trailWindow, turnsSinceVerdict, verdictCounts, verdictGlyph, verdictStreak } from "./core/history.ts"
import { formatDuration, formatDurationCoarse, formatTokens, truncate } from "./core/format.ts"
import { verdictAccentColor } from "./core/hud.ts"
import { COMPACT_MISS_CAP, type GoalSnapshot, type Verdict, type VerdictEntry } from "./core/types.ts"

/** Structural subset of the host's ResolvedTheme this component needs; anything ColorInput-typed fits (RGBA or hex string). */
export interface HistoryTheme {
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
}

const SUMMARY_MAX = 400
/** Completed-iteration rows kept visible without expanding; older ones fold behind one click. */
const RAIL_VISIBLE = 4

const label = (theme: HistoryTheme, text: string) => (
  <text fg={theme.text.faint} flexShrink={0} width={LABEL}>
    {text}
  </text>
)

const colorFor = (theme: HistoryTheme, verdict: Verdict, mono: boolean): ColorInput =>
  verdictAccentColor(theme, verdict, mono)

/**
 * One completed iteration's summary line. Click-to-copy when the caller wires `onCopy`:
 * the summary is the payload a user most often wants verbatim (to paste into a prompt or
 * an issue), so the whole line is the click target — underlined on hover, like the condition row.
 */
const RailSummary = (props: { theme: HistoryTheme; text: string; onCopy?: (text: string) => void; copied?: () => boolean }): JSX.Element => {
  const [hovered, setHovered] = createSignal(false)
  const copy = () => {
    if (!props.onCopy) return
    try {
      props.onCopy(props.text)
    } catch {
      // Best-effort.
    }
  }
  return (
    <box flexDirection="row" gap={2} onMouseUp={props.onCopy ? copy : undefined} onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}>
      <text fg={props.theme.text.faint} flexShrink={0} width={LABEL}>
        │
      </text>
      <text wrapMode="word" fg={props.theme.text.faint} flexGrow={1} attributes={props.onCopy && hovered() ? TextAttributes.UNDERLINE : undefined}>
        {`│ ${truncate(props.text, SUMMARY_MAX)}`}
        {props.copied?.() ? " ✓ copied" : ""}
      </text>
    </box>
  )
}

export const LoopSection = (props: {
  goal: GoalSnapshot
  theme: HistoryTheme
  /** Live extrapolated elapsed time for the running iteration, in ms. Getter form so it stays reactive. */
  elapsedMs: () => number
  /** Reference clock for `ended <ago>` labels. Getter form so it stays reactive; defaults to Date.now(). */
  nowMs?: () => number
  /** Reduced-color surface (NO_COLOR / TERM=dumb): drop chromatic accents; weight and glyphs carry meaning. */
  mono?: boolean
  /** When set, clicking a summary line copies that iteration's full summary. The line underlines on hover to advertise it. */
  onCopySummary?: (summary: string, version: number) => void
}): JSX.Element => {
  const theme = () => props.theme
  const mono = () => props.mono === true
  // In-modal acknowledgment: host toasts do not render above the /goal dialog, so a summary copy
  // flips a transient `✓ copied` on the line itself (same grammar as the dialog's footer button).
  const [copiedVersion, setCopiedVersion] = createSignal<number | null>(null)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (copiedTimer) clearTimeout(copiedTimer)
  })
  const copySummary = (summary: string, version: number) => {
    if (!props.onCopySummary) return
    try {
      props.onCopySummary(summary, version)
      setCopiedVersion(version)
      if (copiedTimer) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => setCopiedVersion(null), 1600)
    } catch {
      // Best-effort.
    }
  }
  const history = () => props.goal.loopHistory ?? []
  const done = () => history().length
  // Progressive disclosure: at most RAIL_VISIBLE completed iterations render; the rest fold behind one click.
  const [showAll, setShowAll] = createSignal(false)
  const [railHovered, setRailHovered] = createSignal(false)
  const hiddenCount = () => (showAll() ? 0 : Math.max(0, done() - RAIL_VISIBLE))
  const visibleHistory = () => (showAll() ? history() : history().slice(-RAIL_VISIBLE))
  const railOffset = () => Math.max(0, done() - visibleHistory().length)
  const max = () => props.goal.loopMaxLoops
  const current = () => Math.max(1, props.goal.loopIteration ?? done() + 1)
  const bar = () => renderBar(done(), max())
  const durations = () => iterationDurations(history(), props.goal.setAt)
  const shares = () => durationShares(durations())
  const shareSuffix = (index: number) => (shares()[index] === undefined ? "" : ` · ${shares()[index]}% of wall`)
  const pace = () => paceEstimate(durations(), max())
  const mixes = () => iterationVerdictMix(props.goal.history ?? [], history(), props.goal.setAt)
  const spark = () => contextSparkline(history())
  const mixSuffix = (index: number) => {
    const mix = mixes()[index]
    return mix ? ` · ${mix.met}✓ ${mix.not_met}✗${mix.impossible > 0 ? ` ${mix.impossible}⊘` : ""}` : ""
  }
  const endedSuffix = (entry: { endedAt: number }) => ` · ended ${relativeTime(entry.endedAt, nowMs())} at ${localTime(entry.endedAt)}`
  const paused = () => props.goal.status === "paused"
  const stateWord = () => {
    const s = props.goal.status
    if (s === "paused") return "paused"
    if (s !== "active") return s
    return props.goal.evaluating ? "checking" : props.goal.waiting ? "waiting" : "active"
  }
  const nowMs = () => props.nowMs?.() ?? Date.now()
  const iterVerdict = () => currentIterationVerdict(props.goal.history ?? [], history(), props.goal.setAt)
  const turnsSince = () => {
    const v = iterVerdict()
    return v ? turnsSinceVerdict(props.goal.turns, v.turn) : 0
  }
  const streakSuffix = () => {
    const s = verdictStreak(props.goal.history ?? [])
    return s.count >= 2 && s.verdict ? ` · ${s.count}× ${s.verdict.replace("_", " ")} in a row` : ""
  }
  const isTerminal = () => props.goal.status === "achieved" || props.goal.status === "impossible" || props.goal.status === "cleared" || props.goal.status === "failed"
  const capReached = () => {
    const limit = max()
    return typeof limit === "number" && Number.isFinite(limit) && done() >= limit
  }
  const livePace = () => (isTerminal() ? undefined : pace())
  const finished = () => history().length > 0 && (isTerminal() || capReached())
  const totals = () => loopTotals(history(), props.goal.setAt)
  const finalGlyph = () => (props.goal.status === "achieved" ? "✓" : props.goal.status === "impossible" ? "⊘" : "✗")
  const finalColor = () => mono()
    ? (props.goal.status === "achieved" || props.goal.status === "impossible" ? theme().text.base : theme().text.faint)
    : (props.goal.status === "achieved" ? theme().text.feedback.info.base : props.goal.status === "impossible" ? theme().text.feedback.warning.base : theme().text.faint)
  const nowColor = () => {
    const s = props.goal.status
    if (mono()) return s === "paused" || s === "impossible" || s === "active" ? theme().text.base : theme().text.faint
    if (s === "paused" || s === "impossible") return theme().text.feedback.warning.base
    if (s === "active") return theme().text.feedback.info.base
    return theme().text.faint
  }
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
          <text wrapMode="none" fg={mono() ? theme().text.base : theme().text.feedback.info.base}>
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
      <Show when={livePace()}>
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
      {/* boundary compaction: asked of the host at the last arm; awaits the host's safe point */}
      <Show when={props.goal.loopCompact}>
        {(compact) => {
          const c = compact()
          const pending = () => c.landedAt === undefined
          const age = () => formatDuration(nowMs() - (c.landedAt ?? c.requestedAt))
          return (
            <box flexDirection="row" gap={2}>
              {label(theme(), "compact")}
              <text wrapMode="none" fg={mono() ? theme().text.base : pending() ? theme().text.feedback.warning.base : theme().text.feedback.info.base}>
                {pending()
                  ? `pending ${age()} · miss ${c.misses}/${COMPACT_MISS_CAP}${c.estimatedTokens !== undefined ? ` · ~${formatTokens(c.estimatedTokens)} at request` : ""}`
                  : `landed ${age()} ago`}
              </text>
            </box>
          )
        }}
      </Show>
      {/* per-iteration context size at arm: each bar is the boundary-compaction estimate measured when that iteration was armed, oldest → newest; a `·` gap marks an unmeasurable arm. Omitted entirely when no entry carries an estimate. */}
      <Show when={spark()}>
        {(s) => (
          <box flexDirection="row" gap={2}>
            {label(theme(), "context")}
            <text wrapMode="none" flexShrink={0} fg={theme().text.base}>
              {s().bars}
            </text>
            <text wrapMode="none" fg={theme().text.faint}>
              {`~${formatTokens(s().peak)} peak · arm sizes, oldest→newest`}
            </text>
          </box>
        )}
      </Show>
      {/* iteration rail: one row per completed iteration, summaries hanging off a │ connector; zero-tool iterations render muted — state inspection only, no work produced. Older iterations fold behind one click so a long loop never buries the live row. */}
      <Show when={done() > RAIL_VISIBLE}>
        <box flexDirection="row" gap={2} onMouseUp={() => setShowAll((v) => !v)} onMouseOver={() => setRailHovered(true)} onMouseOut={() => setRailHovered(false)}>
          <text fg={theme().text.faint} flexShrink={0} width={LABEL}>
            …
          </text>
          <text wrapMode="none" fg={theme().text.faint} attributes={railHovered() ? TextAttributes.UNDERLINE : undefined}>
            {showAll() ? "show recent only" : `${hiddenCount()} older iteration${hiddenCount() === 1 ? "" : "s"} — click to show`}
          </text>
        </box>
      </Show>
      <For each={visibleHistory()}>
        {(entry, index) => {
          const fullIndex = () => railOffset() + index()
          const zeroTools = entry.toolCalls === 0
          const rowColor = zeroTools ? theme().text.faint : theme().text.base
          return (
            <box flexDirection="column">
              <box flexDirection="row" gap={2}>
                {label(theme(), `v${entry.version}`)}
                <text wrapMode="none" flexShrink={0} fg={zeroTools ? theme().text.faint : mono() ? theme().text.base : theme().text.feedback.info.base}>
                  {zeroTools ? "○" : "✓"}
                </text>
                <text wrapMode="word" flexGrow={1} fg={rowColor}>
                  {`met · ${entry.turns} turn${entry.turns === 1 ? "" : "s"} · ${entry.toolCalls} tool${entry.toolCalls === 1 ? "" : "s"} · ${formatDuration(durations()[fullIndex()] ?? 0)}${zeroTools ? " · no tools · inspection only" : ""}${mixSuffix(fullIndex())}${endedSuffix(entry)}${shareSuffix(fullIndex())}`}
                </text>
              </box>
            <Show when={entry.summary.trim().length > 0}>
              <RailSummary theme={theme()} text={entry.summary} onCopy={props.onCopySummary ? (text) => copySummary(text, entry.version) : undefined} copied={() => copiedVersion() === entry.version} />
            </Show>
          </box>
          )
        }}
      </For>
      {/* the running iteration closes the rail */}
      <box flexDirection="row" gap={2}>
        {label(theme(), "now")}
        <text wrapMode="none" flexShrink={0} fg={nowColor()} attributes={TextAttributes.BOLD}>
          ◎
        </text>
        <text wrapMode="word" fg={theme().text.base} flexGrow={1}>
          {`v${current()} · ${stateWord()} · ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"}${paused() ? ` · ${pauseDiagnostics(props.goal.stall, props.goal.retries)}` : ""} · ${formatDurationCoarse(props.elapsedMs())} elapsed${streakSuffix()}`}
        </text>
        <Show when={iterVerdict()}>
          {(entry) => (
            <box flexDirection="row" gap={1} flexShrink={0}>
              <text wrapMode="none" fg={theme().text.muted}>
                · last
              </text>
              <text wrapMode="none" fg={colorFor(theme(), entry().verdict, mono())} attributes={TextAttributes.BOLD}>
                {verdictGlyph(entry().verdict)}
              </text>
              <text wrapMode="none" fg={theme().text.faint}>
                {turnsSince() === 0 ? "this turn" : `${turnsSince()} turn${turnsSince() === 1 ? "" : "s"} since`}
              </text>
            </box>
          )}
        </Show>
      </box>
      {/* final tally: only once the loop is over */}
      <Show when={finished()}>
        <box flexDirection="row" gap={2}>
          {label(theme(), "final")}
          <text wrapMode="none" flexShrink={0} fg={finalColor()} attributes={TextAttributes.BOLD}>
            {finalGlyph()}
          </text>
          <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
            {`loop ${props.goal.status} · ${totals().iterations} iteration${totals().iterations === 1 ? "" : "s"} · ${totals().turns} turns · ${totals().tools} tools · ${formatDurationCoarse(totals().spanMs)} wall`}
          </text>
        </box>
      </Show>
      {/* evaluator verdict trail */}
      <VerdictTrail theme={theme()} history={props.goal.history ?? []} mono={mono()} />
    </box>
  )
}

/** The evaluator verdict trail: ✓ met / ✗ not_met / ⊘ impossible, oldest → newest. Shared by looped and non-looped goals. */
const VerdictTrail = (props: { theme: HistoryTheme; history: readonly VerdictEntry[]; mono?: boolean }): JSX.Element => {
  const mono = () => props.mono === true
  const trail = () => trailWindow(props.history, 24)
  return (
    <Show when={trail().shown.length > 0}>
      <box flexDirection="row" gap={2}>
        {label(props.theme, "trail")}
        <box flexDirection="row" flexShrink={0}>
          <For each={trail().shown}>{(entry) => <text wrapMode="none" fg={colorFor(props.theme, entry.verdict, mono())}>{verdictGlyph(entry.verdict)}</text>}</For>
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
  /** Reduced-color surface (NO_COLOR / TERM=dumb): drop chromatic accents; weight and glyphs carry meaning. */
  mono?: boolean
}): JSX.Element => {
  const theme = () => props.theme
  const mono = () => props.mono === true
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
              <text wrapMode="none" flexShrink={0} fg={colorFor(theme(), entry().verdict, mono())} attributes={TextAttributes.BOLD}>
                {verdictGlyph(entry().verdict)}
              </text>
              <text wrapMode="word" fg={theme().text.base} flexGrow={1}>
                {`last ${entry().verdict.replace("_", " ")} (turn ${entry().turn}) · ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"} · ${countsText()} · ${elapsed()} elapsed${streakSuffix()}`}
              </text>
            </box>
          )}
        </Show>
      </box>
      <VerdictTrail theme={theme()} history={history()} mono={mono()} />
    </box>
  )
}
