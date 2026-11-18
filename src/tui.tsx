/**
 * Terminal UI for opencode-goal: a compact goal indicator painted on the left side of the host's jump-to-latest
 * row (directly above the input prompt, claimed through the `session.composer.top` slot), verdict toasts and
 * notifications, the `/goal` status dialog, and palette actions. Purely presentational; all state lives in the
 * server plugin and arrives over RPC. Everything renders through the host's own UI primitives and theme tokens;
 * the one exception is the indicator's single absolute 1-row box, which lands on the empty left side of the
 * host's jump row without adding a line. The detail view goes through `ui.dialog.show` (host backdrop, Esc
 * handling, sizing); transitions go through `ui.toast.show`.
 */
import { Plugin } from "@opencode/plugin/tui"
import type { ScrollBoxRenderable } from "@opentui/core"
import { TextAttributes, type ColorInput } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import stringWidth from "string-width"
import type { JSX } from "@opentui/solid"
import { createMemo, createSignal, createEffect, onCleanup, Show, ErrorBoundary } from "solid-js"
import { goalGlyph } from "./core/format.ts"
import { buildLoopDossier } from "./core/dossier.ts"
import { exportLoopDossier } from "./core/dossier-export.ts"
import { gitCatFileProbe, verifyRecord, verifyReportMarkdown, verifySummaryLine, type VerifyOutcome } from "./core/verify-record.ts"
import { gitAncestorProbe, reachRecord, reachReportMarkdown, reachSummaryLine, type ReachOutcome } from "./core/reach-record.ts"
import { gitSignProbe, signRecord, signReportMarkdown, signSummaryLine, type SignOutcome } from "./core/sign-record.ts"
import { exportSealedDossier, sealSummaryLine, type SealOutcome } from "./core/dossier-seal.ts"
import { exportReview, reviewSummaryLine } from "./core/dossier-review.ts"
import { exportSpendLedger, spendSummaryLine } from "./core/spend-ledger.ts"
import { exportDossierIndex, dossierIndexSummaryLine } from "./core/dossier-index.ts"
import { attestSealedDossier, attestationReportMarkdown, attestSummaryLine, selectNewestSealedDossier } from "./core/dossier-attest.ts"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { isLive, type GoalSnapshot, type Notice } from "./core/types.ts"
import { StatusDialogBody, foreignLiveRows, FOREIGN_ROWS_VISIBLE } from "./status-dialog.tsx"
import { HudCard, hudCardRows, pinBudget, DialogFooter, type HudCardTheme } from "./hud-card.tsx"
import { scrollbarTrackOptions, type HostScrollbarTheme } from "./core/scrollbar.ts"
import { pillModel, pinSuffix, motionDisabled, terminalPill, hudArmEnabled, staleUnprovenSessionIDs, staleRecentlyTerminalSessionIDs, expiredTerminalSessionIDs, TERMINAL_ACK_MS, ACK_FLASH_MS, LANDING_ACK_MS, landingSuffix, isCompactHot, pillMotionNeeded, breathCrest, BREATH_PHASE_MS, isRetryStuck, achievedAckAccentColor, contextMenuRows, nextMenuIndex, CONTEXT_MENU_COPY_CONDITION, CONTEXT_MENU_COPY_REASON, CONTEXT_MENU_COPY_SUMMARY, CONTEXT_MENU_COPY_DOSSIER, CONTEXT_MENU_SAVE_DOSSIER, CONTEXT_MENU_CLEAR, type NeutralTheme } from "./core/hud.ts"
import { preserveCarriedFields, applySnapshot, goalsEqual, dropSessions, type GoalSnapshotCacheEntry } from "./core/entries.ts"
import { makeGoalRefresh } from "./core/repull.ts"
import { pumpRpcEvent } from "./core/rpc-pump.ts"
import { createGoalMirror } from "./core/mirror.ts"
import { GoalRpc } from "./rpc.ts"
import { dialogStatusCommands } from "./core/dialog-keys.ts"
import { parseChangedEvent, parseListGoalOutput, parseNotice, sameDirectory } from "./core/wire.ts"

type Entry = GoalSnapshotCacheEntry

const TICK_MS = 15_000
const ATTENTION_KINDS: ReadonlySet<string> = new Set(["achieved", "impossible", "failed", "paused"])

/** Elapsed wall time for display: the record's elapsed plus the idle time since the snapshot arrived (live goals only). */
const elapsedOf = (g: GoalSnapshot, receivedAt: number | undefined, nowMs: number) =>
  g.status === "active" ? g.elapsedMs + Math.max(0, nowMs - (receivedAt ?? nowMs)) : g.elapsedMs

/**
 * Host xlarge dialogs size to their content and can outgrow the terminal; clamping the column to the
 * viewport (minus one row) keeps the header and hint pinned while the scrollbox gives way. The terminal
 * dimensions hook only works inside a rendered component (plugins mount before the renderer exists), so
 * the clamp lives in its own tiny component rendered by the dialog, never in plugin setup.
 */
const ClampedColumn = (props: { children?: JSX.Element }) => {
  const dimensions = useTerminalDimensions()
  return (
    <box flexDirection="column" height="100%" maxHeight={Math.max(8, dimensions().height - 1)} paddingLeft={1} paddingRight={1} paddingBottom={0} gap={1}>
      {props.children}
    </box>
  )
}

