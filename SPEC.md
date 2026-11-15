# SPEC — current behavior of opencode-goal

Status: current as of v1.0.1 (plus the two workstreams specified below). The TUI indicator renders natively: a compact segment in the `prompt.footer`
row (the slot the host's built-in PromptFooter plugin claims with `append`), state transitions surface as
host toasts, and the `/goal` detail view is a host dialog (`ui.dialog.show` chrome: backdrop, Esc dismissal,
xlarge centered sizing) built from theme tokens only (see `src/tui.tsx`). There is no custom-painted overlay.
The project `opencode.json` points at the local checkout.

This file is the acceptance spec for the plugin as it ships today. The how and why live in README.md and
`docs/`; this file only states what must hold, so regressions are visible.

## Acceptance criteria

1. `/goal <condition>` sets the goal and starts work immediately; `/goal` with no arguments shows status;
   `/goal clear` (aliases `stop`, `off`, `reset`, `none`, `cancel`) ends it. Any other text is the condition
   (`src/core/parse.ts`, `src/core/types.ts` `CLEAR_ALIASES`).
2. After every turn an evaluator answers `met` / `not_met` / `impossible`. `not_met` starts the next turn
   with a synthetic steer prompt; `met` / `impossible` end the goal. The turn cap (default 200), the stall
   guard (default 3 turns without tool use), and fatal errors can also end or pause the goal
   (`src/runtime/controller.ts`).
3. Finished work must be committed before the goal counts as met, inside a git repository, on branch `dev`
   by default; coordinator repositories use the `wt/<slug>` + submit flow. Outside a git repository the rule
   is off; `requireCommit: false` turns it off everywhere (`src/core/git.ts`, `src/core/prompts.ts`).
4. The plugin never runs git itself. It reads `.git`, `HEAD`, `refs/heads/*` and `packed-refs`, and directs
   the agent; the evaluator judges only what is visible in the conversation.
5. Live goals survive a restart: on setup the plugin restores `active`/`paused` records for its directory
   and resets turn count, stall, retries and the spend baseline (`src/runtime/controller.ts` `restore`).
6. Docs in `README.md`, `docs/*.html`, `AGENTS.md` and this file match the code. Every option, default, env
   var, NoticeKind and status value named there exists in `src/core/config.ts`, `src/core/types.ts` or
   `src/core/parse.ts`. `bun run check` passes.
7. The TUI has no hand-painted overlay: the active/paused indicator renders inside the host's
   `prompt.footer` slot (append), the detail view renders through `ui.dialog.show` host chrome (Esc and
   ctrl+c dismiss it, backdrop and focus owned by the host), transitions use `ui.toast.show` with the host's
   variants, and every color/border/font comes from `context.theme` tokens (no hardcoded RGBA, no custom
   borders). Layout, z-index, focus and dismissal stay with the host (`src/tui.tsx`).

## Workstream A — detail dialog acceptance criteria

8. The `/goal` detail dialog keeps the host chrome (`ui.dialog.show`, xlarge, centered, Esc/ctrl+c
   dismissal owned by the host) and the header convention: bold title left, `esc` right, `DIALOG_INSET=3`
   side padding, gap 1, bottom pad 1. The body is composed from theme tokens only (`text.base`,
   `text.muted`, `text.faint`, `text.feedback.*`); no hardcoded RGBA, no custom borders, no absolute
   positioning (`src/tui.tsx`).
9. The body renders from the live `GoalSnapshot` (not only the status notice text): status line
   (state · elapsed · turns), the condition wrapped, the evaluator/reason line when present, spend,
   and — for looped goals — the loop section (objective, iteration, per-iteration history). A scrollable
   `scrollbox` (word wrap, visible scrollbar, `stickyScroll={false}`) handles long content; page keys,
   home/end and the scrollbar all work; the dialog never forks host behavior.
10. Footer indicator shows loop state when a loop is active (`◎ loop · vN · …`), deriving from the same
    snapshot fields as the normal indicator.

## Workstream B — `/goal-loop` acceptance criteria

11. `/goal-loop <objective>` sets the initial goal (v1) exactly like `/goal` (directive, evaluator,
    commit rule, turn cap, stall guard, retries, restore-on-restart, `/goal-loop clear` and the
    `stop`/`off`/`reset`/`none`/`cancel` aliases). With no arguments it shows status. It activates the
    loop only after the evaluator returns `met` — never on `not_met`, stall, pause, interrupt, retry or
    failure paths. `/goal` behavior for non-looped goals is unchanged.
12. On the turn where the evaluator returns `met` for a looped goal, the controller: (a) summarizes the
    achieved iteration into a compact machine-consumable block via the evaluator
    (`maxLoopSummaryTokens`, default 400, env `OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS`, hard-capped at
    `max(200, tokens) * 4` characters (an 800-char floor applies below 200 tokens)), (b) asks the evaluator to generate the next goal (v2…) from the summary,
    the loop objective and the prior history, under a strict output contract (a single verifiable
    condition, or exactly `LOOP_COMPLETE`), (c) arms the next goal immediately under the same `/goal`
    rules. Goal v1 and each later iteration are kept as `loopHistory` in the persisted record — never
    re-injected in full. Invariant: a met verdict advances the loop exactly once, and an armed
    objective is never re-armed verbatim — the arm is persisted to storage before it is announced
    (note, toast, arming steer), the achieved history and the armed iteration land in a single durable
    write (recovering either the pre-arm or the armed state, never a half-advanced one), a loop step
    whose iteration already advanced drops itself instead of re-firing the arm, a next-goal reply that
    normalizes to an already-completed condition pauses the loop rather than re-arming it, a stale
    loop step drops before the arming steer is dispatched, and a completion event delivered after a
    plugin-dispatched steer or a failed turn is ignored until the next execution starts.
13. Loop guards (all mandatory): `maxLoops` (default 5, env `OPENCODE_GOAL_MAX_LOOPS`; counts completed
    iterations) ends the loop cleanly as *achieved-complete*; the per-iteration turn cap reuses
    `maxTurns` (reset per iteration); evaluator failures exhaust `maxRetries` and pause as today; a hard
    `impossible` verdict ends the loop as today; two consecutive iterations with zero tool calls pause
    the loop with a clear notice; the summary/generation token budget is capped by
    `maxLoopSummaryTokens` (a generation that yields an unusable or >2000-char condition ends the loop
    cleanly, with a notice). Never an infinite silent loop.
14. `LOOP_COMPLETE` ends the loop cleanly as *achieved-complete* (not an error, not infinite refinement).
    The final toast uses kind `achieved` so it fires the normal attention flow once; each achieved
    iteration fires a plain `loop` info toast (kind `loop`, no attention), e.g. `Loop 1 achieved ·
    moving to v2`.
15. State persists and restores across restart: `GoalRecord` gains optional `loopEnabled`,
    `loopIteration`, `loopObjective`, `loopMaxLoops`, `loopHistory` (array of `{version, condition,
    summary, reason, turns, toolCalls, endedAt}`) and `loopNotProgress`. `version` stays `1`; old
    records without loop fields load unchanged (loop disabled). Schema is additive — no migration, no
    corruption of existing saved goals.
16. Loop history is in the RPC snapshot (`GoalSnapshot extends GoalRecord`), so the detail dialog shows
    objective, current iteration and per-iteration verdicts/summaries; the prompt footer shows the loop
    iteration; `/goal-loop` palette actions mirror `/goal` (status, clear).
17. Directive and prompts for looped goals mention the iteration number and inject prior-iteration
    summaries as a compact block (`src/core/prompts.ts`: loop preamble in `directive`, the summarizer
    rubric, the next-goal generator rubric with the `LOOP_COMPLETE` contract). Non-looped prompts are
    byte-identical to before.
18. `bun run check` (tsc, tests, compile) passes. New tests cover: met → summary → v2 armed;
    `maxLoops` cap ends the loop; `LOOP_COMPLETE` ends the loop; impossible ends the loop; two
    consecutive zero-tool-call iterations pause; restore keeps loop state; store round-trips loop
    fields; prompt builders carry the contract.

## Out of scope

- New features beyond the two workstreams. Any behavior change updates this file in the same commit.
- Per-iteration met toasts are info-level by default; if they prove noisy in the smoke run, suppress
  after N iterations in a follow-up (not silently changed).

## Verification

- `bun run check` — tsc, unit tests, compile (order: tsc first).
- Manual: `opencode plugin add @el4cteo/opencode-goal`, then `/goal bun test passes` in a scratch repo and
  watch the prompt footer indicator and `/goal` status output.
- Workstream A/B manual: tmux TUI smoke — `/goal-loop <trivial objective>`, watch v1 achieve, the info
  toast, summary generation, v2 armed and worked, dialog shows iteration history, `/goal-loop clear`
  stops it, restart restores loop state, caps pause correctly. Screenshot notes: see "Smoke notes" below.

## Smoke notes

Filled in after the manual smoke run (worktrees/wt-goal-loop), 2026-11-14.

Environment: headless PTY (term-driver) driving the real opencode v2.3.0 TUI against a scratch
repo, with the worktree plugin loaded from the user's global config (temporarily repointed,
restored afterwards). Model: 9router-go/TokenHarbor-Free; Antigravity-Free (the configured
default) was returning {bad_gateway ... "all combo models failed: no valid entries"} for the
entire smoke window, so the smoke used the user's 9router-go TokenHarbor-Free instead. Budget
and behaviour of the goal/loop machinery do not depend on the model.

