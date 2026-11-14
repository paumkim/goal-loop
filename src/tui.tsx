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
import { createMemo, createSignal, Show } from "solid-js"
import { formatDurationCoarse, GOAL_GLYPH } from "./core/format.ts"
import type { GoalSnapshot, Notice } from "./core/types.ts"
import { GoalRpc } from "./rpc.ts"

interface Entry {
  readonly goal: GoalSnapshot | null
  /** Client clock when the snapshot arrived; elapsed time is extrapolated from it to avoid clock skew. */
  readonly receivedAt: number
}

const TICK_MS = 15_000
const ATTENTION_KINDS: ReadonlySet<string> = new Set(["achieved", "impossible", "failed", "paused"])

export default Plugin.define({
  id: "opencode-goal.tui",
  setup(context) {
    const rpc = context.client.rpc(GoalRpc)
    const [entries, setEntries] = createSignal<Readonly<Record<string, Entry>>>({})
    const [now, setNow] = createSignal(Date.now())
    const [statusDialogOpen, setStatusDialogOpen] = createSignal(false)
    const [scrollRef, setScrollRef] = createSignal<ScrollBoxRenderable | undefined>(undefined)
    const requested = new Set<string>()

    /**
     * Long status text gets a large, scrollable dialog instead of the truncating alert. The host owns the
     * chrome: backdrop, z-index, focus, Esc/ctrl+c dismissal (see `ui/dialog.tsx` in the host sources,
     * `DialogProvider`'s modal keymap layer). The body mirrors the host's `DialogLayout`/`DialogHeader`
     * conventions (`paddingLeft/Right: DIALOG_INSET`, gap 1, bottom pad 1, bold title left, "esc" right);
     * those internals are not exported to plugins, so the layout is re-created with the same constants and
     * theme tokens instead of being imported.
     */
    const showStatusDialog = (title: string, message: string) => {
      setScrollRef(undefined)
      // Set the flag after show() so the onClose of a dialog replaced by this call cannot flip it back off.
      context.ui.dialog.show(
        () => (
          <box flexDirection="column" height="100%" paddingLeft={3} paddingRight={3} paddingBottom={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <text attributes={TextAttributes.BOLD} fg={context.theme.text.base}>
                {title}
              </text>
              <text fg={context.theme.text.muted} flexShrink={0}>
                esc
              </text>
            </box>
            <scrollbox ref={(el) => setScrollRef(el)} scrollbarOptions={{ visible: true }} flexGrow={1} stickyScroll={false}>
              <text wrapMode="word" fg={context.theme.text.base}>
                {message}
              </text>
            </scrollbox>
            <text fg={context.theme.text.muted}>up/down scroll · pgup/pgdn page · home/end start/end · esc close</text>
          </box>
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

    const put = (sessionID: string, goal: GoalSnapshot | null) =>
      setEntries((previous) => ({ ...previous, [sessionID]: { goal, receivedAt: Date.now() } }))

    /** Lazily fetches a session's goal the first time a view asks for it; events keep it fresh afterwards. */
    const ensure = (sessionID: string) => {
      if (requested.has(sessionID)) return
      requested.add(sessionID)
      rpc
        .get({ sessionID }, at(sessionID))
        .then((result) => put(sessionID, (result as { goal: GoalSnapshot | null }).goal))
        .catch(() => requested.delete(sessionID))
    }

    const live = (sessionID: string | undefined) => {
      if (!sessionID) return undefined
      ensure(sessionID)
      const goal = entries()[sessionID]?.goal
      return goal && (goal.status === "active" || goal.status === "paused") ? goal : undefined
    }

    const currentSession = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    const onNotice = (notice: Notice) => {
      const here = currentSession() === notice.sessionID
      if (notice.kind === "status") {
        // formatStatus() repeats the title in its first line ("Goal active: ..."); don't print it twice.
        const body = notice.message.startsWith(notice.title) ? notice.message : `${notice.title}\n\n${notice.message}`
        if (here) showStatusDialog(`${GOAL_GLYPH} /goal`, body)
        return
      }
      const important = ATTENTION_KINDS.has(notice.kind)
      if (!here && !important) return
      // Passing sessionID lets the host offer an "Open" action when the notice belongs to a session family
      // that is not currently open (see the plugin toast adapter in the host sources, plugin/api.tsx).
      context.ui.toast.show({
        title: `${GOAL_GLYPH} ${notice.title}`,
        message: notice.message,
        variant: notice.level,
        sessionID: notice.sessionID,
        duration: notice.level === "error" || notice.level === "warning" ? 8_000 : 4_000,
      })
      if (important)
        void context.attention.notify({
          title: `OpenCode \u00B7 ${notice.title}`,
          message: notice.message,
          notification: { when: "blurred" },
          sound: { name: notice.kind === "achieved" ? "done" : "error", when: "blurred" },
        })
    }

    const offChanged = rpc.events.on("changed", (event) => {
      const data = event.data as { sessionID?: unknown; goal?: GoalSnapshot | null }
      if (typeof data.sessionID === "string") put(data.sessionID, data.goal ?? null)
    })
    const offNotice = rpc.events.on("notice", (event) => onNotice(event.data as unknown as Notice))

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
        const goal = createMemo(() => (props.mode === "normal" ? live(props.sessionID) : undefined))
        const label = createMemo(() => {
          const g = goal()
          if (!g || !props.sessionID) return ""
          const entry = entries()[props.sessionID]
          const elapsed = g.status === "active" ? g.elapsedMs + Math.max(0, now() - (entry?.receivedAt ?? now())) : g.elapsedMs
          const state = g.status === "paused" ? "paused" : g.evaluating ? "checking" : g.waiting ? "waiting" : "active"
          const turns = g.turns > 0 ? ` · ${g.turns} turn${g.turns === 1 ? "" : "s"}` : ""
          return `${GOAL_GLYPH} goal ${state} · ${formatDurationCoarse(elapsed)}${turns}`
        })
        const color = () =>
          goal()?.status === "paused" ? context.theme.text.feedback.warning.base : goal()?.evaluating ? context.theme.text.feedback.info.base : context.theme.text.muted
        return (
          <Show when={goal()}>
            <box flexShrink={0} onMouseUp={() => props.sessionID && context.keymap.dispatch("goal.status")}>
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
          run: () => scrollRef()?.scrollBy(-3),
        },
        {
          id: "goal.status.scroll-down",
          title: "Goal status: scroll down",
          group: "Goal",
          bind: "down",
          enabled: () => statusDialogOpen(),
          run: () => scrollRef()?.scrollBy(3),
        },
        {
          id: "goal.status.page-up",
          title: "Goal status: page up",
          group: "Goal",
          bind: "pageup",
          enabled: () => statusDialogOpen(),
          run: () => scrollRef()?.scrollBy(-15),
        },
        {
          id: "goal.status.page-down",
          title: "Goal status: page down",
          group: "Goal",
          bind: "pagedown",
          enabled: () => statusDialogOpen(),
          run: () => scrollRef()?.scrollBy(15),
        },
        {
          id: "goal.status.home",
          title: "Goal status: scroll to start",
          group: "Goal",
          bind: "home",
          enabled: () => statusDialogOpen(),
          run: () => scrollRef()?.scrollTo(0),
        },
        {
          id: "goal.status.end",
          title: "Goal status: scroll to end",
          group: "Goal",
          bind: "end",
          enabled: () => statusDialogOpen(),
          run: () => scrollRef()?.scrollTo(Number.MAX_SAFE_INTEGER),
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
