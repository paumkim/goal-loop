/**
 * Goal-history rendering for the `/goal` detail dialog: for looped goals a progress bar, a
 * vertical iteration rail (completed iterations + the running one) and the evaluator verdict
 * trail; for non-looped goals a compact history block (last verdict glyph, totals, per-turn
 * verdict counts, elapsed) plus the same trail. Presentational only;
 * every value derives from the live `GoalSnapshot`. Theme tokens only — no borders, no hardcoded
 * RGBA, no absolute positioning. Pure layout math lives in `src/core/history.ts` (unit-tested).
 */
import { TextAttributes, type ColorInput } from "@opentui/core"
import stringWidth from "string-width"
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { JSX } from "@opentui/solid"
import { BAR_CELLS, LABEL, barCaption, contextSparkline, currentIterationVerdict, durationShares, iterationDurations, iterationVerdictMix, lastVerdict, localTime, loopTotals, paceEstimate, relativeTime, pauseDiagnostics, renderBar, trailWindow, turnsSinceVerdict, verdictCounts, verdictEntryGlyph, verdictStreak } from "./core/history.ts"
import { formatCost, formatDuration, formatDurationCoarse, formatTokens, goalGlyph, truncate } from "./core/format.ts"
import { verdictEntryAccentColor, motionDisabled, isRetryStuck } from "./core/hud.ts"
import { finalTallyLine, iterationAttestation } from "./core/attestation.ts"
import { COMPACT_MISS_CAP, completedIterationCount, type GoalSnapshot, type LoopEntry, type Verdict, type VerdictEntry } from "./core/types.ts"
import { Affordance } from "./affordance.tsx"

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
      /** Present on many host themes; optional so minimal test themes fit. Falls back to info (the prior paint). */
      readonly success?: { readonly base: ColorInput }
    }
  }
}

const SUMMARY_MAX = 400
const WHY_LIMIT = 3
const WHY_REASON_MAX = 400
/** Completed-iteration rows kept visible without expanding; older ones fold behind one click. */
const RAIL_VISIBLE = 4

const label = (theme: HistoryTheme, text: string) => (
  <text fg={theme.text.faint} flexShrink={0} width={LABEL}>
    {text}
  </text>
)

const colorFor = (theme: HistoryTheme, entry: { verdict: Verdict; toolCalls?: number }, mono: boolean): ColorInput =>
  verdictEntryAccentColor(theme, entry, mono)

/**
 * One completed iteration's summary line. Click-to-copy when the caller wires `onCopy`:
 * the summary is the payload a user most often wants verbatim (to paste into a prompt or
 * an issue), so the whole line is the click target — an always-mounted affordance cell brightens on hover; the text never changes.
 */
