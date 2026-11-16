/**
 * The dialog's advertised keyboard — the `p` / `x` / `c` / `r` chords and the four scroll keys —
 * with the host subtracted. The commands are the pure factory from src/core/dialog-keys.ts (the
 * same array the TUI spreads into context.keymap.layer), so a binding regression or a lost catch
 * fails here, not in someone's key event. The layer-level reachability gate (`enabled`) and each
 * command's own gate are both pinned: closed dialog → nothing reachable, by contract.
 */
import { describe, expect, test } from "bun:test"
import { DIALOG_LINE_CELLS, DIALOG_PAGE_CELLS, SCROLL_END, dialogStatusCommands, type DialogStatusDeps } from "../src/core/dialog-keys.ts"

interface SpyDeps extends DialogStatusDeps {
  readonly calls: { togglePin: (string | undefined)[]; toggleExpanded: number; copy: [string, string | undefined, string | undefined][]; flashCopied: number; scrollBy: number[]; scrollTo: number[] }
}

const spyDeps = (overrides: Partial<DialogStatusDeps> = {}): SpyDeps => {
  const calls = { togglePin: [] as (string | undefined)[], toggleExpanded: 0, copy: [] as [string, string | undefined, string | undefined][], flashCopied: 0, scrollBy: [] as number[], scrollTo: [] as number[] }
  const deps: SpyDeps = {
    open: () => true,
    session: () => "ses_1",
    togglePin: (sessionID) => {
      calls.togglePin.push(sessionID)
    },
    toggleExpanded: () => {
      calls.toggleExpanded += 1
    },
    condition: () => "make every iteration visible",
    reason: () => "evaluator: not yet",
    copy: (text, sessionID, what) => {
      calls.copy.push([text, sessionID, what])
    },
    flashCopied: () => {
      calls.flashCopied += 1
    },
    scrollBy: (cells) => {
      calls.scrollBy.push(cells)
    },
    scrollTo: (cell) => {
      calls.scrollTo.push(cell)
    },
    ...overrides,
    calls,
  }
  return deps
}

const byId = (deps: SpyDeps) => Object.fromEntries(dialogStatusCommands(deps).map((command) => [command.id, command]))

describe("dialogStatusCommands", () => {
  test("returns the ten advertised commands in footer order with stable ids and binds", () => {
    const commands = dialogStatusCommands(spyDeps())
    expect(commands.map((command) => [command.id, command.bind])).toEqual([
      ["goal.status.pin", "p"],
      ["goal.status.history", "x"],
      ["goal.status.copy", "c"],
      ["goal.status.copy-evaluator-reason", "r"],
      ["goal.status.scroll-up", "up"],
      ["goal.status.scroll-down", "down"],
      ["goal.status.page-up", "pageup"],
      ["goal.status.page-down", "pagedown"],
      ["goal.status.home", "home"],
      ["goal.status.end", "end"],
    ])
    expect(new Set(commands.map((command) => command.group))).toEqual(new Set(["Goal"]))
  })

  test("every command's enabled() mirrors the dialog-open gate — closed dialog, no reachable command", () => {
    const commands = dialogStatusCommands(spyDeps({ open: () => false }))
    expect(commands.length).toBe(10)
    for (const command of commands) expect(command.enabled()).toBe(false)
    const open = dialogStatusCommands(spyDeps({ open: () => true }))
    for (const command of open) expect(command.enabled()).toBe(true)
  })

  test("the scroll ladder: arrows by DIALOG_LINE_CELLS, pages by DIALOG_PAGE_CELLS, end beyond any height", () => {
    const deps = spyDeps()
    const commands = byId(deps)
    commands["goal.status.scroll-up"]!.run()
    commands["goal.status.scroll-down"]!.run()
    commands["goal.status.page-up"]!.run()
    commands["goal.status.page-down"]!.run()
    commands["goal.status.home"]!.run()
    commands["goal.status.end"]!.run()
    expect(deps.calls.scrollBy).toEqual([-DIALOG_LINE_CELLS, DIALOG_LINE_CELLS, -DIALOG_PAGE_CELLS, DIALOG_PAGE_CELLS])
    expect(deps.calls.scrollTo).toEqual([0, SCROLL_END])
    expect(DIALOG_LINE_CELLS).toBe(3)
    expect(DIALOG_PAGE_CELLS).toBe(15)
  })

  test("p toggles the pin for the dialog's session — undefined session is passed through, not guessed", () => {
    const deps = spyDeps()
    byId(deps)["goal.status.pin"]!.run()
    expect(deps.calls.togglePin).toEqual(["ses_1"])
    const noSession = spyDeps({ session: () => undefined })
    byId(noSession)["goal.status.pin"]!.run()
    expect(noSession.calls.togglePin).toEqual([undefined])
  })

  test("c copies the condition (default copy ack) and flashes; nothing to copy means no copy and no flash", () => {
    const deps = spyDeps()
    byId(deps)["goal.status.copy"]!.run()
    expect(deps.calls.copy).toEqual([["make every iteration visible", "ses_1", undefined]])
    expect(deps.calls.flashCopied).toBe(1)
    const absent = spyDeps({ condition: () => undefined })
    byId(absent)["goal.status.copy"]!.run()
    expect(absent.calls.copy).toEqual([])
    expect(absent.calls.flashCopied).toBe(0)
  })

  test("r copies the reason with the 'reason' payload kind and flashes; absent reason stays inert", () => {
    const deps = spyDeps()
    byId(deps)["goal.status.copy-evaluator-reason"]!.run()
    expect(deps.calls.copy).toEqual([["evaluator: not yet", "ses_1", "reason"]])
    expect(deps.calls.flashCopied).toBe(1)
    const absent = spyDeps({ reason: () => undefined })
    byId(absent)["goal.status.copy-evaluator-reason"]!.run()
    expect(absent.calls.copy).toEqual([])
    expect(absent.calls.flashCopied).toBe(0)
  })

  test("x toggles the older-iterations fold once per press", () => {
    const deps = spyDeps()
    byId(deps)["goal.status.history"]!.run()
    byId(deps)["goal.status.history"]!.run()
    expect(deps.calls.toggleExpanded).toBe(2)
  })

  test("a throwing dependency never escapes a key event — the modal owns the failure, silently", () => {
    const deps = spyDeps({
      togglePin: () => {
        throw new Error("pin registry gone")
      },
      scrollBy: () => {
        throw new Error("scrollbox detached")
      },
      scrollTo: () => {
        throw new Error("scrollbox detached")
      },
      copy: () => {
        throw new Error("clipboard refused")
      },
      flashCopied: () => {
        throw new Error("no flash")
      },
    })
    const commands = byId(deps)
    for (const id of ["goal.status.pin", "goal.status.scroll-up", "goal.status.page-down", "goal.status.home", "goal.status.end", "goal.status.copy", "goal.status.copy-evaluator-reason"]) {
      expect(() => commands[id]!.run()).not.toThrow()
    }
  })
})
