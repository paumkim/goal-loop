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
13. SPEC intro glyph-wave quotes (`· • ● •`, `◯` waiting, six menu rows, `●` achieved) — **done in LXXV** (quoted-docs drift; intro corrected and pinned by `test/spec-intro-glyphs.test.ts`).

## Still open (deferred)
5. `src/status-dialog.tsx` dossier `table` kind: `wrapMode="none"` inside a clipped scrollbox → silent right-edge clip; needs a wrap-or-ellipsis decision + render evidence, next iteration.
11b. ~~Context-menu enabled predicates diverge between mouse arm (checks wiring) and keyboard arm (checks data)~~ — **done in LXXI**: `HudCard.menuRows` threads the mount's single row source (`contextRowsFor`) into the paint path; the card's own wiring probe is the embed fallback.
11c. `stateWord` dialog-strip inline twin — kept by design (strip needs raw status + stuck override inline).
12. `not_met` raw enum in countsText and remediationFor streak strings — pinned (tui-render "3 met · 2 not_met"; tui-hud + verdict-history-retention + SPEC.md). Pin wins; flipping is a separate deliberate decision.
13. ~~SPEC intro quotes stale glyphs~~ — **done in LXXV**: intro now quotes the shipped breath wave `◦ ○ ◎ ○`, the large waiting ring `◯`, "six fixed rows" (all six enumerated) and `● goal achieved`; a new `test/spec-intro-glyphs.test.ts` pins the intro against the renderer.
14. (new) `markerFg`→`compactMarkerFg` — done. `stateWord` in card+rail single-imported — done earlier (LXVIII).

## Verified this iteration
- `bunx tsc --noEmit` exit 0; `bun test` (cd test) → **1759 pass / 0 fail** (with the new CJK test); snapshots 28 pass; `bun run compile` rebuilt dist/tui.js; package-integrity unchanged (65 files).
- Fix-then-pin discipline: every re-pin (`tui-hud.test.tsx` ✕→✗, `tui-render.test.tsx` fold wording) moved in the same commit as the behavior change.

---

# pending_fixes — opencode-goalv2 back-to-front sweep (iteration 1)

Sweep done by a general subagent (read-only, worktree: wt-keep-improving-keep-on-fixing-the-current-directory-codebase-from-back-to-front). Findings — some fixed and verified, others reviewed/rejected.

## Fixed (fixed by general subagent + verified by tester subagent)
6. `src/runtime/controller.ts:921-926` — dropped the dead "already satisfied at HEAD" zero-tool exemption; stale comment replaced (the forward-pointer gate in core/verdict.ts owns the already-satisfied landing — a bare already-satisfied met downgrades to not_met there, pinned by core.test.ts). `test/loop.test.ts` (vii-b) pinned the exemption and was reconciled to pin the downgrade instead (loop does not advance; reason "no evidence of work toward the condition"; loopIteration 1). Found in review: the exemption was unproducible in production since XLIV landed (applyForwardPointerGate at parse), but was the only remaining path that could advance an armed loop on a bare already-satisfied claim with zero tool calls. Verified: `bun run check` exit 0 (1756 pass / 0 fail, docs:check passed, spec-check ok, 64 files, 1756 tests).
4. `src/runtime/controller.ts:731` — `onExecutionSucceeded` now fails closed when `background.busy(sessionID)` errors: logs "goal busy check failed; skipping evaluation" and returns without evaluating. Regression test "skips evaluation when the busy check errors" added to `test/controller.test.ts` (harness: `busyError` + `setBusyError`). Verified: new test passes with the fix (1 pass / 0 fail); with the fix stashed it fails (Expected 0, Received 1); tester re-ran: `bun run check` suite 1756 pass / 0 fail; regression test exit 0.
5. `src/runtime/store.ts:119-121` — `flush()` now drains: `while (this.chains.size > 0) { await Promise.all([...this.chains.values()]) }`. Regression test added to `test/store.test.ts` ("GoalStore.flush > flush drains writes enqueued while it is awaiting"). SPEC marker updated (tests=1754→1755). Verified: `bun run check` exit 0 (1755 pass / 0 fail, spec-check ok); `bun test test/store.test.ts` exit 0 (10 pass / 0 fail); discrimination: with the buggy flush the new test fails (9 pass / 1 fail).