const RailSummary = (props: { theme: HistoryTheme; text: string; onCopy?: (text: string) => void; copied?: () => boolean; ascii?: () => boolean; mono?: () => boolean }): JSX.Element => {
  const ascii = () => (props.ascii?.() === true) || motionDisabled(process.env)
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
    <box flexDirection="row" gap={2} onMouseUp={props.onCopy ? (event) => { if (event.button !== 0) return; event.stopPropagation(); copy() } : undefined} onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}>
      <text fg={props.theme.text.faint} flexShrink={0} width={LABEL}>
        {ascii() ? "|" : "│"}
      </text>
      <text wrapMode="word" fg={props.theme.text.faint} flexGrow={1}>
        {`${ascii() ? "|" : "│"} ${truncate(props.text, SUMMARY_MAX, ascii() ? "..." : "\u2026")}`}
      </text>
      {props.onCopy ? <Affordance theme={props.theme} mono={props.mono ?? (() => false)} verb="copy" hovered={hovered()} ack={props.copied?.() ? (ascii() ? "+ copied" : "✓ copied") : null} /> : null}
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
  /** When set, clicking a summary line copies that iteration's full summary. The line carries an always-mounted affordance cell. */
  onCopySummary?: (summary: string, version: number) => void
  /** When set, clicking a why-ledger row copies that verdict's raw reason. The reason carries an always-mounted affordance cell. */
  onCopyReason?: (reason: string) => void
  /** Controlled expand state for the iteration rail's fold row (the status dialog drives this from its keymap layer so keyboard users can expand). Uncontrolled when absent. */
  expanded?: () => boolean
  /** Fired on fold-row activation. Pair with `expanded` for controlled mode. */
  onToggleExpanded?: () => void
  /** When set, clicking a rail iteration row copies that iteration's attestation line (the receipt: `v3 · met · 9 turns · 41 tools · … · sha · cost`). An always-mounted affordance cell marks the row. */
  onCopyAttestation?: (line: string) => void
  /** When set, clicking the final tally row (painted once the loop is over) copies the tally line verbatim. An always-mounted affordance cell marks the row. */
  onCopyTally?: (line: string) => void
  /** Applied to the root box. The dialog passes -1 to cancel the one-row gap the content column leaves above the section (the gap stays 1 — only this box pulls up). */
  marginTop?: number
}): JSX.Element => {
  const theme = () => props.theme
  const mono = () => props.mono === true
  // ASCII demotion for dumb terminals (NO_COLOR / TERM=dumb — the same predicate as reduced motion): bar and sparkline glyphs become ink-density ASCII, never broken boxes. Evaluated once per mount.
  const ascii = () => motionDisabled(process.env) || mono()
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
  // Total landed (cap-aware) drives the bar/caption/capReached; the retained slice drives the rail.
  const done = () => completedIterationCount(props.goal)
  const retained = () => history().length
  const dropped = () => props.goal.loopHistoryDropped ?? 0
  // Progressive disclosure: at most RAIL_VISIBLE completed iterations render; the rest fold behind one click.
  // Controlled when the caller passes `expanded` (the status dialog drives it from its keymap layer so
  // keyboard parity holds without stealing focus); uncontrolled otherwise (snapshots/tests).
  const [localShowAll, setLocalShowAll] = createSignal(false)
  const showAll = () => props.expanded?.() ?? localShowAll()
  const toggleShowAll = () => { if (props.onToggleExpanded) { props.onToggleExpanded(); return } setLocalShowAll((v) => !v) }
  // The attestation/tally click targets: an always-mounted affordance cell marks the row (weight, the NO_COLOR contract), a click copies the
  // row's own quotable payload, and the acknowledgment rides the row for a beat — the grammar the summary
  // copy established. Resting paint is byte-identical to the pre-click frame.
  const [attestHover, setAttestHover] = createSignal<number | null>(null)
  const [railFoldHovered, setRailFoldHovered] = createSignal(false)
  const [attestCopied, setAttestCopied] = createSignal<number | null>(null)
  const [tallyHover, setTallyHover] = createSignal(false)
  const [tallyCopied, setTallyCopied] = createSignal(false)
  let quoteTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (quoteTimer) clearTimeout(quoteTimer)
  })
  const ackQuote = (arm: () => void) => {
    arm()
    if (quoteTimer) clearTimeout(quoteTimer)
    quoteTimer = setTimeout(() => {
      setAttestCopied(null)
      setTallyCopied(false)
    }, 1600)
  }
  const copyAttestation = (entry: LoopEntry, durationMs: number) => {
    if (!props.onCopyAttestation) return
    try {
      props.onCopyAttestation(iterationAttestation(entry, durationMs))
      ackQuote(() => setAttestCopied(entry.version))
    } catch {
      // Best-effort.
    }
  }
  const copyTally = (line: string) => {
    if (!props.onCopyTally) return
    try {
      props.onCopyTally(line)
      ackQuote(() => setTallyCopied(true))
    } catch {
      // Best-effort.
    }
  }
  const hiddenCount = () => (showAll() ? 0 : Math.max(0, retained() - RAIL_VISIBLE))
  const visibleHistory = () => (showAll() ? history() : history().slice(-RAIL_VISIBLE))
  const railOffset = () => Math.max(0, retained() - visibleHistory().length)
  const max = () => props.goal.loopMaxLoops
  const current = () => Math.max(1, props.goal.loopIteration ?? done() + 1)
  const bar = () => renderBar(done(), max(), BAR_CELLS, ascii())
  const filledBarText = () => bar().text.slice(0, bar().filled)
  const emptyBarText = () => bar().text.slice(bar().filled)
  const durations = () => iterationDurations(history(), props.goal.setAt)
  const shares = () => durationShares(durations())
  const shareSuffix = (index: number) => (shares()[index] === undefined ? "" : ` · ${shares()[index]}% of wall`)
  const pace = () => paceEstimate(durations(), max())
  // Scoped memo (solid-js) keyed on the same snapshot refs the render invalidates on — replaces the module-global single-slot cache; lifetime is this mount, not the process.
  const mixes = createMemo(() => iterationVerdictMix(props.goal.history ?? [], history(), props.goal.setAt))
  const spark = () => contextSparkline(history(), ascii())
  const mixSuffix = (index: number) => {
    const mix = mixes()[index]
    if (!mix) return ""
    return ascii() ? ` · ${mix.met}+ ${mix.not_met}x${mix.impossible > 0 ? ` ${mix.impossible}!` : ""}` : ` · ${mix.met}✓ ${mix.not_met}✗${mix.impossible > 0 ? ` ${mix.impossible}⊘` : ""}`
  }
  const endedSuffix = (entry: { endedAt: number }) => ` · ended ${relativeTime(entry.endedAt, nowMs())} at ${localTime(entry.endedAt)}`
  const paused = () => props.goal.status === "paused"
  const stateWord = () => {
    const s = props.goal.status
    if (s === "paused") return "paused"
    if (s !== "active") return s
    return props.goal.evaluating ? "checking" : props.goal.waiting ? "waiting" : props.goal.queued ? "queued" : isRetryStuck(props.goal) ? "stuck" : "active"
  }
  const nowMs = () => props.nowMs?.() ?? Date.now()
  const iterVerdict = () => currentIterationVerdict(props.goal.history ?? [], history(), props.goal.setAt)
  const turnsSince = () => {
    const v = iterVerdict()
    return v ? turnsSinceVerdict(props.goal.turns, v.turn) : 0
  }
  const streakSuffix = () => {
    const s = verdictStreak(props.goal.history ?? [])
    return s.count >= 2 && s.verdict ? ` · ${s.count}x ${s.verdict.replace("_", " ")} in a row` : ""
  }
  const isTerminal = () => props.goal.status === "achieved" || props.goal.status === "impossible" || props.goal.status === "cleared" || props.goal.status === "failed"
  const capReached = () => {
    const limit = max()
    return typeof limit === "number" && Number.isFinite(limit) && done() >= limit
  }
  const livePace = () => (isTerminal() ? undefined : pace())
  const finished = () => history().length > 0 && (isTerminal() || capReached())
  const totals = () => loopTotals(history(), props.goal.setAt)
  // The final tally line — paint and clipboard quote are the same string from the attestation module.
  const finalGlyph = () => ascii() ? (props.goal.status === "achieved" ? "+" : props.goal.status === "impossible" ? "!" : "x") : (props.goal.status === "achieved" ? "✓" : props.goal.status === "impossible" ? "⊘" : "✗")
  const finalColor = () => mono()
    ? (props.goal.status === "achieved" || props.goal.status === "impossible" ? theme().text.base : theme().text.faint)
    : (props.goal.status === "achieved" ? theme().text.feedback.info.base : props.goal.status === "impossible" ? theme().text.feedback.warning.base : theme().text.faint)
  const nowColor = () => {
    const s = props.goal.status
    if (mono()) return s === "paused" || s === "impossible" || s === "active" ? theme().text.base : theme().text.faint
    if (s === "paused" || s === "impossible") return theme().text.feedback.warning.base
    if (s === "active") return isRetryStuck(props.goal) ? theme().text.feedback.warning.base : theme().text.feedback.info.base
    return theme().text.faint
  }
  return (
    <box flexDirection="column" gap={0} marginTop={props.marginTop}>
      {/* progress: vN of at most M, followed inline by the block bar */}
      <box flexDirection="row" gap={2}>
        {label(theme(), "loop")}
        <text wrapMode="none" fg={theme().text.base} attributes={TextAttributes.BOLD}>
          {barCaption(current(), max(), done())}
        </text>
        <box flexDirection="row" flexShrink={0}>
        <Show when={bar().filled > 0}>
          <text wrapMode="none" fg={mono() ? theme().text.base : theme().text.feedback.info.base}>
            {filledBarText()}
          </text>
        </Show>
        <Show when={BAR_CELLS - bar().filled > 0}>
          <text wrapMode="none" fg={theme().text.faint}>
            {emptyBarText()}
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
              {`~${formatTokens(s().peak)} peak · arm sizes, oldest${ascii() ? "->" : "→"}newest`}
            </text>
          </box>
        )}
      </Show>
      {/* iteration rail: one row per completed iteration, summaries hanging off a │ connector; a met iteration with zero tool calls produced no work — the evaluator found the condition already satisfied at HEAD — so it paints the blue accent (info.base, the palette's info hue; mono keeps the ○ shape as the signal) with the 'already satisfied at HEAD' tag. Older iterations fold behind one click so a long loop never buries the live row. */}
      <Show when={dropped() > 0}>
        <box flexDirection="row" gap={2}>
          <text fg={theme().text.faint} flexShrink={0} width={LABEL}>
            {ascii() ? "..." : "…"}
          </text>
          <text wrapMode="none" fg={theme().text.faint}>
            {`${dropped()} older iteration${dropped() === 1 ? "" : "s"} dropped from the record (retention cap)`}
          </text>
        </box>
      </Show>
      <Show when={retained() > RAIL_VISIBLE}>
        {/* fold row — same grammar as the elsewhere fold in the dialog: one clickable cell + an always-mounted affordance, the retention-drop notice above stays inert (a plain row with no button and no cell, so the two never read as the same control) */}
        <box flexDirection="row" gap={2} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); toggleShowAll() }} onMouseOver={() => setRailFoldHovered(true)} onMouseOut={() => setRailFoldHovered(false)}>
          <text fg={theme().text.faint} flexShrink={0} width={LABEL}>
            {ascii() ? "..." : "…"}
          </text>
          <text wrapMode="none" fg={theme().text.faint}>
            {showAll() ? "show recent only" : `${hiddenCount()} older iteration${hiddenCount() === 1 ? "" : "s"} · click or press x`}
          </text>
          <Affordance theme={theme()} mono={mono} verb="click · x" hovered={railFoldHovered()} width={9} />
        </box>
      </Show>
      <For each={visibleHistory()}>
        {(entry, index) => {
          const fullIndex = () => railOffset() + index()
          // satisfied-at-HEAD: met with zero tool calls — the evaluator found the condition already holding at HEAD. Blue accent (info.base); mono drops the hue and keeps the hollow ○.
          const zeroTools = entry.toolCalls === 0
          const rowColor = zeroTools ? (mono() ? theme().text.base : theme().text.muted) : theme().text.base
          const attestDuration = durations()[fullIndex()] ?? 0
          const attestInteractive = props.onCopyAttestation !== undefined
          const attestHovered = attestHover() === entry.version
          return (
            <box flexDirection="column">
              <box flexDirection="row" gap={2} onMouseUp={attestInteractive ? (event) => { if (event.button !== 0) return; event.stopPropagation(); copyAttestation(entry, attestDuration) } : undefined} onMouseOver={attestInteractive ? () => setAttestHover(entry.version) : undefined} onMouseOut={attestInteractive ? () => setAttestHover(null) : undefined}>
                {label(theme(), `v${entry.version}`)}
                <text wrapMode="none" flexShrink={0} fg={verdictEntryAccentColor(theme(), { verdict: "met", toolCalls: entry.toolCalls }, mono())}>
                  {zeroTools ? (ascii() ? "." : "○") : (ascii() ? "+" : "✓")}
                </text>
                <text wrapMode="word" flexGrow={1} fg={rowColor}>
                  {`met · ${entry.turns} turn${entry.turns === 1 ? "" : "s"} · ${entry.toolCalls} tool${entry.toolCalls === 1 ? "" : "s"} · ${formatDuration(attestDuration)}${zeroTools ? " · no tools · already satisfied at HEAD" : ""}${mixSuffix(fullIndex())}${endedSuffix(entry)}${shareSuffix(fullIndex())}${shaSuffix(entry)}${spendSuffix(entry)}`}
                </text>
                {attestInteractive ? <Affordance theme={theme()} mono={mono} verb="copy" hovered={attestHovered} ack={attestCopied() === entry.version ? (ascii() ? "+ copied" : "✓ copied") : null} /> : null}
              </box>
            <Show when={entry.summary.trim().length > 0}>
              <RailSummary theme={theme()} text={entry.summary} onCopy={props.onCopySummary ? (text) => copySummary(text, entry.version) : undefined} copied={() => copiedVersion() === entry.version} ascii={ascii} mono={mono} />
            </Show>
          </box>
          )
        }}
      </For>
      {/* the running iteration closes the rail — retired once finished(): a terminal status or an exhausted cap means there is no current iteration, and a live-style row above the final tally would paint in-progress fiction (turns elapsed, running streak, "this turn") about a loop that can no longer advance */}
      <Show when={!finished()}>
      <box flexDirection="row" gap={2}>
        {label(theme(), "now")}
        <text wrapMode="none" flexShrink={0} fg={nowColor()} attributes={TextAttributes.BOLD}>
          {goalGlyph(ascii())}
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
              <text wrapMode="none" fg={colorFor(theme(), entry(), mono())} attributes={TextAttributes.BOLD}>
                {verdictEntryGlyph(entry(), ascii())}
              </text>
              <text wrapMode="none" fg={theme().text.faint}>
                {turnsSince() === 0 ? "this turn" : `${turnsSince()} turn${turnsSince() === 1 ? "" : "s"} since`}
              </text>
            </box>
          )}
        </Show>
      </box>
      </Show>
      {/* final tally: only once the loop is over — one click quotes the line whole; the paint and the copy are the same string (finalTallyLine) */}
      <Show when={finished()}>
        <box flexDirection="row" gap={2} onMouseUp={props.onCopyTally ? (event) => { if (event.button !== 0) return; event.stopPropagation(); copyTally(finalTallyLine(props.goal.status, totals())) } : undefined} onMouseOver={props.onCopyTally ? () => setTallyHover(true) : undefined} onMouseOut={props.onCopyTally ? () => setTallyHover(false) : undefined}>
          {label(theme(), "final")}
          <text wrapMode="none" flexShrink={0} fg={finalColor()} attributes={TextAttributes.BOLD}>
            {finalGlyph()}
          </text>
          <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
            {finalTallyLine(props.goal.status, totals())}
          </text>
          {props.onCopyTally ? <Affordance theme={theme()} mono={mono} verb="copy" hovered={tallyHover()} ack={tallyCopied() ? (ascii() ? "+ copied" : "✓ copied") : null} /> : null}
        </box>
      </Show>
      {/* evaluator verdict trail */}
      <VerdictTrail theme={theme()} history={props.goal.history ?? []} mono={mono()} ascii={ascii} onCopyReason={props.onCopyReason} nowMs={nowMs} dropped={props.goal.historyDropped} />
    </box>
  )
}

