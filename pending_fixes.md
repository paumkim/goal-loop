# pending_fixes — opencode-goalv2 terminal-TUI consistency loop (iteration 2)

Goal: keep improving the terminal TUI; smooth out rough edges and inconsistencies across the zoom levels (pill < card < per-session dialog < history). Continues from the iteration-1 list. Sweep provenance: read-only explorer at dev HEAD (session ses_e0d35103bffeZppjiqUPwz0ync), triaged line-by-line this turn.

## Fixed (this iteration — see SPEC.md Workstream LXIX)
4. Rail fold row vs retention-drop notice twin `…` rows: fold now carries an always-mounted `click · x` affordance cell + hover flag (elsewhere-fold grammar); inert notice untouched; fold text `-` → `·`; tui-render pin re-set in-commit.
6. UTF-16 code-unit slicing: `sessionTag` (status-dialog.tsx) and dossier `chip` label (`dossier-outline.ts`) now cell-aware via `truncate()`; new CJK unit test (≤ 12 cells); ASCII pins unchanged.
9. Failure glyph split: pill ack `✕` → `✗` (tui-hud.test.tsx re-pinned); mono arms untouched (`x`).
10. Hyphen-minus separators KEPT — pinned in 8 sites (tui-hud ×2, render-scripts, tui-render, snapshot, hud.ts hint/remediation); polish pass, pin wins. The fold-row instance was rewritten as part of fix 4.
11a. `markerFg` duplicated in hud-card.tsx and status-dialog.tsx → one `compactMarkerFg` in core/hud.ts; card and dialog import it.
7. Outline chips "no hover handler" — REJECTED by pin: `tui-render.test.tsx` (hovering a chip changes nothing — byte-identical frame, no UNDERLINE/BOLD) is the deliberate contract; the misleading prop doc and rail comment were rewritten to state the shipped contract. No behavior change.
8. Find row + popup `close` cell now flip fg on hover (faint→base; close also BOLD under mono). No width changes.
13. SPEC intro glyph-wave quotes (`· • ● •`, `◯` waiting, six menu rows, `●` achieved) NOT YET DONE — quoted-docs drift, listed below.

## Still open (deferred)
5. `src/status-dialog.tsx` dossier `table` kind: `wrapMode="none"` inside a clipped scrollbox → silent right-edge clip; needs a wrap-or-ellipsis decision + render evidence, next iteration.
11b. Context-menu enabled predicates diverge between mouse arm (checks wiring) and keyboard arm (checks data); wired-identically today; needs a threaded signature for the row predicate.
11c. `stateWord` dialog-strip inline twin — kept by design (strip needs raw status + stuck override inline).
12. `not_met` raw enum in countsText and remediationFor streak strings — pinned (tui-render "3 met · 2 not_met"; tui-hud + verdict-history-retention + SPEC.md). Pin wins; flipping is a separate deliberate decision.
13. SPEC intro quotes stale glyphs: breath wave `· • ● •` vs shipped `◦ ○ ◎ ○`, resting waiting glyph `○` vs `◯`, "four fixed rows" vs six, `◎ goal achieved` vs `●`; SPEC.md intro only (LXVIII already fixed the footer-hint paragraph).
14. (new) `markerFg`→`compactMarkerFg` — done. `stateWord` in card+rail single-imported — done earlier (LXVIII).

## Verified this iteration
- `bunx tsc --noEmit` exit 0; `bun test` (cd test) → **1759 pass / 0 fail** (with the new CJK test); snapshots 28 pass; `bun run compile` rebuilt dist/tui.js; package-integrity unchanged (65 files).
- Fix-then-pin discipline: every re-pin (`tui-hud.test.tsx` ✕→✗, `tui-render.test.tsx` fold wording) moved in the same commit as the behavior change.
