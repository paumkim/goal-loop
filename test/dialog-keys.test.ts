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

  test("with the elsewhere jump wired, the four digit chords join after the reason chord — and only then", () => {
    const jumps: string[] = []
    const wired = spyDeps({
      transcriptFor: (row) => ["ses_a", "ses_b"][row - 1],
      openTranscript: (id) => {
        jumps.push(id)
      },
    })
    const commands = dialogStatusCommands(wired)
    expect(commands.map((command) => [command.id, command.bind])).toEqual([
      ["goal.status.pin", "p"],
      ["goal.status.history", "x"],
      ["goal.status.copy", "c"],
      ["goal.status.copy-evaluator-reason", "r"],
      ["goal.status.transcript-1", "1"],
      ["goal.status.transcript-2", "2"],
      ["goal.status.transcript-3", "3"],
      ["goal.status.transcript-4", "4"],
      ["goal.status.scroll-up", "up"],
      ["goal.status.scroll-down", "down"],
      ["goal.status.page-up", "pageup"],
      ["goal.status.page-down", "pagedown"],
      ["goal.status.home", "home"],
      ["goal.status.end", "end"],
    ])
  })

  test("the digit chords mirror the open gate and the painted row count: row 3 and 4 are dead when only two foreign goals are live", () => {
    const jumps: string[] = []
    const wired = spyDeps({
      transcriptFor: (row) => ["ses_a", "ses_b"][row - 1],
      openTranscript: (id) => {
        jumps.push(id)
      },
    })
    const commands = byId(wired)
    expect(commands["goal.status.transcript-1"]!.enabled()).toBe(true)
    expect(commands["goal.status.transcript-2"]!.enabled()).toBe(true)
    expect(commands["goal.status.transcript-3"]!.enabled()).toBe(false)
    expect(commands["goal.status.transcript-4"]!.enabled()).toBe(false)
    const closed = spyDeps({ open: () => false, transcriptFor: () => "ses_a", openTranscript: () => {} })
    for (const command of dialogStatusCommands(closed)) expect(command.enabled()).toBe(false)
    // running a disabled chord through the modal's own dispatch still respects the absent row
    commands["goal.status.transcript-3"]!.run()
    expect(jumps).toEqual([])
    commands["goal.status.transcript-2"]!.run()
    expect(jumps).toEqual(["ses_b"])
  })

  test("with the elsewhere fold wired, the `m` chord joins after the digits — and only when both halves are wired", () => {
    const bothWired = dialogStatusCommands(
      spyDeps({
        transcriptFor: (row) => ["ses_a"][row - 1],
        openTranscript: () => {},
        foreignMoreVisible: () => true,
        toggleForeignMore: () => {},
      }),
    )
    expect(bothWired.map((command) => command.id)).toEqual([
      "goal.status.pin",
      "goal.status.history",
      "goal.status.copy",
      "goal.status.copy-evaluator-reason",
      "goal.status.transcript-1",
      "goal.status.transcript-2",
      "goal.status.transcript-3",
      "goal.status.transcript-4",
      "goal.status.elsewhere-more",
      "goal.status.scroll-up",
      "goal.status.scroll-down",
      "goal.status.page-up",
      "goal.status.page-down",
      "goal.status.home",
      "goal.status.end",
    ])
    expect(bothWired.find((command) => command.id === "goal.status.elsewhere-more")!.bind).toBe("m")
    expect(bothWired.find((command) => command.id === "goal.status.elsewhere-more")!.group).toBe("Goal")
    const foldOnly = dialogStatusCommands(spyDeps({ foreignMoreVisible: () => true, toggleForeignMore: () => {} }))
    expect(foldOnly.map((command) => command.id)).toEqual([
      "goal.status.pin",
      "goal.status.history",
      "goal.status.copy",
      "goal.status.copy-evaluator-reason",
      "goal.status.elsewhere-more",
      "goal.status.scroll-up",
      "goal.status.scroll-down",
      "goal.status.page-up",
      "goal.status.page-down",
      "goal.status.home",
      "goal.status.end",
    ])
    const halfWired = dialogStatusCommands(spyDeps({ foreignMoreVisible: () => true }))
    expect(halfWired.some((command) => command.id === "goal.status.elsewhere-more")).toBe(false)
    const otherHalf = dialogStatusCommands(spyDeps({ toggleForeignMore: () => {} }))
    expect(otherHalf.some((command) => command.id === "goal.status.elsewhere-more")).toBe(false)
    expect(halfWired.length + 1).toBe(otherHalf.length + 1) // ten core either way
  })

  test("the `m` chord mirrors the dialog-open gate and the overflow gate — no overflow, no reachable fold", () => {
    let toggles = 0
    const deps = (openGate: boolean, moreVisible: boolean) =>
      spyDeps({ open: () => openGate, foreignMoreVisible: () => moreVisible, toggleForeignMore: () => { toggles++ } })
    expect(byId(deps(true, true))["goal.status.elsewhere-more"]!.enabled()).toBe(true)
    expect(byId(deps(true, false))["goal.status.elsewhere-more"]!.enabled()).toBe(false)
    expect(byId(deps(false, true))["goal.status.elsewhere-more"]!.enabled()).toBe(false)
    byId(deps(true, true))["goal.status.elsewhere-more"]!.run()
    expect(toggles).toBe(1)
  })

  test("a throwing fold toggle never escapes the key event — same swallow posture as every chord", () => {
    const deps = spyDeps({
      foreignMoreVisible: () => true,
      toggleForeignMore: () => {
        throw new Error("host detached")
      },
    })
    expect(() => byId(deps)["goal.status.elsewhere-more"]!.run()).not.toThrow()
  })

  test("the `t` chord joins when the host wires toggleView — id, bind, group, footer-omission contract", () => {
    const withView = dialogStatusCommands(spyDeps({ toggleView: () => {} }))
    expect(withView.map((command) => [command.id, command.bind]).slice(0, 5)).toEqual([
      ["goal.status.pin", "p"],
      ["goal.status.history", "x"],
      ["goal.status.copy", "c"],
      ["goal.status.copy-evaluator-reason", "r"],
      ["goal.status.view-toggle", "t"],
    ])
    expect(withView.find((command) => command.id === "goal.status.view-toggle")!.group).toBe("Goal")
    expect(dialogStatusCommands(spyDeps()).some((command) => command.id === "goal.status.view-toggle")).toBe(false) // absent wiring, absent chord
  })

  test("the `t` chord flips the wired view — and a throwing host never escapes the key event", () => {
    let toggles = 0
    const wired = spyDeps({ toggleView: () => { toggles += 1 } })
    const command = dialogStatusCommands(wired).find((entry) => entry.id === "goal.status.view-toggle")!
    expect(command.enabled()).toBe(true)
    command.run()
    expect(toggles).toBe(1)
    const throwing = spyDeps({ toggleView: () => { throw new Error("host detached") } })
    expect(() => dialogStatusCommands(throwing).find((entry) => entry.id === "goal.status.view-toggle")!.run()).not.toThrow()
    expect(dialogStatusCommands(spyDeps({ open: () => false, toggleView: () => {} })).find((entry) => entry.id === "goal.status.view-toggle")!.enabled()).toBe(false) // the dialog-open gate rides like every chord
  })

  test("a throwing jump route never escapes the key event — same swallow posture as every chord", () => {
    const deps = spyDeps({
      transcriptFor: () => "ses_a",
      openTranscript: () => {
        throw new Error("router detached")
      },
    })
    expect(() => byId(deps)["goal.status.transcript-1"]!.run()).not.toThrow()
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
