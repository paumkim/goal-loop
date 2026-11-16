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
import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js"
import { goalGlyph } from "./core/format.ts"
import { buildLoopDossier } from "./core/dossier.ts"
import { exportLoopDossier } from "./core/dossier-export.ts"
import { isLive, type GoalSnapshot, type Notice } from "./core/types.ts"
import { StatusDialogBody, foreignLiveRows, FOREIGN_ROWS_VISIBLE } from "./status-dialog.tsx"
import { HudCard, hudCardRows, cardWidth, pinBudget, DialogFooter, type HudCardTheme } from "./hud-card.tsx"
import { scrollbarChrome } from "./core/scrollbar.ts"
import { pillModel, pillCaret, pinSuffix, motionDisabled, terminalPill, hudArmEnabled, TERMINAL_ACK_MS, ACK_FLASH_MS, LANDING_ACK_MS, landingSuffix, isCompactHot, pillMotionNeeded, achievedAckAccentColor, contextMenuRows, nextMenuIndex, CONTEXT_MENU_COPY_CONDITION, CONTEXT_MENU_COPY_REASON, CONTEXT_MENU_COPY_SUMMARY, CONTEXT_MENU_COPY_DOSSIER, CONTEXT_MENU_SAVE_DOSSIER, CONTEXT_MENU_CLEAR, type NeutralTheme } from "./core/hud.ts"
import { preserveContextSize, pruneSnapshotEntries, type GoalSnapshotCacheEntry } from "./core/entries.ts"
import { GoalRpc } from "./rpc.ts"
import { dialogStatusCommands } from "./core/dialog-keys.ts"
import { parseChangedEvent, parseGetGoalOutput, parseListGoalOutput, parseNotice } from "./core/wire.ts"

type Entry = GoalSnapshotCacheEntry

const TICK_MS = 15_000
const ATTENTION_KINDS: ReadonlySet<string> = new Set(["achieved", "impossible", "failed", "paused"])

/** Snapshots arrive over RPC and from local helpers, so compare by value (key order is stable) to keep redundant `changed` events from re-rendering. */
/** Elapsed wall time for display: the record's elapsed plus the idle time since the snapshot arrived (live goals only). */
const elapsedOf = (g: GoalSnapshot, receivedAt: number | undefined, nowMs: number) =>
  g.status === "active" ? g.elapsedMs + Math.max(0, nowMs - (receivedAt ?? nowMs)) : g.elapsedMs

