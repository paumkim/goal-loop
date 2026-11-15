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

<!-- spec-check files=35 tests=355 -->

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
    the history sections, plus a 3-cell internal right gutter (matching the `DIALOG_INSET = 3`
    convention). `src/tui.tsx` keeps host orchestration only (host chrome, keymap, RPC, prompt-footer,
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

96. Mid-work deferral (additive dep `AutoCompactorDeps.isBusy?: (sessionID) => Promise<boolean>`, wired in
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
- **A-27 (low) — `src/core/config.ts` — `maxRetries` is dead surface.** Retained "for compatibility", gates nothing, advertised in config
  docs. Proposed fix: keep the key parsing (backward compat) but flag in docs as inert, or remove with a SPEC/docs note; never silently drop.
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
