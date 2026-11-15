/**
 * Goals about the opencode v2 CLI itself.
 *
 * This plugin runs inside opencode, so most goals never mention it. But when a goal condition does mention
 * opencode — the CLI, the TUI, its plugin API, the installed binary — the agent is working on the host the
 * plugin runs in, and the working rules are different from an ordinary project: the harness cannot be edited,
 * the installed binary is ahead of any public source, and testing means headless renders and screenscrapes,
 * not a modified host.
 *
 * `isOpencodeCliCondition` picks those goals out of the condition text (a word match on "opencode"), and
 * `opencodeCliGuide` renders the operating guide the first-turn directive injects as an `<opencode-cli>`
 * block. The guide content is the operator runbook for opencode v2: how to learn what is installed, where
 * the plugin API contract lives, how to verify without touching host sources, and how to report what was
 * verified at which layer. Kept byte-stable; `test/opencode-cli.test.ts` pins the key invariants.
 *
 * Trigger scope decision: the matcher is deliberately a bare word match on `opencode`, not a cli-ish-keyword
 * gate. A false positive costs one static ~600-token block in the first turn; a keyword gate false-negatives
 * exactly when the guide is needed most ("opencode v2.3.0 broke my workflow"). Possessives ("OpenCode's"),
 * config filenames ("opencode.jsonc") and the plugin name ("opencode-goal") all intentionally match.
 */

/** True when the goal condition mentions opencode (the CLI, its TUI, its plugin API, the harness). */
export function isOpencodeCliCondition(condition: string): boolean {
  return /\bopencode\b/i.test(condition)
}

/**
 * The `<opencode-cli>` block for the first-turn directive. Static text: no interpolation, so no escaping.
 * Ordered cheapest-first, exactly how the work should be approached.
 */
export function opencodeCliGuide(): string {
  return [
    `<opencode-cli>`,
    `This goal touches the opencode v2 CLI itself (installed at ~/.opencode/bin/opencode; a Bun-compiled ELF binary). It is NOT the term fork and NOT opencode v1. You cannot edit the harness. Learn it in this order, cheapest first:`,
    `1. Check what's actually installed: opencode --version. Compare with the nearest source clone (~/Projects/opencode-v2-fake, branch dev) — it may lag and lack your code. Never rebuild or replace the installed binary from an older/different tree; that downgrades the user's harness.`,
    `2. The plugin API contract is node_modules/@opencode/plugin/dist/tui/context.d.ts (SlotMap; clone source: packages/plugin/src/tui/context.ts in the fake clone): the SlotMap (app, home.footer, home.footer.status, prompt.footer, prompt.footer.status, prompt.footer.file, session.composer.top (input {sessionID}), session.panel, sidebar.content, sidebar.footer) is the only stable extension surface for TUI UI. Missing a place? Search the binary for the exact element ID you want (e.g. session-jump-to-latest) with targeted grep -ao plus a string-window extraction to recover the surrounding minified layout — it tells you which slot mounts where and which wrapper box sits above/below it. Note WHICH box the slot mounts in (fragments have no wrapper; boxes do). Verify every assumption in a scratch render, not in the repo.`,
    `3. Never modify host sources to test a plugin. Verify behavioral changes with a headless opentui render in /tmp: createTestRenderer from @opentui/core/testing plus render from @opentui/solid. Replicate the host layout (the relevant boxes, justifyContent, wrapper boxes) and the plugin's exact JSX, then renderOnce(), captureCharFrame(), and assert on rows. opentui defaults: position relative, overflow visible; absolute boxes with negative top paint above earlier siblings.`,
    `4. Build plugins normally. A plugin is a package: server entry src/index.ts wiring Plugin.define({ id, setup }) from @opencode/plugin, TUI entry src/tui.tsx → precompiled dist/tui.js wiring Plugin.define from @opencode/plugin/tui (the opencode-goalv2 checkout is the reference layout: index.ts → src/index.ts, tui.ts → dist/tui.js). Iterate with bun install and bun run check (tsc + bun test + compile + TUI load check). Mount the local checkout in ~/.config/opencode/opencode.jsonc under "plugins": [...] (TUI plugins via ~/.config/opencode/tui.jsonc "plugin": [...]). Restart/reload the TUI to see changes — there is no hot reload of plugin code you have not rebuilt.`,
    `5. Test what the host actually shows. Headless drive of the real binary for smoke tests: run it with a throwaway --config/project dir in tmux or a PTY and screenscrape (tmux capture-pane -p); check ~/.local/share/opencode/log/opencode.log for plugin errors. Prefer the opentui test-renderer route for layout assertions — it is deterministic and does not touch the user's live session.`,
    `6. Failure ladder. Behavior differs from source: the binary may be newer — string-extract the binary around the feature and diff against the clone. A slot claim that silently does nothing: check the host hadn't renamed the path (grep the binary for "session.composer.top" etc.), confirm the plugin mounted (/plugins in-session or the TUI log), and check your render returned JSX, not undefined. A negative layout offset that paints wrong: check ancestors' overflow and position empirically in the headless render first.`,
    `Rules: make minimal, slot-level changes; never commit to the host repo; keep plugin tests headless; report which layer (binary / source / test-render / live TUI) each claim was verified at.`,
    `Two honest limits: there is no stable, documented tool that drives the v2 TUI headlessly the way term-driver drives term — you either scrape a PTY/tmux session or reproduce the layout in @opentui/core/testing. And the installed binary is ahead of any public clone, so string extraction from the binary is often the only source of truth for v2's live layout.`,
    `</opencode-cli>`,
  ].join("\n")
}
