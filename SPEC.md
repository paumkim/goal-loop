# SPEC — Goal HUD relocation + plugin load fix

## Interpretation
The user provided a screenshot (`Screenshot_20261109_150211.png`) with a red arrow pointing to the
empty space to the right of the "Build auto · KiloCode-Free … · high" metadata row, just above the
prompt footer. The current `◎ goal active` indicator renders in the bottom footer
(`prompt.footer.status`), crammed next to the context-usage percentage. The request is to move it
up to the arrow's column so the goal status reads cleanly while a goal is active. The second request
is to fix the "opencode-goal failed, 1.0.1" load error.

Upstream OpenCode (v2.2.3) publishes no slot inside the prompt metadata row; `packages/plugin/src/tui/context.ts`
lists only `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`, and `session.composer.top`.
The closest available slot to the arrow is **`session.composer.top`** (directly above the composer,
right-alignable). That is the intended move — NOT a patch inside `PromptMetadataRow` (untouchable from a plugin).

## Acceptance criteria
1. `src/tui.tsx` no longer claims `prompt.footer.status`; it claims `session.composer.top` with the
   indicator right-aligned on its own row (flex-end, full width), preserving the existing label,
   color logic, elapsed/turns text, and click-to-status behavior.
2. Footer row is clean while a goal is active: no `◎ goal` text in `prompt.footer.status`
   (compiled `dist/tui.js` contains the new slot string and not the old one).
3. Load fix: project `opencode.json` references the local checkout only (not the npm `@el4cteo/opencode-goal`),
   and the supervisor dedupes global `~/.config/opencode/opencode.jsonc` (same local target) into one entry —
   `opencode plugin list` shows a single `opencode-goal` row and no "failed, 1.0.1" entry.
4. No behavior regression: `/goal` RPC (`get`/`status`/`clear`), toasts, dialog, keymaps unchanged.
5. `bun run check` passes (tsc, `bun test`, compile).

## Verification
- `bun run check` exit 0; `grep dist/tui.js session.composer.top` hits, `prompt.footer.status` absent.
- `opencode plugin list` shows one `opencode-goal` (local), no "failed, 1.0.1".
- Manual: start opencode TUI, run `/goal <condition>`, confirm `◎ goal active` appears above the prompt
  input on the right side (same column as the arrow), not in the bottom footer next to the % usage.

## Out of scope
- Changing upstream OpenCode to add a metadata-row slot.
- Republishing the npm package; local development only.