const goalsEqual = (a: GoalSnapshot | null, b: GoalSnapshot | null) => {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Host xlarge dialogs size to their content and can outgrow the terminal; clamping the column to the
 * viewport (minus one row) keeps the header and hint pinned while the scrollbox gives way. The terminal
 * dimensions hook only works inside a rendered component (plugins mount before the renderer exists), so
 * the clamp lives in its own tiny component rendered by the dialog, never in plugin setup.
 */
const ClampedColumn = (props: { children?: JSX.Element }) => {
  const dimensions = useTerminalDimensions()
  return (
    <box flexDirection="column" height="100%" maxHeight={Math.max(8, dimensions().height - 1)} paddingLeft={3} paddingRight={3} paddingBottom={1} gap={1}>
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

    const statusBody = (sessionID: string, fallback: string) => {
      const entry = () => entries()[sessionID]
      const goal = () => entry()?.goal ?? undefined
      const elapsed = () => {
        const g = goal()
        return g ? elapsedOf(g, entry()?.receivedAt, now()) : 0
      }
      return <StatusDialogBody goal={goal()} fallback={fallback} theme={context.theme} elapsedMs={elapsed} nowMs={() => now()} onCopyCondition={(condition) => copyToClipboard(condition, sessionID)} onCopyReason={(reason) => copyToClipboard(reason, sessionID, "reason")} onCopySummary={(summary) => copyToClipboard(summary, sessionID, "summary")} onCopyAttestation={(line) => copyToClipboard(line, sessionID, "attestation")} onCopyTally={(line) => copyToClipboard(line, sessionID, "tally")} onCopyVerify={(tail) => copyToClipboard(tail, sessionID, "verify")} onCopyDossier={() => { const g = entries()[sessionID]?.goal; if (g) copyToClipboard(buildLoopDossier(g, Date.now()), sessionID, "dossier") }} onSaveDossier={() => { const g = entries()[sessionID]?.goal; exportDossier(sessionID, g) }} onCopyDossierSection={(label, raw) => copyToClipboard(raw, sessionID, "section")} onViewTranscript={(target) => { try { context.ui.router.navigate({ type: "session", sessionID: target }) } catch { /* the host detached — the click is chrome, not a command */ } }} mono={reducedColor} expanded={() => iterationsExpanded()} onToggleExpanded={() => setIterationsExpanded((v) => !v)} view={() => dialogView()} onViewChange={(v) => setDialogView(v)} expandedOthers={() => foreignMoreExpanded()} onToggleExpandedOthers={() => setForeignMoreExpanded((v) => !v)} noticeStale={() => dialogNoticeStale()} others={others()} sessionLabel={sessionLabel} />
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
      void refresh(sessionID).then((fresh) => { if (!fresh) setDialogNoticeStale(true) }).catch(() => setDialogNoticeStale(true))
      void refreshOthers()
      const looped = () => Boolean(entries()[sessionID]?.goal?.loopEnabled)
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
              verticalScrollbarOptions={{ trackOptions: scrollbarChrome(context.theme, reducedColor), showArrows: false }}>
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
      const location = context.data.session.get(sessionID)?.location ?? context.location
      return location ? { location } : undefined
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
    // like the ack registry. A view acknowledgment riding the existing pulse — never state, never stored.
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

    /** Pull a fresh snapshot from the server and cache it. Resolves false when the payload is malformed — the caller treats it exactly like a rejection (stale chrome must never pass as fresh). */
    const refresh = (sessionID: string): Promise<boolean> =>
      rpc.get({ sessionID }, at(sessionID)).then((result) => {
        const output = parseGetGoalOutput(result)
        if (!output) return false
        put(sessionID, output.goal)
        return true
      })

    const put = (sessionID: string, goal: GoalSnapshot | null) => {
      // Completion-moment detection runs before the entries update: a live→terminal transition
      // arms the acknowledgment pill, a fresh live goal disarms any stale one. Best-effort.
      try {
        const previous = entries()[sessionID]?.goal
        // An identical snapshot changes nothing — skip re-arming so the ack window stays 45s from the transition.
        const unchanged = previous && goal ? goalsEqual(previous, goal) : false
        if (!unchanged && goal && previous && isLive(previous.status) && !isLive(goal.status) && goal.status !== "cleared") {
          noteTerminal(sessionID, goal)
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
      // The `get` RPC pull carries the context estimate; `changed` events usually do not — carry it forward.
      const mergedGoal = preserveContextSize(entries()[sessionID]?.goal, goal)
      return setEntries((previous) => {
        const existing = previous[sessionID]
        // Keep the old entry (and its receivedAt) when nothing changed: elapsed time still extrapolates correctly, and the render tree stays untouched.
        if (existing && goalsEqual(existing.goal, mergedGoal)) return previous
        const next = { ...previous, [sessionID]: { goal: mergedGoal, receivedAt: Date.now() } }
        // Drop null entries (unless a dialog is rendering that session) and cap the map.
        return pruneSnapshotEntries(next, statusDialogSession())
      })
    }

    /** Lazily fetches a session's goal the first time a view asks for it; events keep it fresh afterwards. */
    const ensure = (sessionID: string) => {
      if (requested.has(sessionID)) return
      requested.add(sessionID)
      refresh(sessionID).catch(() => requested.delete(sessionID))
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
          void context.attention.notify({
            title: `OpenCode \u00B7 ${notice.title}`,
            message: notice.message,
            notification: { when: "blurred" },
            sound: { name: notice.kind === "achieved" ? "done" : "error", when: "blurred" },
          })
        } catch {
          // Attention is best-effort; the toast already landed.
        }
    }

    const offChanged = rpc.events.on("changed", (event) => {
      try {
        const parsed = parseChangedEvent(event?.data)
        if (parsed) put(parsed.sessionID, parsed.goal)
        if (statusDialogOpen()) void refreshOthers()
      } catch {
        // A malformed event must not take the plugin's render tree down.
      }
    })
    const offNotice = rpc.events.on("notice", (event) => {
      try {
        const notice = parseNotice(event?.data)
        if (notice) onNotice(notice)
      } catch {
        // Same.
      }
    })

    // Minute-resolution clock, ticking only while some goal is active.
    const timer = setInterval(() => {
      if (Object.values(entries()).some((entry) => entry.goal?.status === "active")) setNow(Date.now())
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
    // Reduced motion: no pulse, no animation. Evaluated once — a user toggling NO_COLOR mid-session gets it on next launch.
    const motionOk = !motionDisabled(process.env)
    // Reduced color: NO_COLOR / TERM=dumb also drop the plugin's chromatic accents (weight and glyphs carry meaning). Same env predicate as the motion guard.
    const reducedColor = !motionOk
    const [pulse, setPulse] = createSignal(false)

    // Claims the empty left side of the host's jump-to-latest row (the 1-row strip directly above the
    // input prompt) for the ambient goal pill: a zero-flow absolute 1-row box at top={-1}. Left click
    // toggles the compact HUD card (level b — bordered floating panel above the jump row); right click
    // opens the full `/goal` dashboard (level c — same host dialog as `goal.status`). Pinning the condition
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
          // 2 cells for the open/closed caret prefix, minus the landing acknowledgment suffix when it rides
          // the same line (cells, not .length). Walks the degradation ladder (retry → compact → turns → pips)
          // before truncating the core, so an 80-column floor never clips the state the pill exists to show.
          const landingSfx = () => landingSuffix(motionDisabled(process.env))
          const budget = Math.max(1, dimensions().width - 4 - (landingNow() ? stringWidth(landingSfx()) : 0))
          if (g) return pillModel(g, elapsed(), motionDisabled(process.env), budget)
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
        // The leading caret is the pill's open/closed affordance: ▾ while the card is painted, ▸ while
        // it is not. Keyed to the card actually rendering (not merely the session's hud slot), so the
        // glyph never claims “open” over a missing card. Two cells, already reserved by the label budget.
        const caret = () =>
          pillCaret(getHudSession() === props.sessionID && cardFor() !== undefined, motionDisabled(process.env)) + " "
        const pillText = () => {
          const model = pill()
          if (!model) return ""
          const landed = landingNow() ? landingSuffix(motionDisabled(process.env)) : ""
          const prefix = caret()
          if (!pinnedNow()) return prefix + model.text + landed
          const g = goal()
          // The pinned condition rides the jump row so it stays visible while the conversation scrolls;
          // truncated to whatever cells remain after the state prefix.
          const base = prefix + model.text + landed
          return g ? base + pinSuffix(g.condition, pinBudget(dimensions().width, base), motionDisabled(process.env)) : base
        }
        // Soft pulse while the evaluator is thinking, and an amber shimmer while the compaction
        // request is running hot: bold flips on a slow tick, only while evaluating/hot; reduced
        // motion/NO_COLOR/TERM=dumb gets a static pill (motionOk stays false).
        // Motion is live while the evaluator is thinking, the compaction request runs hot, or the just-achieved flash window is open. The flash rides the same slow bold-flip as the evaluating pulse — it only exists for the first ACK_FLASH_MS of the ack pill, then the pill goes static. The goal() read is undefined once terminal; the flash is keyed off the session alone.
        const animated = () => {
          const g = goal()
          return pillMotionNeeded({ evaluating: g?.evaluating === true, hot: g !== undefined && isCompactHot(g), flashing: props.sessionID !== undefined && flashing().has(props.sessionID), landing: landingNow() })
        }
        createEffect(() => {
          if (animated() && motionOk) {
            const timer = setInterval(() => setPulse((value) => !value), 850)
            onCleanup(() => clearInterval(timer))
            return
          }
          setPulse(false)
        })
        const pillAttrs = () => {
          const hoverBold = hovered() ? TextAttributes.BOLD : 0
          const bold = animated() && pulse() && motionOk ? TextAttributes.BOLD : 0
          const attrs = hoverBold | bold
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
        const cardFor = () => {
          const g = showing()
          return g && getHudSession() === props.sessionID ? g : undefined
        }
        // Viewport ceiling for the card: one row for the host slot above the prompt, one for the global status line;
        // the row plan drops teaching rows to fit (mirror of ClampedColumn's `height - 1`, with an 8-row floor).
        const maxCardRows = () => Math.max(8, dimensions().height - 2)
        const cardRows = () => {
          const g = cardFor()
          return g ? hudCardRows(g, contextOpen(), maxCardRows(), cardWidth(dimensions().width)) : 0
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
          <Show when={showing()}>
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
            </box>
            <Show when={cardFor()}>
              {(g) => (
                <box position="absolute" top={-cardRows()} left={0} height={cardRows()} zIndex={10}>
                  <HudCard
                    goal={g()}
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
                    maxRows={maxCardRows()}
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
                </box>
              )}
            </Show>
          </Show>
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
          enabled: () => Boolean(live(currentSession())?.loopEnabled ?? entries()[currentSession() ?? ""]?.goal?.loopEnabled),
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
          enabled: () => hudArmEnabled(Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal), statusDialogOpen()),
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
          enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
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
      if (statusCopiedTimer) clearTimeout(statusCopiedTimer)
      for (const pending of terminalTimers) clearTimeout(pending)
      terminalTimers.clear()
      setTerminalAcks({})
      offChanged()
      offNotice()
      setFlashing(new Set<string>())
      setLanding(new Set<string>())
      setStatusDialogOpen(false)
      setStatusDialogSession(undefined)
      setScrollRef(undefined)
    }
  },
})
