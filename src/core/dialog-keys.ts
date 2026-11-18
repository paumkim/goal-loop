/**
 * The status dialog's keyboard commands, as a pure factory — so the advertised keymap (the footer's
 * `up/down`, `pgup/pgdn`, `home/end`, and the `p` / `c` / `x` chords, plus the reason chord `r`) is
 * testable without the host. The TUI plugin spreads the returned commands straight into
 * `context.keymap.layer({ mode: "global", priority: 100, ... })`; this module imports nothing from
 * @opentui on purpose. The structural command shape matches the host's KeymapCommand contract —
 * the site that consumes it type-checks against the real one, so drift fails the build.
 *
 * When the host also wires `transcriptFor` + `openTranscript` (the elsewhere block's jump route),
 * four digit chords join the factory — `1`..`4` open the transcript of the matching elsewhere row.
 * Keyboard parity for the mouse affordance the dialog paints; absent wiring, no digits exist.
 * When the host additionally wires `foreignMoreVisible` + `toggleForeignMore` (the elsewhere overflow
 * fold), the `m` chord joins after the digits — it flips the same controlled flag the click-to-expand
 * fold row flips. Absent wiring, no chord exists. The `t` chord (cycles the view tab: overview →
 * ledger → dossier) joins after `m` when the host wires `toggleView` — the keyboard twin of the tab
 * strip. Absent wiring, no chord exists. None of the three is advertised in the footer (the three
 * plugin chords stay p/c/x); they ride the same grammar as `r`.
 */

/** Cells one arrow key scrolls the dialog body. */
export const DIALOG_LINE_CELLS = 3
/** Cells one page key scrolls — a page of dense rail rows. */
export const DIALOG_PAGE_CELLS = 15
/** scrollTo target for the `end` chord: beyond any real scroll height. */
export const SCROLL_END = Number.MAX_SAFE_INTEGER

/** Structural twin of the host's KeymapCommand (run signature included). */
interface DialogStatusCommand {
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
  /** The sessionID of elsewhere row `index` (1-based, paint order), or undefined when no such row is painted. Wired together with openTranscript; either alone yields no digit chords. */
  readonly transcriptFor?: (index: number) => string | undefined
  /** Open the transcript route for `sessionID`. */
  readonly openTranscript?: (sessionID: string) => void
  /** Whether more than the elsewhere fold cap of live foreign goals is painted — arms the `m` chord. Wired together with toggleForeignMore. */
  readonly foreignMoreVisible?: () => boolean
  /** Flip the elsewhere overflow fold (the same controlled flag the fold row flips). */
  readonly toggleForeignMore?: () => void
  /** Cycle the dialog's view tab (overview → ledger → dossier) — the keyboard twin of the strip. Single dep; the host wires it whenever the strip is live. */
  readonly toggleView?: () => void
}

/**
 * The ten core commands, in footer-reading order (pin, fold, copies, the digit chords and the `m` fold chord and the `t` view chord when wired, then the scroll ladder). Sixteen with both wired plus the view chord.
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
    ...(deps.transcriptFor && deps.openTranscript
      ? [1, 2, 3, 4].map(
          (row): DialogStatusCommand => ({
            id: `goal.status.transcript-${row}`,
            title: `Goal status: open transcript of other session ${row}`,
            group: "Goal",
            bind: String(row),
            enabled: () => deps.open() && Boolean(deps.transcriptFor?.(row)),
            run: () => {
              // Same swallow posture as every chord here — a detached host or a stale row must never throw out of a key event.
              try {
                const id = deps.transcriptFor?.(row)
                if (id) deps.openTranscript?.(id)
              } catch {}
            },
          }),
        )
      : []),
    ...(deps.foreignMoreVisible && deps.toggleForeignMore
      ? [
          {
            id: "goal.status.elsewhere-more",
            title: "Goal status: show or fold the other sessions list",
            group: "Goal",
            bind: "m",
            enabled: () => deps.open() && deps.foreignMoreVisible?.() === true,
            run: () => {
              // Same swallow posture as every chord here.
              try {
                deps.toggleForeignMore?.()
              } catch {}
            },
          } satisfies DialogStatusCommand,
        ]
      : []),
    ...(deps.toggleView
      ? [
          {
            id: "goal.status.view-toggle",
            title: "Goal status: cycle the views (overview, iteration ledger, dossier)",
            group: "Goal",
            bind: "t",
            enabled,
            run: () => {
              // Same swallow posture as every chord here.
              try {
                deps.toggleView?.()
              } catch {}
            },
          } satisfies DialogStatusCommand,
        ]
      : []),
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