Verified live:
- /goal-loop arms v1 and, on met, arms vN+1 (v2 through v5 observed across runs).
- maxLoops cap fires: "Loop complete after 5 iterations" (WIDGET, DRAFT, SMOKE-DONE, DESIGN).
- LOOP_COMPLETE ends the loop cleanly: "Loop complete after 2 iterations" (REPRO) and after 1
  (COUNTER), with a final achieved toast. Generated goals were concrete, verifiable, and each
  inherited the loop objective.
- Restore on restart: SIGTERM, relaunch with -s, the loop resumes with turns/stall/checkins
  reset and loopIteration/loopHistory intact; completed sessions restore unchanged.
- /goal opens the detail dialog with the full loop state (iteration, objective, per-iteration
  history with verdicts and summaries), fallback text when no live record exists; esc closes;
  header and hint stay pinned with long content; long history scrolls inside the body.
- prompt.footer paints "◎ loop · vN · <state> · <elapsed> · <turns>" for a live loop.
- Coordinator flow runs from inside a loop (claim -> worktree -> submit -> merge-next -> dev),
  observed for REPRO (wt/repro-txt-ok), WATCH (wt/watch-txt-ok), Z3 and COUNTER loops.
- Per-iteration toasts (one info toast per met verdict) read fine live; not noisy at 2-7
  iterations. Kept: one info toast per iteration, one achieved toast at loop end.
