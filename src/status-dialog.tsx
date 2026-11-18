/**
 * The `/goal` detail dialog body, extracted so it renders headlessly (scripts/render-dialog.tsx) and stays
 * verifiable without a live TUI. The host owns all chrome (dialog frame, backdrop, Esc) — this is just the
 * content: state line, wrapped condition/evaluator/spend rows, and the history sections. Everything is
 * presentational, rendered from the live snapshot passed in by the caller; theme tokens only.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { JSX } from "@opentui/solid"
import { TextAttributes, type InputRenderable, type ColorInput } from "@opentui/core"
import { formatDurationCoarse, formatSpend, formatTokens, truncate } from "./core/format.ts"
import { findMatches, countMatches, segmentLine, matchLabel } from "./core/find.ts"
import { remediationFor, stateAccentColor, fixAccentColor, evaluatorHint, motionDisabled, compactMarker, type CompactMarkerTone } from "./core/hud.ts"
import { contextMeter, CONTEXT_BAR_CELLS, relativeTime } from "./core/history.ts"
import type { GoalSnapshot } from "./core/types.ts"
import { buildLoopDossier } from "./core/dossier.ts"
import { dossierLines, type DossierLineKind } from "./core/dossier-view.ts"
import { isLive } from "./core/types.ts"
import { dossierOutline, type DossierOutlineEntry } from "./core/dossier-outline.ts"
import { verifyAckSegment, type VerifyOutcome } from "./core/verify-record.ts"
import { reachAckSegment, type ReachOutcome } from "./core/reach-record.ts"
import { signAckSegment, type SignOutcome } from "./core/sign-record.ts"
import { sealAckSegment, type SealOutcome } from "./core/dossier-seal.ts"
import { HistoryBlock, LoopSection, type HistoryTheme } from "./tui-history.tsx"
import { LABEL } from "./core/history.ts"

/** Other rows the elsewhere block paints — the dust settles at four; beyond that the block gains a `+N more` line. */
export const FOREIGN_ROWS_VISIBLE = 4

/**
 * The foreign live goals: active or paused, never the dialog's own session, terminal states never listed.
 * One predicate for both consumers — the dialog paints it, the dialog keymap arms its digit chords from it —
 * so a row on screen and the key that jumps to it can never disagree.
 */
export const foreignLiveRows = (others: readonly GoalSnapshot[] | undefined, ownSessionID: string | undefined): readonly GoalSnapshot[] =>
  (others ?? []).filter((o) => (o.status === "active" || o.status === "paused") && o.sessionID !== ownSessionID)

/**
 * The failure-first row, extracted so the overview and the ledger tab paint the identical row from
 * one source. Painted only when a remedy exists (callers gate on it); exact remediation, never a
 * vague warning. On the overview it rides inside the dashboard column between the hint and the verify
 * gate; on the ledger it is the one row the focus view keeps — a failed, capped or hot loop is never
 * opened onto a tab without its remedy.
 */
const FixRow = (props: { theme: HistoryTheme; mono: () => boolean; fix: { readonly text: string; readonly tone: "warning" | "error" } }): JSX.Element => (
  <box flexDirection="row" gap={2}>
    <text fg={props.theme.text.faint} flexShrink={0} width={LABEL}>
      fix
    </text>
    <text wrapMode="word" flexGrow={1} fg={fixAccentColor(props.theme, props.fix.tone === "error" ? "error" : "warning", props.mono())}>
      {props.fix.text}
    </text>
  </box>
)

/**
 * The always-mounted click-affordance cell — the hover-stability grammar. The cell never mounts,
 * unmounts or changes width; hover only brightens it (weight under mono). The row's text never
 * changes attributes on hover, so nothing rewraps, nothing reflows, nothing flickers. Width 8 fits
 * the widest in-cell payload (`✓ copied` / `+ copied` / `✓ saved`); wider verbs pass their own width.
 */
