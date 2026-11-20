/**
 * Goals about the opencode v2 CLI itself.
 *
 * This plugin runs inside opencode, so most goals never mention it. But when a goal condition does mention
 * opencode — the CLI, the TUI, its plugin API, the installed binary — the agent is working on the host the
 * plugin runs in, and the working rules are different from an ordinary project: the harness cannot be edited,
 * the installed binary is ahead of any public source, and testing means headless renders and headless drives of
 * the real binary (the opencode-headless plugin), not a modified host.
 *
 * `isOpencodeCliCondition` picks those goals out of the condition text (a word match on "opencode"), and
 * `opencodeCliGuide` renders the operating guide the first-turn directive injects as an `<opencode-cli>`
 * block. The guide content is the operator runbook for opencode v2: how to learn what is installed, where
 * the plugin API contract lives, how to verify without touching host sources, and how to report what was
 * verified at which layer. Key invariants are pinned by `test/opencode-cli.test.ts`.
 * The opencode-headless plugin is how agents drive/smoke-test the installed binary — it exists and is
 * stable; the tmux screenscrape survives only as the zero-install fallback in step 5.
 *
 * Trigger scope decision: the matcher is deliberately a bare word match on `opencode`, not a cli-ish-keyword
 * gate. A false positive costs one static block in the first turn; a keyword gate false-negatives
 * exactly when the guide is needed most ("opencode v2.3.0 broke my workflow"). Possessives ("OpenCode's"),
 * config filenames ("opencode.jsonc") and the plugin name ("goal-loop") all intentionally match.
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
    `This goal touches the opencode v2 CLI itself (~/.opencode/bin/opencode). You cannot edit the harness. Cheapest first:`,
    `1. opencode --version; the nearest clone (~/Projects/opencode, branch dev) may lag. Never rebuild or replace the installed binary from an older/different tree.`,
    `2. The plugin API contract is node_modules/@opencode/plugin/dist/tui/context.d.ts (SlotMap; the only stable TUI extension surface: app, home.footer(.status), prompt.footer(.status/.file), session.composer.top (input {sessionID}), session.panel, sidebar.content/.footer).`,
    `3. Never modify host sources to test. Verify with a headless opentui render in /tmp (createTestRenderer from @opentui/core/testing + @opentui/solid): replicate the host layout and the plugin's exact JSX, then renderOnce() and assert on captureCharFrame().`,
    `4. Build/mount normally: server entry src/index.ts (Plugin.define from @opencode/plugin), TUI entry precompiled dist/tui.js (@opencode/plugin/tui); iterate with bun install and bun run check. Mount in ~/.config/opencode/opencode.jsonc (TUI plugins in ~/.config/opencode/tui.jsonc); restart to see changes.`,
    `5. Smoke-test the real binary with the opencode-headless plugin (github.com/paumkim/opencode-headless; opencode plugin add 'git+https://github.com/paumkim/opencode-headless.git'): headless_start (mode api/cli/pty) drives a child in scratch state; headless_prompt/headless_run to drive, headless_wait/headless_events to watch, headless_capture to read, headless_send to type, headless_permission to clear a permission block, headless_stop to end it. Prefer headless renders for layout assertions; tmux capture-pane -p is the zero-install fallback.`,
    `6. On mismatch, the binary is usually newer — string-extract the binary around the feature and diff against the clone. The opencode-headless plugin drives the v2 TUI headlessly (pty mode plus headless_capture/headless_send) for keystroke-level truth; string extraction from the binary is often the only source of truth for what the host does internally.`,
    `Rules: minimal slot-level changes; never commit to the host repo; keep plugin tests headless; report which layer (binary / source / test-render / live TUI) each claim was verified at.`,
    `</opencode-cli>`,
  ].join("\n")
}