- The detail dialog: host chrome (bold title left, esc right, DIALOG_INSET=3, theme tokens,
  sticky scrollbox off, contentOptions.minHeight=0, clamped column) — verified with content
  taller than the viewport: header and hint pinned, scrollbox scrolls, no clipping.

Bugs found and fixed during the smoke:
- TUI plugin crashed at setup and never mounted ("TUI plugin error ... No renderer found";
  reported by /plugins). useTerminalDimensions() was called at setup scope, before the
  renderer exists; the host only exposes it inside rendered components. Fixed by moving the
  clamp into a small component rendered by the dialog (commit c7f643d), plus try/catch around
  all reactive closures and event handlers so one bad evaluation can never latch the host's
  plugin error boundary and silence the whole plugin. Verified: plugin mounts, footer paints,
  dialog opens, notices flow.
- /goal opened the detail dialog only when the TUI route matched the notice's sessionID;
  otherwise it silently did nothing. Now always opens for the notice's session.

Known issue (not introduced here, not fixable inside the plugin): the prompt.footer indicator
stops re-painting after the first loop arm — the ANSI stream shows only the frames from before
the first arm ("loop · v1 · active", "loop · v1 · checking"), while notice events keep arriving
and the /goal dialog (which re-fetches via RPC get) always shows live state. Plugin handlers
for the changed event are trivial and fire correctly on arm (the dialog proves the state path);
the staleness reproduces across hosts builds and sessions, including pre-change builds. Treat
prompt.footer as best-effort and the dialog/palette as the source of truth. Not addressed here;
the fix, if any, lives in the host event bridge.