const Affordance = (props: { theme: HistoryTheme; mono: () => boolean; verb: string; hovered: boolean; ack?: string | null; width?: number }): JSX.Element => {
  const ack = () => props.ack ?? null
  const lit = () => props.hovered || ack() !== null
  return (
    <text
      wrapMode="none"
      flexShrink={0}
      width={props.width ?? 8}
      fg={lit() ? props.theme.text.base : props.theme.text.faint}
      attributes={props.mono() && props.hovered && ack() === null ? TextAttributes.BOLD : undefined}
    >
      {ack() ?? props.verb}
    </text>
  )
}

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
  /** When set, clicking the evaluator/reason row copies the raw reason. The row carries an always-mounted faint `copy` affordance cell that brightens on hover; the text never changes. */
  onCopyReason?: (reason: string) => void
  /** When set, clicking an iteration summary line in the loop rail copies the full summary (the line carries an always-mounted faint `copy` affordance cell that brightens on hover). */
  onCopySummary?: (summary: string, version: number) => void
  /** When set, clicking a rail iteration row copies that iteration's attestation line — the receipt (`v3 · met · 9 turns · 41 tools · … · sha · cost`), verbatim. The row carries an always-mounted faint `copy` affordance cell that brightens on hover; the text never changes. */
  onCopyAttestation?: (line: string) => void
  /** When set, clicking the final tally row (painted once the loop is over) copies the tally line verbatim. The row carries an always-mounted faint `copy` affordance cell that brightens on hover; the text never changes. */
  onCopyTally?: (line: string) => void
  /** When set, clicking the verification section copies the gate's output tail (the raw verifier output, click-to-copy). The section carries the same always-mounted affordance cell. */
  onCopyVerify?: (tail: string) => void
  /** When set, clicking the dossier view's copy row copies the whole record as Markdown (the same document `goal.dossier.copy` writes). The row carries an always-mounted faint `copy` affordance cell that brightens on hover; the text never changes. */
  onCopyDossier?: (dossier: string) => void
  /** When set, the dossier view paints a save row under the copy row: the same document as a file, written once via O_EXCL by the host (`goal.dossier.export`) — never overwrites; the clicked row paints `✓ saved` (ascii `+ saved`) in place for the usual acknowledgment window. Unwired, the row does not paint (the document renders exactly as before). */
  onSaveDossier?: () => void
  /** When set, the dossier view paints a verify row under the save row: one click re-checks every sha the record quotes against the repository at the host's cwd and copies the Markdown verification report (palette twin: `goal.dossier.verify`). The clicked row paints the outcome in place for the usual acknowledgment window (`✓ 6/6 resolve` / ascii `+ 6/6 resolve`). The host returns the outcome counts; a host that returns undefined paints no ack — the click is acknowledged only when the record was actually swept. Unwired, the row does not paint (the document renders exactly as before). */
  onVerifyDossier?: () => VerifyOutcome | undefined
  /** When set, the dossier view paints a reach row under the verify row: one click asks whether every sha the record quotes is an ancestor of HEAD at the host's cwd and copies the Markdown ancestry report (palette twin: `goal.dossier.reach`). The clicked row paints the outcome in place for the usual acknowledgment window (`✓ 6/6 on this line` / ascii `+ 6/6 on this line`). The host returns the outcome counts; a host that returns undefined paints no ack — the click is acknowledged only when the ancestry sweep actually ran. Unwired, the row does not paint (the document renders exactly as before). */
  onReachDossier?: () => ReachOutcome | undefined
  /** When set, the dossier view paints a sign row under the reach row: one click asks whether git verifies a signature on every sha the record quotes, at the host's cwd, and copies the Markdown signature report (palette twin: `goal.dossier.sign`). The clicked row paints the outcome in place for the usual acknowledgment window (`✓ 6/6 signed` / ascii `+ 6/6 signed`). The host returns the outcome counts; a host that returns undefined paints no ack — the click is acknowledged only when the signature sweep actually ran. Unwired, the row does not paint (the document renders exactly as before). */
  onSignDossier?: () => SignOutcome | undefined
  /** The seal row — the record sealed into a file. One click runs all three sweeps (existence, ancestry, the seal) against the repository at the host's cwd and writes the sealed dossier (palette twin `goal.dossier.seal`). Painted only when the host wires this callback. */
  onSealDossier?: () => SealOutcome | undefined
  /** When set, the dossier view paints a mouse-first outline rail left of the document: one chip per `## ` section. Hovering a chip boldens it; a left-click copies THAT section's Markdown (the heading included, verbatim bytes) through this callback; right and middle clicks are inert; the clicked chip paints `✓ copied` (ascii `+ copied`) in place for the usual acknowledgment window. Unwired, the rail does not paint (the document renders exactly as before). */
  onCopyDossierSection?: (label: string, raw: string) => void
  /** When set, an "elsewhere" row carries an always-mounted faint `→ transcript` affordance cell and a left-click asks the host to open that session's transcript route (ui.router.navigate). Read-only chrome — switching sessions stays the host's business. */
  onViewTranscript?: (sessionID: string) => void
  /** Controlled expand state for the iteration rail's fold row (driven by the dialog's keymap layer for keyboard parity). Uncontrolled when absent. */
  expanded?: () => boolean
  /** Fired on fold-row activation. Pair with `expanded`. */
  onToggleExpanded?: () => void
  /** Controlled elsewhere overflow (the `+N more` fold). Pair with onToggleExpandedOthers; uncontrolled when absent (local state, like the rail's fold). */
  expandedOthers?: () => boolean
  /** Fired on elsewhere-fold-row activation. */
  onToggleExpandedOthers?: () => void
  /** When set and returning true, renders a faint "snapshot unavailable" line above the body — the dialog opened from fallback/stale cache because the live get-RPC failed. */
  noticeStale?: () => boolean
  /** The dialog's view tab: `overview` paints the goal's state at a glance; `ledger` the iteration history at full length; `dossier` the whole record as rendered Markdown. Uncontrolled when absent (local state, like the elsewhere fold). Pair with onViewChange for the host-controlled arm. */
  view?: () => "overview" | "ledger" | "dossier"
  /** Fired on tab activation. Pair with `view`. */
  onViewChange?: (view: "overview" | "ledger" | "dossier") => void
  /** Other sessions in this directory holding live goals (active/paused), excluding the session under dialog. Read-only awareness; the host owns session switching. Omitted/empty renders no rows. */
  others?: readonly GoalSnapshot[]
  /** Maps a session ID to its dialog-safe label (the mount passes the session slug when the host knows it). Falls back to the id suffix. */
  sessionLabel?: (sessionID: string) => string
}): JSX.Element => {
  const theme = () => props.theme
  // ASCII demotion for dumb terminals (NO_COLOR / TERM=dumb): the context meter becomes ink-density ASCII. Evaluated once per mount.
  const ascii = motionDisabled(process.env) || props.mono === true
  const mono = () => props.mono === true
  // View tabs — `overview` (default; the goal's state at a glance) | `ledger` (the iteration history at full length) | `dossier` (the whole record as rendered Markdown). TUI-local view state: the host wires view/onViewChange and the `t` chord cycles the same signal; unwired, the strip works on local state (the elsewhere-fold pattern). Right/middle clicks are inert; the active tab paints base+bold — weight is the NO_COLOR contract.
  const [localView, setLocalView] = createSignal<"overview" | "ledger" | "dossier">("overview")
  const view = () => props.view?.() ?? localView()
  const setView = (next: "overview" | "ledger" | "dossier") => {
    const host = props.onViewChange
    if (host) {
      try {
        host(next)
      } catch {
        // The host detached — the strip is chrome, not a command.
      }
    } else {
      setLocalView(next)
    }
  }
  const viewTab = (name: "overview" | "ledger" | "dossier") => (
    <box
      flexDirection="row"
      onMouseUp={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        if (view() !== name) setView(name)
      }}
    >
      <text wrapMode="none" fg={view() === name ? theme().text.base : theme().text.faint} attributes={view() === name ? TextAttributes.BOLD : undefined}>
        {name}
      </text>
    </box>
  )
  const ledger = () => view() === "ledger"
  const dossier = () => view() === "dossier"
  // The dossier view's payload: the same document `goal.dossier.copy` writes, memoized on the goal snapshot (the clock rides along; the host re-renders on signal changes, never on the clock alone). Undefined while the goal is absent.
  const dossierText = createMemo(() => {
    const goal = props.goal
    return goal ? buildLoopDossier(goal, props.nowMs()) : undefined
  })
  const dossierRows = createMemo(() => (dossierText() === undefined ? [] : dossierLines(dossierText()!)))
  // The dossier outline rail: one chip per `## ` section of the rendered document. Only painted when the host wires onCopyDossierSection.
  const outline = createMemo(() => (dossierText() === undefined ? [] : dossierOutline(dossierText()!)))
  // Find-in-record — the dossier tab's live spotlight. Mouse-first: a `find` row toggles the find bar (an inline input, a running count, and a close button); closing unmounts the bar and resets the query, so a stale query can never ride a hidden bar. While the query is non-blank, matching lines paint as segmented text (matches bold in the feedback tone — weight is the NO_COLOR contract) and non-matching lines demote to faint. A blank query paints the document exactly as it ever did. No auto-scroll, no guessed offsets — the record scrolls under the host's scrollbox and the spotlight does the finding.
  const [findOpen, setFindOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal("")
  const [findRef, setFindRef] = createSignal<InputRenderable | undefined>(undefined)
  const findQueryNow = () => (findOpen() ? findQuery() : "")
  // Per-line match flags and the running occurrence count, computed from the same classified lines the paint consumes — the count can never disagree with the highlight.
  const findLineMatch = createMemo(() => findMatches(dossierRows().map((line) => line.text), findQueryNow()))
  const findCount = createMemo(() => countMatches(dossierRows().map((line) => line.text), findQueryNow()))
  // Focus the input whenever the bar opens — typing lands immediately, no click first. Unfocused when closed; the bar is unmounted on close anyway.
  createEffect(() => {
    if (findOpen()) findRef()?.focus()
  })
  // Leaving the dossier tab always closes and resets the find bar — a stale query can never greet the next visit.
  createEffect(() => {
    if (!dossier()) {
      setFindOpen(false)
      setFindQuery("")
    }
  })
  // vN/M for looped goals — null when the loop is uncapped or not a loop. Kept as a pure helper so the narrowing happens once, on a plain parameter. Terminal goals show no position chrome — the terminal word carries the outcome.
  const loopPosition = (goal: GoalSnapshot): string => {
    if (!goal.loopEnabled || !isLive(goal.status)) return ""
    const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : ""
    return ` · v${goal.loopIteration ?? 1}${cap}`
  }
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
  // the row carries an always-mounted `→ transcript` affordance cell. Live means the same
  // predicate the controller and the store use (active | paused) — failed/cleared are terminal, never listed.
  const OTHERS_VISIBLE = FOREIGN_ROWS_VISIBLE
  const OTHERS_CONDITION_MAX = 34
  const OTHERS_TAG_MAX = 12
  const sessionTag = (sessionID: string): string => {
    const label = props.sessionLabel?.(sessionID) ?? sessionID
    return label.length > OTHERS_TAG_MAX ? `${label.slice(0, OTHERS_TAG_MAX - 1)}…` : label
  }
  const othersLive = () => {
    const rows = foreignLiveRows(props.others, g()?.sessionID)
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
  // Host toasts do not render above the modal, so row copies acknowledge in place: the row's
  // always-mounted affordance cell flips from its verb to `✓ copied` for the window (same grammar
  // as the footer's copy button). The cell owns the ack — nothing else on the row changes.
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
  // The verify row's ack carries the sweep's truth, not just a verb — the counts are all the host returns.
  const [verifyAck, setVerifyAck] = createSignal<string | null>(null)
  let verifyTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (verifyTimer) clearTimeout(verifyTimer)
  })
  const verifySuffix = () => verifyAck() ?? ""
  // The reach row's ack carries the ancestry sweep's truth, not just a verb — same contract as the verify row, one question further (HEAD, not the object store).
  const [reachAck, setReachAck] = createSignal<string | null>(null)
  let reachTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (reachTimer) clearTimeout(reachTimer)
  })
  const reachSuffix = () => reachAck() ?? ""
  // The sign row's ack carries the signature sweep's truth, not just a verb — same contract as the verify and reach rows, one question further behind the seal.
  const [signAck, setSignAck] = createSignal<string | null>(null)
  let signTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (signTimer) clearTimeout(signTimer)
  })
  const signSuffix = () => signAck() ?? ""
  // The seal row's ack carries the sealed file's truth — all three sweeps, one number (palette twin `goal.dossier.seal`).
  const [sealAck, setSealAck] = createSignal<string | null>(null)
  let sealTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (sealTimer) clearTimeout(sealTimer)
  })
  const sealSuffix = () => sealAck() ?? ""
  const [reasonHovered, setReasonHovered] = createSignal(false)
  const [conditionHovered, setConditionHovered] = createSignal(false)
  const [verifyHovered, setVerifyHovered] = createSignal(false)
  const [dossierHovered, setDossierHovered] = createSignal(false)
  const [saveHovered, setSaveHovered] = createSignal(false)
  const [verifyDossierHovered, setVerifyDossierHovered] = createSignal(false)
  const [reachDossierHovered, setReachDossierHovered] = createSignal(false)
  const [signDossierHovered, setSignDossierHovered] = createSignal(false)
  const [sealDossierHovered, setSealDossierHovered] = createSignal(false)
  const [othersHovered, setOthersHovered] = createSignal<string | null>(null)
  const [localOthersExpanded, setLocalOthersExpanded] = createSignal(false)
  // The boundary-compaction marker (compaction-landed indicator on the dial the boundary compaction reads). mono drops the hue, ascii demotions live in the text.
  const compactMarkerNow = () => compactMarker(g()?.loopCompact, ascii)
  const compactMarkerFg = (tone: CompactMarkerTone) => {
    if (mono()) return theme().text.muted
    const fb = theme().text.feedback
    if (tone === "landed") return (fb.success ?? fb.info).base
    if (tone === "missed") return fb.warning.base
    return theme().text.faint
  }
  const [foldHovered, setFoldHovered] = createSignal(false)
  // Controlled when the caller passes `expandedOthers` (the dialog keymap drives it so the `m` chord
  // and the fold row flip the same flag); local state otherwise. Same contract as the rail's fold.
  const othersExpanded = () => props.expandedOthers?.() ?? localOthersExpanded()
  const toggleOthersExpanded = () => {
    try {
      if (props.onToggleExpandedOthers) return props.onToggleExpandedOthers()
      setLocalOthersExpanded((v) => !v)
    } catch {
      // The host detached mid-click — the fold keeps its paint, nothing to undo.
    }
  }
  const copyCondition = (condition: string) => {
    if (!props.onCopyCondition) return
    try {
      props.onCopyCondition(condition)
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
  const copyDossier = () => {
    const text = dossierText()
    if (!props.onCopyDossier || text === undefined) return
    try {
      props.onCopyDossier(text)
      acknowledge("dossier")
    } catch {
      // Best-effort.
    }
  }
  // The save row's side effect lives in the host (one O_EXCL write, toasted there); the row acknowledgment only mirrors the copy row's optimistic grammar.
  const saveDossier = () => {
    if (!props.onSaveDossier) return
    try {
      props.onSaveDossier()
      acknowledge("save")
    } catch {
      // Best-effort.
    }
  }
  // The verify row's side effect lives in the host (one probe per quoted sha + a report copy, toasted there); the row paints only the outcome the host reports back. A host that returns undefined ran nothing the UI can attest to — no ack.
  const verifyDossier = () => {
    if (!props.onVerifyDossier) return
    try {
      const outcome = props.onVerifyDossier()
      if (outcome) {
        setVerifyAck(verifyAckSegment(outcome, ascii))
        if (verifyTimer) clearTimeout(verifyTimer)
        verifyTimer = setTimeout(() => setVerifyAck(null), 2400)
      }
    } catch {
      // Best-effort.
    }
  }
  // The reach row's side effect lives in the host (one probe per quoted sha + a report copy, toasted there); the row paints only the outcome the host reports back. A host that returns undefined ran nothing the UI can attest to — no ack.
  const reachDossier = () => {
    if (!props.onReachDossier) return
    try {
      const outcome = props.onReachDossier()
      if (outcome) {
        setReachAck(reachAckSegment(outcome, ascii))
        if (reachTimer) clearTimeout(reachTimer)
        reachTimer = setTimeout(() => setReachAck(null), 2400)
      }
    } catch {
      // Best-effort.
    }
  }
  // The sign row's side effect lives in the host (one probe pair per quoted sha + a report copy, toasted there); the row paints only the outcome the host reports back. A host that returns undefined ran nothing the UI can attest to — no ack.
  const signDossier = () => {
    if (!props.onSignDossier) return
    try {
      const outcome = props.onSignDossier()
      if (outcome) {
        setSignAck(signAckSegment(outcome, ascii))
        if (signTimer) clearTimeout(signTimer)
        signTimer = setTimeout(() => setSignAck(null), 2400)
      }
    } catch {
      // Best-effort.
    }
  }
  // The seal row's side effect lives in the host (three probe sweeps + one O_EXCL file write, toasted there); the row paints only the outcome the host reports back. A host that returns undefined ran nothing the UI can attest to — no ack.
  const sealDossier = () => {
    if (!props.onSealDossier) return
    try {
      const outcome = props.onSealDossier()
      if (outcome) {
        setSealAck(sealAckSegment(outcome, ascii))
        if (sealTimer) clearTimeout(sealTimer)
        sealTimer = setTimeout(() => setSealAck(null), 2400)
      }
    } catch {
      // Best-effort.
    }
  }
  // A section chip quotes its section, bytes verbatim — the same "the record, whole" contract as the copy row, narrowed to one section.
  const copySection = (entry: DossierOutlineEntry) => {
    if (!props.onCopyDossierSection) return
    try {
      props.onCopyDossierSection(entry.label, entry.raw)
      acknowledge(`section:${entry.id}`)
    } catch {
      // Best-effort.
    }
  }
  // The find bar's toggle and close — one mouse grammar, both directions. Closing unmounts the bar and resets the query so a stale query can never ride a hidden bar. No chord, no footer furniture; the row is the discovery surface.
  const toggleFind = () => {
    if (findOpen()) {
      setFindQuery("")
      setFindOpen(false)
      return
    }
    setFindOpen(true)
  }
  const closeFind = () => {
    setFindQuery("")
    setFindOpen(false)
  }
  // The dossier view's paint grammar: weight and tone carry meaning, never hue alone; the words are the NO_COLOR contract. Structural markers were lifted by the classifier — what paints here is the record. With a non-blank find query, a matching line paints as segmented text (matches bold in the feedback tone — the NO_COLOR contract is the weight) and a non-matching line demotes to faint wholesale; blank query is byte-identical to the un-searched paint.
  const dossierRow = (line: { kind: DossierLineKind; text: string }, index: number): JSX.Element => {
    const active = () => findQueryNow().trim().length > 0
    const matchLine = () => active() && (findLineMatch()[index] ?? false)
    const dimmed = () => active() && !matchLine()
    // One text run, finding-aware: the un-searched paint (fg/weight unchanged), the dimmed paint (faint, no weight), or the segmented paint (non-match segments keep their tone, matches ride bold + feedback). The bullet gutter stays faint in every arm.
    const run = (fg: ColorInput, bold: boolean, wrap: "word" | "none", grow?: true): JSX.Element => {
      const normal = bold ? TextAttributes.BOLD : undefined
      return (
        <text
          wrapMode={wrap}
          flexShrink={0}
          flexGrow={grow ? 1 : 0}
          fg={active() && dimmed() ? theme().text.faint : fg}
          attributes={active() && dimmed() ? undefined : normal}
        >
          {active() && matchLine()
            ? segmentLine(line.text, findQueryNow()).map((segment) =>
                segment.match ? <strong>{segment.text}</strong> : segment.text,
              )
            : line.text}
        </text>
      )
    }
    switch (line.kind) {
      case "title":
        return run(theme().text.base, true, "word")
      case "section":
        return run(theme().text.base, true, "word")
      case "quote":
        return run(theme().text.faint, false, "word")
      case "fence":
        return run(theme().text.faint, false, "word")
      case "table":
        return run(theme().text.muted, false, "none")
      case "bullet":
        return (
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text wrapMode="none" flexShrink={0} fg={theme().text.faint}>{"·"}</text>
            {run(theme().text.base, false, "word", true)}
          </box>
        )
      case "blank":
        return (
          <text wrapMode="none" flexShrink={0}>
            {" "}
          </text>
        )
      case "body":
      default:
        return run(theme().text.base, false, "word")
    }
  }
  // The view strip, rendered inside EACH view branch (the branches unmount and remount the whole subtree on a tab flip, and remounted rows paint correctly — a strip with no remounting sibling co-paints at a stale absolute position after the flip). Painted identically in every view: tabs left, status right. The gapped content column spends no gap row on a sibling above the strip because there is none.
  const stripRow = (goalSnap: GoalSnapshot): JSX.Element => (
    /* view tabs — overview (default) is the full dashboard as ever: state at a glance plus everything the bar's level (c) names; ledger is the focus view (strip, the state row and the history, nothing else); dossier is the whole record as rendered Markdown (strip, the state row, the copy row and the document, nothing else). Left click switches (the `t` chord in the keymap is the keyboard twin, host-wired); right/middle inert; the active tab paints base+bold, weight is the NO_COLOR contract. */
    <box flexDirection="row" gap={2}>
      {viewTab("overview")}
      <text wrapMode="none" fg={theme().text.faint}>{"·"}</text>
      {viewTab("ledger")}
      <text wrapMode="none" fg={theme().text.faint}>{"·"}</text>
      {viewTab("dossier")}
      <box flexGrow={1} />
      <text fg={stateColor()} attributes={TextAttributes.BOLD}>
        {goalSnap.status}
      </text>
      <text fg={theme().text.muted}>
        {formatDurationCoarse(props.elapsedMs())} · {goalSnap.turns} turn{goalSnap.turns === 1 ? "" : "s"}
        {loopPosition(goalSnap)}
        {goalSnap.evaluating ? " · checking" : goalSnap.waiting ? " · waiting" : ""}
      </text>
    </box>
  )
  return (
    <box flexDirection="column" gap={0}>
      <Show when={props.noticeStale?.()}>
        <text wrapMode="word" fg={theme().text.faint}>{"snapshot unavailable - showing last known state"}</text>
      </Show>
      <Show when={g()} fallback={<text wrapMode="word" fg={theme().text.base}>{props.fallback}</text>}>
        {(goal) => (
        <box flexDirection="column" gap={1} paddingRight={1}>
          <Show when={view() === "overview"}>
            <box flexDirection="column" gap={0}>
          {stripRow(goal())}
          {/* condition — click to copy the full text (host wires clipboard + toast via onCopyCondition) */}
          <box flexDirection="row" gap={2} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); copyCondition(goal().condition) }} onMouseOver={() => setConditionHovered(true)} onMouseOut={() => setConditionHovered(false)}>
            {label("goal")}
            <text wrapMode="word" fg={theme().text.base} flexGrow={1}>
              {goal().condition}
            </text>
            <Affordance theme={theme()} mono={mono} verb="copy" hovered={conditionHovered()} ack={copied() === "condition" ? (ascii ? "+ copied" : "✓ copied") : null} />
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
                  <text wrapMode="word" fg={theme().text.base} flexGrow={1}>
                    {reason()}
                  </text>
                  <Affordance theme={theme()} mono={mono} verb="copy" hovered={reasonHovered()} ack={copied() === "reason" ? (ascii ? "+ copied" : "✓ copied") : null} />
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
          {/* failure is a first-class screen — exact remediation, never a vague warning; painted only when a remedy exists (a nominal goal keeps the dashboard lean) */}
          <Show when={remediation()}>{(fix) => <FixRow theme={theme()} mono={mono} fix={fix()} />}</Show>
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
                    <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
                      {verify().command}
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
                    <Affordance theme={theme()} mono={mono} verb="copy" hovered={verifyHovered()} ack={copied() === "verify" ? (ascii ? "+ copied" : "✓ copied") : null} />
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
                    fallback={
                      <box flexDirection="row" gap={1}>
                        <text wrapMode="none" fg={theme().text.muted}>{`~${formatTokens(goal().contextSize as number)} tokens`}</text>
                        <Show when={compactMarkerNow()}>{(m) => <text wrapMode="none" flexShrink={0} fg={compactMarkerFg(m().tone)}>{`· ${m().text}`}</text>}</Show>
                      </box>
                    }
                  >
                    <text wrapMode="none" fg={fg()}>{meter().text}</text>
                    <text wrapMode="none" fg={mono() ? theme().text.muted : hot() ? theme().text.feedback.warning.base : theme().text.muted}>
                      {`~${formatTokens(goal().contextSize as number)} of ${formatTokens(goal().compactAtTokens as number)} · ${meter().pct}%`}
                    </text>
                    <Show when={compactMarkerNow()}>{(m) => <text wrapMode="none" flexShrink={0} fg={compactMarkerFg(m().tone)}>{`· ${m().text}`}</text>}</Show>
                  </Show>
                </box>
              )
            })()}
          </Show>
            </box>
          </Show>
          {/* failure is a first-class screen on the ledger too — the fix row is the one row the focus view keeps; exact remediation, never a vague warning, painted only when a remedy exists */}
          <Show when={ledger() && remediation()}>{(fix) => <FixRow theme={theme()} mono={mono} fix={fix()} />}</Show>
          {/* the dossier — the whole record as rendered Markdown: the copy row rides the same click grammar as the other rows, then the document itself, line for line, structural markers lifted into weight/tone. Everything the other views paint scatters as chrome; this is the record, whole. The scrollbox (host-owned) gives the wheel/keys their say. */}
          <Show when={dossier()}>
            <box flexDirection="column" gap={1}>
              {stripRow(goal())}
              {props.onCopyDossier
                ? (
                  <box flexDirection="row" gap={2} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); copyDossier() }} onMouseOver={() => setDossierHovered(true)} onMouseOut={() => setDossierHovered(false)}>
                    {label("dossier")}
                    <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
                      {"the whole record as markdown"}
                    </text>
                    <Affordance theme={theme()} mono={mono} verb="copy" hovered={dossierHovered()} ack={copied() === "dossier" ? (ascii ? "+ copied" : "✓ copied") : null} />
                  </box>
                )
                : (
                  <box flexDirection="row" gap={2}>
                    {label("dossier")}
                    <text wrapMode="word" flexGrow={1} fg={theme().text.muted}>
                      {"the whole record as markdown"}
                    </text>
                  </box>
                )}
              {/* the save row — the record as a file, one click, O_EXCL on the host side. Same click grammar and hover affordance as the copy row; painted only when the host wires onSaveDossier. No chord, no footer furniture; the palette is the discovery surface */}
              {props.onSaveDossier
                ? (
                  <box flexDirection="row" gap={2} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); saveDossier() }} onMouseOver={() => setSaveHovered(true)} onMouseOut={() => setSaveHovered(false)}>
                    {label("save")}
                    <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
                      {"the whole record as a file"}
                    </text>
                    <Affordance theme={theme()} mono={mono} verb="save" hovered={saveHovered()} ack={copied() === "save" ? (ascii ? "+ saved" : "✓ saved") : null} />
                  </box>
                )
                : null}
              {/* the verify row — the record, on trial. One click re-checks every sha the ledger quotes against the repository at the host's cwd and copies the Markdown verification report (palette twin `goal.dossier.verify`). zIndex 1 for the same reason as the find row: the hit grid awards a cell to the last render pass over it. Painted only when the host wires onVerifyDossier. No chord, no footer furniture; the palette is the discovery surface */}
              {props.onVerifyDossier
                ? (
                  <box flexDirection="row" gap={2} zIndex={1} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); verifyDossier() }} onMouseOver={() => setVerifyDossierHovered(true)} onMouseOut={() => setVerifyDossierHovered(false)}>
                    {label("verify")}
                    <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
                      {`the shas the record quotes, checked${verifySuffix()}`}
                    </text>
                    <Affordance theme={theme()} mono={mono} verb="verify" hovered={verifyDossierHovered()} width={6} />
                  </box>
                )
                : null}
              {/* the reach row — the record, in reach. One click asks whether every sha the ledger quotes is an ancestor of HEAD at the host's cwd and copies the Markdown ancestry report (palette twin `goal.dossier.reach`). zIndex 1 for the same reason as the find row: the hit grid awards a cell to the last render pass over it. Painted only when the host wires onReachDossier. No chord, no footer furniture; the palette is the discovery surface */}
              {props.onReachDossier
                ? (
                  <box flexDirection="row" gap={2} zIndex={1} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); reachDossier() }} onMouseOver={() => setReachDossierHovered(true)} onMouseOut={() => setReachDossierHovered(false)}>
                    {label("reach")}
                    <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
                      {`the shas the record quotes, on this line${reachSuffix()}`}
                    </text>
                    <Affordance theme={theme()} mono={mono} verb="reach" hovered={reachDossierHovered()} width={6} />
                  </box>
                )
                : null}
              {/* the sign row — the record, under seal. One click asks whether git verifies a signature on every sha the ledger quotes at the host's cwd and copies the Markdown signature report (palette twin `goal.dossier.sign`). zIndex 1 for the same reason as the reach row. Painted only when the host wires onSignDossier. No chord, no footer furniture; the palette is the discovery surface */}
              {props.onSignDossier
                ? (
                  <box flexDirection="row" gap={2} zIndex={1} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); signDossier() }} onMouseOver={() => setSignDossierHovered(true)} onMouseOut={() => setSignDossierHovered(false)}>
                    {label("sign")}
                    <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
                      {`the shas the record quotes, signed${signSuffix()}`}
                    </text>
                    <Affordance theme={theme()} mono={mono} verb="sign" hovered={signDossierHovered()} width={6} />
                  </box>
                )
                : null}
              {/* the seal row — the record, sealed. One click runs all three sweeps (existence, ancestry, the seal) and writes the sealed dossier as one O_EXCL file (palette twin `goal.dossier.seal`). zIndex 1 for the same reason as the sign row. Painted only when the host wires onSealDossier. No chord, no footer furniture; the palette is the discovery surface */}
              {props.onSealDossier
                ? (
                  <box flexDirection="row" gap={2} zIndex={1} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); sealDossier() }} onMouseOver={() => setSealDossierHovered(true)} onMouseOut={() => setSealDossierHovered(false)}>
                    {label("seal")}
                    <text wrapMode="word" flexGrow={1} fg={theme().text.base}>
                      {`the record, sealed into a file${sealSuffix()}`}
                    </text>
                    <Affordance theme={theme()} mono={mono} verb="seal" hovered={sealDossierHovered()} width={6} />
                  </box>
                )
                : null}
              {/* the find row — the dossier's live spotlight. One click opens the bar (an inline input, a running count, and a close button); one click closes it and resets the query. Mouse-first, no chord — the row is the discovery surface */}
              {/* zIndex 1 — the sibling dossier rows above mount after this one in the hit grid's claim order and their text rects spill one cell past their painted line, shadowing this row's cells. The hit grid awards a cell to the last render pass over it, so this row sorts last on purpose */}
              <box flexDirection="row" gap={2} zIndex={1} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); toggleFind() }}>
                {label("find")}
                <text wrapMode="word" flexGrow={1} fg={findOpen() ? theme().text.base : theme().text.faint}>
                  {findOpen() ? "hide find" : "find in the record"}
                </text>
              </box>
              <Show when={findOpen()}>
                <box flexDirection="row" gap={2}>
                  {label("query")}
                  <input ref={(el) => setFindRef(el)} flexGrow={1} placeholder="type to find..." onInput={(value: string) => setFindQuery(value)} />
                  <text wrapMode="none" flexShrink={0} fg={findCount() > 0 ? theme().text.base : theme().text.faint} attributes={findCount() > 0 ? TextAttributes.BOLD : undefined}>
                    {matchLabel(findCount())}
                  </text>
                  <box flexDirection="row" onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); closeFind() }}>
                    <text wrapMode="none" fg={theme().text.muted}>close</text>
                  </box>
                </box>
              </Show>
              <box flexDirection="row" gap={2}>
                {/* the outline rail — one chip per `## ` section; left-click quotes that section verbatim. Inert chrome when the host does not wire the callback: no rail, the document paints exactly as before. The chip never changes on hover: its label is the affordance, the clicked chip paints `✓ copied` in place for the acknowledgment window */}
                <Show when={props.onCopyDossierSection}>
                  <box flexDirection="column" gap={0} flexShrink={0} width={14}>
                    <For each={outline()}>{(entry) => {
                      const active = () => copied() === `section:${entry.id}`
                      return (
                        <box flexDirection="row" gap={1} flexShrink={0} width={14} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); copySection(entry) }}>
                          <text wrapMode="none" fg={active() ? theme().text.base : theme().text.faint} attributes={active() ? TextAttributes.BOLD : undefined}>
                            {active() ? (ascii ? "+ copied" : "✓ copied") : entry.label}
                          </text>
                        </box>
                      )
                    }}</For>
                  </box>
                </Show>
                <box flexDirection="column" gap={0}>
                  <For each={dossierRows()}>{(line, i) => dossierRow(line, i())}</For>
                </box>
              </box>
            </box>
          </Show>
          {/* the strip for the ledger view — same grammar, painted under the ledger's own Show so the tab flip remounts it with the rest of the branch; absent in dossier (the record is whole) and in overview (painted by the overview branch). It sits directly above the loop/history Show; the section's marginTop=-1 cancels the gap row the column would otherwise leave. */}
          <Show when={ledger()}>{stripRow(goal())}</Show>
          {/* the history — the overview paints it (the bar defines level (c) as condition + history + timeline + verify tail + context meter); the ledger tab is the focus view: the state row, the strip and exactly this block, nothing else; the dossier tab does not paint it — the document carries the same bookkeeping whole */}
          <Show when={!dossier()}>
            <Show when={goal().loopEnabled}>
              <LoopSection goal={goal()} theme={theme()} elapsedMs={props.elapsedMs} nowMs={props.nowMs} mono={mono()} onCopySummary={props.onCopySummary} onCopyReason={props.onCopyReason} onCopyAttestation={props.onCopyAttestation} onCopyTally={props.onCopyTally} expanded={props.expanded} onToggleExpanded={props.onToggleExpanded} marginTop={-1} />
            </Show>
            <Show when={!goal().loopEnabled}>
              <HistoryBlock goal={goal()} theme={theme()} elapsedMs={props.elapsedMs} nowMs={props.nowMs} mono={mono()} onCopyReason={props.onCopyReason} marginTop={-1} />
            </Show>
          </Show>
          {/* elsewhere — live goals held by OTHER sessions in this directory; read-only awareness, the host owns session switching, so rows carry no handlers. Overview only; the ledger is a history-focus view, the dossier is the record, whole */}
          <Show when={view() === "overview"}>
          <Show when={othersLive()}>
            {(rows) => (
              <box flexDirection="column">
                <box flexDirection="row" gap={2}>
                  {label("elsewhere")}
                  <text fg={theme().text.faint} wrapMode="none">
                    {`${rows().length} other session${rows().length === 1 ? "" : "s"} holding live goals${props.onViewTranscript ? " · click a row to open its transcript" : ""}`}
                  </text>
                </box>
                <For each={othersExpanded() ? rows() : rows().slice(0, OTHERS_VISIBLE)}>
                  {(other, index) => {
                    const jump = props.onViewTranscript
                    const hovered = () => othersHovered() === other.sessionID
                    // Digits ride the keyboard twin contract: rows 1-4 (the chord cap) paint one, beyond the cap paints none — paint order is the contract.
                    const digit = () => (index() < FOREIGN_ROWS_VISIBLE ? index() + 1 : undefined)
                    return (
                    <box flexDirection="row" gap={2} onMouseUp={jump ? (event) => { if (event.button !== 0) return; event.stopPropagation(); try { jump(other.sessionID) } catch { /* the host discarded the navigation — nothing to undo */ } } : undefined} onMouseOver={jump ? () => setOthersHovered(other.sessionID) : undefined} onMouseOut={jump ? () => setOthersHovered(null) : undefined}>
                      {jump && digit() !== undefined ? (
                        // The keyboard twin: while the chord route is wired, digits 1-4 in the dialog keymap jump to this row's transcript — the digit says so. Rows past the chord cap paint none.
                        <text wrapMode="none" flexShrink={0} fg={theme().text.faint} width={LABEL}>
                          {digit()}
                        </text>
                      ) : (
                        label("")
                      )}
                      <text wrapMode="none" flexShrink={0} fg={stateAccentColor(theme(), other.status, false, mono())}>
                        {mono() ? (other.status === "active" ? "*" : "|") : other.status === "active" ? "●" : "‖"}
                      </text>
                      <text wrapMode="none" flexShrink={0} fg={theme().text.muted}>
                        {sessionTag(other.sessionID)}
                      </text>
                      <text wrapMode="none" flexShrink={0} fg={theme().text.faint}>
                        {other.loopEnabled ? `v${other.loopIteration ?? 1}${typeof other.loopMaxLoops === "number" && other.loopMaxLoops > 0 ? `/${other.loopMaxLoops}` : ""}` : other.status}
                      </text>
                      <text wrapMode="none" flexGrow={1} fg={theme().text.muted}>
                        {truncate(other.condition.replace(/\s+/g, " ").trim(), OTHERS_CONDITION_MAX, ascii ? "..." : "\u2026")}
                      </text>
                      {jump !== undefined ? (
                        <Affordance theme={theme()} mono={mono} verb={ascii ? "-> transcript" : "\u2192 transcript"} hovered={hovered()} width={13} />
                      ) : null}
                    </box>
                    )
                  }}
                </For>
                <Show when={rows().length > OTHERS_VISIBLE}>
                  <box flexDirection="row" gap={2} onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); toggleOthersExpanded() }} onMouseOver={() => setFoldHovered(true)} onMouseOut={() => setFoldHovered(false)}>
                    {label("")}
                    {/* click-to-expand, the rail-fold grammar: collapsed `+N more` expands the block in-flow; expanded folds back to the chord cap. Mouse-first — the hidden sessions are one click away; the `m` chord (dialog keymap, wired by the host) is the keyboard twin. */}
                    <text wrapMode="none" fg={theme().text.muted}>
                      {othersExpanded() ? `fold to ${FOREIGN_ROWS_VISIBLE}` : `+${rows().length - OTHERS_VISIBLE} more`}
                    </text>
                    <Affordance theme={theme()} mono={mono} verb={props.onToggleExpandedOthers ? "click · m" : "click"} hovered={foldHovered()} width={9} />
                  </box>
                </Show>
              </box>
            )}
          </Show>
          </Show>
        </box>
        )}
      </Show>
    </box>
  )
}
