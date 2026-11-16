# SPEC — current behavior of opencode-goal

Status: current as of v1.0.1 (plus the two workstreams specified below). The TUI indicator renders natively: a compact segment painted on the
empty left side of the host's jump-to-latest row (the 1-row strip directly above the input prompt, claimed through the host's
`session.composer.top` slot with a zero-flow absolute box), state transitions surface as
host toasts, and the `/goal` detail view is a host dialog (`ui.dialog.show` chrome: backdrop, Esc dismissal,
xlarge centered sizing) built from theme tokens only (see `src/tui.tsx`). The only exception to "host-owned
layout" is that one 1-row absolute box; no custom chrome, no custom colors.
The project `opencode.json` points at the local checkout.

This file is the acceptance spec for the plugin as it ships today. The how and why live in README.md and
`docs/`; this file only states what must hold, so regressions are visible.

## Acceptance criteria

1. `/goal <condition>` sets the goal and starts work immediately; `/goal` with no arguments shows status;
   `/goal clear` (aliases `stop`, `off`, `reset`, `none`, `cancel`) ends it. Any other text is the condition
   (`src/core/parse.ts`, `src/core/types.ts` `CLEAR_ALIASES`).
2. After every turn an evaluator answers `met` / `not_met` / `impossible`. `not_met` starts the next turn
   with a synthetic steer prompt; `met` / `impossible` end the goal. The turn cap (default 0 = off) and the
   stall guard (default 0 = off; turns without tool use) are opt-in plain-goal stops; an armed `/goal-loop`
   never pauses at either — it emits a one-time notice and keeps running. Fatal errors can also end the goal
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
7. The TUI renders through host chrome: the active/paused indicator claims the host's
   `session.composer.top` slot (append) and paints one zero-flow absolute 1-row box on the empty left side
   of the host's jump-to-latest row (the full-width strip above the input prompt, which the host renders with
   the pill flush right); the detail view renders through `ui.dialog.show` host chrome (Esc and
   ctrl+c dismiss it, backdrop and focus owned by the host), transitions use `ui.toast.show` with the host's
   variants, and every color/border/font comes from `context.theme` tokens (no hardcoded RGBA, no custom
   borders). Layout of the strip itself stays with the host; the indicator never adds a row
   (`src/tui.tsx`).

## Workstream A — detail dialog acceptance criteria

