/**
 * The `/goal` detail dialog body, extracted so it renders headlessly (scripts/render-dialog.tsx) and stays
 * verifiable without a live TUI. The host owns all chrome (dialog frame, backdrop, Esc) — this is just the
 * content: state line, wrapped condition/evaluator/spend rows, and the history sections. Everything is
 * presentational, rendered from the live snapshot passed in by the caller; theme tokens only.
 */
import { For, Show, createSignal, onCleanup } from "solid-js"
import type { JSX } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { formatDurationCoarse, formatSpend, formatTokens, truncate } from "./core/format.ts"
import { remediationFor, stateAccentColor, fixAccentColor, evaluatorHint, motionDisabled } from "./core/hud.ts"
import { contextMeter, CONTEXT_BAR_CELLS, relativeTime } from "./core/history.ts"
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
  /** When set, clicking the evaluator/reason row copies the raw reason. The row boldens on hover to advertise it (same pattern as the condition row). */
  onCopyReason?: (reason: string) => void
  /** When set, clicking an iteration summary line in the loop rail copies the full summary (the line boldens on hover). */
  onCopySummary?: (summary: string, version: number) => void
  /** When set, clicking the verification section copies the gate's output tail (the raw verifier output, click-to-copy). The section boldens on hover. */
  onCopyVerify?: (tail: string) => void
  /** When set, hovering an "elsewhere" row reveals a `→ transcript` affordance and a left-click asks the host to open that session's transcript route (ui.router.navigate). Read-only chrome — switching sessions stays the host's business. */
  onViewTranscript?: (sessionID: string) => void
  /** Controlled expand state for the iteration rail's fold row (driven by the dialog's keymap layer for keyboard parity). Uncontrolled when absent. */
  expanded?: () => boolean
  /** Fired on fold-row activation. Pair with `expanded`. */
  onToggleExpanded?: () => void
  /** When set and returning true, renders a faint "snapshot unavailable" line above the body — the dialog opened from fallback/stale cache because the live get-RPC failed. */
  noticeStale?: () => boolean
  /** Other sessions in this directory holding live goals (active/paused), excluding the session under dialog. Read-only awareness; the host owns session switching. Omitted/empty renders no rows. */
  others?: readonly GoalSnapshot[]
  /** Maps a session ID to its dialog-safe label (the mount passes the session slug when the host knows it). Falls back to the id suffix. */
  sessionLabel?: (sessionID: string) => string
}): JSX.Element => {
  const theme = () => props.theme
  // ASCII demotion for dumb terminals (NO_COLOR / TERM=dumb): the context meter becomes ink-density ASCII. Evaluated once per mount.
  const ascii = motionDisabled(process.env) || props.mono === true
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
  // elsewhere — live goals held by other sessions in this directory. Switching sessions is the host's
  // business, so with no handler rows paint inert and carry no key chords; when the host wires
  // onViewTranscript a left-click asks the host's router to open that session's transcript route and
  // the condition boldens on hover (keyboard focus stays with the host prompt). Live means the same
  // predicate the controller and the store use (active | paused) — failed/cleared are terminal, never listed.
  const OTHERS_VISIBLE = 4
  const OTHERS_CONDITION_MAX = 34
  const OTHERS_TAG_MAX = 12
  const sessionTag = (sessionID: string): string => {
    const label = props.sessionLabel?.(sessionID) ?? sessionID
    return label.length > OTHERS_TAG_MAX ? `${label.slice(0, OTHERS_TAG_MAX - 1)}…` : label
  }
  const othersLive = () => {
    const own = g()?.sessionID
    const rows = (props.others ?? []).filter((o) => (o.status === "active" || o.status === "paused") && o.sessionID !== own)
    return rows.length > 0 ? rows : undefined
  }
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
  const copiedSuffix = (key: string) => (copied() === key ? (ascii ? " + copied" : " ✓ copied") : "")
  const [reasonHovered, setReasonHovered] = createSignal(false)
  const [conditionHovered, setConditionHovered] = createSignal(false)
  const [verifyHovered, setVerifyHovered] = createSignal(false)
  const [othersHovered, setOthersHovered] = createSignal<string | null>(null)
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
  const copyVerify = (tail: string, command: string) => {
    if (!props.onCopyVerify) return
    try {
      props.onCopyVerify(tail || command)
      acknowledge("verify")
    } catch {
      // Best-effort.
    }
  }
  return (
    <box flexDirection="column" gap={1}>
      <Show when={props.noticeStale?.()}>
        <text wrapMode="word" fg={theme().text.faint}>{"snapshot unavailable - showing last known state"}</text>
      </Show>
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
            <text wrapMode="word" fg={theme().text.base} flexGrow={1} attributes={conditionHovered() ? TextAttributes.BOLD : undefined}>
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
                  <text wrapMode="word" fg={theme().text.base} flexGrow={1} attributes={reasonHovered() ? TextAttributes.BOLD : undefined}>
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
          {/* verification gate — the last `evaluator.verifyCommand` run and the output it produced; the met verdict was held to this command. Click to copy the tail (host wires clipboard + toast via onCopyVerify) */}
          <Show when={goal().lastVerify}>
            {(verify) => {
              const ok = () => verify().code === 0
              const glyph = () => (ok() ? (ascii ? "+" : "\u2713") : ascii ? "x" : "\u2717")
              const outcome = () => (ok() ? "exit 0" : verify().timedOut ? "timed out" : `exit ${verify().code ?? "unknown"}`)
              const glyphColor = () => (mono() ? theme().text.base : ok() ? theme().text.feedback.info.base : theme().text.feedback.warning.base)
              const inner = () => (
                <box flexDirection="column" flexGrow={1}>
                  <box flexDirection="row" gap={1}>
                    <text wrapMode="none" fg={mono() ? theme().text.base : theme().text.faint}>$</text>
                    <text wrapMode="word" flexGrow={1} fg={theme().text.base} attributes={verifyHovered() ? TextAttributes.BOLD : undefined}>
                      {verify().command}{copiedSuffix("verify")}
                    </text>
                  </box>
                  <box flexDirection="row" gap={1}>
                    <text wrapMode="none" fg={glyphColor()}>{glyph()}</text>
                    <text wrapMode="none" flexShrink={0} fg={theme().text.muted}>
                      {`${outcome()} · ${relativeTime(verify().at, props.nowMs())}`}
                    </text>
                  </box>
                  <Show when={verify().tail}>
                    {(t) => (
                      <text wrapMode="word" fg={theme().text.faint}>
                        {t()}
                      </text>
                    )}
                  </Show>
                </box>
              )
              return (
                <Show
                  when={props.onCopyVerify}
                  fallback={<box flexDirection="row" gap={2}>{label("verify")}{inner()}</box>}
                >
                  <box flexDirection="row" gap={2} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); copyVerify(verify().tail ?? "", verify().command) }} onMouseOver={() => setVerifyHovered(true)} onMouseOut={() => setVerifyHovered(false)}>
                    {label("verify")}
                    {inner()}
                    <Show when={verifyHovered()}>
                      <text wrapMode="none" flexShrink={0} fg={theme().text.faint}>copy</text>
                    </Show>
                  </box>
                </Show>
              )
            }}
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
            <LoopSection goal={goal()} theme={theme()} elapsedMs={props.elapsedMs} nowMs={props.nowMs} mono={mono()} onCopySummary={props.onCopySummary} onCopyReason={props.onCopyReason} expanded={props.expanded} onToggleExpanded={props.onToggleExpanded} />
          </Show>
          <Show when={!goal().loopEnabled}>
            <HistoryBlock goal={goal()} theme={theme()} elapsedMs={props.elapsedMs} nowMs={props.nowMs} mono={mono()} onCopyReason={props.onCopyReason} />
          </Show>
          {/* elsewhere — live goals held by OTHER sessions in this directory; read-only awareness, the host owns session switching, so rows carry no handlers */}
          <Show when={othersLive()}>
            {(rows) => (
              <box flexDirection="column">
                <box flexDirection="row" gap={2}>
                  {label("elsewhere")}
                  <text fg={theme().text.faint} wrapMode="none">
                    {`${rows().length} other session${rows().length === 1 ? "" : "s"} holding live goals${props.onViewTranscript ? " · hover a row to open its transcript" : ""}`}
                  </text>
                </box>
                <For each={rows().slice(0, OTHERS_VISIBLE)}>
                  {(other) => {
                    const jump = props.onViewTranscript
                    const hovered = () => othersHovered() === other.sessionID
                    return (
                    <box flexDirection="row" gap={2} onMouseUp={jump ? (event) => { if (event.button !== 0) return; event.stopPropagation(); try { jump(other.sessionID) } catch { /* the host discarded the navigation — nothing to undo */ } } : undefined} onMouseOver={jump ? () => setOthersHovered(other.sessionID) : undefined} onMouseOut={jump ? () => setOthersHovered(null) : undefined}>
                      {label("")}
                      <text wrapMode="none" flexShrink={0} fg={stateAccentColor(theme(), other.status, false, mono())}>
                        {mono() ? (other.status === "active" ? "*" : "|") : other.status === "active" ? "●" : "‖"}
                      </text>
                      <text wrapMode="none" flexShrink={0} fg={theme().text.muted}>
                        {sessionTag(other.sessionID)}
                      </text>
                      <text wrapMode="none" flexShrink={0} fg={theme().text.faint}>
                        {other.loopEnabled ? `v${other.loopIteration ?? 1}${typeof other.loopMaxLoops === "number" && other.loopMaxLoops > 0 ? `/${other.loopMaxLoops}` : ""}` : other.status}
                      </text>
                      <text wrapMode="none" flexGrow={1} fg={theme().text.muted} attributes={jump !== undefined && hovered() ? TextAttributes.BOLD : undefined}>
                        {truncate(other.condition.replace(/\s+/g, " ").trim(), OTHERS_CONDITION_MAX, ascii ? "..." : "\u2026")}
                      </text>
                      <Show when={jump !== undefined && hovered()}>
                        <text wrapMode="none" flexShrink={0} fg={theme().text.faint}>
                          {ascii ? "-> transcript" : "\u2192 transcript"}
                        </text>
                      </Show>
                    </box>
                    )
                  }}
                </For>
                <Show when={rows().length > OTHERS_VISIBLE}>
                  <box flexDirection="row" gap={2}>
                    {label("")}
                    <text wrapMode="none" fg={theme().text.faint}>
                      {`+${rows().length - OTHERS_VISIBLE} more`}
                    </text>
                  </box>
                </Show>
              </box>
            )}
          </Show>
        </box>
        )}
      </Show>
    </box>
  )
}
