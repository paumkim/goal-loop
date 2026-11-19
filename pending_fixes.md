# pending_fixes — opencode-goalv2 terminal-TUI consistency loop (iteration 1)

Goal: keep improving the terminal TUI; smooth out rough edges and inconsistencies across the zoom levels (pill < card < per-session dialog < history). Sweep done by a read-only explorer subagent at dev HEAD; findings listed user-impact order; `tui` plugin.

## Fixed (this iteration)
1. **One always-mounted affordance cell.** `Affordance` (hover-stability grammar: never mounts/unmounts, hover brightens only, weight under mono, width 8) was copy-pasted three times — hud-card.tsx (AffordanceCell), status-dialog.tsx, tui-history.tsx. Now one export in `src/affordance.tsx` (structural theme: text.base + text.faint); three call sites import it. Paint output byte-identical (render suites + snapshots unchanged: 446 pass before pin moves).
2. **Stuck loops read as stuck everywhere.** A retrying-stalled loop (retries ≥ 3) painted amber on pill/card but `active` in the dialog strip row and history rail. Fixed: strip paints `stuck`; dialog elsewhere-rows and the strip's accent pass `isRetryStuck`; rail `stateWord` gains the `stuck` branch; rail now-row goes warning-amber. New render test pins the rail behavior. `test/package-integrity.test.ts` re-pinned 64 → 65 (new packed file); SPEC marker advances `files=65 tests=1758`.
3. **SPEC intro honesty.** Footer-hint paragraph quoted the pre-`x older` hint; now shows `· x older` in both tiers with the measured 64-cell FULL_HINT (matches CQ + dialog-keys). SPEC.md intro line ~40.

## Open (explorer findings, not yet fixed)
4. `src/tui-history.tsx:326-345` — two adjacent `…` rows: inert retention-dropped notice vs clickable fold; fold carries no affordance cell/hover (elsewhere fold paints `click · m`); pinned wording at tui-render.test.tsx:806 needs a same-commit test edit; SPEC.md:79-86 promises every clickable row an affordance.
5. `src/status-dialog.tsx:476` — dossier `table` rows paint wrapMode="none" inside clipped scrollbox: silent right-edge data loss; needs a render decision (wrap vs ellipsis vs column budget).
6. `src/status-dialog.tsx:226-229`, `src/core/dossier-outline.ts:64-65` — UTF-16 code-unit slicing where cells/graphemes are the contract (CJK titles/headings mis-measure ~2x; surrogate bisection); `truncate()` does it right.
7. `src/status-dialog.tsx:747-757` — dossier outline chips: prop doc promises hover-bolden + click-to-copy with in-cell ack; implementation installs only onMouseUp; no hover handler, no Affordance cell (invisible click target on the mouse-first rail).
8. `src/status-dialog.tsx:725-741` — find row + close button: clickable with zero hover feedback; SPEC hover grammar says every clickable row shows something on the way in.
9. Failure-glyph codepoint split — pill ack paints `✕` (hud.ts), verify/final-tally rows paint `✗`; mono arms both `x`; no pin distinguishes them.
10. Hyphen-minus where the grammar uses `·` — hud.ts:530/538/575, status-dialog.tsx:518, tui-history.tsx:342; snapshot pins move with any fix.
11. Duplication still open: `compactMarkerFg` verbatim in hud-card.tsx:516-522 and status-dialog.tsx:297-303; context-menu enabled predicates derived twice (mouse arm checks wiring, keyboard arm `tui.tsx` checks data only); `stateWord` now single import in card+rail, dialog strip carries its own one-line twin.
12. `tui-history.tsx:~568` counts line pins `not_met` (tui-render.test.tsx:200: "3 met · 2 not_met") and hud.ts:560-561 streak strings pinned in three suites and SPEC — raw enum kept per pin-wins rule; would need a deliberate re-pin decision, not polish.
13. SPEC intro still quotes the old breath wave `· • ● •` (code: `◦ ○ ◎ ○`), resting hollow `○` (code `◯`), "four fixed rows" in the card context menu (code: six), `◎ goal achieved` ack glyph (code `●`).

## Verified this iteration
- `cd test && bun test` — 1757 pass before new test; 1758 after adding it. package-integrity green after re-pin. `bunx tsc --noEmit` exit 0. TUI render+snapshot suites unchanged (446 pass) pre-pin-change.
- Rebuilt `dist/tui.js`.