Not verified: Antigravity-Free (provider outage). Docs lease: taken (no other holder); README
and docs/*.html updated for the new command only.
## Workstream C — dev rebuild and cleanup acceptance criteria

Interpretation of "next merged to dev rebuild the binary and clean up": after wt/goal-loop-failure-modes
landed on dev (d86c03b), rebuild the shipped TUI bundle, verify the package layout, and consolidate the
repo state left by the merge.

16. `dist/tui.js` and `dist/tui.d.ts` are rebuilt from the current `src/tui.tsx` via `bun run compile`;
    after the rebuild and this commit, `git status --short` on this branch reports only tracked files that
    are meant to ship. If the rebuild is byte-identical, nothing is committed for dist/.
17. `npm pack --dry-run` (or `bun pm pack` equivalent) lists exactly the files `package.json` declares in
    `files` (index.ts, tui.ts, rpc.ts, src/, dist/, packages/coordinator/) and reports a reasonable tarball
    size; no build debris (e.g. logs, caches, .term/) leaks in.
18. The coordinator lease bookkeeping (`.term/coordinator/state.json`) carries the merge-next entry for
    goal-loop-failure-modes and is committed to dev, so the coordination bus on dev is not left dirty.
19. No stale state remains in the repo: `git worktree list` shows only the dev checkout, `git branch` shows
    only `dev` and `main`, and `worktrees/` contains no `wt-*` directories.
20. `bun run check` passes on dev (tsc, tests, compile) with this branch merged.

Verification: `bun run compile` (byte-diff of dist/), `npm pack --dry-run`, `git worktree list`,
`git branch -a`, `git status --short`, `bun run check`, then coordinator submit + merge-next.

## Workstream D — CI and release hygiene acceptance criteria

Interpretation of "keep improving the current directory functionalities" for this iteration: the repo had no
continuous integration and its docs changelog/stamps had drifted behind `dev`. This workstream adds a CI gate,
folds the TUI load check into `bun run check`, and regenerates the docs metadata.

21. `.github/workflows/check.yml` exists and runs on push to `dev`/`main` and on pull requests:
    `bun install --frozen-lockfile`, `bun run check`, and an `npm pack --dry-run` smoke test. The workflow
    uses `oven-sh/setup-bun@v2` and has no secrets or network dependencies beyond package registries.
22. `bun run check` includes `check:tui` (`bun scripts/tui-load-check.ts ./tui.ts`, loads `tui.ts` the way
    the OpenCode host does; fails if the default export is not a TUI plugin). `AGENTS.md`, `README.md` and
    this file state the composition; superseded by Workstream E, which appends `docs:check`.
23. `npm pack --dry-run` still lists exactly the `files` declared in `package.json` (32 files, ~64 kB as of 2026-11-15,
    i.e. including `src/rpc-handlers.ts`) with no `.github/`, `worktrees/`, `.term/` or log debris in the tarball.

Verification: `bun install --frozen-lockfile`, `bun run check` (expect `ok: loaded TUI plugin "opencode-goal.tui"`),
`npm pack --dry-run`, `git status --short`, then coordinator submit.

24. The commit policy never hands the agent a repo-relative coordinator bin: when
    `resolveCoordinatorBin` finds no absolute binary, `coordinatorFlow` injects an explicit
    "binary missing" instruction (work on `wt/<slug>`, report, manual merge) instead of the old
    `packages/coordinator/bin/coordinator` fallback, in both the auto-detected (json markers,
    no bin anywhere) and the forced `coordinator: true` paths (`src/core/git.ts`,
    `src/core/prompts.ts`, `src/core/types.ts`).
25. The loop summary cap uses the documented formula in both places:
    `max(200, tokens) * 4` (`src/runtime/evaluator.ts` `cap()` now matches
    `src/runtime/controller.ts` and README/config docs; was `max(200, tokens * 4)`).
26. `packages/coordinator/bin/coordinator`: comma-separated `--paths` are whitespace-trimmed
    before overlap checks (`"src, docs"` now overlaps `docs`), the dead `_newp` read and the
    unreachable second empty-slug guard are gone, and an overlap failure prints one error naming
    the conflicting lease (not two).
27. `bun run check` passes and includes 15 new unit tests: `test/evaluator.test.ts`
    (session/independent evaluation, independent→session fallback, REPAIR retry, unreadable-verdict
    EvaluationError, pre-aborted signal unwinds `isEvaluating`, summary cap formula, nextGoal
    trim/cap) and `test/store.test.ts` (`sameDirectory` normalization, `loadLive` directory
    filtering, malformed records skipped, empty restore). 200 tests total, all green.
28. Docs line references point at the real definitions at the time of writing (`docs/config.html`: `prompts.ts`
    `coordinatorFlow` `:64`, `commitStatusSuffix` `:82`, `rubric` `:263`, `facts` `:288`,
    `git.ts:146`; `docs/index.html`: steer refs `controller.ts:461`, `prompts.ts:164`). References were
    re-synced against HEAD on 2026-11-15 after the restoreOne/sameDirectory and merge-next merges
    shifted `controller.ts`. Note the caveat, discovered the hard way: `docs:check` verifies only page
    stamps and the changelog against git history; it does NOT verify that a `file.ts:LINE` reference
    points at the claimed symbol, so line refs can drift silently and must be re-checked by hand when
    source moves. The README coordinator section documents the `.gitignore` auto-append and the
    missing-binary behavior, and `docs/changelog.html` + page stamps are regenerated.

Verification (all run in the worktree): `bun install --frozen-lockfile`, `bun run check`
(expect 200 pass, `ok: loaded TUI plugin`), `npm pack --dry-run`, `bash -n
packages/coordinator/bin/coordinator`, overlap trim exercised end-to-end against a throwaway repo
(`claim --paths docs` against a lease with `"src, docs"` fails with a single error; a
non-overlapping claim succeeds), then coordinator submit.


## Workstream E — docs freshness gate acceptance criteria

Interpretation of the armed condition: docs stamps and the changelog had no automated guard, so they
drifted silently (iteration 1 committed stamps that already trailed the commit containing them). This
workstream adds a read-only gate.

29. `bun scripts/docs-watch.ts check` (`bun run docs:check`) exits 0 when every `docs/*.html` page's
    `<span class="stamp">` equals the date of the newest non-merge commit touching that page, excluding
    mechanical `docs: refresh` commits, and `docs/changelog.html`'s table equals the regenerated rows
    (same exclusions). Otherwise it exits 1 and lists every stale page/table with the expected date.
    The check is read-only (never writes) and never requires network or repos beyond git itself.
30. `bun run check` is `tsc --noEmit && bun test && bun run compile && bun run check:tui && bun run docs:check`;
    CI (`.github/workflows/check.yml`) enforces it unchanged. `AGENTS.md`, `README.md` document the
    gate and the restamp workflow (`once`, then commit as `docs: refresh stamps and changelog`).
31. `test/docs-watch.test.ts` proves the gate end-to-end against a throwaway git repository: fresh state
    passes, a docs commit without a restamp fails with the stale page listed, `docs-watch.ts once` +
    refresh commit makes it pass again; `bash -n`-equivalent guarantees keep the script typed (it is TS run by bun).

Verification: `bun run docs:check` (pass on dev after the refresh commit), `bun test test/docs-watch.test.ts`,
`bun run check` green, docs regenerated, coordinator submit.

## Workstream F — tool-call counting regression acceptance criteria

Interpretation of "the loop is pausing": two loop iterations completed real work (hundreds of tool calls),
yet both loop history entries recorded `toolCalls: 0`, so the two-strike not-progress guard paused the
loop with "two consecutive iterations without tool use" after iteration 2 was met. Root cause: after a
plugin reload (e.g. triggered by a merge changing the plugin's watched files), `restore()` rebuilt the
goals map but never the per-session runtime, so `onToolCalled`/`onExecutionStarted` silently dropped every
tool event until the first `session.execution.succeeded` lazily created one.

32. `onToolCalled` and `onExecutionStarted` lazy-create the per-session runtime whenever a goal exists for
    the session (`this.runtime(sessionID)`), so tool events before the first execution-end are always
    counted; `restore()` creates one up front for every restored live record. Tool events for sessions
    with no goal still no-op.
33. Regression test `test/loop.test.ts` "a restored loop counts tool calls before the first execution-end":
    arms a loop, disposes, restores from the same storage, runs an execution with 5 tool calls, and asserts
    the loop history entry records `toolCalls: 5`. All 205 tests pass.

Verification: `bun test` (205 pass), `bun run check`, coordinator submit + merge-next.

## Workstream G — merge-next gates on the merged result

Interpretation of the armed condition: `merge-next` ran `bun run check` on dev's pre-merge HEAD, so a
branch whose merge is the fix for the very staleness the gate detects (e.g. a docs freshness refresh)
was blocked by the state it repairs — a deadlock that forced a manual unblock (2026-11-15).

34. `packages/coordinator/bin/coordinator merge-next` trial-merges the candidate `wt/<slug>` branch into
    `dev` on a throwaway `merge-check-<slug>-<pid>` branch (created from `dev` and checked out), runs
    `bun run check` on that merged result, and only then moves `dev` onto it via `merge --ff-only`.
    A failing merged result aborts with `dev` untouched (no merge commit, no lease marked done).
    Scratch branches from interrupted runs are pruned best-effort on every run.
35. The main checkout must be clean for the merge, with the coordinator's own
    `.term/coordinator/state.json` exempt (claim/submit leave it dirty by design).
    A tracked, non-exempt modification aborts the merge before any branch is created. The exempt dirt
    is stashed to `.term/coordinator/.state-stash.*` for the duration of the trial merge and restored
    afterwards (or by the exit trap on failure), so a wt branch that records only `.term/coordinator/state.json`
    lease bookkeeping merges cleanly through the gate, and the submitted lease record survives any
    outcome of the merge (restored before the lease is flipped `done`, or by the trap on failure).
36. `test/coordinator.test.ts` proves the paths in a throwaway git repo: a merge that is the fix
    for the gate succeeds and lands (lease `done`); a merged result that fails the check aborts with
    `dev` and the lease untouched; a normal green merge lands; a dirty (non-exempt) main checkout is
    refused; a branch recording only `.term/coordinator/state.json` bookkeeping merges cleanly and the
    submitted lease record survives (success path flips it `done`; the failing path keeps it
    `submitted`), with no `.state-stash.*` files left behind. Scratch branches are cleaned up on failure.
37. `AGENTS.md`, `docs/install.html` and this file document the merged-result gate and the cleanliness
    exemption; `bun run check` stays green (205+ tests, docs freshness passes).

Verification: `bun test test/coordinator.test.ts` (5 tests), `bun run check` green, coordinator
submit + merge-next (this branch merges through the new gate), then commit state.json to dev.

## Workstream H — RPC read-through for restored goals acceptance criteria

Interpretation of the armed condition: after a plugin reload the goal RPC answered with `goal: null`
(and `list` with `goals: []`) even though an active record existed in plugin storage. `restore()` only
runs at plugin setup and only for the instance's own directory, so a reloaded or differently-scoped
instance served the RPC from an empty in-memory map.

38. `GoalStore.load(sessionID)` reads one record (undefined when missing/malformed). `GoalController`
    factors its restore body into `adoptRestored` (shared by the bulk `restore()` and a new
    `restoreOne(sessionID)`), which adopts one live record from storage with the same reset semantics
    (fresh `startedAt`/`turns`/`stall`/`retries`/`checkins`, fresh baseline, in-memory record created,
    durable write). `restoreOne` returns `false` for missing or non-live records.
39. The RPC handlers read through: `goal.get` calls `restoreOne` before answering (early-out when the
    record is in memory), and `goal.list` restores from storage when the in-memory list is empty.
    A live goal is never reported as missing while a live record exists in plugin storage.
40. Tests prove it: `test/store.test.ts` "GoalStore.load" (missing/malformed/valid),
    `test/loop.test.ts` "RPC read-through after a reload" (restoreOne adopts a live record with an
    empty map; finished records stay un-restored; list falls back to a storage restore). All 214 tests pass.

Verification: `bun run check` green (214 pass, `docs freshness check passed`), coordinator submit +
merge-next, then commit state.json to dev.

## Workstream I — `/api/rpc/goal/get` never returns a 500 acceptance criteria

Interpretation of the armed condition: the TUI received an HTTP 500 from `POST /api/rpc/goal/get`
(2026-11-15T06:29:51) for a session whose record existed but had just been resumed. The RPC handlers
assemble `snapshot(sessionID, spend)` from inputs that could transiently disagree (missing sessionID,
storage failures, mid-restore state); any throw escaped the plugin as an unhandled error.

41. The RPC handlers are built by `createRpcHandlers` (`src/rpc-handlers.ts`) and are total: every
    handler catches any failure and returns a benign fallback matching the `GoalRpc` contract —
    `get` → `{ goal: null }`, `list` → `{ goals: [] }`, `status` → `{}`, `clear` → `{ cleared: false }`.
    `get` performs the storage read-through (`restoreOne`) inside its own guarded path, and a failure
    there or inside `snapshot`/`spend` still yields `goal: null`, never an exception.
42. Malformed or missing inputs never throw: `undefined`, `null`, `{}`, empty/non-string `sessionID`
    all return `{ goal: null }`. `test/rpc-handlers.test.ts` proves this plus double-failure paths
    (spend throws AND snapshot throws; restoreOne throws; list explodes; status explodes; clear explodes)
    and the `GoalRpc` output shape. `src/index.ts` registers exactly these handlers.
43. `bun run check` stays green (223 tests) and dev is green after merge.

Verification: `bun test test/rpc-handlers.test.ts` (9 tests), `bun run check`, coordinator submit +
merge-next, then commit state.json to dev; `opencode api POST /api/rpc/goal/get -d '{"input":{"sessionID":"x"}}'`
after the merge shows the benign fallback instead of a 500.
