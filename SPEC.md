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
22. `bun run check` is `tsc --noEmit && bun test && bun run compile && bun run check:tui`, where
    `check:tui` runs `bun scripts/tui-load-check.ts ./tui.ts` (loads `tui.ts` the way the OpenCode host does;
    fails if the default export is not a TUI plugin). `AGENTS.md`, `README.md` and this file state the new
    composition; the `docs/` pages' "Last updated" stamps and `docs/changelog.html` are regenerated with
    `bun scripts/docs-watch.ts once` on this branch.
23. `npm pack --dry-run` still lists exactly the `files` declared in `package.json` (31 files, ~62 kB) with no
    `.github/`, `worktrees/`, `.term/` or log debris in the tarball.

Verification: `bun install --frozen-lockfile`, `bun run check` (expect `ok: loaded TUI plugin "opencode-goal.tui"`),
`npm pack --dry-run`, `git status --short`, then coordinator submit.
