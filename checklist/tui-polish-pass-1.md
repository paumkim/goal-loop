# TUI polish pass — log

- Pass number: **1**. Derived by counting prior *completed* TUI polish reports in the repo: none exist. The earlier `TUI Polish Pass (Worker)` goal (2026-11-21) was cleared with 0 turns, and the `wt/tui-polish` / now-row polish commit left no report. This is the first recorded pass.
- Worktree path: `/home/pauk/Projects/goal-loop/worktree/wt-tui-polish-pass`
- Branch: `wt/tui-polish-pass` (based on `dev` at `0cc2ef3`)
- Lease: `tui-polish-pass` (claimed via coordinator; `merge-status` reported clear at claim time)
- Date: 2026-11-25

## Screens / states inspected

Rendered headlessly with `bun --preload @opentui/solid/preload scripts/render-*.tsx` (real components, not painted mocks):

- `/goal` detail dialog: overview — default (150), narrow (100, 80), pinned, copied, achieved, pileup (stress), reduced-color/mono.
- Goal card (composer overlay): active loop, achieved, clamp floor (52 cols), hot/compaction pending, stuck retries, failed, freshly armed, impossible; mono.
- Ambient pill: working/checking breath phases 0–3 + resting, waiting, paused, stuck, achieved; mono; 52-col floor.
- Pill/card slot: card open and card closed.
- History / loop rail: 2 completed iterations, paused diagnostics, empty history, mono, 96-col floor.
- Un-rendered surfaces audited read-only: dossier/ledger tabs, find bar, outline rail, context menu overlay, toast/notice wording (`src/tui-error.ts` + `test/tui-error-messages.test.ts`).

## BEFORE captures

Raw ANSI captures under `/tmp/opencode/tui-polish-pass-1/before/` (not shipped):

`history-default`, `history-narrow96`, `history-empty`, `history-mono`, `card-default`, `card-mono`, `pill-default`, `pill-mono`, `pill-narrow52`, `slot-default`, `dialog-default`, `dialog-pinned`, `dialog-copied`, `dialog-achieved`, `dialog-pileup`, `dialog-mono`, `dialog-width80`, `dialog-width100`, `pinned-pill`.

Focused `pinned-pill` capture (composes the real `pillModel` → `pinBudget` → `pinSuffix` helpers and paints the badge + state + caret nodes at an 80-col mount), before the fix:

```
=== pinned pill · terminal 80 ===
badge=0 pill text cells=79 caret cells=2 total=81 budget(W)=80 overflow=1
◎ loop · v3/5 ○○○○○ · active · 42m · 31 turns evaluated · pin: keep the termin ▾
=== pinned pill · terminal 80 · with activity badge ===
badge=9 pill text cells=79 caret cells=2 total=90 budget(W)=80 overflow=10
 readin◎ loop · v3/5 ○○○○○ · active · 42m · 31 turns evaluated · pin: keep the ▾
```

## Flaws found

- **P0:** none.
- **P1 (fixed):** pinned ambient pill overflows its mount at narrow widths. `pinBudget` reserved only the 1-cell right margin, not the 2-cell trailing caret (` ▴`/` ▾`) or the live activity badge node. At 80 cols with no badge the row measured 81 cells (caret's leading space clipped); with a live tool word (` reading `, 9 cells) it measured 90 cells — 10 past the mount — clipping the word mid-glyph to `readin`. Same at 100 cols (101 / 110 cells).
- **P2/P3:** minor nits only (see Remaining items). No P0/P1 in the dossier/ledger/find/outline/menu/toast surfaces.

## Fixes applied (1 flaw, highest severity available; minimal, reuses existing styles)

1. `src/hud-card.tsx:176` — `pinBudget` now reserves the caret (2 cells), the right margin (1 cell), and an optional `reservedCells` argument for the badge, instead of only the margin.
2. `src/tui.tsx:1149` — hoisted `badgeCells()` beside `pill()` so the same cell count drives both the state-text budget and the pin budget.
3. `src/tui.tsx:1188` — passes `badgeCells()` into `pinBudget`; the pin now degrades through the existing `pinSuffix` ladder instead of clipping the badge or caret.
4. `dist/tui.js` regenerated with `bun run compile` (required after TUI source change).
5. `test/tui-hud.test.tsx:537` — focused regression: `pinBudget` reservations + a composition test asserting the full row fits at 80 cols with and without an activity badge.

No new features, no unrelated refactors: three source lines of behavior change plus the test and rebuilt bundle.

## AFTER captures

`/tmp/opencode/tui-polish-pass-1/after/pinned-pill.txt` (same composition, fixed sources):

```
=== pinned pill · terminal 80 ===
badge=0 pill text cells=77 caret cells=2 total=79 budget(W)=80 overflow=-1
 ◎ loop · v3/5 ○○○○○ · active · 42m · 31 turns evaluated · pin: keep the term… ▾
=== pinned pill · terminal 80 · with activity badge ===
badge=9 pill text cells=55 caret cells=2 total=66 budget(W)=80 overflow=-14
 reading ◎ loop · v3/5 ○○○○○ · active · 42m · 31 turns evaluated ▾
```

Flaw gone: badge reads whole, caret keeps its leading space, pin truncates with `…` or degrades away instead of clipping; every frame fits inside the mount with a 1-cell margin. Every standard render capture was re-run into `/tmp/opencode/tui-polish-pass-1/after/`; differences from `before/` are only fixture wall-clock timestamps (`12:50` → `12:56` etc.), not visual changes.

## Verification

- Focused: `cd test && bun test tui-hud.test.tsx` → **183 pass / 0 fail**, 22557 expect() calls.
- Full: `bun run check` → **exit 0**, **2509 pass / 0 fail**, 29 snapshots, 210610 expect() calls; docs freshness passed; wiring-audit 38/38.
- Build: `bun run compile` → `built dist/tui.js (367936 bytes)`.

## Remaining items / left for next pass

- `scripts/render-slot.tsx` still mirrors the pre-accordion `<Show when={!cardFor()}>` gate; the live `src/tui.tsx` paints the pill as a persistent stripe. Fixture only — not a user-visible TUI flaw; update the script if its verdict lines are reused.
- P2/P3 nits observed but not fixed (below the stop threshold): a double space before the `copy` affordance in the 52-col card's truncated condition row; footer hint tiers switch before button-label tiers at ~100 cols.
- No P0/P1 remain after this fix; polishing stopped here per the goal's stop condition.
