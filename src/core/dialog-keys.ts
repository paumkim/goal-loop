/**
 * The status dialog's keyboard commands, as a pure factory — so the advertised keymap (the footer's
 * `up/down`, `pgup/pgdn`, `home/end`, and the `p` / `c` / `x` chords, plus the reason chord `r`) is
 * testable without the host. The TUI plugin spreads the returned commands straight into
 * `context.keymap.layer({ mode: "global", priority: 100, ... })`; this module imports nothing from
 * @opentui on purpose. The structural command shape matches the host's KeymapCommand contract —
 * the site that consumes it type-checks against the real one, so drift fails the build.
 */

/** Cells one arrow key scrolls the dialog body. */
export const DIALOG_LINE_CELLS = 3
/** Cells one page key scrolls — a page of dense rail rows. */
export const DIALOG_PAGE_CELLS = 15
/** scrollTo target for the `end` chord: beyond any real scroll height. */
export const SCROLL_END = Number.MAX_SAFE_INTEGER

/** Structural twin of the host's KeymapCommand (run signature included). */
export interface DialogStatusCommand {
  readonly id: string
  readonly title: string
  readonly group: string
  readonly bind: string
  readonly enabled: () => boolean
  readonly run: (input?: string, event?: unknown) => void
}

export interface DialogStatusDeps {
  /** True while the status dialog is open — the layer's own gate decides reachability; each command gates itself the same way. */
  readonly open: () => boolean
  /** The session the dialog is showing, if any. */
  readonly session: () => string | undefined
  /** Toggle the pinned condition for a session. */
  readonly togglePin: (sessionID: string | undefined) => void
  /** Expand or fold older iterations (the rail's `x` chord and its fold row). */
  readonly toggleExpanded: () => void
  /** The dialog goal's condition, when the snapshot has one. */
  readonly condition: () => string | undefined
  /** The dialog goal's reason, when the snapshot has one. */
  readonly reason: () => string | undefined
  /** Clipboard write; mirrors the host's copyToClipboard argument order. `what` defaults to "condition". */
  readonly copy: (text: string, sessionID: string | undefined, what?: "condition" | "reason" | "summary") => void
  /** In-modal acknowledgment — the footer's `[copied]` flip. */
  readonly flashCopied: () => void
  /** Scroll the dialog body by a signed cell delta (negative = up). */
  readonly scrollBy: (cells: number) => void
  /** Jump the dialog body to an absolute cell offset. */
  readonly scrollTo: (cell: number) => void
}

/**
 * The ten dialog commands, in footer-reading order (pin, fold, copies, then the scroll ladder).
 * Every handler swallows its errors: a dead snapshot or a detached scrollbox must never throw out
 * of a key event — host modal chrome owns the interaction, the plugin owns nothing here.
 */
export const dialogStatusCommands = (deps: DialogStatusDeps): readonly DialogStatusCommand[] => {
  const enabled = () => deps.open()
  return [
    {
      id: "goal.status.pin",
      title: "Goal status: toggle pinned condition",
      group: "Goal",
      bind: "p",
      enabled,
      run: () => {
        try {
          deps.togglePin(deps.session())
        } catch {}
      },
    },
    {
      id: "goal.status.history",
      title: "Goal status: show or fold older iterations",
      group: "Goal",
      bind: "x",
      enabled,
      run: () => {
        try {
          deps.toggleExpanded()
        } catch {}
      },
    },
    {
      id: "goal.status.copy",
      title: "Goal status: copy condition",
      group: "Goal",
      bind: "c",
      enabled,
      run: () => {
        try {
          const text = deps.condition()
          if (!text) return
          deps.copy(text, deps.session())
          deps.flashCopied()
        } catch {}
      },
    },
    {
      // Keyboard twin of clicking the evaluator/reason row: the same payload, in-modal ack for free.
      id: "goal.status.copy-evaluator-reason",
      title: "Goal status: copy evaluator reason",
      group: "Goal",
      bind: "r",
      enabled,
      run: () => {
        try {
          const text = deps.reason()
          if (!text) return
          deps.copy(text, deps.session(), "reason")
          deps.flashCopied()
        } catch {}
      },
    },
    {
      id: "goal.status.scroll-up",
      title: "Goal status: scroll up",
      group: "Goal",
      bind: "up",
      enabled,
      run: () => {
        try {
          deps.scrollBy(-DIALOG_LINE_CELLS)
        } catch {}
      },
    },
    {
      id: "goal.status.scroll-down",
      title: "Goal status: scroll down",
      group: "Goal",
      bind: "down",
      enabled,
      run: () => {
        try {
          deps.scrollBy(DIALOG_LINE_CELLS)
        } catch {}
      },
    },
    {
      id: "goal.status.page-up",
      title: "Goal status: page up",
      group: "Goal",
      bind: "pageup",
      enabled,
      run: () => {
        try {
          deps.scrollBy(-DIALOG_PAGE_CELLS)
        } catch {}
      },
    },
    {
      id: "goal.status.page-down",
      title: "Goal status: page down",
      group: "Goal",
      bind: "pagedown",
      enabled,
      run: () => {
        try {
          deps.scrollBy(DIALOG_PAGE_CELLS)
        } catch {}
      },
    },
    {
      id: "goal.status.home",
      title: "Goal status: scroll to start",
      group: "Goal",
      bind: "home",
      enabled,
      run: () => {
        try {
          deps.scrollTo(0)
        } catch {}
      },
    },
    {
      id: "goal.status.end",
      title: "Goal status: scroll to end",
      group: "Goal",
      bind: "end",
      enabled,
      run: () => {
        try {
          deps.scrollTo(SCROLL_END)
        } catch {}
      },
    },
  ]
}