5. `src/runtime/controller.ts:1189` — the iteration cap is unreachable when `maxLoops > 50` (loopHistory is capped at 50). Fixed on dev (merged commit d5d1d33): the `history.length >= maxLoops` check now counts total achieved iterations (`completedIterationCount`) instead of retained entries, so a `maxLoops > 50` loop reaches its cap; regression test (vii-d) pins a 52-cap goal with 50 retained entries + 2 dropped completing at 53. Already in this worktree's tree (`grep -c completedIterationCount src/runtime/controller.ts` → 2). Dev `bun run check` green: 1757 pass / 0 fail, spec-check ok.

6. `src/core/config.ts:132` — `maxConditionChars` floor lowered from 100 to 0 on the otherwise-unlimited default. Now `int(options.maxConditionChars, DEFAULTS.maxConditionChars, 0)`: `int(0, Number.MAX_SAFE_INTEGER, 0)` → 0, so the goal-hook check at src/index.ts:288-290 rejects any objective with length > 0 ("reject everything"); unset → Number.MAX_SAFE_INTEGER (default unchanged — README/docs tables still document it, and test/config-defaults.test.ts:187 still asserts it). Regression test added to `test/config-defaults.test.ts`: `resolveConfig({ maxConditionChars: 0 }).maxConditionChars` → 0, `resolveConfig({ maxConditionChars: 5 }).maxConditionChars` → 5, unset → MAX_SAFE_INTEGER. Verified: `bun test test/config-defaults.test.ts` exit 0 (12 pass / 0 fail, 197 expect() calls); discrimination — floor flipped back to 100: the new test fails (Expected: 0, Received: 100; 11 pass / 1 fail); restored → pass. `bun run check` exit 0 (1758 pass / 0 fail, 28 snapshots, 6963 expect() calls, Ran 1758 tests across 71 files; spec-check ok (64 files, 1758 tests match SPEC.md)).

7. `src/index.ts:288-290` — the goal-loop raw-prompt length check now counts code points: `[...objective].length > config.maxConditionChars` (matches `parseGoalCommand` at src/core/parse.ts:21 — "Count code points, not UTF-16 units, matching parseGoalCommand"); `noteConditionTooLong` passes the code-point count. Regression test in `test/plugin.test.ts:199`: "an astral-heavy objective is measured in code points: admitted at the code-point limit" — `/goal-loop 🎉🎉🎉🎉🎉` with `maxConditionChars: 5` (5 code points, 10 UTF-16 units) is admitted (loop armed, objective stored); the old `objective.length` check would have rejected it. Verified: general subagent `bun run check` exit 0 (1759 pass / 0 fail, spec-check ok); mutation: fix reverted → new test fails (0 pass / 1 fail, loopEnabled undefined); restored → 1 pass / 0 fail; tester: diffs match, hook path covered, `bun run check` exit 0 (1759 pass / 0 fail), `bun test goal-limits.test.ts` exit 0 (9 pass / 0 fail), `bun test core.test.ts -t "astral"` exit 0 (1 pass / 0 fail).

## Rejected — contradicts pinned behavior (tests)
- `src/runtime/controller.ts:1447` — proposed clearing `iterationDeferred` in `clearDeferred`: contradicts `loop.test.ts:1938` ("an iteration spent waiting on background work is not a zero-tool iteration" — the suppression while waiting is by design). Fix applied by a general subagent, then reverted; targeted rerun on base: 1 pass / 0 fail.

## Open (reviewed, minor — not fixed per mandate)
3. `src/runtime/controller.ts:1029-1031` — `verifyMet` registers no `runtime.abort` during the verification await (impact: wasted verify compute on interrupt, up to verifyTimeoutMs). [Moot: main checkout carries the verifyMet abort registration fix — iteration 1's second verified improvement; confirm at merge time.]
8. `src/core/events.ts:121-124` — a `shell.created` without an id never registers the shell (background undercount).
9. `src/core/parse.ts:28-29` — `unquote` returns the one-char input `"` for `/goal "` (cosmetic).