/** The evaluator verdict trail: ✓ met / ✗ not_met / ⊘ impossible, oldest → newest. Shared by looped and non-looped goals. */
// Spend attribution, one grammar everywhere: the loop rail stamps the arm→advance delta on each completed iteration; the why ledger stamps the per-turn delta on each verdict. Render the cost only. Omitted when the host could not measure (or the turn cost nothing).
const spendSuffix = (entry: { spend?: { readonly cost: number } }) => (entry.spend && entry.spend.cost > 0 ? ` · ${formatCost(entry.spend.cost)}` : "")
const shaSuffix = (entry: { sha?: string }) => (entry.sha ? ` · ${entry.sha.slice(0, 7)}` : "")

/**
 * The why ledger: at most the three most recent verdicts whose reason text is non-empty,
 * oldest first (the trail's own direction). One row per verdict — glyph, verdict word,
 * turn, relative time, the commit sha the verdict landed on (when the host stamped one),
 * reason — the evaluator's *why* at a glance, without scrolling the
 * dialog to the last evaluator row. Click-to-copy when the caller wires onCopyReason;
 * an always-mounted affordance cell advertises the row (the grammar shared with the condition/summary/
 * reason rows). The copied acknowledgment rides the row for a beat, like every other row.
 */
const WhyLedger = (props: {
  theme: HistoryTheme
  history: readonly VerdictEntry[]
  mono?: boolean
  ascii?: () => boolean
  onCopyReason?: (reason: string) => void
  nowMs?: () => number
}): JSX.Element => {
  const theme = () => props.theme
  const mono = () => props.mono === true
  const ascii = () => (props.ascii?.() === true) || motionDisabled(process.env)
  const [hovered, setHovered] = createSignal<number | null>(null)
  const [copied, setCopied] = createSignal<number | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  const copy = (entry: VerdictEntry) => {
    if (!props.onCopyReason) return
    try {
      props.onCopyReason(entry.reason)
      setCopied(entry.at)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setCopied(null), 1600)
    } catch {
      // Best-effort.
    }
  }
  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })
  const rows = () => props.history.filter((entry) => entry.reason.trim().length > 0).slice(-WHY_LIMIT)
  const now = () => props.nowMs?.() ?? Date.now()
  const furniture = (entry: VerdictEntry) => `${entry.verdict.replace("_", " ")} · turn ${entry.turn} · ${relativeTime(entry.at, now())}${shaSuffix(entry)}${spendSuffix(entry)}`
  // The reason column hangs off the end of the muted furniture; verdict word, turn digits and relative time vary across rows, which used to shift the reason. Pin the furniture cell to the widest visible row (stringWidth — the row carries multibyte glyphs) so reasons land on one x.
  const furnitureWidth = () => rows().reduce((max, entry) => Math.max(max, stringWidth(furniture(entry))), 0)
  return (
    <Show when={rows().length > 0}>
      <For each={rows()}>
        {(entry, index) => {
          const interactive = props.onCopyReason !== undefined
          return (
            <box flexDirection="row" gap={2} onMouseUp={interactive ? (event) => { if (event.button !== 0) return; event.stopPropagation(); copy(entry) } : undefined} onMouseOver={interactive ? () => setHovered(entry.at) : undefined} onMouseOut={interactive ? () => setHovered(null) : undefined}>
              {label(theme(), index() === 0 ? "why" : "")}
              <text wrapMode="none" flexShrink={0} fg={colorFor(theme(), entry, mono())} attributes={TextAttributes.BOLD}>
                {verdictEntryGlyph(entry, ascii())}
              </text>
              <text wrapMode="none" flexShrink={0} fg={theme().text.muted} width={furnitureWidth()}>
                {furniture(entry)}
              </text>
              <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
                {truncate(entry.reason, WHY_REASON_MAX, ascii() ? "..." : "\u2026")}
              </text>
              {interactive ? <Affordance theme={theme()} mono={mono} verb="copy" hovered={hovered() === entry.at} ack={copied() === entry.at ? (ascii() ? "+ copied" : "✓ copied") : null} /> : null}
            </box>
          )
        }}
      </For>
    </Show>
  )
}