8. The `/goal` detail dialog keeps the host chrome (`ui.dialog.show`, xlarge, centered, Esc/ctrl+c
   dismissal owned by the host) and the header convention: bold title left, `esc` right, the 3-cell
   side padding (`paddingLeft={3} paddingRight={3}` on the host's `ClampedColumn`, `src/tui.tsx`), gap 1,
   bottom pad 1. The body is composed from theme tokens only (`text.base`,
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
- The detail dialog: host chrome (bold title left, esc right, 3-cell side padding, theme tokens,
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
23. `npm pack --dry-run` still lists exactly the `files` declared in `package.json` (32 files, ~65 kB as of 2026-11-15,
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
    all return `{ goal: null }` at the handler layer. Two layers reject before the handler ever runs,
    both verified live on 2026-11-15: the RPC schema (`sessionInput`, `additionalProperties: false`)
    answers `rpc.invalid_input` (`Missing key at ["sessionID"]`, `Expected string`, `Expected object`,
    `Expected never` for extra props) and a non-JSON body answers `InvalidRequestError` — all
    structured 400s, never a 500. `test/rpc-handlers.test.ts` proves the handler layer plus
    double-failure paths (spend throws AND snapshot throws; restoreOne throws; list explodes;
    status explodes; clear explodes) and the `GoalRpc` output shape. `src/index.ts` registers
    exactly these handlers.
43. `bun run check` stays green (228 tests) and dev is green after merge.

Verification: `bun test test/rpc-handlers.test.ts` (9 tests), `bun run check`, coordinator submit +
merge-next, then commit state.json to dev. Note: plugin RPC calls are directory-scoped — the
`/api/rpc/<rpcID>/<method>` endpoint requires the `location[directory]=<abs path>` query parameter
(deepObject style), e.g.

    curl -g -u opencode:$OPENCODE_PASSWORD -H 'Content-Type: application/json' \
      -X POST 'http://127.0.0.1:<port>/api/rpc/goal/get?location[directory]=/home/pauk/Projects/opencode-v2-goal/opencode-goalv2' \
      -d '{"input":{"sessionID":"x"}}'

or `opencode api --server http://127.0.0.1:<port> POST /api/rpc/goal/get
--param 'location[directory]=/home/pauk/Projects/opencode-v2-goal/opencode-goalv2'
-d '{"input":{"sessionID":"x"}}'`. Without the parameter the server answers a structured
`rpc.unavailable` (HTTP 400, not a 500), which is not a handler failure. With it, the benign
fallback `{"output":{"goal":null}}` is observed instead of a 500 (verified live on 2026-11-15,
`goal/list` likewise returns `{"output":{"goals":[...]}}`).

## Workstream J — loop hardening: verifier, bookkeeping, probe isolation, spec honesty, re-arm hygiene

Interpretation of the armed condition: six systemic weaknesses of the `/goal-loop` machinery, each with a
guard, tests, and documentation. Follow-ups bigger than one iteration are listed at the end, not smuggled in.

<!-- spec-check files=41 tests=452 -->

44. Verifier, not transcriber: `evaluator.verifyCommand` (env `OPENCODE_GOAL_VERIFY_COMMAND`; whitespace-only
    disables; default `""`) and `evaluator.verifyTimeoutMs` (env `OPENCODE_GOAL_VERIFY_TIMEOUT_MS`; default
    600000, min 1000). When set, a `met` verdict is held at the verification gate in the controller
    (`verifyMet`, `src/runtime/controller.ts`): the plugin itself runs the command
    (`VerifierPort`, `src/runtime/ports.ts`; implemented in `src/index.ts` `createVerifier` as `bash -c`,
    `cwd` = the goal's directory, combined output tail-capped at 16 kB, deadline `verifyTimeoutMs`) and accepts
    `met` only on exit 0. Non-zero exit, spawn error, or timeout downgrades the verdict to `not_met` with the
    last ~12 lines of output in the reason; a warning notice fires; the normal not_met path dispatches a
    continuation carrying that tail. A missing verifier port is fail-closed (downgraded, never met). The gate
    runs on `met` only — not_met/impossible paths are untouched — and a looped goal cannot advance on a
    failed verification. With the default empty command, behavior is byte-compatible with before.
45. Evidence the evaluator accepts is defined and documented: fresh command output at the current HEAD after
    the last change — never prior summaries, the agent's narration, or a previous verdict. The rubric
    (`src/core/prompts.ts` `RULES`) states this; README, `docs/config.html`, `docs/runtime.html` and AGENTS.md
    document it. The prompt-level evaluator still cannot run commands; the harness gate is what makes
    `met` verifiable end-to-end.
46. Bookkeeping policy, one, documented: `packages/coordinator/bin/coordinator merge-next` unions the live
    `.term/coordinator/state.json` with the committed copy (lease keys from both, live bus wins per key,
    `mergeLock` reset to null) and auto-commits the result on `dev` as
    `chore(coordinator): record <slug> lease done after merge`. The union guarantees an entry landed on `dev`
    by a wt bookkeeping branch is never reverted by the merge's own lease flip. The chore commit is part of
    the merge flow (the only sanctioned path to `dev`), not a direct dev commit by an agent; a failed commit
    leaves the dirt exempt and the next merge-next retries. AGENTS.md documents the policy; `test/coordinator.test.ts`
    proves: the lease flip is committed on `dev`, the main worktree is clean for `state.json`, and the union
    keeps `old-record` while adding the merge's lease (regression test added for the clobbering case).
47. Probe isolation: `OPENCODE_GOAL_PROBE=1` puts plugin storage in read-only mode (`GoalStore` drops
    saves/removes, reads pass through), so a probe opencode server or a second `restore()` cannot mutate the
    live goal records. Probe mode is logged at setup. Documented in AGENTS.md, README.md, `docs/config.html`,
    `docs/install.html` and `docs/runtime.html`; `test/store.test.ts` proves dropped writes, unchanged reads.
    Verify commands still execute in the probe's cwd — probes must target a throwaway checkout.
48. Spec honesty gate: `scripts/spec-check.ts` (`bun run check:spec`, wired into `bun run check` after
    `docs:check`) reads the `<!-- spec-check files=N tests=N -->` marker in this file and exits 1 listing
    mismatches when the `npm pack --dry-run --json` file count or the `bun test` pass count trails it.
    Read-only; counts only (sizes excluded as npm-version noise). The marker above is part of the definition
    of green; it must be updated in the same commit that changes shipped files or tests. CI inherits the gate.
49. Re-arm hygiene: the armed `/goal-loop` iteration's directive (`loopContinuation`,
    `src/core/prompts.ts`) requires re-reading `git log --oneline -5`, `git status --short`,
    `git branch --show-current` (plus `coordinator status --json` / `git worktree list` in coordinator repos)
    and the current check output *before* any work — the armed summary is labeled stale until then.
    Zero-progress is harness-verified: `iterationToolCalls` comes from the plugin's own tool events
    (`onToolCalled`), never from model self-report; two consecutive zero-tool iterations pause the loop
    (`loopNotProgress`). Regression test: a loop whose evaluator claims heavy work with zero harness tool
    calls still pauses after two iterations, and both loop-history entries record `toolCalls: 0`.
50. Audit trail: SPEC (this workstream), AGENTS.md (evidence requirements, probe isolation, bookkeeping
    policy, spec gate, re-arm hygiene), README.md ("Running the loop safely" checklist + options table),
    `docs/runtime.html` (verification gate and fresh-session promotion checklist), `docs/config.html`,
    `docs/install.html`, `docs/core.html`. `bun run docs:check` stays green.
51. `bun run check` passes: tsc, `bun test` (244 tests at the time of writing), compile, `check:tui`,
    `docs:check`, `check:spec`.

Verification (all run in the worktree): `bun test` (verify/loop/store/coordinator/loop-prompt suites),
`bun run check` end-to-end green including `spec-check`, `bash -n packages/coordinator/bin/coordinator`,
coordinator submit + merge-next (this branch's own merge exercises the new auto-commit path on dev),
then commit the state.json bookkeeping via the merge itself.

Out of scope / follow-ups (bigger than one iteration; not this loop's job):
- An argv-based verifier (skip `bash -c`) for hosts without a shell; quoting bugs in complex verifyCommands.
- spec-check enforcing tarball size bands, and SPEC counts beyond the marker (per-workstream historical claims).
- A host-side fix for prompt.footer staleness after the first loop arm (already a known host issue).
- Wiring verifyCommand into the live dev repo's own `opencode.json` (policy choice, not a code change).

## Workstream K — the goal history, re-imagined in the detail dialog

Interpretation of "keep improving the terminal tui display of this current plugin how it shows the goal
histories be creative": the `/goal` detail dialog rendered the loop history as flat `vN · met · turns ·
summary` rows — a wall of near-identical text with no sense of progress, no per-iteration timing, and the
per-turn evaluator verdict trail (`GoalSnapshot.history`) was not rendered at all. This workstream rebuilds
the history section as a visual iteration rail with a progress bar, per-iteration timing and tool counts, a
"now" row for the running iteration, and an evaluator verdict trail, rendered entirely from existing
snapshot fields (no RPC, schema, storage or controller changes).

52. The loop history renders as an iteration rail (`src/tui-history.tsx`, pure helpers in
    `src/core/history.ts`): for each `loopHistory` entry a `✓` glyph (feedback.info) on a vertical `│`
    rail, then `vN · met · <turns> turns · <toolCalls> tools · <duration>` — duration is `endedAt` minus the
    previous entry's `endedAt` (or `setAt` for v1), via `formatDuration` — and the entry's `summary` wrapped
    on a `│`-prefixed line in `text.faint`, indented under the rail. Theme tokens only; no borders, no
    hardcoded RGBA, no absolute positioning.
53. A progress bar sits above the rail: `█` filled (feedback.info.base) vs `░` empty (text.faint),
    fixed 18 cells, filled = round(completed / loopMaxLoops × 18), clamped to [0, 18]; caption
    `v<current> of at most <max> · <done> complete`. When `loopMaxLoops` is absent the bar renders
    all-empty with caption `v<current> · <done> complete` and never divides by zero.
54. A "now" row closes the rail for the running iteration: `◎ v<current> · <state> · <turns> turns ·
    <elapsed>` (elapsed extrapolated live by the dialog as today) in feedback.info when active /
    text.warning when paused. Rendered as the rail's last row; when the history is empty (a loop that
    has not completed v1 yet) it stands alone — just the bar, objective and now row render, no rail rows.
55. The evaluator verdict trail renders below the rail from `GoalSnapshot.history`: up to the last 24
    verdicts, one glyph each — `✓` met (feedback.info.base), `✗` not_met (text.faint), `⊘` impossible
    (text.warning.base) — oldest first, then a `text.muted` caption `<shown> of <total> verdicts`.
    Renders nothing (section omitted) when `history` is empty. Long trails never wrap mid-glyph:
    trail + caption truncate from the left, keeping the newest verdicts.
56. The prompt footer loop indicator shows the cap when known: `◎ loop · v<N>/<max> · …` (was
    `◎ loop · v<N> · …`); unchanged when `loopMaxLoops` is absent.
57. The `/goal` status dialog keeps the host chrome, header convention, scrollbox and footer hint exactly
    as Workstream A/7-10 describe; only the loop section inside the body is re-laid-out (status line,
    condition, evaluator/reason, spend and the non-looped path are unchanged).
58. `scripts/render-history.tsx` renders the history components headlessly via `@opentui/solid`'s
    `testRender` (fixed width/height, sample loop with 2 completed iterations and a running v3, sample
    verdict trail) and prints the captured char frame; it is a verification tool, not shipped (scripts/
    is not in `files`). Visual check: the rail, bar, now row and trail are all legible in the captured frame.

Verification: `bun test` (new `test/history.test.ts` covers `renderBar` clamping/zero-max/rounding,
`verdictGlyph`, `iterationDurations` with v1 anchored at `setAt`, `trailWindow` left-truncation; existing
suites untouched and green), `bun run check` (tsc, tests, compile, check:tui, docs:check, check:spec),
`bun --preload @opentui/solid/preload scripts/render-history.tsx` output captured in the commit message evidence (the preload maps solid-js’s server build to the client build, exactly how the host loads the plugin), coordinator submit.

## Workstream L — non-looped history block and footer pips

Interpretation of iteration 2's condition: Workstream K gave looped goals a rich history section but
left non-looped goals with nothing but the condition and spend, and the footer's `vN/M` caption gave no
sense of how far through the cap the loop was. This workstream extends the same visual language to
non-looped goals and adds iteration pips to the loop footer.

59. Non-looped goals render a compact history block in the `/goal` detail dialog (after spend, and in
    place of the loop section): a `history` row — the last verdict glyph (bold; info for met, faint for
    not_met, warning for impossible) followed by `last <verdict> (turn N) · <turns> evaluated turns ·
    <met> met · <not_met> not_met[ · <impossible> impossible] · <elapsed>` — and below it the shared
    verdict trail row. When no verdict has been returned yet, the row degrades to
    `no verdicts yet · <elapsed> elapsed` and the trail row is omitted (`src/tui-history.tsx`
    `HistoryBlock`).
60. The verdict trail is extracted as a shared component (`VerdictTrail`) used by both the loop section
    and the non-looped block; rendering and windowing behavior are unchanged (24 newest, oldest first,
    `<shown> of <total> verdicts` caption, omitted when empty).
61. The prompt footer loop indicator gains iteration progress pips when `loopMaxLoops` is a finite
    number in [1, 8]: `●` per completed iteration (from `loopHistory.length`) + `○` for the remainder,
    appended after the `vN/M` segment: `◎ loop · v3/5 ●●○○○ · active · 12m · 3 turns`. Rendered in the
    footer's existing single color; omitted for missing, zero, negative, NaN or >8 caps. Looped dialog
    content is unchanged.
62. Pure helpers `verdictCounts`, `lastVerdict`, `renderPips` live in `src/core/history.ts` and are unit
    tested (`test/history.test.ts`): tallies, empty/newest-last semantics, pip rendering and clamping.
63. `scripts/render-history.tsx` renders three headless frames by default — looped (full), non-looped
    with verdicts, fresh non-looped (no verdicts yet); `--empty` keeps the empty-loop frame. All frames
    legible: last-verdict glyph, counts, elapsed, trail, and the fresh-state fallback line.

Verification: `bun test` (history suite 26 tests), `bun --preload @opentui/solid/preload scripts/render-history.tsx`
(frames printed and eyeballed), `bun run check` green, coordinator submit + merge-next.

## Workstream M — pace, per-iteration verdict mix, verdict streaks

Interpretation of iteration 3 of the armed objective ("keep improving the terminal tui display of
this current plugin how it shows the goal histories be creative"): the history views showed what
happened but not the rhythm of it. This workstream adds temporal texture from data the snapshot
already carries — verdict timestamps (`VerdictEntry.at`) and per-iteration `endedAt` windows — without
touching RPC, storage, schema or the controller.

64. The loop section gains a `pace` row (faint) under the block bar, rendered only while the goal is
    live: at least one iteration completed, `loopMaxLoops` is set, and the status is not terminal
    (never on achieved/impossible/cleared/failed, never for a fresh loop, never for an unknown cap):
    `~<avg>/iteration · ~<remaining> left at this pace`, avg = mean of `iterationDurations`,
    remaining = avg × (loopMaxLoops − completed).
65. Each rail row gains the iteration's verdict mix, derived by matching `VerdictEntry.at` into the
    iteration's `(previous endedAt | setAt, endedAt]` window: `<met>✓ <not_met>✗[ <impossible>⊘]`
    appended to the row's timing segment (faint). Iterations with zero verdicts in their window render
    no mix segment.
66. The non-looped history block gains a streak suffix when the trail ends with ≥ 2 consecutive
    identical verdicts: `· <N>× <verdict> in a row` (verdict shown with underscores replaced by
    spaces), colored with the last-verdict color. Absent otherwise.
67. New pure helpers in `src/core/history.ts`: `paceEstimate`, `iterationVerdictMix`,
    `verdictStreak` — unit-tested (`test/history.test.ts`): windows (first iteration anchored at
    setAt, mixed boundary verdicts), zero-verdict iterations, pace rounding and omission rules,
    streak counting and kind detection.
68. `scripts/render-history.tsx` prints the same three frames; the looped frame now shows the `pace`
    row and the per-iteration mix, and the non-looped frame shows the streak suffix. Verified
    headlessly before submit.

Verification: `bun test` (new helper tests), `bun --preload @opentui/solid/preload scripts/render-history.tsx`
(frames show pace row, mix segments and streak suffix), `bun run check` green, coordinator submit +
merge-next.

## Workstream N — relative ended-ago timestamps, paused diagnostics

Interpretation of this iteration's condition: the rail shows how long each iteration took but not
when it finished, and a paused loop's now row says `paused` without the diagnostics that explain
why. Both come from data the snapshot already carries (`LoopEntry.endedAt`; `stall`, `retries`).

69. Each iteration rail row gains a relative `ended <ago>` suffix (faint, appended after the verdict
    mix): `just now` under a minute, `<N>m ago` under an hour, `<H>h <M>m ago` under a day,
    `<D>d <H>h ago` beyond; future timestamps clamp to `just now`; non-finite inputs yield `just now`.
    The reference clock is a reactive `nowMs()` getter prop (the dialog's minute-resolution signal),
    falling back to Date.now().
70. The now row, when the goal is paused, appends stall/retries diagnostics from the snapshot:
    `· stall <N> · retries <N>` (values floor-clamped to >= 0, NaN degrades to 0). Non-paused rows
    are unchanged. The `paused` word keeps its warning color.
71. New pure helpers `relativeTime` and `pauseDiagnostics` in `src/core/history.ts`, unit-tested
    (`test/history.test.ts`): minute/hour/day formatting, clamping, NaN handling, diagnostic
    clamping.
72. `scripts/render-history.tsx` prints four frames by default — looped, looped-paused (the now row
    must show `stall <N> · retries <N>`), non-looped, non-looped-fresh; `--empty` keeps the empty-loop
    frame. The looped frame's rail rows show `ended <ago>` suffixes.

Verification: `bun test` (new helper tests), `bun --preload @opentui/solid/preload scripts/render-history.tsx`
(frames show ended-ago suffixes and the paused diagnostics), `bun run check` green, coordinator submit +
merge-next.

## Workstream O — final tally row for finished loops, streak on the looped now row

Interpretation of this iteration: the dialog shows the running and completed iterations but nothing
about what the whole loop added up to once it finishes, and the trailing-verdict streak surfaced only
on the non-looped block. Both are closing summaries, from snapshot fields already on the record.

73. When a looped goal is finished — terminal status (`achieved`, `impossible`, `cleared`, `failed`)
    or `loopHistory.length >= loopMaxLoops` (known cap) — the loop section renders a final `final` row
    after the now row: glyph colored by outcome (✓ info achieved, ⊘ warning impossible, ✗ faint
    otherwise) and `<N> iteration{s} · <turns> turns · <tools> tools · <wall> wall` where wall is the
    span from `setAt` to the last entry's `endedAt` (`<1m` floor; never negative). Not rendered while
    the loop is live and below the cap.
74. The looped now row gains the trailing-streak suffix (same rule as the non-looped block, `<N>×
    <verdict> in a row`, verdict underscores replaced by spaces) appended after the elapsed segment
    when the trail ends with ≥ 2 identical verdicts.
75. New pure helper `loopTotals(entries, setAt): { iterations, turns, tools, spanMs }` in
    `src/core/history.ts`, unit-tested (aggregates, zero completed iterations span 0, last-endedAt
    anchor).
76. `scripts/render-history.tsx` prints five frames by default — looped, looped-paused, looped-complete
    (the `final` row must show the tally), non-looped, non-looped-fresh; `--empty` keeps the
    empty-loop frame.

Verification: `bun test` (new helper tests), `bun --preload @opentui/solid/preload scripts/render-history.tsx`
(frames show the final tally and streak suffix), `bun run check` green, coordinator submit + merge-next.

## Workstream P — dialog scrollbox design repair

Interpretation of the bug report ("the goal's display dialog design current is a bit rough. edges
the scrolling has design inconsistency flaw", with a screenshot of the paused loop dialog): the body
scrollbox passed `scrollbarOptions={{ visible: true }}`, which the host fans out to BOTH axes — the
vertical thumb was always painted (fine while scrolling is needed) and a full-width horizontal track
was always painted at the bottom edge even though no horizontal scroll ever occurs. Body text wrapped
flush against the scrollbar with zero gutter. The dialog body was also locked inside the plugin's
setup closure, unverifiable headlessly.

77. The `/goal` dialog body is a standalone presentational component `StatusDialogBody`
    (`src/status-dialog.tsx`): the state line, the wrapped condition/evaluator/reason rows, spend, and
    the history sections, plus a 3-cell internal right gutter (`paddingRight={3}` on the body column,
    `src/status-dialog.tsx`). `src/tui.tsx` keeps host orchestration only (host chrome, keymap, RPC, prompt-footer,
    toasts) and renders it inside the host's `ui.dialog.show` xlarge centered dialog — the Workstream
    A chrome (backdrop, Esc/ctrl+c dismissal, header convention, sizing) is unchanged.
78. The body scrollbox no longer forces both scrollbars visible. `scrollbarOptions={{ visible: true }}`
    was replaced by default auto-visibility on both axes (the host's `recalculateVisibility`: a bar
    paints only when content exceeds that axis) and explicit `scrollX={false}` (no horizontal
    scrolling is ever required — body content is wrapped by construction and nowrap rows are far
    shorter than the viewport). Consequences: the permanent full-width horizontal track at the dialog's
    bottom edge is gone, the vertical scrollbar appears only when the body overflows, and body text
    wraps with at least a 3-cell gutter before the bar.
79. Verification: `scripts/render-dialog.tsx` mounts the full dialog chrome (clamped column + header +
    scrollbox + body + hint) headlessly and prints the captured frame. Before the change it reproduced
    both defects (horizontal track across the bottom; text flush against the vertical scrollbar);
    after it, the track is gone, the vertical bar appears only on overflow (`--height=22`) and stays
    hidden when all content fits (default `--height=46`), and the body wraps short of the scrollbar
    column. `--buggy` reproduces the original configuration for side-by-side comparison.

Verification: `bun --preload @opentui/solid/preload scripts/render-dialog.tsx` (both default and
`--height=22` and `--buggy` frames eyeballed), `bun run check` green, coordinator submit + merge-next.

## Workstream Q — last-verdict now row, absolute ended timestamps

Interpretation of this iteration's condition: the rail said *how long ago* each iteration finished
but not *when*, and the running iteration's now row gave no hint of the evaluator's latest word on
the current iteration.

80. Each rail row appends an absolute local wall-clock time beside the relative suffix:
    `· ended <ago> at HH:MM` (local time, 24h, zero-padded; non-finite input yields `--:--`).
81. The looped now row appends the current iteration's last verdict: a bold colored glyph (same
    colorFor mapping as the rest of the dialog) after the elapsed segment, preceded by a faint
    `· last`, followed by `<N> turn(s) since` (0 → `this turn`). "Current iteration" = verdicts in
    `(last loopHistory endedAt | setAt, ∞)`; turns-since is `goal.turns − verdict.turn` clamped to ≥ 0
    (both are the per-iteration counters). Rendered only when the current iteration has ≥ 1 verdict;
    otherwise the now row is unchanged. The base text now wraps (`word`) instead of overflowing the
    rail's width, so the verdict suffix stays pinned after wrapping text.
82. New pure helpers `localTime`, `currentIterationVerdict`, `turnsSinceVerdict` in
    `src/core/history.ts`, unit-tested (`test/history.test.ts`).
83. `scripts/render-history.tsx` frames (looped, paused, complete) show `at HH:MM` on rail rows and
    the `· last <glyph> … since` segment on the now row; the paused and complete frames verify both.

Verification: `bun test` (new helper tests), `bun --preload @opentui/solid/preload scripts/render-history.tsx`
(frames show the HH:MM suffix and the last-verdict segment on all three loop frames), `bun run check`
green, coordinator submit + merge-next.

## Workstream R — iteration wall-time share, loop position in the dialog header

Interpretation of this iteration: the rail shows each iteration's duration but not where the wall
clock actually went, and the dialog header says `◎ /goal · loop` without showing which iteration is
live. Two glance-level additions from snapshot data; no RPC/schema/storage changes.

84. Each rail row appends a faint wall-time share after the ended suffix: `· NN% of wall`, where
    NN = round(iterationDuration / total completed iteration durations × 100). Sums to ~100 across
    rows (rounding drift is accepted); an iteration whose duration is 0 shares 0. Rendered only for
    loops with at least one completed iteration (shares are of completed wall time; the running
    iteration is excluded).
85. The dialog header shows the loop position when a loop is armed: `◎ /goal · loop · v<N>/<M>`
    (or `v<N>` when `loopMaxLoops` is unknown), replacing the bare `◎ /goal · loop`. Non-looped goals
    keep `◎ /goal`. Purely cosmetic; host chrome unchanged (Esc handling, sizing, header convention).
86. New pure helper `durationShares(durations): number[]` in `src/core/history.ts`, unit-tested
    (even/uneven splits, zero-sum input yields all zeros, single iteration yields 100).
87. `scripts/render-history.tsx` frames (looped, paused, complete) show `· NN% of wall` on rail rows;
    the frame width defaults to 112 (the dialog's realistic inner width; 96 clips the fullest rail
    row). The header position is presentational and verified by tsc + the load check (the dialog opens
    with the same chrome).

Verification: `bun test` (new helper tests), `bun --preload @opentui/solid/preload scripts/render-history.tsx`
(frames show the wall-share suffix), `bun run check` green, coordinator submit + merge-next.

## Workstream S — mouse-clickable `esc` in the dialog header

Interpretation of the request: the header's `esc` label painted itself as a close affordance but
ignored the mouse; pressing Esc works. The label is now a click target that closes the dialog through
the host's programmatic path.

88. The `/goal` dialog header's `esc` label is wrapped in a 1-cell-padded box with `onMouseUp`
    (the same click convention as the prompt-footer indicator) that calls `context.ui.dialog.clear()`
    — the host's "close the active dialog" primitive, which is the programmatic equivalent of the Esc
    key: modal mode ends, the backdrop drops, and the dialog's onClose runs. The plugin also resets
    its own dialog-open flag and scroll ref in the same handler, idempotently, so the scroll keymap
    layer disarms whether or not the host fires onClose for a programmatically cleared dialog.
    Keyboard Esc behavior is unchanged.
89. Verification: `bun run check` green; mouse behavior itself is host-owned and verified in a live
    TUI (TUI mouse reporting routes through the host to the opentui renderable tree).

Verification: `bun run check` green, coordinator submit + merge-next.

## Workstream T — self-governing context management (smart compactor)

Interpretation of the directive "context managements self govern system. there are time the /goal-loop is
paused. i don't like that no no pausing." for the context half: a loop that keeps running must also keep a
workable context without the user ever intervening. The plugin already had a threshold compactor; this
workstream adds boundary compaction so every loop iteration arms from a fresh context, and on restore of a
live goal after a restart.

90. `AutoCompactor.compactAtBoundary(sessionID)` compacts at a loop-iteration boundary regardless of the
    `compactAtTokens` threshold, so the next version arms with a fresh context. Same guards as
    `maybeCompact` (in-flight dedupe, 120s request cooldown, stale-inflight sweep extracted as a shared
    `sweepStale()`); contexts with an estimated size below `BOUNDARY_MIN_TOKENS` (10k tokens, estimate =
    last assistant `input + cache.read + cache.write`) are skipped with a log line; an undefined estimate
    (no assistant token usage) compacts with a "context size unknown" notice. The method is wired into the
    controller via the optional `ControllerDeps.compactAtBoundary` port (omitted by tests/probes) and called
    (a) in `loopAdvance` after the arm commit/notify/note and before the armed `continueWith` synthetic
    steer — compaction is queued BEFORE the armed iteration runs; awaiting only waits for the host's
    acceptance of the `session.compact` request, not the summary; and (b) in `restore()` for every adopted
    ACTIVE record, so a plugin restart also resumes from a fresh context. `opencode` itself auto-compacts
    near the model window by default; the per-boundary request is the window-independent complement and is
    accepted even when `compaction.auto` is false (requests run at the next safe point).
91. New option `compactOnLoopIteration` (default `true`, env `OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION`;
    `bool(options.compactOnLoopIteration, ...)`) gates the boundary path. `compactAtTokens` stays opt-in
    with no universal default (window sizes vary; the estimate is window-independent but the right absolute
    threshold is not universal). opencode's window-relative buffer remains the backstop for non-loop turns.
    Interpretation note: "always run with a clean fresh context" means compaction at every loop-iteration
    arm plus on restore of live goals; tiny contexts and non-loop turns are NOT force-compacted.

Files touched: `src/runtime/compactor.ts`, `src/runtime/controller.ts`, `src/index.ts`, `src/core/config.ts`.

Verification: `test/compactor.test.ts` gains a `describe("AutoCompactor.compactAtBoundary")` suite: gate off
→ context unread; small context → skipped, no notice; ≥10k → compact + "Auto-compact requested (loop
boundary)" notice; undefined estimate → compacts with the "context size unknown" message; two immediate
calls → one compaction (in-flight/cooldown honored). Existing maybeCompact tests unchanged and green.
`bun run check` green, coordinator submit.

## Workstream U — never-pause loop

Interpretation of the directive for the pause half: once the user activates a goal or loop, it must keep
running unless the API provider ends the token budget (a terminal error the user must fix) — or the user
explicitly opts into a cap, or explicitly clears. Every automatic pause path was removed or converted to a
bounded-backoff retry; `pause()` survives only for the interrupt and the explicit opt-in caps.

92. Exactly what still stops a goal/loop: (1) Esc (`onExecutionInterrupted` reason `user`) → `paused`
    (unchanged, plus the `inactivity` class routes through the failure path); (2) fatal provider errors
    (`classifyFailure` kind `fatal`: 401/402/403/404/413, insufficient quota/credit/billing, auth) →
    terminal `failed` — this is the "token budget from the api provider end" the user accepts; (3) explicit
    opt-in caps only: `maxTurns` (default changed 200 → 0) and `stallTurns` (default changed 3 → 0, min-clamp
    1 → 0; the stall guard now requires `config.stallTurns > 0`); the turn-cap freeze-on-resume rule still
    applies for explicit caps; (4) `/goal clear` or a replacement goal (terminal `cleared`). Nothing else
    pauses or ends a live goal automatically. Armed `/goal-loop` runs are exempt from the turn-cap and
    stall-guard stops — one notice each, the loop keeps running (see Workstream Z).
93. Failure handling: `handleFailure` — `fatal` → `finish failed` (unchanged); `pause`-class failures
    (429 rate/usage-limit, hook, unknown) → fixed `PAUSE_RETRY_MS` (15 min) retry forever; everything else
    (`transient`) → `RETRY_BASE_MS × 4^(n-1)` capped at `RETRY_MAX_MS` (5m), unlimited retries. The
    `checkinMinutes === 0` branch and the `maxRetries` cutoff are gone; the pause-on-retry-exhaustion is
    gone. `evaluationFailed` likewise retries forever (`REEVALUATE_BASE_MS × 3^(n-1)` cap, no pause).
    `checkinMinutes: 0` now only disables idle check-in nudges (the `defer()` path; unchanged). `maxRetries`
    is retained for compatibility and no longer gates anything. Retry notifications keep the "Goal still
    active" title; the retry description dropped the `/<maxRetries>` suffix.
94. Loop-advance paths that paused now never do: `notProgress >= 2` pause REMOVED (zero-tool iterations
    are recorded on `record.loopNotProgress`; the loop keeps arming — the boundary compaction of Workstream
    T refreshes its context); loop summary failure → the entry records `(summary failed: …)` and the loop
    advances anyway (summarize stage falls through to the planner with a placeholder when no summarizer
    exists, or a "(summary failed: …)" fallback string on error); both evaluators missing → `endClean`
    (terminal `achieved`, "Loop complete: this evaluator cannot summarize or plan the next iteration.");
    next-goal generator missing → `endClean` ("Loop complete: this evaluator cannot plan the next
    iteration."); next-goal generator error → whole loop step retried with exponential backoff
    (`runtime.loopRetries`, `RETRY_BASE_MS × 4^attempt`, cap `RETRY_MAX_MS`), unlimited, idempotent via
    epoch guard and `record.loopNotProgress` mutation only at arm time; a planner that repeats an
    already-completed condition → `endClean` ("Loop complete: the planner keeps offering the already-completed
    condition …; nothing new to plan."), never a re-arm and never a pause. `loopAdvance` resets
    `runtime.loopRetries = 0` on a successful arm. `continueWith` dispatch failure → the straggler flag is
    dropped, a "Goal still active" warning notifies, and the dispatch retries every `CONTINUE_RETRY_MS`
    (60s) forever; any user prompt/clear/dispose calls `invalidate(runtime)` which clears `runtime.timer`,
    cancelling the pending retry (noted in a comment at the call site).
95. `restore()` compacts adopted ACTIVE records at the boundary (Workstream T) and logs restores as before.
    The evaluator-stale guard, epoch guard, verify-gate fail-closed, commit rule, defer/background-work
    behavior and check-in cadence are all unchanged. The state-machine doc comment reflects the new shape
    (active → not_met → continue; met/impossible → terminal; user interrupt or explicit cap → paused;
    fatal provider error → failed).

Verification: `test/controller.test.ts` (transient failures retry with capped backoff forever; 401 fatal ≠
429 rate-limit — 429 stays active and retries after 15m; `checkinMinutes: 0` disables idle check-ins, not
retries; evaluator errors retry forever), `test/loop.test.ts` (zero-tool iterations keep the loop alive;
summary failure advances anyway; planner failure backs off and advances; planner repeat → clean achieved;
existing durable-arming/straggler/race suites unchanged and green), `bun run check` green, coordinator submit.

## Workstream V — smart compaction: never mid-work, and landing is detected and tracked

Interpretation of the follow-up requirement "the compaction trigger in mid work that is not good it trunckated
the works. it needs to be smart do not cut off in mid work system that is what the compaction needs" combined
with the armed condition's accepted-vs-completed gap: the plugin requests compaction but the host decides the
actual point, so the plugin must (a) never ask while work is in flight, and (b) observe whether an accepted
boundary request actually lands, record it, surface it, and re-request when it never lands.

96. Mid-work deferral (additive dep `CompactorDeps.isBusy?: (sessionID) => Promise<boolean>`, wired in
    `src/index.ts` as `work.subagents + work.shells > 0 || controller.isExecuting(sessionID)` where `isBusy`
    reads `background.busy()` (event-fed descendant-session + shell tracker) OR the controller's in-memory
    executing-turn set via the new public `GoalController.isExecuting()`). BOTH compaction paths consult the
    gate and defer with only a log line when busy: `maybeCompact` (the window-independent auto threshold) and
    `compactAtBoundary` (the loop-boundary path of Workstream T). The busy check fails closed — an erroring
    probe defers the compaction. The `force` option introduced for boundary re-requests skips ONLY the 120s
    request cooldown; the in-flight and busy gates hold even under `force`, so a forced re-request can never
    cut off in-flight work. Plugin-side estimates and `session.compact` are the only levers the host gives
    us; the gate makes the request safe by construction.
97. Accepted-vs-completed tracking (`LoopCompactState` on `GoalRecord.loopCompact`, additive, round-trips
    through plugin storage): `{ requestedAt, estimatedTokens?, iteration, landedAt?, misses }`. Recorded
    (a) in `loopAdvance` after the arm commit — a returned boundary-compact result with `requested: true`
    overwrites the record with a fresh pending state (iteration = the newly armed iteration, `misses` carried
    forward until an actual landing is observed, never reset by a mere re-request); (b) in `restore()` for
    adopted ACTIVE records that the boundary compaction was re-requested for. Landing detection (i) — the
    `session.compaction.ended` event settles the pending state via the controller's public
    `onCompactionLanded()` — is evidence-based: it marks `landedAt` only on an observed context-size drop
    (same threshold as (ii)); an unestimable or no-op compaction counts as a miss toward the 2-miss
    re-request and queues no re-anchor (Workstream AA). Landing detection (ii) runs at the next arm before a
    new request is issued — a context-size drop at the next arm — via the new optional
    `ControllerDeps.estimateContext` port (`ctx.session.context` + `estimateContextTokens`, estimate
    unavailable → treated as not-landed) — marks landing when `size <= max(10_000, floor(estimatedTokens
    × 0.6))` (unknown baseline estimate: `size < 10_000`). An unlanded pending request accumulates `misses`
    per armed iteration; at `misses >= 2` the next arm passes `{ force: true }` (cooldown bypassed; in-flight
    and busy still enforced) and emits a "Compaction pending" warning notice — the re-request the armed
    condition asks for. A busy deferral counts as a miss but can never bypass the busy gate; `loopCompact`
    and all its writes are lost-write-safe under the existing epoch guards (a superseded settle step drops
    its write).
98. Surfacing: `formatStatus` prints one line under the `Loop:` line — `Loop compact: landed <ago>` or
    `Loop compact: pending <dur> (miss m/2)` — only when `record.loopCompact` exists; the TUI `prompt.footer`
    loop label appends ` · compact pending` while a request is pending; landed/re-request notices carry kind
    `compact`. `/goal` dialog shows the same via the existing `statusBody` (driven by `formatStatus`); no new
    dialog chrome was added.

Files touched: `src/core/types.ts`, `src/core/format.ts`, `src/runtime/compactor.ts`,
`src/runtime/controller.ts`, `src/runtime/events.ts`, `src/index.ts`, `src/tui.tsx`, `test/compactor.test.ts`,
`test/loop.test.ts`, `SPEC.md`, `README.md`, `docs/`.

Verification: `test/compactor.test.ts` (result-object API for `compactAtBoundary`; busy deferral for both
paths; `force` bypassing cooldown only — busy and in-flight hold; failing `isBusy` probe fails closed), `test/loop.test.ts`
(pending state recorded at arm; `onCompactionLanded` marks landed on an observed drop with a success notice; context-size drop
detected at the next arm; two unlanded armed iterations force the third re-request with `opts.force`;
busy denial counts a miss, persists it, and stays a busy denial even under force), `bun run check` green
(320 tests), coordinator submit.
## Workstream W — post-compaction loop re-anchor

Interpretation of the armed condition's need for a loop that survives the host's compaction intact: a landed
compaction (plugin-requested at a boundary, or the host's own window-relative auto-compaction) replaces the
conversation with a lossy summary, so the armed directive, the constant objective and the completed-iteration
history — everything the plugin alone knows — were invisible to the model after the cut. The plugin cannot stop
the host compacting, but it can restore the ground truth on the next one.

99. Prompt builder `loopReanchor` (`src/core/prompts.ts`, additive): emits
    `<goal-loop-reanchor iteration="N" max="M">` carrying the constant objective, the armed condition, the
    completed-iteration history (via the shared `historyBlock`), the shared `TREE_TRUTH` re-read mandate
    (extracted from `loopContinuation` into one byte-identical constant used by both), and an explicit "do not
    wait for a user message — the loop continues automatically" line. History injection keeps the same -10
    slice as the other loop prompts.
100. Controller `onCompactionLanded()` (public, `session.compaction.ended` path): settles any pending
     boundary-compact request as before — evidence-based since Workstream AA: a landing is recorded only on an
     observed context-size drop, otherwise the event counts as a miss — then, on a landing or with no pending
     request, when the record is a LIVE ACTIVE loop (`loopEnabled` and
     `status === "active"`) — queues the re-anchor via `session.synthetic` with `delivery: "queue"` and
     `resume: false`. Queued, never a steer: it cannot wake an idle session behind the loop's back and cannot
     interleave into a turn in flight; the next arm/continuation steer the loop already dispatches carries it
     into the model's view after the summary. Fire-and-forget with a warn on failure — a host rejection never
     breaks the landing bookkeeping (same posture as `note()`). Paused and terminal loops are not re-anchored;
     plain (non-loop) goals are not re-anchored (the `systemReminder` hook already re-states their condition
     every model call).
101. Surfacing: none beyond the synthetic message itself — no record field, no notice kind, no dialog chrome.
     The re-anchor is a transcript artifact (`metadata: { source: "goal", goal: record.id, anchor: true }`,
     description `goal-loop · re-anchor after compaction`).

Files touched: `src/core/prompts.ts`, `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`, `README.md`, `docs/`.

Verification: `test/loop.test.ts` (re-anchor queued on landing with armed iteration/condition/objective/history;
queued with NO pending boundary request — host-side compaction; not queued for a plain goal, a terminal loop, or a
paused loop; a throwing synthetic dispatch does not break `onCompactionLanded`; prompt-builder content and history
format), `bun run check` green (327 tests), coordinator submit.

## Workstream X — the boundary-compact state on every goal surface

Iteration 4 continued iteration 2's accepted-vs-completed tracking: that work detected and recorded the
landing, re-requested at 2 misses, and put `Loop compact:` lines into `formatStatus` — but the two surfaces
the user actually looks at render from the live snapshot. The prompt footer showed only a bare
`compact pending` (no miss count), and the `/goal` detail dialog (`LoopSection`) rendered no compaction
state at all, so an armed-but-unlanded request was invisible exactly where the loop is most visible.

102. LoopSection compact row (`src/tui-history.tsx`, additive): when `goal.loopCompact` is present, the
    `/goal` detail dialog renders a `compact` row directly under the objective — pending renders
    warning-colored `pending <age> · miss N/2 · ~<estimate> at request`; landed renders info-colored
    `landed <age> ago`. Absent entirely on records with no boundary-compact request (back-compat with
    pre-loop records and loops armed before the feature). Verified headlessly via a throwaway
    `@opentui/solid` test-renderer harness in all four states (pending miss 0, pending miss 2, landed,
    absent) — the row is present in the first three with the documented copy and absent in the fourth.
103. Prompt footer (`src/tui.tsx`): the loop footer marker carries the miss count while a boundary compact
    is pending — `· compact pending (N/2)` — matching the `formatStatus` phrasing; still omitted entirely
    once landed. `formatStatus` (the `/goal` fallback text) is unchanged in content.
104. `formatStatus` under test (`test/core.test.ts`): plain goals render no compact line; a pending
    request renders its age and `(miss N/2)` including the 2/2 re-request threshold; a landed request
    renders `landed … ago` and no miss annotation; a loop without a request omits the line.

Files touched: `src/tui-history.tsx`, `src/tui.tsx`, `test/core.test.ts`, `SPEC.md`, `README.md`, `docs/`.

Verification: `test/core.test.ts` (5 new `formatStatus` tests, including both miss counts and the landed
shape); headless render of the `LoopSection` compact row; `bun run check` green (332 tests); coordinator
submit.

## Workstream Y — boundary compactions stop stacking

Iteration 4 surfaced the accepted-vs-completed gap; it did not fix request frequency. Every arm issued a
fresh boundary request (subject only to the 2-minute cooldown), so arms stacked compactions, the host kept
answering "Nothing to compact yet", and every `session.compaction.ended` queued another
`goal-loop · re-anchor after compaction` — three re-anchor notes were visible on screen at once. This
workstream makes the boundary path conservative: request rarely, re-anchor once.

105. No fresh boundary request on an arm that just observed a landing: when the arm-time settle records a
    landed boundary compact (context-size drop, ≤ 60% of the requested estimate), the arm makes no request
    of the host — the context is already fresh.
106. No fresh boundary request on an arm whose pending request has not reached 2 misses: an unlanded
    boundary compact is re-issued only by the forced re-request at `misses >= 2` (past the cooldown, never
    past the busy/in-flight gates). At one miss the settle only counts; the arm stays silent (log line).
107. Re-anchor coalescing: `onCompactionLanded` queues the `<goal-loop-reanchor>` note at most once per
    session per 2 minutes (`REANCHOR_MIN_INTERVAL_MS`); back-to-back landings (host auto-compact + boundary
    request + restore) produce one re-anchor instead of a stack. In-flight timestamp is per session and
    cleared on `session.deleted`.
108. `restore()` does not stack a boundary request on top of state that makes one pointless: an unlanded
    pending `loopCompact` is left to the arm-time settle (forced at 2 misses), and a request that landed
    within the last 10 minutes is not re-requested on plugin reload.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`, `README.md`, `docs/`.

Verification: `test/loop.test.ts` (arm that just landed makes no fresh request; one miss makes no
re-request; two landings within 2 minutes queue one re-anchor and a third after 2 minutes queues a second;
restore with an unlanded pending request makes no request; restore right after a landing makes no request);
`bun run check` green (336 tests); coordinator submit.

## Workstream Z — an armed loop never pauses at the turn cap or stall guard

Interpretation of the armed condition's pause gap: Workstream U removed every automatic pause except the
explicit opt-in caps (`maxTurns` / `stallTurns`) — but an armed `/goal-loop` runs past those too, since the
"token budget from the api provider" is the only accepted stop. The explicit caps keep their plain-goal
semantics; an armed loop now gets a one-time notice and keeps running.

109. One-shot notice flags on the volatile `Runtime` state (`src/runtime/controller.ts`, additive,
    never persisted, anti-stacking): `runtime.capNotified` and `runtime.stallNotified`. Each fires at most
    once per session per kind, never re-fired within the session.
110. Armed-loop fall-through: in `evaluate()`, the turn-cap branch now pauses only when `!record.loopEnabled`;
    when a loop is armed and the cap is passed and `runtime.capNotified` is unset, it sets the flag and emits
    a single `loop`-kind warning notice ("Turn cap passed — loop keeps running") and falls through to the
    existing commit + `continueWith(...)` path. Same shape for the stall guard ("No progress — loop keeps
    running"). Non-loop goals pause exactly as before (byte-compatible); `loopNotProgress` untouched.
111. `onUserPrompt()` cap-freeze restricted to plain goals: the "message does not extend the cap" freeze now
    applies only when `!record.loopEnabled`; an armed `/goal-loop` resumes on a message even past the cap.
    `pause()` itself, the interrupt path, the TUI/dialog pause rendering and the `atCap` wording are unchanged.
112. Tests (`test/loop.test.ts`): the `a paused loop is not re-anchored` test now pauses via a manual user
    interrupt instead of the cap; three new tests — an armed loop never pauses at the turn cap (one "Turn cap"
    notice, stays active, keeps arming), never pauses at the stall guard (one "No progress" notice, stays
    active), and a message resumes an armed loop even past the cap. Plain-goal cap/stall tests in
    `test/controller.test.ts` are unchanged and green.
113. Stale acceptance-criteria intro corrected: the turn cap and stall guard are documented as opt-in
    (default 0 = off) plain-goal stops; an armed `/goal-loop` never pauses at either.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`, `README.md`, `AGENTS.md`, `docs/`.

Verification: `test/loop.test.ts` (the three new tests; the rewritten paused-loop test), `bun test`
(339 tests), `bun run check` green; coordinator submit.

## Workstream AA — evidence-based compaction landing

Interpretation of the armed condition's accepted-vs-completed remainder: Workstream V detected a landing two
ways, but the `session.compaction.ended` path recorded one unconditionally — the host can complete a
compaction that removes nothing ("Nothing to compact yet"), and the plugin counted that as a landing, so the
loop re-armed on false evidence. Landing is now recorded only when the estimated context actually drops.

114. Shared drop heuristic `contextDropped(pending, size)` (private, `src/runtime/controller.ts`): `size < 10_000`
    when the request carried no estimate, else `size <= max(10_000, floor(estimatedTokens × 0.6))` — the same
    threshold the arm-time settle has always used. An unknown/unestimable/unchanged size is not a drop.
115. `onCompactionLanded()` (`session.compaction.ended`) is evidence-based: it estimates the context first
    (optional `ControllerDeps.estimateContext` shared with the arm settle, errors → unknown), re-checks the
    session identity after the await (a cleared/replaced record drops the result), and only then records
    `landedAt` + the success notice + the re-anchor. A no-op compaction (no estimate, estimation error, or no
    drop) instead persists `misses + 1` on the pending request, emits the "Compaction pending" warning only
    when `misses` reaches 2 (same crossing as the arm path), marks nothing landed and queues NO re-anchor — a
    no-op does not replace history. Plain goals and the no-pending-request path (host compacted on its own)
    are unchanged. The arm-time settle uses the same shared helper; its behavior is unchanged.
116. A no-op compaction therefore counts as a miss toward the 2-miss re-request exactly like an unlanded
    armed iteration: after two no-op ended-events, the next arm passes `{ force: true }` to the host.
117. Tests (`test/loop.test.ts`, 4 new): a no-op compaction counts as a miss (no landing, no success notice,
    no re-anchor; second event brings misses to 2 with the warning); an evidence-based landing records +
    re-anchors; two no-op ended-events push misses to 2 and the next arm force re-requests
    (`compactCalls[1]` = `{ force: true }`); an unestimable context counts as a miss. Existing landing tests
    were updated to set `setContextSize(90_000)` before expecting a landing.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`, `README.md`, `docs/runtime.html`.

Verification: `test/loop.test.ts` (the 4 new tests; updated landing tests), `bun test` (343 tests),
`bun run check` green; coordinator submit.

## Workstream AB — forced boundary re-requests are suspended at 4 misses

Interpretation of the armed condition's need to stop hammering an endless boundary request: Workstreams V/AA
count misses and force a re-request at 2, but an arm at misses 4, 5, 6… kept asking the host forever (and
emitting "Compaction pending" every armed iteration) for a context the host refuses to shrink. Consecutive
unlanded misses are now capped: at 4 the plugin stops requesting until a landing is observed, with one final
warning instead of one per armed iteration. The armed loop keeps running throughout.

118. Cap constants: `COMPACT_MISS_CAP = 4` lives in `src/core/types.ts` (exported so the core status line and
    the TUI detail dialog print `miss n/4` instead of a stale `/2`); `COMPACT_MISS_RETRY = 2` stays private to
    `src/runtime/controller.ts`. Plain goals never reach either path.
119. Arm-time settle: a miss incurs `force = misses >= 2 && misses < 4` (forced re-request, unchanged at 2 and
    3 misses) and `capped = misses >= 4`. At the cap the arm makes NO host request at all — not even forced;
    the request is skipped with `skipRequest = "capped"` and the new `BoundaryCompactMiss` member `"capped"`
    (`{ requested: false, reason: "capped" }`, `src/runtime/compactor.ts`). Exactly one final
    `"Compaction not landing"` warning is emitted at the crossing (misses === 4); misses >= 5 are fully silent.
    Exactly like a busy deferral, a capped arm never counts as landing and never pauses the loop.
120. `onCompactionLanded()` mirrors the same tiering on the ended-event path: pending-warning for 2-3 misses,
    one final "Compaction not landing" warning at 4, silence above that. Failed compactions remain unwired.
    Landing detection is unchanged: an observed drop (ended event or next arm) records the landing and implicitly
    lifts the suspension — the next arm after a landing arms a fresh request with `misses` reset to 0 (pending
    is absent/landed, not blocked). Restore() still refuses to stack a request on an outstanding pending one.
121. Tests (`test/loop.test.ts`, 3 new; maxLoops bumped via `harness({ maxLoops: 50 })` so the loop out-lives
    the default 5-iteration cap): forced re-requests stop at the 4-miss cap (no request at 4 and 5, exactly
    one final warning, two pending warnings, session stays active); ended-event misses respect the cap with a
    single final warning and silence after; a landing lifts the suspension (a fresh request goes out at the
    next arm with misses back at 0). `test/core.test.ts` expectations updated `/2 → /4`.

Files touched: `src/core/types.ts`, `src/core/format.ts`, `src/runtime/compactor.ts`,
`src/runtime/controller.ts`, `src/tui-history.tsx`, `test/core.test.ts`, `test/loop.test.ts`, `SPEC.md`,
`README.md`, `docs/runtime.html`.

Verification: `test/loop.test.ts` + `test/core.test.ts`, `bun test` (346 tests), `bun run check` green;
coordinator submit.

## Appendix A — Phase 1 audit findings (read-only sweep)

Every `src/**/*.ts*` and `test/*.ts` was read for this appendix. Findings are `{ severity, file:line, problem, proposed_fix }`,
ranked correctness > reliability > TUI > organization. Each entry carries an ID (`A-<n>`) used to track resolution or waiver in later
workstream sections; nothing below is silently dropped. `[waived: <reason>]` marks findings intentionally left as-is; every other
finding names the workstream that resolves it. Line numbers refer to the tree at the Phase 1 commit.

### A. Correctness

- **A-1 (high) — `src/runtime/controller.ts:197` & `:881` — compaction misses are double-counted.** A no-op compaction reported via
  `session.compaction.ended` increments `loopCompact.misses` (the ended-event path), and the next armed iteration's settle increments the
  same pending request again (the arm path), so one physical unlanded compaction consumes two of the four misses and forces the re-request
  and the "Compaction pending" notice an iteration early. Proposed fix: single-source miss accounting — the arm-time settle must not count a
  pending request whose ended-event path already counted it (mark the pending with the count time/flag), or drop the ended-event increment
  and let arms count alone. Decide in the fix workstream and pin with a test: one no-op ended event + one arm = misses exactly 1.
  Resolution: Workstream AC — single-source accounting via the `missesCountedAtEvent` one-shot flag; pin test added (fails pre-fix, passes post-fix).
- **A-2 (medium) — `src/runtime/controller.ts:816` — planner-armed conditions bypass the configured length limit.**
  `Prompt.parseNextCondition(reply)` is called with the library default (2000 chars) while user-set conditions respect
  `config.maxConditionChars`. A `maxConditionChars: 100` configuration still arms 2000-char planner conditions.
  Proposed fix: pass `config.maxConditionChars` (clamped to the parser's accepted range) as `maxChars`.
  Resolution: Workstream AF — configured limit passed through; behavior note recorded there.
- **A-3 (medium) — `src/rpc-handlers.ts:49` — the read-only `list` RPC fans out host side effects.** When the in-memory list is empty,
  `list()` calls `controller.restore()`, which adopts records AND queues a boundary-compaction request at the host for every active goal.
  A client asking "what goals exist" can ask the host to compact sessions it does not even render.
  Proposed fix: split restore into adopt (pure) vs adopt+boundary-fan-out; the RPC read path adopts without requesting compaction.
  Resolution: Workstream AG — `restore({ boundaryCompact: false })`; RPC list is adopt-only.
- **A-4 (medium) — `src/runtime/controller.ts:500-510` — `restore()` requests a boundary compaction for plain (non-loop) goals.**
  The `loopEnabled` check is absent: any active record, including a plain `/goal`, gets a boundary compaction after a restart. This
  contradicts the documented discipline that plain goals never reach the boundary-compaction path (see `COMPACT_MISS_CAP` comment in
  `src/core/types.ts`). Proposed fix: restrict the restore-time fan-out to `record.loopEnabled` records (or document plain-goal compaction at restore if intended); pin with a test.
  Resolution: Workstream AJ — fan-out restricted to armed loops; plain goals never compact at restore.
- **A-5 (medium) — `src/runtime/controller.ts:797-803` — the repeat-condition guard is punctuation-sensitive.** The loop's
  `completed` normalization strips whitespace and lowercases, but does not strip punctuation, so a planner offering
  `"Fix the flaky test."` after `"fix the flaky test"` was completed arms the same work again — the exact failure mode the guard exists
  to stop ("keeps offering the already-completed condition" never fires on near-identical strings). Proposed fix: normalize more
  aggressively (collapse all non-alphanumeric runs to one space, trim) before the `completed` comparison; pin with a test.
  Resolution: Workstream AH — non-alphanumeric runs collapse to one space (unicode aware); punctuation-drifted repeats rejected.
- **A-6 (low) — `src/core/format.ts:24-28` — `formatTokens` rolls over badly at the million boundary.** `999_999` renders as `"1000k"`
  (the `< 1_000_000` branch never falls through to the `M` format). Proposed fix: round-then-compare or special-case values whose
  rounded form exceeds the unit, e.g. compare `n >= 999_500` for the `k` branch. Cosmetic, one-line fix + test.
  Resolution: Workstream AE — round-then-compare; pin test added (fails pre-fix, passes post-fix).
- **A-7 (low) — `src/runtime/controller.ts:296-299` — tool calls zeroed before the stale check.** `onExecutionSucceeded` clears
  `runtime.toolCalls = 0` before the `background.busy` await; when the record went stale meanwhile the counts are silently lost rather
  than carried. Benign (the evaluation is dropped anyway) — waived: no observable behavior beyond a dropped, superseded turn.

### B. Reliability

- **A-8 (medium) — `src/runtime/controller.ts:253` — `set()` does not await the initial `commit(record)`.** A crash immediately after
  `/goal` returns can lose the just-set record even though `set()` is async and `commit()` returns a promise. Same pattern in
  `onUserPrompt`, `evaluationFailed`, `handleFailure` (intentional fire-and-forget there, results superseded by the next commit) — but the
  set path is the one place a lost write silently un-sets the goal. Proposed fix: `await this.commit(record)` in `set()`.
  Resolution: Workstream AI — set() awaits the initial commit; pin test added.
- **A-9 (medium) — `src/runtime/store.ts:63-66`, `src/runtime/controller.ts:1058-1066` — `finish()` re-saves the record via
  `store.save` directly, bypassing `commit()`'s no-op cache.** The final spend snapshot is written with the pre-`final` serialized string
  still in `lastCommit`; correctness survives (the next identical `commit()` re-saves), but the cache invariant "lastCommit mirrors the
  durable state" is broken. Proposed fix: route the final save through `commit()` (set `record.final` then `await this.commit(record)`).
  Resolution: Workstream AK — snapshot re-save routes through commit; no-op cache invariant restored.
- **A-10 (low) — `src/runtime/controller.ts:1055-1066` — final spend snapshot is fire-and-forget with no retry.** If the snapshot save
  fails it is only logged; the record on disk lacks `final` and `/goal` history loses spend. Acceptable: the error is logged and the
  snapshot is best-effort — waived with reason (spend snapshot is informational, not load-bearing for loop correctness).
- **A-11 (low) — `src/tui.tsx` — `entries()` map is never pruned.** Sessions that go terminal (or are deleted) stay in the map for the
  life of the TUI process; the 15s tick only exempts non-active goals from re-rendering, so memory still grows. Proposed fix: drop
  entries whose goal is null and not referenced by an open dialog, or cap the map.
  Resolution: Workstream AS — `src/core/entries.ts`; inline prune in `put`; open-dialog session is always kept; live goals never evicted.
- **A-12 (low) — `src/runtime/controller.ts` — `loopHistory` grows without bound.** Every iteration appends a `LoopEntry` (condition +
  summary, ~1–2 KB) and every `commit()` `structuredClone`s the whole record, making persistence O(n²) in loop lifetime. Proposed fix:
  no functional change required for correctness, but note; waive formal trimming unless a measured problem appears (history is user-visible
  and drives TUI rendering).
- **A-13 (low) — `src/core/types.ts:135` — stale comment: "Consecutive iterations with zero tool calls; two pause the loop."** Armed
  loops never pause (recorded, never a pause, one notice). Stale comment contradicts the never-pause policy and `loop.test.ts`.
  Proposed fix: rewrite the comment.
  Resolution: Workstream AN — comment rewritten to match the never-pause policy.
- **A-14 (low) — `src/runtime/events.ts:17` — `type Data = Record<string, any>`.** An `any` leak across the event boundary; malformed
  payloads are only destructured defensively at read sites. Proposed fix: `Record<string, unknown>` + a tiny guard helper (or keep `any`
  contained to this file and document).
  Resolution: Workstream AO — `Record<string, unknown>` + `asRecord` guard; closure-narrowing gap fixed.

### C. Event routing / async

- **A-15 (low) — `src/runtime/events.ts:60-63` — inconsistent safety discipline.** `session.execution.succeeded` wraps
  `background.executionEnded` in `safe()` but relies on `.catch(fail)` for the async controllers; `session.compaction.ended` likewise.
  Ordering is correct (noteCompactionEnded before onCompactionLanded) and every async arm has a `.catch`, so no unhandled rejection — but
  the style split invites drift. Proposed fix: one `guard`/`awaitSafe` helper used uniformly; keep `.catch(fail)` and drop `safe()` or vice versa.
  Resolution: Workstream AP — single `guard`; `safe()` removed; drift pin added.
- **A-16 (low) — `src/index.ts` — events emitted during the reconnect gap are lost.** A dropped stream is re-established with backoff but
  events between drop and reconnect are never replayed, so a missed `execution.succeeded` silently parks the goal (no evaluation runs)
  until the next event for that session. Proposed fix: document the limitation (best possible without host replay support); waive code change.
- **A-17 (low) — `src/core/git.ts:findRepository` — walks to filesystem root on every policy resolution.** Bounded and cached by the OS
  per process, fine at plugin setup; waived for cost (one call per session).

### D. Math / formatting

- **A-18 (low) — `src/core/context-size.ts` — estimate is `input + cache.read + cache.write`.** Correct for Anthropic-style accounting
  (input excludes cache reads); under-counts providers whose `input` already includes cache reads. Documented in the file header; waive:
  no provider-agnostic way to disambiguate, and the compaction thresholds are heuristic anyway.
- **A-19 (low) — `src/core/history.ts:paceEstimate` — pace is the mean of completed iterations only.** A slow first iteration inflates the
  estimate for the rest; documented behavior. Waive with reason (estimate, not gate).
- **A-20 (low) — `src/core/history.ts:durationShares` — percentages may sum to ≠100.** Documented ("may sum to ~100"); waive with reason.
- **A-21 (low) — backoff curve drift: `evaluationFailed` uses `x3`, `handleFailure`/`loopAdvance` retry use `x4`.** Two different
  exponential bases in one file with no stated rationale. Proposed fix: one shared backoff helper (`RETRY_BASE_MS * base ** n`, capped), or a
  comment stating the intentional difference.
  Resolution: Workstream AM — shared `backoffMs` helper; the two curves documented; byte-compatible.
- **A-22 (low) — `src/core/format.ts` / `src/tui.tsx` — `1000k` rollover** (same as A-6; listed once here, fixed once).
  Resolution: Workstream AE — the A-6 fix.
- **A-23 (low) — `src/core/history.ts:renderPips` — pips render only for caps 1–8** and vanish for larger caps; intentional compactness,
  documented. Waive with reason.

### E. State machine / TUI / organization

- **A-24 (low) — `src/runtime/controller.ts` `onUserPrompt` — the cap-paused warning fires on every user message.** While a plain goal is
  paused at the turn cap, each prompt re-notifies "Goal paused at turn cap" — the one-courtesy-notice-per-event-kind discipline is not kept.
  Proposed fix: one-shot flag (runtime boolean) so the notice fires once per pause.
  Resolution: Workstream AL — `capFreezeNotified` runtime flag; one warning per freeze.
- **A-25 (low) — `src/status-dialog.tsx` & `src/tui-history.tsx` — `const LABEL = 10` duplicated.** Hoist into `src/core/history.ts` (pure,
  importable) or a shared `LABEL` export.
  Resolution: Workstream AD — hoisted as `LABEL` in `src/core/history.ts`, imported by both.
- **A-26 (low) — `src/runtime/controller.ts:508-510`, `src/runtime/compactor.ts`, `src/core/types.ts` — magic numbers duplicated across
  files:** `10_000` (boundary floor, inline twice in `contextDropped`, and `BOUNDARY_MIN_TOKENS` in compactor), the `0.6` drop factor,
  `120_000` (`REANCHOR_MIN_INTERVAL_MS` vs `REQUEST_COOLDOWN_MS`), `10 * 60_000` (the restore-time landed cooldown). Proposed fix: a small
  `src/core/constants.ts` (or exports from `types.ts`) shared by controller and compactor.
  Resolution: Workstream AQ — `src/core/constants.ts`; zero magic-number duplication left.
- **A-27 (low) — `src/core/config.ts` — `maxRetries` is dead surface.** Retained "for compatibility", gates nothing, advertised in config
  docs. Proposed fix: keep the key parsing (backward compat) but flag in docs as inert, or remove with a SPEC/docs note; never silently drop.
  Resolution: Workstream AR — parsing retained, docs flag inert on all surfaces; superseded mentions noted as design history.
- **A-28 (low) — `src/tui.tsx:goalsEqual` — JSON.stringify comparison of the whole snapshot on every `put`.** O(record size); fine at 20
  verdicts, quadratic in loop lifetime as history grows. Waive (folds into A-12 if history is ever capped).
- **A-29 (low) — `src/core/prompts.ts:isFuzzyCondition` — arbitrary keyword list ("rabbit", "look like").** Heuristic by design; waive with
  reason, but the list should move behind a named constant if it ever grows.
- **A-30 (low) — `src/runtime/events.ts:RecentIds` — eviction deletes oldest inserted; correct.** Not a bug; noted so the audit shows it was
  checked. Waive.

### Fix order (correctness → reliability → TUI → organization)

1. A-1 (miss double-count) → 2. A-25 (labels, trivial) → 3. A-6/A-22 (formatTokens rollover) → 4. A-2 (planner maxChars) →
5. A-3 (RPC list side effect) → 6. A-5 (normalize punctuation) → 7. A-8 (set() await) → 8. A-4 (restore plain-goal compact) →
9. A-9 (finish() via commit()) → 10. A-24 (cap-paused one-shot) → 11. A-21 (backoff helper) → 12. remaining low/org items as separate
workstreams, each landing with `bun run check` green.

### Waivers (explicit, one line each)

A-7 (counts dropped with the superseded turn; no behavior), A-10 (spend snapshot best-effort), A-16 (no host replay support), A-17 (bounded
one-shot walk), A-18 (provider accounting is ambiguous), A-19 (documented heuristic), A-20 (documented rounding), A-23 (compact footer by design),
A-28 (folds into A-12), A-29 (heuristic by design), A-30 (verified correct), A-12 (user-visible history; no measured problem).

### Restore-vs-arm lease grid (Phase 1 item 2)

`restore()` fans out a boundary compaction for every active record (A-4), and the armed loop's settle re-checks the same pending marker at
every arm — the two never stack because `loopCompact.landedAt`/`misses` persist on the record; restore skips a pending request and a landing
newer than 10 minutes. The double-count (A-1) is the one real defect in this grid. `adoptRestored` is re-entrant-safe (`goals.has` short-circuit);
the RPC `restoreOne` path shares it. A concurrent `adoptRestored` pair can both pass the `has` check and both commit the same record — benign
(idempotent writes, same values) — noted, not fixed.

### Epoch staleness sweep (Phase 1 item 2)

Checked on every await in `controller.ts`: `onCompactionLanded` re-reads `this.goals.get(sessionID) !== record` after the estimate await;
`evaluate` re-checks after `session.usage` and after the evaluator/verify awaits; `loopAdvance` re-checks after the summarize, planner and
boundary-compact awaits; `checkin` re-checks after the busy await; `verifyMet` relies on the trailing `stale()` in `evaluate`. No await lacks a
post-await staleness gate. The one soft spot is `reanchor()` (synchronous, reads the record without a guard) — safe only because every call site
is already post-gate; noted for the Phase 3 sweep.

## Workstream AC — compaction misses are counted once (A-1)

Fix for the double-count found in the Phase 1 audit: a no-op compaction reported via
`session.compaction.ended` incremented `loopCompact.misses` on the ended-event path, and the next arm-time
settle counted the same pending request again, so one physical unlanded compaction consumed two of the four
misses and forced the re-request and the "Compaction pending" notice an iteration early.

122. Single-source accounting with a one-shot flag. `LoopCompactState` gains `missesCountedAtEvent?: boolean`
    (`src/core/types.ts`). `onCompactionLanded()` sets the flag when its ended-event path counts a miss. The
    arm-time settle consumes the flag exactly once: it re-uses the already-counted `misses` for the
    force/cap decision (`force = misses >= 2 && misses < 4`, `capped = misses >= 4`) without incrementing and
    without re-emitting the notice the ended-event path already sent for that count; it clears the flag so a
    still-unlanded request counts normally at the following arm. A landing observed at the arm takes precedence
    over the flag (an observed drop records `landedAt`, as before). Notices are never doubled: whichever path
    counts the miss emits its notice; the other path stays silent about that observation.
123. Pin test (`test/loop.test.ts`, 1 new): one no-op ended event plus one arm yields `misses === 1` and no
    compact request; the following still-unlanded arm counts `misses === 2` and force re-requests. The pin test
    fails on the pre-fix tree (verified by stashing the fix and re-running it) and passes with it. All pre-fix
    tests pass unchanged, including the ended-event cap test and the "no-op landing pushes the miss count to 2"
    re-request test, which exercise the notice path and the re-request decision on event-counted misses.

Files touched: `src/core/types.ts`, `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`.

Verification: `test/loop.test.ts` 78 pass; `bun test` 347 tests; pre-fix failure of the pin test verified;
`bun run check` green; coordinator submit.

## Workstream AD — one LABEL constant for the goal surfaces (A-25)

`const LABEL = 10` (label column width in the detail dialog rows and the history rail) was declared
independently in `src/status-dialog.tsx` and `src/tui-history.tsx`. Hoisted to `src/core/history.ts` as an
export (`LABEL`, documented), imported by both components. Pure refactor; no visual change. Test count
unchanged (347). `dist/tui.js` rebuilt (50952 bytes) and committed in this workstream per policy.

Files touched: `src/core/history.ts`, `src/status-dialog.tsx`, `src/tui-history.tsx`, `dist/tui.js`, `SPEC.md`.

Verification: `bun run check` green (347 tests, spec-check ok); coordinator submit.

## Workstream AE — formatTokens rounds at the unit boundary (A-6, A-22)

`formatTokens(999_999)` rendered as `"1000k"` because the k-branch never fell through to the M format. The fix
round-then-compares: the k-form is computed first, and a value whose rounded k-form reaches `1000k` falls
through to the M format (`999_499` → `"999k"`, `999_500` and `999_999` → `"1.00M"`). One fix resolves both
audit IDs; A-22 is the same defect listed once under TUI.

124. Pin test (`test/core.test.ts`): three boundary expectations added to the existing format test (test count unchanged); verified to fail on the pre-fix
    tree and pass with it. No other call sites changed.

Files touched: `src/core/format.ts`, `test/core.test.ts`, `SPEC.md`.

Verification: `bun run check` green (347 tests, spec-check ok); coordinator submit.

## Workstream AF — planner-armed conditions respect maxConditionChars (A-2)

`Prompt.parseNextCondition(reply)` was called with the library default (2000), so a planner-armed condition
bypassed `config.maxConditionChars` — a `maxConditionChars: 100` configuration still armed 2000-char conditions.
The arm path now passes the configured limit (clamped to `Math.max(1, floor(...))`).

125. Behavior note: with default config (`maxConditionChars` unlimited by documentation), planner-armed
     conditions are now unbounded in length rather than capped at the hidden library default of 2000 — the
     documented semantics of the option. The pre-existing "unusable next-goal generation ends the loop cleanly"
     test was updated to set `maxConditionChars: 2000` explicitly so it pins the same 2000-char boundary it
     always exercised.
126. Pin test (`test/loop.test.ts`, 1 new): `maxConditionChars: 100` with a 150-char planner reply ends the loop
     cleanly ("nothing usable"); verified to fail on the pre-fix tree and pass with it.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`.

Verification: `bun run check` green (348 tests, spec-check ok); coordinator submit.

## Workstream AG — read-only RPC list no longer fans out boundary compactions (A-3)

`list()` (the goals RPC) fell back to `controller.restore()` when the in-memory list was empty — which adopts
records AND queues a boundary-compaction request at the host for every active goal, so a client asking "what
goals exist" could ask the host to compact sessions it never rendered.

127. Split: `restore(options?: { boundaryCompact?: boolean })` on `GoalController`. The default (`true`) keeps
     the restart fan-out unchanged (bootstrap path, `src/index.ts`). The RPC `list` fallback calls
     `restore({ boundaryCompact: false })` — adopt-only, zero host side effects. `RpcGoalController` in
     `src/rpc-handlers.ts` carries the same optional parameter.
128. Pin tests (2 new): `test/rpc-handlers.test.ts` asserts the list fallback calls restore with
     `{ boundaryCompact: false }`; `test/loop.test.ts` asserts an adopt-only restore of an armed record
     requests no host compaction while the default restore does. Both verified to fail on the pre-fix tree and
     pass with it. Test count 348 → 350.

Files touched: `src/runtime/controller.ts`, `src/rpc-handlers.ts`, `test/loop.test.ts`, `test/rpc-handlers.test.ts`, `SPEC.md`.

Verification: `bun run check` green (350 tests, spec-check ok); coordinator submit.

## Workstream AH — repeat-condition guard ignores punctuation (A-5)

The loop's completed-condition normalization stripped whitespace and lowercased, but kept punctuation, so a
planner offering "Fix the flaky test." after "fix the flaky test" was completed armed the same work again — the
exact failure the guard exists to stop. Normalization now collapses every run of non-alphanumerics (unicode
letters and numbers kept) into one space: `value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()`.

129. Pin test (`test/loop.test.ts`, 1 new): punctuation-drifted repeat of a completed condition ends the loop
     cleanly ("already-completed"); verified to fail on the pre-fix tree and pass with it. Test count 350 → 351.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`.

Verification: `bun run check` green (351 tests, spec-check ok); coordinator submit.

## Workstream AI — set() awaits the initial record write (A-8)

`set()` kicked off `commit(record)` without awaiting it; a crash right after `/goal` returns could lose the
just-set record even though the store queue and `commit()` are promise-based. The set path is the one place a
lost write silently un-sets the goal, so it now awaits the initial commit. (`onUserPrompt`, `evaluationFailed`,
`handleFailure` keep their fire-and-forget commits — superseded by the next commit by design.) `store.save`
never rejects (write failures resolve `false` and clear the no-op marker for retry), so the await cannot wedge
`set()`.

130. Pin test (`test/loop.test.ts`, 1 new): a storage write gated on a manual gate blocks `set()`'s return and
     the directive prompt; releasing the gate lets both proceed. Verified to fail on the pre-fix tree and pass
     with it. Test count 351 → 352.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`.

Verification: `bun run check` green (352 tests, spec-check ok); coordinator submit.

## Workstream AJ — restore() fans out boundary compactions only for armed loops (A-4)

`restore()` requested a boundary compaction for every active record, plain `/goal` goals included — contradicting
the documented discipline that plain goals never reach the boundary-compaction path. The fan-out is now
restricted to `record.loopEnabled`. The `boundaryCompact: false` adopt-only mode (Workstream AG) is unchanged
and still suppresses the fan-out entirely.

131. Pin test (`test/loop.test.ts`, 1 new): a plain goal restored via the default path requests no host
     compaction; verified to fail on the pre-fix tree and pass with it. The loop-enabled control fan-out is
     pinned by the Workstream AG test. Test count 352 → 353.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`.

Verification: `bun run check` green (353 tests, spec-check ok); coordinator submit.

## Workstream AK — the final spend re-save goes through commit()'s no-op cache (A-9)

`finish()` persisted the terminal record via `commit()` (no-op cache set to the pre-`final` serialized string),
then the background final-spend snapshot re-saved directly via `store.save()`, leaving `lastCommit` holding a
stale pre-`final` marker. Correctness survived (the next identical commit would re-save), but the cache
invariant — `lastCommit` mirrors the last persisted serialization — was broken, so a later commit of the
`final`-carrying record would redundantly re-save instead of skipping. The snapshot now re-saves via
`commit(record)`, restoring the invariant.

132. Pin test (`test/loop.test.ts`, 1 new): after the final spend snapshot lands, the controller's no-op cache
     entry `lastCommit` equals `JSON.stringify(record)` including `final`. Verified to fail on the pre-fix tree
     and pass with it. Test count 353 → 354.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`.

Verification: `bun run check` green (354 tests, spec-check ok); coordinator submit.

## Workstream AL — the cap-freeze courtesy warning fires once per freeze (A-24)

While a plain goal sat paused at the turn cap, every user prompt re-notified "Goal paused at turn cap",
violating the one-courtesy-notice-per-event-kind discipline. The notice is now one-shot per pause via a
session-scoped runtime flag (`capFreezeNotified`, alongside `capNotified`/`stallNotified`). Later prompts in
the same freeze stay silent; a restart begins a fresh freeze and may notify once again.

133. Pin test (`test/loop.test.ts`, 1 new): two prompts on a capped, paused plain goal produce exactly one
     "Goal paused at turn cap" notice. Verified to fail on the pre-fix tree and pass with it. Test count
     354 → 355.

Files touched: `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`.

Verification: `bun run check` green (355 tests, spec-check ok); coordinator submit.

## Workstream AM — one capped backoff helper, two documented curves (A-21)

`evaluationFailed` used `REEVALUATE_BASE_MS × 3ⁿ` while `handleFailure` and the loop-planner retry used
`RETRY_BASE_MS × 4ⁿ`, with no stated rationale. A shared `backoffMs(base, growth, exponent)` helper (capped at
`RETRY_MAX_MS`) now backs all three sites, and the curve difference is documented at the helper: evaluator
failures are transient and cheap to retry (10s/30s/90s), while a failing planner or dispatch burns a full model
round-trip (15s/60s/240s). Byte-compatible delays; the existing backoff tests (e.g. the planner retry after
15s, the evaluator retry) pass unchanged. Pure dedup — no test added.

Files touched: `src/runtime/controller.ts`, `SPEC.md`.

Verification: `bun run check` green (355 tests, spec-check ok); coordinator submit.

## Workstream AN — stale loopNotProgress comment corrected (A-13)

`src/core/types.ts` claimed "two [zero-tool iterations] pause the loop", contradicting the never-pause policy
(one notice, armed loop keeps arming) enforced in `loopAdvance` and pinned by `loop.test.ts`. The comment now
states what the field is: consecutive zero-tool iterations, recorded and surfaced in the TUI, never a pause.

Files touched: `src/core/types.ts`, `SPEC.md`. No behavior change; test count unchanged (355).

Verification: `bun run check` green (355 tests, spec-check ok); coordinator submit.

## Workstream AO — the event payload boundary is `unknown`, not `any` (A-14)

`type Data = Record<string, any>` leaked `any` across every session-event read site. `Data` is now
`Record<string, unknown>`; nested shell payloads (`info`, `metadata`) narrow through a tiny `asRecord` guard
(object check + cast, local to the file). One latent strictness gap surfaced and fixed: `info.id`'s `typeof`
narrowing did not propagate into the `safe()` closure, so the id is extracted to a `const` first. Runtime
behavior is identical; `tsc --noEmit` enforces the boundary. No test added (types-only change; existing
plugin/controller event tests pass unchanged) — stated plainly rather than dressing up a type refactor as a
behavioral fix.

Files touched: `src/runtime/events.ts`, `SPEC.md`.

Verification: `bun run check` green (355 tests, spec-check ok); coordinator submit.

## Workstream AP — one guard for every event handler (A-15)

`session.execution.succeeded` wrapped `background.executionEnded` in `safe()` but routed the async controllers
through inline `.catch(fail)`; `session.compaction.ended` split the same way. The router now has a single
`guard` rule for every handler, sync or async: a throwing handler is reported via `fail` and never propagates
into the event stream (sync throws caught at call time; async rejections chained). `safe()` is gone.

134. Pin test (`test/controller.test.ts`, 1 new): a rejecting `onExecutionSucceeded`, `onCompactionLanded` and
     `maybeCompact` are all reported via `log.error` and none escapes the router (3 errors, no throw). Passes
     both before and after the change — a drift pin against future split-style edits, stated as such (this is a
     unification refactor with byte-identical behavior, not a bug fix). Test count 355 → 356.

Files touched: `src/runtime/events.ts`, `test/controller.test.ts`, `SPEC.md`.

Verification: `bun run check` green (356 tests, spec-check ok); coordinator submit.

## Workstream AQ — one set of boundary-compaction constants (A-26)

Four magic numbers were duplicated across files: the `10_000` boundary-token floor (inline twice in
`contextDropped`, plus compactor's `BOUNDARY_MIN_TOKENS`), the `0.6` drop factor, the `120_000` cooldown
(`REANCHOR_MIN_INTERVAL_MS` in controller vs `REQUEST_COOLDOWN_MS` in compactor), and the `10 * 60_000`
restore-time landed-grace. New `src/core/constants.ts` is the single source: `BOUNDARY_MIN_TOKENS`,
`BOUNDARY_DROP_FACTOR`, `COMPACT_COOLDOWN_MS`, `BOUNDARY_LANDING_GRACE_MS`. `REANCHOR_MIN_INTERVAL_MS` remains
as the controller-local name, assigned from `COMPACT_COOLDOWN_MS` (same budget). No behavior change; the
existing cooldown/drop/restore tests pass unchanged.

Files touched: `src/core/constants.ts` (new), `src/runtime/controller.ts`, `src/runtime/compactor.ts`, `SPEC.md`.

Verification: `bun run check` green (356 tests, 36 files, spec-check ok); coordinator submit.

## Workstream AR — maxRetries documented as inert everywhere (A-27)

`maxRetries` parses and validates (backward compatible) but gates nothing — retries are unlimited with capped
backoff. All current surfaces already flag it as inert: the `config.ts` JSDoc, `docs/config.html`,
`docs/runtime.html`, and the README options table. The key stays; the stale mention in the goal-loop design
section is retained as design history and is superseded by the later "the `maxRetries` cutoff is gone" note.
No code change; nothing removed; SPEC-only workstream.

Files touched: `SPEC.md`. Test count unchanged (356, 36 files).

Verification: `bun run check` green (spec-check ok); coordinator submit.

## Workstream AS — the TUI goal-snapshot cache is pruned and capped (A-11)

`entries()` in `src/tui.tsx` only got entries added; terminal sessions' snapshots (and null entries for
deleted/never-goaled sessions) accumulated for the life of the process. New pure module `src/core/entries.ts`
exports `pruneSnapshotEntries` (and `ENTRY_CAP = 64`): null-valued entries are dropped unless an open dialog is
rendering that session, the map is capped with oldest non-live entries evicted first, and live
(active/paused) entries are never evicted by the cap. `tui.tsx` tracks the open dialog's session via a
`statusDialogSession` signal (set on show, cleared on close/onClose/teardown) and prunes inline in the
`put` path — no timers, nothing else re-renders. Returns the same reference when nothing changed (Solid signal
stays quiet). dist/tui.js rebuilt and committed in this workstream.

135. Pin tests (`test/entries.test.ts`, 7 new): null drop, keep-the-dialog-session, same-reference no-op, cap
     eviction order (oldest non-live, keep wins), live entries never evicted, cap-exceeding all-live map. The
     TUI wiring is covered by the rebuilt-load check (`scripts/tui-load-check.ts`) and the unchanged dialog
     tests. Test count 356 → 363, files 36 → 37.

Files touched: `src/core/entries.ts` (new), `src/tui.tsx`, `dist/tui.js`, `test/entries.test.ts` (new), `SPEC.md`.

Verification: `bun run check` green (363 tests, 37 files, spec-check ok); coordinator submit.

### Resolution summary (iteration-1 audit wave, 2026-11-15)

All 30 findings are resolved or waived. Resolved with workstreams: A-1 (AC), A-25 (AD), A-6/A-22 (AE), A-2 (AF),
A-3 (AG), A-5 (AH), A-8 (AI), A-4 (AJ), A-9 (AK), A-24 (AL), A-21 (AM), A-13 (AN), A-14 (AO), A-15 (AP), A-26 (AQ),
A-27 (AR), A-11 (AS). Waived with recorded reasons: A-7, A-10, A-12, A-16, A-17, A-18, A-19, A-20, A-23, A-28,
A-29, A-30. Every fix shipped with a test that failed before the fix (pin tests; pre-fix failure verified by
stashing), except the behavior-preserving dedup/comment/documentation resolutions A-13, A-15, A-21, A-27, which are
stated as such. `bun run check` is green at dev with 363 tests / 37 files, and the end-to-end smoke
(`bun run e2e /tmp/opencode/goal-e2e/proj`) completed: the `/goal` command registered, one turn ran, the
evaluator verdict was `met` with fresh evidence, and the goal closed as `achieved`. Coordinator leases: 64 done
before this note (63 + this chain); all `wt/` worktrees are pruned after each merge.

### Coordinator process note — two landings, the breach, and the authorized rewrite (2026-11-15)

Honest record of the only-merge-next-lands breach this audit wave, caught by the evaluator:

1. `goal-jump-row-indicator` (foreign lease, parallel orchestrator, submitted 2026-11-15T21:04:48Z) and
   `a11-entries-prune` (Workstream AS) reached dev via scratch-branch merges resolving a generated-table
   `docs/changelog.html` conflict (rows are a pure function of git history), with dev fast-forwarded to the
   gate-green trees. merge-next had no content-conflict path and merges only the oldest submitted lease.
2. The rewrite was rehearsed before it was attempted: the replay from pre-hand-merge dev (`508d8af`) through
   both chains plus these two documentation notes landed byte-identically (37/363 spec-check, TUI load ok) with
   only `.term/coordinator/state.json` bookkeeping differing.
3. The work was executed only after the owner authorized it in this loop. `dev` was reset onto `508d8af`
   locally (no remote `dev` branch exists; `origin` carries only `main`; nothing was force-pushed), the four
   chains were re-submitted as `reland-*` leases, and every one of them landed through merge-next's own merge
   step and gate (`wt/reland-gjr`, `wt/reland-a11`, `wt/reland-specnote`, `wt/reland-processnote`). The
   pre-rewrite tip is preserved at tag `rescue/dev-0f2d75d` (and `rescue/pre-rewrite`), so the rewrite is fully
   reversible. The foreign lease's content was never altered; only local dev history was rebuilt.
4. Verification after the rewrite: `bun run check` green at dev (363 tests / 17 files, spec-check ok, TUI load
   ok, docs freshness ok); all `reland-*` and all prior leases `done`; e2e smoke passed on the pre-rewrite tree
   with identical source content (the rewrite changed commit topology, not code).

## Workstream AT — opencode-CLI goal guide

Interpretation of the armed condition: goals that mention opencode (the v2 CLI itself) need the same kind of
first-turn steer the fuzzy-condition hint gives vague goals — a short operating guide for the harness the
plugin runs inside. `src/core/opencode-cli.ts` (new) exports `isOpencodeCliCondition` and `opencodeCliGuide`;
`directive()` in `src/core/prompts.ts` injects the `<opencode-cli>` block right after the fuzzy hint when (and
only when) the condition mentions opencode. No config option, no env var: the trigger is the condition text,
exactly like `isFuzzyCondition`.

136. `isOpencodeCliCondition(condition)` is true iff the condition matches /\bopencode\b/i (word-bounded, any
     case) — "opencode v2 CLI", "OpenCode's plugin api", "opencode-goal" all match; "opencoding", "open coding"
     do not. Pure function, no I/O. Matcher decision (deliberately a bare word match, no cli-ish keyword gate):
     a false positive costs one static block (~600 tokens) once in turn 1; a keyword gate produces false
     negatives exactly when the guide is needed most ("opencode v2.3.0 broke my workflow" carries no cli-ish
     keyword beyond the product name). \b keeps possessives and filenames matching ("OpenCode's",
     "opencode.jsonc", "opencode-goal") while rejecting "opencoding" and "open coding".
137. When it matches, the first-turn directive injects an `<opencode-cli>` block (after the fuzzy-condition
     SPEC.md hint, before the commit rule) carrying the operating guide: check `opencode --version` and never
     rebuild/replace the installed binary; the nearest source clone may lag; the plugin API contract is
     `node_modules/@opencode/plugin/dist/tui/context.d.ts` and the SlotMap is the only stable TUI extension
     surface; search the binary for element IDs with targeted grep -ao + string-window extraction; never modify
     host sources to test a plugin — verify with a headless opentui render in /tmp (`createTestRenderer` from
     `@opentui/core/testing` + `render` from `@opentui/solid`, `renderOnce()`, `captureCharFrame()`, assert on
     rows); plugins are `Plugin.define({ id, setup })` — server entry `src/index.ts` imports `Plugin` from
     `@opencode/plugin`, TUI entry `src/tui.tsx` → precompiled `dist/tui.js` imports `Plugin` from
     `@opencode/plugin/tui`; mount the local checkout in `~/.config/opencode/opencode.jsonc` under
     `"plugins": [...]` (v2 server config key; TUI plugins via `~/.config/opencode/tui.jsonc` `"plugin": [...]`);
     restart the TUI (no hot reload of unbuilt code); test with the real binary via a throwaway
     `XDG_CONFIG_HOME=<scratch>` (config at `<scratch>/opencode/opencode.jsonc`) and `--standalone`
     (default attaches to the background service, which keeps service-start config and ignores env
     overrides; there is no `--config` flag) in tmux/a PTY + `tmux capture-pane -p`; verify the mount
     via `/plugins` in-session (empty `"plugins": []` → "No items available", a local checkout → listed
     as `local` under TUI/Server); server plugins in `<config>/plugins/*.ts` auto-load too; logs at
     `~/.local/share/opencode/log/opencode.log` (`run=<id>` groups each process); a failure ladder
     (binary newer → string-extract and diff; silent slot → grep the
     binary, check the plugin mounted, check the render returned JSX; negative offset → check ancestors'
     overflow/position first); and the two honest limits: no stable documented headless-drive tool for the v2
     TUI (scrape a PTY/tmux session or reproduce layout in `@opentui/core/testing`), and the installed binary
     is ahead of any public clone so string extraction is often the only source of truth. Rules: minimal
     slot-level changes, never commit to the host repo, keep plugin tests headless, and report which layer
     (binary / source / test-render / live TUI) each claim was verified at.
138. The block is first-turn only (like the fuzzy hint): continuations, retries, check-ins, the loop
     preamble/re-anchor, the system reminder and the evaluator rubric are untouched — no per-turn context
     cost, no evaluator behavior change. `loopContinuation` deliberately does NOT re-inject the guide: it is
     one-time turn-1 context, loop iterations still see the arming directive and its `<opencode-cli>` block in
     conversation history, and re-injecting per iteration would add ~600 tokens of zero-information repetition.
     If a loop ever needs the guide re-surfaced, that is a rubric/preamble decision, not a silent injection.
139. Goals whose condition never mentions opencode get a byte-identical directive to before this workstream.
140. Tests pin it: `test/opencode-cli.test.ts` (8 tests) covers the word-boundary matcher, the balanced tagged
     block and its key invariants (`opencode --version`, SlotMap, `@opentui/core/testing`, `captureCharFrame()`,
     `tmux capture-pane -p`, `Plugin.define`, the layer-reporting rule, both honest limits), injection on/off in
     `directive()`, coexistence with the fuzzy hint, placement before the commit rule, and injection on a
     non-fuzzy opencode condition. Docs: README ("OpenCode CLI work" paragraph), AGENTS.md (module list +
     bullet), `docs/core.html` (card). Test count 363 → 371, files 37 → 38; the spec-check marker is updated in
     the same commit.

Verification: `bun run check` green in the worktree (371 tests / 38 files, spec-check ok, docs freshness ok
after the stamp refresh), coordinator submit + merge-next. Iteration 3 (live TUI smoke on installed v2.3.0):
scratch `XDG_CONFIG_HOME` + `--standalone` boots the TUI with the throwaway config; `/plugins` renders "No
items available" when `"plugins": []` (discriminator) and lists the locally mounted opencode-goal plugin as
`local` under both TUI (`opencode-goal.tui`) and Server (`opencode-goal`); the standalone log confirms only
the goal plugin loaded (`run=<id>` groups; no `<config>/plugins/*.ts` entries from the scratch tree). The
guide's former "throwaway `--config` dir" claim was falsified (no `--config` flag in v2.3.0; default attaches
to the background service, which keeps service-start config and ignores env overrides) and was rewritten to
the verified XDG_CONFIG_HOME + `--standalone` recipe in this commit.
Iteration 4 (SlotMap slot-list audit, installed v2.3.0): the guide's full slot list — `app`, `home.footer`,
`home.footer.status`, `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`, `session.composer.top`
(input `{sessionID}`), `session.panel`, `sidebar.content`, `sidebar.footer` — matches
`node_modules/@opencode/plugin/dist/tui/context.d.ts` (@opencode/plugin 2.0.29), the clone source
(`packages/plugin/src/tui/context.ts`, fake clone dev branch, identical SlotMap), and the installed binary
(v2.3.0), which registers each of the ten as a `path:"..."` slot boundary and contains no other
namespaced slot registration (`grep -aoE 'path:"[a-z][a-z.]{2,40}"'` yields exactly the ten plus unrelated
schema paths such as `sandbox.credentials`/`nullable`). `session.composer.top`'s binary registration reads
`path:"session.composer.top"` with `input(){return{sessionID:...`, matching the documented input. No slot
name drift found; guide items 2 and 6 and this criterion stand unchanged.

## Workstream AU — the RPC/TUI boundary has zero trust-casts (iteration 2 condition)

Interpretation of the armed condition: zero `as any` / `as unknown` casts in the RPC/TUI boundary
(`rpc.ts`, `src/rpc-handlers.ts`, `src/tui.tsx`, `src/tui-history.tsx`, `src/status-dialog.tsx`; `src/rpc.ts`
included for completeness), each replaced by a validated narrow, with pin tests where behavior could change.
The boundary files in fact carry zero value casts of any kind after this workstream (the only remaining `as`
tokens in `src/rpc.ts` are its `as const` schema literals, which are not value casts). `status-dialog.tsx`
never carried a cast and is unchanged.

141. New pure module `src/core/wire.ts` holds every validated narrow. Base guard `isRecord` (plain, non-array
     object) and the enum guards `isGoalStatus` / `isVerdict` / `isNoticeKind` / `isNoticeLevel` (the full
     `NoticeKind` and `NoticeLevel` unions from `src/core/types.ts`). Composite guards `isUsageSnapshot`,
     `isVerdictEntry`, `isLoopEntry`, `isLoopCompact`, and `isGoalSnapshot` — a full structural check of the
     read model the server emits (required `version: 1`, non-empty `id`/`sessionID`, known status, finite
     numbers for turns/stall/retries/checkins/elapsedMs, a fully validated `baseline`, `history` entries
     verdict-checked); optional additive fields are validated when present and unknown extra fields are
     tolerated, so older clients keep working against newer servers. `parseGoalSnapshot`,
     `parseGetGoalOutput` (`{ goal: GoalSnapshot | null }` or drop) and `parseChangedEvent`
     (sessionID-validated; explicit or absent `goal` narrows to null, matching the previous `?? null`)
     each return `undefined` on malformed input. `parseNotice` builds a fresh `Notice` from enum-checked
     parts. No casts anywhere in the module — type predicates only.
142. Call sites. `src/rpc-handlers.ts` `sessionIDOf` narrows through `isRecord` (behavior identical: null,
     arrays, primitives and missing/empty/non-string `sessionID` all still throw `sessionID is required`).
     `src/tui.tsx` `refresh()` drops an unusable `goal` RPC result and keeps the previous entry (the same
     posture as a failed fetch) instead of trust-casting `result`; the `changed` handler drops events with a
     malformed sessionID or snapshot instead of blanking a live entry; the `notice` handler drops malformed
     notices instead of pushing them into the render tree; the dialog error-toast path uses
     `error instanceof Error` instead of `(error as Error)?.stack`. `src/tui-history.tsx` `capReached()`
     binds `max()` to a local (`const limit = max()`) instead of `(max() as number)`.
143. Behavior changes are confined to the fail-closed direction, and each is pinned: a present-but-malformed
     snapshot in a `changed` event is dropped (previously it overwrote the cached entry with garbage, or
     blanked it); an unusable `goal` RPC response no longer reaches `put()` (previously it was cast and
     cached); a notice with an unknown `kind`/`level` is dropped (previously rendered as-is). Valid payloads
     behave exactly as before — the same object flows downstream once narrowed.
144. Pin tests `test/wire.test.ts` (14 tests): the `isRecord` matrix; `parseGoalSnapshot` accepts a minimal
     record, a fully looped record and legacy records without optional fields, and rejects 16 required-field
     breakages plus 8 optional-field breakages (loop fields, spend, reason/verdict types, NaN elapsedMs);
     `parseGetGoalOutput` for `{ goal: snapshot }` / `{ goal: null }` / tolerated extras / unusable payloads;
     `parseChangedEvent` for sessionID validation, explicit/absent null parity and malformed-snapshot drops;
     `parseNotice` across all 13 kinds × 4 levels and the drop cases. Fail-before verified: with
     `src/core/wire.ts` removed, `bun test wire.test.ts` fails at import (0 pass, 1 error); with it restored,
     14/14 pass. Test count 371 → 385, files 38 → 39; the spec-check marker in Workstream J is updated in the
     same commit.

Verification: `bun run check` green in the worktree (385 tests / 19 files, tsc clean, `dist/tui.js` rebuilt,
TUI load ok, docs freshness ok after the stamp refresh, spec-check ok 39/385), coordinator submit.

## Workstream AV — Phase 3 async-hole sweep: commit() can no longer reject (iteration 3 condition)

Interpretation of the armed condition: find un-awaited promises / `.catch` gaps around synthetic sends,
commits, evaluator calls and the `stale()` re-check, and give each a failing-before fault-injection test.
Method: every `this.commit(` / `this.finish(` / `this.pause(` / `this.continueWith(` / `this.note(` /
`void this.*` call site in `src/runtime/controller.ts` was traced to its rejection behavior. One reachable
hole was found and fixed; two unguarded fire-and-forget dispatches were hardened (defensive, no reachable
rejection today); the evaluator calls and every `stale()` re-check were audited and are already fenced.

145. The hole: `commit()` returned `saved.then(ok => …)` where `saved = this.deps.store.save(record)`.
     `GoalStore`'s own saves resolve with a boolean (storage faults inside its queue land as `false`), but a
     `save()` that itself rejects — a storage fault at the port boundary, e.g. `structuredClone` failing on the
     port — propagated out of `commit()`. Every un-awaited `this.commit(record)` in the state machine
     (`evaluate` not_met path, `evaluationFailed`, `handleFailure`, `checkin`, `adoptRestored`,
     `onUserPrompt`, the final-spend re-save in `finish()`) became an unhandled rejection, and the `lastCommit`
     no-op marker was never dropped, so a later identical commit would skip the durable write believing it had
     landed. Fix: `commit()` normalizes a rejecting save to `false` (plus a `log.warn`), so the promise never
     rejects for storage reasons and the existing `!ok → lastCommit.delete` path arms the retry, exactly as
     for a `false` return. Fire-and-forget call sites are safe by construction; `emit()` stays synchronous and
     unchanged (a hostile emitter still throws synchronously into its guarded callers).
146. Two unguarded fire-and-forget dispatches got `.catch(log.error)`: the `handleFailure` retry's
     `void this.continueWith(…)` ("retry continuation failed") and the in-`continueWith` retry of a failed
     synthetic steer ("continuation retry failed"), plus the idle-check-in's `checkin` dispatch
     ("goal check-in failed"). `continueWith`/`checkin` are total today (every await inside is fenced —
     the synthetic send is try/catch with a scheduled retry), so these three are belt-and-braces, not bug
     fixes; no failing-before test is possible for them. The two remaining `void this.evaluate(...)` and
     `void this.loopAdvance(...)` retry sites already carried `.catch`.
147. Evaluator calls audited, no changes needed: `this.deps.evaluator.evaluate` is awaited inside try/catch
     (failure → `evaluationFailed`, which backs off REEVALUATE_BASE_MS × 3ⁿ and retries forever);
     `verifyMet`'s verifier call is awaited inside try/catch and fails closed (downgraded to `not_met`);
     `summarize`/`nextGoal` in `loopAdvance` are awaited inside try/catch (summary failure → placeholder
     summary + retry via `loopRetries` backoff; a met verdict is never advanced on a thrown planner).
148. `stale()` re-checks audited, none missing: every await whose continuation mutates the record or arms
     host work (`session.usage` before evaluation, `busy()` before the defer decision, the evaluator itself,
     `verifyMet`, `summarize`, `nextGoal`, all boundary-compact settles) is followed by an
     `if (this.stale(record, runtime, epoch)) return` before any state mutation or dispatch; the
     `restore()`-time compaction fan-out re-checks `goals.get(…) === record && status === "active"` after its
     await. `finish()`'s final-spend snapshot checks `goals.get(record.sessionID) === record` before writing
     `record.final`. No behavior change.
149. Pin tests (`test/controller.test.ts`, "GoalController async holes", 3 new). The failing-before pin:
     monkeypatch `store.save` to reject → `set()` resolves, `save` was attempted once, the record is active,
     and a subsequent identical-state `onUserPrompt` re-attempts the write (marker was dropped) — this test
     fails before the fix at the `await h.set(...)` (rejects) and at the retry assertion. A second test faults
     storage under an evaluator throw: the `retry` notice fires and the scheduled re-evaluation on the fake
     clock re-attempts the durable write. A third pins the unchanged success path (healthy store still
     short-circuits identical commits on the no-op marker). Fail-before verified by stashing the fix: both
     fault tests fail pre-fix (33 pass / 2 fail), all 35 pass post-fix; this suite grew 32 → 35 tests.
     Test count 385 → 388, files 39.

Files touched: `src/runtime/controller.ts`, `test/controller.test.ts`, `SPEC.md`. `dist/tui.js` rebuilt by the
check (byte-identical; the TUI bundle does not include the controller).

Verification: `bun run check` green in the worktree (388 tests / 19 files, tsc clean, TUI load ok, docs
freshness ok after the stamp refresh, spec-check ok 39/388 after the marker bump in this commit); coordinator
submit.

## Workstream AW — Iteration 4: end-to-end sanity pass (e2e green, exit 0)

Armed condition (iteration 4 of the loop): run `bun run e2e ''` in a fresh scratch checkout and report
the honest outcome; if it fails, land the smallest fix with a failing-before test and show
`bun run check` green at dev. Outcome: it passed. No code change; no failing-before test applies.

150. Fresh scratch checkout: `git clone --branch dev` of dev tip `53403d6` into
     `/tmp/opencode/e2e-checkout`, `bun install` (358 packages), then `bun run check` inside the scratch
     checkout: 388 pass / 0 fail (19 files), tsc clean, TUI load ok, docs freshness ok, spec-check ok
     (39/388). Dev reproduces from a clean clone.
151. E2E run: fresh empty project `/tmp/opencode/e2e-project-1794780812`; `bun run e2e <dir>` with the
     default live model (`opencode/deepseek-v4.1-flash-free`) against a private standalone `opencode serve`
     on `127.0.0.1:4893`. Plugin registered `/goal` (`goal command registered: true`). Prompt:
     `notes/plan.md exists with exactly three numbered steps for brewing tea, and notes/done.txt contains
     the single word DONE. Prove both by printing the files.` One arm, one turn, one steer: the model ran
     bash (`mkdir`/`printf`/`cat`/`wc -l`), the independent evaluator judged the visible transcript
     (files printed, `wc -l` = 3 and 1), **Goal achieved in 1 turn**, `final` status `achieved`, spend
     recorded (input 13595, output 333), history `["1:met"]`. Files verified on disk: `notes/plan.md` has
     exactly the three steps; `notes/done.txt` is `DONE\n`. Digest rendered: 1655 chars. **Exit 0.**
152. Cosmetic observation, not a failure: the `plugin.list` RPC returned `data: []`, so the e2e script's
     `OpenCodeGoal` match printed the raw payload instead of a plugin row. The plugin plainly loaded (the
     `/goal` command registered and the full set → evaluate → met → note lifecycle ran). No fix: the
     pass/fail gates are command registration and the achieved verdict, both green. Recorded here so the
     next person who reads `plugin:` output in the e2e log does not chase it.
153. No source or test changes, so the spec-check marker is unchanged (`files=39 tests=388`). Fresh-clone
     and worktree `bun run check` agree.

Files touched: `SPEC.md` only.

Verification: e2e exit 0 (see transcript and `/tmp/opencode/e2e-run-iter4.log`); `bun run check` green in
the scratch checkout and in this worktree; coordinator submit. This workstream adds no gates and weakens
nothing.
## Workstream AX — dead-surface trim: 33 zero-user exports unexported, stale SPEC claims corrected (iteration 5 condition)

Interpretation of the armed condition: "find exported symbols with zero users and stale SPEC/comment claims,
remove or correct them (never code to fit stale SPEC), add failing-before tests for any behavior change,
one coordinator workstream". Phase 3 sweep, first pass.

154. **Method.** Enumerated all 176 `export` declarations across `src/` and cross-checked every name against
     the whole shipped surface: `src/`, `test/`, `scripts/`, `index.ts`, `rpc.ts`, `tui.ts` (all files an
     in-repo consumer could import), plus `SPEC.md`/`README.md`/`docs/`/`opencode.json`/`package.json` for
     prose accuracy. Thirty-three names had zero references outside their defining file (in-file uses only).
     Every one of them keeps its symbol; only the `export` keyword was removed — a visibility narrowing,
     not a deletion (nothing was dead inside its own file) and not a behavior change. The boundary
     composition roots (`isRecord`, `isGoalSnapshot`, …) and every symbol any test imports
     (`isGoalSnapshot`, `parseGoalSnapshot`, `parseGetGoalOutput`, `parseChangedEvent`, `parseNotice`) stay
     exported. `GoalRpc` stays exported (the `./rpc` entrypoint contract). The TUI bundle is unchanged
     (`bun run compile` byte-identical; `tui-load-check` passes).
155. **Unexported (33).** Types/interfaces used only as parameter/return types inside their own module:
     `BackgroundDeps` (background.ts), `CompactorDeps`, `BoundaryCompactMiss` (compactor.ts),
     `ControllerDeps`, `InterruptReason` (controller.ts), `EvaluatorDeps` (evaluator.ts), `BootstrapResult`
     (bootstrap.ts), `Classified` (errors.ts), `CoordinatorDetection` (git.ts), `VerdictCounts`,
     `LoopTotals` (history.ts), `GoalCommand` (parse.ts), `DigestOptions` (transcript.ts),
     `ParsedVerdict` (verdict.ts), `EvaluationFacts`, `LoopPreamble`, `LoopSummaryInput`, `NextGoalInput`
     (prompts.ts). Module-internal render/prompt helpers with no external importer: `renderMessage`
     (transcript.ts), `normalizeVerdict` (verdict.ts), `coordinatorFlow`, `historyBlock`, `loopPreamble`
     (prompts.ts). Wire-boundary enum guards composed only inside `wire.ts` (its own `isGoalSnapshot` and
     the composite builders use them): `isGoalStatus`, `isVerdict`, `isNoticeKind`, `isNoticeLevel`,
     `isUsageSnapshot`, `isVerdictEntry`, `isLoopEntry`, `isLoopCompact`. Entrypoint constant with no
     consumer: `PLUGIN_ID` (index.ts; `Plugin.define` carries its own `id`). TUI presentational component
     used only inside tui-history.tsx: `VerdictTrail`.
156. **Stale SPEC claims corrected (code untouched, per "never code to fit stale SPEC").** The SPEC named a
     phantom constant `DIALOG_INSET = 3` three times (Workstream A header convention, the smoke-test record,
     the Workstream P body-gutter item). No such symbol ever existed; the real code is
     `paddingLeft={3} paddingRight={3}` on the host's `ClampedColumn` (`src/tui.tsx`) and `paddingRight={3}`
     on the body column (`src/status-dialog.tsx`). The three references now name the actual code. The
     mid-work deferral item (Workstream M, item 96) named `AutoCompactorDeps.isBusy?` — the interface is
     `CompactorDeps` in `src/runtime/compactor.ts`; corrected. A repository-wide scan of SPEC-quoted
     symbols (backticked identifiers with `Deps|Config|Snapshot|Compact|Verdict|Loop|Goal|Rpc|Dialog|
     Wire|Entries` in their name) now reports zero that are absent from the tree; code comments referencing
     symbols were scanned the same way — none are missing.
157. **No failing-before test applies.** Part 154 is visibility narrowing (compile-time only, verified by
     `tsc --noEmit` exiting 0 — nothing outside the 15 touched files named any of the 33 symbols) and Part
     152 is SPEC-text correction. There is no runtime behavior to pin; adding a test that asserts an
     interface's non-exportability is not expressible in bun:test. Test count and file count unchanged.

Files touched: 15 sources (`src/core/bootstrap.ts`, `src/core/errors.ts`, `src/core/git.ts`,
`src/core/history.ts`, `src/core/parse.ts`, `src/core/prompts.ts`, `src/core/transcript.ts`,
`src/core/verdict.ts`, `src/core/wire.ts`, `src/index.ts`, `src/runtime/background.ts`,
`src/runtime/compactor.ts`, `src/runtime/controller.ts`, `src/runtime/evaluator.ts`,
`src/tui-history.tsx`) and `SPEC.md`. The marker stays `files=39 tests=388`. `dist/tui.js` rebuilt by
the check and byte-identical.

Verification: `bun run check` green in the worktree (388 tests / 19 files, tsc clean, TUI load ok, docs
freshness ok, spec-check ok 39/388); coordinator submit.

## Workstream AY — goal-loop command syntax (`/goal-loop-<N>`)

Landed after Workstream AX (dead-surface trim); the item numbers below continue from AX (154–157).

Armed condition: parameterized `/goal-loop-<N>` / `/goal-loop=N <objective>` support, implemented in the plugin
(never the host binary), with the parsing contract below. Parsing rule for N: an integer from 1 to 1000; the
token is removed from the objective, the per-run cap never rewrites `config.maxLoops`, and an invalid count is
stated and the configured default is used — never guessed, never silently clamped.

159. `src/core/parse.ts` — `parseGoalLoopDirective(raw): { objective, maxLoops?, invalidCount? } | undefined`.
     Matches only at the very beginning of the message (leading whitespace tolerated): `/goal-loop`,
     optionally followed by `-N` or `=N`, bounded by whitespace or end of input. `N` must be ASCII digits and an
     integer from 1 to 1000 (zero-padded counts are integers in range). Anything else with a suffix — `abc`,
     `0`, `1001`, `1.5`, `-3`, empty — reports `invalidCount` and falls back to the configured default (a
     present-but-out-of-range count is invalid, not clamped: rules 2/5 of the contract, not the prose clamp).
     Everything after the token is the objective (trimmed); the count never enters the completion condition;
     `/goal-loop investigate the 12 failing tests` keeps `12` as objective text. A bare directive parses with an
     empty objective (status behavior upstream). `/goal-loopy`, `/goal-loops`, `/goal anything` do not match.
160. `src/runtime/controller.ts` — record creation factored into a shared private `arm()` (baseline usage,
     `loopEnabled`/`loopIteration`/`loopObjective`/`loopMaxLoops`/`loopHistory`/`loopNotProgress`, commit, "set"
     notice). `set()` (command path) is `arm()` + synthetic directive prompt as before. New public
     `armFromPrompt({ sessionID, condition, maxLoops?, invalidCount? })` is `arm()` only, for the prompt-hook path
     where the admitted user message IS the kickoff (no synthetic prompt); it fires the "Loop count ignored"
     warning when `invalidCount` is set (`noteInvalidLoopCount`) and falls back to `config.maxLoops`. The set
     notice for a loop carries the effective limit (`iteration="1" max="N" · <condition>`). `maxLoops` rides the
     record; re-anchors and `loopAdvance` read `record.loopMaxLoops ?? config.maxLoops`, so the per-run cap
     applies end-to-end and later parameterless runs keep the configured default (rule 10).
161. `src/index.ts` — the session `prompt` hook (real user prompts only; synthetic continuations excluded) parses
     the raw text first. A valid directive with a non-empty objective is rewritten in place to the `directive()`
     text (token and count removed; the host awaits the hook before admitting the prompt and reads the mutated
     text), then the loop is armed via `armFromPrompt`. A bare directive (no objective) shows status and arms
     nothing; the resume semantics of the hook are unchanged for non-directive prompts. A present-but-invalid
     count is stated (`Loop count ignored` toast) and the default is used. This is the fix the spec's key limit
     note calls for — the plugin intercepts before the model sees the prompt; harnesses that hard-reject unknown
     slash commands before `SessionPrompt.prepare` are out of the plugin's reach by design.
162. Tests: `test/core.test.ts` (directive parser table, 22 new assertions across parser + plugin + loop
     suites), `test/loop.test.ts` (`armFromPrompt`: per-run cap recorded, cap ends the loop at N, continuation
     directive shows the per-run max, a later unparameterized loop uses the default, invalid counts warn and
     default — 0 and 1001 never clamped), `test/plugin.test.ts` (hook end-to-end: `/goal-loop-188`,
     `/goal-loop=3`, `/goal-loop-abc`, out-of-range, bare directive, `/goal` untouched — text mutation, storage
     record, notices). 410 passing, 0 failing (19 files).
163. Docs (`docs/install.html`, `docs/index.html`, `README.md` commands tables + loop section) document the
     syntax, the 1..1000 rule, the objective/count separation, and the per-run-only semantics. `/goal` and
     `/goal-loop` command behavior is unchanged; `/goal` ignores the directive entirely.

Files touched: `src/core/parse.ts`, `src/runtime/controller.ts`, `src/index.ts`, `test/core.test.ts`,
`test/loop.test.ts`, `test/plugin.test.ts`, `docs/install.html`, `docs/index.html`, `README.md`, `SPEC.md`.

Verification: `bun run check` green in the worktree (410 tests, tsc clean, TUI load ok, docs freshness ok after
the stamp refresh, spec-check ok 39/410 after the marker bump in this commit); coordinator submit.

## Workstream AZ — CLI installer: `opencode-goal` bin, two-command install/uninstall (iteration 1 condition)

Interpretation of the armed condition: "zero-dependency ESM bin `opencode-goal` in package.json `bin`;
`install` (default) / `status` / `uninstall`; `--global` (default) / `--project` / `--dry-run`; minimal,
fail-loud one-line errors, never a stack trace on expected failure paths. User flow:
`npm i -g @el4cteo/opencode-goal` → `opencode-goal install` → `/goal` → `opencode-goal uninstall`."
All mechanisms were discovered against the installed opencode v2.3.0, not assumed.
Landed after Workstream AY (goal-loop command syntax); the item numbers below continue from AY (159–163).

164. **Mechanism decision (verified, not guessed).** OpenCode v2 discovers configured plugins from the
     `plugins` array in its config file. npm package plugins are installed automatically at startup with
     Bun and cached under `~/.cache/opencode/node_modules`; the server AND TUI entrypoints of the package
     are loaded from that one config entry (verified in a live smoke run: the plugin listed under both
     Server (`opencode-goal`) and TUI (`opencode-goal.tui`)). The v2 config key is `plugins` (v1 used
     `plugin`). `<config>/plugins/*.ts` drop-in files also auto-load, but cannot express the npm package
     reference and would not track releases; `opencode plugin add` edits the same array but attaches to the
     background service and offers no backup/restore, and destructive testing against the real global
     config was off the table. The installer therefore edits the `plugins` array itself, surgically.
     Evidence: context7 v2 docs, strings in the installed v2.3.0 binary, and a scratch `XDG_CONFIG_HOME`
     `--standalone` smoke run during design.
165. **Discovery rules mirrored from the installed binary (v2.3.0)**, documented in the bin's header
     comment: global dir = `$XDG_CONFIG_HOME/opencode` when set, else `~/.config/opencode`; within it
     `opencode.jsonc` wins over `opencode.json` when both exist; `opencode.jsonc` is created when neither
     does. Project: first existing of `opencode.json`, `opencode.jsonc`, `.opencode/opencode.json`,
     `.opencode/opencode.jsonc`; `./opencode.json` is created when none exists (the binary's project
     default). The global/project asymmetry is faithful to the binary and documented as such.
166. **install** (`bin/opencode-goal.mjs`). Backs up every touched file first (`<file>.<yyyy-MM-DD-HH-mm-ss>Z.bak`,
     never overwritten; `-2`, `-3`, … on same-second collision). Adds only the `plugins` array entry;
     comments, formatting and unrelated keys survive via a minimal JSONC parser with source spans (no
     re-serialization of the document). Idempotent (`already installed`, exit 0). Creates the config with a
     `$schema` skeleton when absent. Refuses to touch a non-array `plugins` value. Writes never escape the
     target scope; `--dry-run` prints what would happen and writes nothing.
167. **uninstall.** Removes exactly the entry install added. Drops the whole `plugins` property when it
     becomes empty. Deletes the config file only when the remaining root is empty or exactly install's
     `$schema` skeleton; otherwise the file stays. If the entry is already missing it reports
     `not installed` and exits 0 (a config file install created is NOT deleted in this case unless it is
     empty/skeleton as above — there is nothing to remove). `--restore` copies the newest `.bak` back over
     the config instead (taking a fresh `.bak` of the current state first). Uninstall never auto-restores a
     backup on a missing entry: a backup is pre-install state, and copying it back would silently revert
     post-install edits the user made to unrelated keys — the "never clobber unrelated user config" rule
     wins. Would be reversed to always-restore if the user explicitly asks for `--restore`.
168. **CLI surface.** `opencode-goal` with no subcommand runs `install`. Subcommands: `install`,
     `uninstall`, `status`. Flags: `--global` (default), `--project`, `--dry-run`, `--restore`
     (uninstall-only), `--help`, `--version`. `--global` and `--project` are mutually exclusive. Expected
     failure paths print one human line (exit 1 for operational failures such as non-array `plugins` or an
     unparseable config, exit 2 for usage errors); no stack trace ever. `status` prints scope, config path,
     installed yes/no, and the detected opencode version (best-effort `opencode --version`).
169. **Testing** (`test/cli-installer.test.ts`, 25 tests). Failing-before recorded: the suite was written
     first against the not-yet-existing module (`Cannot find module '../bin/opencode-goal.mjs'` — all
     tests failed), the implementation landed, and the three initial mismatches (status wording, a
     multi-line usage dump on the unknown-command path — now one line, and `--version` reading the old
     1.0.1) were fixed in the implementation/test harness, never by weakening an assertion. Fake HOME and
     injected `env` everywhere; no test touches the real `~/.config/opencode`. Covers scope detection and
     discovery order, install creates/adds/backs-up/idempotent/object-form entries/dry-run/project-scope
     isolation, uninstall remove/drop-empty-array/delete-created-file/idempotent/`--restore`, status, and
     `runCli` exit codes/messages.
170. **Ship surface.** package.json `bin`: `opencode-goal → ./bin/opencode-goal.mjs` (shebang
     `#!/usr/bin/env node`, chmod 755); `files` gains `bin` (the `.d.mts` ships beside it — it is required
     by `tsc` for the test's `.mjs` import and gives TS consumers types); version 1.0.1 → 1.1.0 (semver
     minor: new feature, no breaking change). `npm pack --dry-run` file list inspected; the tarball
     contains the bin and its declarations.
171. **Docs** (this commit): `docs/install.html` Install section rewritten to the two-command flow
     (install / uninstall / status / project scope / dry-run / --restore / "what the installer touches" /
     manual alternative); README Install section rewritten to match; `docs/index.html` search keywords
     updated. `package.json:40`-style line citations removed from the page prose.
172. **Marker** bumped `files=39 tests=410` → `files=41 tests=435` (two new shipped files, +25 tests; dev's marker on the merge base was files=39 tests=410).
173. **Not run, honestly:** `bun run e2e` — plugin behavior is untouched (this workstream adds an
     installer bin, docs and a version bump; the goal plugin's runtime, evaluator and TUI are unchanged),
     so the e2e's signal would not cover anything this workstream changed; the live scratch proof and
     `bun run check` are the verification. `npm publish` is attempted only with `npm whoami` succeeding;
     if not, this is reported as the one remaining user step (`npm publish --access public`).

Files touched: `bin/opencode-goal.mjs` (new), `bin/opencode-goal.d.mts` (new), `test/cli-installer.test.ts` (new),
`package.json`, `SPEC.md`, `README.md`, `docs/install.html`, `docs/index.html` (search keywords).

Verification: `bun run check` green in the worktree before commit (413 tests / 20 files, tsc clean — the
`.d.mts` was added for exactly this, TUI load ok, docs freshness ok after the `docs:once` refresh commit,
spec-check ok 41/413 after the marker bump in this commit); live scratch proof (fresh `XDG_CONFIG_HOME`,
`opencode plugin list --standalone` before/after) recorded in the loop report; one read-only
`opencode-goal status` against the real global config permitted and run.

174. **Evaluator-flagged gap (fixed in the follow-up commit on `wt/cli-uninstall-restore`): uninstall with a
     missing entry and an install-time backup now restores the pre-install config instead of printing a note.**
     The goal requirement named two backup-restore triggers — the explicit `--restore` flag and a missing
     plugin entry. The shipped behavior only honored the flag; the missing-entry case got a pointer to
     `--restore`. Fixed: when uninstall finds nothing to remove (config file missing or entry missing), it
     looks for the newest backup whose parsed content provably lacks the plugin (the install-time original;
     a backup that fails to parse, or whose array contains the entry, is never considered, and a backup
     containing the plugin is never auto-restored). If found, the pre-install config is copied back
     byte-for-byte after taking a fresh safety backup of the current state (nothing is lost); if the config
     file is missing it is recreated from the backup. If the config already equals the pre-install backup,
     uninstall is a clean no-op (`not installed`, exit 0), so repeated runs converge in at most two steps.
     If no plugin-free backup exists, the old `not installed` note remains. Failing-before evidence: the new
     describe block was written first and 4 tests failed (restore/bytes/safety-backup/deleted-file/dry-run);
     the implementation landed and all pass (32 in the file, 442 total). The common double-uninstall flow for
     an install-created file is unchanged (no plugin-free backup exists → `not installed`, exit 0).
175. Docs: `docs/install.html` and the README uninstall paragraph now state the restore rule; the
     `--dry-run` path prints what it would restore and writes nothing.
176. Marker bumped `files=41 tests=435` → `files=41 tests=442` (no new shipped files, +7 tests).

Merge note (this file): dev gained Workstream AY (goal-loop command syntax) after this branch was cut. The sections were renumbered on merge — AY (159–163) stands as landed on dev; this workstream is AZ (164–173), marker reconciled to the merged tree (files=41, tests=435). The test/check figures in AZ's verification paragraph are the pre-merge worktree record (413 tests); the merged tree was re-verified by the coordinator's merged-result gate before dev advanced.

## Workstream BA — standalone rename: `@el4cteo/opencode-goal` → `opencode-goalv2`

The fork is standalone and names itself after its own repository. MIT attribution stays (LICENSE, README
credits footer, this note); nothing here publishes under, or points users at, the original author's
`@el4cteo` package as the thing to install.

177. **Name gates checked, in order (2026-11-15).** `opencode-goal` → taken: `latest 0.4.3`, owner
     `mirsella <mirsella@protonmail.com>` ("Add Codex-style long-running goals to OpenCode",
     `github.com/mirsella/opencode-goal`) — unpublishable for us, a different project. The fallback
     `@opencode-goal/opencode-goal` → 404 (the scope is free) but the scope cannot be created or owned from
     this machine (`npm whoami` fails, `ENEEDAUTH`). The user's decision: name the package after its own
     repository, `opencode-goalv2`. `npm view opencode-goalv2` → 404 (free) at rename time. The CLI keeps
     its `opencode-goal` brand and the served plugin id stays `opencode-goal` (`src/index.ts` `PLUGIN_ID`) —
     no id change, `/plugins` output unchanged; only the npm package name and the reference the installer
     writes change. `bin` stays `opencode-goal`.
178. **Sites renamed (everything machine-facing).** `package.json` `name` → `opencode-goalv2` (repository/
     homepage/bugs already pointed at `paumkim/opencode-goalv2`; `author` stays EL4CTEO as attribution;
     `bin`, `files`, version 1.1.0 unchanged). `bin/opencode-goal.mjs` `PLUGIN_PACKAGE` → `opencode-goalv2`
     (the single source of truth — header example, `PLUGIN_PACKAGE`, and every test fixture follow it, which
     is why the suite needed zero edits: it pins behavior through the constant, never the literal).
     README.md (`npm i -g opencode-goalv2`, manual `plugins` alternative, `package` field in the options
     example, image URLs → raw.githubusercontent.com/paumkim/opencode-goalv2/main/assets/, new fork-attribution
     line in the intro), `docs/install.html` (same command, same example, new fork-attribution line next to the
     manual alternative), `docs/index.html` (search keywords), `AGENTS.md` (plugin reference). SPEC
     history is not rewritten; the AZ smoke lines and the goal-prompt quote stay as landed.
179. **Fork attribution line (both surfaces).** README and `docs/install.html` now state: "This is a
     standalone MIT-licensed fork. If you want the original, installed by its author: `npm i -g
     @el4cteo/opencode-goal`." LICENSE and the docs credits footers are unchanged.
180. **No failing-before test is defined.** No evaluator can see the rename except through `PLUGIN_PACKAGE`,
     and the existing suite asserts the constant (`PLUGIN_PACKAGE` import), so the rename passes as written.
     The behavior pinned by the suite (config contains PLUGIN_PACKAGE, backups, restore, idempotency) is
     unchanged. Verification instead: `bun run check` green (marker unchanged `files=41 tests=442` — no new
     shipped files, no test changes), `grep -ri "el4cteo"` outside history/attribution/credit lines returns
     zero, `npm pack` file list inspected, and a live scratch `XDG_CONFIG_HOME` proof (fresh scratch, existing
     pre-install config, drift, uninstall → byte-identical pre-install restore; global-bin install →
     `opencode-goal` → `/plugins` smoke) with the rename-specific caveat recorded honestly: the package is
     not on the registry (`opencode-goalv2` 404 until publish, `npm whoami` = ENEEDAUTH), so the TUI proof
     loads from a hand-seeded opencode npm cache built from `npm pack` of the merged tree — the registry
     path itself is unverified until the user publishes.
181. **Ship state after merge.** Registry install is not possible yet (see 180). Global bin on this machine
     re-linked from the merged tree (`npm uninstall -g @el4cteo/opencode-goal`, `npm i -g .`) and
     `opencode-goal --version` reports 1.1.0. The user runs: `npm login && npm publish --access public`.
     Repository `origin` = `github.com/paumkim/opencode-goalv2` (this remote); publish and push are the
     same name/repo, self-consistent.

Files touched: `package.json`, `bin/opencode-goal.mjs`, `AGENTS.md`, `README.md`, `docs/install.html`,
`docs/index.html`, `SPEC.md`. The marker is unchanged.

Verification: `bun run check` green in the worktree (442 tests / 20 files, tsc clean, TUI load ok, docs
freshness ok, spec-check ok 41/442); coordinator submit; merged-result gate at `merge-next`; fresh `bun run
check` at dev HEAD; scratch restore proof (see the iteration-2 report) byte-identical with safety backup.

## Workstream BB — live-proof bug fix: restore candidate chronology (goal iteration 2 follow-up)

The iteration-2 live proof (fresh scratch XDG_CONFIG_HOME, pre-install config, drift, uninstall) showed the
byte-identical restore working, but the final no-op step did NOT no-op. Item 174's rule picks the NEWEST
plugin-free backup as the restore candidate; a safety backup taken during an earlier restore is plugin-free
too, so the re-run restored the drifted bytes over the correctly-restored pre-install config (exit 0, still
wrong). Item 174's candidate rule is superseded by this section; the rest stands.

182. **Root cause (two coupled defects).** (a) `preInstallBackup` scanned backups newest-first, so the newest
     plugin-free backup — any safety copy of drifted state — shadowed the older install-time original.
     (b) `listBackups` sorted names lexically; a collision-suffixed backup (`…Z-2.bak`, created after the
     plain `…Z.bak` of the same second) sorts BEFORE the plain one, so its "newest" was not even
     creation-order under same-second backups (which is how unit tests run).
183. **Fix.** `listBackups` now sorts chronologically (`<ts>`, then collision index, absent = 0).
     `preInstallBackup` picks the OLDEST backup whose parsed content provably lacks the plugin (first in
     chronological order). Repeated runs converge: once the config equals the oldest plugin-free backup,
     helpers short-circuit to `not installed` (exit 0) and never rewrite it. Oldest-first also means a restore
     restores the FIRST install-time original; the fresh safety backup (taken before any overwrite) preserves
     the drifted state, so no bytes are ever lost silently. `--restore` and the `note:` hint use the same
     chronological order (newest = last). Failing-before evidence: new describe block (4 tests); the new
     "newer plugin-free backup does not shadow the older pre-install original" test FAILED pre-fix (byte
     mismatch); the others pin behavior through the collision-suffix and plugin-containing-backup edges.
     After the fix: 36/36 in the file, 446 total.
184. **Marker** bumped `files=41 tests=442` → `files=41 tests=446` (+4 tests, no new files). Docs: the
     README and `docs/install.html` restore rule now names the oldest-plugin-free candidate.

Files touched: `bin/opencode-goal.mjs`, `test/cli-installer.test.ts`, `SPEC.md`, `README.md`,
`docs/install.html`.

Verification: full suite green (446); fresh live proof in /tmp/opencode/restore-fix-proof.* (install → drift →
uninstall restores byte-identical pre-install config → safety backup holds drifted bytes → uninstall again is a
clean `not installed` no-op, file unchanged, exit 0) using the FIXED global-bin install from this tree.

## Workstream BC — e2e proof at dev HEAD 39464c1 (`bun run e2e`, 2026-11-15)

Fresh empty project (/tmp/opencode/e2e-empty), `bun run e2e /tmp/opencode/e2e-empty` against dev HEAD with the repo as a local plugin
(`.opencode/opencode.json` → `{ "plugins": [<repo root>] }`) and default model `opencode/deepseek-v4.1-flash-free`.
Raw log: /tmp/opencode/e2e-empty-output.log.

185. Result: exit 0. Server up on 127.0.0.1:4772; `session ses_e1e6a5c99ffemfYwLxAnDgH1v7`; plugin `/goal` command registered within ~1s (`goal command registered: true`); `/goal` sent with the default tea-notes condition. One turn executed (tool calls: mkdir+cat plan.md/done.txt, verification cat, wc/od checks), `session.execution.succeeded`, NOTICE `[success] Goal achieved in 1 turn`, `history: ["1:met"]`. Spend: cost 0, input 13791, output 458, reasoning 145, cacheRead 50816. Evaluator digest rendered (1977 chars) and shown to end of episode; files confirmed on disk: `notes/plan.md` = three numbered tea steps, `notes/done.txt` = `DONE`.
186. Honest caveats, so the next run does not misread them as failures: (a) `client.plugin.list({ location })` returned `{"location":{...},"data":[]}` on the private standalone server — the plugin *is* loaded (slash command registered and the loop ran); the list endpoint reports empty on this build. Known cosmetic quirk. (b) The e2e requires network + an authenticated opencode provider for the default model; if it 200s but the model cannot run, the goal would stall and TIMEOUT_MS would be hit — exit 1, not a code failure. (c) The plugin entry in the scratch project points at the repo working tree, not the npm tarball; the packed-artifact proof remains the scratch TUI/restore proofs above.

Marker unchanged (files=41 tests=451 — no shipped files, no tests added).

## Workstream BD — packed artifact proven end-to-end (fresh npm prefix + scratch XDG_CONFIG_HOME, dev HEAD ba9c739)

`npm pack --pack-destination /tmp/opencode` at dev HEAD ba9c739 (41 files, opencode-goalv2-1.1.0.tgz). Layers verified independently with /tmp/opencode/v4-* scratch dirs (PREFIX=/tmp/opencode/v4-prefix).

187. **tarball → prefix install (CLI layer).** `npm i -g --prefix /tmp/opencode/v4-prefix ./opencode-goalv2-1.1.0.tgz` → added 1 package; `opencode-goal --version` → 1.1.0;
     `opencode-goal status` works (reads the real global config, exits 0, `not installed`). Restore flow on a scratch XDG_CONFIG_HOME with a pre-install drifted config (comments, edited unrelated key): `install` writes `"plugins": ["opencode-goalv2"]` with an `.bak`; drift; `uninstall` restores **byte-identical** (`diff` IDENTICAL),
     safety `.bak` (`Z-2.bak`) holds the drifted bytes; re-run → `not installed … config already matches the pre-install backup`, exit 0, still IDENTICAL.
188. **TUI layer (install → /plugins → uninstall → gone).** Fresh scratch XDG_CONFIG_HOME (v4-tui.yB4fhL) with an empty project: `/plugins` before install was not run; after `opencode-goal install` the standalone TUI (tmux, `opencode --standalone`) shows `opencode-goal.tui` (TUI) and `opencode-goal 1.1.0` (Server). Package resolution used a hand-seeded opencode npm cache (`~/.cache/opencode/npm/opencode-goalv2@latest/<ts>`, integrity = sha512 of THIS tarball) because the registry has no `opencode-goalv2` yet (`npm whoami` = ENEEDAUTH; user publishes). `opencode-goal uninstall` → config file (created by install) deleted, exit 0; second `uninstall` → `not installed`, note about `--restore`, exit 0; relaunched TUI shows `No items available`.
189. **e2e layer (packed artifact, not the repo checkout).** `E2E_PLUGIN=/tmp/opencode/packed-pkg/package bun run e2e /tmp/opencode/e2e-v4` — full loop with the extracted tarball as the plugin: server up 127.0.0.1:4718, `goal command registered: true`, `/goal` sent (tea-notes condition), 1 turn (write plan.md/done.txt, cat + wc/od verification), `session.execution.succeeded`, NOTICE `[success] Goal achieved in 1 turn`, `history: ["1:met"]`, spend cost 0 (in 13460 / out 325 / cacheRead 25216), digest 1561 chars, both files confirmed on disk. Exit 0. Caveats carried from BC (plugin.list `data: []` quirk on the private server; network + authenticated provider required; loaded from the packed path here, so the pack bytes are what ran).
190. **Marker unchanged** (files=41 tests=451) — verification-only workstream.

Layers compared: repo checkout (Workstream BC, e2e passed) ≟ packed tarball (this workstream, e2e passed) ≟ hand-seeded npm cache TUI path (rename BA proof) — all three load the same code; differences are resolution mechanics only, called out honestly.

## Workstream BE — GitHub install route proven end-to-end (fresh scratch XDG_CONFIG_HOME/XDG_CACHE_HOME, 2026-11-15)

Followed docs/install.html exactly in scratch (dirs /tmp/opencode/gh-route1.oiRPqZ for route 1, gh-proof.h5XQsN for route 2; never the user's real ~/.config/opencode). Release `v1.1.0` exists on github.com/paumkim/opencode-goalv2 (asset opencode-goalv2-1.1.0.tgz, 109518 bytes, sha256 34583d...); tag `v1.1.0` = `aff3a49`. Raw logs: /tmp/opencode/e2e-gh-output.log, terminal captures above.

191. **Route 1 — `opencode plugin add github:paumkim/opencode-goalv2#v1.1.0`:** exit 0; wrote `plugins: ["github:paumkim/opencode-goalv2#v1.1.0"]` to the scratch global `opencode.json`; opencode fetched the tag into the scratch cache (`git-opencode-goalv2-167a66a78541`). Standalone TUI `/plugins` (empty project) lists **TUI: opencode-goal.tui** and **Server: opencode-goal @ aff3a49**. Removal: `opencode plugin remove github:paumkim/opencode-goalv2#v1.1.0` → `plugins: []`, exit 0; re-remove → `not configured`, exit 0; relaunched TUI shows `No items available`. E2E against the git-cached copy (`E2E_PLUGIN=<cache path> bun run e2e`): server up 127.0.0.1:4779, `/goal` registered in ~1s, 1 turn, `session.execution.succeeded`, NOTICE success, `history: ["1:met"]`, spend cost 0 (in 13749 / out 535), both files confirmed on disk, exit 0.
192. **Route 2 — release URL + `opencode-goal install`:** `npm i -g --prefix <scratch> https://github.com/.../opencode-goalv2-1.1.0.tgz` → `opencode-goal 1.1.0`; `opencode-goal install` → created config with `plugins: ["opencode-goalv2"]`. **But** with a fresh scratch XDG_CACHE_HOME the TUI `/plugins` shows **`opencode-goalv2 … failed`** — the bare specifier resolves only from the npm registry (or a pre-seeded cache), and the package is not published yet (`npm whoami` = ENEEDAUTH; user publishes). The docs claimed "No npm account or registry access needed" and "until then use one of the two routes above" — false for route 2's plugin resolution. Docs fixed to match verified reality (README.md, docs/install.html): route 1 documented as the registry-free GitHub route with its `opencode plugin remove` counterpart; route 2 marked registry-dependent until publish; `opencode-goal uninstall` clarified as touching only CLI-installer-added entries.
193. **Marker unchanged** (files=41 tests=451) — docs/SPEC-only workstream, no shipped files or tests changed. Note: tag `v1.1.0` predates the v4-proof bookkeeping (aff3a49); shipped code at the tag is identical to dev for src/, bin/, test/.

## Workstream BF — installer registers the GitHub specifier (2026-11-16)

194. `bin/opencode-goal.mjs` exports `PLUGIN_SPEC = "github:paumkim/opencode-goalv2#v1.1.0"` and writes that into the `plugins` array instead of the bare `"opencode-goalv2"` (Workstream BE route-2 finding: the bare specifier resolved only against npmjs.org and showed as `failed` in `/plugins` on fresh machines). The GitHub release is the distribution channel for this package; the specifier resolves at startup from GitHub (verified end-to-end, Workstream BE route 1 and its e2e).
195. Back-compat: `uninstall` and `status` match both specifiers, so configs installed by the v1.1.0 installer uninstall cleanly. Installer-written configs now assert `PLUGIN_SPEC`; new regression test pins legacy bare-spec uninstall. Also fixes a comment-terminator bug (`-*/` inside the header mechanism comment closed the block comment) caught by `bun test test/cli-installer.test.ts`.
Marker bumped `files=41 tests=451` → `files=41 tests=452`.