export default Plugin.define({
  id: "opencode-goal.tui",
  setup(context) {
    const rpc = context.client.rpc(GoalRpc)
    const [entries, setEntries] = createSignal<Readonly<Record<string, Entry>>>({})
    const [now, setNow] = createSignal(Date.now())
    const [statusDialogOpen, setStatusDialogOpen] = createSignal(false)
    // Elsewhere — the live goals OTHER sessions hold in this directory, for the dialog's \`elsewhere\` block.
    // Setup-scope TUI-local state like the pin registry: a read-only view, never stored. Refreshed when the
    // dialog opens and whenever any goal `changed` event lands while it is open; the host owns session
    // switching, so the block carries no actions.
    const [others, setOthers] = createSignal<readonly GoalSnapshot[]>([])
    const sessionLabel = (sessionID: string): string => {
      try {
        return context.data.session.get(sessionID)?.title ?? sessionID
      } catch {
        return sessionID.slice(-12)
      }
    }
    const refreshOthers = (): Promise<void> =>
      rpc.list({}).then((result) => {
        const goals = parseListGoalOutput(result)
        if (goals) setOthers(goals)
      }).catch(() => {})
    const [statusDialogSession, setStatusDialogSession] = createSignal<string | undefined>(undefined)
    const [foreignMoreExpanded, setForeignMoreExpanded] = createSignal(false)
    /** Loop-rail fold: controlled expand for the dialog's "N older iterations" row (keyboard parity with the click target). */
    const [iterationsExpanded, setIterationsExpanded] = createSignal(false)
    /** View tab: `overview` paints the goal's state at a glance; `ledger` the iteration history at full length; `dossier` the whole record as rendered Markdown. TUI-local, like the pin registry — the strip in the body flips it, the `t` chord cycles it. */
    const [dialogView, setDialogView] = createSignal<"overview" | "ledger" | "dossier">("overview")
    /** Set when the dialog's live get-RPC rejects; the body renders a faint "snapshot unavailable" line so stale chrome can never pass as fresh. */
    const [dialogNoticeStale, setDialogNoticeStale] = createSignal(false)
    const [scrollRef, setScrollRef] = createSignal<ScrollBoxRenderable | undefined>(undefined)
    const requested = new Set<string>()
    // Bound the one-shot marker set: unlike the entries cache it has no cap, so a long-lived TUI over
    // months of session churn would grow it without limit. Clearing wholesale is safe — a re-ensured
    // session just re-pulls once through the same path.
    const REQUESTED_CAP = 256

    const statusBody = (sessionID: string, fallback: string) => {
      const entry = () => entries()[sessionID]
      const goal = () => entry()?.goal ?? undefined
      const elapsed = () => {
        const g = goal()
        return g ? elapsedOf(g, entry()?.receivedAt, now()) : 0
      }
      return <StatusDialogBody goal={goal()} fallback={fallback} theme={context.theme} elapsedMs={elapsed} nowMs={() => now()} onCopyCondition={(condition) => copyToClipboard(condition, sessionID)} onCopyReason={(reason) => copyToClipboard(reason, sessionID, "reason")} onCopySummary={(summary) => copyToClipboard(summary, sessionID, "summary")} onCopyAttestation={(line) => copyToClipboard(line, sessionID, "attestation")} onCopyTally={(line) => copyToClipboard(line, sessionID, "tally")} onCopyVerify={(tail) => copyToClipboard(tail, sessionID, "verify")} onCopyDossier={() => { const g = entries()[sessionID]?.goal; if (g) copyToClipboard(buildLoopDossier(g, Date.now()), sessionID, "dossier") }} onSaveDossier={() => { const g = entries()[sessionID]?.goal; exportDossier(sessionID, g) }} onVerifyDossier={() => { const g = entries()[sessionID]?.goal; return verifyRecordAction(sessionID, g) }} onReachDossier={() => { const g = entries()[sessionID]?.goal; return reachRecordAction(sessionID, g) }} onSignDossier={() => { const g = entries()[sessionID]?.goal; return signRecordAction(sessionID, g) }} onSealDossier={() => { const g = entries()[sessionID]?.goal; return sealRecordAction(sessionID, g) }} onCopyDossierSection={(_label, raw) => copyToClipboard(raw, sessionID, "section")} onViewTranscript={(target) => { try { context.ui.router.navigate({ type: "session", sessionID: target }) } catch { /* the host detached — the click is chrome, not a command */ } }} mono={reducedColor} expanded={() => iterationsExpanded()} onToggleExpanded={() => setIterationsExpanded((v) => !v)} view={() => dialogView()} onViewChange={(v) => setDialogView(v)} expandedOthers={() => foreignMoreExpanded()} onToggleExpandedOthers={() => setForeignMoreExpanded((v) => !v)} noticeStale={() => dialogNoticeStale()} others={others()} sessionLabel={sessionLabel} />
    }
    /**
     * Closes the detail dialog the same way the Esc key does: `ui.dialog.clear()` tears down the
     * active dialog (host modal mode off, backdrop gone, the dialog's onClose runs — which also
     * resets the plugin's dialog-open flag and scroll ref). The mouse click on the header's
     * `esc` label calls this directly; the flag resets here too so the keymap layer disarms even
     * if the host never fires onClose for a programmatically cleared dialog.
     */
    const closeStatusDialog = () => {
      try {
        context.ui.dialog.clear()
      } catch {
        // Best-effort; the flags reset regardless so the keymap layer disarms.
      }
      setStatusDialogOpen(false)
      setStatusDialogSession(undefined)
      setScrollRef(undefined)
    }
    const showStatusDialog = (sessionID: string, fallback: string) => {
      try {
        showStatusDialogInner(sessionID, fallback)
      } catch (error) {
        try {
          context.ui.toast.show({ title: "goal plugin error (dialog)", message: String(error instanceof Error ? (error.stack ?? error) : error).slice(0, 900), variant: "error", duration: 30000 })
        } catch {
          // Even the error toast must not take the plugin down.
        }
      }
    }
    const showStatusDialogInner = (sessionID: string, fallback: string) => {
      setScrollRef(undefined)
      setStatusEscHovered(false)
      // The dialog is the deeper zoom level: the card is redundant chrome behind it (and its
      // priority-100 Esc layer must not compete with the modal's own), so opening the dialog
      // takes the card down here at the one point every caller passes through — openDashboard,
      // and the /goal / palette `status` notice path, which bypasses openDashboard entirely.
      setContextOpen(false)
      setHudSession(undefined)
      setIterationsExpanded(false)
      setDialogNoticeStale(false)
      // Pull a fresh snapshot (with spend) so the dialog renders current data; the notice text stays the fallback.
      // If the RPC rejects or the payload cannot be parsed, say so in the dialog — never let stale chrome pass as fresh.
      void refresh(sessionID).then((fresh) => setDialogNoticeStale(!fresh)).catch(() => setDialogNoticeStale(true))
      void refreshOthers()
      const looped = () => {
        const g = entries()[sessionID]?.goal
        return Boolean(g && isLive(g.status) && g.loopEnabled)
      }
      const loopPosition = () => {
        const g = entries()[sessionID]?.goal
        if (!g?.loopEnabled) return ""
        const iteration = g.loopIteration ?? 1
        const cap = typeof g.loopMaxLoops === "number" && g.loopMaxLoops > 0 ? `/${g.loopMaxLoops}` : ""
        return ` · v${iteration}${cap}`
      }
      // Set the flag after show() so the onClose of a dialog replaced by this call cannot flip it back off.
      context.ui.dialog.show(
        () => (
          // A render-frame exception in the dialog must land as an in-dialog fallback, never as the
          // host's "plugin crashed in dialog" banner — the session stays alive either way.
          <ErrorBoundary
            fallback={(error) => (
              <ClampedColumn>
                <text attributes={TextAttributes.BOLD} fg={context.theme.text.feedback.warning.base}>
                  goal detail failed to render
                </text>
                <text fg={context.theme.text.muted} wrapMode="word">
                  {String(error instanceof Error ? (error.stack ?? error.message ?? error) : error).slice(0, 600)}
                </text>
                <text fg={context.theme.text.faint}>esc to close · your session is unaffected</text>
              </ClampedColumn>
            )}
          >
          <ClampedColumn>
            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <text attributes={TextAttributes.BOLD} fg={context.theme.text.base}>
                {goalGlyph(motionDisabled(process.env))} /goal{looped() ? ` · loop${loopPosition()}` : ""}
              </text>
              <box
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                onMouseUp={(event) => {
                  // Left button only: a stray right/middle press must not dismiss the dialog.
                  if (event.button !== 0) return
                  event.stopPropagation()
                  closeStatusDialog()
                }}
                onMouseOver={() => setStatusEscHovered(true)}
                onMouseOut={() => setStatusEscHovered(false)}
              >
                <text fg={statusEscHovered() ? context.theme.text.base : context.theme.text.muted} attributes={statusEscHovered() ? TextAttributes.BOLD : undefined}>esc</text>
              </box>
            </box>
            <scrollbox ref={(el) => setScrollRef(el)} scrollX={false} flexGrow={1} stickyScroll={false} contentOptions={{ minHeight: 0 }}
              verticalScrollbarOptions={{ trackOptions: scrollbarTrackOptions(context.theme as unknown as HostScrollbarTheme<ColorInput>, reducedColor), showArrows: false }}>
              {statusBody(sessionID, fallback)}
            </scrollbox>
            <DialogFooter
              theme={context.theme as unknown as HudCardTheme}
              mono={reducedColor}
              pinned={() => isPinned(sessionID)}
              copied={statusCopied}
              onCopy={() => {
                copyToClipboard(entries()[sessionID]?.goal?.condition ?? fallback, sessionID)
                flashStatusCopied()
              }}
              onTogglePin={() => togglePin(sessionID)}
              onClear={() => requestClearGoal(sessionID)}
            />
          </ClampedColumn>
          </ErrorBoundary>
        ),
        () => {
          setStatusDialogOpen(false)
          setStatusDialogSession(undefined)
          setScrollRef(undefined)
        },
      )
      context.ui.dialog.set({ size: "xlarge", centered: true })
      setStatusDialogOpen(true)
      setStatusDialogSession(sessionID)
    }

    /** RPC calls are routed to the plugin instance of the session's location. */
    const at = (sessionID: string) => {
      try {
        const location = context.data.session.get(sessionID)?.location ?? context.location
        return location ? { location } : undefined
      } catch {
        // The host's session lookup is the one unguarded call on the refresh path. A throw here must not
        // escape `refresh` at call time: the stale-chrome guard in the tick re-pulls through `refresh`
        // and a synchronous throw would break the for-loop before `.catch` is ever reached, stranding the
        // "goal checking" pill forever. Fall back to the plugin's own location, then to none (the RPC
        // routes to the default location).
        try {
          return context.location ? { location: context.location } : undefined
        } catch {
          return undefined
        }
      }
    }

    /**
     * The completion moment: when a goal goes live→terminal the ambient pill used to blink out
     * with no residual signal where the user was watching. The ack keeps one terminal snapshot
     * per session for `TERMINAL_ACK_MS` so the jump row can acknowledge the outcome
     * (achieved/impossible/failed; `cleared` is a deliberate reset and stays silent). Holds its
     * own copy of the snapshot — the entries cache may evict the goal before the ack expires.
     * Setup-scope and TUI-local like the pin registry: a transient view acknowledgment, not state.
     */
    const [terminalAcks, setTerminalAcks] = createSignal<Readonly<Record<string, { goal: GoalSnapshot; at: number }>>>({})
    // The check-flash window after a goal lands `achieved`: per session, self-terminating, setup-scope
    // like the ack registry. A view acknowledgment riding the breath's crest — never state, never stored.
    const [flashing, setFlashing] = createSignal<ReadonlySet<string>>(new Set())
    // The landing acknowledgment after a boundary compaction is observed to land (pending → landed
    // flip on the loopCompact state): same registry shape, longer window, info tone. A background win
    // surfaced where the user was watching — never state, never stored.
    const [landing, setLanding] = createSignal<ReadonlySet<string>>(new Set())
    const terminalTimers = new Set<ReturnType<typeof setTimeout>>()
    const noteLanding = (sessionID: string) => {
      setLanding((previous) => new Set(previous).add(sessionID))
      const timer = setTimeout(() => {
        terminalTimers.delete(timer)
        setLanding((previous) => {
          if (!previous.has(sessionID)) return previous
          const next = new Set(previous)
          next.delete(sessionID)
          return next
        })
      }, LANDING_ACK_MS)
      terminalTimers.add(timer)
    }
    const releaseCompletion = (sessionID: string) => {
      try {
        if (getHudSession() === sessionID) setHudSession(undefined)
        setContextOpen(false)
        setContextIndex(0)
        dropPin(sessionID)
      } catch {}
    }
    const noteTerminal = (sessionID: string, goal: GoalSnapshot) => {
      const ack = { goal, at: Date.now() }
      setTerminalAcks((previous) => ({ ...previous, [sessionID]: ack }))
      if (goal.status === "achieved") {
        setFlashing((previous) => new Set(previous).add(sessionID))
        const flashTimer = setTimeout(() => {
          terminalTimers.delete(flashTimer)
          setFlashing((previous) => {
            if (!previous.has(sessionID)) return previous
            const next = new Set(previous)
            next.delete(sessionID)
            return next
          })
        }, ACK_FLASH_MS)
        terminalTimers.add(flashTimer)
      }
      const timer = setTimeout(() => {
        terminalTimers.delete(timer)
        setTerminalAcks((previous) => {
          if (previous[sessionID]?.at !== ack.at) return previous
          const next = { ...previous }
          delete next[sessionID]
          return next
        })
      }, TERMINAL_ACK_MS)
      terminalTimers.add(timer)
    }
    const dropTerminal = (sessionID: string) => {
      setTerminalAcks((previous) => {
        if (!previous[sessionID]) return previous
        const next = { ...previous }
        delete next[sessionID]
        return next
      })
      setFlashing((previous) => {
        if (!previous.has(sessionID)) return previous
        const next = new Set(previous)
        next.delete(sessionID)
        return next
      })
      setLanding((previous) => {
        if (!previous.has(sessionID)) return previous
        const next = new Set(previous)
        next.delete(sessionID)
        return next
      })
    }

    /**
     * Pull a fresh snapshot from the server and cache it. Never throws synchronously: every failure mode —
     * the host lookup in `at()` (guarded above), the RPC rejection, an unparseable payload — folds into the
     * promise, so a caller's `.catch(() => {})` — the stale-chrome guard in the tick — is the real boundary.
     * A synchronous escape used to break the guard's re-pull for-loop at the first affected session and
     * silently strand the ambient pill on "goal checking" forever (the 2026-11-16 23:35 live session).
     * Resolves false when the payload is malformed — the caller treats it exactly like a rejection (stale
     * chrome must never pass as fresh), and the next tick retries.
     */
    const refresh = makeGoalRefresh({
      get: (sessionID) => rpc.get({ sessionID }, at(sessionID)),
      put: (sessionID, goal) => put(sessionID, goal),
    })

    const goalMirror = createGoalMirror()

    /**
     * Convergence fallback for a dead RPC + dropped `changed`: read the mirror file the server plugin writes on
     * every `changed` emission (same snapshot, same atomic write discipline), instead of the wedged RPC bridge.
     * Used only where a re-pull is already due (the 15s stale-chrome tick, a pump reconnect, a first view whose
     * pull failed); any failure keeps the cached entry, the same posture as a rejected re-pull. Directory-scoped
     * exactly like the `changed` intake, so a foreign project's record never paints here.
     */
    const refreshFromStorage = async (sessionID: string): Promise<boolean> => {
      try {
        const goal = goalMirror.read(sessionID, context.location?.directory)
        if (goal === undefined) return false
        put(sessionID, goal)
        return true
      } catch {
        return false
      }
    }

    const put = (sessionID: string, goal: GoalSnapshot | null) => {
      // Completion-moment detection runs before the entries update: a live→terminal transition
      // arms the acknowledgment pill, a fresh live goal disarms any stale one. Best-effort.
      try {
        const previous = entries()[sessionID]?.goal
        // An identical snapshot changes nothing — skip re-arming so the ack window stays 45s from the transition.
        const unchanged = previous && goal ? goalsEqual(previous, goal) : false
        const wasLive = previous != null && isLive(previous.status)
        const nowTerminal = goal !== null && goal !== undefined && !isLive(goal.status)
        const gone = goal === null || goal === undefined || nowTerminal
        if (!unchanged && wasLive && gone) {
          // Every live→terminal (or cleared) intake releases the HUD arm, the context menu and the pin —
          // whether or not an acknowledgment pill arms. Nothing from the finished goal sticks around to
          // swallow Esc, re-open the card or re-pin its condition onto the next arm in this session.
          releaseCompletion(sessionID)
          if (goal && goal.status !== "cleared") noteTerminal(sessionID, goal)
        } else if (goal && isLive(goal.status)) {
          dropTerminal(sessionID)
        }
        // A boundary compaction landing rides the same intake path: the plugin persists `landedAt`
        // on the record and pushes a `changed` event — the only stream guaranteed to reach us. Only a
        // real pending → landed flip arms the acknowledgment; re-delivery of the landed record is a
        // no-op, and a fresh arm never fabricates one from an already-landed record.
        const previousCompact = previous?.loopCompact
        const wasPending = previousCompact !== undefined && previousCompact.landedAt === undefined
        if (!unchanged && goal && goal.loopCompact?.landedAt !== undefined && wasPending) noteLanding(sessionID)
      } catch {
        // The acknowledgment is chrome; a failed probe must not break snapshot intake.
      }
      // The `get` RPC pull carries the context estimate and spend; `changed` events usually do not — carry both forward.
      const mergedGoal = preserveCarriedFields(entries()[sessionID]?.goal, goal)
      const mergedNow = Date.now()
      return setEntries((previous) => applySnapshot(previous, sessionID, mergedGoal, mergedNow, statusDialogSession()))
    }

    /** Lazily fetches a session's goal the first time a view asks for it; events keep it fresh afterwards. */
    const ensure = (sessionID: string) => {
      if (requested.has(sessionID)) return
      if (requested.size >= REQUESTED_CAP) requested.clear()
      requested.add(sessionID)
      // makeGoalRefresh resolves false on a malformed payload — release the marker on either failure
      // so the next render retries instead of black-holing this session's pill forever.
      refresh(sessionID)
        .then((ok) => {
          if (!ok) {
            requested.delete(sessionID)
            // RPC lost, but the persisted record may still answer: storage is not proxied through the RPC bridge.
            void refreshFromStorage(sessionID).catch(() => {})
          }
        })
        .catch(() => requested.delete(sessionID))
    }

    const live = (sessionID: string | undefined) => {
      try {
        if (!sessionID) return undefined
        ensure(sessionID)
        const goal = entries()[sessionID]?.goal
        return goal && isLive(goal.status) ? goal : undefined
      } catch {
        return undefined
      }
    }

    const currentSession = () => {
      try {
        const route = context.ui.router.current()
        return route.type === "session" ? route.sessionID : undefined
      } catch {
        return undefined
      }
    }

    const safeToast = (options: { title: string; message: string; variant?: "info" | "success" | "warning" | "error"; sessionID?: string; duration?: number }) => {
      try {
        context.ui.toast.show({ ...options, variant: options.variant ?? "info" })
      } catch {
        // Never let a toast failure take the plugin down with it.
      }
    }
    const onNotice = (notice: Notice) => {
      try {
        onNoticeInner(notice)
      } catch {
        safeToast({ title: "goal plugin notice handler failed", message: "see logs", variant: "error", duration: 8000 })
      }
    }
    const onNoticeInner = (notice: Notice) => {
      const here = currentSession() === notice.sessionID
      if (notice.kind === "status") {
        // formatStatus() repeats the title in its first line ("Goal active: ..."); the dialog renders from the live snapshot itself.
        // Always open the detail view for the session the notice carries: the notice is the response to an explicit
        // /goal (or palette) action, so the sessionID identifies where to point it; the previous current-tab gate could
        // swallow the response entirely when the TUI route did not match.
        showStatusDialog(notice.sessionID, notice.message)
        return
      }
      const important = ATTENTION_KINDS.has(notice.kind)
      if (!here && !important) return
      // Passing sessionID lets the host offer an "Open" action when the notice belongs to a session family
      // that is not currently open (see the plugin toast adapter in the host sources, plugin/api.tsx).
      safeToast({
        title: `${goalGlyph(motionDisabled(process.env))} ${notice.title}`,
        message: notice.message,
        variant: notice.level,
        sessionID: notice.sessionID,
        duration: notice.level === "error" || notice.level === "warning" ? 8_000 : 4_000,
      })
      if (important)
        try {
          // Best-effort like the toast: a host-side notify failure (renderer gone, OS notification
          // refused, attention subsystem detached) must never surface as an unhandled rejection.
          void context.attention.notify({
            title: `OpenCode \u00B7 ${notice.title}`,
            message: notice.message,
            notification: { when: "blurred" },
            sound: { name: notice.kind === "achieved" ? "done" : "error", when: "blurred" },
          }).catch(() => {})
        } catch {
          // Attention is best-effort; the toast already landed.
        }
    }

    /**
     * Reconnecting pumps for the RPC event streams. The one-shot `events.on` subscriptions they replace
     * die permanently the moment the harness's shared event connection drops (a service handoff or a
     * dropped stream): the `@opencode/client` wrapper iterates the shared stream once and never re-opens
     * it, so a goal left mid-"checking" never receives the verdict's `changed` event again and the pill
     * strands until the whole TUI restarts (observed live: 77 consecutive HTTP 500s on /api/rpc/goal/get
     * in the background service, and zero `rpc.goal.changed` deliveries, over 26 minutes on 2026-11-17).
     * The pumps re-open the stream with a small backoff and run a catch-up re-pull after every reconnect,
     * so the pill converges to the server's truth within ~a second of the bus reviving instead of never.
     * A globalThis generation guard aborts a previous TUI plugin generation's pumps on re-setup, so the
     * pumps never multiply across hot reloads.
     */
    const pumpController = new AbortController()
    const PUMP_GENERATION_KEY = "__opencodeGoalTuiRpcPump__"
    const pumpGeneration = (globalThis as Record<string, unknown>)[PUMP_GENERATION_KEY]
    if (pumpGeneration instanceof AbortController) pumpGeneration.abort()
    ;(globalThis as Record<string, unknown>)[PUMP_GENERATION_KEY] = pumpController
    const handleChangedEvent = (event: unknown) => {
      try {
        const parsed = parseChangedEvent((event as { data?: unknown } | null | undefined)?.data)
        // Defense-in-depth: a bus that ever crosses processes/directories must not paint another
        // project's record onto this one (the RPC read paths enforce the same directory scope).
        // Fail open when this instance has no directory to compare against; null-goal clears carry
        // no directory and pass through.
        const local = context.location?.directory
        if (parsed && parsed.goal && local && !sameDirectory(parsed.goal.directory, local)) return
        if (parsed) put(parsed.sessionID, parsed.goal)
        if (statusDialogOpen()) void refreshOthers()
      } catch {
        // A malformed event must not take the plugin's render tree down.
      }
    }
    const handleNoticeEvent = (event: unknown) => {
      try {
        const notice = parseNotice((event as { data?: unknown } | null | undefined)?.data)
        if (notice) onNotice(notice)
      } catch {
        // Same.
      }
    }
    const reconnectCatchUp = () => {
      // A reconnect may have swallowed events; re-read the server's truth for every cached live/null entry.
      // Bounded by the entries cache (ENTRY_CAP) and runs at most once per reconnect.
      for (const sessionID of staleUnprovenSessionIDs(entries(), Date.now(), 0)) {
        void refresh(sessionID).catch(() => {})
        void refreshFromStorage(sessionID).catch(() => {})
      }
      if (statusDialogOpen()) void refreshOthers()
    }
    const pumpSleep = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort)
          resolve()
        }, ms)
        const onAbort = () => {
          clearTimeout(timer)
          resolve()
        }
        signal.addEventListener("abort", onAbort, { once: true })
      })
    void pumpRpcEvent({
      name: "changed",
      signal: pumpController.signal,
      subscribe: () => rpc.events.subscribe("changed", { signal: pumpController.signal }),
      handle: handleChangedEvent,
      catchUp: reconnectCatchUp,
      sleep: pumpSleep,
    })
    void pumpRpcEvent({
      name: "notice",
      signal: pumpController.signal,
      subscribe: () => rpc.events.subscribe("notice", { signal: pumpController.signal }),
      handle: handleNoticeEvent,
      sleep: pumpSleep,
    })

    // Minute-resolution clock, ticking only while some goal is active.
    const timer = setInterval(() => {
      if (Object.values(entries()).some((entry) => entry.goal?.status === "active")) setNow(Date.now())
      // Stale-chrome guard: the pill paints from the entries cache and never re-pulls otherwise, so one
      // dropped `changed` event strands "goal checking · Nm" on the jump row forever. Re-pull entries older
      // than STALE_LIVE_ENTRY_MS whose goal is live OR null (goal armed in another process on the same
      // directory, or the `changed` event was dropped); a terminal/null response flows through the normal
      // intake, arms the acknowledgment pill, and the stale chrome converges. Recently-terminal entries
      // get the same treatment inside RECENT_TERMINAL_WINDOW_MS: a record cleared in another process
      // right after the goal went terminal re-arms the intake instead of painting phantom chrome forever.
      const staleNow = Date.now()
      for (const sessionID of staleUnprovenSessionIDs(entries(), staleNow)) {
        void refresh(sessionID).catch(() => {})
        void refreshFromStorage(sessionID).catch(() => {})
      }
      for (const sessionID of staleRecentlyTerminalSessionIDs(entries(), staleNow)) {
        void refresh(sessionID).catch(() => {})
        void refreshFromStorage(sessionID).catch(() => {})
      }
      // Expiry: a terminal record whose re-pull window has lapsed leaves the cache outright — palette
      // predicates, pill memos and every `entries()[sid]?.goal` consumer stop seeing the finished record
      // instead of staying enabled (or armed) on it forever. The session an open dialog renders is kept.
      setEntries((previous) => dropSessions(previous, expiredTerminalSessionIDs(previous, staleNow, statusDialogSession()), statusDialogSession()))
      // A kept-open dialog's foreign-goals block comes solely from the `others()` signal; the tick used to
      // refresh cached session entries but not this list, so a dropped `changed` event left it stale forever.
      if (statusDialogOpen()) void refreshOthers()
    }, TICK_MS)

    // One-per-session pin registry: a pinned condition is appended (truncated) to the ambient pill so it
    // stays visible on the jump row no matter how far the conversation scrolls. Lives at setup scope so the
    // pill, the HUD card and the /goal dialog all read one source. TUI-local by design — a pin is a view
    // preference, not goal state.
    const [pinned, setPinned] = createSignal<ReadonlySet<string>>(new Set())
    const isPinned = (sessionID: string | undefined) => Boolean(sessionID && pinned().has(sessionID))
    const togglePin = (sessionID: string | undefined) => {
      if (!sessionID) return
      setPinned((previous) => {
        const next = new Set(previous)
        if (next.has(sessionID)) next.delete(sessionID)
        else next.add(sessionID)
        return next
      })
    }
    // A pin belongs to the goal it was set on: when the goal completes (or is cleared) the pin drops with it,
    // so a finished loop never silently re-attaches its condition to a new request or new version the next arm.
    const dropPin = (sessionID: string | undefined) => {
      if (!sessionID) return
      setPinned((previous) => {
        if (!previous.has(sessionID)) return previous
        const next = new Set(previous)
        next.delete(sessionID)
        return next
      })
    }
    // Reduced motion: no breath, no animation. Evaluated once — a user toggling NO_COLOR mid-session gets it on next launch.
    const motionOk = !motionDisabled(process.env)
    // Reduced color: NO_COLOR / TERM=dumb also drop the plugin's chromatic accents (weight and glyphs carry meaning). Same env predicate as the motion guard.
    const reducedColor = !motionOk
    // The breath phase (0..3). Advances on a slow 600ms tick only while the loop is alive; the dot
    // itself is the only cell that changes. Static (never mounted) under reduced motion.
    const [breathPhase, setBreathPhase] = createSignal(0)

    // Claims the empty left side of the host's jump-to-latest row (the 1-row strip directly above the
    // input prompt) for the ambient goal pill: a zero-flow absolute 1-row box at top={-1}. The pill and
    // the card are ONE accordion surface — the pill is the persistent stripe (the panel's bottom seam
    // when open), and left click toggles the compact HUD card (level b — the composer-grammar card
    // expanding upward above the jump row); right click opens the full `/goal` dashboard (level c —
    // same host dialog as `goal.status`). Pinning the condition
    // (card `[pin]` button or `p` in the dialog) appends it to the pill so it survives conversation scroll.
    // The card is dismissible with Esc (keymap layer below), its esc button, or another left click on the pill.
    // When the goal ends, a live→terminal transition leaves a 45s acknowledgment pill on the jump row
    // (see noteTerminal / terminalPill) instead of the pill blinking out; `cleared` stays silent.
    const [getHudSession, setHudSession] = createSignal<string | undefined>(undefined)
    // In-modal copy acknowledgment: host toasts do not render above the modal, so the footer's copy button (and the `c` chord) flip its label to ✓ copied for a beat instead.
    const [statusCopied, setStatusCopied] = createSignal(false)
    // Right-click context menu on the HUD card: TUI-local view state like the pin and the card itself.
    const [contextOpen, setContextOpen] = createSignal(false)
    // The keyboard arm of the open menu: ↑/↓ move a selection index over the same six rows the mouse paints (disabled rows are skipped — the inert-row contract), enter activates, esc collapses the menu before the card. Reset to the first row on every open.
    const [contextIndex, setContextIndex] = createSignal(0)
    const contextRowsFor = (sessionID: string | undefined) => {
      try {
        const goal = sessionID ? entries()[sessionID]?.goal : undefined
        return contextMenuRows({ hasReason: Boolean(goal?.reason), hasSummary: Boolean(goal?.loopHistory?.at(-1)?.summary), hasDossier: Boolean(goal) })
      } catch {
        return contextMenuRows({ hasReason: false, hasSummary: false, hasDossier: false })
      }
    }
    const activateContextMenu = (sessionID: string | undefined) => {
      try {
        if (!sessionID) return
        const goal = entries()[sessionID]?.goal
        const rows = contextRowsFor(sessionID)
        const row = rows[contextIndex()] ?? rows[0]
        if (!row || !row.enabled) return
        switch (row.id) {
          case CONTEXT_MENU_COPY_CONDITION:
            if (goal?.condition) copyToClipboard(goal.condition, sessionID)
            break
          case CONTEXT_MENU_COPY_REASON:
            if (goal?.reason) copyToClipboard(goal.reason, sessionID, "reason")
            break
          case CONTEXT_MENU_COPY_SUMMARY: {
            const summary = goal?.loopHistory?.at(-1)?.summary
            if (summary) copyToClipboard(summary, sessionID, "summary")
            break
          }
          case CONTEXT_MENU_COPY_DOSSIER:
            if (goal) copyToClipboard(buildLoopDossier(goal, Date.now()), sessionID, "dossier")
            break
          case CONTEXT_MENU_SAVE_DOSSIER:
            exportDossier(sessionID, goal)
            break
          case CONTEXT_MENU_CLEAR:
            setContextOpen(false)
            setHudSession(undefined)
            requestClearGoal(sessionID)
            return
        }
        // Menu actions collapse the menu, mirroring the mouse path (menuAction in HudCard).
        setContextOpen(false)
        setContextIndex(0)
      } catch {
        // A dead snapshot must never take the key event down.
      }
    }
    // The dialog header's esc affordance hovers like every other clickable row: brightened + boldened. Setup-scope because the dialog closure is not a component.
    const [statusEscHovered, setStatusEscHovered] = createSignal(false)
    let statusCopiedTimer: ReturnType<typeof setTimeout> | undefined
    const flashStatusCopied = () => {
      setStatusCopied(true)
      if (statusCopiedTimer) clearTimeout(statusCopiedTimer)
      statusCopiedTimer = setTimeout(() => setStatusCopied(false), 1600)
    }
    const copyLabel: Readonly<Record<"condition" | "reason" | "summary" | "verify" | "dossier" | "section" | "attestation" | "tally", { title: string; message: string }>> = {
      condition: { title: "condition copied", message: "goal condition is on the clipboard" },
      reason: { title: "reason copied", message: "the evaluator's reason is on the clipboard" },
      summary: { title: "summary copied", message: "the iteration summary is on the clipboard" },
      verify: { title: "verify tail copied", message: "the verifier output tail is on the clipboard" },
      dossier: { title: "dossier copied", message: "the loop dossier markdown is on the clipboard" },
      section: { title: "section copied", message: "the quoted dossier section is on the clipboard" },
      attestation: { title: "attestation copied", message: "the iteration attestation line is on the clipboard" },
      tally: { title: "tally copied", message: "the loop final tally line is on the clipboard" },
    }
    const copyToClipboard = (text: string, sessionID: string | undefined, what: "condition" | "reason" | "summary" | "verify" | "dossier" | "section" | "attestation" | "tally" = "condition") => {
      try {
        const ok = context.renderer.copyToClipboardOSC52(text)
        const label = copyLabel[what]
        safeToast({
          title: ok ? label.title : "copy unavailable",
          message: ok ? label.message : "the terminal refused OSC52 clipboard access",
          variant: ok ? "success" : "warning",
          duration: 3_000,
          sessionID,
        })
      } catch (error) {
        safeToast({ title: "copy failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
      }
    }
    // The dossier-as-file path (`goal.dossier.export` palette command; the dialog's save row). One O_EXCL write into the host's cwd — never overwrites, suffixes on collision, the path comes back as a toast receipt; a failed write says so instead of failing silently.
    const exportDossier = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => {
      if (!goal || !sessionID) return
      try {
        const result = exportLoopDossier(goal, Date.now(), process.cwd())
        safeToast({ title: "dossier exported", message: result.path, variant: "success", duration: 5_000, sessionID })
      } catch (error) {
        safeToast({ title: "export failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
      }
    }
    // The record, on trial: sweep every sha the ledger quotes against the repository at the host's cwd, copy the Markdown verification report, toast the outcome. The dialog row paints the same counts through its in-place ack. Unknown is never folded into missing; a sweep that cannot probe (no git, not a repository) comes back all-unknown and says so.
    const verifyRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined): VerifyOutcome | undefined => {
      if (!goal || !sessionID) return undefined
      try {
        const directory = process.cwd()
        const verification = verifyRecord(goal, gitCatFileProbe(directory))
        const report = verifyReportMarkdown(goal, verification, Date.now(), directory)
        let copied = false
        try {
          copied = context.renderer.copyToClipboardOSC52(report)
        } catch {
          copied = false
        }
        const summary = verifySummaryLine(verification)
        const title = verification.missing > 0 ? "record does not verify" : verification.unknown > 0 ? "record unverifiable" : verification.unique === 0 ? "nothing to verify" : "record verified"
        const variant = verification.missing > 0 ? "error" : verification.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: copied ? summary : `${summary} · clipboard unavailable`, variant, duration: 6_000, sessionID })
        return verification
      } catch (error) {
        safeToast({ title: "verify failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
        return undefined
      }
    }
    // The record, in reach: ask whether every sha the ledger quotes is an ancestor of HEAD at the host's cwd, copy the Markdown ancestry report, toast the outcome. The dialog row paints the same counts through its in-place ack. Not on this line is not misconduct (another branch, a rewrite, a record that predates the merge); unknown is never folded into no; a sweep that cannot probe comes back all-unknown and says so.
    const reachRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined): ReachOutcome | undefined => {
      if (!goal || !sessionID) return undefined
      try {
        const directory = process.cwd()
        const reach = reachRecord(goal, gitAncestorProbe(directory))
        const report = reachReportMarkdown(goal, reach, Date.now(), directory)
        let copied = false
        try {
          copied = context.renderer.copyToClipboardOSC52(report)
        } catch {
          copied = false
        }
        const summary = reachSummaryLine(reach)
        const title = reach.unreached > 0 ? "record does not reach HEAD" : reach.unknown > 0 ? "record unverifiable" : reach.unique === 0 ? "nothing to place" : "record reaches HEAD"
        const variant = reach.unreached > 0 || reach.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: copied ? summary : `${summary} · clipboard unavailable`, variant, duration: 6_000, sessionID })
        return reach
      } catch (error) {
        safeToast({ title: "reach check failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
        return undefined
      }
    }
    // The record, under seal: ask whether git verifies a signature on every sha the ledger quotes at the host's cwd, copy the Markdown signature report, toast the outcome. The dialog row paints the same counts through its in-place ack. Not signed is not misconduct (git decides by its own rules against the keys it trusts here; most commits are unsigned); unknown is never folded into not signed; a sweep that cannot probe comes back all-unknown and says so.
    const signRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined): SignOutcome | undefined => {
      if (!goal || !sessionID) return undefined
      try {
        const directory = process.cwd()
        const sign = signRecord(goal, gitSignProbe(directory))
        const report = signReportMarkdown(goal, sign, Date.now(), directory)
        let copied = false
        try {
          copied = context.renderer.copyToClipboardOSC52(report)
        } catch {
          copied = false
        }
        const summary = signSummaryLine(sign)
        const title = sign.unverified > 0 ? "record not under seal" : sign.unknown > 0 ? "record unverifiable" : sign.unique === 0 ? "nothing to attest" : "record under seal"
        const variant = sign.unverified > 0 || sign.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: copied ? summary : `${summary} · clipboard unavailable`, variant, duration: 6_000, sessionID })
        return sign
      } catch (error) {
        safeToast({ title: "sign check failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
        return undefined
      }
    }
    // The sealed dossier, on trial again: re-probe every sha named in the newest `goal-dossier-sealed-*.md` in the host's cwd against the repository here, copy the Markdown drift report, toast the outcome. This answers what the counterparty holding the file asks later: is what the file attested still true. Drift means git flipped a yes to a no since sealing — an error is never the right variant for that (the repository moved, or the seal was made elsewhere; that is information, not misconduct). No file, an unsealed file, and an unparsable appendix are named as such; `unknown` is never folded into `regressed`.
    const attestSealedDossierAction = (sessionID: string | undefined) => {
      try {
        const directory = process.cwd()
        let candidates: { name: string; mtimeMs: number }[]
        try {
          candidates = readdirSync(directory).map((name) => {
            try {
              return { name, mtimeMs: statSync(join(directory, name)).mtimeMs }
            } catch {
              return { name, mtimeMs: 0 }
            }
          })
        } catch (error) {
          safeToast({ title: "attest failed", message: `cannot read ${directory}: ${String(error instanceof Error ? error : error).slice(0, 160)}`, variant: "error", duration: 5_000, sessionID })
          return
        }
        const newest = selectNewestSealedDossier(candidates)
        if (!newest) {
          safeToast({ title: "no sealed dossier", message: `no goal-dossier-sealed-*.md in ${directory} — seal one first with goal.dossier.seal`, variant: "warning", duration: 6_000, sessionID })
          return
        }
        let markdown: string
        try {
          markdown = readFileSync(join(directory, newest), "utf8")
        } catch (error) {
          safeToast({ title: "attest failed", message: `cannot read ${newest}: ${String(error instanceof Error ? error : error).slice(0, 160)}`, variant: "error", duration: 5_000, sessionID })
          return
        }
        const result = attestSealedDossier(markdown, directory)
        if (result.kind === "unsealed") {
          safeToast({ title: "not a sealed dossier", message: `${newest} carries no attestation appendix`, variant: "warning", duration: 6_000, sessionID })
          return
        }
        if (result.kind === "unparsable") {
          safeToast({ title: "attestation unreadable", message: `${newest}: the appendix heading is present but no row parses`, variant: "warning", duration: 6_000, sessionID })
          return
        }
        const report = attestationReportMarkdown(result, Date.now(), directory, newest)
        let copied = false
        try {
          copied = context.renderer.copyToClipboardOSC52(report)
        } catch {
          copied = false
        }
        const summary = attestSummaryLine(result)
        const title = result.regressed > 0 ? "attestation drifted" : result.unknown > 0 ? "attestation unverifiable" : result.unique === 0 ? "nothing to attest" : "attestation holds"
        const variant = result.regressed > 0 || result.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: copied ? summary : `${summary} · clipboard unavailable`, variant, duration: 6_000, sessionID })
      } catch (error) {
        safeToast({ title: "attest failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
      }
    }
    // The review, in one file: run all three sweeps (existence, ancestry, the seal) against the repository at the host's cwd and write one O_EXCL file — the record's own bytes, then a combined appendix whose rows carry every answer git gave, per sha, with one verdict column. This is the artifact a reviewer opens cold; the standalone verify/reach/sign reports remain available one question at a time. Gaps and unknowns toast a warning, never an error: the appendix says what git answered, and git's thresholds differ across machines and time — information is not accusation.
    const reviewRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => {
      if (!goal || !sessionID) return
      try {
        const result = exportReview(goal, Date.now(), process.cwd())
        const summary = reviewSummaryLine(result)
        const title = result.unique === 0 ? "nothing to review" : result.gaps > 0 ? "review written with gaps" : result.unknown > 0 ? "review unverifiable" : "review written"
        const variant = result.gaps > 0 || result.unknown > 0 ? "warning" : "success"
        safeToast({ title, message: `${result.path} · ${summary}`, variant, duration: 6_000, sessionID })
      } catch (error) {
        safeToast({ title: "review failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
      }
    }
    // The spend story, one file: write one O_EXCL markdown spend report — one row per landed loop iteration (the harness's usage delta: cost, tokens in/out/reasoning, cache read/write, tool calls, sha), then totals over exactly the measured iterations, then an honesty footer. Partial measurement says so and never reads as $0.00; an unmeasured iteration renders —. This is the artifact for capacity retros and evaluator cost audits; the dossier remains the whole-record story.
    const spendLedgerAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined) => {
      if (!goal || !sessionID) return
      try {
        const result = exportSpendLedger(goal, Date.now(), process.cwd())
        const summary = spendSummaryLine(result)
        const title = result.iterations === 0 ? "nothing to report" : result.measured < result.iterations ? "spend ledger written (partial)" : "spend ledger written"
        const variant = result.iterations === 0 || result.measured < result.iterations ? "warning" : "success"
        safeToast({ title, message: `${result.path} · ${summary}`, variant, duration: 6_000, sessionID })
      } catch (error) {
        safeToast({ title: "spend report failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
      }
    }
    // The record, sealed: run all three sweeps (existence, ancestry, the seal) against the repository at the host's cwd and write the sealed dossier — the record's own bytes plus a freshly probed attestation appendix — as one O_EXCL file. Never overwrites; a failed write says so instead of failing silently. Gaps and unknowns toast a warning, never an error: the appendix says what git answered, and git's thresholds differ across machines and time — information is not accusation.
    const sealRecordAction = (sessionID: string | undefined, goal: GoalSnapshot | null | undefined): SealOutcome | undefined => {
      if (!goal || !sessionID) return undefined
      try {
        const result = exportSealedDossier(goal, Date.now(), process.cwd())
        const summary = sealSummaryLine(result)
        const title = result.unique === 0 ? "nothing to seal" : result.clean === result.unique ? "record sealed" : "record sealed with gaps"
        const variant = result.clean === result.unique ? "success" : "warning"
        safeToast({ title, message: `${result.path} · ${summary}`, variant, duration: 6_000, sessionID })
        return result
      } catch (error) {
        safeToast({ title: "seal failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
        return undefined
      }
    }
    // The inventory, one file: scan the host's cwd for the dossier family's exported artifacts (goal-dossier-*.md, goal-dossier-review-*.md, goal-dossier-sealed-*.md, goal-spend-ledger-*.md, and previous goal-dossier-index-*.md files) and write ONE O_EXCL markdown index — file name, kind, bytes (UTF-8), sha256 — then totals, then an honesty footer. The index inventories; it does not verify. A previous index is listed as kind index; the index being written never lists itself. Enabled always: it reads files, not the record.
    const dossierIndexAction = (sessionID: string | undefined) => {
      try {
        const result = exportDossierIndex(Date.now(), process.cwd())
        const summary = dossierIndexSummaryLine(result)
        const title = result.artifacts === 0 ? "no artifacts found" : result.skipped > 0 ? "index written with gaps" : "dossier index written"
        const variant = result.artifacts === 0 || result.skipped > 0 ? "warning" : "success"
        safeToast({ title, message: `${result.path} · ${summary}`, variant, duration: 6_000, sessionID })
      } catch (error) {
        safeToast({ title: "index failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
      }
    }
    // The HUD's clear affordances are one stray hover-click away from erasing an armed loop and its
    // history (the dialog's [clear goal], the card footer button, the danger row in the context menu,
    // and both palette commands). Every clear path funnels through the host's native confirm dialog;
    // it fails closed — when the host dialog is unavailable or dismissed, nothing is cleared. The
    // message names what is actually lost so the decision is informed, not reflexive.
    const requestClearGoal = (sessionID: string | undefined) => {
      if (!sessionID) return
      try {
        const g = live(sessionID) ?? entries()[sessionID]?.goal
        const message = g?.loopEnabled
          ? `Clear the armed loop (iteration ${g.loopIteration ?? 1}${typeof g.loopMaxLoops === "number" && g.loopMaxLoops > 0 ? ` of at most ${g.loopMaxLoops}` : ""}) and its full history? This cannot be undone.`
          : "Clear the armed goal and its history? This cannot be undone."
        void context.ui.dialog
          .confirm({ title: "Clear goal", message, label: { confirm: "clear goal", cancel: "keep" } })
          .then((ok) => {
            if (ok !== true) return
            // A confirmed wipe must never fail silently: report the rejection with the same
            // grammar as a failed copy, so the user learns the goal is still armed.
            const clearFailed = (error: unknown) =>
              safeToast({ title: "clear failed", message: String(error instanceof Error ? error : error).slice(0, 200), variant: "error", duration: 5_000, sessionID })
            try {
              void rpc.clear({ sessionID }, at(sessionID)).catch(clearFailed)
            } catch (error) {
              clearFailed(error)
            }
          })
          .catch(() => {
            // Fail closed: no confirmation, no clear.
          })
      } catch {
        // Fail closed: no confirmation, no clear.
      }
    }
    const openDashboard = (sessionID: string | undefined) => {
      if (!sessionID) return
      try {
        const g = entries()[sessionID]?.goal
        // showStatusDialog disarms the card at the choke point; nothing to reset here.
        showStatusDialog(sessionID, g?.condition ?? "goal")
      } catch {
        // Dialog reporting handles its own errors.
      }
    }
    context.ui.slot({
      append: "session.composer.top",
      render: (props) => {
        const [hovered, setHovered] = createSignal(false)
        const goal = createMemo(() => {
          try {
            return live(props.sessionID)
          } catch {
            return undefined
          }
        })
        // Completion moment: a live→terminal transition leaves a short-lived acknowledgment
        // snapshot behind so the pill does not blink out (see noteTerminal).
        const terminal = () => {
          try {
            return props.sessionID ? terminalAcks()[props.sessionID]?.goal : undefined
          } catch {
            return undefined
          }
        }
        const showing = () => goal() ?? terminal()
        const elapsed = () => {
          try {
            const g = goal()
            if (!g || !props.sessionID) return 0
            return elapsedOf(g, entries()[props.sessionID]?.receivedAt, now())
          } catch {
            return 0
          }
        }
        // Declared above pill(): the pill's budget subtracts the landing acknowledgment suffix measured
        // in CELLS (stringWidth), never in code units, and pillText() rides the same suffix. Single source.
        const landingNow = () => props.sessionID !== undefined && landing().has(props.sessionID)
        const pill = () => {
          try {
            const g = goal()
            // Budget the label to the measured terminal cells: 1-cell left padding + 1-cell right margin,
          // minus the landing acknowledgment suffix when it rides the same line (cells, not .length),
          // minus the caret cell (▴/▾) that trails the pill on the same row.
          // Walks the degradation ladder (retry → compact → turns → pips) before truncating the core,
          // so an 80-column floor never clips the state the pill exists to show.
          const landingSfx = () => landingSuffix(motionDisabled(process.env))
          const budget = Math.max(8, mountWidthOr() - 2 - (landingNow() ? stringWidth(landingSfx()) : 0) - 2) // -2: the caret cell rides the same row
          if (g) return pillModel(g, elapsed(), motionDisabled(process.env), budget, motionOk ? breathPhase() : undefined)
            const t = terminal()
            // The acknowledgment renders the frozen final elapsed; the goal is over, no extrapolation.
            // Same cell budget as the live pill: the ack never paints past the row either.
            return t ? terminalPill(t, t.elapsedMs, motionDisabled(process.env), budget) : undefined
          } catch {
            return undefined
          }
        }
        const dimensions = useTerminalDimensions()
        const pinnedNow = () => isPinned(props.sessionID)
        // No leading affordance: the dot begins the line (Workstream XV). The click contract stays —
        // left click toggles the card, right click opens the detail view — it just is not advertised by chrome.
        const pillText = () => {
          const model = pill()
          if (!model) return ""
          const landed = landingNow() ? landingSuffix(motionDisabled(process.env)) : ""
          const base = model.text + landed
          if (!pinnedNow()) return base
          const g = goal()
          // The pinned condition rides the jump row so it stays visible while the conversation scrolls;
          // truncated to whatever cells remain after the state prefix.
          return g ? base + pinSuffix(g.condition, pinBudget(mountWidthOr(), base), motionDisabled(process.env)) : base
        }
        // The breath: the ring swells through `◦ ○ ◎ ○` on a 2.4s cycle (crest = ◎) — presence, not animation.
        // It runs while the loop is genuinely alive (working, or a transient window: evaluating, hot
        // compaction, the just-achieved flash, the landing acknowledgment) and never otherwise —
        // waiting, paused, stuck and terminal states are static. The crest phase is the only beat
        // that may carry bold (evaluating / hot / flash / landing); plain working never goes bold.
        // Under reduced motion (NO_COLOR / TERM=dumb) the dot paints its static resting face and
        // weight goes permanently to evaluating / hot.
        const workingNow = () => {
          const g = goal()
          return g !== undefined && g.status === "active" && g.waiting !== true && !isRetryStuck(g)
        }
        const animated = () => {
          const g = goal()
          return pillMotionNeeded({ working: workingNow(), evaluating: g?.evaluating === true, hot: g !== undefined && isCompactHot(g), flashing: props.sessionID !== undefined && flashing().has(props.sessionID), landing: landingNow() })
        }
        createEffect(() => {
          // The pill is always painted while showing() (it is the accordion's persistent stripe, see
          // the mount below), so the breath advances whenever the loop is alive — open or closed.
          if (animated() && motionOk) {
            const timer = setInterval(() => setBreathPhase((phase) => (phase + 1) % 4), BREATH_PHASE_MS)
            onCleanup(() => clearInterval(timer))
            return
          }
          setBreathPhase(0)
        })
        // The crest beat belongs to the transients, never to plain working: an evaluating / hot /
        // flash / landing goal flexes at the top of the breath; an armed-and-working loop does not.
        const transientNow = () => {
          const g = goal()
          return pillMotionNeeded({ evaluating: g?.evaluating === true, hot: g !== undefined && isCompactHot(g), flashing: props.sessionID !== undefined && flashing().has(props.sessionID), landing: landingNow() })
        }
        const pillAttrs = () => {
          const hoverBold = hovered() ? TextAttributes.BOLD : 0
          const g = goal()
          // Reduced motion: no phase ever advances, so weight goes permanently to evaluating / hot —
          // the mono contract keeps weight as a first-class channel.
          const peak = motionOk ? breathCrest(breathPhase()) && transientNow() : g?.evaluating === true || (g !== undefined && isCompactHot(g))
          const attrs = hoverBold | (peak ? TextAttributes.BOLD : 0)
          return attrs === 0 ? undefined : attrs
        }
        const color = () => {
          if (reducedColor) return context.theme.text.muted
          if (landingNow()) return context.theme.text.feedback.info.base
          const tone = pill()?.tone
          if (tone === "paused" || tone === "hot" || tone === "retrying" || tone === "impossible") return context.theme.text.feedback.warning.base
          if (tone === "failed") return context.theme.text.feedback.error?.base ?? context.theme.text.feedback.warning.base
          if (tone === "evaluating" || tone === "waiting") return context.theme.text.feedback.info.base
          // The completion flash speaks the ledger grammar: worked met flashes green on hosts exposing success, satisfied-at-HEAD stays info blue — absent data never upgrades the paint.
          if (tone === "achieved") return achievedAckAccentColor(context.theme as unknown as NeutralTheme<ColorInput>, (terminal() ?? goal())?.history, false)
          return context.theme.text.muted
        }
        // The card mounts inside the composer (the v2 sidebar sits beside it), so the width is the
        // mount's own resolved width — measured off the outer absolute box and snapped on every layout
        // change (sidebar toggle, terminal resize). useTerminalDimensions() is the full screen, sidebar
        // included; painting at that width ran the card out past the composer into the sidebar region,
        // flush-clipped mid-sentence with no ellipsis. The anchor (top={-(1 + cardRows())}), the row plan and
        // the painted card all agree on this number.
        const [mountWidth, setMountWidth] = createSignal<number | undefined>(undefined)
        const mountWidthOr = () => mountWidth() ?? dimensions().width
        const cardFor = () => {
          const g = showing()
          return g && getHudSession() === props.sessionID ? g : undefined
        }
        // Drop the measured mount width when the card disarms: the probe box unmounts with the card,
        // so a composer resize while the HUD is closed goes unobserved. Without the reset, re-arming
        // paints one layout pass at the stale width (the card into the sidebar region on a shrink)
        // until the probe's first onSizeChange snaps it back. With it, re-open waits for a fresh measure.
        createEffect(() => {
          if (!cardFor()) setMountWidth(undefined)
        })
        // Viewport ceiling for the card: one row for the host slot above the prompt, one for the global status line;
        // the row plan drops teaching rows to fit (mirror of ClampedColumn's `height - 1`, with an 8-row floor).
        const maxCardRows = () => Math.max(8, dimensions().height - 2)
        // The panel's body yields one row to the pill stripe beneath it (the accordion's bottom seam),
        // so the total footprint (pill row + body) never exceeds the old one-budget ceiling.
        const maxBodyRows = () => Math.max(8, maxCardRows() - 1)
        // The anchor must measure the same width the card paints with (the mount's width) or the reserved
        // rows drift from the painted rows on wide terminals.
        const cardRows = () => {
          const g = cardFor()
          return g ? hudCardRows(g, contextOpen(), maxBodyRows(), mountWidthOr()) : 0
        }
        const toggleHud = () => {
          try {
            // While the status dialog owns the screen the pill is a no-op — arming the card
            // behind the modal re-creates the dialog-behind-card layering bug.
            if (statusDialogOpen()) return
            setContextOpen(false)
            setHudSession((current) => (props.sessionID && current === props.sessionID ? undefined : props.sessionID))
          } catch {}
        }
        return (
          <ErrorBoundary fallback={() => <box />}>
          <Show when={showing()}>
            {/* The accordion: the pill is the persistent stripe on the jump row and the panel's
                bottom seam — always mounted while showing(). Left click toggles the card open or
                closed (the panel expands upward from the pill, anchored at top={-(1 + cardRows())});
                right click opens the dashboard. The caret cell rides the same row: ▴ when the panel
                is collapsed (its content hidden above), ▾ when open (click again to collapse). */}
            <box
              position="absolute"
              top={-1}
              left={0}
              height={1}
              paddingLeft={1}
              flexDirection="row"
              onMouseOver={() => setHovered(true)}
              onMouseOut={() => setHovered(false)}
              onMouseUp={(event) => {
                try {
                  if (!props.sessionID) return
                  // Right click opens the dashboard directly; left click toggles the card; other buttons are inert.
                  if (event.button === 2) openDashboard(props.sessionID)
                  else if (event.button === 0) toggleHud()
                } catch {}
              }}
            >
              <text fg={color()} wrapMode="none" attributes={pillAttrs()}>
                {pillText()}
              </text>
              <text fg={context.theme.text.faint} wrapMode="none" flexShrink={0}>{cardFor() ? " ▾" : " ▴"}</text>
            </box>
            {/* The accordion's expanding panel: collapses to the persistent pill stripe above, expands
                upward from it. The pill is the panel's bottom seam when open — top={-(1 + cardRows())}
                anchors the body one row above the pill's top={-1} stripe, zIndex=10 keeps it opaque. */}
            <Show when={cardFor()}>
              {(g) => (
                <box
                  position="absolute"
                  top={-(1 + cardRows())}
                  left={0}
                  right={0}
                  height={cardRows()}
                  zIndex={10}
                  ref={(el) => {
                    // This box is the mount's width probe: left=0 right=0 resolves to exactly the
                    // mount, so snapshot it at creation and snap it on every layout pass (sidebar
                    // toggle, terminal resize). It must NOT sit behind the width-dependent gate —
                    // mounting it is what sets the width.
                    el.onSizeChange = () => {
                      const w = el.width
                      if (w > 0) setMountWidth(w)
                    }
                    const w = el.width
                    if (w > 0) setMountWidth(w)
                  }}
                >
                  {/* The card itself waits for the mount's own width: painting at the terminal's
                      width while the composer sits beside the sidebar is the bug this fixes. */}
                  <Show when={mountWidth() !== undefined}>
                  <HudCard
                    goal={g()}
                    width={mountWidthOr()}
                    theme={context.theme as unknown as HudCardTheme}
                    mono={reducedColor}
                    elapsedMs={elapsed}
                    onClose={() => { setContextOpen(false); setHudSession(undefined) }}
                    onDetails={() => { setContextOpen(false); openDashboard(props.sessionID) }}
                    onClear={() => {
                      setContextOpen(false)
                      setHudSession(undefined)
                      requestClearGoal(props.sessionID)
                    }}
                    onCopyCondition={(condition) => copyToClipboard(condition, props.sessionID)}
                    contextOpen={contextOpen()}
                    maxRows={maxBodyRows()}
                    onToggleContext={() => setContextOpen((v) => { const next = !v; if (next) setContextIndex(0); return next })}
                    menuSelected={() => contextIndex()}
                    onCloseMenu={() => { setContextOpen(false); setContextIndex(0) }}
                    onCopyReason={(reason) => copyToClipboard(reason, props.sessionID, "reason")}
                    onCopySummary={(summary) => copyToClipboard(summary, props.sessionID, "summary")}
                    onCopyDossier={() => { const g = entries()[props.sessionID]?.goal; if (g) copyToClipboard(buildLoopDossier(g, Date.now()), props.sessionID, "dossier") }}
                    onSaveDossier={() => exportDossier(props.sessionID, entries()[props.sessionID]?.goal)}
                    pinned={pinnedNow()}
                    onTogglePin={() => togglePin(props.sessionID)}
                  />
                  </Show>
                </box>
              )}
            </Show>
          </Show>
          </ErrorBoundary>
        )
      },
    })

    // Esc dismisses the compact HUD card. Same posture as the dialog scroll layer: only enabled
    // while the card is open, so it never intercepts prompt editing; the host's modal layers own Esc otherwise.
    // It also disarms while the status dialog owns the screen — the deeper zoom level eats Esc first (no priority contest).
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      enabled: () => getHudSession() !== undefined && !statusDialogOpen(),
      commands: [
        {
          id: "goal.hud.dismiss",
          title: "Goal HUD: dismiss",
          group: "Goal",
          bind: "escape",
          enabled: () => getHudSession() !== undefined && !statusDialogOpen(),
          run: () => { try { if (contextOpen()) { setContextOpen(false); setContextIndex(0) } else { setHudSession(undefined) } } catch {} },
        },
      ],
    }))

    // ↑/↓/enter over the card's context menu — the keyboard twin of right-click + left-click. Enabled
    // only while the menu is open (and the dialog does not own the screen), so the keys never intercept
    // prompt editing; esc rides the dismiss layer above, which collapses the menu before the card.
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      enabled: () => getHudSession() !== undefined && !statusDialogOpen() && contextOpen(),
      commands: [
        {
          id: "goal.hud.menu-up",
          title: "Goal HUD menu: move up",
          group: "Goal",
          bind: "up",
          enabled: () => contextOpen(),
          run: () => { try { setContextIndex((v) => nextMenuIndex(v, -1, contextRowsFor(getHudSession()))) } catch {} },
        },
        {
          id: "goal.hud.menu-down",
          title: "Goal HUD menu: move down",
          group: "Goal",
          bind: "down",
          enabled: () => contextOpen(),
          run: () => { try { setContextIndex((v) => nextMenuIndex(v, 1, contextRowsFor(getHudSession()))) } catch {} },
        },
        {
          id: "goal.hud.menu-activate",
          title: "Goal HUD menu: activate the selected row",
          group: "Goal",
          bind: "enter",
          enabled: () => contextOpen(),
          run: () => activateContextMenu(getHudSession()),
        },
      ],
    }))

    // Scrolling keys and the pin toggle for the status dialog. Plain arrow keys are safe here: the
    // commands are only enabled while the dialog is open, so they never intercept prompt editing.
    // Closing the dialog is
    // the host's job — `ui.dialog.show` puts the host in modal mode, whose built-in layer binds
    // escape and ctrl+c to dismiss the top dialog and run its onClose. The commands themselves are
    // the pure factory in core/dialog-keys.ts, so the advertised keymap is unit-tested without the
    // host.
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      enabled: () => statusDialogOpen(),
      commands: dialogStatusCommands({
        open: statusDialogOpen,
        session: statusDialogSession,
        togglePin,
        toggleExpanded: () => setIterationsExpanded((v) => !v),
        condition: () => {
          const sessionID = statusDialogSession()
          return sessionID ? entries()[sessionID]?.goal?.condition : undefined
        },
        reason: () => {
          const sessionID = statusDialogSession()
          return sessionID ? entries()[sessionID]?.goal?.reason : undefined
        },
        transcriptFor: (row) => foreignLiveRows(others(), statusDialogSession())[row - 1]?.sessionID,
        openTranscript: (sessionID) => {
          try {
            context.ui.router.navigate({ type: "session", sessionID })
          } catch {
            // The host detached — the chord is chrome, not a command.
          }
        },
        foreignMoreVisible: () => foreignLiveRows(others(), statusDialogSession()).length > FOREIGN_ROWS_VISIBLE,
        toggleForeignMore: () => setForeignMoreExpanded((v) => !v),
        toggleView: () => setDialogView((v) => (v === "overview" ? "ledger" : v === "ledger" ? "dossier" : "overview")),
        copy: (text, sessionID, what) => copyToClipboard(text, sessionID, what),
        flashCopied: flashStatusCopied,
        scrollBy: (cells) => {
          scrollRef()?.scrollBy(cells)
        },
        scrollTo: (cell) => {
          scrollRef()?.scrollTo(cell)
        },
      }),
    }))

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "goal.status",
          title: "Goal: show status",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            const sessionID = currentSession()
            if (sessionID) void rpc.status({ sessionID }, at(sessionID)).catch(() => {})
          },
        },
        {
          id: "goal.clear",
          title: "Goal: clear",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())),
          run: () => requestClearGoal(currentSession()),
        },
        {
          id: "goal.loop.status",
          title: "Goal loop: show status",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())?.loopEnabled),
          run: () => {
            const sessionID = currentSession()
            if (sessionID) void rpc.status({ sessionID }, at(sessionID)).catch(() => {})
          },
        },
        {
          id: "goal.hud.toggle",
          title: "Goal HUD: toggle card",
          group: "Goal",
          palette: true,
          enabled: () => hudArmEnabled(Boolean(live(currentSession())), statusDialogOpen()),
          run: () => {
            // Same effect as clicking the pill: toggle the compact card for the current session.
            // No-op while the status dialog owns the screen — arming the card behind the modal
            // would paint it beneath the dialog and re-arm its Esc layer.
            try {
              if (statusDialogOpen()) return
              const sessionID = currentSession()
              setContextOpen(false)
              setHudSession((current) => (sessionID && current === sessionID ? undefined : sessionID))
            } catch {}
          },
        },
        {
          id: "goal.pin.toggle",
          title: "Goal: toggle pinned condition",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())),
          run: () => { try { togglePin(currentSession()) } catch {} },
        },
        {
          id: "goal.condition.copy",
          title: "Goal: copy condition",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal?.condition),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              if (goal?.condition && sessionID) copyToClipboard(goal.condition, sessionID)
            } catch {}
          },
        },
        {
          id: "goal.reason.copy",
          title: "Goal: copy evaluator reason",
          group: "Goal",
          palette: true,
          enabled: () => Boolean((live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal)?.reason),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              if (goal?.reason && sessionID) copyToClipboard(goal.reason, sessionID, "reason")
            } catch {}
          },
        },
        {
          id: "goal.summary.copy",
          title: "Goal: copy latest loop summary",
          group: "Goal",
          palette: true,
          enabled: () => Boolean((live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal)?.loopHistory?.at(-1)?.summary),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              const summary = goal?.loopHistory?.at(-1)?.summary
              if (summary && sessionID) copyToClipboard(summary, sessionID, "summary")
            } catch {}
          },
        },
        {
          id: "goal.dossier.copy",
          title: "Goal: copy loop dossier (markdown)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              if (goal && sessionID) copyToClipboard(buildLoopDossier(goal, Date.now()), sessionID, "dossier")
            } catch {}
          },
        },
        {
          id: "goal.dossier.export",
          title: "Goal: export loop dossier (markdown file)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              exportDossier(sessionID, goal)
            } catch {}
          },
        },
        {
          id: "goal.dossier.verify",
          title: "Goal: verify the record (shas + markdown report)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              verifyRecordAction(sessionID, goal)
            } catch {}
          },
        },
        {
          id: "goal.dossier.reach",
          title: "Goal: verify the record reaches HEAD (shas + markdown report)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              reachRecordAction(sessionID, goal)
            } catch {}
          },
        },
        {
          id: "goal.dossier.sign",
          title: "Goal: verify the record's signatures (shas + markdown report)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              signRecordAction(sessionID, goal)
            } catch {}
          },
        },
        {
          id: "goal.dossier.seal",
          title: "Goal: seal the dossier with a fresh attestation (file)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              sealRecordAction(sessionID, goal)
            } catch {}
          },
        },
        {
          id: "goal.dossier.attest",
          title: "Goal: attest a sealed dossier against HEAD (drift report)",
          group: "Goal",
          palette: true,
          enabled: () => true,
          run: () => {
            try {
              attestSealedDossierAction(currentSession())
            } catch {}
          },
        },
        {
          id: "goal.dossier.review",
          title: "Goal: review the dossier in one file (every question git can answer)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              reviewRecordAction(sessionID, goal)
            } catch {}
          },
        },
        {
          id: "goal.dossier.spend",
          title: "Goal: export the spend ledger (markdown report)",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
          run: () => {
            try {
              const sessionID = currentSession()
              const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal
              spendLedgerAction(sessionID, goal)
            } catch {}
          },
        },
        {
          id: "goal.dossier.index",
          title: "Goal: index the exported dossier artifacts (markdown)",
          group: "Goal",
          palette: true,
          enabled: () => true,
          run: () => {
            try {
              dossierIndexAction(currentSession())
            } catch {}
          },
        },
        {
          id: "goal.loop.clear",
          title: "Goal loop: clear",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())?.loopEnabled),
          run: () => requestClearGoal(currentSession()),
        },
      ],
    }))

    return () => {
      clearInterval(timer)
      pumpController.abort()
      if (statusCopiedTimer) clearTimeout(statusCopiedTimer)
      for (const pending of terminalTimers) clearTimeout(pending)
      terminalTimers.clear()
      setTerminalAcks({})
      setFlashing(new Set<string>())
      setLanding(new Set<string>())
      setStatusDialogOpen(false)
      setStatusDialogSession(undefined)
      setScrollRef(undefined)
    }
  },
})