const VerdictTrail = (props: { theme: HistoryTheme; history: readonly VerdictEntry[]; mono?: boolean; ascii?: () => boolean; onCopyReason?: (reason: string) => void; nowMs?: () => number; dropped?: number }): JSX.Element => {
  const mono = () => props.mono === true
  const ascii = () => (props.ascii?.() === true) || motionDisabled(process.env)
  // Retention cap: when earlier verdicts were dropped from the record, the trail is a window, not the whole story — the caption says so.
  const dropped = () => props.dropped ?? 0
  const trail = () => trailWindow(props.history, 24)
  const total = () => trail().total + dropped()
  // The timeline is a control, not a picture: clicking a dot copies that turn's exact evaluator
  // reason. The why ledger inline-quotes only the last three reasons; this is the deep scrub
  // surface for the rest. Dots without a reason (or without the host wiring) stay inert pictures.
  // The frame is byte-identical at rest and under the mouse — no hover tag, no weight swap; the
  // click ack rides the trail line, transient, right of the verdict count.
  const [copiedTurn, setCopiedTurn] = createSignal<number | null>(null)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (copiedTimer) clearTimeout(copiedTimer)
  })
  const interactive = () => props.onCopyReason !== undefined
  const copyAt = (entry: VerdictEntry) => {
    if (!props.onCopyReason || entry.reason.trim().length === 0) return
    try {
      props.onCopyReason(entry.reason)
      setCopiedTurn(entry.turn)
      if (copiedTimer) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => setCopiedTurn(null), 1600)
    } catch {
      // Best-effort.
    }
  }
  const copyHint = (entry: VerdictEntry): boolean => entry.reason.trim().length > 0
  return (
    <Show when={trail().shown.length > 0}>
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={2}>
          {label(props.theme, "trail")}
          <box flexDirection="row" flexShrink={0}>
            <For each={trail().shown}>{(entry) => {
              const copyable = interactive() && copyHint(entry)
              return (
                <box flexDirection="row" onMouseUp={copyable ? (event) => { if (event.button !== 0) return; event.stopPropagation(); copyAt(entry) } : undefined}>
                  <text wrapMode="none" fg={colorFor(props.theme, entry, mono())}>{verdictEntryGlyph(entry, ascii())}</text>
                </box>
              )
            }}</For>
          </box>
          <text wrapMode="none" fg={props.theme.text.muted} flexShrink={0}>
            {" "}
            {trail().shown.length} of {total()} verdict{total() === 1 ? "" : "s"}{dropped() > 0 ? ` · ${dropped()} older dropped (retention cap)` : ""}
            {(() => {
              const t = copiedTurn()
              return t === null ? "" : (ascii() ? ` · turn ${t} · + copied` : ` · turn ${t} · ✓ copied`)
            })()}
          </text>
        </box>
        <WhyLedger theme={props.theme} history={props.history} mono={props.mono} ascii={props.ascii} onCopyReason={props.onCopyReason} nowMs={props.nowMs} />
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
  /** Reference clock for the relative-time labels in the why ledger. Getter form so it stays reactive; defaults to Date.now(). */
  nowMs?: () => number
  /** Reduced-color surface (NO_COLOR / TERM=dumb): drop chromatic accents; weight and glyphs carry meaning. */
  mono?: boolean
  /** When set, clicking a why-ledger row copies that verdict's raw reason. The reason carries an always-mounted affordance cell. */
  onCopyReason?: (reason: string) => void
  /** Applied to the root box. The dialog passes -1 to cancel the one-row gap the content column leaves above the section (the gap stays 1 — only this box pulls up). */
  marginTop?: number
}): JSX.Element => {
  const theme = () => props.theme
  const mono = () => props.mono === true
  const nowMs = () => props.nowMs?.() ?? Date.now()
  const ascii = () => motionDisabled(process.env) || mono()
  const history = () => props.goal.history ?? []
  const counts = () => verdictCounts(history())
  const last = () => lastVerdict(history())
  const streak = () => verdictStreak(history())
  const streakSuffix = () => {
    const s = streak()
    // Retention cap: when the whole retained window is one verdict and older entries were dropped, the streak is a lower bound, not an exact count.
    const lowerBound = (props.goal.historyDropped ?? 0) > 0 && s.count >= history().length
    return s.count >= 2 && s.verdict ? ` · ${lowerBound ? "at least " : ""}${s.count}x ${s.verdict.replace("_", " ")} in a row` : ""
  }
  const elapsed = () => formatDurationCoarse(props.elapsedMs())
  const countsText = () => {
    const c = counts()
    const parts = [`${c.met} met`, `${c.not_met} not_met`]
    if (c.impossible > 0) parts.push(`${c.impossible} impossible`)
    if ((props.goal.historyDropped ?? 0) > 0) parts.push("retained turns only")
    return parts.join(" · ")
  }
  return (
    <box flexDirection="column" gap={0} marginTop={props.marginTop}>
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
              <text wrapMode="none" flexShrink={0} fg={colorFor(theme(), entry(), mono())} attributes={TextAttributes.BOLD}>
                {verdictEntryGlyph(entry(), ascii())}
              </text>
              <text wrapMode="word" fg={theme().text.base} flexGrow={1}>
                {`last ${entry().verdict.replace("_", " ")} (turn ${entry().turn}) · ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"} · ${countsText()} · ${elapsed()} elapsed${streakSuffix()}`}
              </text>
            </box>
          )}
        </Show>
      </box>
      <VerdictTrail theme={theme()} history={history()} mono={mono()} ascii={ascii} onCopyReason={props.onCopyReason} nowMs={nowMs} dropped={props.goal.historyDropped} />
    </box>
  )
}
