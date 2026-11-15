/**
 * Terminal UI for opencode-goal: a compact goal indicator in the prompt footer, verdict toasts and notifications,
 * the `/goal` status dialog, and palette actions. Purely presentational; all state lives in the server plugin and
 * arrives over RPC. Everything renders through the host's own UI primitives: the `prompt.footer` slot for the
 * indicator, `ui.toast.show` for transitions, and `ui.dialog.show` (host backdrop, Esc handling, sizing) for the
 * detail view. No overlays, no absolutely positioned boxes, no custom colors — theme tokens only.
 */
import { Plugin } from "@opencode/plugin/tui"
import type { ScrollBoxRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import { formatDurationCoarse, GOAL_GLYPH } from "./core/format.ts"
import { isLive, type GoalSnapshot, type Notice } from "./core/types.ts"
import { StatusDialogBody } from "./status-dialog.tsx"
import { renderPips } from "./core/history.ts"
import { GoalRpc } from "./rpc.ts"

interface Entry {
  readonly goal: GoalSnapshot | null
  /** Client clock when the snapshot arrived; elapsed time is extrapolated from it to avoid clock skew. */
  readonly receivedAt: number
}

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
    const [scrollRef, setScrollRef] = createSignal<ScrollBoxRenderable | undefined>(undefined)
    const requested = new Set<string>()

    const statusBody = (sessionID: string, fallback: string) => {
      const entry = () => entries()[sessionID]
      const goal = () => entry()?.goal ?? undefined
      const elapsed = () => {
        const g = goal()
        return g ? elapsedOf(g, entry()?.receivedAt, now()) : 0
      }
      return <StatusDialogBody goal={goal()} fallback={fallback} theme={context.theme} elapsedMs={elapsed} nowMs={() => now()} />
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
      setScrollRef(undefined)
    }
    const showStatusDialog = (sessionID: string, fallback: string) => {
      try {
        showStatusDialogInner(sessionID, fallback)
      } catch (error) {
        try {
          context.ui.toast.show({ title: "goal plugin error (dialog)", message: String((error as Error)?.stack ?? error).slice(0, 900), variant: "error", duration: 30000 })
        } catch {
          // Even the error toast must not take the plugin down.
        }
      }
    }
    const showStatusDialogInner = (sessionID: string, fallback: string) => {
      setScrollRef(undefined)
      // Pull a fresh snapshot (with spend) so the dialog renders current data; the notice text stays the fallback.
      void refresh(sessionID).catch(() => {})
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
                {GOAL_GLYPH} /goal{looped() ? ` · loop${loopPosition()}` : ""}
              </text>
              <box flexShrink={0} paddingLeft={1} paddingRight={1} onMouseUp={() => closeStatusDialog()}>
                <text fg={context.theme.text.muted}>esc</text>
              </box>
            </box>
            <scrollbox ref={(el) => setScrollRef(el)} scrollX={false} flexGrow={1} stickyScroll={false} contentOptions={{ minHeight: 0 }}>
              {statusBody(sessionID, fallback)}
            </scrollbox>
            <text fg={context.theme.text.faint}>up/down scroll · pgup/pgdn page · home/end start/end · esc close</text>
          </ClampedColumn>
        ),
        () => {
          setStatusDialogOpen(false)
          setScrollRef(undefined)
        },
      )
      context.ui.dialog.set({ size: "xlarge", centered: true })
      setStatusDialogOpen(true)
    }

    /** RPC calls are routed to the plugin instance of the session's location. */
    const at = (sessionID: string) => {
      const location = context.data.session.get(sessionID)?.location ?? context.location
      return location ? { location } : undefined
    }

    /** Pull a fresh snapshot from the server and cache it. */
    const refresh = (sessionID: string) =>
      rpc.get({ sessionID }, at(sessionID)).then((result) => put(sessionID, (result as { goal: GoalSnapshot | null }).goal))

    const put = (sessionID: string, goal: GoalSnapshot | null) =>
      setEntries((previous) => {
        const existing = previous[sessionID]
        // Keep the old entry (and its receivedAt) when nothing changed: elapsed time still extrapolates correctly, and the render tree stays untouched.
        if (existing && goalsEqual(existing.goal, goal)) return previous
        return { ...previous, [sessionID]: { goal, receivedAt: Date.now() } }
      })

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
        title: `${GOAL_GLYPH} ${notice.title}`,
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
        const data = event?.data as { sessionID?: unknown; goal?: GoalSnapshot | null } | undefined
        if (data && typeof data.sessionID === "string") put(data.sessionID, data.goal ?? null)
      } catch {
        // A malformed event must not take the plugin's render tree down.
      }
    })
    const offNotice = rpc.events.on("notice", (event) => {
      try {
        onNotice(event?.data as unknown as Notice)
      } catch {
        // Same.
      }
    })

    // Minute-resolution clock, ticking only while some goal is active.
    const timer = setInterval(() => {
      if (Object.values(entries()).some((entry) => entry.goal?.status === "active")) setNow(Date.now())
    }, TICK_MS)

    // Compact indicator in the native prompt-footer row, same slot the built-in session status uses
    // (`prompt.footer`, claimed with `append` by the host's own PromptFooter plugin). The host row owns
    // layout, spacing and baseline alignment; this only contributes a themed, non-wrapping text segment.
    // Hidden in shell mode to match the built-in footer, which swaps to its shell hint and drops usage/cost.
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => {
        const goal = createMemo(() => {
          try {
            return props.mode === "normal" ? live(props.sessionID) : undefined
          } catch {
            return undefined
          }
        })
        const label = createMemo(() => {
          try {
            const g = goal()
            if (!g || !props.sessionID) return ""
            const entry = entries()[props.sessionID]
            const elapsed = elapsedOf(g, entry?.receivedAt, now())
            const state = g.status === "paused" ? "paused" : g.evaluating ? "checking" : g.waiting ? "waiting" : "active"
            const turns = g.turns > 0 ? ` · ${g.turns} turn${g.turns === 1 ? "" : "s"}` : ""
            if (g.loopEnabled) {
              const cap = typeof g.loopMaxLoops === "number" && g.loopMaxLoops > 0 ? `/${g.loopMaxLoops}` : ""
              const pips = renderPips(g.loopHistory?.length ?? 0, g.loopMaxLoops)
              return `${GOAL_GLYPH} loop · v${g.loopIteration ?? 1}${cap}${pips ? ` ${pips}` : ""} · ${state} · ${formatDurationCoarse(elapsed)}${turns}`
            }
            return `${GOAL_GLYPH} goal ${state} · ${formatDurationCoarse(elapsed)}${turns}`
          } catch {
            return ""
          }
        })
        const color = () => {
          try {
            return goal()?.status === "paused" ? context.theme.text.feedback.warning.base : goal()?.evaluating ? context.theme.text.feedback.info.base : context.theme.text.muted
          } catch {
            return context.theme.text.muted
          }
        }
        return (
          <Show when={goal()}>
            <box flexShrink={0} onMouseUp={() => { try { if (props.sessionID) context.keymap.dispatch("goal.status") } catch {} }}>
              <text fg={color()} wrapMode="none">
                {label()}
              </text>
            </box>
          </Show>
        )
      },
    })

    // Scrolling keys for the status dialog. Plain arrow keys are safe here: the commands are only
    // enabled while the dialog is open, so they never intercept prompt editing. Closing the dialog is
    // the host's job — `ui.dialog.show` puts the host in modal mode, whose built-in layer binds
    // escape and ctrl+c to dismiss the top dialog and run its onClose.
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      enabled: () => statusDialogOpen(),
      commands: [
        {
          id: "goal.status.scroll-up",
          title: "Goal status: scroll up",
          group: "Goal",
          bind: "up",
          enabled: () => statusDialogOpen(),
          run: () => { try { scrollRef()?.scrollBy(-3) } catch {} },
        },
        {
          id: "goal.status.scroll-down",
          title: "Goal status: scroll down",
          group: "Goal",
          bind: "down",
          enabled: () => statusDialogOpen(),
          run: () => { try { scrollRef()?.scrollBy(3) } catch {} },
        },
        {
          id: "goal.status.page-up",
          title: "Goal status: page up",
          group: "Goal",
          bind: "pageup",
          enabled: () => statusDialogOpen(),
          run: () => { try { scrollRef()?.scrollBy(-15) } catch {} },
        },
        {
          id: "goal.status.page-down",
          title: "Goal status: page down",
          group: "Goal",
          bind: "pagedown",
          enabled: () => statusDialogOpen(),
          run: () => { try { scrollRef()?.scrollBy(15) } catch {} },
        },
        {
          id: "goal.status.home",
          title: "Goal status: scroll to start",
          group: "Goal",
          bind: "home",
          enabled: () => statusDialogOpen(),
          run: () => { try { scrollRef()?.scrollTo(0) } catch {} },
        },
        {
          id: "goal.status.end",
          title: "Goal status: scroll to end",
          group: "Goal",
          bind: "end",
          enabled: () => statusDialogOpen(),
          run: () => { try { scrollRef()?.scrollTo(Number.MAX_SAFE_INTEGER) } catch {} },
        },
      ],
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
          run: () => {
            const sessionID = currentSession()
            if (sessionID) void rpc.clear({ sessionID }, at(sessionID)).catch(() => {})
          },
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
          id: "goal.loop.clear",
          title: "Goal loop: clear",
          group: "Goal",
          palette: true,
          enabled: () => Boolean(live(currentSession())?.loopEnabled),
          run: () => {
            const sessionID = currentSession()
            if (sessionID) void rpc.clear({ sessionID }, at(sessionID)).catch(() => {})
          },
        },
      ],
    }))

    return () => {
      clearInterval(timer)
      offChanged()
      offNotice()
      setStatusDialogOpen(false)
      setScrollRef(undefined)
    }
  },
})
