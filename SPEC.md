# SPEC — current behavior of goal-loop

<!-- naming:start -->
**Canonical names.** The product, the package, the plugin and the CLI are `goal-loop`: `package.json` `name`
`goal-loop`, CLI `bin/goal-loop.mjs`, server plugin id `goal-loop`, TUI plugin id `goal-loop.tui`, mirror
`<tmpdir>/goal-loop-mirror`. The host is OpenCode, and the GitHub repository is `paumkim/goal-loop`, so the
install specifier is `github:paumkim/goal-loop#v<version>`.

**Pre-rename names are historical.** Every workstream before LXXVIII names the identity as it then was; that
text is kept verbatim and read through this map: `bin/opencode-goal.mjs` → `bin/goal-loop.mjs`; server plugin id
`opencode-goal` → `goal-loop`; TUI plugin id `opencode-goal.tui` → `goal-loop.tui`; mirror directory
`opencode-goal-mirror` → `goal-loop-mirror`; package `opencode-goalv2` → `goal-loop`; repository slug
`github:paumkim/opencode-goalv2` → `github:paumkim/goal-loop`.

**Legacy names that are still current by design:** the `opencode-goal` bin alias (same executable),
`PLUGIN_PACKAGE = "opencode-goalv2"` (older installers wrote it), configs carrying the pre-rename
`github:paumkim/opencode-goalv2#v…` specifier (`install` migrates the entry, `uninstall` removes it, `status`
reports it), and the `OPENCODE_GOAL_*` environment prefix (the documented configuration surface).
`test/name-fields.test.ts` pins this declaration, the fields, and the code that carries them.
<!-- naming:end -->

Status: current as of v1.2.0. The goal TUI renders natively in three zoom levels. (a) An ambient pill:
a compact segment painted on the empty left side of the host's jump-to-latest row (the 1-row strip directly
above the input prompt, claimed through the host's `session.composer.top` slot with a zero-flow absolute box);
left click toggles the card, right click opens the detail view; when the condition is pinned (card `pin` button
or `p` in the dialog) the pill appends the condition truncated to the remaining width so it stays visible while
the conversation scrolls; a slow breathing dot marks a live, working goal — it swells through `◦ ○ ◎ ○` on a
2.4s cycle while the loop is alive, rests hollow (`◯`) when waiting, bars-static (`‖`) when paused and solid
(`●`) when a stuck-retrying loop is executing nothing, and never runs when reduced motion is requested
(NO_COLOR, TERM=dumb), where the resting face and weight carry the state (see Workstream XII); (b) A compact HUD card: a composer-grammar card painted above the jump row (absolute box, 1-cell left accent border, theme tokens only) with the condition (click
to copy), the state row (live or terminal), the spend row when the server can estimate it (same
`formatSpend` grammar and the same omit-when-unknown contract as the detail view's spend row — tokens in
flow plus outflow plus cost), the last verdict, failure-first-class remediation when the loop is hot or failed,
and — for a freshly armed goal, before the first turn lands — one teaching line (`hint  the evaluator reads
only the transcript`): the evaluator never runs commands or reads files, so the condition must be provable from
the conversation; the row disappears forever after turn 1. The card also answers right-click: anywhere on it
toggles an in-card context menu (six fixed rows, appended below the permanent actions row so the absolute-mount
anchor grows with it — `hudCardRows(goal, contextOpen)`): `copy condition`, `copy evaluator reason` (inert and
faint when the snapshot carries no `reason`), `copy latest summary` (inert when no `loopHistory` entry exists),
`copy dossier` and `save dossier file` (both inert until the record carries a dossier), and `clear goal`
(warning tone). Menu rows share the button hover grammar (raised background, weight under
mono); inert rows never light up and swallow the click; any action collapses the menu; Esc or another
right-click toggles it shut. (c) The `/goal` detail view: a

host dialog (`ui.dialog.show` chrome: backdrop, Esc dismissal, xlarge centered sizing) with wrapped fields, a
clickable condition row, the same remediation block, the same teaching line (`hint  the evaluator reads only the
transcript — it cannot run commands; prove the condition with visible output`) while the goal is fresh, two more
one-click copy affordances (each carries an always-mounted faint `copy` cell that brightens on hover, like the condition row — the text itself never changes on hover): the `evaluator`/`reason` row
copies the raw evaluator text, and an
iteration summary line in the loop rail copies that iteration's full (untruncated) summary — the two texts a user
most wants verbatim when pasting into a follow-up prompt; both are omitted (rendered plain) when the caller does
not wire the callbacks. Copying from inside the dialog acknowledges in place — host toasts do not render above
the modal, so each row (condition, evaluator/reason, summary) flips its always-mounted affordance cell to `✓ copied` for ~1.6s and nothing else on the row changes — the same grammar as the footer's copy button (the host clipboard/OSC52 call still fires; the
host toast, where visible, still fires). Clickable `copy condition` / `pin condition` / `clear
goal` footer buttons (`p` toggles the pin, `c` copies the condition — host toasts do not render above the
modal, so the copy button acknowledges with a transient `✓ copied` label instead). The pin button keeps its
object noun across states at the roomy tier — `pin condition` ↔ `unpin condition` (`footerPinLabel`) — so the
mouse target does not shrink mid-toggle; compact tiers render bare `pin` ↔ `unpin`. The footer degrades in two
steps so it never clips mid-word: above
140 columns the full key hint (`up/down scroll · pgup/pgdn · home/end · p pin · c copy · x older`, sized to the host dialog's real inner width — the centered dialog leaves the hint ~59 cells at a 160-cell terminal (the hint itself is 64 cells, measured), so a longer hint clips mid-word) plus full button labels; above 96 the short hint (`up/down scroll · p pin · c copy · x older`, Esc stays visible in the host dialog chrome) with full labels; below that, compact button labels
(`copy` / `pin` / `clear`) — the 80-column
floor always fits. No tier repeats the Esc chord: it stays in the host dialog chrome, and the full hint documents
the plugin chords (`p pin · c copy · x older`) the short hint does, plus paging. The same env guard governs color as motion: under `NO_COLOR` (or `TERM=dumb`) every
chromatic accent is dropped from the plugin's own surfaces — the pill, card, dialog and history render with
neutral tokens only, hover becomes weight instead of a background fill, and status words, verdict
glyphs (✓ / ⊘ / ○) and weight (bold) carry all meaning; meaning never depended on color alone. The host's
own chrome is out of scope (opencode renders full color regardless of `NO_COLOR`). The dialog's state word carries the same accents as the HUD card in terminal states so the
header never reads muted-gray on an outcome: `achieved` in feedback.info, `impossible` / `paused` in
feedback.warning, `failed` in feedback.error (falling back to warning where the theme has no error token). The dialog renders a `context` row when the server can estimate the
prompt size: a 16-cell bar against the configured auto-compact threshold (`compactAtTokens`; the row shows the
bare `~N tokens` estimate when the threshold is disabled or unavailable), `~N of M · P%` where P is unclamped —
the warning tone at ≥80% of the threshold, so the dial the boundary compaction reads is visible before the
loop runs hot. The estimate rides only the `get` RPC (like `spend`); `changed` event snapshots carry the last
known value forward (`preserveCarriedFields` in `src/core/entries.ts`) instead of flickering the row to unknown — the same carry-forward covers `spend`, so the card's spend row and the dialog's `spend` row no longer vanish on every background `changed` event; spend is cumulative-since-baseline and monotone within a goal run, so the carried figure is a lower bound, never a lie, and a pending→landed `loopCompact.landedAt` flip invalidates only the context total, never spend. The final-spend re-save at `finish` (`src/runtime/controller.ts`) emits one extra `changed` snapshot carrying the settled spend vs baseline: terminal goals are never re-pulled by the TUI's stale-chrome guard, so that event is the only push an open card/dialog gets with the settled figure. An amber shimmer marks
the ambient pill while a boundary compaction request is running hot (≥2 misses) in addition to its amber tone —
a bold flip on a slow tick, never while idle, and off entirely under reduced motion. Every hard cap on rendered text (the pill's appended condition, the card's 42-cell condition, rail summaries, history lines) truncates by terminal cells between graphemes — CJK costs 2 cells, an emoji 2, a combining mark 0 — never by code unit, so a boundary never leaks half an emoji or splits a flag; the ellipsis always fits the budget and never leaves a dangling space. The same first-class
treatment covers a goal whose turns all keep failing: `retries` (automatic turns retried since the last success)
reaching 3 swaps the ambient pill's state word `active` → `stuck` and appends `· retry N` in the same amber
warning family; the HUD card mirrors it (the `now` row reads `stuck` in amber and the card border joins the
amber family, exactly like a hot compaction), and the `fix` row names
the exact exits (`check provider quota or settings · else /goal clear`) on the card and in the dialog — a
stuck-retrying goal outranks a hot compaction in the remediation order, because nothing executes at all.
A paused goal is the same class of screen: the record carries a machine-readable `pauseCause` (`cap` /
`stall` / `user`, set at the pause site, cleared on resume and on finish; records persisted before the
field existed restore without it), and the `fix` row names the exact exit — `turn cap reached · /goal
clear or set a new goal — a message will not extend it` at the turn cap, `no tool use for N turns · send
a message to resume, or /goal clear` for the stall guard, `interrupted · send a message to resume` for a
user abort; legacy paused records without a cause fall back to `paused · send a message to resume, or
/goal clear`. A failed goal gets the same treatment: the record carries the classifier's short `failureLabel` (set only at the fatal-failure site, additive and absent on legacy records), and the `fix` row names the cause — `authentication failure — /goal clear to reset` — instead of a bare state word; legacy failed records fall back to `goal failed — /goal clear to reset`. A paused goal outranks a stuck retry loop in the remediation order. When a goal goes live→terminal (achieved / impossible / failed, never
`cleared`) the pill would otherwise blink out; instead it acknowledges the outcome for 45s
(`● goal achieved · 12m · 4 turns`, or `● loop complete · v5/5 · …` for loops), holding the same click
wiring (left click card, right click dialog) and the card renders the terminal state truthfully (state word,
title row and remediation row all reflect the outcome). `cleared` stays silent — a deliberate reset is not
an announcement. State transitions also surface as host toasts; outcome toasts
(`achieved` / `impossible` / `failed` / `Loop complete`) open with the story — turns, wall time, and
completed iterations for loops (`34 turns · 12m 05s · 4 iterations · <reason>`). The
exceptions to "host-owned layout" are the two absolute boxes (pill, card) of the slot claim; toasts, dialog
chrome and sizing stay the host's.
Hovered chrome never changes. Every click-to-copy/clickable row the plugin paints — the HUD card's
condition and why rows, the dialog's condition/evaluator/verify/dossier/save/sweep rows, the dossier's
elsewhere and fold rows, and the history rail's summary/attestation/tally rows — carries an always-mounted
affordance cell (idle faint, fixed width; brightens on hover, weight under mono). Hovering never mounts,
unmounts or resizes anything, and no text on a hovered row changes attributes, so nothing rewraps, nothing
reflows and rows never flicker under the mouse; a click flips the cell to `✓ copied` for ~1.6s and nothing
else changes. Buttons and context-menu rows keep the composer's raised-background hover grammar (weight
under mono) — they are controls, not text rows.

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
    `impossible` verdict ends the loop as today; zero-tool-call iterations are recorded (`loopNotProgress`)
    and never pause an armed loop (one notice, it keeps running; corrected 2026-11-18, Workstream XXXIX);
    the summary/generation token budget is capped by
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
    zero-tool iterations are recorded and never pause an armed loop (corrected 2026-11-18, Workstream XXXIX); restore keeps loop state; store round-trips loop
    fields; prompt builders carry the contract.

## Out of scope

- New features beyond the behavior specified here. Any behavior change updates this file in the same commit.
- Per-iteration met toasts are info-level by default; if they prove noisy in the smoke run, suppress
  after N iterations in a follow-up (not silently changed).

## Verification

- `bun run check` — tsc, unit tests, compile (order: tsc first).
- Manual: `opencode plugin add github:paumkim/opencode-goalv2#v1.1.0` (specifier updated at the BA rename; the `@el4cteo/opencode-goal` form predates it), then `/goal bun test passes` in a scratch repo and
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
    `coordinatorFlow` `:65`, `commitStatusSuffix` `:83`, `rubric` `:312`, `facts` `:337`,
    `git.ts:146`; `docs/index.html`: steer refs `controller.ts:1134`, `prompts.ts:208`). References were
    re-synced against HEAD twice on 2026-11-16 (`docs/config.html`, `docs/architecture.html`,
    `docs/index.html`, `docs/core.html`, `docs/runtime.html`, `docs/install.html`): first for the
    line-ref sync pass, then after the loop re-arm guard landed `tokensOf`/`isNearDuplicate` near
    `CONTINUE_RETRY_MS` and the gate in the loop-advance path and shifted every later anchor (controller
    +16, after the loop-advance insertion +29 in total; prompts +6/+5/+2). The 2026-11-15 values
    (64/82/263/288, controller.ts line 461 at the time) are superseded and recorded in git history. The 2026-11-18 sync moved the steer anchor one line down (the `stripReasoningControl` import added at the top of prompts.ts shifted every later line by one); the same-day Workstream LXVI fix moved it one more (1121 to 1122), and Workstream LXVII's controller edits moved it to 1134. Note the caveat, discovered the hard way: `docs:check` verifies only page
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
    factors its restore body into `adoptRestored` (used by the bulk `restore()` only), which adopts one
    live record from storage with the same reset semantics (fresh `startedAt`/`turns`/`stall`/`retries`/
    `checkins`, fresh baseline, in-memory record created). Adoption normalizes in memory only — since
    Workstream HH it performs no durable write. For RPC reads the controller serves a read-only peek
    instead: `peekSnapshot(sessionID)` serves the in-memory record when present, otherwise reads
    storage fresh (terminal records included) and returns null for missing or foreign-directory records;
    `peekList()` merges stored live records with in-memory ones (the in-memory copy wins per sessionID).
    The peek never adopts and never writes.
39. The RPC handlers answer from the peek: `goal.get` spends then `peekSnapshot`, `goal.list` calls
    `peekList` — no adoption, no storage write. A live goal is never reported as missing while a live
    record exists in plugin storage or in memory; see Workstream HH.
40. Tests prove it: `test/store.test.ts` "GoalStore.load" (missing/malformed/valid),
    `test/loop.test.ts` "RPC read-through after a reload" (peekSnapshot serves a stored live record
    with an empty map without adopting it; terminal records serve as stored truth; missing/foreign
    records yield null; peekList serves stored live records and omits terminal ones; `restore()` keeps
    its bulk-adopt semantics). All 214 tests pass.

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
    `get` performs the storage peek (`peekSnapshot`) inside its own guarded path, and a failure
    there or inside `peekSnapshot`/`spend` still yields `goal: null`, never an exception.
42. Malformed or missing inputs never throw: `undefined`, `null`, `{}`, empty/non-string `sessionID`
    all return `{ goal: null }` at the handler layer. Two layers reject before the handler ever runs,
    both verified live on 2026-11-15: the RPC schema (`sessionInput`, `additionalProperties: false`)
    answers `rpc.invalid_input` (`Missing key at ["sessionID"]`, `Expected string`, `Expected object`,
    `Expected never` for extra props) and a non-JSON body answers `InvalidRequestError` — all
    structured 400s, never a 500. `test/rpc-handlers.test.ts` proves the handler layer plus
    double-failure paths (spend throws AND peekSnapshot throws; peekList explodes;
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

<!-- spec-check files=69 tests=1905 -->

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
    (`onToolCalled`), never from model self-report; consecutive zero-tool iterations are recorded
    (`loopNotProgress`) and never pause an armed loop. Regression test: a loop whose evaluator claims heavy work with zero harness tool
    calls keeps arming (zero-tool iterations never pause an armed loop; corrected 2026-11-18, Workstream XXXIX), and both loop-history entries record `toolCalls: 0`.
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
    on a `│`-prefixed line in `text.faint`, indented under the rail. The rail row and the final tally row
    word-wrap instead of clipping, so the trailing segments (verdict mix, `ended …`, `% of wall`) stay
    visible at the 80-column floor. Theme tokens only; no borders, no
    hardcoded RGBA, no absolute positioning. Progressive disclosure caps the rail at the last 4 completed
    iterations: older ones fold behind one faint clickable row (`… N older iteration(s) — click to show`,
    underlined on hover in the shared copy-target grammar, indices remapped so durations/verdict-mix/wall
    shares stay exact); clicking it expands the full rail and flips the row to `show recent only`. At 4 or
    fewer completed iterations the fold row never renders.
53. A progress bar sits above the rail: `█` filled (feedback.info.base) vs `░` empty (text.faint),
    fixed 18 cells, filled = round(completed / loopMaxLoops × 18), clamped to [0, 18]; caption
    `v<current> of at most <max> · <done> complete`. When `loopMaxLoops` is absent the bar renders
    all-empty with caption `v<current> · <done> complete` and never divides by zero.
54. A "now" row closes the rail for the running iteration: `◎ v<current> · <state> · <turns> turns ·
    <elapsed>` (elapsed extrapolated live by the dialog as today) in feedback.info when active /
    text.warning when paused. Rendered as the rail's last row; when the history is empty (a loop that
    has not completed v1 yet) it stands alone — just the bar, objective and now row render, no rail rows.
55. The evaluator verdict trail renders below the rail from `GoalSnapshot.history`: up to the last 20
    verdicts (the retention cap `MAX_VERDICT_HISTORY_ENTRIES`, applied in Workstream XXXVI; the render window
    constant in `trailWindow` is 24 and never binds), one glyph each — `✓` met (feedback.info.base), `✗` not_met (text.faint), `⊘` impossible
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
    ACTIVE record, so a plugin restart also resumes from a fresh context. [SUPERSEDED 2026-11-17 by the
    adopt-only fix: `restore()` never requests a host compaction — see src/runtime/controller.ts `restore()`
    and docs/runtime.html; compaction is strictly per session on the threshold and arm-time paths.]
    `opencode` itself auto-compacts
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
    [SUPERSEDED 2026-11-17 by the adopt-only fix: `restore()` is adopt-only and requests nothing — the
    per-session threshold and arm-time paths are the only compaction triggers; see docs/runtime.html.]
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
    adopted ACTIVE records that the boundary compaction was re-requested for. [SUPERSEDED 2026-11-17:
    restore re-requests nothing; see item 95's note and docs/runtime.html.] Landing detection (i) — the
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
    slice as the other loop prompts. [Superseded in part 2026-11-18 by Workstream LVIII: the re-anchor injects the newest 3 (`REANCHOR_HISTORY_INJECT_LIMIT`), not the shared 10-entry slice, and prints `(N older completed iterations omitted — the bounded ledger rides the record)` when history exceeds the window. Annotated in place, never rewritten.]
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

[SUPERSEDED 2026-11-17 by Workstream BV (items 227-228): the 4-miss cap is only a backstop. At 2 misses one
host-unwilling warning fires; re-requests continue as a trickle every 3rd arm. The permanent suspension
described in items 118-121 was never the shipped contract, and the `"capped"` `BoundaryCompactMiss` member
was removed with this annotation.]

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

- **A-1 (high) — `src/runtime/controller.ts` line 197 & line 881 (at audit time) — compaction misses are double-counted.** A no-op compaction reported via
  `session.compaction.ended` increments `loopCompact.misses` (the ended-event path), and the next armed iteration's settle increments the
  same pending request again (the arm path), so one physical unlanded compaction consumes two of the four misses and forces the re-request
  and the "Compaction pending" notice an iteration early. Proposed fix: single-source miss accounting — the arm-time settle must not count a
  pending request whose ended-event path already counted it (mark the pending with the count time/flag), or drop the ended-event increment
  and let arms count alone. Decide in the fix workstream and pin with a test: one no-op ended event + one arm = misses exactly 1.
  Resolution: Workstream AC — single-source accounting via the `missesCountedAtEvent` one-shot flag; pin test added (fails pre-fix, passes post-fix).
- **A-2 (medium) — `src/runtime/controller.ts:1965` — planner-armed conditions bypass the configured length limit.**
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

- **A-8 (medium) — `src/runtime/controller.ts` line 253 (at audit time) — `set()` does not await the initial `commit(record)`.** A crash immediately after
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
  Resolution: Workstream XXXV — `loopHistory` is bounded (`MAX_LOOP_HISTORY_ENTRIES = 50`, drops counted on `loopHistoryDropped`); the
  persisted record and every snapshot clone are now O(bounded). This finding's "waive" stand was superseded when the cap landed.
- **A-13 (low) — `src/core/types.ts:355` — stale comment: "Consecutive iterations with zero tool calls; two pause the loop."** Armed
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
  verdicts, quadratic in loop lifetime as history grows. Waive (folds into A-12 if history is ever capped; both caps landed — XXXV
  `loopHistory` 50, XXXVI verdict trail 20 — so the record size, and this comparison, is bounded).
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
A-28 (folds into A-12; fold-in condition resolved — XXXV/XXXVI caps), A-29 (heuristic by design), A-30 (verified correct).
A-12 was waived here in the Phase-1 wave but the waiver was superseded when Workstream XXXV bounded `loopHistory`; see A-12's resolution above.

### Restore-vs-arm lease grid (Phase 1 item 2)

`restore()` fans out a boundary compaction for every active record (A-4), and the armed loop's settle re-checks the same pending marker at
every arm — the two never stack because `loopCompact.landedAt`/`misses` persist on the record; restore skips a pending request and a landing
newer than 10 minutes. The double-count (A-1) is the one real defect in this grid. `adoptRestored` is re-entrant-safe (`goals.has` short-circuit) and is reached only from the bulk `restore()` now — RPC reads peek and never adopt. A concurrent `adoptRestored` pair can both pass the `has` check and both adopt the same record — benign (in-memory normalization only since Workstream HH; idempotent) — noted, not fixed.

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
A-29, A-30. (A-12's waiver was later superseded — Workstream XXXV bounded `loopHistory`; A-28's fold-in resolved the
same way. Recorded here so this summary stays honest about what actually ships.) Every fix shipped with a test that failed before the fix (pin tests; pre-fix failure verified by
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
     (`evaluate` not_met path, `evaluationFailed`, `handleFailure`, `checkin`, `onUserPrompt`,
     `restore()`'s boundary fan-out, the final-spend re-save in `finish()`) became an unhandled rejection, and the `lastCommit`
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

## Workstream BG — status stamp refreshed and boundary-compaction constants pinned (2026-11-15)

196. The live status line (line 3) said "current as of v1.0.1 (plus the two workstreams specified below)" though package.json is 1.1.0 and the file holds workstreams A–BF; it now reads "current as of v1.1.0". The stale "two workstreams" phrasing in the out-of-scope section was reworded to match. No behavior change.
197. New test/constants.test.ts pins the exact values of the boundary-compaction magic numbers in `src/core/constants.ts` (`BOUNDARY_MIN_TOKENS=10_000`, `BOUNDARY_DROP_FACTOR=0.6`, `COMPACT_COOLDOWN_MS=120_000`, `BOUNDARY_LANDING_GRACE_MS=600_000`) and the relationships the controller and compactor rely on (drop factor is a proper fraction; landing grace outlasts the request cooldown; minimum size is a positive integer). Previously the file had no direct test and only indirect coverage through the compactor/loop suites.
Marker bumped `files=41 tests=452` → `files=41 tests=456` (test-only addition; no shipped file changed).
Known deferred: docs/config.html and docs/architecture.html contain line-reference drift (source line numbers no longer accurate); fixing is deferred because a live coordinator lease (github-single-channel) holds `docs`. Fix on its release or successor lease. [Superseded 2026-11-18 by Workstream XLVI: both pages were re-anchored to `file · symbol` citations in the 2026-11-17 docs sweep; a full re-scan for `file.ts:N` in docs/*.html now returns zero matches, all cited source paths resolve on disk, and `test/docs-line-refs.test.ts` pins both invariants. The named lease is dead per the 2026-11-17 survey (`coordinator doctor` fails on it).]

## Workstream BH — headless render unit tests for the dialog components (2026-11-15)

198. `src/status-dialog.tsx` (StatusDialogBody) and `src/tui-history.tsx` (LoopSection, HistoryBlock, VerdictTrail) now have unit tests in `test/tui-render.test.tsx` (8 tests). They mount the components in @opentui/solid's `testRender` and assert on the captured character grid: loop caption/bar/objective/rail/now-row/trail, the final-tally row on a finished loop, paused stall/retries diagnostics, non-looped last-verdict/counts/trail, the fresh-goal "no verdicts yet" line, the fallback text for an undefined snapshot, and the StatusDialogBody looped-vs-non-looped branch selection (evaluator vs reason label, LoopSection vs HistoryBlock). Previously these components were only manually render-verified via `scripts/render-dialog.tsx` / `scripts/render-history.tsx`, which are not wired into `bun run check`.
199. `test/bunfig.toml` scopes `[test] preload = ["@opentui/solid/preload"]` to the test directory — the same solid-js server→client build remap the render scripts use. Load-bearing: without it the render tests fail at import (verified by removing the file and re-running). No other test file imports solid-js, so the rest of the suite is unaffected.
Marker bumped `files=41 tests=456` → `files=41 tests=464` (test-only addition; no shipped file changed).

## Workstream BI — PLUGIN_SPEC pinned to package.json version (2026-11-15)

200. `bin/opencode-goal.mjs` exports `PLUGIN_SPEC = "github:paumkim/opencode-goalv2#v<version>"`; it previously had no test tying it to `package.json`, so a version bump that missed the constant would ship an installer pointing at a stale tag with no gate to catch it. New regression test in `test/cli-installer.test.ts` asserts `PLUGIN_SPEC` equals `github:paumkim/opencode-goalv2#v` + `pkg.version`, where `pkg` is read from `package.json` at test time (and asserts the version looks like semver). Mutation-verified: forcing `PLUGIN_SPEC` to `#v9.9.9` makes the test fail; reverting makes it pass.
201. `package.json` version is 1.1.0 and `PLUGIN_SPEC` currently reads `#v1.1.0`, so no behavior change in this workstream — the gate is new, the value is unchanged.
Marker bumped `files=41 tests=464` → `files=41 tests=465` (test-only addition; no shipped file changed).

## Workstream BJ — headless render edge-path tests for the dialog components (2026-11-15)

202. `test/tui-render.test.tsx` grows from 8 to 27 tests covering the previously unrendered branches of `src/tui-history.tsx` and `src/status-dialog.tsx`: the fresh loop with no verdicts (no trail row, `v1 of at most 5 · 0 complete`, no pace row), the uncapped loop (no `of at most` caption, no pace row), trail-window truncation past 24 verdicts (`24 of 30 verdicts` caption), rail-summary truncation past the 400-char cap (ellipsis, full text absent), blank rail summaries rendering no `│` connector, the current-iteration `last` suffix (`this turn` and `N turns since`), the two-in-a-row streak suffix in the now row, the final-tally row appearing when the cap is reached with a non-terminal status, the `⊘`/`✗` final glyphs for `impossible`/`cleared`/`failed` loops, the pending boundary-compaction row (age, `miss 2/4`, `~182k at request`), the landed compaction row (no miss counter), impossible verdicts in the non-looped counts line, the non-looped streak suffix, the `checking`/`waiting` state words in the dialog body, and the spend row omitted when no spend snapshot is present. The uncapped-loop and spend-absent tests destructure the field out rather than pass an explicit `undefined` (exactOptionalPropertyTypes-safe).
203. No source behavior changed; the work is test-only. One honest caveat: these remain character-grid render assertions — they pin what is painted, not interaction (keypresses) behavior.
Marker bumped `files=41 tests=465` → `files=41 tests=484` (test-only addition; no shipped file changed).

## Workstream BK — smoke tests for the standalone render scripts (2026-11-15)

204. New `test/render-scripts.test.ts` (4 tests) spawns `scripts/render-dialog.tsx` (default and `--buggy`) and `scripts/render-history.tsx` (default and `--empty`) exactly the way their header comments invoke them — `bun --preload @opentui/solid/preload scripts/<name>.tsx [flags]`, cwd = repo root — and asserts exit 0, the expected frame header(s) on stdout, and more than 200 non-whitespace characters (100 for the single-frame `--empty` mode) as a proxy for "the grid actually painted". Previously the scripts were verified only by manual invocation; a flag rename or a broken import would have rotted them silently outside `bun run check`. The smoke test imports no Solid code itself, so the suite's preload scoping is unaffected.
205. No source behavior changed; the work is test-only. The subprocess assertions pin the scripts' contract (exit 0, non-empty grid, frame markers) rather than their visual output, which the 27-case `tui-render.test.tsx` suite already covers via component-level assertions.
Marker bumped `files=41 tests=484` → `files=41 tests=488` (test-only addition; no shipped file changed).

## Workstream BL — unit tests for the spec-check gate itself (2026-11-15)

206. `scripts/spec-check.ts` now exports the pure helpers behind its gate — `parseMarker` (strict-order marker extraction; flexible whitespace now tolerated), `diagnose` (claimed-vs-actual mismatch diagnosis, empty on pass; carried-through probe errors listed verbatim and first; a red `bun test` is always a failure), `formatFailures`, `formatOk`, and the `NO_MARKER_ERROR`/`BUN_RED_ERROR` strings. The I/O moved into `main()`, which runs only under `import.meta.main`, so importing the module in the suite has no side effects (no npm/bun subprocesses). Gate semantics preserved: unparseable reporter output with a green run still reports `-1 passing tests` as a failure; a `bun test` exit ≠ 0 is always a failure; the npm probe failure path still reports only the probe error line.
207. New `test/spec-check.test.ts` (17 tests) pins those helpers: marker parsing (mid-document, whitespace variants, absent/malformed/wrong-order/duplicate markers), diagnosis (pass, files/tests mismatch messages byte-exact, both at once, probe-error passthrough order, red suite, unparseable reporter, unparseable npm output as mismatch), and the report formatters. Previously the gate was itself untested — its marker regex or mismatch messages could drift without a single test noticing.
One deliberate, documented spec widening: the marker regex now tolerates flexible whitespace between tokens (`<!--\s*spec-check\s+files=…`); the canonical marker SPEC writes is unchanged.
Marker bumped `files=41 tests=488` → `files=41 tests=505` (test-only addition; the gate script is not shipped in the tarball, so `files` is unchanged).

## Workstream BM — unit tests for the docs freshness gate itself (2026-11-16)

208. `scripts/docs-watch.ts` now exports its pure machinery: `esc`, `parseChangelogLog` (`%cd\t%s` git-log lines into rows; subjects may contain tabs), `sortRows` (newest-first, non-mutating), `renderRows` (escaped `<tr>` table body), `extractStamp`, `stampVerdict` (per-page verdict: missing stamp or trailing stamp), `sliceChangelogRows` (trimmed section between the changes markers; undefined when a marker is missing or inverted), `changelogVerdict`, `formatFailures`, and the `CHANGE_START`/`CHANGE_END` markers. The I/O stays in the gate entry points, which call the same helpers as before, so the committed-page output is byte-identical. `main()` now runs only under `import.meta.main` — importing the module in the suite has no side effects (no git subprocess, no file rewrites).
209. New `test/docs-watch-helpers.test.ts` (21 tests) pins those helpers: marker escaping (& ordering, no double-escaping), `%cd\t%s` parsing (including tab-containing subjects), row sort/copy semantics, row rendering with HTML escaping, stamp extraction, the three stamp/changelog verdicts (fresh/stale/missing/inverted), and the failure report format. The pre-existing integration suite `test/docs-watch.test.ts` (3 spawn-based tests in a mkdtemp git repo) is unchanged and passes against the refactored script, pinning the byte-identical committed-page behavior. Previously the gate's pure core was untested; a regex or marker edit here could have silently passed stale docs.
Marker bumped `files=41 tests=505` → `files=41 tests=526` (test-only addition; the watcher is not shipped in the tarball, so `files` is unchanged).

## Workstream BN — config defaults pinned to docs (README + config.html) (2026-11-16)

210. New `test/config-defaults.test.ts` (11 tests) pins the option defaults documented in `README.md` and `docs/config.html` to the code. It parses both options tables directly from disk (README `| `option` | default |` rows; config.html `<tr><td><code>option</code>…` rows) and asserts: every `DEFAULTS` key is documented in BOTH tables; every documented value equals the code default (normalized: `` `true```/`false`, numeric strings, `unlimited` → `Number.MAX_SAFE_INTEGER`, `—`/`session model` → undefined, `""` → `""`); both tables document the identical option set; `resolveConfig({}, {})` resolves `DEFAULTS` to itself; `evaluator.mode` documents `auto` while resolving to `session` without a model; `requireCommit` ships `true`/enabled; `model`/`evaluator.model` ship unset; `coordinator` ships `auto`. Mutation-verified: forcing `DEFAULTS.maxLoops` to 6 fails the test; reverting passes.
211. No source behavior changed; the work is test-only. The maps live in the test, so adding an option to either table without a code default (or vice versa) fails loudly by name rather than silently drifting — the exact hazard that left the documented and actual defaults free to diverge (e.g. `verifyCommand`, `coordinator`).
Marker bumped `files=41 tests=526` → `files=41 tests=537` (test-only addition; no shipped file changed).

## Workstream BO — package integrity pinned to the actual tarball (2026-11-16)

212. New `test/package-integrity.test.ts` (7 tests) pins `package.json` to the tarball npm would really publish: every `files` entry exists on disk; every `exports` target exists; `bin/opencode-goal.mjs` exists and carries the executable bit; `npm pack --dry-run --json` lists only shipped-file-on-disk paths, contains `LICENSE`/`README.md`/`package.json`/the entrypoints/`dist/tui.js`/`packages/coordinator/*`, and zero forbidden artefacts (test/, scripts/, .github/, .term/, worktrees/, node_modules/, `*.test.ts[x]`, `opencode.json[c]`); the real `npm pack` file list is byte-identical to the dry-run list; `RELEASE-CHECKLIST.md`/`CHANGELOG*` are absent; and the extracted tarball loads through the exact `bun run check:tui` path (`scripts/tui-load-check.ts <extracted>/package/tui.ts` prints `ok: loaded TUI plugin`). Packs use `--ignore-scripts` (prepublishOnly must not re-run the suite mid-test) and temp dirs inside the repo are removed in `afterEach`.
213. No source behavior changed; the work is test-only. Mutation-verified: adding `"test"` to `files` fails the leak test; reverting passes. This closes the loop on spec-check's tarball coverage — the counts are pinned by spec-check, the contents now pinned here.
Marker bumped `files=41 tests=537` → `files=41 tests=544` (test-only addition; no shipped file changed).

## Workstream BP — docs JSON examples pinned to PLUGIN_SPEC (2026-11-16)

214. New `test/plugin-json.test.ts` (7 tests) pins every JSON example in `README.md` and `docs/install.html` to reality: both files contain a JSON options block, both parse (README fences are paired by a line state machine because closing bare fences are indistinguishable from openings lexically; HTML uses `<pre><code>`/`<code>` with entity unescaping); the README block parses to `{ plugins: [{ package: PLUGIN_SPEC }] }`; every fence/block naming a specifier contains `PLUGIN_SPEC` verbatim; every occurrence of the `github:paumkim/opencode-goalv2#…` specifier anywhere in either file equals `PLUGIN_SPEC` (README ≥2, install.html ≥4); and `PLUGIN_SPEC` equals `github:paumkim/opencode-goalv2#v` + `package.json` version.
215. No source behavior changed; the work is test-only. Mutation-verified: rewriting one specifier occurrence in install.html to `#v9.9.9` fails the specifier-pins test; reverting passes. Docs that instruct the user to paste the example into `opencode.json` now cannot rot silently against the installer.
Marker bumped `files=41 tests=544` → `files=41 tests=551` (test-only addition; no shipped file changed).

## Workstream BQ — docs line references pinned by a test (2026-11-16)

216. New `test/docs-line-refs.test.ts` (5 tests) closes the drift class that recurred across iterations 7-9: every `file.ts[x]:N` and `file.ts[x]:N-M` reference in `docs/*.html` and `SPEC.md` (80 refs at time of writing) is now machine-checked — the cited file must resolve on disk (root-relative, then `src/`/`src/core/`/`src/runtime/` fallbacks for refs written without a directory prefix), the range must be ordered and in bounds, every single-line ref must land on a non-empty line, and every ranged ref must cover at least one non-empty line (Appendix A is frozen to the Phase-1 commit, so it is checked structurally, never on content). Bare `:NNN` fragments without an attached filename are skipped by design. The suite asserts it found >=70 refs so an over-strict regex cannot pass vacuously.
217. Mutation-verified both ways: in `docs/core.html`, rewriting a `config.ts:44` citation to an out-of-range line fails the in-bounds and non-empty tests, and pointing the citation at a path that does not exist (`src/core/nope.ts`) fails the file-exists test; reverting passes. Docs line refs can no longer rot silently against the source tree.
Marker bumped `files=41 tests=551` → `files=41 tests=556` (test-only addition; no shipped file changed).

## Workstream BR — OPENCODE_GOAL_* env surface pinned to the docs (2026-11-16)

218. New `test/env-vars.test.ts` (7 tests) walks src/, README.md and docs/config.html and compares the `OPENCODE_GOAL_[A-Z0-9_]+` token sets in both directions: every variable referenced in src/ is documented in README.md AND docs/config.html, every variable documented in either file is referenced in src/, the two docs carry the identical set, and the set matches the code set exactly. The 13 current variables (12 option overrides read in `src/core/config.ts` + `OPENCODE_GOAL_PROBE` read in `src/index.ts`) are all documented in both files today. Refuses to pass vacuously (asserts src/ references >=10).
219. Mutation-verified both directions: adding `OPENCODE_GOAL_FAKE_VAR` to docs/config.html fails the documented-but-not-read and identical-set tests; renaming the `OPENCODE_GOAL_COMPACT_AT_TOKENS` reads in src/core/config.ts fails the read-but-undocumented and exact-set tests; reverting passes. The documented env list can no longer drift from the code silently.
Marker bumped `files=41 tests=556` → `files=41 tests=563` (test-only addition; no shipped file changed).

## Workstream BS — CI gate pinned by a test (2026-11-16)

220. New `test/ci-workflow.test.ts` (11 tests) pins `.github/workflows/check.yml` — the gate documented in README.md and Workstream D criterion 21 — with structural line-based assertions, no YAML-parser dependency. It asserts: a named workflow exists; `on.push.branches` is exactly `[dev, main]` and `pull_request` is present; the `check` job runs on `ubuntu-latest`; `actions/checkout@v4` precedes `oven-sh/setup-bun@v2`; installation is `bun install --frozen-lockfile`; the gate step is the same `bun run check` as local development; an `npm pack --dry-run` smoke test follows it; the step order is install -> check -> pack; and the file carries no publish secrets (`secrets.*`, `NPM_TOKEN`, `npm publish`, `--access public`, `NODE_AUTH_TOKEN`) and no credentials of any kind (password/token/authorization).
221. Mutation-verified both ways: defrosting the install (`bun install` without `--frozen-lockfile`) fails the frozen-install and step-order tests; injecting an `NPM_TOKEN`/`secrets.` reference fails the no-secrets and no-credentials tests; reverting passes. The documented CI gate can no longer drift from the workflow silently.
Marker bumped `files=41 tests=563` → `files=41 tests=574` (test-only addition; no shipped file changed).

## Workstream BT — loop re-arm guard (2026-11-16)

222. /goal-loop no longer burns iterations on already-completed work. Three surfaces changed: the planner prompt (NEXT_GOAL_ASK) now requires the proposed condition's work be ABSENT at HEAD (else LOOP_COMPLETE); the arming synthetic prompt (loopContinuation) requires enumerating the condition's requirements and auditing them against current HEAD with fresh output this turn, and if all hold, reporting "Already satisfied at HEAD <sha>. No new work is produced by this iteration." without redoing; the evaluator rubric states a condition already satisfied at HEAD before the turn began is met with that exact wording in the reason. Deterministic gate: after the existing exact (normalized) repeat check in the loop advance path, a near-duplicate proposal — token containment >= 0.7 or Jaccard >= 0.6 against the objective, the current condition, or any completed history entry — ends the loop cleanly as achieved with reason matching /already-completed/i, before arming.
223. The near-duplicate gate is tested end-to-end: near-duplicate proposals end the loop cleanly with a Loop complete notice and no further arming steer; genuinely new proposals still arm the next iteration; the three prompt surfaces pin the new audit wording. Marker bumped files=41 tests=574 → files=41 tests=579.

## Workstream BU — dev hardening, no release (2026-11-16)

224. The audit fixes land on dev while the live release stays v1.1.0 (maintainer decision 2026-11-16: version bump only after a major milestone; work continues locally). PLUGIN_SPEC is now derived from package.json at load time (installer, skeleton, and tests agree by construction; previously the bin hard-coded the v1.1.0 specifier, so a future release cut without touching the bin would have pinned a stale tag). The --restore command now copies the install-time original (the OLDEST backup whose parsed content provably lacks the plugin) instead of the newest backup overall (which could re-add the plugin), matching the documented header contract and the missing-entry auto-restore path; a one-line error and exit 1 when no plugin-free backup exists. Config writes are atomic (temp file plus rename, same directory) so a crash mid-write cannot leave a truncated config. CI gained a dist-in-sync gate (compile, then git diff --exit-code -- dist/). The root opencode.json (machine-absolute path, forced coordinator) is no longer tracked — opencode.json.example carries the template and opencode.json is gitignored; .gitignore also covers the test/pkg temp dirs.
225. README and docs/install.html keep the v1.1.0 install-route literals (they describe the shipped artifact and are pinned to package.json by test/plugin-json.test.ts), with the installer notes clarifying that the source tree now derives its specifier from package.json; the --restore documentation now describes the fixed contract (pre-install backup back over the config, fresh safety backup first). One new test pins the --restore convergence contract: the drifted newest plugin-free backup must never beat the install-time original. Marker bumped files=41 tests=579 → files=41 tests=580. No shipped-file set changes; the tarball stays at 41 files. npm publish remains a maintainer decision (see RELEASE-CHECKLIST.md).

## Workstream BV — compaction landing detection + evaluator hardening (2026-11-16)

226. Compaction landing detection rebuilt around an explicit lifecycle. At every arm — before any other
     bookkeeping — a fresh context estimate is compared against the request-time size recorded on the pending
     request (`LoopCompactState`); a drop of at least 10% (was: only drops of at least 40% counted) lands the
     request: the pending state is cleared to its landed form, misses reset to zero, fresh boundary requests
     are re-enabled, one success notice fires, and a live loop re-anchors. The `session.compaction.ended`
     event is now authoritative: it lands a pending request regardless of what the size estimate says (an
     unestimable or coincidentally large context cannot miss), logs the landing, and queues the re-anchor
     immediately as a `resume: false` queued steer — not only at the next arm. A landed compaction is never
     silent.
227. Unmeasurable is not failed and not landed. Consecutive arms whose context cannot be measured tick
     `unmeasurableTicks` on the request instead of incrementing `misses`. The first unmeasurable arm forces
     one re-request past the cooldown; repeated unmeasurable arms mark the request `staleness unknown` (one
     warning, ever) and re-request at most every 2nd arm — never a full suspension while the armed iteration
     is below maxLoops. A measurable arm with no drop counts a miss as before, but the miss ladder is rebuilt:
     at 2 misses the plugin emits the one host-unwilling warning — "compaction did not land; loop is running
     hot; consider /compact manually" — re-requests continue as a trickle every 3rd arm, and the 4-miss cap
     remains only as a backstop with one final warning at the crossing. Permanent silence is gone; the loop
     keeps running throughout.
228. No boundary compaction for plain (non-loop) goals stays in place (A-4, Workstream AJ); a pin test proves
     restore with a plain record arms no `loopCompact` at all. Restore, the arm-time settle and the
     compaction-ended event all flow through the same landing/reset bookkeeping (`landPending`), so a landing
     resets miss counters on every path.
229. Evaluator hardening, three surfaces. (a) `evaluator.verifyCommand` is surfaced as the deterministic
     guarantee: the README evaluator section and options table, and `docs/config.html` with a dedicated callout
     and row, all state that a dev loop armed without it runs without that guarantee; the default stays `""`
     (no behavior change). (b) New opt-in `evaluator.consensus: 2` (default `1`, no global flip): two
     independent judges — the session evaluator and the independent model — must both rule `met`; any
     disagreement, a dead second judge, or a missing independent model fails closed to `not_met` with the
     disagreement named in the reason string. It doubles evaluator cost and is documented as per-repo/per-loop
     opt-in. (c) A `met` verdict on a turn with zero harness-counted tool calls whose condition names
     production of a thing (test/file/merge/commit/create/implement/write/fix/build/refactor) is rejected as
     `not_met` with the reason "no evidence of work toward the condition, only state inspection". The
     "Already satisfied at HEAD" met is exempt — that verdict is the already-satisfied landing, and rejecting
     it would strand the loop on a completed condition (the v18 near-duplicate arming gate remains the escape).
230. Acceptance tests added in `test/loop.test.ts` ("compaction landing detection + evaluator hardening —
     acceptance") and `test/evaluator.test.ts` (consensus suite): a never-landing request yields the warning
     within 2 arms; a >=10% drop lands with success notice, cleared pending, misses reset; under-10% does not
     land; an unmeasurable context never lands and never reaches a terminal suspension across 8 arms; the
     ended-compaction event lands the request, logs it, and queues the re-anchor with `resume: false`; restore
     with a plain record arms no `loopCompact`; a zero-tool-call producing-condition turn is rejected as
     not_met naming the reason; the already-satisfied met is exempt; consensus disagreement and second-judge
     failure fail closed with the disagreement named; consensus 1 keeps single-judge behavior. Existing tests
     pinning the old miss ladder were rewritten to the new semantics; the ≥10% watermark is a heuristic and
     remains instrument-first-tune-second; `/goal clear` remains the escape hatch.

Files touched: `src/core/constants.ts` (drop factor 0.6 to 0.9), `src/core/types.ts` (`LoopCompactState`:
`unmeasurableTicks`, `stalenessUnknown`, `unwillingWarned`; `missesCountedAtEvent` removed — the ended event is
now authoritative and single-counts by construction), `src/core/wire.ts`, `src/core/config.ts` (`evaluator.consensus`),
`src/runtime/controller.ts` (settle ladder, `landPending`, ended-event authoritative landing, zero-tool
met-rejection), `src/runtime/evaluator.ts` (consensus), `src/core/format.ts` untouched, `test/*`, `README.md`,
`docs/config.html`, `docs/runtime.html`, `docs/architecture.html` (line refs), `SPEC.md`. Marker bumped
files=41 tests=580 to files=41 tests=595. No version bump, no tag, no push; v1.1.0 remains the live public
artifact; all work is local on dev.

Verification (all run in the worktree): `cd test && bun test` (595 pass), `bun run check` green, coordinator
submit + merge-next, and `bun run check` on dev shown green at the end.

## Workstream BW — per-iteration context sparkline (2026-11-16)

Interpretation of this iteration: the loop dialog showed each iteration's duration and wall share, but
not how the context grew or shrank across iterations — the one thing the boundary-compaction machinery
measures on every arm. The plugin already estimates the context size at the arm of each iteration
(tagged with the iteration number on `loopCompact`); it just never landed on the per-iteration record.
This exposes that measurement as a ledger row. No new estimation is added; the row only renders data the
plugin already had, and renders the gaps honestly.

231. `LoopEntry` gains an additive optional `contextTokens?: number` — the context size estimated at the
    arm of that iteration (the boundary-compaction estimate tagged with the iteration, taken from
    `loopCompact.estimatedTokens` at entry-build time). Stamped only when the tag matches and the value
    is finite and non-negative; anything else stays absent — never estimated, never fabricated. Absent
    renders as a `·` gap, never as zero. The wire parser (`isLoopEntry`) accepts the field when finite
    and rejects non-finite/string values when present; legacy records without it parse unchanged
    (`test/wire.test.ts`).
232. The loop dialog renders a `context` row (only when at least one completed entry carries an
    estimate) between the compact row and the iteration rail: one eighth-block glyph per completed entry
    (▁..█, scaled to the peak across ALL completed iterations), oldest → newest, a leading `…` past 16
    bars (the newest are kept), `·` for entries whose arm could not measure the context, and a faint
    caption `~<peak> peak · arm sizes, oldest→newest`. Colors: bars in base tone, caption faint — no
    accent, so the row is NO_COLOR-safe by construction. 80-column floor: label 10 + 2 + bars ≤17 + 2 +
    caption ~30 — about 61 cells.
233. New pure helper `contextSparkline(entries)` in `src/core/history.ts`, unit-tested for: undefined
    when no estimate exists anywhere (the row is omitted), peak-relative glyph heights, gaps, trailing
    gaps skipped for `latest`, SPARK_MAX_CELLS truncation with leading …, zero-peak. The dialog row is
    render-tested for presence (bars + peak caption) and absence (no estimate → no row)
    (`test/tui-render.test.tsx`); the stamping path is loop-test tested for both the measurable-arm
    (v2 entry carries the arm estimate, v1 does not) and the unmeasurable-arm case (no stamp, no
    fabricated value) (`test/loop.test.ts`).
234. Honesty boundary: the bars are arm-time estimates, not completion-time, and are estimates of
    model-visible prompt size (the plugin's own `estimateContextTokens`), not host ground truth; the
    caption says `arm sizes` so the row cannot be misread as end-of-iteration usage. Loop v1 entries
    typically lack an estimate (no boundary compaction is requested at the first arm) and render as a gap
    on legacy records until they age out of the rail. Live verification behind the dead provider is not
    possible (no verdict ever lands a loop entry); the evidence is unit/loop/render tests at the layers
    named. Fresh evidence only.

Marker bumped files=43 tests=732 to files=43 tests=741. No version bump, no tag, no push; v1.1.0 remains the live public
artifact; all work is local on dev. Note on docs line refs: this workstream inserted ~6 lines into
`src/runtime/controller.ts` at the loop-advance site, shifting every later `controller.ts:NNN` anchor in
`docs/*.html` (1053, 1082, 1121, 1250 and later) by +6. The refs remain structurally valid (the
`docs-line-refs` test checks existence and in-bounds ranges only); content re-sync is a docs-lease
matter and is recorded for the `github-single-channel` lease holder.

Verification (all run in the worktree): `cd test && bun test` (741 pass), `bun run check` green, coordinator
submit + merge-next, and `bun run check` on dev shown green at the end.

## Workstream BX — check-flash on met; hover-true dialog affordances (2026-11-16)

Interpretation of this iteration: two named gaps against the design brief. (1) The brief calls for
"a check-flash on met" — the completion moment had a 45s static acknowledgment pill but no motion
beat where the user was watching; every other transient (evaluator thinking, hot compaction) already
pulsed. (2) Two clickable dialog surfaces gave no hover feedback at all, which breaks the mouse-first
bar (every interactive element answers the pointer before it is clicked).

235. `ACK_FLASH_MS = 1_700` in `src/core/hud.ts`. When a goal transitions live→terminal via
    `noteTerminal` with status `achieved`, the session joins a TUI-local `flashing` set for the first
    1.7s of the ack window; the pill rides the existing 850ms bold-flip interval (no new timer chain),
    then a dedicated one-shot timer removes the session and the pill goes static for the remainder of
    the ack. `cleared` and non-achieved terminal states arm no flash. Under reduced motion
    (NO_COLOR / TERM=dumb) the effect never starts — static pill, no motion, unchanged. A fresh live
    goal (`dropTerminal`) and unmount both disarm the flash. Loops and non-looped goals both flash
    (both land `achieved`).
236. `pillMotionNeeded({ evaluating, hot, flashing })` — the pure predicate behind the pill's pulse
    interval; a flash alone drives it. Contract pinned in unit tests (`test/tui-hud.test.tsx`).
237. Dialog hover truth (`src/status-dialog.tsx`): the condition row and the evaluator/reason row
    reveal a faint `copy` hint while hovered — same grammar as the HUD card's condition row and the
    rail's summary lines. The condition row keeps its resting underline (it is the primary content);
    the reason row underlines on hover as before. Render-tested: hover reveals the hint, mouse-out
    removes it, no lingering chrome (`test/tui-render.test.tsx`, `mockMouse.moveTo`).
238. The dialog header's `esc` label (`src/tui.tsx`) is now a hot affordance like every other
    clickable: on hover the label brightens muted→base and underlines; reset on dialog (re)open.
    This one lives in the plugin's inline dialog chrome, not a render-tested component — evidence is
    source-layer, same class as the `esc` button's existing click wiring.

Honesty boundary: the check-flash is not observable live behind the dead provider (no verdict ever
lands a terminal transition — the same ceiling recorded for the ack pill itself). Evidence for the
flash is source-layer (the predicate is unit-tested; the timer arm/disarm path mirrors the ack
registry's reviewed pattern); evidence for the hover hints is render-layer (real mouse moves over the
headless grid). The dialog `esc` hover is source-layer. Fresh evidence only; no live claim is made.

Marker bumped files=43 tests=741 to files=43 tests=747. No version bump, no tag, no push; v1.1.0 remains the live public
artifact; all work is local on dev. No docs line references were touched by this workstream (insertion
points were after all pinned anchors).

Verification (all run in the worktree): `bun run compile`, `bun run check` green (747 tests),
coordinator submit + merge-next, and `bun run check` on dev shown green at the end.

## Workstream BY — landing acknowledgment on the ambient pill (2026-11-16)

Interpretation of this iteration: the brief's fourth motion item — "a green sweep when landing is
detected" — was the last undelivered named animation. The boundary-compaction machinery already
detects the landing plugin-side (`loopCompact.pending → landed`, persisted on the record as `landedAt`
and pushed on every save); the TUI just never acknowledged it where the user was watching. This closes
the feedback loop on the same surface as the met flash and the ack pill.

239. `LANDING_ACK_MS = 3_000` in `src/core/hud.ts`. When a snapshot flips `loopCompact` from pending
    (`landedAt` undefined) to landed, the session joins a TUI-local `landing` set for three seconds:
    the ambient pill appends ` · landed ✓` (`LANDING_SUFFIX`), renders in the info tone, and flips bold
    on the same 850ms cadence as the other pulses (`pillMotionNeeded` gains a `landing` argument —
    one of these alone drives the pulse). After the window the pill is static again. Reduced motion
    suppresses it (the effect still requires motionOk). A fresh live goal or unmount disarms it.
    Detection is gated on the same unchanged-snapshot guard as `noteTerminal`, and requires the
    *previous cached snapshot* to have been pending — a plugin restart landing on an already-landed
    record never fabricates an acknowledgment, and neither does re-delivery of the landed record.
240. Only pending → landed is acknowledged; plain `/goal` goals never reach the boundary-compaction
    path, so they never see this. Loops arming a new boundary request after a landing overwrite
    `loopCompact` with a fresh pending record, which is the correct next state (no double-ack).

Honesty boundary: a landing cannot occur live behind the dead provider — compaction is model work,
and no verdict or compaction event ever lands there (the same ceiling as the rest of the loop-side
surfaces). Evidence is the `pillMotionNeeded` unit tests (a landing alone drives the pulse; the window
is bounded and ordered against the met flash and the ack window) plus source-layer review of the
detection flip in the snapshot-intake path, mirroring the reviewed `noteTerminal` pattern. No live
claim is made. The ack text lives in the pill — no new rows, no mount-anchor changes, 80-column floor
preserved (the suffix is 11 cells; the pin suffix truncation budget already accounts for the pill's
rendered length).

Marker bumped files=43 tests=747 to files=43 tests=749. No version bump, no tag, no push; v1.1.0 remains the live public
artifact; all work is local on dev. No docs line references were touched by this workstream.

Verification (all run in the worktree): `bun run compile`, `bun run check` green (749 tests),
coordinator submit + merge-next, and `bun run check` on dev shown green at the end.

## Workstream BZ — palette parity for the mouse-only card actions (2026-11-16)

Interpretation of this iteration: the brief's craft axis asks for keyboard parity for everything the
mouse can do. An audit of every hit-tested mouse affordance against the palette found five actions
that only the mouse could reach — clicking the pill toggled the HUD card, the card and context menu
exposed pin/clear/copy actions, and the condition/reason/summary copy rows — while the palette only
carried goal.status, goal.clear, goal.loop.status/clear. A keyboard-only user could not summon the
card, toggle the pin outside the dialog, or copy any of the three texts without first opening the
dialog and relying on in-dialog chords.

241. Five palette commands added to the Goal group in src/tui.tsx (palette: true, no key binds —
     the palette is the keyboard-parity surface; binding new chords risks stealing keys):
     - goal.hud.toggle — "Goal HUD: toggle card" — same effect as clicking the pill (setHudSession
       toggle for the current session; the context menu is collapsed).
     - goal.pin.toggle — "Goal: toggle pinned condition" — togglePin for the current session.
     - goal.condition.copy — "Goal: copy condition" — OSC52 copy of the live/terminal snapshot's
       condition for the current session.
     - goal.reason.copy — "Goal: copy evaluator reason" — enabled only when a reason is present.
     - goal.summary.copy — "Goal: copy latest loop summary" — enabled only when the loop history
       carries a latest summary.
     All five resolve the goal through the same live(sessionID) ?? entries()[sessionID]?.goal chain the
     existing palette commands use, copy through the same copyToClipboard path (host toast on success/
     refusal, never silent), and are no-ops when their precondition is absent (enabled() false).
242. Evidence is source-layer. The keymap layers are constructed inline inside the plugin's setup
     closure and executed by the host — there is no headless harness for the host's keymap/palette
     dispatch, and the existing palette commands ship without unit tests for the same reason. No test
     files were touched, so the spec-check marker stays files=43 tests=749. The enabled() predicates
     mirror the adjacent goal.status/goal.clear commands, whose wiring is exercised live by the host.

Marker unchanged (files=43 tests=749). No version bump, no tag, no push; v1.1.0 remains the live public
artifact; all work is local on dev. No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check green (749 tests),
coordinator submit + merge-next, and bun run check on dev shown green at the end.

## Workstream CA — full-frame snapshots for the named layout states (2026-11-16)

Interpretation of this iteration: the brief's craft axis demands "snapshot tests for every new layout
state (empty, armed, waiting-on-evaluator, met, hot, failed)". Until now the suite pinned layout via
substring assertions and interaction tests, but nothing locked a complete frame — a chrome change
(spacing, an extra row, a hint reword) could pass every assertion. This closes that gap at the
strongest available layer.

243. `test/tui-snapshots.test.tsx` (+ `__snapshots__/tui-snapshots.test.tsx.snap`, committed): eight
     full-frame snapshots across the three headlessly renderable zoom levels — HudCard (armed,
     evaluating, hot, failed), LoopSection (freshly armed, finished/met with the final tally), and
     StatusDialogBody (freshly armed with the teaching hint, hot with the remediation row). Snapshot
     failures mean chrome changed; intended changes regenerate with `bun test -u`, unintended ones
     are regressions by definition. Frames are deterministic by construction — every clock is injected
     (`elapsedMs`, `nowMs`); nothing reads the wall clock inside the render path.
244. The ambient pill (level a) is inline in the plugin's slot render and is not headlessly
     renderable; its states stay pinned by the pillModel unit tests. The dialog's Esc affordance and
     the check-flash/landing windows remain source-layer. The snapshot suite adds no chrome, no
     layout and no motion — purely a regression net.

Marker bumped files=43 tests=749 to files=43 tests=757. No src changes, dist/ untouched by this
workstream. No version bump, no tag, no push; v1.1.0 remains the live public artifact; all work is
local on dev. No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run check green (757 tests), coordinator submit +
merge-next, and bun run check on dev shown green at the end.

## Workstream CB — ASCII demotion for dumb terminals (2026-11-16)

Interpretation of this iteration: the brief demands "ASCII/Unicode-safe fallbacks". The reduced-color
surface (NO_COLOR / TERM=dumb) dropped chromatic accents but kept painting █ ░ ▁▂▃▄▅▆▇ — eighth-block
glyphs a genuinely dumb terminal cannot render. This workstream demotes every bar glyph to
ink-density ASCII under the same env predicate; no chrome, layout, spacing or motion changes.

245. src/core/history.ts: renderBar, contextSparkline and contextMeter gain an optional `ascii` flag
     (Unicode stays the default — every existing caller is byte-compatible). New exported constants:
     BAR_FILLED/BAR_EMPTY (█/░), BAR_FILLED_ASCII/BAR_EMPTY_ASCII (#/-), SPARK_GLYPHS_ASCII
     (ink-density "." ":" "-" "=" "+" "*" "#" "@"), SPARK_GAP_ASCII (" "), SPARK_TRUNC_ASCII (">").
     ASCII mode semantics: gap = a void cell (absence is honest), truncation lead-in = `>`, peak-0
     renders the lowest ramp glyph. Two-tone loop progress bar keeps its info/faint tone split, now
     sourced from renderBar's text instead of hardcoded literals (previously the component repeated
     █/░ inline and ignored renderBar's pair entirely).
246. Components evaluate `motionDisabled(process.env)` once per mount (same predicate as reduced
     motion) and pass it down: LoopSection (progress bar, context sparkline) and StatusDialogBody
     (context meter). HistoryBlock/VerdictTrail glyphs (✓ ✗ ⊘ ●○·│) are letterform/geometric glyphs
     with the same coverage class as ASCII punctuation and are intentionally not demoted. The ambient
     pill remains inline-in-slot (unchangeable here); its glyphs (◎ ✓ ·) are likewise geometric.

Evidence: unit tests (renderBar/contextSparkline/contextMeter ASCII paths, unmeasurable-gap void,
peak-0, truncation marker, clamp — test/history.test.ts) plus render tests under NO_COLOR=1
(LoopSection bar renders # and never █; sparkline row never emits eighth-blocks —
test/tui-render.test.tsx). Unicode frames are byte-identical to before (snapshot suite green,
unmodified). Fresh evidence only; no live claim is made.

Marker bumped files=43 tests=757 to files=43 tests=763. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched.

Verification (all run in the worktree): bun run compile, bun run check green (763 tests),
coordinator submit + merge-next, and bun run check on dev shown green at the end.

## Workstream CC — snapshot the waiting and remediation layout states (2026-11-16)

Interpretation of this iteration: the craft axis demands snapshot tests for every layout state, and
Workstream CA pinned eight of them. The audit that motivated this found six more live states whose
pixels were unpinned: the `waiting` flavor (background work holding evaluation back — the pill's
fifth state word), the two remediation-first-class screens the failure axis exists for (paused at
the turn cap, judged impossible), both surfaces they render on, and the zero-tool muted ledger row
(narrative legibility: state inspection only, no work produced).

247. test/tui-snapshots.test.tsx gains six full-frame snapshots under a new describe block:
     HudCard waiting (now row reads "waiting"), HudCard paused at the turn cap (remediation row
     reads "turn cap reached · /goal clear or set a new goal …"), HudCard judged impossible
     ("rephrase the condition, else /goal clear"), StatusDialogBody paused and impossible (the
     dialog carries the identical exact remedy, not a generic failure line), and LoopSection with a
     toolCalls=0 iteration (the muted "no tools · inspection only" row beside a work-producing
     iteration). Frames deterministic by construction (all clocks injected). The remediation rows
     grow the card's anchor by exactly the two rows hudCardRows budgets — these snapshots pin that
     contract byte-for-byte; a regression there would otherwise shift the card mid-toggle silently.
248. No chrome, layout, motion or src changes; the ambient pill and live paths remain source-layer
     behind the dead provider. Evidence is test-layer only.

Marker bumped files=43 tests=763 to files=43 tests=769. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched by
this workstream.

Verification (all run in the worktree): bun run check green (769 tests), coordinator submit +
merge-next, and bun run check on dev shown green at the end.

## Workstream CD — every clear path asks first (2026-11-16)

Interpretation of this iteration: the mouse-first axis plus failure-is-first-class. Every clear
affordance in the TUI erased the armed goal and its full history on a single click — the dialog
footer [clear goal], the card footer button, the danger row in the context menu, and the two palette
commands (goal.clear, goal.loop.clear). One stray hover-click on the card's danger row wiped an
armed loop; the host's own /goal discipline (typed deliberately) was no protection against a
pointing device. This closes that hole with the host's native confirm primitive.

249. src/tui.tsx: a new requestClearGoal helper funnels ALL five clear paths through
     context.ui.dialog.confirm (title "Clear goal", label { confirm: "clear goal", cancel: "keep" }).
     The message names what is actually lost — for a loop goal it names the iteration and cap
     ("Clear the armed loop (iteration N of at most M) and its full history? This cannot be
     undone."), otherwise "Clear the armed goal and its history? This cannot be undone."
     Fail closed on every error path: host confirm unavailable, rejected, or dismissed — nothing is
     cleared. The status dialog and card collapse BEFORE the confirm opens (fresh mount next time),
     and the rpc.clear call happens only after ok === true.
250. Evidence is source-layer for the confirm path (the host dialog dispatch has no headless harness,
     same class as the keymap layers from Workstream BZ); the button wiring of every funnelled path
     is unchanged and remains covered by the existing card/dialog render tests. No test files were
     touched; marker unchanged (files=43 tests=769). No chrome, layout or motion changes; the
     confirm is host-rendered chrome, not a plugin-painted modal — no modal spam.

No version bump, no tag, no push; v1.1.0 remains the live public artifact; all work is local on dev.
No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check green (769 tests),
coordinator submit + merge-next, and bun run check on dev shown green at the end.

## Workstream CE — dialog condition row hover grammar (2026-11-16)

Interpretation of this iteration: craft details, affordance honesty. Every clickable text affordance
in the plugin advertises itself the same way — faint static chrome that lifts on hover (hint appears,
background swaps, underline draws). The /goal dialog's condition row was the one exception: it drew a
permanent underline whenever the copy callback was wired, so a static hyperlink lied about interactivity
and never changed on hover. One look at the sibling grammar (evaluator/reason row, card condition row,
summary rail, fold row, esc chord — all hover-gated) shows the intended shape.

251. src/status-dialog.tsx: the condition row's underline is now gated on conditionHovered() — the
     exact grammar the evaluator/reason row already uses. Hover still reveals the faint copy hint
     (pinned by the existing hover-grammar render test, green unchanged); the underline now joins it.
252. No behavioral change beyond the attribute; no new chrome, layout or motion; no test files
     touched (char frames carry no attribute state, so nothing frame-level to pin); marker unchanged
     (files=43 tests=769). Evidence is source-layer plus the existing render-layer hover tests.

No version bump, no tag, no push; v1.1.0 remains the live public artifact; all work is local on dev.
No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check green (769 tests),
coordinator submit + merge-next, and bun run check on dev shown green at the end.

## Workstream CF — right and middle never activate; left does (2026-11-16)

Interpretation of this iteration: mouse-first ergonomics, the audit's top finding. Every leaf
click handler in the TUI ignored event.button: a right-click on any button/row fired its action
and bubbled to the card root (toggling the context menu), and the pill treated middle-click as a
left click. One misplaced press on [clear goal] or a menu row could therefore erase the armed goal
and its history, or corrupt the menu state — exactly the failure the clear-confirm workstream closed
for keyboard-speed clicks.

253. src/hud-card.tsx (HudButton, HudMenuRow, card condition row), src/status-dialog.tsx
     (condition and reason rows), src/tui-history.tsx (RailSummary, the fold row), src/tui.tsx
     (dialog esc, ambient pill): every leaf onMouseUp now activates on button 0 ONLY. Handled left
     clicks call event.stopPropagation() so no ancestor re-fires them; non-left presses fall through
     unhandled, preserving the documented "right-click anywhere on the card toggles the context menu"
     contract. The pill is now explicit: button 0 toggles the card, button 2 opens the dashboard,
     other buttons inert. The dialog esc closes on left only. Note: the renderer stamps
     isDragging=true on any left up that ends an in-progress selection (plain clicks included — the
     audit's isDragging suggestion was tried and reverted: it swallowed every real activation);
     button filtering is the reliable discriminator here.
254. test/tui-render.test.tsx gains a "mouse-button discipline" describe block with five tests:
     right-click on the [clear goal] menu row fires nothing and toggles the menu via the root;
     middle-click on a menu row fires nothing and leaves the menu open; right-click on the card's
     footer [clear goal] button fires nothing (menu opens instead); right-click on a loop summary row
     copies nothing; left-click on a loop summary row still copies (regression guard).
255. Evidence is test-layer (mouse button is fully mockable); the drag-release distinction is not
     component-distinguishable in this host and stays host-owned. No chrome, layout or motion changes.

Marker bumped files=43 tests=769 to files=43 tests=774. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched by
this workstream.

Verification (all run in the worktree): bun run compile, bun test tui-render.test.tsx (73 pass),
bun run check green (774 tests), coordinator submit + merge-next, and bun run check on dev shown
green at the end.

## Workstream CJ — a confirmed clear that fails says so (2026-11-16)

Interpretation of this iteration: failure is a first-class screen, one lie removed. Slice 9 funneled
every clear path through the host's native confirm and failed closed — but the rpc.clear rejection
that can follow a confirmed clear was swallowed by a bare .catch(() => {}), so the user could confirm
the destructive wipe and get no signal at all when the RPC refused. The goal stayed armed with no
explanation. The copy path already toasts failures; the clear path now matches it.

256. src/tui.tsx (requestClearGoal): the rpc.clear call now routes rejections — and synchronous
     throws — through an error toast mirroring the copy-failure grammar: title "clear failed", the
     rejection message truncated to 200 chars, variant error, duration 5s, sessionID-scoped. The
     confirm gate itself is untouched (still fails closed on an unconfirmed or dismissed dialog).
257. Evidence is source-layer: the RPC dispatch has no headless harness (same class as the
     confirm-dialog and keymap layers), so no test files were touched and the marker is unchanged
     (files=43 tests=774). No chrome, layout or motion changes.

No version bump, no tag, no push; v1.1.0 remains the live public artifact; all work is local on dev.
No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check green (774 tests),
coordinator submit + merge-next, and bun run check on dev shown green at the end.

## Workstream CI — pips demote to ASCII under NO_COLOR / TERM=dumb (2026-11-16)

Interpretation of this iteration: craft details, graceful degradation. The bar and the sparkline have
demoted to ASCII under the same predicate the reduced-motion path uses (NO_COLOR, or a TERM that cannot
draw eighth-blocks or U+2591), but the loop pips — one ● per completed iteration, one ○ per remaining
cap slot, on the ambient pill and the card title row — still emitted the bullet glyphs on exactly the
terminals least likely to have them. Audit finding #6.

258. src/core/history.ts: renderPips gains the standard `ascii` flag (default false, same shape as
     renderBar/contextSparkline) and exported PIP_FILLED/PIP_EMPTY plus PIP_FILLED_ASCII (#) /
     PIP_EMPTY_ASCII (-) constants — the same pair as the bar demotion, so the two read as one family.
259. src/core/hud.ts: pillModel gains an `ascii` third parameter (default false; every existing call
     site and unit test is byte-compatible) and threads it into renderPips. src/hud-card.tsx passes
     its mono flag (the NO_COLOR / TERM=dumb mount flag) for the card title row. src/tui.tsx threads
     motionDisabled(process.env) into the ambient pill's pillModel call. The verdict glyphs
     (✓ ✗ ⊘) were considered and deliberately left alone this slice — they carry meaning on every
     surface, not just the pips' two mounts.
260. test/history.test.ts: pinRenderPips ascii cases (swap pair, Unicode default untouched).
     test/tui-hud.test.tsx: pillModel ascii case (pips demote, label and tone untouched).

Marker bumped files=43 tests=774 to files=43 tests=776. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched by
this workstream.

Verification (all run in the worktree): bun run compile, bun test history.test.ts tui-hud.test.tsx
(151 pass), bun run check green (776 tests), coordinator submit + merge-next, and bun run check on
dev shown green at the end.

## Workstream CK — the ambient pill fits the terminal it lives on (2026-11-16)

Interpretation of this iteration: progressive disclosure at the ambient zoom level; the 80-column
floor applied to the one surface that had none. The 1-row pill composed an unbounded label — at 80
columns a distress pill (v8/8, 8 pips, turns, misses pending, retries) painted ~78–96 cells into an
absolute box with wrapMode="none" and no width cap, so trailing distress — precisely the segment the
pill exists to surface — clipped away, and the pin suffix could not ride behind it. Audit finding #2.

261. src/core/hud.ts: pillModel gains a fourth parameter, `budget` (cells, default Infinity — every
     existing call site and unit test is byte-compatible). When bounded, the label walks a degradation
     ladder of whole segments in priority order — `retry` drops first, then `compact pending`, then
     `turns`, then the pips — and the final rung (the irreducible state core) is hard-truncated with
     `…` via the width-aware, grapheme-safe `truncate`. Selection is width-aware (stringWidth), never
     code-unit slicing. The non-loop variant ladders retry → turns → core the same way.
262. src/tui.tsx (pill mount): the pill now budgets its label to `dimensions().width - 2` —
     one cell of left padding, one cell of right margin — minus the landing acknowledgment suffix
     when it rides the same line (LANDING_SUFFIX.length; the ASCII-wide … swap does not change its
     width). The budget is live — useTerminalDimensions re-reads on resize, so rotating the terminal
     narrow re-tiers on the next render tick. The pin budget composes as before: base now fits, so
     pinBudget gets a real base length instead of a pre-clipped one.
263. test/tui-hud.test.tsx: two new tests pin the ladder (loop distress goal: retry→compact→turns→pips
     order, width ≤ budget at every rung, `…` guardrail ends the smallest budget) and the non-loop
     ladder; plus stringWidth import. Marker bumped files=43 tests=776 to files=43 tests=778.
     Evidence is unit-layer (the budget math is pure) plus source-layer for the mount wiring; the
     host jump-button overlap hypothesis noted by the audit stays a hypothesis — the fix bounds the
     pill to the terminal, and does not claim the host's reserved hit zone (unverifiable from this
     repo). No chrome, layout, motion or interaction changes; the pill colors and hit areas are
     untouched.

No version bump, no tag, no push; v1.1.0 remains the live public artifact; all work is local on dev.
No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun test tui-hud.test.tsx (79 pass),
bun run check green (778 tests), coordinator submit + merge-next, and bun run check on dev shown
green at the end.

## Workstream CL — the riskiest chrome gets named snapshots (2026-11-16)

Interpretation of this iteration: craft details; the design bar's snapshot-every-named-state clause.
The audit found the two surfaces with zero frame-level pinning: the card's context menu (the only
clickable action surface with destructive rows) and the dialog footer's width-tier boundaries. Both
now carry byte-for-byte snapshots; regressions land loudly.

264. test/tui-snapshots.test.tsx gains six named snapshots: the HudCard with its 4-row context menu
     open (all action rows visible, fixed anchor verified by the frame), the mono card (weight and
     glyphs carry meaning — pips already demote via Workstream CI), the LoopSection frame under
     NO_COLOR (bar and sparkline render as #/- ASCII ink-density, verified by env-gated mount), and
     DialogFooter at the three width tiers it implements (80 columns: short hint + compact labels;
     96: short hint + full labels; 140: full hint + full labels). Snapshot count 14 → 20.
265. The reason-row-inert menu variant was deliberately NOT snapshotted: char frames carry no
     color/attribute state, so the live and inert reason rows are byte-identical — a snapshot would
     pin nothing. That contract is pinned at the render layer instead (tui-render.test.tsx: "inert
     rows", "clicks are inert", and the mouse-button discipline block). Menu row count, alignment
     and fixed anchor ARE pinned by the open-menu snapshot.
266. Marker bumped files=43 tests=778 to files=43 tests=784. No version bump, no tag, no push;
     v1.1.0 remains the live public artifact; all work is local on dev. No docs line references were
     touched by this workstream. The ASCII snapshot sets and restores process.env.NO_COLOR around a
     single mount; no global env pollution.

Verification (all run in the worktree): bun test tui-snapshots.test.tsx (20 pass, 6 added),
bun run check green (784 tests), coordinator submit + merge-next, and bun run check on dev shown
green at the end.

## Workstream CM — the card fits the terminal it floats on (2026-11-16)

Interpretation of this iteration: craft details and failure-is-first-class, one lie removed. The
card's mount anchored with a flat 2-row allowance for the failure-first-class remediation no matter
how wide the text actually wraps at the ~49-cell remediation column (an unlucky long failureLabel
wrapped to 3+ rows and the anchor under-reserved, so the absolute box painted below the border), and
it never clamped against the terminal at all: on a short screen the negative-top anchor ran the
card's title above the buffer. Audit findings #4 and #8, landed together.

267. src/core/format.ts: a new exported wrapLines(text, width) — greedy word wrap on single
     spaces, width measured with stringWidth (cells, never code units), never mid-word; a single
     word longer than the line hard-breaks across as many rows as it needs; an empty string paints
     one line. Unit-tested in test/core.test.ts (empty, exact fit, catalog remediations, long
     failureLabel, CJK two-cell glyphs, overlong word).
268. src/hud-card.tsx: REMEDIATION_WIDTH (49 cells: the 64-cell default card minus border 2,
     padding 2, LABEL 10, gap 1) is exported; a new cardRowPlan(goal, contextOpen, maxRows) is the
     single source of truth for the card's height — it returns { rows, hint, spend, last } and both
     the renderer (optional rows wrapped in Show on the same plan) and the anchor (hudCardRows,
     now with a third maxRows parameter, default Infinity, so every existing call site and test is
     byte-compatible) consume it. The remediation row costs wrapLines(text, 49) rows, never a flat
     2. Under maxRows the plan drops whole optional rows in a fixed least-essential-first order —
     the teaching hint, then spend, then the last-verdict row. The remediation and the menu never
     drop; when the irreducible core exceeds the ceiling the plan returns it anyway (the anchor
     clamps, the renderer clips the top rather than the esc affordance at the bottom). The card
     accepts a maxRows prop and derives all three optional rows from the same plan — the painted
     rows are by construction the anchored rows.
269. src/tui.tsx (pill mount): the card ceiling is computed at mount time from the live terminal
     dimensions — Math.max(8, height - 2), one row reserved for the host slot above the prompt and
     one for the global status line; the floor of 8 is border + condition + now + actions + a
     two-line remediation. opentui boxes paint overflow: visible by default, so the budget IS the
     clamp — the absolute box keeps top={-rows()} but rows is now the capped value, mirroring
     ClampedColumn's viewport cap (its "height - 1" reservation, applied to the floating card).
270. test/core.test.ts: six wrapLines cases. test/tui-hud.test.tsx: six cardRowPlan/hudCardRows
     ceiling cases (1-line remediation costs 1 row, long failureLabel costs its real wrap, the
     drop order hint → spend → last, the remediation and menu never drop, plan/hudCardRows
     agreement) plus four render cases pinning the omission behavior and that esc/clear survive a
     ceiling. The mount wiring is source-layer evidence (a plugin slot cannot mount headlessly);
     the row omission is render-layer evidence. Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=784 to files=43 tests=800. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched by
this workstream.

Verification (all run in the worktree): bun run compile, bun test (800 pass, 20 snapshots),
bun run check green, coordinator submit + merge-next, and bun run check on dev shown green at the
end.

## Workstream CN — the pill says whether the card is open (2026-11-16)

Interpretation of this iteration: mouse-first ergonomics and information hierarchy — the ambient
zoom level was the one surface with a hidden state. The pill is the pill AND the card's one-button
toggle, but nothing in it distinguished "card closed, click to expand" from "card open, click to
fold". A stranger watching the screen for five seconds could see the card but never learn how it
got there, or how to put it away. Audit finding #7 — the last ranked finding from the hostile review.

271. src/core/hud.ts: a new exported pillCaret(open, ascii = false) — the leading affordance glyph.
     Unicode ▾ while the card is painted, ▸ while it is not; ASCII v/> under NO_COLOR / TERM=dumb
     (the same motionDisabled predicate the pips, bar and sparkline demote under). Unit-tested in
     test/tui-hud.test.tsx (both glyphs × both color modes).
272. src/tui.tsx (pill mount): the label budget reserves two more cells for the caret + separating
     space (80-column floor: width − 4, still minus the landing suffix and still walked down the
     degradation ladder before truncating). The caret prefixes the pinned/unpinned label and the
     pin budget sees the true prefix length, so the pin suffix can never overpaint the right margin.
     It rides the same <text> node as the label, so the hover underline and the evaluating/hot pulse
     bold span the caret — the pill reads as one control it has always been. The caret's open state
     is keyed to the card actually rendering (getHudSession() === sessionID AND cardFor() yields a
     snapshot), never to the bare hud slot, so "▾" can never claim open over a missing card after
     the goal finishes.
273. No chrome beyond the two cells; the pill's click behavior, colors, z-order and hit area are
     untouched; the card is unchanged. Evidence is unit-layer for the glyph selection and source-layer
     for the mount wiring (the slot cannot mount headlessly). Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=800 to files=43 tests=802. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched by
this workstream.

Verification (all run in the worktree): bun run compile, bun test tui-hud.test.tsx (91 pass),
bun run check green, coordinator submit + merge-next, and bun run check on dev shown green at the
end.

## Workstream CO — one door out of the card: the status dialog disarms it (2026-11-16)

Interpretation of this iteration: craft and information hierarchy — the modal is the deepest zoom
level; it must be the only thing speaking. Re-examination after the ranked audit (its listed findings,
verified line-by-line at the current tree, were all already closed — the useful remainder was a
state-consistency hole in the dialog path).

274. src/tui.tsx (showStatusDialogInner): opening the status dialog now unconditionally disarms the
     compact HUD card — setContextOpen(false) + setHudSession(undefined) at the choke point every
     caller passes through. Before this, only openDashboard() disarmed the card; the /goal command
     and the palette `Goal: show status` / `Goal loop: show status` reach the dialog through
     rpc.status → host notice → onNoticeInner status branch → showStatusDialog, bypassing
     openDashboard entirely. The card therefore stayed painted behind the modal and the
     priority-100 HUD Esc layer stayed armed alongside the host modal layer, making Esc behavior
     ambiguous behind the dialog. The fix covers the notice path, openDashboard, and any future
     caller; openDashboard's redundant inline resets were removed (the choke point owns them).
275. Failure paths unchanged: if a reset or the dialog body throws, the host's error toast reports
     it exactly as before; the reset itself cannot fail (plain signal sets). Visibility: bug class,
     not data loss; the user-facing defect was a dialog opening over a redundant, focus-competing card.
276. Evidence: source-layer. The slot mount and the setup-scope closures cannot mount headlessly, so
     no headless test pins this (the same ceiling as all mount-wiring evidence in this codebase); the
     behavior itself is a two-signal reset verified by reading every caller in src/tui.tsx. No new
     tests; the marker stays at files=43 tests=802. Live TUI remains unverifiable (dead provider).

No version bump, no tag, no push; v1.1.0 remains the live public artifact; all work is local on dev.
No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check green (802 tests, spec-check
ok), coordinator submit + merge-next, and bun run check on dev shown green at the end.

## Workstream CP — the dialog owns the screen; the card may never arm behind it (2026-11-16)

Interpretation of this iteration: craft and information hierarchy — the symmetric half of
Workstream CO. CO made every dialog-opening path disarm the card; the disarm alone left the arm
paths alive: the palette `Goal: toggle card`, the pill's left-click slot handler and the HUD
Esc layer could all paint/re-arm the card while the status dialog owned the screen, recreating
the same "card under the modal, Esc layer competing priority-100 with the modal's own Esc" defect
class from the other direction.

277. src/core/hud.ts: a new exported pure predicate hudArmEnabled(hasGoal, statusDialogOpen) —
     the single place the rule "a live goal is necessary but never sufficient to paint the card;
     the status dialog owns the screen" lives. Unit-tested in test/tui-hud.test.tsx (four
     combinations).
278. src/tui.tsx: every card-arm site consults it. The palette `goal.hud.toggle` enabled() uses
     hudArmEnabled(...) AND its run() no-ops while the dialog is open (enabled() is a hint to the
     host; run() must fail safe). The pill's toggleHud() no-ops while the dialog is open. The HUD
     Esc layer and its `goal.hud.dismiss` command are disabled entirely while the dialog is open,
     so Esc behind the modal reaches the modal alone. The pill affordance, clicks for copies,
     pinning, the card and the dialog are otherwise unchanged.
279. Evidence: unit-layer for the predicate (four cases), render-layer unchanged (no layout
     changed), source-layer for the mount wiring (the slot cannot mount headlessly).
     Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=802 to files=43 tests=803. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun run compile, bun test tui-hud.test.tsx (92 pass),
bun run check green, docs-watch refresh committed alongside, coordinator submit + merge-next, and
bun run check on dev shown green at the end.
## Workstream CQ — the iteration rail fold is keyboard-reachable (2026-11-16)

Interpretation of this iteration: craft — keyboard parity for the one remaining mouse-only chrome
element. Pinned hostile re-audit (session ses_e1c980f2fffeR6lPzktJKz2sQs, HEAD 811136f) ranked the
mouse-only fold row as its top slice; line-verified at the tree before claiming.

280. src/tui-history.tsx (LoopSection): the fold state of the iteration rail is now controllable —
     new optional props `expanded?: () => boolean` and `onToggleExpanded?: () => void`. Controlled
     mode (the status dialog passes both, wired to a plugin-scope signal) lets the dialog's keymap
     layer flip the fold without focus theft; uncontrolled mode (internal signal) is preserved for
     every existing caller, so render tests and snapshots that mount the rail directly are byte
     unchanged. The fold-row click path is unchanged (left button, stopPropagation, button check).
281. src/tui.tsx + src/status-dialog.tsx: a plugin-scope `iterationsExpanded` signal resets to false
     on dialog open (same reset cluster as the card disarm), StatusDialogBody threads the pair into
     LoopSection, and the dialog keymap layer gains chord `x` ("Goal status: show or fold older
     iterations"), enabled only while the dialog is open — same posture as p/c/scroll chords.
     DIALOG_FOOTER_SHORT_HINT / DIALOG_FOOTER_FULL_HINT now advertise `x older` (hud-card.tsx);
     the three pinned tier snapshots (80/96/140) were re-pinned to the new hint, diff verified to
     touch only the hint cells. No new palette command — chords are the dialog's documented keyboard
     surface, matching pin/copy; palette stays free of dialog-only actions.
282. Evidence: render-layer for the rail behavior — three new tests in test/tui-render.test.tsx
     (controlled expanded renders v1..vN with no click; fold-row click fires the callback without
     self-flipping; uncontrolled mode still self-flips). The keymap chord itself is source-layer
     (setup-scope closures cannot mount headlessly, same ceiling as all mount wiring). Snapshot
     tier frames re-pinned. Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=803 to files=43 tests=806. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun test (806 pass), bun test --update-snapshots (diff
review, three footer pins only), bun run compile, bun run check green, docs-watch refresh committed
alongside, coordinator submit + merge-next, and bun run check on dev shown green at the end.
## Workstream CR — the card row plan owns its ceiling end-to-end (2026-11-16)

Interpretation of this iteration: audit finding 2 (pinned re-audit ses_e1c980f2fffeR6lPzktJKz2sQs,
HEAD 811136f) — cardRowPlan never enforced maxRows; the "anchor clamps" doc text described
behavior that did not exist. Closing the last gap between the plan and the painted rows.

283. src/hud-card.tsx: cardRowPlan gains a final drop rung — remediation now falls after hint,
     spend and last. CardRowPlan gains `readonly remediation: boolean` so the painter and the plan
     agree exactly. The drop order is least-essential-first: teaching hint → spend → last verdict →
     remediation. The context menu (4 rows) and the actions row still never drop, so below the
     8-row floor with the menu open (5 core rows + 4 menu rows > maxRows) the anchor still
     exceeds the ceiling — rows are deliberately left unclamped there; the absolute box is anchored
     bottom-up at the dismiss affordance and terminal-edge clipping eats the title border, never
     Esc. The stale "the anchor clamps and the renderer clips the top rows" doc line and the
     "remediation and menu never drop" line were replaced with the true contract. HudCard's the
     maxRows prop doc updated likewise.
284. Painter: the remediation row renders only when plan().remediation is true — plan == painted
     for every viewport outcome except the documented sub-9 menu-open floor above.
285. Evidence: unit + render layers. test/tui-hud.test.tsx re-pinned to the ladder (remediation
     drops at brutal ceilings; menu never drops at 9; render test "a brutal ceiling drops the
     remediation — the actions row and esc always survive" plus "a ceiling with one row to
     spare keeps the remediation"). Full check green: 807 tests. Snapshots untouched (no pinned
     frame exercises a sub-ceiling card). Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=806 to files=43 tests=807. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (807 pass), coordinator
submit + merge-next, bun run check on dev shown green at the end.
## Workstream CS — the pinned-condition budget counts cells, not code units (2026-11-16)

Interpretation of this iteration: audit finding 4 (pinned re-audit ses_e1c980f2fffeR6lPzktJKz2sQs,
HEAD 811136f) — pinBudget subtracted string length from terminal width while the pill paints
cells; a multibyte glyph in the state prefix or landing suffix would silently shrink the pin
budget or overflow the row.

286. src/hud-card.tsx: pinBudget(terminalWidth, pillText) now takes the pill text string and
     measures it with stringWidth, and subtracts stringWidth(PIN_PREFIX) — cells in, cells out,
     both sides of the arithmetic. PIN_PREFIX is the constant the pill paints right before the
     pinned condition, so the budget matches the painted cells exactly.
287. src/tui.tsx: the pill mount passes the base string (prefix + model.text + landing suffix) to
     pinBudget instead of base.length — the call-site unit mismatch that made misuse easy is gone.
288. Evidence: unit layer. test/tui-hud.test.tsx pinBudget tests updated to invoke the new
     signature and gained an East-Asian-wide cell assertion (世 × 20 glyphs = 40 cells — the ─
     glyph first used was East-Asian ambiguous and does not measure 2 cells). No render case
     changes (no pinned frame carries a wide glyph). Live TUI remains unverifiable (dead
     provider).

No marker change: files=43 tests=807 unchanged (tests edited in place, none added). No version
bump, no tag, no push; v1.1.0 remains the live public artifact; all work is local on dev. No docs
line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (807 pass), coordinator
submit + merge-next, bun run check on dev shown green at the end.
## Workstream CT — a failed dialog snapshot says so (2026-11-16)

Interpretation of this iteration: audit finding 3 (pinned re-audit ses_e1c980f2fffeR6lPzktJKz2sQs,
HEAD 811136f) — the dialog's live get-RPC rejection was swallowed whole (`.catch(() => {})`); the
dialog opened on stale cache with no cue that what it showed was not fresh.

289. src/status-dialog.tsx: StatusDialogBody gains optional `noticeStale?: () => boolean`. When set
     and true, a faint `snapshot unavailable — showing last known state` line paints above the
     body (above the status header and above the fallback text too, so even a goal-less stale
     dialog is honest). Faint chrome, not a toast — the information belongs in the modal, where the
     user is already looking; no new color, no new verb.
290. src/tui.tsx: plugin-scope `dialogNoticeStale` signal, reset to false at the dialog-open choke
     point (alongside the card disarm and the rail-fold reset), and set to true only when the
     get-RPC rejects at open time. The entries() cache behavior is unchanged — staleness is
     announced, never silently patched.
291. Evidence: render layer. Two tests in test/tui-render.test.tsx ("StatusDialogBody snapshot
     staleness"): the stale line paints over cached rows; omitted/false paints nothing.
     Live TUI remains unverifiable (dead provider). No snapshot frames exercise the line.

Marker bumped files=43 tests=807 to files=43 tests=809. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (809 pass), coordinator
submit + merge-next, bun run check on dev shown green at the end.
## Workstream CU — reduced-color surfaces demote every verdict glyph (2026-11-16)

Interpretation of this iteration: audit finding A2 (pinned re-audit at dev HEAD c9c08cf, fresh
pass, ses_e1c980f2fffeR6lPzktJKz2sQs) — the verdict glyph family painted Unicode unconditionally;
under NO_COLOR / TERM=dumb every verdict (met/impossible/not_met, the rail's work-produced marker,
the mix suffix, the final tally) rendered as indistinguishable replacement cells. Bar, pips,
caret and sparkline already demoted; this closes the one family that did not. Ride-along A4: the
copied-state timer is cleared on plugin dispose now, like every sibling timer.

292. src/core/history.ts: verdictGlyph(verdict, ascii = false) gains the ASCII arm — met → +,
     impossible → !, not_met → x (the sparkline/bar ramp family). Exported VERDICT_*_ASCII
     constants mirror the existing PIP_*/SPARK_*/BAR_*_ASCII pattern.
293. src/tui-history.tsx: LoopSection and HistoryBlock each define one `ascii` predicate
     (motionDisabled(process.env) || mono()) — the reduced-color surface as the component actually
     sees it, not the environment alone — and every glyph decision uses it: the rail's work-produced
     marker (. inspection / + work produced), the iteration-mix suffix (met N+, not_met Mx, the
     impossible share as !), the final-tally glyph, all verdictGlyph call sites, and both
     VerdictTrail instances (accepted via an optional ascii prop, default keeps Unicode).
     Bar and sparkline consume the same predicate via () => form, so env-only NO_COLOR still
     demotes exactly as before.
294. src/tui.tsx: the plugin-dispose cleanup clears statusCopiedTimer (last untracked timer in
     setup scope). src/hud-card.tsx: the card's last-verdict glyph threads mono(). Snapshot frame
     "HudCard · mono" re-pinned (✓→x, ✓→+; two mono-reduced frames total — the .snap diff is
     exactly the glyph demotion, 5 lines, nothing else moved).
295. Evidence: unit layer (verdictGlyph ASCII arm in test/history.test.ts), render layer (new
     card-level mono test asserting the ASCII glyph and no ✓; the rail mono test re-pinned to
     ASCII; mix/final-tally paths covered by the re-pinned reduced-color snapshot). Full check
     green: 811 tests. Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=809 to files=43 tests=811. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (811 pass), coordinator
submit + merge-next, bun run check on dev shown green at the end.
## Workstream CV — the dialog footer tier is measured, not assumed (2026-11-16)

Interpretation of this iteration: audit finding A1 (fresh re-audit at dev HEAD c9c08cf,
ses_e1c980f2fffeR6lPzktJKz2sQs) — DIALOG_FOOTER_FULL_HINT (64 cells) + the noun-label buttons
(49 cells) + 4 gap cells = 117 cells, but the tier switch flipped at 140/96; at 96–112 the row
overflowed and painted the destructive [clear goal] past the dialog edge.

296. src/hud-card.tsx: DIALOG_FOOTER_FULL_HINT/SHORT_HINT tiers are now computed from measured
     cells (stringWidth), not constants. New exported `footerButtonCells(label)` (label + brackets
     + 2 cells of padding = label + 4) and pure `dialogFooterTier(width, copied, pinned)`:
     budget = floor(width) − 3 (the dialog's paddingRight={3}; the host owns its own frame);
     wide unlocks only when FULL_HINT + roomy buttons + gaps fit the budget, roomy when SHORT_HINT
     + roomy buttons fit, compact otherwise. The row can never paint past budget in any
     copied/pinned state — the labels re-measure at every paint. footerClearLabel unified through
     the same predicate. Honest consequences: roomy unlocks at 97 (default) / 96 (copied — its
     label is narrower, the tier measures rather than assumes); 96 paints compact (was: overflowing
     roomy); full unlocks at 120 (default) / 114 (copied) / 122 (pinned). The 80-column floor is
     untouched.
297. Evidence: unit layer (test/tui-hud.test.tsx: footerButtonCells arithmetic; dialogFooterTier
     boundary table at 80/96/97/99/113/114/120/121/122/140 across the copied/pinned matrix —
     constants derived from the arithmetic, not from the implementation), render layer (test/
     tui-render.test.tsx: "at 96 … compact labels hold the row" and "at 100 … the noun labels
     return"; the pinned-goal noun test moves 96→100). Snapshots: the 96-column frame re-pinned to
     the compact paint with an honest name, one new 100-column roomy frame pinned; the obsolete
     96-roomy frame was removed from the .snap. Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=811 to files=43 tests=817. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (817 pass), coordinator
submit + merge-next, bun run check on dev shown green at the end.
## Workstream CW — the verdict mix is a single pass with an identity memo (2026-11-16)

Interpretation of this iteration: audit finding A3 (fresh re-audit at dev HEAD c9c08cf,
ses_e1c980f2fffeR6lPzktJKz2sQs) — iterationVerdictMix re-filtered the full verdict history once per
rail entry (O(h × n) with an array allocation per window) on every reactive invalidation of the
dialog.

298. src/core/history.ts: iterationVerdictMix is now O(h + n). Verdicts bucket into their
     (from, to] windows in one pass with a sliding window pointer (windows are contiguous and in
     `entries` array order; a verdict belongs to the first window whose endedAt it does not
     precede). Semantics are byte-identical for monotone histories — verdicts at or before setAt
     belong to no window, verdicts past the last window's endedAt belong to no window, a window
     verdict exactly at endedAt joins it. A non-monotone history falls back to the original filter
     read, so pathological input can never paint a different frame than before.
299. A single-slot identity memo ((history ref, entries ref, setAt)) caches the result across the
     render loop's repeated invalidations; the cached array is shared, never copied — the render
     hot path now costs one property read per verdict instead of h × n comparisons plus a fresh
     allocation per window per invalidation.

300. Evidence: unit layer (test/history.test.ts): the identity memo returns the identical array
     for the same refs and recomputes for a fresh history ref; an O-behavior proxy pins the scan at
     one verdict read per verdict (≤ H + 4 getter invocations over 400 verdicts and 40 windows);
     a non-monotone history yields the same frame as the filter read. Existing mix tests
     unchanged and green. Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=817 to files=43 tests=820. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (820 pass), coordinator
submit + merge-next, bun run check on dev shown green at the end.
## Workstream CX — the footer prices in both ClampedColumn paddings; an unparseable snapshot is never fresh (2026-11-17)

Interpretation of this iteration: two line-verified defects from the fresh pinned re-audit at
dev HEAD fdd6544 (ses_e1c980f2fffeR6lPzktJKz2sQs). A1 (medium, ergonomics/frame-accounting): the
footer budget subtracted only the dialog's paddingRight={3}, ignoring the ClampedColumn's
paddingLeft={3} — the row's left edge starts at x=3, so the content ceiling is width−6 and every
tier boundary since CV admitted ~3 cells past the box. A2 (medium-low, failure honesty): refresh()
silently dropped a resolved-but-unparseable get payload, so a corrupt server response or version
skew rendered stale chrome with zero indication — the exact failure CT closed, via the parse path.

301. src/hud-card.tsx: dialogFooterTier budget is now floor(width) − 6 (both ClampedColumn
     paddings). Re-measured consequences: roomy unlocks at 100 (default) / 102 (pinned) / 94
     (copied — its label is narrower); 96 still paints compact (correct); full hint unlocks at
     123 (default) / 117 (copied) / 125 (pinned). 80-column floor untouched.
302. src/tui.tsx: refresh() now resolves false on parse failure (true after a successful put);
     the dialog-open call site routes both false and catch to setDialogNoticeStale(true) — the
     CT noticeStale contract now covers the parse path exactly as it covers the reject path.
303. Evidence: unit layer (test/tui-hud.test.tsx boundary matrix re-pinned to the width−6
     arithmetic: 94/96/99/100/101/102 and 116/117/122/123/124/125), render layer
     (test/tui-render.test.tsx: the pinned-goal roomy width moved 100→103). No new test
     functions — marker unchanged at 820. A2's call-site closure lives in plugin setup (cannot
     mount headlessly, same constraint as CT); its evidence is the unchanged StatusDialogBody
     noticeStale render contract plus the source diff. Live TUI remains unverifiable (dead provider).

Marker unchanged: files=43 tests=820. No version bump, no tag, no push; v1.1.0 remains the live
public artifact; all work is local on dev. No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (820 pass, spec-check ok),
coordinator submit + merge-next, bun run check on dev shown green at the end.
## Workstream CY — the chrome glyph family demotes under reduced color (2026-11-17)

Interpretation of this iteration: audit finding A4 (fresh pinned re-audit at dev HEAD fdd6544,
ses_e1c980f2fffeR6lPzktJKz2sQs) — the goal marker (◎ GOAL_GLYPH) and the copy acknowledgment
(✓ copied) were the one glyph family CU left behind: under TERM=dumb/NO_COLOR every sibling
(bars, sparkline, pips, carets, verdicts, the rail's running row) already demoted, so a
dumb-terminal user saw the pill and the dialog as a broken glyph with no demoted counterpart.

304. src/core/format.ts: new GOAL_GLYPH_ASCII ("*") and goalGlyph(ascii). src/core/hud.ts:
     pillModel and terminalPill take the ambient ascii predicate and paint `*` on reduced-color
     surfaces (terminalPill gained an optional `ascii` parameter, default false — back-compat);
     LANDING_SUFFIX gained an ASCII arm LANDING_SUFFIX_ASCII (" · landed +", identical 11-cell
     width, so the pill budget math is untouched) exposed via landingSuffix(ascii).
305. src/hud-card.tsx: the card title paints via goalGlyph(motionDisabled(process.env) || mono());
     footerCopyLabel gained an optional ascii parameter ("+ copied") — both acknowledgment labels
     measure the same cells (footerButtonCells identical), so the CV/CX footer tier arithmetic is
     state-independent by construction. src/tui-history.tsx: the rail's running-row goal marker
     paints goalGlyph(ascii()) instead of a raw ◎ literal, and RailSummary's in-modal copy
     acknowledgment demotes to " + copied". src/status-dialog.tsx: the condition/evaluator row
     acknowledgment demotes the same way (ascii = env || mono prop). src/tui.tsx: the dialog header
     marker, the notice-title marker, and the landing acknowledgment suffix all thread the
     motionDisabled(process.env) predicate (the pill's budget offset reads landingSuffix().length —
     identical cells on either surface).
306. Evidence: unit layer (test/tui-hud.test.tsx, 2 new tests): goalGlyph/landingSuffix/footerCopyLabel
     ASCII arms with width parity, and ASCII pill/terminal-acknowledgment leading glyphs. Render layer
     (test/__snapshots__/tui-snapshots.test.tsx.snap): the two reduced-color frames re-pin — HudCard ·
     mono paints `* /goal-loop` in the border title, LoopSection · ASCII paints `*` in the running row.
     Marker bumped files=43 tests=820 → files=43 tests=822 (2 new test functions, same commit). The
     remaining ✓ uses (verdict glyphs, the trail) were already demoted by CU. Live TUI remains
     unverifiable (dead provider).

Marker bumped files=43 tests=820 to files=43 tests=822. No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (822 pass, spec-check ok),
coordinator submit + merge-next, bun run check on dev shown green at the end.
## Workstream CZ — the verdict-mix memo lives in the component, not the module (2026-11-17)

Interpretation of this iteration: audit finding A3 (fresh pinned re-audit at dev HEAD fdd6544,
ses_e1c980f2fffeR6lPzktJKz2sQs) — the CW identity memo was a module-global single slot: the
completed loop's verdict arrays leaked for the plugin's process lifetime, the slot thrashed between
any two live readers, and the identity-key invalidated on every reactive rebuild anyway — built for
the render hot path, yet nearly useless there, while still retaining memory.

307. src/core/history.ts: iterationVerdictMix is pure again — the module-global mixCache is gone.
     The O(h + n) sliding-window algorithm and the non-monotone filter fallback are unchanged.
308. src/tui-history.tsx: LoopSection holds the result in a scoped solid-js createMemo keyed on the
     reactive snapshot reads (props.goal.history, the loopHistory slice memo, props.goal.setAt).
     Cache lifetime is the mount, invalidation rides the same signal the render already tracks, and
     the allocation never outlives the dialog that reads it.
309. Evidence: unit layer (test/history.test.ts): the module-global identity pin (toBe) is
     converted to a determinism pin (toEqual across calls and across fresh history refs); the
     O(h + n) getter-counter proxy and the non-monotone fallback test are untouched and green.
     Render layer: the existing LoopSection suite and the two reduced-color frames render green
     unchanged. Marker unchanged at files=43 tests=822 (one test converted, none added).
     Live TUI remains unverifiable (dead provider).

Marker unchanged: files=43 tests=822. No version bump, no tag, no push; v1.1.0 remains the live
public artifact; all work is local on dev. No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (822 pass, spec-check ok),
coordinator submit + merge-next, bun run check on dev shown green at the end.
## Workstream DA — the why ledger: the evaluator's most recent reasons, inline (2026-11-17)

Interpretation of this iteration: the verdict trail says *what* the evaluator concluded;
the evaluator row says why for the latest one. The three verdicts before a resume are the
context a human needs to trust the loop — so the trail grows a why ledger underneath it.

310. src/tui-history.tsx: new WhyLedger — at most the three most recent verdicts whose
     reason is non-empty, oldest first (the trail's own direction). One row per verdict:
     verdict glyph (CU-demoted under reduced color), verdict word, turn, relative time
     (reusing nowMs()), reason truncated at 400 cells. The first row carries the faint
     LABEL column ("why"); later rows keep the column for alignment. Click-to-copy when
     the caller wires onCopyReason (button 0 only, stopPropagation, same grammar as the
     condition/reason/summary rows: hover underlines + a faint copy hint, a transient
     " ✓ copied"/" + copied" suffix rides the row for 1.6s). Empty-reason verdicts are
     filtered before the limit is applied, so an empty row never spends a slot.
311. Wiring: VerdictTrail (shared by LoopSection and HistoryBlock) gains onCopyReason and
     nowMs and renders WhyLedger below the trail row. LoopSection and HistoryBlock gain
     the same optional props (HistoryBlock defaults nowMs to Date.now()); status-dialog
     threads both through, so the host's single onCopyReason wiring feeds the ledger, the
     evaluator row and the context menu unchanged.
312. Evidence: render layer (test/tui-render.test.tsx, 4 new tests): at most three
     non-empty rows, newest last, glyph/verdict/turn/relative-time/reason content,
     click-to-copy flipping the row to ✓ copied, inert clicks without onCopyReason, and
     the empty-transcript degradation (no why rows; the trail still paints). Render layer
     (test/__snapshots__/tui-snapshots.test.tsx.snap): the six named frames with non-empty
     verdict history re-pin with the ledger rows under the trail (LoopSection · met,
     StatusDialogBody · hot / paused / judged impossible, LoopSection · zero-tool,
     LoopSection · ASCII) — 36 changed lines, nothing else moved. Marker bumped
     files=43 tests=822 → files=43 tests=826 (4 NEW test functions; in-place .snap re-pins
     do NOT bump the marker). Live TUI remains unverifiable (dead provider).

Marker bumped files=43 tests=822 to files=43 tests=826. No version bump, no tag, no push;
v1.1.0 remains the live public artifact; all work is local on dev. No docs line references
were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (826 pass, spec-check
ok), coordinator submit + merge-next, bun run check on dev shown green at the end.
## Workstream DB — keyboard parity: the evaluator reason gets its chord (2026-11-17)

Interpretation of this iteration: DA shipped mouse affordances for copying verdict reasons
(the evaluator row and the why-ledger rows) but no keyboard path — the dialog keymap layer
carried only p (pin), c (copy condition), x (older iterations) and the scroll chords. The
dialog is a mouse-first surface that must still honor the keyboard-parity bar; the palette
already discovers host chords, so a chord here is undiscoverable only to the idle.

313. src/tui.tsx: a new dialog-keymap command goal.status.copy-evaluator-reason binds "r"
     (enabled only while the status dialog is open, like its siblings) to the same payload
     the evaluator/reason row copies: entries()[s]?.goal?.reason, the host's clipboard
     wiring with the "reason" label, and the shared in-modal flash (statusCopied — the
     footer's copy button flips to ✓ copied for a beat, since host toasts do not render
     above the modal). No-ops silently when the reason is absent, mirroring c. The per-row
     why-ledger reasons stay mouse-only by design: they are the same session's history, the
     evaluator row carries the latest payload, and one chord cannot name five rows —
     keyboard users get the highest-value one; the mouse gets the rest.
314. The footer hints are deliberately unchanged: extending DIALOG_FOOTER_SHORT_HINT would
     push the 80-column row past its measured budget; the full hint would hide r below the
     width tier where it is advertised. Both hints stay cell-exact; discovery is the command
     palette, exactly as for c/p/x. Source-verified only — keymap layers mount in the
     plugin's slot context, not headlessly; the render-corpus tests pin the row itself.

Marker unchanged: files=43 tests=826 (no new test functions; keymap layers are source-verified
with the live TUI unverifiable — dead provider). No version bump, no tag, no push; v1.1.0
remains the live public artifact; all work is local on dev. No docs line references were touched
by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (826 pass, spec-check
ok), coordinator submit + merge-next, bun run check on dev shown green at the end.
## Workstream DE — the dumb-terminal sweep: no raw Unicode on the reduced-color surface (2026-11-17)

Interpretation of this iteration: a fresh pinned re-audit (ses_e1c260c0fffeCdIaXB9JoDJ84I) of dev at 6701719
found the last surviving dumb-terminal glyph leaks and two dead-code/guard nits — the reduced-color
guarantee (NO_COLOR / TERM=dumb; weight and glyph shape carry all meaning) had been shipped for every
glyph family except this one. This workstream closes the family; it does not re-audit or re-ship anything else.

315. truncate() (src/core/format.ts) gains an `ellipsis` parameter (default "\u2026" — behavior for
     every existing caller unchanged). The ellipsis's OWN WIDTH is now reserved in the cell budget
     (stringWidth(ellipsis), not a flat 1), so a 3-cell "..." never paints past `max`. Threads through:
     fitLadder (pill degradation; hud.ts), pinSuffix (pill pin; hud.ts, ascii arm via the caller in
     tui.tsx), the card's condition row (hud-card.tsx CONDITION_MAX), the rail summary
     (tui-history.tsx SUMMARY_MAX), the why-ledger reason (WHY_REASON_MAX). Callers pass "..." under
     their ascii() predicate; fitLadder receives the ellipsis from pillModel's existing ascii param.
     formatStatus() (the plain-text `/goal` report, not TUI chrome) deliberately keeps the Unicode
     ellipsis and documents why.
316. Rail connector demoted: RailSummary paints `|` (not U+2502) under ascii() (tui-history.tsx).
     Fold-row label demoted: `...` (not U+2026) (tui-history.tsx). Sparkline caption arrow demoted:
     oldest->newest (not U+2192) (tui-history.tsx). Streak suffixes and remediation copy paint an
     ASCII `x` for U+00D7 and an ASCII hyphen-minus for U+2014 (tui-history.tsx streak suffix, hud.ts
     remediationFor) — unconditionally: both substitutes are width-1 in every terminal and lose no
     information, so no per-surface branch is carried.
317. status-dialog.tsx snapshot-unavailable notice and the rail fold row's "older iterations" affordance:
     em-dashes replaced by " - " (unconditional ASCII). U+00B7 middle-dot separators (formatSpend, the
     dialog footer hints, the pill/card/dialog `·` joins) are EXPLICITLY TOLERATED as Latin-1-safe
     chrome: they are one-cell separators with no meaning-bearing shape, decode identically in every
     terminal that can render ASCII text, and demoting them would cost dozens of per-site branches for
     zero legibility gain. This is the documented exception to the reduced-color glyph rule, not an
     oversight.
318. Dead code deleted: monochrome() (hud.ts) was a byte-identical duplicate of motionDisabled()
     with no call sites outside its own test block; deleted with the test. The block is gone, not
     re-pointed — motionDisabled already pins the same predicate table.
319. Finding 8 (loopMaxLoops not isFinite-guarded in hud-card.tsx:317, hud.ts:175, hud.ts:234) verified
     MOOT at the source of truth: src/core/wire.ts validates loopMaxLoops with isFiniteNumber (typeof
     number && Number.isFinite), as it does for turns/elapsedMs — /Infinity can never arrive from the
     wire. No guards were added; nothing was weakened.
320. Finding 9 (the why ledger's mono arm was unpinned): new render test pins HistoryBlock under
     mono: the ✓ copied ack
     demoted to + copied, and no ✓ leaking onto a dumb surface (test/tui-render.test.tsx). Evidence is
     render-layer only; live TUI remains unverifiable (dead provider).
321. Four named frames re-pinned PROGRAMMATICALLY (TZ=UTC + bun's multiline-string framing): HudCard ·
     failed, HudCard · paused at the turn cap, StatusDialogBody · paused at the turn cap, LoopSection ·
     ASCII (rail connector now `|`). Nothing else in the corpus moved. Marker files=43 tests=826
     UNCHANGED: one test function deleted (monochrome), one added (the mono why-ledger pin); the
     in-place pinSuffix ascii assertion extends an existing function.

Marker unchanged: files=43 tests=826. No version bump, no tag, no push; v1.1.0 remains the live public
artifact; all work is local on dev. No docs line references were touched by this workstream.

Verification (all run in the worktree): bun run compile, bun run check (826 pass, spec-check ok),
coordinator submit + merge-next, bun run check on dev shown green at the end.
## Workstream DF — the pill budget is measured, not guessed (2026-11-16)

Interpretation of this iteration: the fresh re-audit at 156ac95 (ses_e1c165f9bffeO63MgcCyzplP0z) was
re-run in full by the parent; its three verifiable findings were all in the pill's cell-budget accounting
and all three are closed here. Nothing else was shipped; the reduced-color sweep (DE) and every earlier
slice stay untouched.

322. The ambient pill's landing-suffix deduction is measured in CELLS, never code units:
     tui.tsx computes the budget with stringWidth(landingSuffix()) instead of landing().length, and the
     landingNow()/landingSfx() helpers are hoisted ABOVE pill() so pill()'s closure no longer reaches a
     const declared after it (a definition-order fragility — any future createMemo(pill) would have hit a
     TDZ ReferenceError). The suffix is all 1-cell glyphs in both arms, so paint output is unchanged at
     every width; the contract now matches the measurement used everywhere else.
323. terminalPill() (src/core/hud.ts) gains an optional 4th parameter `budget` (cells). When provided and
     the armed acknowledgment text would exceed it, the text truncates to the budget with the surface's
     ellipsis (`\u2026`, or `...` under ASCII) instead of painting past the row — the same contract
     pillModel honors. tui.tsx passes the SAME budget it computes for the live pill, so the frozen
     acknowledgment gets the same cell guarantee. Absent budget keeps the byte-compatible output.
324. New render-adjacent unit test pins the budget arm: over-budget acks end with the surface ellipsis
     and measure <= budget cells (both arms); a fitting budget and an absent budget are byte-identical.
     Marker files=43 tests=827 (one NEW test function; the landingSuffix arms assertion is extended in
     place and adds no function).

Verification (all run in the worktree): bun run compile, bun test test/tui-hud.test.tsx (100 pass),
bun run check (0 fail, spec-check ok at 43/827), coordinator submit + merge-next, bun run check on dev
shown green at the end. Evidence is source + predicate layers only; live TUI remains unverifiable.
## Workstream DG — the ellipsis never paints wider than the cap it decorates (2026-11-16)

Interpretation of this iteration: while shipping DF, a contract violation in truncate() became verifiable
(and was verified this slice): when the caller's ellipsis is wider than `max` itself, the content budget
(`max - stringWidth(ellipsis)`) goes negative, the grapheme loop emits nothing, and the function returns
the BARE ellipsis — 3 cells at max=2, 3 cells at max=1 under the ASCII arm — past the cap the function
exists to enforce. DE had threaded the parameter; nothing yet bounded the ellipsis against the cap.

325. truncate() (src/core/format.ts): when `stringWidth(ellipsis) >= max`, the function emits whole
     graphemes of the ellipsis up to `max` cells (the width contract wins over showing an ellipsis).
     The default U+2026 (1 cell) never hits this arm for max >= 1; the arm exists for the 3-cell `...`
     on reduced-color surfaces, where pill budgets can legitimately shrink to 1-2 cells at an 80-column
     floor under the new call sites.
326. fitLadder's and pillModel's doc comments now say "the caller's ellipsis / the surface's ellipsis"
     where they unconditionally claimed U+2026 — comments match the threaded parameter. No behavior,
     budget, ladder order, or snapshot changed: the fix only fires where the old output would have
     exceeded `max` cells, and no pinned frame paints an ellipsis at that width.
327. Existing truncate test extended IN PLACE (no new test function): pins `truncate("hello", 2, "...")`
     -> "..", `truncate("hello", 1, "...")` -> ".", stringWidth bound asserted, and the default U+2026
     arm untouched (truncate("hello", 1) === "…"). Marker files=43 tests=827 UNCHANGED.

Verification (all run in the worktree): bun run compile, bun test test/core.test.ts (86 pass),
bun run check (0 fail, spec-check ok at 43/827), coordinator submit + merge-next, bun run check on dev
shown green at the end. Evidence is source + predicate layers only; live TUI remains unverifiable.
## Workstream DH — the last unconditional painted em-dash leaves the reduced-color surface (2026-11-16)

Interpretation of this iteration: a full painted-glyph enumeration at 49e625c (every non-ASCII char in
src/, comments excluded, each triaged against an ascii()/motionDisabled arm) found exactly one remaining
unconditional chrome leak — an em-dash in EVALUATOR_HINT_FULL, the dialog's teaching-row copy. It had
been visible in the DE enumeration output and was missed then; this slice closes it. Everything else
enumerated routes through an ascii arm already (BAR/PIP arms, spark gap/truncation, verdict glyphs, the
pill caret, copied suffixes, the rail connector/caption/fold label, truncations, the card's copied ack),
is an U+00B7 middle dot (documented tolerated, clause 317), or is plain-text surface (formatStatus,
notify/toast text, LLM-facing prompts, model-authored reasons) which DE and this audit both leave alone.

328. EVALUATOR_HINT_FULL paints " - " (ASCII hyphen) instead of U+2014 — unconditional, width-1,
     information-preserving (DE doctrine). Marker unchanged: no test function added or removed; the
     string is pinned by identity (toBe(EVALUATOR_HINT_FULL)), and the one named frame carrying the
     text (StatusDialogBody · freshly armed) was re-pinned PROGRAMMATICALLY (TZ=UTC), touching exactly
     the hint row. Marker files=43 tests=827 UNCHANGED.

Verification (all run in the worktree): bun run compile, bun test tui-snapshots (21 pass), bun run
check (0 fail, spec-check ok at 43/827), coordinator submit + merge-next, bun run check on dev shown
green at the end. Evidence is source + render layers only; live TUI remains unverifiable.
## Workstream DI — the loop's ledger names the commit each iteration landed on (2026-11-16)

Interpretation of this iteration: the armed goal asks the ledger to show, per iteration, the commit sha
("per iteration a row — iteration #, tool-call count, verdict, one-line reason, time, commit sha"). The
iteration rail (tui-history.tsx) painted version, verdict, turns, tools, duration, verdict mix, ended
time and % of wall, but nothing anchored a finished iteration to the codebase state it produced. This
slice stamps the sha HEAD had landed on when the iteration was recorded, carries it additively on the
record and the wire, and paints it on the rail row.

329. `LoopEntry` gains an additive `readonly sha?: string`. The loop-advance path (the only place entries
     are built, `makeEntry` in src/runtime/controller.ts) reads HEAD once per advance via the new pure
     `headSha(gitDir)` in src/core/git.ts and stamps it; outside a repository, on an unreadable HEAD, or
     when ref resolution fails, the field stays absent — the ledger never guesses. `headSha` resolves a
     detached HEAD to its hex, an attached HEAD to the loose ref and then `packed-refs`/commondir, and
     never throws (PREVIEW: the function is package-internal, no new public surface). The wire parser
     (`isLoopEntry` in src/core/wire.ts) accepts an optional string `sha` and rejects non-strings —
     additive tolerance, no version bump, legacy records unchanged.
330. The iteration rail row appends ` · <7-char sha>` only when a stamp is present (same text node as the
     existing ended/share suffixes; wraps, never clips; byte-identical frames for unstamped entries).
     Rendered statically — the armed condition asks for the sha to be *shown*; the row already carries
     non-interactive suffixes, so no new unmarked interactivity is introduced.
331. Tests: one new `headSha` case in test/git.test.ts (loose/packed/detached/missing/unreadable, never
     throws), one new wire acceptance/rejection case in test/wire.test.ts, one new end-to-end stamp case
     in test/loop.test.ts (entry recorded inside a fake repository carries the loose-ref sha), one new
     render case in test/tui-render.test.tsx (the rail paints the stamped short sha; unstamped frames
     do not). Spec-check marker files=43 tests=827 -> 831. One subtlety: src/runtime/controller.ts gained
     its import merged onto an existing import line so the docs-line-refs contract (docs/index.html and
     docs/runtime.html anchor src/runtime/controller.ts:68 at a non-blank line) held without touching
     the off-limits docs/.

Verification (all run in the worktree): bun test (831 pass), bun run compile, bun run check end-to-end
green incl. spec-check (43/831), docs-watch companion + changelog grep before submit. Evidence is source
+ render + loop-advance layers only; live TUI remains unverifiable. Follow-ups NOT done in this slice:
already-satisfied-at-HEAD blue tone (met + zero tools), per-iteration cost attribution, cross-session
overview, the C1 card why-row, the card context meter row, the measured card width.
## Workstream DJ — hover never underlines: weight and brightness carry the affordance (2026-11-16)

Interpretation of this iteration: the user reviewed the live TUI and rejected the hover grammar
("i don't like how you make mouse hover. underline the text") with a screenshot of the ambient pill.
Every one of the TUI's ten hover sites painted TextAttributes.UNDERLINE on mouse-over — the pill,
the dialog condition/reason rows, the card condition row, the rail summaries, the why-ledger rows,
the rail fold row, the two mono-only buttons, and the dialog esc affordance. This slice removes
underline from the hover grammar entirely.

332. `TextAttributes.UNDERLINE` no longer appears anywhere in src/ (grep -rin "underline" src/
     returns nothing). Hover is
     now carried by the two signals the theme already uses elsewhere: a brightened foreground
     (faint/muted -> text.base, unchanged) and TextAttributes.BOLD — a weight, not a color, so it
     survives NO_COLOR / TERM=dumb unchanged. Sites swept: ambient pill (tui.tsx, hover bold unioned
     with the evaluating/hot pulse bold), dialog condition & reason rows, card condition row,
     rail summaries, rail fold row, why-ledger rows, dialog esc affordance (tui.tsx), and the two
     mono-gated sites (HudButton, HudMenuRow) which now bold under mono while the color arm keeps
     its raised-background swap (unchanged).
333. The shared hover grammar is pinned by a new render test ("hover grammar: weight, never
     underline (NO_COLOR-safe)" in test/tui-render.test.tsx): it hovers the condition row with the
     mock mouse and asserts zero UNDERLINE bits set on any span in the frame — resting, hovered,
     and after mouse-out — plus BOLD on the hovered condition span and its absence at rest.
     Render-layer evidence only; live TUI remains unverifiable. Spec-check marker files=43
     tests=831 -> 832. No snapshot drift (hover is never painted in snapshot fixtures).

Verification (all in the worktree): bun test (832 pass), bun run compile, bun run check end-to-end
green incl. spec-check (43/832), docs-watch companion + changelog grep before submit. Evidence is
source + render layers only; live TUI remains unverifiable. Follow-ups NOT done in this slice:
other hover affordances that rely on color alone in the color arm, the C1 card why-row, the card
context meter row, the measured card width.

## Workstream DK — the compact card carries the context gauge (2026-11-16)

Interpretation of this iteration: the armed condition names a context-size meter as part of the
ambient information hierarchy, but until now the estimate lived only in the full dashboard overlay
(status-dialog.tsx). The compact card — the level-b surface the eye actually lands on at a glance —
showed condition, state, spend and verdict but not how full the window is. This slice paints the
same gauge on the card.

334. The compact HUD card (src/hud-card.tsx) paints a `context` row directly under the spend row,
     reusing `contextMeter` + `CONTEXT_BAR_CELLS` from src/core/history.ts (the identical computation
     the dashboard overlay reads, so the two surfaces never disagree): LABEL column (10 cells),
     the 16-cell bar, then `~<size> of <threshold> · <pct>%` (`~<size> tokens`, no bar, when the
     auto-compact threshold is disabled). Hot band (ratio >= CONTEXT_HOT_RATIO = 0.8) paints the
     warning tone on bar and trailing copy; mono drops chromatic accents to text.base / text.muted
     and the ASCII arm paints `#`/`-` via the existing `ascii()` gate. Omitted entirely when the
     server cannot estimate (`contextSize` absent — same contract as the overlay row).
335. The context row joins `cardRowPlan` as a droppable optional rung, placed after spend and before
     the last-verdict row: under a viewport ceiling the drop order is now teaching hint -> spend ->
     context -> last -> remediation (the final rung). `CardRowPlan` carries a new `context: boolean`
     field; `hudCardRows` arithmetic and the mount anchor flow through unchanged (the mount never
     reads the field set — it reads `rows`). Pinning tests in test/tui-hud.test.tsx (two new
     functions: the one-row growth with spend/hint/no-verdict fixtures, and the ceiling drop order,
     ending in the `cardRowPlan` shape match) and test/tui-render.test.tsx (six new functions: bar +
     honest ratio, the hot band, the mono ASCII arm, the bare estimate without a threshold, the
     omitted row without an estimate, and the painted drop order under a ceiling — context kept after
     hint+spend drop, context dropped before the last-verdict row survives). No snapshot drift
     (snapshot fixtures carry no contextSize). Spec-check marker files=43 tests=832 -> 840.

Verification (all run in the worktree): bun test (840 pass, 0 fail, 21 snapshots byte-stable),
bun run compile, bun run check end-to-end green incl. spec-check (43/840), docs-watch companion +
changelog grep before submit. Evidence is source + render layers only; live TUI remains unverifiable.
Follow-ups NOT done in this slice: the C1 card why-row, the measured card width, per-iteration
spend attribution, cross-session overview.

## Workstream CE — the card's why row: the evaluator's reason, on the surface you see (2026-11-16)

Interpretation of this iteration: the compact card answered "what did the evaluator decide" (the
last-verdict row) but never "why" — the reason was reachable only by opening the dialog or the
context menu. The host has wired `onCopyReason` into the card mount since the card gained its
props (tui.tsx), and the props doc promised "absent callback renders the reason row inert" — a
contract that existed nowhere. This slice paints the why row and finishes that promise.

336. src/hud-card.tsx paints a `why` row directly under the last-verdict row: the evaluator's
     one-line reason, whitespace-collapsed (`reason.replace(/\s+/g, " ").trim()`), painted
     `wrapMode="none"` and truncated to the condition cell budget (42 cells, `truncate` with the
     same ellipsis arms), LABEL column 10 cells. When the host wires `onCopyReason` the row is a
     click-to-copy affordance mirroring the condition row: on hover it brightens the foreground
     (muted -> base) and sets TextAttributes.BOLD (a weight, never an underline, so the grammar
     survives NO_COLOR/TERM=dumb), shows the `copy` hint, and a left-button mouseUp copies the
     collapsed text through the host's clipboard+toast path; `event.stopPropagation()` keeps the
     card-menu toggle from firing. Absent the callback the row paints inert — no handlers, no
     hover attributes, no hint — exactly the contract the dialog's evaluator row documents. When
     `reason` is absent or whitespace-only the row is omitted entirely.
337. The why row joins `cardRowPlan` as a droppable optional rung after the context row and before
     the last-verdict row: under a viewport ceiling the drop order is now teaching hint -> spend ->
     context -> why -> last -> remediation (the final rung). `CardRowPlan` carries a new
     `readonly why: boolean`; `hudCardRows` arithmetic and the mount anchor flow through unchanged.
     Tests: two new plan-arithmetic functions (tui-hud.test.tsx — one-row growth with spend/hint/
     no-verdict fixtures, blank-reason omission, and the ceiling drop order ending in the
     `cardRowPlan` shape match) and six new render functions (tui-render.test.tsx — whitespace
     collapse, click-to-copy via the mock mouse, inert-without-callback with an inert click,
     blank-reason omission, ellipsis truncation at the 42-cell budget, and the painted drop order:
     why kept at a one-row-short ceiling after context drops, why gone a row further down, last
     surviving both). Two existing render tests re-pinned (+1 ceiling step). Nine HudCard
     full-frame snapshots re-pinned programmatically under TZ=UTC (`bun test --update-snapshots`,
     diff verified hunk-by-hunk: every change is the added why row plus one consumed trailing pad).
     The card mount wiring (tui.tsx passes onCopyReason into the card) is unchanged from the prior
     slice — this workstream only completes the surface it feeds.
     Spec-check marker files=43 tests=840 -> 848.

Verification (all run in the worktree): bun test (848 pass, 0 fail, 21 snapshots re-pinned and
byte-stable at the new frames), bun run compile, bun run check end-to-end green incl. spec-check
(43/848), docs-watch companion + changelog grep before submit. Evidence is source + render layers
only; live TUI remains unverifiable. Follow-ups NOT done in this slice: the measured card width,
per-iteration spend attribution, cross-session overview.

## Workstream CI — the dialog's elsewhere block: who else is running a loop in this project (2026-11-16)

Interpretation of this iteration: every TUI surface so far served exactly one session — the one whose
dialog or card you are looking at. The plugin already answers `list` over RPC (server controller.list(),
restore-read-through on an empty map) and the contract ships it to every client, but no surface painted
it. The result: a second session in the same project can hold an armed loop for hours and the user has
no glanceable signal short of opening that session. This slice paints the read-only truth.

338. src/core/wire.ts gains parseListGoalOutput: narrows the `list` RPC envelope (`{goals: unknown[]}`)
     to GoalSnapshot[], dropping malformed entries one by one (a single corrupt record must not hide
     every other live goal); undefined only when the envelope itself is unrecognizable. src/tui.tsx
     gains a setup-scope `others` signal + refreshOthers (rpc.list({}), parse, no-throw posture),
     refreshed when the /goal dialog opens and whenever any goal `changed` event lands while the
     dialog is open; TUI-local, never stored, excluding nothing at refresh time (the dialog body
     filters its own session so the component is safe standalone). `sessionLabel` resolves a session
     id to its host title via context.data.session.get(id)?.title (the client SessionInfo carries
     `title`, not `slug`), falling back to the id; the dialog caps display at 12 cells with a trailing
     ellipsis.
339. src/status-dialog.tsx gains the `elsewhere` block below the history sections: header row
     (`elsewhere` + "N other session[s] holding live goals"), one row per other LIVE session
     (active | paused — the same predicate the controller and store use; failed/achieved/cleared
     are terminal, never listed), reading the same state grammar as the rest of the dialog: accent
     dot (●/‖, or * under mono — weight never hue carries the signal), host title truncated at 12
     cells with ellipsis (raw ids never paint), loop position (`v2/5`) or the bare state word,
     whitespace-collapsed condition truncated at 34 cells. Rows carry no handlers, no chords —
     session switching is the host's business; the block is awareness, not control. The block is
     omitted entirely when empty (no visual noise on the common single-session path), caps at 4
     rows + a faint `+N more` line, and prints singular "1 other session" at exactly one. Tests:
     three new render functions (test/tui-render.test.tsx — row paint + own-session/terminal-goal
     exclusion + raw-id absence, the singular noun, and the empty/absent omission). Snapshot
     fixtures mount the dialog without `others`, so all full-frame snapshots stay byte-stable.
     Spec-check marker files=43 tests=848 -> 851.

Verification (all run in the worktree): bun test (851 pass, 0 fail, 21 snapshots byte-stable),
bun run compile, bun run check end-to-end green incl. spec-check (43/851), docs-watch companion +
changelog grep before submit. Evidence is source + render layers only; live TUI remains
unverifiable. Follow-ups NOT done in this slice: the measured card width, per-iteration spend
attribution, the already-satisfied-at-HEAD blue tone.

## Workstream CJ — satisfied-at-HEAD: a zero-tool met iteration paints blue, not gray (2026-11-16)

Interpretation of this iteration: the loop rail painted every completed iteration with zero tool
calls in the faint muted bucket under the tag "inspection only" — but zero tool calls means NO
inspection happened either; the evaluator found the condition already satisfied at HEAD and the
iteration advanced without work. The design bar asks for a third ledger distinction:
work produced / already-satisfied-at-HEAD (blue) / zero-tool muted. This slice repaints that row
to the palette's info/blue accent (the host maps info to cyan, tokyonight's info is a blue; the
plugin's narrowed theme subset carries text.feedback.info.base only) and relabels the tag. The
yellow state-inspection lane stays unimplementable without a per-iteration change-detect signal
the wire does not carry — documented here rather than faked.

340. src/tui-history.tsx iteration rail: a met iteration with toolCalls === 0 paints the hollow
     glyph (. mono / ○ color — shape carries the zero-work signal) in text.feedback.info.base,
     the row text paints text.muted (color) / text.base (mono), and the row tag reads
     "no tools · already satisfied at HEAD" (was "inspection only"). Work-produced rows
     (toolCalls > 0) keep the solid check and the base row tone; the two classes stay
     distinguishable by glyph shape, row tone and the tag in every arm. The verdict trail and
     the why ledger carry turn-level verdicts only (no toolCalls on VerdictEntry), so the
     classification lands on the iteration rail only; the trail keeps verdict-accent glyphs.
     REDUCED-COLOR arm: mono drops the hue entirely — the ./○ shape, the muted->base text and
     the tag string carry the signal; the new mono test pins all three.
341. Tests: the existing zero-tool rail test is re-pinned in place (same test count), the
     snapshot test is renamed to the satisfied-at-HEAD wording and re-pinned under TZ=UTC
     (suffix wrap re-flows one line; no other frame drifts), and one new mono-arm test is added
     (tui-hud.test.tsx) — spec-check marker files=43 tests=851 -> 852. Evidence is source +
     test-render layers; no live TUI claim. Follow-ups NOT done in this slice: per-iteration
     spend attribution, the measured card width, the blue tone in the verdict trail (needs a
     toolCalls field on VerdictEntry, server-side).

Verification (all run in the worktree): bun test (105 pass in tui-hud.test.tsx, 21 pass in
tui-snapshots.test.tsx, full suite in bun run check), bun run compile, bun run check end-to-end
green incl. spec-check (43/852), docs-watch companion + changelog grep before submit.

## Workstream CK — per-iteration spend attribution: the rail names what each iteration cost (2026-11-16)

Interpretation of this iteration: the HUD could say what the goal spent in total, but not what each
loop iteration spent — the number a user needs to decide whether the loop is worth its cap. The
server already diffs cumulative usage against the goal baseline for goal-level spend; the same
diff works per iteration if an arm-time snapshot is kept on the runtime. This slice stamps it.

342. src/core/types.ts — LoopEntry gains `readonly spend?: UsageSnapshot`: the arm→advance usage
     delta attributed to that iteration alone. src/runtime/controller.ts — Runtime carries
     armUsage (runtime-local, like iterationToolCalls; a restored runtime drops it). arm()
     stamps armUsage with the MEASURED cumulative usage at loop arm (an unmeasured arm stamps
     nothing); loopAdvance() fetches the cumulative usage once at the advance (best-effort, same
     posture as the context estimate), stamps the entry with diffUsage(advance, arm) and re-arms
     armUsage for the next iteration. A met iteration whose arm or advance could not measure
     records no spend — absent, never estimated, never fabricated.
343. src/core/wire.ts — isLoopEntry validates the additive spend snapshot when present (cost /
     input / output / reasoning / cacheRead / cacheWrite must be finite numbers). src/core/format.ts
     exports formatCost (was private). src/tui-history.tsx — the loop rail row appends
     ` · $x.xx` (formatCost, only when cost > 0) after the sha; omitted otherwise. TUI carries
     the cost only — the rail row is tight.
344. Tests: loop.test.ts gains the setUsage harness hook and two cases (an entry is stamped with
     the arm→advance delta, each iteration measured from its own arm, and an entry records no
     spend when the advance cannot measure usage); wire.test.ts gains the spend accept/reject case;
     tui-hud.test.tsx gains two rail-row cases (cost painted when stamped, no $ when absent).
     docs/architecture.html's controller.ts line-399 anchor re-numbers to line 406 (armFromPrompt
     grew by seven lines) — carried in the docs: refresh companion, the one docs/ edit this slice
     forces.
     Spec-check marker files=43 tests=852 -> 857.

Verification (all run in the worktree): bun test (857 pass, 0 fail, 21 snapshots byte-stable),
bun run compile, bun run check end-to-end green incl. spec-check (43/857) and the docs
line-reference guard, docs-watch companion + changelog grep before submit. Evidence is source +
test-render layers; live TUI remains unverifiable. Follow-ups NOT done in this slice: the
measured card width, the satisfied-at-HEAD tone in the verdict trail (needs a toolCalls field on
VerdictEntry, server-side), per-turn spend in the why ledger.

## Workstream CL — satisfied-at-HEAD, turn level: the zero-work met verdict paints hollow everywhere (2026-11-16)

Interpretation of this iteration: CJ taught the loop rail to paint a zero-tool met iteration as
satisfied-at-HEAD (hollow glyph, info/blue accent, the 'already satisfied at HEAD' tag), but the
same fact reads solid ✓ in the verdict trail, the why ledger and the card's last-verdict row —
three surfaces contradicted the rail for the same landing. met already paints info.base (blue) in
verdictAccentColor, so the hue axis was taken; the open axis was glyph shape. This slice closes
it at the source: the evaluating turn's tool count rides the VerdictEntry, and every surface that
paints a verdict glyph reads it.

345. src/core/types.ts — VerdictEntry gains `readonly toolCalls?: number` (additive; records
     written before this change stay valid and paint as before). src/runtime/controller.ts —
     the history push stamps the turn's tool count (same `tools` value the loop's zero-tool
     machinery reads; line-neutral edit, no docs line-ref drift). src/core/wire.ts —
     isVerdictEntry validates toolCalls when present (finite number; absent tolerated).
346. src/core/history.ts — new verdictEntryGlyph(entry, ascii): a met verdict with
     toolCalls === 0 paints the hollow satisfied-at-HEAD glyph (color: ○, reduced-color/ASCII:
     .); every other case delegates to verdictGlyph unchanged. src/tui-history.tsx — the verdict
     trail, the why ledger and both last-verdict cells (loop section, compact history block)
     paint via verdictEntryGlyph. src/hud-card.tsx — the card's last-verdict row paints via
     verdictEntryGlyph (the card passed mono() as the ascii flag; it now passes its ascii()
     predicate, the same reduced-color grammar as the rest of the card). Mono arm drops the
     hue; shape and the tag-free row grammar carry the signal. The trail/why-ledger color stays
     verdictAccentColor (met = info blue) — the glyph carries the distinction.
347. Tests: history.test.ts gains a verdictEntryGlyph describe (4 cases: zero-work met hollow in
     both arms, worked met keeps ✓/+, pre-toolCalls entries paint the verdict glyph, not_met/
     impossible keep their glyphs at zero tools); wire.test.ts gains two cases (accept
     toolCalls absent/zero/seven; reject NaN/string); tui-hud.test.tsx gains four render cases
     (trail + why ledger hollow for a zero-tool met, worked met keeps ✓ and paints no ○, mono
     arm keeps the hollow ASCII shape, the card's last-verdict row paints hollow). Snapshot tail
     count unchanged (21, byte-stable). Spec-check marker files=43 tests=857 -> 867.

Verification (all run in the worktree): bun test (867 pass, 0 fail, 21 snapshots byte-stable),
bun run compile, bun run check end-to-end green incl. spec-check (43/867) and the docs
line-reference guard, docs-watch companion + changelog grep before submit. Evidence is source +
test-render layers; live TUI remains unverifiable. Follow-ups NOT done in this slice: the
measured card width, per-turn spend in the why ledger.

## Workstream CM — the card measures the terminal: fluid width, 64 cells exactly at the 80-column floor (2026-11-16)

Interpretation of this iteration: the HUD card was the one surface still hard-pinned to its
64-cell design number — the pill, the footer tier and the context menu all measure the terminal,
but the card asked no questions. On wide terminals users got a narrow panel in a dead gutter; on
terminals below 80 columns the card never compressed. The axis pushed here is responsiveness.

348. src/hud-card.tsx — new exported CARD_WIDTH_MIN (52) / CARD_WIDTH_MAX (88) and
     cardWidth(terminalWidth): floor(t) − 16, clamped to [52, 88]; NaN yields the conservative
     64-cell default; ±Infinity clamp to an edge; the 80-column floor reproduces the 64-cell
     design exactly (80 − 16 = 64), and every existing 80-column snapshot stays byte-stable.
     The HudCard root width becomes `props.width ?? cardWidth(dimensions().width)` — the
     explicit prop override is preserved for callers that pin. The REMEDIATION_WIDTH constant
     is gone: new exported remediationWidth(width) = max(24, width − 15) and conditionWidth(width)
     = max(20, width − 22) derive the wrap/truncate budgets from the resolved card width
     (border 2, padding 2, LABEL 10, gap 1, right hint slot 7). The condition and why-reason
     truncates use conditionWidth of the RESOLVED width; REMEDIATION_WIDTH's SPEC mention at
     line 2726 stands as the record of the 64-cell design at that commit.
349. height arithmetic is width-honest now: cardRowPlan/hudCardRows accept a trailing
     `width = 64` argument and wrap the remediation with remediationWidth(width), so the
     absolute mount's anchor (tui.tsx) matches the painted height on fluid widths.
     src/tui.tsx threads cardWidth(dimensions().width) into hudCardRows for the mount anchor.
350. Tests: tui-hud.test.tsx gains a cardWidth describe (3 cases: predicate pins including the
     80→64 contract and NaN/Infinity, hudCardRows remediation wrap shrinks with width — the
     88-cell hot remediation fixture needs fewer rows at 88 cells than at 52 — and a 120-column
     render showing the condition past the 42-cell default budget plus the width={64} override
     truncating). tui-render.test.tsx's why-row ellipsis case now pins width 80 render
     explicitly (the budget it asserts is the 64-cell design's) — a re-pin, not a new test.
     Spec-check marker files=43 tests=867 -> 870.

Verification (all run in the worktree): bun test (870 pass, 0 fail, 21 snapshots byte-stable),
bun run compile, bun run check end-to-end green incl. spec-check (43/870) and the docs
line-reference guard. Evidence is source + test-render layers; live TUI remains unverifiable.
Follow-ups NOT done in this slice: the pinned-pill width budget, a live check on an actual
120-column terminal.

## Workstream CN — per-turn spend in the why ledger (2026-11-16)

Interpretation of this iteration: CK stamped the arm→advance usage delta on each completed LOOP
iteration, but the per-turn layer — the verdict entries in the history — carried the evaluating
turn's tool count (CL) and nothing about what the turn cost. The why ledger is where the
evaluator's per-turn calls live; it now carries per-turn spend, measured, never estimated.

351. src/core/types.ts — VerdictEntry gains `readonly spend?: UsageSnapshot` (additive; records
     written before this change stay valid and paint as before). src/runtime/controller.ts —
     Runtime gains a runtime-local `turnUsage?: UsageSnapshot` (dropped on restore, like
     armUsage). arm() seeds it with the measured arm-time reading for EVERY goal (loop or not);
     evaluate() diffs the fetched cumulative usage against it (the arm-time reading seeds the
     first turn), stashes the new reading, and history.push stamps `spend: diffUsage(...)` when
     both sides measured. After a restore there is no previous reading, so the first recorded
     verdict carries no spend rather than a cumulative-since-set number — never estimated. A
     failed evaluation still advances turnUsage (the tokens were spent; the next turn's delta
     covers them, matching armUsage's posture). src/core/wire.ts — isVerdictEntry validates
     spend when present via the existing isUsageSnapshot (same narrowing as LoopEntry.spend).
352. src/tui-history.tsx — the loop rail's spend suffix (added by CK) is hoisted to module
     scope as spendSuffix and reused: the why ledger's muted furniture row appends ` · $x.xx`
     per verdict only when spend.cost > 0, the same paint-nothing-when-zero grammar as the
     rail. Format via formatCost. met stays blue (verdictAccentColor); no glyph/hue change —
     the cost rides the existing muted text. The verdict trail (glyph lane) is untouched.
353. Docs: `docs/index.html` + `docs/runtime.html` epoch anchors re-pointed at the current
     finish()/invalidate line after the controller grew; SPEC.md's historical audit refs to the
     controller (the A-1 and A-8 entries) are rephrased from bare `path:line` to prose
     ("line N (at audit time)") so the line-ref guard does not pin stale numbers as live refs —
     the audit text and resolutions are unchanged. Tests: controller.test.ts +2 (arm-seeded
     first-turn delta then per-turn deltas; absent spend when usage throws), wire.test.ts +2
     (accept spend / reject broken or partial spend), tui-hud.test.tsx +2 (both costs paint in
     the why ledger; a spend-free record paints no cost). Spec-check marker files=43
     tests=870 -> 876.

Verification (all run in the worktree): bun test (876 pass, 0 fail), bun run compile,
bun run check end-to-end green incl. spec-check (43/876) and the docs line-reference guard.
Evidence is source + test-render layers; live TUI remains unverifiable. Follow-ups NOT done in
this slice: per-iteration spend in the final tally, spend in the trail.

## Workstream CO — the three-way work ledger, hue arm: work produced green, state inspection amber, satisfied-at-HEAD blue (2026-11-16)

Interpretation of this iteration: CJ/CL took satisfied-at-HEAD to the glyph (hollow shape) and the
rail (blue info), but the objective's narrative-legibility grammar — work produced (green),
state inspection only (yellow), already-satisfied-at-HEAD (blue) — was still only two-thirds in
place. met painted info everywhere and not_met painted faint everywhere; a zero-tool not_met turn
(the loop inspecting state and making no progress) was indistinguishable from a worked not_met.

354. src/core/hud.ts — NeutralTheme gains an optional `success?: { readonly base: C }` (mirrors
     optional error; hosts without it paint exactly the pre-existing info). New exported
     verdictEntryAccentColor(theme, entry, mono): met with measured toolCalls > 0 paints
     success (green) falling back to info; met with toolCalls 0 OR absent paints info — the
     ledger never claims work it cannot see; not_met with measured 0 paints warning (amber);
     worked not_met stays faint; impossible stays warning; mono defers to verdictAccentColor's
     mono path entirely — hue dropped, glyph shape carries the signal.
355. Readers switch to the entry-aware accent: src/tui-history.tsx colorFor now takes the
     VerdictEntry (verdict trail glyphs, why-ledger verdict glyphs, both last-verdict cells);
     the loop rail's met glyph paints the entry accent (worked = success/fallback info,
     zero-tool = info). src/hud-card.tsx verdictColor takes the entry for the card's
     last-verdict row. HistoryTheme and HudCardTheme gain the optional success token. Why-ledger
     furniture stays muted; met stays blue at zero tools — only MEASURED worked mets move to
     green; the trail/mono/ASCII arms are unchanged in shape.
356. Tests: tui-hud.test.tsx accent mappers +2 (three-way paint incl. absent-success fallback,
     unknown-toolCalls met keeps info, zero-tool not_met amber, worked not_met faint; mono drops
     the hue to the verdictAccentColor mono path). Spec-check marker files=43 tests=876 -> 878.

Verification (all run in the worktree): bun test (878 pass, 0 fail, 21 snapshots byte-stable),
bun run compile, bun run check end-to-end green incl. spec-check (43/878). Evidence is source +
test-render layers; live TUI remains unverifiable. Follow-ups NOT done in this slice: applying
the ledger hue to the pill's landing flash.

## Workstream CP — the final tally carries the loop's measured spend (2026-11-16)

Interpretation of this iteration: CN stamped per-turn spend on verdict entries and CK stamped the
arm→advance delta on each completed loop iteration, but the loop's IS-over screen — the final
tally row — summed nothing: iterations, turns, tools, wall-clock, and no cost. The loop ledger
now closes its own books: what the whole run measured, in one row.

357. src/core/history.ts — LoopTotals gains `readonly spend?: { readonly total: number;
     readonly measured: number }` (additive, internal interface). loopTotals accumulates
     entry.spend.cost only when it is present and finite and >= 0; the key is absent when no
     iteration could be measured — the tally never claims a $0.00 it cannot see. A partially
     measured loop reports measured < iterations rather than a rounded-up verdict.
358. src/tui-history.tsx — the final tally row appends the measured cost inside the existing
     muted furniture grammar (no hue, no glyph change): ` · $x.xx` when every iteration measured,
     ` · $x.xx across N/M measured` when partial, nothing otherwise. Word-wrap row; formatCost;
     snapshots unchanged (finished-loop snapshot entries carry no spend, so tallySpend() is "").
359. Tests: history.test.ts loopTotals +4 (all-measured sum with the measured count; partial
     measurement reported as partial with unmeasured iterations excluded; absent spend leaves the
     key off the object; non-finite/negative cost does not poison the sum), tui-render.test.tsx
     +1 (finished-loop tally paints $0.75 complete; $0.42 across 1/2 measured partial). Spec-check
     marker files=43 tests=878 -> 883.

Verification (all run in the worktree): bun test (883 pass, 0 fail, snapshots byte-stable),
bun run compile, bun run check end-to-end green incl. spec-check (43/883). Evidence is source +
test-render layers; live TUI remains unverifiable. Follow-ups NOT done in this slice: spend in
the goal-dialog verdict sections; the pill's landing-flash ledger hue.

## Workstream CQ — the completion flash speaks the ledger grammar (2026-11-16)

Interpretation of this iteration: CO moved the three-way work-ledger grammar (work produced green,
already-satisfied-at-HEAD blue, state-inspection amber) onto every verdict surface — the trail,
the why ledger, the rail glyph, the card's last-verdict row — but the one surface the user
watches MOST at the win moment, the ambient pill's just-achieved acknowledgment flash, still
painted plain info blue regardless of whether the loop produced evidence.

360. src/core/hud.ts — new exported achievedAckAccentColor(theme, history, mono): the last
     recorded verdict decides. A met verdict with MEASURED toolCalls > 0 paints success green
     (info fallback on hosts without the token — the CO idiom); a zero-tool met, absent or empty
     history, an absent toolCalls count, or a non-met final verdict all stay info blue; mono
     paints base. Never fabricates work.
361. src/tui.tsx — the pill's achieved arm of color() splits from evaluating/waiting (both stay
     info) and resolves the achieved ack from the frozen acknowledgment snapshot
     (terminal() ?? goal()).history through achievedAckAccentColor, host-theme double-cast per
     the file's existing idiom. The bold-flip pulse, the ACK_FLASH_MS window, and the reduced-color
     short-circuit are untouched — hue only, motion unchanged.
362. Tests: tui-hud.test.tsx accent mappers +1 (worked met green / absent-success fallback info /
     satisfied-at-HEAD info / unknown toolCalls info / absent and empty history info / non-met
     final verdict info / mono base). Spec-check marker files=43 tests=883 -> 884.

Verification (all run in the worktree): bun test (884 pass, 0 fail, snapshots byte-stable),
bun run compile, bun run check end-to-end green incl. spec-check (43/884). Evidence is source +
test-render layers; live TUI remains unverifiable. Follow-ups NOT done in this slice: the
explicit success tone on the pill pulse cadence itself (motion untouched by design).

## Workstream CR — the why ledger pins its reason column; the render demo exercises the spend grammar (2026-11-16)

Interpretation of this iteration: a ruthless re-read of the actual painted frames (scripts/render-
history.tsx / render-dialog.tsx) exposed one visible defect and one verification gap. The why
ledger's reason hangs off the end of a muted furniture prefix whose width varies with the verdict
word ("met" vs "not met"), turn digits and relative time — so reasons landed on a ragged x across
rows, exactly the tell of chrome rather than craft on the flagship explainability row. And the
render demo never carried sha/spend, so the money grammar added across CM-CN-CO-CP-CQ had never
been eyeballed in a real frame — only toContain assertions.

363. src/tui-history.tsx — the why ledger derives the furniture string per row once
     (furniture(entry)) and pins the furniture <text> cell width to the max stringWidth across the
     visible rows (import string-width). Reasons land on one x regardless of verdict word, turn
     digits, relative time or the optional spend suffix; multibyte glyphs count as their cell
     width; rows without spend paid no penalty (their shorter furniture is padded to the max).
     The glyph column, the word-wrap reason cell and the hover/copy grammar are unchanged.
364. scripts/render-history.tsx — the looped demo now stamps sha and arm→advance spend on both
     completed iterations, toolCalls and per-turn spend on every verdict, so the frames paint rail
     `· sha · $` rows, why-ledger per-turn costs, and the `$0.75` final tally end-to-end. Section
     names unchanged (render-scripts.test.ts's assertions hold). The 80-col floor wraps rail rows
     wherever they naturally break — the continuation aligns to the text column; no suffix-pair
     gluing (rejected: arbitrary special-casing of one pair).
365. Tests: tui-hud.test.tsx +1 (reason column aligns across rows with met/not_met and turn 3/29 —
     asserts the reason starts at the same cell in both frame rows). Spec-check marker files=43
     tests=884 -> 885.

Verification (all run in the worktree): bun test (885 pass, 0 fail, snapshots byte-stable),
bun --preload @opentui/solid/preload scripts/render-history.tsx eyeballed at width 112 (aligned
reasons; sha+spend rail; $0.75 in the final tally row), bun run compile, bun run check green incl.
spec-check (43/885). Evidence is source + test-render layers; live TUI remains unverifiable.

## Workstream CS — the finished loop retires its live row (2026-11-16)

Interpretation of this iteration: a ruthless eyeball of the painted frames (scripts/render-
history.tsx at width 80 and 112) showed the looped rail painting BOTH a live-style "now" row and
the "final" tally row once the loop was over — the now row's glyph, "turns elapsed" and the
running streak ("2x not met in a row", "this turn") are in-progress fiction about a loop that can
no longer advance, sitting directly above the row that announces the outcome. Non-looped
HistoryBlock never painted a now row, so the two grammars disagreed.

366. src/tui-history.tsx — the running-iteration row in the looped rail is wrapped in
     <Show when={!finished()}>. finished() is exactly the set of states where the loop cannot
     advance (terminal status, or the cap reached with history) — the same fence the final tally
     row uses, so the two rows now agree: a loop with no "now" shows the outcome once, and only a
     live loop shows the live row. The active-state row is byte-identical to before (its tests
     unchanged); the nowColor/streak/iterVerdict machinery is used only inside the live row.
367. Tests: tui-render.test.tsx +1 (a finished loop paints the final tally and NOT the now row /
     "this turn" language; the active loop still paints both — one test, both sides of the fence).
     Snapshots: the two finished-loop frames re-pinned programmatically under TZ=UTC
     (LoopSection · met; StatusDialogBody · judged impossible). Spec-check marker files=43
     tests=885 -> 886.

Verification (all run in the worktree): bun test (886 pass, 0 fail, 21 snapshots stable after the
two re-pins), bun run compile, bun run check green incl. spec-check (43/886). Evidence is source +
test-render layers; live TUI remains unverifiable. Follow-ups NOT done in this slice: none — a
larger "terminal the pill already goes silent on; cleared loops show the final tally only when
history exists" is the settled grammar, unchanged.

## Workstream CT — the spend line never clips its cost (2026-11-16)

Interpretation of this iteration: the error-mode audit of painted frames showed the HUD card's
spend row (`wrapMode="none"`, no budget) painting past its cell at small widths — at a 52-cell
card (terminal ≤ ~68, the clamp floor) the line painted `· $` and clipped `$0.90` mid-figure. The
exact number this arc spent four iterations making real. The objective's floor is 80 columns,
where the line fits, but a split pane is not an exotic surface and the clip is never acceptable
for a currency figure. `formatSpend` also had zero direct tests anywhere in the suite.

368. src/core/format.ts — formatSpend gains `maxWidth?: number` (cells, stringWidth; default
     Infinity = byte-identical full line for the dialog and all existing callers). A degradation
     ladder applies only when the line exceeds the budget: cached drops first, then out, then in.
     The cost is the anchor — always kept whole, never clipped mid-figure, never dropped. If the
     budget is smaller than the cost token itself the cost is returned anyway (overflow, never a
     torn figure); with cost absent the same ladder degrades the token volume.
369. src/hud-card.tsx — new exported spendWidth(width) = max(5, floor(width) − 15) (border 2,
     padding 2, LABEL 10, gap 1; the spendWidth idiom mirrors conditionWidth's accounting). The
     spend row passes it to formatSpend. The 80-column floor (budget 65, line 41 cells) and the
     dialog render the byte-identical full line; the change is visible only where the figure was
     previously torn.
370. Tests: core.test.ts +5 (the formatSpend suite — full line, absent cost, cached→out→in
     ladder order, the anchor at budgets 5/3/0, degraded output never exceeding the budget while a
     droppable figure remains); tui-hud.test.tsx +1 (card at width 52 paints "2.22M in", drops
     "cached", keeps "$0.90" whole; the default-width card keeps the full line). Spec-check marker
     files=43 tests=886 -> 892.

Verification (all run in the worktree): bun test (892 pass, 0 fail), bun run compile, bun run
check green incl. spec-check (43/892), rendered-frame eyeball at terminals 52/64/80 (cost whole
at every width). Evidence is source + test-render layers; live TUI remains unverifiable.
Follow-ups NOT done in this slice: budget-aware degradation for the status-dialog spend row
(modal has room; same helper is ready if a future narrow surface needs it).


## Workstream CU — the frame matrix closes: every painted surface has a committed frame script (2026-11-16)

Interpretation of this iteration: the remaining honest gap was not a painted defect but a
verification hole. The render-dialog frame I use to critique the money grammar hand-painted a
stale footer ("up/down scroll · pgup/pgdn page · home/end start/end · esc close") — a shortcut set
no footer tier has painted since the footer-tier work — meaning the dialog's bottom edge had never
been in any committed frame, and the HUD card (the surface that produced CT) had no committed
frame at all. A frame eyeball is only as honest as what it mounts.

371. scripts/render-card.tsx (new) — mounts the real HudCard; frames the active loop at terminal
     80 (the 64-cell design at the floor), the achieved state (the state word flips), and width
     52, the clamp-floor case the spend ladder exists for ($0.90 stays whole, cached drops).
372. scripts/render-dialog.tsx — the stale hand-painted footer line is gone; the frame mounts the
     real DialogFooter (and the mount's own esc affordance and bold ◎ /goal · loop header stay
     mirrored). New flags: --width=N (default 150), --pinned, --copied, --achieved. The theme is
     typed HistoryTheme & HudCardTheme (identical text shapes; HistoryTheme ignores the extras).
     The --buggy regression path, --height, and the banner strings are unchanged.
373. Tests: render-scripts.test.ts +2 (render-card smoke asserting exit 0, the three frame names
     and the whole-$0.90 clamp-floor contract; render-dialog --width=80 asserts the real
     compact-tier footer and the absence of the stale line). Spec-check marker files=43
     tests=892 -> 894.
374. Frame evidence (all exit 0): the footer width ladder paints as the DialogFooter suite pins —
     80 short hint + compact labels, 100/120 short hint + noun labels, 140 full key hint; pinned
     flips to [unpin]/[unpin condition], copied flips to [✓ copied], both compose at 100; the
     achieved dialog paints the final tally with NO now row (the CS fence end-to-end); the
     achieved card speaks its state word. Live TUI remains unverifiable (provider).

Verification (all run in the worktree): bun test (894 pass, 0 fail), bun run check green incl.
spec-check (43/894), rendered frames above. Evidence is source + test-render layers; live TUI
remains unverifiable. Follow-ups NOT done in this slice: none — a committed pill frame is out of
reach (the pill mounts inside the host's slot; there is no component seam to render standalone).


## Workstream CV — the dialog's advertised keyboard is now tested, not just wired (2026-11-16)

Interpretation of this iteration: the mouse-first arc closed with 39+ click tests, but the dialog's
keyboard advertised the same coverage and had none — ten keymap commands (the footer's `up/down`,
`pgup/pgdn`, `home/end`, `p` pin, `x` fold, `c`/`r` copies) registered through
context.keymap.layer in src/tui.tsx with zero test seam, zero pinned behavior. No footer tier ever
painted for a key that did not work, and this slice keeps it that way.

375. src/core/dialog-keys.ts (new) — the ten dialog commands as a pure factory,
     dialogStatusCommands(deps), importing nothing from @opentui; the structural command shape is
     checked against the host's KeymapLayer site in tui.tsx at compile time. Exports
     DIALOG_LINE_CELLS (3), DIALOG_PAGE_CELLS (15), SCROLL_END (Number.MAX_SAFE_INTEGER).
     Handler semantics are byte-preserved from the inline originals, including the silent
     try/catch each run handler wraps itself in and the early return when there is nothing to copy.
376. src/tui.tsx — the inner anonymous command array is gone; the dialog layer spreads
     dialogStatusCommands with closures over the same setup-scope values the inline handlers used
     (statusDialogSession, togglePin, setIterationsExpanded, copyToClipboard, flashStatusCopied,
     scrollRef). The layer registration itself (mode global, priority 100, layer-level enabled)
     is unchanged.
377. Tests: test/dialog-keys.test.ts (new, +8) — command order/ids/binds/group; every command's
     enabled() mirroring the dialog-open gate both closed and open; the scroll ladder arithmetic
     (arrows ±3, pages ±15, home → 0, end → SCROLL_END); `p` with and without a session; `c` and
     `r` copy payloads incl. the "reason" kind and the copy+flash both-or-neither contract; `x`
     toggling once per press; a throwing dependency never escaping a key event. spec-check marker
     files=43 tests=894 -> 44 tests=902 (src/core/dialog-keys.ts is shipped source, so npm pack
     counts one more file; package-integrity asserts the tarball grew to 44).
378. Evidence is source + render-layer adjacent (unit): the keymap layer wiring was verified by
     reading the host contract (KeymapLayer/KeymapCommand in node_modules/@opencode/plugin) and by
     the test suite; no live key event has been exercised — the live TUI remains unverifiable.

Verification (all run in the worktree): bun test (902 pass, 0 fail), bun run check green incl.
spec-check (44/902). Follow-ups NOT done in this slice: none — the remaining advertised surface is
covered end-to-end by this suite plus the 39+ click tests.


## Workstream CW — the reduced-color contract gets frames, not just predicates (2026-11-16)

Interpretation of this iteration: the design bar demands ASCII/Unicode-safe fallbacks under
NO_COLOR / TERM=dumb, and the demotion logic was test-pinned at the predicate layer (glyph
mappers, bar/spark demotions) — but no committed frame had ever rendered under mono, so the
contract was never eyeballed end-to-end and the render scripts could not even spell mono. The
frame matrix grew this fifth axis.

379. scripts/render-history.tsx, scripts/render-card.tsx, scripts/render-dialog.tsx — all take a
     `--mono` flag: it sets NO_COLOR=1 before mounting (components read motionDisabled
     (process.env) for their ASCII arms) and threads `mono` into LoopSection/HistoryBlock /
     HudCard / StatusDialogBody + DialogFooter. Frame headings gain a ` · mono` suffix; the
     demo fixture's trail summary no longer embeds literal glyphs in prose (check/cross/slash),
     which keeps the smoke assertion honest. scripts/render-dialog.tsx also fixed a latent
     same-class stale mirror found by this arm: the hand-mirrored `◎ /goal · loop` header now
     paints goalGlyph(motionDisabled(process.env)) — `*` under reduced color, `◎` above it —
     matching what src/tui.tsx paints for the host.
380. Frame evidence (all exit 0): mono history frames demote the bar (`#######-----------`),
     trail (`+x+x+...`), goal marker (`*`), spark ramp and rails (`|`); mono card demotes the
     marker, bar and rail glyphs, truncates with ASCII `...`, and keeps `$0.90` whole at the
     52-cell clamp floor; mono dialog paints the `*` header, `[copy] [pin] [clear]` (80-column
     compact tier), and `[+ copied]` under --copied. No Unicode glyph survives the arms.
381. Tests: render-scripts.test.ts +3 (one per script, asserting exit 0, the `· mono` headings,
     the demoted chrome, the whole-cost clamp floor on the card, and the absence of Unicode
     ✓/█/◎ in history + dialog frames). spec-check marker files=44 tests=902 -> 905.
382. The `now`-row gap-run before `· last` investigated and left alone: identical in color and
     mono frames — it is the trailing allocation of a wrapped flexGrow text line, not a spacing
     defect.

Verification (all run in the worktree): bun test (905 pass, 0 fail), bun run check green incl.
spec-check (44/905), frames above. Evidence is source + test-render layers; live TUI remains
unverifiable. Follow-ups NOT done in this slice: none.


## Workstream CX — the failure-first contract gets frames, not just predicates (2026-11-16)

Interpretation of this iteration: the design bar's "failure is a first-class screen" promise lived
only in predicate tests (remediationFor's five branches) — the one surface a stranger watches
(the card, at a glance) had never rendered a hot, stuck, or failed state, so the exact-remedy row
(`fix`) had never been eyeballed end-to-end and its two-line wrap at 64 cells was untested.

383. scripts/render-card.tsx — three new always-on frames after the existing four:
     running-hot (active goal, loopCompact pending 2/4 misses, no landedAt), stuck on retries
     (retries = RETRY_HOT_THRESHOLD = 3), and failed (status "failed" + failureLabel
     "provider error"). Frames compose with --mono unchanged.
384. Frame evidence (all exit 0): hot paints the remediation wrapped to two rows at remediationWidth
     ("compact pending 2/4 · send a message for a safe point · else set evaluator.verifyCommand"),
     the meter stays warning-toned (source-pinned via borderAccentColor/hot arms); stuck flips the
     now-word to `stuck` and wraps "3 failed turns in a row · check provider quota or settings ·
     else /goal clear"; failed paints "failed 31 turns" and "provider error - /goal clear to reset".
     The `fix` label row wraps via the same greedy word wrap cardRowPlan budgets.
385. Tests: render-scripts.test.ts +1 (the failure-first arm pin: hot/stuck/failed headings, the
     exact remedy strings, the flipped state words). spec-check marker files=44 tests=905 -> 906.

Verification (all run in the worktree): bun test (906 pass, 0 fail), bun run check green incl.
spec-check (44/906). Evidence is source + test-render layers; live TUI remains unverifiable.
Follow-ups NOT done in this slice: none. The impossible/paused arms share remediationFor and are
predicate-tested; they were not framed because their rows are the same wrap path at the same
width.


## Workstream CY — the first impression and the terminal verdict get frames (2026-11-16)

Interpretation of this iteration: the card's state matrix was missing the two states a stranger
sees at the extremes — the freshly armed card (zero turns, the teaching row that sets the
evaluator contract before any turn exists) and the judged-impossible card (the terminal verdict
that tells the user to rephrase or clear). Both were predicate-pinned paths (evaluatorHint /
remediationFor) with no rendered evidence.

386. scripts/render-card.tsx — two new always-on frames after the failure-first three:
     freshly armed (turns 0, empty history, no spend/context — the hint row paints
     EVALUATOR_HINT_CARD) and judged impossible (status "impossible" —
     stateAccentColor flips the now-word, remediationFor paints the rephrase/clear row).
     Both compose with --mono unchanged.
387. Frame evidence (all exit 0): freshly armed paints `hint the evaluator reads only the
     transcript` with no spend/context rows (absent data, never fabricated); impossible paints
     `now impossible 31 turns` and wraps `fix judged impossible · rephrase the condition, else
     /goal clear` to two rows.
388. Tests: render-scripts.test.ts +1 (the first-impression pin: both headings, the flipped state
     words, the hint copy, the impossible remedy). spec-check marker files=44 tests=906 -> 907.

Verification (all run in the worktree): bun test (907 pass, 0 fail), bun run check green incl.
spec-check (44/907). Evidence is source + test-render layers; live TUI remains unverifiable.
Follow-ups NOT done in this slice: none. The pill (level a) remains documented as inline-only
(pinned by pillModel unit tests; extraction would manufacture evidence, not find defects).


## Workstream CZ — the verification gate's output tail rides the record into the dashboard (2026-11-16)

Interpretation of this iteration: the design bar's level-(c) contract names a "verifyCommand output
tail" in the dashboard. It did not exist: the gate produced the tail on the failure path but folded
it into the not_met reason (truncate 240), and on a passing gate the output vanished entirely — a
met verdict carried no visible proof of what it was held to. The fix is additive and observational:
the controller persists a display-safe tail on the record at every gate exit; the dialog paints it.

389. src/core/types.ts — GoalRecord gains additive `lastVerify?: { command, code: number|null,
     timedOut?, tail?, at }` (absent on legacy records, at unset gates, and on non-met verdicts).
     Version stays 1; the store round-trips it opaquely (isRecord checks three keys only).
390. src/runtime/controller.ts — verifyMet marks the record at all four exits (no verifier loaded,
     pass, downgraded fail incl. timeout, verifier threw). The tail is display-safe before it is
     stored: stripControls (new in src/core/format.ts — OSC, CSI, Fe, lone C0/DEL, CR→LF) then
     last 12 lines capped at 1200 code units. Gate behavior is unchanged: same reason strings,
     same downgrade semantics, fail-closed posture.
391. src/status-dialog.tsx — a `verify` section (after the fix row, before spend) paints the
     command as `$ <cmd>`, a glyph + `exit N`/`timed out · <relative time>` line, and the stored
     tail wrapped at dialog width; mono demotes the glyph (+/x) and drops color. The row is
     click-to-copy (tail ?? command) with hover bold + in-place `+ copied` ack — same grammar as
     the reason row; onCopyVerify is optional (no host wiring → static paint, no click target).
     src/tui.tsx wires onCopyVerify through the shared copyToClipboard (new "verify" toast kind).
392. Evidence: render-dialog.tsx (not shipped) paints the section in color and --mono at width 80
     ("$ bun run check", "✓ exit 0 · 4m ago" / "+ exit 0" under mono, tail lines); +1 smoke pin
     (render-scripts.test.ts asserts both arms and the demotion). +1 full-frame snapshot
     (StatusDialogBody · verify, the downgrade case: reason + ✗ exit 1 + tail, width 100/44).
     Engine truth: +3 tests in verify.test.ts (pass persists stripped tail + exit 0; fail persists
     stripped ANSI tail, reason contract unchanged; timeout persists timedOut with code null).
393. Verification (all in the worktree): bun test (912 pass, 0 fail). Evidence is source +
     test-render + snapshot layers; live TUI remains unverifiable (provider dead). Follow-ups
     NOT done: the pill/card do not carry the tail (level (c) only, by design); HudCard's optional
     onCopyVerify passes nothing new; the tail is not shown for never-configured gates.


## Workstream DL — the per-verdict ledger gains its commit sha, elsewhere rows gain a transcript jump (2026-11-16)

Interpretation of this iteration: two literal clauses of the armed design bar were unmet at HEAD.
(1) The narrative ledger asks for "commit sha" per row — the engine stamped `LoopEntry.sha` at
loop advance and the loop rail painted it, but the per-verdict `VerdictEntry` carried no sha at
all, so the why ledger (glyph, verdict, turn, time, spend, reason) ended at the bridge between a
verdict and the commit it judged. (2) Mouse-first ergonomics asks for a clickable "view
transcript" affordance — absent everywhere on the TUI; the closest surface is the dialog's
"elsewhere" block listing other sessions' live goals, read-only by design comment, clickable
nowhere. Both are additive, no behavior change, no new engine contract.

394. src/core/types.ts — VerdictEntry gains additive `sha?: string` (absent on records written
     before this change, outside a repository, or when HEAD cannot be read — never guessed,
     never fabricated; version stays 1, the store round-trips it opaquely).
395. src/runtime/controller.ts — the per-turn history.push stamps the same guarded HEAD sha the
     loop advance stamps (findRepository + headSha, try/catch to undefined).
396. src/tui-history.tsx — WhyLedger furniture appends ` · <sha7>` (one shared module-level
     shaSuffix; the rail's duplicate component-local helper was deduplicated into it). Furniture
     pin-width math is unchanged (stringWidth max over visible rows), so reasons stay aligned.
     Width 100/44 snapshot: `why  ✓ met · turn 1 · 26m ago · b1e4d7a  done` etc. — captured.
397. src/status-dialog.tsx — StatusDialogBody gains optional `onViewTranscript?: (sessionID) =>
     void`. When wired: the elsewhere row answers left-click with
     `ui.router.navigate({ type: "session", sessionID })` (host-supported route; right/middle
     clicks do nothing; the condition boldens + a faint `→ transcript` tag appears on hover;
     the header line gains "· hover a row to open its transcript"). When unwired: rows paint
     exactly as before (zero drift on existing elsewhere paint tests). No key chords; focus
     stays with the host prompt (orthogonal to the CV dialog-keymap decision).
     src/tui.tsx wires the callback in the dialog mount with its own try/catch guard.
398. Evidence: bun test 918/918. +2 engine (sha stamped in a bare fixture repo; sha absent in a
     bare temp dir — the harness's C:/work/project sentinel resolves inside this checkout on
     Linux, so non-repo tests must use a real temp dir), +2 interactive (left-click elsewhere
     row jumps with that row's sessionID; right-click jumps nowhere), +1 snapshot (why ledger
     rows carry shas, width 100/44), +1 smoke pin (render-dialog.tsx --width=100 --height=92
     paints elsewhere header + foreign row "brisk-falcon"). Snapshot drift: none.
     Follow-ups NOT done: hover-tag is the only affordance hint (idle rows unchanged by design;
     a permanent tag costs ~14 cells at the 80-col floor); no transcript jump for the own
     session (it navigates to the route you are already on — noise); the pill carries no sha
     (level (c) only, by design).


## Workstream DM — the elsewhere transcript jump gains its keyboard twin (2026-11-16)

Interpretation: the design bar's mouse-first clause ships DL's "view transcript" jump for the
mouse (left-click an elsewhere row asks the host's router to open that session's route); the
same bar's craft clause demands keyboard parity for everything the mouse can do — and the DL jump
had none. A power user who never touches the mouse could not follow another session's work from
the status dialog. This slice closes that clause for the jump, without touching the host's prompt
and without new paint when the route is unwired.

394. src/core/dialog-keys.ts — when the host wires `transcriptFor` (1-based elsewhere row →
     sessionID) together with `openTranscript`, the pure factory emits four digit chords after
     the reason chord and before the scroll ladder: `1`..`4` → `goal.status.transcript-N`,
     group Goal, titles "Goal status: open transcript of other session N". Each chord gates on
     the dialog-open gate AND the row existing (`transcriptFor(N) !== undefined`); a disabled
     chord runs as a no-op; a throwing `transcriptFor`/`openTranscript` never escapes the key
     event (same swallow posture as every chord in the factory). Unwired, the factory emits
     exactly the ten advertised commands — zero drift (the pre-existing pins hold).
     `run` opens with the same swallow.
395. src/status-dialog.tsx — when `onViewTranscript` is wired, each elsewhere row paints a faint
     digit `1`..`4` where the inert label column was (same 10-cell LABEL width, so the glyph
     column never shifts between wired/unwired paints); the digits advertise the chord. Shared
     `foreignLiveRows(others, ownSessionID)` (exported, single source) is the predicate the
     dialog paints AND the keymap arms from — an on-screen row and the key that jumps to it
     can never disagree. `FOREIGN_ROWS_VISIBLE` exported alongside it. Unwired: byte-identical
     paint (empty label column, no digits).
396. src/tui.tsx — the dialog keymap wires `transcriptFor` (via the same foreignLiveRows the
     dialog paints, sliced nothing — `[row - 1]` of the first four placed rows) and
     `openTranscript` (ui.router.navigate, own try/catch). No footer change — the footer spends
     its cells on the scroll ladder and the three plugin chords by design; the digit lives on
     the row it addresses.
397. Evidence: bun test 922/922. +3 unit (dialog-keys: digit chords appear after `r` exactly when
     wired, ids/binds in paint order; digit enabled mirrors the open gate and row count (rows 3-4
     dead when only two foreign goals are live; disabled chord is a no-op run); a throwing jump
     route never escapes). +1 interactive (wired rows paint digit gutters 1/2; the same rows
     unwired paint none, trimmed line never starts with the digit). Render frames verified with
     `--width=100 --height=92`: wired elsewhere row paints `1` in the label column lining up with
     the LABEL gutter. Snapshot drift: none. The footer's Esc grammar (host modal owns Esc) is
     unchanged; focus rings stay absent by design (Tab belongs to the host); the pill's chord is
     palette-only. Live TUI unverifiable — never claimed; evidence layers: source + test-render.
     Follow-ups NOT done: wheel-scroll mouse pin for the dialog scrollbox (opentui core handles
     the wheel natively; no test yet); the footer hint omits the pre-existing `r` chord (kept out
     of this slice); digits beyond 4 fold into the `+N more` line with no key route (paint order
     is the contract).


## Workstream DN — the dialog's overflow is reachable, and the wheel works (2026-11-16)

Interpretation: the design bar's mouse-first clauses that still had zero coverage or no path at
all. (1) The elsewhere block painted at most four foreign live goals; the `+N more` line sat
there as a silent, non-interactive cap — the fifth and later live sessions were invisible from
`/goal status` with no mouse path and no keyboard path. (2) The bar says scrollable regions
scroll with the mouse wheel; the dialog's scrollbox is the one scrollable surface in the plugin
and nothing pinned wheel scrolling at real coordinates. This slice closes both, mouse and
keyboard.

398. src/status-dialog.tsx — the `+N more` line is a click-to-expand fold row (rail-fold grammar):
     collapsed it paints `+N more`, expanded it paints `fold to FOREIGN_ROWS_VISIBLE`; hover
     brightens the label and, while the host wires onToggleExpandedOthers, appends a faint
     `click · m` tag (unwired, `click` — the fold works on local state either way, mirroring
     the rail fold's uncontrolled fallback). Left click toggles, right/middle inert, try/catch
     around the toggle. Digits paint only on rows 1..FOREIGN_ROWS_VISIBLE (`digit()` is
     undefined past the chord cap — paint order is the contract). Rows 5+ paint the plain
     10-cell label gutter. Controlled via expandedOthers/onToggleExpandedOthers from the
     parent; local createSignal fallback when unwired (LoopSection pattern).
399. src/core/dialog-keys.ts — when the host wires BOTH `foreignMoreVisible` (the overflow
     predicate) and `toggleForeignMore`, the factory emits one more chord after the digits and
     before the scroll ladder: `m` → `goal.status.elsewhere-more`, group Goal, title "Goal
     status: show or fold the other sessions list". enabled mirrors the dialog-open gate AND
     the overflow predicate (disabled past the chord cap; no overflow, no chord). run() wraps
     the toggle in try/catch — the same swallow posture as every chord. Unwired, the factory
     emits exactly the pre-DN command set; one half wired, no chord (both-or-neither, the
     transcriptFor contract).
400. src/tui.tsx — a setup-scope foreignMoreExpanded signal (same pattern as
     iterationsExpanded) feeds the body's expandedOthers/onToggleExpandedOthers and the dialog
     keymap's foreignMoreVisible (foreignLiveRows(...).length > FOREIGN_ROWS_VISIBLE) /
     toggleForeignMore. No footer change (the fold key rides the row it addresses, the DL/DM
     posture), no header change.
401. Tests: +3 unit (dialog-keys: `m` joins after the digits when both halves wired, after
     `r` when only the fold is wired, absent when exactly one half is wired; enabled mirrors
     the open gate and the overflow gate; a throwing toggle never escapes). +3 interactive
     (the fold paints all six foreign sessions when opened and folds back on click — the
     hidden sessions carry no digit; the fold works without host wiring on local state; the
     scrollbox scrolls under the mouse wheel at real coordinates, and scrolls back up — pins
     opentui's ScrollBox.onMouseEvent mechanism the dialog depends on; mechanism-layer
     evidence, not plugin-mount evidence). +1 snapshot (elsewhere overflow opened — all six
     sessions paint, digits stay on the first four, fold row says `fold to 4`; recorded at
     width 100 × height 44, deterministic clock). Evidence: bun test 929/929.
402. Honest limits: the wheel pin is mechanism-layer (a bare scrollbox fixture exercising the
     same @opentui/core ScrollBox the dialog mounts), not plugin-mount evidence — the plugin's
     full mount is not headlessly renderable, and live TUI remains unverifiable (provider
     dead) — never claimed. Rows past the fold cap stay digit-less (the chord cap is four by
     design; `m` toggles, it does not address rows). Unwired embedders get the fold on local
     state but no `m` chord by design.

## Workstream DO — the boundary-compaction outcome, at a glance on the dial (2026-11-16)

Interpretation: the bar's information-hierarchy clause names a compaction-landed indicator
(with armed/disarmed state, iteration, condition, verdict status) — and the dashboard
progressive-disclosure clause asks for a context meter with landed/missed markers — but no
surface painted the outcome of a boundary-compaction request. The loop persists enough on the
record to say it honestly: `loopCompact` carries the request (iteration, requestedAt,
estimatedTokens), whether it landed (`landedAt`, authoritative; kept until the next boundary
arm overwrites it), how many measurable observations saw it miss (`misses`), and the two
"known unknowns" (`stalenessUnknown`, `unmeasurableTicks`). This slice puts that one fact on
the dial both zoom levels already paint, as a trailing clause after the tokens ratio.

403. src/core/hud.ts — new pure `compactMarker(compact, ascii)` formatter next to
     isCompactHot: absent when no compact was requested at any boundary (plain goals never
     reach the boundary-compaction path); `landed ✓` (ascii `landed`) when landedAt is set —
     authoritative, beats any miss count; `missed ×N` (ascii `xN missed`... plain `missed xN`)
     per measurable observation that saw a pending request not land (at N >= 2 the
     failure-first remediation fires and this tag stays informational); `pending` while the
     request is armed and unobserved; `unknown` under stalenessUnknown (the landing can be
     ruled in or out neither); `unmeasurable` for unmeasurableTicks > 0. Tones: landed /
     missed / pending / unknown; the ascii arm is plain words, no glyph dependence.
404. src/hud-card.tsx — the context row (both the threshold variant and the bare-estimate
     fallback) appends `· <marker>` after the tokens ratio when a marker exists. Color:
     success (theme fallback info) for landed, warning for missed, faint otherwise; under mono
     the row keeps the words and drops the hue. mono/ascii arms: mono drops hues, ascii
     demotions ride inside the text. The marker rides after the trail and the row plan is
     unchanged (the row still drops under a ceiling as before).
405. src/status-dialog.tsx — the dialog's context row paints the identical marker on the same
     predicate (parity across the zoom levels), reading `g()?.loopCompact` (goal is optional
     in the dialog — stale-cache fallback when undefined). Same tone map and mono behavior.
406. Tests: +7 unit (compactMarker — absent, pending, missed with count + ascii demotion,
     landed beats misses, stalenessUnknown outranks ticks, unmeasurable tone, ascii arm never
     spends a glyph). +6 interactive (card: pending / landed / missed ×1 paints without
     firing the failure remediation / no-marker case / bare-estimate fallback / dialog parity
     `· landed ✓`). No snapshot changes (hot fixtures carry no contextSize, so the context
     row drops in those frames). spec-check files=44 tests=942.
407. Honest limits: the marker reflects only the *latest* boundary-compaction request (the
     persisted bookkeeping), not a per-iteration landed/missed ledger — the loop's history
     entries do not persist compaction outcomes, so a per-row ledger would need an engine
     change (rejected: the TUI is chrome, the loop is engine). "pending/unmeasurable" never
     claim an outcome that did not happen — an unmeasurable context is never a miss. The
     indicator is informational, not interactive (no hitbox); the failure-first remediation
     remains the authoritative remedy at misses >= 2.

## Workstream DP — the full dashboard grows tabs (2026-11-16)

Interpretation: the bar's mouse-first ergonomics clause names clickable tabs as one
of the seven asks; until now the dialog was a single stack, every fold working, but
no view switch existed. This slice adds two tabs to the dialog body. The design
constraint came from the bar itself: level (c) is defined as condition + iteration
history + verdict timeline with per-turn reasons + context meter with landed/missed
markers + verifyCommand output tail — so tabs can never hide that list behind a
click on first open. The default tab is therefore the full dashboard exactly as it
painted before (plus the strip and one state-row suffix); the second tab is a focus
view, not a reorganization.

408. src/status-dialog.tsx — the body gains a two-tab strip (overview · ledger) as its
     first row. overview (default) paints everything it painted before: condition,
     evaluator/reason, remediation, verify tail, spend, context meter (with the DO
     compaction marker), the loop rail / history block, the elsewhere block. ledger is
     the focus view — the strip, the state row and the history block, nothing else;
     the elsewhere block is overview-only. The strip mirrors the fold grammar: left
     click switches (right/middle inert), hovered and active tabs paint base+bold
     (weight is the NO_COLOR contract; never an underline), mono/ascii arms keep the
     plain words. Uncontrolled-local fallback when the host does not wire view/
     onViewChange (the elsewhere-fold pattern); controlled when both are wired.
409. src/status-dialog.tsx — the state row gains the loop position for looped goals
     (` · vN/N`, uncapped ` · vN` when loopMaxLoops is absent/invalid; non-looped
     goals paint nothing) via a pure loopPosition helper — the one line the dialog
     always paints, so the position never leaves any view.
410. src/tui.tsx — setup scope holds dialogView (overview default); the body gets
     view/onViewChange, and the keymap gains the `t` chord (goal.status.view-toggle,
     group Goal, gated on dialog-open, swallowed errors) wired to the same signal —
     the strip and the keyboard ride one flag, the m-chord pattern. The footer does
     NOT advertise `t`: the footer keeps the three plugin chords (p/c/x); the strip
     is its own advertisement, the same contract as the `r` chord.
411. src/core/dialog-keys.ts — deps gain toggleView?: () => void; the chord joins
     after the elsewhere-fold chord when wired, absent otherwise; module doc and
     counts updated. +2 unit (joins with wiring / absent without; toggles the wired
     view; a throwing host never escapes; the dialog-open gate rides).
412. Tests: +5 interactive (click ledger focuses the rail — state row and armed
     line never leave, condition/spend drop, click back restores; right-click inert;
     controlled wiring flips the same signal the `t` chord flips; mono arm switches;
     unwired fresh loop switches without throwing). +1 full-frame snapshot
     (ledger tab). All dialog snapshots re-recorded: each frame gains the strip row
     and looped frames gain the state-row position suffix; layout otherwise
     byte-identical. The two render tests asserting the default body content were
     reworked into overview/ledger pairs. spec-check files=44 tests=952.
413. Honest limits: the view is TUI-local chrome — reopening the dialog defaults to
     overview (like the pin, a view preference, not persisted record state); the
     ledger tab duplicates the history block by design (a focus view costs one extra
     node, not a second surface); `t` is keyboard parity for the strip, not a new
     advertisement surface (three-plugin-chords permanent decision); tabs add no
     hitbox anywhere else — the strip itself is hit-tested in the render tests.

## Workstream DQ — the card's context menu gets its keyboard (2026-11-16)

Interpretation: the bar's mouse-first ergonomics clause names a right-click context
menu on the HUD for power actions, and the craft clause demands keyboard parity for
everything the mouse can do. The menu itself shipped earlier (right-click the card;
four rows in a fixed order: copy condition, copy evaluator reason, copy latest
summary, clear goal — inert rows render faint and swallow the click). It remained
the card's one mouse-only island: no key could open, navigate or activate it. This
slice closes that gap without inventing a second menu or touching the footer.

414. src/core/hud.ts — the menu's row model is now data, single-sourced:
     contextMenuRows({ hasReason, hasSummary }) returns the four rows in their fixed
     order with enabled predicates mirroring the mouse grammar (the reason row follows
     goal.reason && its wiring, the summary row follows loopHistory's latest summary;
     the clear row is the only danger row, always last). new pure nextMenuIndex(index,
     delta, rows) wraps at both ends and skips disabled rows — the inert-row contract,
     applied to arrow keys; an all-disabled (or out-of-range resting) index normalizes
     and the loop terminates.
415. src/hud-card.tsx — HudMenuRow gains selected?: boolean. A selected row paints
     exactly like a hovered one (raised background, base label; bold under mono —
     weight is the NO_COLOR contract, never an underline). The four rows now render
     from contextMenuRows (same source the keyboard path reads) instead of hardcoded
     JSX; new controlled menuSelected?: () => number prop, unwired defaults the
     selection to the first row.
416. src/tui.tsx — setup scope holds contextIndex (reset to 0 on every menu open);
     new keymap layer (goal.hud.menu-up/down/activate, group Goal, enabled only while
     the menu is open AND the dialog does not own the screen): ↑/↓ move the selection
     (wrapping, skipping disabled rows), enter activates the selected row through the
     same closures the mouse path uses (copies via copyToClipboard with the same
     "reason"/"summary" tags; clear rides requestClearGoal after collapsing the card).
     The dismiss layer now collapses an open menu before dismissing the card — one
     Esc, one layer of chrome. Mouse paths are untouched; the pill's right-click still
     opens the dashboard directly.
417. Esc granularity: with the menu open, Esc closes the menu only; a second Esc
     dismisses the card. Previously one Esc collapsed both.
418. Tests: +3 unit (rows/order/enabled/danger; wrap-and-skip arrow navigation
     including the all-disabled and out-of-range fallbacks) +2 interactive (a
     controlled menuSelected paints that row base-fg with no underline while resting
     rows keep muted/faint; the mono arm paints the selected row BOLD and inert rows
     never light up). spec-check files=44 tests=957. SPEC ref re-pointed
     (the two refs re-pointed intra-file: 124 → 173, 196 → 232 — same code, shifted
     by the new block).
419. Honest limits: ↑/↓/enter while the menu is open are not advertised in the footer
     (permanent three-plugin-chords decision — the menu paints itself; p/c/x stay the
     footer's whole budget). The keymap layer itself is not headlessly drivable here —
     evidence for the paint path is test-render (captureSpans), evidence for
     activation is the shared closures (each already covered by the mouse-path tests);
     live TUI never claimed. Activation resets the selection to the first row and
     collapses the menu, matching the mouse path exactly.

## Workstream DR — the focus view never hides the failure-first screen (2026-11-16)

Interpretation: the bar's failure clause demands the exact remediation — never a vague
warning — and the progressive-disclosure clause makes the ledger tab a first-class zoom
level. DP shipped the tab with the strip, the state row and the history block and nothing
else, which left a real hole: a failed, capped, stalled or compaction-hot loop sitting on
the ledger — the focus view an operator explicitly reaches for — showed the state word
and no remedy at all. The bar does not gate its failure-first promise on the default tab.

420. src/status-dialog.tsx — the remediation row is extracted to a module-scope
     `FixRow` (one source for both tabs; same label gutter, same hue logic via
     fixAccentColor, mono keeps the words and drops the hue). The overview keeps the
     row exactly where it always was — between the hint and the verify gate — so the
     overview frame is byte-identical to before. The ledger paints the same row, only
     when a remedy exists, right after the state column closes and above the history:
     strip → state row → fix → rail. Nothing else rides the focus view (the hint stays
     overview-only as onboarding, the verify tail stays overview-only as gate evidence,
     elsewhere stays overview-only as awareness).
421. A nominal loop keeps the ledger lean: no remediation exists, so no fix row paints
     and the armed happy path is untouched.
422. Tests: +3 interactive (hot loop, ledger tab — the exact remedy rides the frame;
     hot loop, overview tab — regression guard; nominal loop, ledger tab — no fix row
     paints) +1 snapshot frame (ledger tab failure-first: a hot loop never hides its
     remedy). The three overview remediation frames and the freshly-armed frame verified
     byte-identical to before the change (snapshot diff inspected entry-by-entry, not
     re-recorded blindly). spec-check files=44 tests=961.
423. Honest limits: the ledger's fix row is not a new affordance — it paints the same
     exact text the overview and the card already paint; there is nothing new to click
     (the row stays informational by design, matching the card's compaction markers and
     the elsewhere rows' read-only posture). The `t` chord and the strip are unchanged.


## Workstream DS — the verdict trail is a control, not a picture (2026-11-16)

Interpretation: the armed bar's progressive-disclosure clause sketches the verdict
timeline as the level-(c) timeline, and the why ledger proves the evaluator's last
three reasons inline. Everything older than three was present in the rail and in the
trail row, but reachable only as pictures — a colored dot you could stare at, never
quote. The mouse-first clause asks that what is painted be clickable. The timeline is
now the scrub surface: every dot in the trail copies THAT turn's exact evaluator
reason, one left click, mirroring the why ledger's contract and reaching the rest of
the verdict history the ledger's three-row window cannot quote.

424. src/tui-history.tsx — VerdictTrail dots render one <box> each (1-cell targets).
     Left-click + stopPropagation copies the dot's reason via the SAME onCopyReason
     the why ledger uses (no new wiring, no new host contract); right and middle
     clicks are inert. Dots without a non-empty reason, and the whole trail when the
     host does not wire onCopyReason, paint exactly as before — no handlers, no
     hover affordance, pictures stay pictures.
425. Hover boldens the hovered dot (weight, the same NO_COLOR-safe contract) and the
     counter text gains a faint ` · turn N` tag; after a copy it reads
     ` · turn N · ✓ copied` (`+ copied` under ascii). The tag paints only on hover,
     so every committed frame (overview and the rest of the snapshot matrix) is
     byte-identical — verified by an empty snapshot diff, not by a blind re-record.
426. The mono arm keeps weight over hue (hover bold); the ascii arm demotes the glyph
     exactly as it always did and the tag is words. Nothing rides above the 80-column
     floor; the tag only extends past the existing counter text on hover.
427. Tests: +4 interactive (click copies the clicked dot's reason — earlier verdicts
     reachable, pinned with distinct reasons across two dots; right-click inert;
     empty-reason dot inert; hover names the turn with no resting tag paint, click
     adds the copied acknowledgment). The hover assertion anchors on the counter
     text (`verdicts · turn N`), so the why ledger's own turn furniture cannot
     false-positive it. spec-check files=44 tests=965.
428. Honest limits: dots are 1-cell targets — deliberately, the trail is a dense
     timeline, and individual-turn precision is the entire point; there is nothing
     new to click away from the reason text itself. No keyboard twin is added (the
     dialog's ↑/↓/Home/End scroll and the three plugin chords are unchanged; the
     timeline stays a pointer surface like every unadvertised affordance). The trail
     still shows at most the 24 most recent verdicts by its pre-existing window;
     older verdicts remain reachable through the rail's expand fold and the why
     ledger cap, not through a pagination claim this surface never made.

## Workstream DT — the loop's dossier: one document, quoted once (2026-11-16)

Interpretation: every surface the plugin paints answers "what just happened" for the eyes in
front of the terminal. Nothing answers "hand me this loop's whole story so I can paste it
into an issue, a handoff, or a review". The data all exists in the record — the armed
objective, the per-iteration ledger (sha, turns, tools, context at arm, spend), the
per-turn verdict history with reasons, the boundary-compaction state, the verify gate's
last word — but it was reachable only by transcribing frame by frame. The palette command
`goal.dossier.copy` (no footer chord; the three chords stay p/c/x) synthesizes the record
into a self-contained Markdown document and puts it on the clipboard through the same
OSC52 path every other copy affordance uses.

429. src/core/dossier.ts — `buildLoopDossier(goal, nowMs)`, a pure builder (I/O-free,
     JSX-free, clock injected; byte-identical output for identical input). Sections:
     title (`# Goal loop dossier` / `# Goal dossier` for plain goals), provenance line,
     objective/condition (blockquote), status (optionally `paused:` / `failure:` bits),
     completed iterations (per entry: ended + wall span via `iterationDurations`, turns,
     tools, commit short-sha, context at arm, spend via `formatSpend`, summary and
     evaluator reason as blockquotes), the verdict trail (a table of turn/verdict/tools/
     commit/spend, tallies with a zero-tool-met `already held at HEAD` count, then the
     full evaluator prose one blockquote per turn), boundary compaction (landed / pending
     with miss count / unmeasurable / staleness-unknown / host-unwilling, or an honest
     "no request on this record" with the note that only the latest request is kept), the
     verify gate (command as inline code with an outgrowing backtick fence, result line,
     output tail in a fenceBlock whose fence outgrows any run of three-plus backticks in
     the payload), and totals (iterations, turns, tools, wall span, spend across measured
     iterations reported as partial when only some entries carry one).
430. Honesty invariants, all unit-tested: absent measurements render the em-dash gap
     (never `$0.00`, never an invented sha); free text is blockquote- or fence-protected so
     a condition containing `#` or triple backticks forges no document structure (asserted:
     hostile condition produces no `\n## Forged heading`); the session id is deliberately
     omitted so a pasted dossier leaks no provenance; `isoOf` never throws on NaN and the
     builder never reads the wall clock itself.
431. Palette wiring in src/tui.tsx: `goal.dossier.copy`
     ("Goal: copy loop dossier (markdown)", group Goal, palette-only — no key chord, no
     footer furniture), enabled whenever a goal exists on the current session (live or
     finished — a landed loop is the interesting dossier), built from the same
     `live(...) ?? entries()[...]?.goal` snapshot the other copy commands use, copied via
     the shared `copyToClipboard` with the new `dossier` label ("dossier copied").
432. Tests: +10 pure-builder tests in test/dossier.test.ts covering the full-loop render,
     determinism, session-id absence, legacy records (gap rendering, no fabricated costs),
     plain goals, hostile free text, the verify gate's outgrowing fence and absent-gate
     wording, all three boundary-compaction outcomes, zero-tool met tallies, and the
     isoOf/shortSha/inlineCode/fenceBlock/quote helpers. spec-check files=45 tests=975.
433. Honest limits: the dossier quotes the record; it was not independently re-verified and
     says so in its footer. Boundary compaction stays the record's single latest request —
     there is no compaction log to export, and the document says exactly that instead of
     implying a trail it does not have. Live-TUI behaviour is unverifiable here (provider
     dead); wiring is verified at the source and unit-render layers only. No new click
     targets, no keyboard twin — the palette is the discovery surface, consistent with
     every unadvertised copy affordance.

## Workstream DU — the dossier, in-screen: the third view (2026-11-16)

Interpretation: DT shipped the dossier as a clipboard artifact — the whole record,
one pause and paste away. But the TUI itself still could not show it; reading the
record meant leaving for an editor. DU adds the dossier as the dialog's third view
tab (`overview · ledger · dossier`): the same bytes `goal.dossier.copy` writes,
rendered in-screen with the structural Markdown lifted into weight/tone (never hue
alone, never raw syntax), one mouse click — or the `t` chord — away. No footer
furniture (the three chords stay p/c/x); the tab strip and the chord are the two
doors, and they ride the one controlled signal the other views use.

434. src/core/dossier-view.ts — `dossierLines(markdown)`, a pure line classifier
     (I/O-free, JSX-free, deterministic): `title` (`# `), `section` (`## `/`### `),
     `quote` (`> `/bare `>`), `table`, `bullet` (`- `), `blank`, `body`, and `fence`
     managed by a fence state machine that pairs on backtick runs of 3+ and treats a
     shorter run inside a longer fence as payload (CommonMark) — so a verify tail
     containing marker-looking lines cannot forge document structure. Line order and
     count are preserved exactly (one input line, one output row); the two structural
     prefixes are the only things lifted.
435. src/status-dialog.tsx — the `dossier` view: strip + state row (the armed line
     never leaves) + a `dossier` copy row (hover boldens, click copies the whole
     Markdown through the new `onCopyDossier` callback, in-modal `✓ copied`
     acknowledgment — the same grammar as every row-copy) + the document itself,
     line for line via `dossierLines` (title base+bold, quotes/fences faint, tables
     muted, bullets a faint `·` prefix on base text, blank rows one cell tall; the
     document's own blank lines carry the rhythm, no extra gaps). The dashboard
     column, the rail and the elsewhere block stay off this view — the record is the
     screen. The copy-row affordance is omitted (plain label row paints) when the
     host does not wire `onCopyDossier`. All navigation is left-click only; right and
     middle clicks are inert everywhere the grammar holds.
436. Host wiring in src/tui.tsx: `dialogView` becomes a three-way signal
     (`overview | ledger | dossier`); the strip and the `t` chord cycle it
     (overview → ledger → dossier → overview); `onCopyDossier` feeds the shared
     `copyToClipboard(..., "dossier")` path (the same bytes and label as
     `goal.dossier.copy`). The dialog-keys `t` chord title now reads "cycle the views
     (overview, iteration ledger, dossier)"; id/bind/group unchanged — the keyboard
     twin rides the same controlled signal as the strip.
437. Tests: +10 pure-classifier tests in test/dossier-view.test.ts (line order/count,
     empty document, prefix lifting, 4+ backtick fence outgrowth, CRLF parity, and
     the builder's real output — skeleton kinds, nothing dropped or reordered, a
     fenced verify tail's marker-looking payload); +6 mouse render tests in
     test/tui-render.test.tsx (tab switch drops dashboard rows and keeps the armed
     line and the objective quote, click-to-copy delivers the whole Markdown and the
     ✓ copied ack, right-click inert, round trip back to overview, mono arm, and the
     three-way controlled signal round trip driven by a solid signal); +1 snapshot in
     test/tui-snapshots.test.tsx (the dossier frame at 100×44); the 9 pre-existing
     dialog-frame snapshots regenerated — the only change is the strip row
     (`overview · ledger` → `overview · ledger · dossier`). spec-check files=46
     tests=992.
438. Honest limits: the in-screen document is the record as booked — it was not
     independently re-verified and its footer says so. Live-TUI behaviour remains
     unverifiable (provider dead); wiring is verified at the source and the
     headless render/snapshot layers only. The document renders unbounded inside the
     host's scrollbox — the wheel and the `up`/`down`/`pgup`/`pgdn`/`home`/`end`
     ladder are the host's, unchanged. No new chord, no footer furniture, no focus
     stealing; the dossier tab is reachable by mouse (everyone) and by `t` (the
     keyboard twin), and nowhere else.
## Workstream DW — the context size re-resolves after a compaction (2026-11-16)

Status: current. Input: a live-session screenshot (reported
`~/Pictures/Screenshots/Screenshot_20261116_102454.png`, 2026-11-16 10:24) whose visible text is exactly
`◎ goal-loop · re-anchor after compaction` (line 1) and `◎ loop · v1/5 ○○○○○ · active · 1m · compact pending`
(line 2); the string `context size unknown` does NOT appear on screen — it is the boundary-compact notice
(`src/runtime/compactor.ts`, `"context size unknown; compacting at the loop boundary"`) that fires on the same
path, one arm before the request.

Interpretation (the bug, as located by grep):
1. `estimateContextTokens` (`src/core/context-size.ts`) walked from the end and returned `undefined` the moment
   the LAST assistant message lacked usable `tokens`, instead of reading past it; and it never told the
   post-compaction window from the pre-compaction one, so a stale pre-compaction total could masquerade as the
   current context.
2. After the host compacts, `ctx.session.context` returns only messages at/after the last completed compaction
   (the `compaction` message first, then whatever ran since). Until a post-compaction assistant step lands
   there is no count — honest `undefined` — but the loop's arm-time settle then marks the pending request
   unmeasurable, force re-requests on the trickle, the host answers with no-op compactions whose ended events
   each enqueue the "goal-loop · re-anchor after compaction" synthetic message, and the pill keeps showing
   `compact pending`. Once a post-compaction assistant does land, the old estimator returned it correctly, yet
   the TUI's anti-flicker carry-forward (`preserveContextSize`) would keep the PRE-compaction total alive
   forever whenever a snapshot arrived without the field — the stale total the user kept seeing.
3. `preserveCarriedFields` (`src/core/entries.ts`) carried `previous.contextSize` forward with no invalidation
   across a detected landing, so the card/dialog could never fall back to the fresh post-compaction count.

Acceptance criteria:
- `estimateContextTokens` reads only the post-compaction window (messages after the last `status: "completed"`
  compaction message) when one is present; assistant messages without usable token figures are skipped, not
  fatal; no assistant inside the window → `undefined` (never fabricated, never the pre-compaction total).
- `preserveCarriedFields` no longer carries the cached total across a pending→landed `loopCompact.landedAt`
  flip; the next snapshot without the field drops it (renders nothing) until the server sends a fresh count —
  which the fixed estimator produces as soon as a post-compaction assistant exists.
- After a simulated compaction (compaction message + fresh assistant with usage) the estimate is the fresh
  count — finite and below the pre-compaction one — proven by unit test; the carry-forward drop is proven by
  unit test in `test/entries.test.ts`.
- The notice text, the pill, footer chords (p/c/x), slots and layout are untouched; no redesign.
- Verified at the unit layer only (`bun test`); no render/frame claim and no live-TUI claim.

Verification: `bun run check` green; new unit tests in `test/context-size.test.ts` and `test/entries.test.ts`;
marker bumped (tests=989). Coordinator submit.


## Workstream DV — the dossier, quoted in parts: the outline rail (2026-11-16)

Interpretation: DT ships the dossier as one clipboard artifact, DU paints that same
document in-screen — but both are all-or-nothing. Quoting the verdict trail or the
verify gate into an issue still meant selecting the rendered text by hand. DV adds a
mouse-first outline rail to the `dossier` view: one chip per `## ` section of the
document, left-click copies THAT SECTION's Markdown (the heading included, bytes
verbatim), the chip acknowledges in place. DT is the record, whole; DU is the record,
in-screen; DV is the record, quoted in parts.

439. src/core/dossier-outline.ts — `dossierOutline(markdown)`, a pure section slicer
     (I/O-free, JSX-free, deterministic). Line-oriented with the same fence state
     machine as `dossierLines` (a line of only backticks runs the fence; a closer must
     outgrow or match the opener, CommonMark pairing; shorter runs inside are payload),
     so a fenced `## ` never opens a section. Only flush-left `## ` opens one — `# `,
     `### `, `> ## ` and `- ## ` do not; the document title never does. Known headings
     get hand labels (objective, condition, status, iterations, verdicts, compaction,
     verify, totals; matched by lowercased prefix, tolerating the trailing `(…)` suffix,
     e.g. `Completed iterations (2)` → `iterations`); unknown headings truncate to 12
     columns with a trailing …. Each entry carries a stable slug id (lowercase
     alnum/dash, de-duped `-2`, `-3…` on collision), the 0-based line range, and the
     section's verbatim bytes (`raw`, heading included, lines joined by `\n`). The
     sections partition the document from the first `## ` to EOF — consecutive raws
     rejoin byte-for-byte (asserted in the tests, not in the module). CRLF/CR normalize
     to LF first.
440. src/status-dialog.tsx — the `dossier` view gains an optional `onCopyDossierSection
     (label, raw)` prop. When wired, the document row is wrapped in a horizontal row
     containing the outline rail (14 columns, one chip per section, before the document
     column) beside the unchanged `<For each={dossierRows()}>` document. Hover boldens a
     chip (weight, the NO_COLOR contract — never hue alone); a left-click (button 0,
     stopPropagation) copies that section; right and middle clicks are inert. The
     clicked chip paints `✓ copied` (ascii `+ copied`) in base weight for the usual
     1600ms ack window, same grammar as every row copy. No `copy` suffix on the chip —
     14 columns cannot carry one honestly; the label is the affordance, hover boldens,
     and the whole chip is the click target, matching the other rows' grammar.
     Unwired, the rail does not paint at all (no inert chrome); the document renders
     exactly as before. No footer change, no new chord, no focus stealing.
441. Host wiring in src/tui.tsx: `copyLabel` gains `section` ("section copied" /
     "the quoted dossier section is on the clipboard"), the `what` unions extend to
     `"section"` in both spots, and the dialog call passes
     `onCopyDossierSection={(label, raw) => copyToClipboard(raw, sessionID, "section")}`.
     Nothing else in tui.tsx changes; the keyboard twin story is unchanged (the rail is
     a pointer surface like every unadvertised affordance).
442. Tests: +15 pure tests in test/dossier-outline.test.ts (fenced `## ` is payload,
     CommonMark outgrowing fences, `# `/`### `/`> ## `/`- ## ` never open, loop document
     section order, the partition/rejoin invariant, raw-starts-with-heading, id
     de-dupe, ≤ 12-column labels with ellipsis truncation, CRLF/CR parity, the trailing
     `(…)` tolerance, plus builder-backed cases on a realistic GoalSnapshot: exactly the
     seven expected sections with reconstruction, the empty verify section still
     outlined, plain goals outline condition first); +6 mouse render tests in
     test/tui-render.test.tsx (rail labels in order with the document whole beside it,
     hover boldens with no underline anywhere, left-click delivers (label, raw) with raw
     verbatim from `## Verdict trail` to before `## Boundary compaction`, the `✓ copied`
     ack on the chip, the NO_COLOR `+ copied` demotion, right-click inert, rail absent
     when unwired); +1 snapshot in test/tui-snapshots.test.tsx (the dossier view with
     the rail at 100×44; the pre-existing dossier frame snapshot is byte-identical —
     the unwired rail paints nothing). spec-check files=47 tests=1014.
443. Honest limits: the rail is inert chrome when the host does not wire
     `onCopyDossierSection` — hover and click do nothing and the rail does not render.
     Hover/active state is weight-only; there is no hue to lean on under NO_COLOR/mono.
     Copying a section quotes bytes verbatim — no re-verification, no re-wrapping, no
     elision, and the document is always painted in full beside the rail (nothing is
     hidden behind the chips). Label width is a compromise: unknown headings truncate
     with … and the tooltip-free rail relies on the click grammar being uniform across
     sections. Live-TUI behaviour remains unverifiable from this seat; wiring is
     verified at the source and the headless render/snapshot layers only.

## Workstream DY — the re-anchor rides the system, counted once on the card (2026-11-16)

Status: current. Inputs: `~/Pictures/Screenshots/Screenshot_20261116_105049.png` and
`Screenshot_20261116_112302.png` (2026-11-16 11:23) — the `◎ goal-loop · re-anchor after compaction` line
parks above the pill and stacks one per landing (two were visible). The maintainer's ruling: "isn't that
re-anchor supposed to be happening right away? ... that compaction re-anchor gets it parked, queued or
somesort" and "redesign it so it doesn't stack up and take up screen display. keep it somewhere by number
or so. maybe on the side of the hud maybe?"

What the binary says (string-extracted from `~/.opencode/bin/opencode`, v2.3.0 — the source clone is gone):
- `Durably admit a session compaction request. Steers by default: it runs at the next step boundary instead of waiting behind queued prompts.` —
  a steer is consumed at the next step boundary of the running execution; a queued item is NOT.
- `Durably admit synthetic session input and schedule execution unless resume is false.` and
  `Steering wakes session execution.`
So `delivery: "queue"` + `resume: false` parked the re-anchor behind the in-flight turn: it landed only when
some later execution started (typically one iteration late), or never at idle. The visible cost: one transcript
line per landing, stacking.

What this workstream does (supersedes the delivery side of Workstream W and the "queued steer" wording of BV;
overlaps DU, whose context-size fix already merged via `wt/context-after-compaction`):
1. `onCompactionLanded()` no longer emits any synthetic message for the re-anchor. The ground truth is held
   one-shot in a volatile `pendingAnchors` map; the plugin's `context` hook (always registered, independent of
   `config.systemReminder`) injects it as a SYSTEM part on the next model request and consumes it. The model
   gets the full re-statement immediately after the landing; the transcript shows nothing.
2. `GoalRecord.reanchorCount?` (additive, wire-validated, durable) counts armed re-anchors. The HUD card paints
   ` · ⟲ N` (mono/ascii: ` · re-anchor N`) as a faint token on the `now` row — looped goals only, hidden at zero
   and on legacy records. One quiet number instead of a notice per landing. No chord changes, no new row, no
   dialog chrome; footer stays p/c/x.
3. `consumeAnchor(sessionID)` is the read-eats-once API; `onSessionDeleted` drops a pending anchor; a restart
   loses an unconsumed one (one skipped re-anchor, documented, never a crash).
4. Coalescing (`REANCHOR_MIN_INTERVAL_MS`) unchanged. Plain/terminal/paused loops unchanged (never re-anchored).

Also carried in this workstream: the `docs-line-refs` gate — SPEC.md's historical controller.ts line-461
single-line citation is reworded to bare text because controller.ts line numbers shift with the reanchor
rewrite; the gate only tolerates non-empty-line refs.

Verification: `bun run check` green (1011 tests); new assertions in `test/loop.test.ts` (no synthetic re-anchor
dispatched; one-shot consume; count increments; plain/terminal/paused unaffected; a host rejecting every
synthetic call cannot break the landing) and `test/tui-context-render.test.tsx` (the `⟲ N` token paints on the
`now` row; the finite post-compaction size paints; absent at zero). marker bumped (tests=1011).
Coordinator submit.

## Workstream DX — the dossier, as a file the loop can hand over (2026-11-16)

Interpretation: the dossier could be quoted to the clipboard and read in-screen, but it
never left the process. The handoff case — paste the loop's whole story into an issue, a
review, or a next-session prompt — deserved an artifact, not transcription. The palette
command `goal.dossier.export` (no footer chord; the three chords stay p/c/x) writes the
same Markdown `goal.dossier.copy` produces into a fresh file in the host's cwd, one click
or one palette pick, with the filesystem itself guaranteeing no overwrite. The dossier view
gains a mouse-first twin save row under the copy row, same click grammar, its own
acknowledgment verb.

444. src/core/dossier-export.ts — `exportLoopDossier(goal, nowMs, dir)`, the file half of
     the dossier. Deterministic filename `goal-dossier-YYYYMMDD-HHMMSS.md` from the UTC
     clock (a non-finite or unrepresentable clock stamps the epoch rather than throwing);
     `attempt > 0` appends a numeric suffix (`-2`, `-3`, …). The bytes written are
     `buildLoopDossier`'s output exactly — one builder, two doors, the clipboard and the
     file never drift. The write is O_EXCL (`wx`); a collision retries with the next suffix
     up to `MAX_EXPORT_ATTEMPTS` (100) instead of clobbering; a target that is not a
     directory, or a directory that does not exist, throws the filesystem's own error — no
     directories are created, moved, or removed. The result reports `{ path, bytes,
     attempts }`. I/O is one synchronous `writeFileSync`, unit-tested against tmp dirs.
445. Honesty invariants, all unit-tested: the file leaks no session id (the same rule as
     the copy path, now on disk); content equals `buildLoopDossier` byte-for-byte; O_EXCL
     is proven with stacked collisions (stem occupied → `-2`, two occupied → `-3`); a
     pre-existing file at the target keeps its bytes; an unwritable or missing target
     throws instead of resolving a path that does not exist.
446. Palette wiring in src/tui.tsx: `goal.dossier.export`
     ("Goal: export loop dossier (markdown file)", group Goal, palette-only — no key
     chord, no footer furniture), enabled whenever a goal exists on the current session
     (live or finished — same predicate as `goal.dossier.copy`). Both doors funnel into
     one `exportDossier(sessionID, goal)` helper: the palette run and the dialog's save
     row. One O_EXCL write into the host's cwd; the toast receipt carries the absolute
     path on success (5 s) and the filesystem's own message on failure (error variant,
     5 s). Nothing is written before the user explicitly picks the command or clicks the
     row.
447. Dialog wiring (the mouse-first twin): the dossier view paints a `save` row under the
     copy row only when the host wires `onSaveDossier`. Left-click writes (button !== 0
     inert, `stopPropagation`), hover boldens the row and paints a trailing `save` hint —
     the copy row's grammar, reused not reinvented. The in-modal acknowledgment uses its
     own verb: `✓ saved` (ascii `+ saved`) via a `savedSuffix` helper; "copied" would lie
     about the side effect. NO_COLOR/mono carry the words, never hue. Unwired, the row
     does not paint and the frame is byte-identical to before.
448. Tests: +10 pure tests in test/dossier-export.test.ts (UTC stamp format and
     determinism, epoch fallback for NaN/±Infinity/out-of-range clocks, byte-exact parity
     with `buildLoopDossier`, session-id absence, O_EXCL non-overwrite with suffix retry,
     stacked collisions landing on `-3`, the caller-directory-only rule, not-a-directory
     throw, missing directory throw, attempt-ceiling sanity); +4 mouse render tests in
     test/tui-render.test.tsx (click → exactly one host call + `✓ saved` ack, right-click
     inert, row absent when unwired, mono keeps the row's words). package-integrity
     re-pinned to 48 packed files (the new module ships). spec-check files=48 tests=1042.
449. Honest limits: the export is the record's bytes, verbatim — never re-verified, never
     reformatted, no elisions; the file is written only on explicit user action into the
     host's cwd and nowhere else; nothing is ever overwritten (the filesystem enforces
     it); there is no archive, no index, no auto-export on arm or land — one pick, one
     file, one receipt. Live-TUI behaviour remains unverifiable from this seat; wiring is
     verified at the source and the headless render layers only.

## Workstream DZ — parallel-work safety: the merge pipeline can no longer destroy work (2026-11-16)

Status: current. Incident: an external merge pipeline merged a submitted branch into dev and
force-removed the linked worktree while it held uncommitted redesign work (new test file, SPEC
marker bump, controller/types/wire/hud-card/index.ts edits, loop.test.ts rewrites). All of it was
lost except by luck of surviving in an agent's context. This workstream closes that incident
class in `packages/coordinator/bin/coordinator` and `scripts/spec-check.ts`, and ships the
protocol page `docs/parallel-work.md`.

Interpretation:
- Uncommitted bytes are the highest-priority asset in the pipeline. Any path that deletes a
  worktree (merge-next's cleanup; nothing else deletes worktrees) must first make those bytes
  recoverable: stash them into a named ref `refs/coordinator/saved/<slug>-<ts>` (a stash commit,
  kept also in `refs/stash`) and print the recovery commands. It never deletes a non-empty tree
  blindly; only the sanctioned `.term/coordinator/state.json` dirt is exempt.
- Merge work never happens in the main checkout. The trial merge moves into a dedicated
  `worktrees/wt-merge-check-<slug>-<ts>` worktree on branch `merge-check-<slug>-<ts>`; the main
  checkout must be on `dev` and tracked-clean at the start of any merge step, is verified again
  before the final step, and only ever receives a fast-forward of `dev`. `--review` stops before
  the fast-forward and prints the exact recovery command; on any failure dev is untouched and the
  error prints the exact recovery command.
- Lease-scoped paths become enforced, not advisory. `submit` (and `submit --force`, which logs
  the override into the lease record) checks every commit on `wt/<slug>` since the merge-base
  with `dev` against the claimed paths plus the configured shared scopes (`sharedPaths` in
  config.json; default `.term/coordinator/state.json` and `docs/changelog.html`); `**`-suffixed scopes match by prefix on
  segment boundaries, bare paths match exactly or as a directory prefix.
- Shared-counter determinism: the marker `<!-- spec-check files=N tests=N -->` is re-counted by
  the pipeline itself. `scripts/spec-check.ts --write` probes reality (npm pack file count, bun
  test pass count), rewrites the marker, and exits non-zero on a red suite (never writes a green
  claim over red). merge-next runs it in the merge worktree after the trial merge and commits the
  re-count on the scratch branch, so no agent hand-bumps and no merged tree fails the gate on a
  stale marker. `COORDINATOR_SKIP_SPEC_WRITE=1` disables.
- The changelog is pipeline-owned the same way: after the marker step, merge-next runs
  `bun scripts/docs-watch.ts once` in the merge worktree and commits any change on the scratch
  branch (`COORDINATOR_SKIP_DOCS_WATCH=1` disables), so parallel agents never race
  docs/changelog.html and the docs freshness gate passes on the merged tree.
- Preflight, not post-mortem: after the trial merge and before the gate runs, merge-next prints
  the files the merge touches and every non-done lease whose claimed paths overlap them (they
  will need a rebase onto dev), states the marker re-count it is about to make, and aborts early
  with the offending lease list. A red `bun test` in the merged tree is reported before the full
  gate runs.
- Merge locking that survives crashes: the mkdir lock records its holder (lease slug, scratch
  branch, pid, start time) in `.merge-lock-file`; stale-lock reclamation prints exactly what it
  reclaimed instead of silently deleting a live competitor's merge.
- Visibility: `status --json` gains per-lease `worktreePath`, `uncommitted` (count), and
  `mergeInProgress`; new `queue` view lists submitted leases FIFO with position, wait time and a
  rough ETA (mean of past merge durations); new `doctor` command checks main-checkout branch and
  cleanliness, dangling worktrees (done leases whose worktree still exists, live leases whose
  worktree is missing), dangling node_modules symlinks, SPEC marker vs reality, and merge-lock
  health; exits 1 on any FAIL.
- Branch hygiene: claim and the merge worktree ensure a usable `node_modules` (own install or a
  checked symlink to the main checkout's — verified target; dangling symlinks are replaced, never
  left behind). The main checkout never leaves `dev` during a merge.
- End-to-end: `test/coordinator-merge-safety.test.ts` simulates two agents claiming overlapping
  scopes with conflicting edits to shared files and asserts: no merge proceeds on a red gate,
  uncommitted bytes never vanish, the loser gets a clear rebase path, the winner lands on dev
  green.

Acceptance criteria:
1. merge-next never force-removes a dirty worktree without preserving its bytes in a named ref,
   and says so (hard test: untracked new file + modified tracked file in a submitted lease's
   worktree → merge → bytes recoverable via `git stash apply refs/coordinator/saved/<slug>-<ts>`).
2. Any merge failure leaves dev byte-identical and prints an exact recovery command; `--review`
   leaves the green scratch branch for inspection and prints the fast-forward command.
3. A commit touching files outside the claimed paths fails `submit`; the shared scopes pass;
   `submit --force` succeeds and records the override in the lease.
4. The merged tree's SPEC marker is re-counted and committed by merge-next itself before the
   gate; a fixture with a stale marker merges green with no agent bump; the changelog is
   regenerated on the merged tree the same way (fixture: a fake docs-watch in the merged tree
   leaves its row on dev; a failing docs-watch aborts the merge with dev untouched).
5. Main checkout stays on dev throughout a merge (test: the check script dirties the worktree —
   the merge still lands and dev is never left behind).
6. Stale merge-lock reclamation prints the reclaimed holder; lock file carries slug/branch/pid.
7. `status --json` carries the per-lease dirty state; `queue` orders submitted leases FIFO with
   an ETA; `doctor` fails on a dirty main checkout and on a dangling worktree.
8. The two-agent overlapping-scope scenario passes end-to-end.

Verification: `bun test test/coordinator-merge-safety.test.ts test/coordinator.test.ts` — 35 pass, 0 fail
(25 merge-safety tests, one added by the scratch-branch-order fixup, plus the 10 pre-existing
merge-next tests). The full suite is green at the merged HEAD; the marker is re-counted and committed
by merge-next itself on the merged tree, so the exact counts are not pinned here. The
two-agent overlapping-scope scenario is the acceptance
artifact (test/coordinator-merge-safety.test.ts, "two agents, overlapping scopes, conflicting edits"):
no red merge lands, dev stays untouched on the conflict and on the red gate, the loser rebases with the
printed path, the winner lands green, and the loser's uncommitted bytes are recoverable from
`refs/coordinator/saved/<slug>-<ts>` after the merge pipeline removes its worktree.

## Workstream DD — the card's menu grows the dossier's two doors; the dossier remembers its re-anchors (2026-11-16)

Interpretation: the dossier had two doors (the palette's `goal.dossier.copy` /
`goal.dossier.export`, and the dialog's copy / save rows) but the right-click surface —
the mouse-first menu where a stuck loop is un-stuck — never mentioned the record; and
the record itself printed nothing about the loop's own re-anchors, though the card painted
the count as ⟲ N since DY. DD closes both gaps without a new effect vocabulary: the card's
context menu grows two rows that funnel to the same two doors, and the dossier grows a
`## Re-anchor` section that reports the count and only the count.

450. HUD card context menu — six rows, fixed order, destructive last: `copy dossier` and
     `save dossier file` insert between `copy latest summary` and `clear goal`. The rows
     always paint (fixed geometry keeps the absolute mount's anchor stable); they are
     enabled iff the host wires BOTH dossier doors — the two-door wiring contract, the same
     grammar as the reason/summary rows (absent payload or absent wiring renders the row
     faint and swallows the press — never a trap). `src/core/hud.ts` owns the whole model:
     `ContextMenuId` widened to "copy-dossier" / "save-dossier", the two constants, the
     predicate `hasDossier`, and the fixed row order. The keymap's arrow-key selection
     (`nextMenuIndex`) skips the inert dossier rows exactly as it skips disabled reason/
     summary rows — no special cases. The card's anchor (`hudCardRows`,
     `CONTEXT_MENU_ROWS` 4 → 6) grows by exactly the two new rows; under a viewport ceiling
     the menu still never drops. `hud-card.tsx` maps the two ids to two host callbacks
     (`onCopyDossier` / `onSaveDossier`), both `menuAction`-wrapped (the menu collapses,
     the same as every row). Unwired, both rows render faint and do nothing.
451. Host wiring (`src/tui.tsx`): the card always receives both callbacks. Mouse and
     keyboard arms produce the same bytes through the same doors as the palette and the
     dialog — `buildLoopDossier(goal, Date.now())` through `copyToClipboard(…, "dossier")`,
     and `exportDossier` (the one O_EXCL write funnel, unchanged). The keyboard arm's
     eligibility mirrors the mouse predicate (`Boolean(goal)`; the host wires both doors
     whenever a goal exists — one source of truth at the call site, documented at the
     predicate). Footer chords stay p/c/x; nothing new is bound.
452. The dossier records its re-anchors. `## Re-anchor` sits between `## Boundary compaction`
     and `## Verify gate` — the two plumbing chapters stay neighbors, one section per thing
     the system does to the loop behind its back. A finite positive `reanchorCount` prints
     `- Re-anchors armed: N` plus the honesty line verbatim: the record keeps the count and
     nothing else; which turns were re-anchored and what the re-anchored prompt said are not
     logged anywhere; nothing is re-verified. Absent, zero, negative, NaN and ±Infinity
     render the absent line ("No post-compaction re-anchors on this record.") — a missing
     measurement is printed as missing, never as a guess. A fractional count renders verbatim.
453. Outline rail (DV contract): the hand-label table gains `["re-anchor", "re-anchor"]`
     (9 columns; the ≤ 12-column contract holds). The rail's partition rule is untouched —
     the section chips paint the document whole, one more chip, the same grammar.
454. Tests: +4 pure dossier tests (count present paints the number and the count-only
     honesty line; the section's position between the two plumbing chapters; absent/zero/
     negative/NaN/±Infinity all paint the absent line; a fractional count renders verbatim);
     `tui-hud.test.tsx` re-pinned to the six-row model (fixed order, both dossier rows
     enabled predicate, clear stays last and sole danger, `nextMenuIndex` skips dossier rows
     when unwired and honors them when wired, the viewport-ceiling test's menu arithmetic
     4 → 6, the keyboard-selection render test's clear row index 3 → 5); `tui-render.test.tsx`
     MenuSpies widened, "all six rows" pinned, +3 mouse tests (copy dossier fires the door and
     closes the menu, save dossier file fires the file door and closes the menu, and a
     half-wired host — only `onCopyDossier` wired — renders BOTH rows inert, clicks are
     swallowed, the menu stays open: the two-door contract is proven, not asserted); the
     named "dossier tab with the outline rail" snapshot re-recorded (one more `re-anchor`
     chip) and the "context menu open" frame re-recorded, snapshot test retitled to "all six
     rows live". package-integrity unchanged at 48 packed files (no new shipped module —
     the doors and the section ride existing files). spec-check files=48 tests=1054.
455. Honest limits: the menu rows write and copy the record as it exists — never re-verified,
     never reformatted, no elisions; the `## Re-anchor` section reports the count and invents
     no per-turn anchor history (none exists in the record, and none was invented); the file
     door writes only on explicit user action into the host's cwd, O_EXCL, never overwrites;
     the two dossier rows are the same artifact as the dialog's rows — one record, four doors;
     live-TUI behaviour remains unverifiable from this seat; wiring is verified at the source
     and the headless render layers only.

## Workstream DC — the dialog's scrollbar stops being a default widget (2026-11-16)

Interpretation: the status dialog's scrollbox (host-owned, `src/tui.tsx`) ships opentui's native
ScrollBar — a real GUI surface: drag the thumb with grab-offset math, click the track to page,
wheel scrolls, and the bar hides itself when the content fits. But left default it painted
opentui's hardcoded hex grays (`#9a9ea3` thumb on `#252527` track): invisible to light hosts,
indifferent to the mono arm, ignored by the NO_COLOR contract. DC keeps the mechanism and
owns the chrome — one pure module decides the two cells, one wiring site passes them through,
and the suite pins both the tones and the mouse grammar end-to-end.

456. `src/core/scrollbar.ts` (new shipped module): `scrollbarChrome(theme, mono)` returns
     the overlay-scrollbar chrome — track = `theme.background` (invisible; the bar recedes
     until needed, macOS-style) in both arms, thumb = `text.muted` in color (quiet chrome,
     never a hue) and `text.base` in mono (hue-dropping must not mean contrast-dropping —
     the brightest tone the palette has). `ScrollbarTheme<C>` = `NeutralTheme<C>` plus the
     host `background` token. No arrows, no extra state, no event wiring — color decision only.
457. Host wiring (`src/tui.tsx`): the dialog `<scrollbox>` passes
     `verticalScrollbarOptions={{ trackOptions: scrollbarChrome(context.theme, reducedColor), showArrows: false }}`
     — the `reducedColor` flag already threaded everywhere the dialog paints, so mono/NO_COLOR
     arm the bar through the same decision as every other cell. The wheel path, the keyboard
     chords, and the scrollbox ref contract are untouched.
458. Tests (`test/scrollbar.test.tsx`, new): three pure tone pins (color arm, mono arm, and
     the arms-differ-only-in-thumb-tone contract), and five headless-render mechanism pins at
     real coordinates — overflow paints the themed thumb over the invisible track (spans in the
     bar's last column, track bg asserted on every painted row), mono arm paints base everywhere
     and never muted, a fitting rail paints no bar cell at all, a `mockMouse.drag` on the thumb
     pages `scrollTop` (0 → >0, capped at the 52-row clamp), and a left-click on the track below
     the thumb pages toward the click. The drag/click pins ride the real opentui event pipeline,
     not a re-implementation.
459. Package integrity re-pinned: the pack grows by one shipped file (48 → 49); the
     `paths.length` pin in `test/package-integrity.test.ts` moves to 49 in the same commit.
     Tests: 1086 pass, 0 fail (42 files).
460. Honest limits: opentui owns the thumb math, visibility, and drag offset — this seat pins
     tones and event flow at the source and the headless render layers only; live-TUI behaviour
     remains unverifiable. The bar adds one overlay column inside the dialog's padding; the
     snapshot frames (char grid only, colors invisible to captureCharFrame) are unchanged.
     Track `background` under a host whose theme paints the dialog on a non-background surface
     would be a visible stripe — noted as a host-theme coupling, not an invented new token.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=49 tests=1086.

## Workstream EA — the tallies are quotable: the rail attestation row and the final tally copy one left click (2026-11-16)

Interpretation: the rail's `vN` row and the `final` tally row answer "what did this loop
actually do" with painted numbers, but those numbers were ink to stare at, not payload —
catching them for an issue, a handoff, or a review meant transcribing them by hand, drift
included. The mouse-first clause asks that what is painted be quotable. Both rows are now
click targets carrying exactly the line they paint, built by one shared pure module so the
copy can never quote numbers the paint disagrees with — the "quoted once" contract the
dossier established (DT) applied to the loop's own bookkeeping.

461. src/core/attestation.ts — new pure module, no I/O. `iterationAttestation(entry,
     durationMs)` builds the iteration receipt `v3 · met · 9 turns · 41 tools · 15m 00s ·
     already satisfied at HEAD · a1b2c3d · $4.20` — version, verdict, turns, tools,
     duration (formatDuration; omitted at 0/NaN/negative, never a lying `0s`), the
     zero-tool tag when `toolCalls === 0` (the quote explains itself off-surface), the
     sha sliced to the seven leading cells the rail paints (absent/blank → omitted,
     never guessed), and the cost only when it measures above zero.
     `finalTallyLine(status, totals)` builds the loop's receipt — the exact string the
     `final` row paints: status word, iterations, turns, tools, `formatDurationCoarse`
     wall (non-finite clamps to zero — never `NaNhNaNm`), and the spend honestly:
     `$4.62` when every iteration measured, `$12.34 across 3/5 measured` when partial,
     nothing when none — partial measurement is never presented as complete.
     `quoteSha` is the one sha slicer; `AttestationTotals` restates the loopTotals shape
     so the module does not import the renderer's world. Unit-tested in
     test/attestation.test.ts.
462. src/tui-history.tsx — LoopSection wires both. The rail attestation row gains
     left-click + stopPropagation copy (wired via `onCopyAttestation?: (line) => void`);
     the row boldens on hover (the NO_COLOR contract); after a copy a faint `✓ copied`
     (ascii `+ copied`) rides the row end as a flexShrink-0 sibling — outside the
     wrapping text, so the ack never wraps or shifts the row. The `final` tally row does
     the same via `onCopyTally?: (line) => void`, same bolden-on-hover, same acknowledgment.
     Right and middle clicks are inert; resting paint is byte-identical to before (hover
     only boldens, the ack only post-click); unwired, no handlers are attached and the
     paint is unchanged. The why ledger, trail, summary rail and fold rows are untouched.
463. src/status-dialog.tsx — the dialog body forwards `onCopyAttestation` / `onCopyTally`
     into LoopSection; src/tui.tsx wires both to the existing clipboard funnel
     (`copyToClipboard(line, sessionID, "attestation" | "tally")`), extending the `what`
     union and `copyLabel` ("attestation copied" / "tally copied"); the same toast
     grammar and the same `copyToClipboardOSC52` arm every other copy rides. No chord, no
     footer furniture — the palette is not involved; these are pointer affordances on
     painted rows.
464. Tests: +19 unit (attestation.test.ts: sha slicing, singular forms, hour/minute/second
     durations, zero-tool tag, duration/sha/cost omissions, NaN clamps, partial-measurement
     tally) + 5 interactive (tui-hud.test.tsx: v1 row click copies exactly
     `v1 · met · 9 turns · 41 tools · 15m 00s · a1b2c3d · $4.20` via real mockMouse hit
     coordinates; v2 click copies the newer line, not the older; the `final` row copies
     `loop achieved · 2 iterations · 15 turns · 64 tools · 30m wall · $4.62`; the ack
     paints on the clicked row; unwired paints identically with no ack). Package integrity
     re-pinned: the pack grows by one shipped file (49 → 50); the `paths.length` pin moves
     in the same commit. Tests: 1110 pass, 0 fail (43 files).
465. Honest limits: clicks are verified at the headless test-renderer layer (hit-test
     coordinates + clipboard payloads); live-TUI behaviour remains unverifiable. The
     attestation copies the row's suffix measurements, not the rail's full suffix set —
     the share-of-wall and ended-ago suffixes are deliberately excluded (they are relative
     to render time, so the quote would rot); the `shaSuffix` furniture elsewhere (why
     ledger) remains inert; the trail dots keep their reason-copy grammar. The copied
     payload is the record's own bytes — nothing added, nothing elided beyond the stated
     duration omission at zero/NaN.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=50 tests=1110.
<!-- spec-check files=68 tests=1893 -->

## Workstream EB — find-in-record: the dossier spotlight, one click from the record (2026-11-16)

Interpretation of the mouse-first clause: the dossier paints the whole record, but a reader who
knows the one word they need still scans a wall of text for it — the one tool every long record
needs was missing. This iteration adds a find spotlight to the dossier tab: a `find` row, the
same click grammar as the copy and save rows, toggles an inline bar (input, running count, a
close button); matching lines paint as segmented text with the matches bold — the NO_COLOR
contract keeps the signal in weight, never hue — non-matching lines demote to faint; blank query
paints the document exactly as ever; leaving the dossier tab closes and resets the bar so a
stale query can never greet the next visit. No chord, no palette, no footer furniture — the row
is the discovery surface, the way the dossier's other doors are.

466. src/core/find.ts — new pure module, no I/O, no JSX, no theme. `findMatches(texts, query)`
     is a literal, case-insensitive substring scan per line — the query is never reinterpreted
     as a pattern; a blank query matches nothing (it is not "match everything"). `countMatches`
     counts real occurrences, non-overlapping, left to right — "3 matches" means three places
     the record says the word, not three matching lines. `segmentLine` splits one line into
     segments that always tile the original text in order; when case folding preserves string
     length it certifies exact offsets, and when it does not (ß→ss, İ→i̇) the honest fallback
     paints a containing line as one whole match instead of misaligning a highlight — the copy
     is never dressed up with guessed offsets. `matchLabel` gives the count its words: "1
     match" / "N matches" / "no matches" — never a bare numeral. Unit-tested in
     test/find.test.ts.
467. src/status-dialog.tsx — the dossier view grows the find row between the save row and the
     outline rail: same hover affordance, same left-click grammar, `stopPropagation` on the
     power button only; the bar mounts one row below it (an inline `<input>` with a
     `type to find...` placeholder, a running `N matches`/`no matches` label, a `close`
     button); opening focuses the input via a ref, closing unmounts the bar and resets the
     query (the reset makes a stale query impossible by construction); leaving the dossier tab
     force-closes and resets the bar. Matching lines paint segmented — matches ride `<strong>`
     (weight, the NO_COLOR contract) — non-matching lines demote to faint wholesale; un-searched
     paint is byte-identical to before. The mono arm holds (weight alone carries the
     highlight); the 80-column floor and Unicode-safe glyphs are untouched.
468. Two paint-level defects the headless renderer forced into the open, fixed honestly.
     (a) opentui's hit grid awards every cell to the last render pass over it — not to layout
     order — and the dossier rows mounted after the find row in that order, their single-line
     word-wrap text rects measuring two rows tall and claiming the find row's cells; a left
     click on `find in the record` landed on the inert copy row and died. The find row now
     sorts last in the claim order (`zIndex={1}`) so it wins its own row's cells;
     (b) the find arms were computed at row creation — fg, attributes and children were
     creation-time constants, so the count label advanced while the document never repainted:
     a split-brain "the feature is on" with a static record. Every expression in the row now
     reads the find signals, so the same `<text>` tracks the query — un-searched, dimmed and
     segmented paint are one element's reactive props, and the row always repaints as the bar
     fills. The copy and save rows were converted from `<Show>` to plain conditionals in the
     same pass (eager mount, same visual) to remove the lazy-mount ordering from this class of
     bug. The outline rail and the save acknowledgment keep their existing mount behavior —
     they overlap nothing.
469. Tests: +18 unit (find.test.ts: literal scan, case insensitivity, blank-query silence,
     occurrence counting, segment tiling incl. fold-length drift across ß/İ/µ, count/label
     words) + 6 interactive (tui-render.test.tsx: the row paints, the toggle opens and closes
     and resets, typing filters and bolds the matches (weight asserted via captureSpans), a
     zero-occurrence query demotes the document to faint and says `no matches`, the close
     button clears and unmounts, leaving the dossier tab resets, the mono arm holds the
     highlight). Two dossier full-frame snapshots re-recorded — the find row is new chrome by
     design, added to the dossier frames, byte-identical elsewhere. Package integrity
     re-pinned: the pack grows by one shipped file (50 → 51); the `paths.length` pin moves in
     the same commit. Tests: 1134 pass, 0 fail (44 files).
470. Honest limits: matching is a literal substring scan — no regex, no fuzzy match, no
     whole-word mode; the case-fold-length-drift arm paints a whole containing line as one
     match rather than a misaligned highlight; the count counts occurrences in the rendered
     document, not in the copy payload; verification is at the headless test-renderer layer
     (hit-test coordinates, captured spans) — live-TUI behaviour remains unverifiable. The
     inert unwired rows stay inert; the bar does not auto-scroll the record — the spotlight
     finds, the scrollbox scrolls.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=51 tests=1134.
<!-- spec-check files=68 tests=1893 -->

## Workstream EC — the record, on trial: the dossier answers “is this real?” (2026-11-16)

Interpretation of the mouse-first clause: the dossier paints the whole record, the copy row hands
it over, the save row writes it to disk, the outline rail quotes it in parts, find spots the one
word it needs — but nobody asks the document the one question every receipt must survive: are the
shas it quotes still resolvable? A record that cannot be checked is a claim, not an attestation.
This iteration adds the verification pass: a `verify` row in the dossier view (one click, the same
grammar as copy and save) and a palette twin `goal.dossier.verify` — one probe per sha the ledger
quotes, the outcome painted in place, the Markdown verification report on the clipboard. No chord,
no footer furniture; the palette and the row are the discovery surfaces.

471. src/core/verify-record.ts — new pure module, no JSX, no theme; the probe is injected.
     `recordShaMentions(goal)` extracts exactly the shas the record quotes — the loop ledger's
     per-iteration `sha`, oldest first — deduplicated by sha with the quoting iterations listed
     (first-appearance order, never re-sorted); entries without a sha are skipped, never guessed.
     `verifyRecord(goal, probe)` sweeps those shas; the probe contract is three-valued
     (`true` exists / `false` git answered and the object does not resolve / `"unknown"` git could
     not answer) and a probe that throws degrades one row to `unknown` instead of sinking the
     sweep — one bad row never fails the report. `gitCatFileProbe(cwd)` is the real probe: one
     `git -C <dir> cat-file -e <sha>` per sha, 10 s timeout; a numeric exit status means git
     answered (0 exists; anything else — including a non-hex sha — is an unresolvable receipt);
     a spawn failure or timeout is `unknown`, categorically not `missing`. `verifyReportMarkdown`
     renders the report: generation stamp, the probed directory, the one-line condition, one table
     row per unique sha (sha · quoting iterations · yes/no/unknown), the present/missing/unknown
     counts, and an honesty footer stating what existence does not prove (ancestry) and what
     absence is not (misconduct); a record with no quoted shas paints a GAP row, never an empty
     table dressed as a pass. `verifySummaryLine` is the chrome-free one-liner for the toast;
     `verifyAckSegment` is the compact in-row acknowledgement (`✓ N/N resolve` / ascii `+ N/N
     resolve`, the unresolvable arm `✗`→`-`, the unknown arm `!`) — a record with no quoted shas
     says so rather than painting a pass.
472. src/status-dialog.tsx — the dossier view grows the verify row between the save row and the
     find row: same hover affordance, same left-click grammar, `stopPropagation` and `zIndex={1}`
     (the hit-grid claim order the find row already established — this row, like the find row,
     must win its own row's cells against the sibling rows' overflowing text rects). The clicked
     row paints the outcome via `verifyAckSegment` for the usual acknowledgment window (2.4 s —
     the counts deserve a beat longer than a verb). A host that returns `undefined` ran nothing
     the UI can attest to: the click registers, no ack paints — the row never claims a sweep that
     did not happen. Unwired, the row does not paint; the document renders exactly as before.
473. src/tui.tsx — `verifyRecordAction` runs the sweep against `process.cwd()` (the same directory
     the export row writes into), copies the Markdown report via OSC52, and toasts the outcome —
     `record verified` (success) / `record does not verify` (error) / `record unverifiable`
     (warning) / `nothing to verify`; a record with no quoted shas is stated, never glossed. Both
     `StatusDialogBody` instantiation sites wire `onVerifyDossier` (the dialog and the card-side
     frame). Palette command `goal.dossier.verify` ("Goal: verify the record (shas + markdown
     report)") with the same action; no footer chord. The outcome toast carries the honesty rule:
     unknown is never folded into missing.
474. Tests: +19 unit (verify-record.test.ts: mentions dedupe/order/trim, all-present and mixed
     sweeps, throwing probe → per-row unknown, unanswerable probe → all-unknown, non-hex sha
     reaches the probe, empty record, report contents (stamp/directory/table/counts/honesty
     footer/GAP row), staleness pair, summary-line and ack-segment arms incl. ascii) + 6
     interactive (tui-render.test.tsx: the row paints and a click runs the host sweep and paints
     `✓ 2/2 resolve`, mono demotes to `+ 6/6`, a missing sha paints the unresolvable arm, right
     click inert, unwired row absent, host returning undefined paints no ack). Tests: 1159 pass,
     0 fail (45 files).
475. Honest limits: existence is not ancestry and says nothing about the working tree's
     cleanliness; absence is an unresolvable receipt, not proof of misconduct — the report says
     what the repository still holds, at the named directory, at generation time; a stale report
     is identified by its stamp, never by trust; the probe requires a git binary and a repository
     at the probed cwd — outside one, every row reads `unknown` and the report says so — no
     fallback invents object existence; the verification is per-sha existence only (no
     reachability from any ref, no signature check, no content compare); verification is at the
     headless test-renderer layer — live-TUI behaviour remains unverifiable. The dossier bytes
     themselves are unchanged — the verification report is a separate artifact, and the export
     path still writes exactly the document.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=52 tests=1159.
<!-- spec-check files=68 tests=1893 -->

## Workstream ED — the record, in reach: ancestry, one click from the record (2026-11-16)

Interpretation of the mouse-first clause: EC asked the record whether the shas it quotes still
resolve in the object store — existence. The question that remains after existence is placement:
does the history this session was built on actually carry those commits, or is the record
attesting work that lives on a branch, a rewrite, or nowhere this checkout can see? This
iteration adds the ancestry pass: a `reach` row in the dossier view (one click, the same grammar
as copy/save/verify) and a palette twin `goal.dossier.reach` — one `git merge-base --is-ancestor
<sha> HEAD` per quoted sha, the outcome painted in place, the Markdown ancestry report on the
clipboard. No chord, no footer furniture; the palette and the row are the discovery surfaces.
EC and ED are complementary and neither substitutes for the other; together they answer the two
halves of “is this real?” — the object exists, and the object is on this line.

476. src/core/reach-record.ts — new pure module, no JSX, no theme; the probe is injected, and the
     mention extraction is imported from verify-record.ts (`recordShaMentions`), never reimplemented.
     `reachRecord(goal, probe)` sweeps the quoted shas; the probe contract is three-valued
     (`true` ancestor / `false` git answered and not an ancestor (exit 1) / `"unknown"` git could
     not answer) and a probe that throws degrades one row to `unknown` instead of sinking the
     sweep. `gitAncestorProbe(cwd)` is the real probe: one `git -C <dir> merge-base --is-ancestor
     <sha> HEAD` per sha, 10 s timeout; exit 0 → ancestor, exit 1 → not on this line (git answered),
     every other outcome — exit ≥ 2 (including 128 for an unparseable sha), a spawn failure, a
     timeout — is `unknown`, categorically not `no`. `reachReportMarkdown` renders the report:
     generation stamp, the probed directory, the one-line condition, one table row per unique sha
     (sha · quoting iterations · yes/no/unknown), the on-this-line/not/unknown counts, and an
     honesty footer stating what unreached does not imply (another branch, a rewrite, a record that
     predates the merge) and that ancestry is not content; a record with no quoted shas paints a
     GAP row, never an empty table dressed as a pass. `reachSummaryLine` is the chrome-free
     one-liner for the toast; `reachAckSegment` is the compact in-row acknowledgement
     (`✓ N/N on this line` / ascii `+ N/N on this line`, the unreached arm `✗`→`-`, the unknown
     arm `!`).
477. src/status-dialog.tsx — the dossier view grows the reach row between the verify row and the
     find row: same hover affordance, same left-click grammar, `stopPropagation` and `zIndex={1}`
     (the hit-grid claim order the find row established). The clicked row paints the outcome via
     `reachAckSegment` for the usual 2.4 s acknowledgment window; a host returning `undefined`
     paints no ack — the row never claims a sweep that did not happen. Unwired, the row does not
     paint; the document renders exactly as before.
478. src/tui.tsx — `reachRecordAction` runs the sweep against `process.cwd()` (the same directory
     the export row writes into), copies the Markdown report via OSC52, and toasts the outcome —
     `record reaches HEAD` (success) / `record does not reach HEAD` (warning) / `record
     unverifiable` (warning) / `nothing to place` (success). Not-on-this-line is a warning, never
     an error: it is the expected answer mid-loop before the merge, and the honesty rule is that
     information is not accusation. Both outcomes keep unknown categorically out of the not bucket.
     Palette command `goal.dossier.reach` ("Goal: verify the record reaches HEAD (shas + markdown
     report)") with the same action; no footer chord.
479. Tests: +16 unit (reach-record.test.ts: all-on-this-line and mixed sweeps, throwing probe →
     per-row unknown, unanswerable probe → all-unknown, non-hex sha reaches the probe, empty
     record, report contents (stamp/directory/table/counts/honesty footer/GAP row), staleness pair,
     summary-line and ack-segment arms incl. ascii) + 6 interactive (tui-render.test.tsx: the row
     paints and a click runs the host sweep and paints `✓ 2/2 on this line`, mono demotes to
     `+ 6/6 on this line`, an unreached sha paints the unreached arm, right click inert, unwired row
     absent, host returning undefined paints no ack). Tests: 1181 pass, 0 fail (46 files).
480. Honest limits: ancestry is per-sha and from HEAD only — it says nothing about which ref the
     work landed on, signatures, the content of the commit, or the working tree's cleanliness;
     not-on-this-line is expected mid-loop before the merge and means the checkout cannot see the
     commit, not that the record is false; unknown means git could not answer and is never counted
     as no; a stale report is identified by its stamp, never by trust; the probe requires a git
     binary and a repository at the probed cwd; ancestry verification is at the headless
     test-renderer layer — live-TUI behaviour remains unverifiable. The dossier bytes themselves are
     unchanged — the ancestry report is a separate artifact, and the export path still writes
     exactly the document.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=53 tests=1181.
<!-- spec-check files=68 tests=1893 -->

## Workstream EF — the record, under seal: the shas the record quotes carry a signature, one click from the record (2026-11-16)

Interpretation of the mouse-first clause: EC asked the record whether the shas it quotes still
resolve in the object store — existence. ED asked whether they belong to this history — ancestry.
The question that remains is the seal: does git verify a signature on the commit the record
attests? Most commits are unsigned, and git decides against the keys and trust configured at the
probed directory — so the question is not "is this author honest" but "does the receipt carry a
checkable mark". This iteration adds the signature pass: a `sign` row in the dossier view (one
click, the same grammar as copy/save/verify/reach) and a palette twin `goal.dossier.sign` — one
`git cat-file -e` (the signature question has no subject without an object to judge) and one
`git verify-commit` per quoted sha, the outcome painted in place, the Markdown signature report on
the clipboard. No chord, no footer furniture; the palette and the row are the discovery surfaces.
EC, ED and EF are the three halves of “is this real?” — the object exists, the object is on this
line, the object carries a verifiable mark. None substitutes for another.

481. src/core/sign-record.ts — new pure module, no JSX, no theme; the probe is injected, and the
     mention extraction is imported from verify-record.ts (`recordShaMentions`), never reimplemented.
     `signRecord(goal, probe)` sweeps the quoted shas; the probe contract is three-valued
     (`true` git verified / `false` git answered and the signature did not verify / `"unknown"` git
     could not answer) and a probe that throws degrades one row to `unknown` instead of sinking the
     sweep. `gitSignProbe(cwd)` is the real probe: one `git -C <dir> cat-file -e <sha>` per sha
     first — an unresolvable object reads `unknown`, categorically not `unverified`, because
     `verify-commit` cannot tell “not verified” from “not found” from its exit status alone — then one
     `git -C <dir> verify-commit <sha>`; numeric exit 0 → verified, any numeric exit → `unverified`
     (unsigned, expired key, untrusted key, bad signature — one bucket by design and by doc), a
     spawn failure or timeout → `unknown`, never folded into `unverified`. `signReportMarkdown`
     renders the report: generation stamp, the probed directory, the one-line condition, one table
     row per unique sha (sha · quoting iterations · yes/no/unknown), the verified/not-under-seal/
     unknown counts, and an honesty footer stating what `not under seal` does not imply (most commits
     are unsigned and git’s thresholds differ across machines and time; never proof of forgery) and
     that an unresolvable object reads `unknown`, never `not under seal`; a record with no quoted shas
     paints a GAP row, never an empty table dressed as a pass. `signSummaryLine` is the chrome-free
     one-liner for the toast; `signAckSegment` is the compact in-row acknowledgement
     (`✓ N/N signed` / ascii `+ N/N signed`, the unverified arm `✗`→`-`, the unknown arm `!`) — a
     record with no quoted shas says so rather than painting a pass.
482. src/status-dialog.tsx — the dossier view grows the sign row between the reach row and the
     find row: same hover affordance, same left-click grammar, `stopPropagation` and `zIndex={1}`
     (the hit-grid claim order the find row established). The clicked row paints the outcome via
     `signAckSegment` for the usual acknowledgment window; a host returning `undefined` paints no ack —
     the row never claims a sweep that did not happen. Unwired, the row does not paint; the
     document renders exactly as before.
483. src/tui.tsx — `signRecordAction` runs the sweep against `process.cwd()` (the same directory the
     export row writes into), copies the Markdown report via OSC52, and toasts the outcome —
     `record under seal` (success) / `record not under seal` (warning) / `record unverifiable`
     (warning) / `nothing to attest` (success). Not signed is a warning, never an error: git’s own
     rules decide against the keys trusted at the probed directory, and most commits are unsigned —
     information is not accusation. Both failure-leaning outcomes keep unknown categorically out of
     the not-under-seal bucket. Palette command `goal.dossier.sign`
     ("Goal: verify the record’s signatures (shas + markdown report)") with the same action; no footer chord.
     `StatusDialogBody` wires `onSignDossier` next to `onReachDossier` (one instantiation site).
484. Tests: +16 unit (sign-record.test.ts: all-under-seal and mixed sweeps, throwing probe → per-row
     unknown, unanswerable probe → all-unknown, non-hex sha reaches the probe, empty record, report
     contents (stamp/directory/table/counts/honesty footer/GAP row), staleness pair, summary-line and
     ack-segment arms incl. ascii) + 6 interactive (tui-render.test.tsx: the row paints and a click runs
     the host sweep and paints `✓ 2/2 signed`, mono demotes to `+ 6/6 signed`, an unverified sha paints
     the unverified arm, right click inert, unwired row absent, host returning undefined paints no ack).
     Tests: 1203 pass, 0 fail (47 files).
485. Honest limits: the signature check is only as strong as the key and trust configured at the
     probed directory — `verified` means git’s configured rules accepted the signature, nothing more;
     an unsigned commit, an expired or untrusted key, and a bad signature are one bucket by design, and
     none is proof of forgery; an unresolvable object reads `unknown`, never `unverified`; unknown
     means git could not answer and is never counted as `no`; the probe requires a git binary and a
     repository at the probed cwd — outside one, every row reads `unknown` and the report says so — no
     fallback invents a signature; verification is per-sha at the commit level only (no author-key
     inventory, no signature-format inspection, no chain-of-trust documentation); signature verification
     is at the headless test-renderer layer — live-TUI behaviour remains unverifiable. The dossier bytes
     themselves are unchanged — the signature report is a separate artifact, and the export path still
     writes exactly the document.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=54 tests=1203.
<!-- spec-check files=68 tests=1893 -->

## Workstream EG — the dossier, sealed: the proofs ride the file (2026-11-16)

Interpretation of the mouse-first clause: EC asked the record whether the shas it quotes still
resolve — existence. ED asked whether they belong to this line — ancestry. EF asked whether the
object carries a verifiable mark — the seal. Each answer is a standalone report on the clipboard,
and each says what it says alone. The question this iteration answers is the one a handoff
actually holds: the *file* leaves the process, and nothing about the file carried its own
receipts. This iteration adds the seal: one fresh pass of all three sweeps at export time, the
three answers joined per sha into one table, appended to the record's own bytes —
`goal.dossier.seal` (palette only: no chord, no footer furniture) and a seal row in the dossier
view (one click, same grammar as copy/save/verify/reach/sign), writing
`goal-dossier-sealed-<stamp>.md` into the host's cwd. The plain export path is untouched, byte
for byte; the sealed twin is the one that attests. The three sweeps are not reimplemented — the
extant `verifyRecord` / `reachRecord` / `signRecord` run with the same injected-probe contracts,
and a probe that throws degrades its row to `unknown` instead of sinking the seal.

486. src/core/dossier-seal.ts — new pure module, no JSX, no theme. `sealRecord(goal, directory,
     nowMs, probes?)` runs the three sweeps (defaults: the real synchronous probes at
     `directory`) and renders the sealed document: `buildLoopDossier` output carried byte for
     byte, then a `## Attestation (freshly probed at seal time)` appendix — the generation
     stamp, the probed directory, one table row per unique sha (sha · quoting iterations ·
     exists · on this line · under seal), the four counts lines, and a closing honesty
     paragraph. `clean` is computed over rows that answered yes on all three questions, joined
     by sha; everything else (no / unknown on any question) is not clean. `unknown` is never
     counted as a pass or a fail. A record with no quoted shas paints a GAP sentence — one
     honest line, no table, never a fabricated `0 of 0`. `cleanShaCount` is the join, exported
     for tests; `attestationAppendix` renders the section for tests; `sealedDossierName` stamps
     the `goal-dossier-sealed-` stem (never the plain export's stem) with the same O_EXCL
     collision-retry grammar via `MAX_EXPORT_ATTEMPTS` (imported, never redefined);
     `exportSealedDossier(goal, nowMs, dir, probes?)` writes one new file, O_EXCL, never
     overwrites, throws rather than resolve partial. `sealSummaryLine` is the toast's
     chrome-free one-liner; `sealAckSegment` is the in-row acknowledgement
     (`✓ N/N sealed` / ascii `+`, the hard-failure arm `✗ N of M sealed` / ascii `-`, the
     unknown-only arm `!`), and an unwired or failed seal paints no ack. The base document's
     trailing line is unchanged — the appendix opens by stating that the bookkeeping above was
     not re-verified and that only the quoted shas are re-probed, fresh, at seal time.
487. src/status-dialog.tsx — the dossier view grows the seal row between the sign row and the
     find row: same hover affordance, same left-click grammar, `stopPropagation` and
     `zIndex={1}` (the hit-grid claim order the reach and sign rows established). The clicked
     row paints the outcome via `sealAckSegment` for the usual acknowledgement window; a host
     returning `undefined` paints no ack — the row never claims a seal that did not happen.
     Unwired, the row does not paint; the document renders exactly as before.
488. src/tui.tsx — `sealRecordAction` runs the export against `process.cwd()` (the same
     directory the plain export writes into), toasts the path and the summary —
     `record sealed` (success) / `record sealed with gaps` (warning) / `nothing to seal`
     (success); gaps and unknowns warn, never error: the appendix says what git answered, and
     git's thresholds differ across machines and time — information is not accusation; an
     unresolvable object reads `unknown` on the existence question and is never counted as
     not-on-this-line or not-under-seal. Palette command `goal.dossier.seal`
     ("Goal: seal the dossier with a fresh attestation (file)") with the same action; no footer
     chord. `StatusDialogBody` wires `onSealDossier` next to `onSignDossier` (one instantiation
     site).
489. Tests: +25 unit (dossier-seal.test.ts: name stamping incl. the non-finite-clock epoch
     fallback, the byte-for-byte base carry and the appendix placed after `## Totals`, the
     all-clean sweep (3×yes, `clean === unique`, counts line and stamp/directory present), each
     gate alone (a failing seal is not clean; unreached is not clean; a missing object is not
     clean), unknown never counted as pass or fail, a throwing probe degrades per-row to
     `unknown` without sinking the seal, the empty record's GAP sentence (no table), sha
     dedupe with oldest-first quoting iterations listed, the not-re-verified and stale-copy
     sentences, the `cleanShaCount` join, the file write (bytes match the sealed markdown,
     pre-existing target never overwritten, suffix retry, unwritable directory throws), and the
     summary-line and ack-segment arms incl. ascii) + 7 interactive (tui-render.test.tsx: the
     row paints and a click runs the host seal and paints `✓ 2/2 sealed`, mono demotes to
     `+ 6/6 sealed`, a hard failure paints the cross arm, unknowns only paint the bang arm,
     right click inert, unwired row absent, host returning undefined paints no ack).
     Tests: 1235 pass, 0 fail (48 files).
490. Honest limits: the seal is only as strong as the three sweeps behind it — git's configured
     rules decide against the keys and trust at the probed directory, and `verified` means
     those rules accepted the signature, nothing more; most commits are unsigned, and not under
     seal is not an accusation; existence is not ancestry, ancestry is not the seal — the clean
     count is the strongest claim this module makes and is still only what three `git` processes
     answered at seal time; `unknown` never means no, on any of the three questions; the probes
     require a git binary and a repository at the probed cwd — outside one, every row reads
     `unknown` and the appendix says so; the plain `goal.dossier.export` path is deliberately
     unchanged — the sealed twin is a new artifact, and the base document's bytes inside it are
     not re-verified, only the shas the record quotes are re-probed; the sweep is per-sha at the
     commit level only (no author-key inventory, no chain-of-trust documentation); sealing is at
     the headless test-renderer layer — live-TUI behaviour remains unverifiable.

## Workstream EH — the sealed dossier, on trial again: drift since sealing (2026-11-16)

Interpretation of the mouse-first clause: EG sealed the record's shas into the file a handoff
carries — but a sealed file does not stay true by itself. The question the counterparty
holding that file asks weeks later is the one this iteration answers: *is what the file
attested still true of the repository right now?* `goal.dossier.attest` (palette only: no
chord, no footer furniture) finds the newest `goal-dossier-sealed-*.md` in the host's cwd,
parses its `## Attestation` appendix, re-probes every sha the appendix names against HEAD at
the host's cwd — the same extant `verifyRecord` / `reachRecord` / `signRecord` with the same
injected-probe contracts, never reimplemented — and reports drift since sealing: a sha clean
on all three at seal time whose exists / on-this-line / under-seal answer flips from yes to
no. A fresh `unknown` is never drift and never a pass; a sha that was not clean at seal time
cannot regress and reads `was-not-clean`; the counts name every class, and the report says
what it cannot prove. Plain `goal.dossier.seal` and `goal.dossier.export` are untouched.

491. src/core/dossier-attest.ts — new pure module, no JSX, no theme. `parseAttestationAppendix(markdown)`
     never throws: `unsealed` (no `## Attestation` heading) / `unparsable` (heading, no readable row
     and no GAP sentence) / `sealed` — rows (sha exactly as the file spells it, quoting iterations,
     the three seal-time answers), the seal-time stamp and directory when present, the GAP flag,
     and `malformed` for table-looking rows the parser cannot read (counted, never silently kept).
     `attestSealedDossier(markdown, directory, probes?)` re-probes fresh and classifies each row
     `held` (yes on all three at seal time, yes now) / `regressed` (git flipped a yes to a no;
     `flipped` names the questions) / `unknown` (was clean, no flip to no, but git could not answer —
     never drift, never a pass) / `was-not-clean` (not clean at seal time — reported, never blamed);
     the empty seal attests to zero shas, printed as the empty truth it is. `attestationReportMarkdown`
     — fresh, self-describing (generation time, probed directory, the re-attested file, seal-time
     stamp and directory), per-row table with the verdict and the flipped questions, a finishing
     counts line, and a tamper-honesty footer: the report detects divergence between seal-time answers
     and fresh ones, not edits to the appendix's prose. `attestSummaryLine` is the toast's chrome-free
     one-liner. `selectNewestSealedDossier(entries)` — deterministic newest-first selection over
     `goal-dossier-sealed-*.md` names (stamp, then collision-attempt suffix, then mtime); the plain
     export's stem never qualifies. No new probes; the extant three run with the same
     injected-probe contracts everywhere (tests inject; no test spawns git).
492. src/tui.tsx — `attestSealedDossierAction` + palette command `goal.dossier.attest`
     ("Goal: attest a sealed dossier against HEAD (drift report)"). Reads the newest sealed file
     in `process.cwd()` (readdir + stat, selection via `selectNewestSealedDossier`), re-probes,
     copies the Markdown drift report (OSC52, like the sibling commands), toasts
     `attestation holds` (success) / `attestation drifted` / `attestation unverifiable` /
     `nothing to attest` (warning — drift means the repository moved or the seal was made
     elsewhere; information is not accusation, so drift never toasts as an error) /
     `no sealed dossier` when none is found / `not a sealed dossier` for a plain export /
     `attestation unreadable` when the appendix parses to nothing; read failures toast error.
     Enabled regardless of goal state — it re-probes a file, not the session. No footer chord,
     no dialog row, the palette is the surface.
493. Tests: +18 unit (dossier-attest.test.ts: the fresh sealed fixture (sealRecord with injected
     probes) parses to stamp/directory/rows/iterations, a plain export is `unsealed`, the GAP
     record parses as zero rows, a heading with no readable row is `unparsable`, garbage answer
     cells degrade to `unknown` (case-insensitive) and non-sha rows are counted malformed; all-yes
     now `held`s; a yes flipped to no is `regressed` naming the question; a fresh unknown is not
     drift; a seal-time failure cannot regress (`was-not-clean`); a flip wins over a co-occurring
     unknown; the empty seal never fabricates; a throwing probe degrades per-row; fresh probes
     receive the sha exactly as the file spells it; `selectNewestSealedDossier` (stamp order,
     attempt-suffix beats base at the same stamp, plain export stem ignored, mtime tie-break,
     undefined on empty); report contents incl. the tamper-honesty footer; every summary-line
     arm) + re-pinned pack count 56. Tests: 1253 pass, 0 fail (49 files).
494. Honest limits: the appendix is parsed, never trusted — the sweep detects divergence between
     seal-time answers and fresh ones, not tampering with the bytes around the table; shas are
     re-probed exactly as the appendix spells them (the 7-character abbreviations the sealed
     document prints; git resolves them in the sealing repository, and if one stops naming a
     unique object the affected question fails closed — for existence that reads `missing`, and a
     file whose reference no longer names one object has failed its trial either way); `unknown`
     never counts on either side; drift is computed only over rows clean at seal time; the probes
     require a git binary and a repository at the probed cwd — outside one, every fresh answer
     reads `unknown`; the plain export and the sealed twin are untouched by this command; headless
     test-renderer layer, live TUI unverifiable.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=55 tests=1235.
<!-- spec-check files=68 tests=1893 -->

## Workstream EI — the review, in one file: every question git can answer (2026-11-16)

Interpretation of the mouse-first clause: the arc so far sealed the record (EG), attested the
sealed file later (EH) — but a reviewer opening a handoff cold still has to run three commands
or three palette entries and hold three reports in their head. This iteration writes the capstone:
`goal.dossier.review` (palette only: no chord, no footer furniture) re-runs the extant three
sweeps (existence, ancestry, the seal) against the repository at the host's cwd and writes ONE
O_EXCL file — the record's own bytes, then a single combined appendix whose per-sha rows carry
every answer git gave plus one honest verdict column (`clean` / `gaps` / `unknown`) and a finishing
counts line. The standalone verify/reach/sign commands remain available one question at a time;
the sealed twin and the plain export are untouched. Gaps and unknowns toast a warning, never an
error — information is not accusation.

495. src/core/dossier-review.ts — new pure module, no JSX, no theme. `reviewName(nowMs,
     attempt?)` stamps `goal-dossier-review-<YYYYMMDD-HHMMSS>[-n].md` (a non-finite clock stamps
     the epoch; deterministic). `reviewVerdict(exists, onThisLine, underSeal)` is the one honest
     collapse: all yes → `clean`; any no → `gaps`; no no anywhere but at least one question git
     could not answer → `unknown` — never collapsed into either. `buildReview(goal, directory,
     nowMs, probes?)` runs the extant `verifyRecord` / `reachRecord` / `signRecord` (same
     injected-probe contracts, never reimplemented; a probe that throws degrades its question to
     `unknown`), renders the base document byte-for-byte first, then a
     `## Review (freshly probed at generation time)` appendix — self-describing (generation time,
     probed directory), a per-row table (sha · quoted at · the three answers · verdict), the
     finishing counts (`- All three: N of M shas clean … · G with gaps · U unverifiable`), and a
     footer that restates what a clean row proves and what it does not (existence is not ancestry,
     ancestry is not the seal; the file is a snapshot of its receipts; `goal.dossier.attest`
     re-checks a sealed copy weeks later). A record with no quoted shas renders the GAP sentence,
     no table, and a summary line that says so. `exportReview(goal, nowMs, dir, probes?)` writes
     O_EXCL with collision retries (`MAX_EXPORT_ATTEMPTS`), never overwrites, and throws with the
     filesystem's own message — the target is always the existing caller-named directory.
     `reviewSummaryLine` is the toast's chrome-free one-liner.
496. src/tui.tsx — `reviewRecordAction` + palette command `goal.dossier.review`
     ("Goal: review the dossier in one file (every question git can answer)"). Writes the file
     into `process.cwd()`; toasts `review written` (success) / `review written with gaps` /
     `review unverifiable` / `nothing to review` (warning for the last three — the repository
     moved or the machine differs; information is not accusation, so gaps never toast as an
     error); read/write failures toast error with the filesystem's own message. Enabled when a
     goal is live, like the sealed twin. No footer chord, no dialog row, the palette is the surface.
497. Tests: +17 unit (dossier-review.test.ts: `reviewName` stem/suffix/epoch and its independence
     from the sealed and plain stems; the `reviewVerdict` truth table (all-yes clean, any no
     gaps wherever it sits, no-no-plus-unknown stays unknown); the base document rides byte-for-
     byte and the appendix lands after `## Totals`; an all-clean sweep (yes/yes/yes/clean rows,
     counts line, stamp and directory in the appendix); a single no reads gaps wherever it sits;
     a fresh unknown is unknown, never clean, never gaps; a throwing probe degrades its question
     to unknown; mixed jailed answers land in rows and counts; the GAP record renders one honest
     sentence and no table; every `reviewSummaryLine` arm; `exportReview` writes one new file
     (path/bytes/attempts), never overwrites (suffix `-2` on collision, pre-existing bytes kept),
     the written bytes match a fresh build of the same clock, and a missing directory throws) +
     re-pinned pack count 57. Tests: 1270 pass, 0 fail (50 files).
498. Honest limits: the appendix is generated, never trusted later — re-probing is
     `goal.dossier.attest`'s job for a sealed copy, and this command does not attest anything;
     `clean` means three git processes answered yes at generation time, nothing more; `gaps` names
     a no, not misconduct (most commits are unsigned; existence is not ancestry, ancestry is not
     the seal); `unknown` never counts on either side and a probe outage yields an all-unknown
     review that says so; the record's own bytes above the appendix were not re-verified; the probes
     require a git binary and a repository at the probed cwd — outside one, every answer reads
     `unknown`; the plain export and the sealed twin are untouched; headless test-renderer layer,
     live TUI unverifiable.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=56 tests=1253.
<!-- spec-check files=68 tests=1893 -->

## Workstream EJ — the spend ledger, one file (2026-11-16)

Interpretation of the mouse-first clause: the dossier family says what the loop did — review asks
git three questions, attest re-checks a seal, the record's own bytes ship in three flavors — but
no artifact answers what the loop cost. This iteration writes the cost story:
`goal.dossier.spend` (palette only: no chord, no footer furniture) writes ONE O_EXCL markdown
spend report — one row per landed iteration carrying the harness's usage delta (cost, tokens
in/out/reasoning, cache read/write, tool calls, landing sha), then totals over exactly the
measured iterations, then an honesty footer. Exact figures only; no rounding anywhere — the
report is a receipt, not a summary.

499. src/core/spend-ledger.ts — new pure module, no JSX, no theme. `spendLedgerName(nowMs,
     attempt?)` stamps `goal-spend-ledger-<YYYYMMDD-HHMMSS>[-n].md` (a non-finite clock stamps
     the epoch; deterministic). `buildSpendLedger(goal, nowMs)` renders the title (loop vs plain
     record), a self-describing generated-stamp line, the quoted objective (or condition), then
     `## Per-iteration spend (N landed iterations)` — iteration · ended (ISO) · spend (formatCost)
     · in · out · reasoning · cache read · cache write · tools · sha — one row per landed
     `LoopEntry` — then `## Totals` (iterations recorded, turns, tool calls, spend across
     measured iterations with the M-of-N partial qualifier, token and cache sums over the measured
     iterations only), then the `---` honesty footer. The one measurement rule the module and its
     totals share: an iteration counts as measured only when its full usage snapshot is present
     and every field is finite and >= 0 — a partial or corrupt snapshot degrades the whole
     iteration to unmeasured rather than fabricating the missing cells. Exact figures only —
     formatTokens stays out of it. `exportSpendLedger(goal, nowMs, dir)` writes O_EXCL with
     `MAX_EXPORT_ATTEMPTS` collision retries, never overwrites, and throws with the
     filesystem's own message — the target is always the existing caller-named directory.
     `spendSummaryLine` is the toast's chrome-free one-liner (no landed iterations / nothing
     measured (0 of N) / M of N partial / complete).
500. src/tui.tsx — `spendLedgerAction` + palette command `goal.dossier.spend`
     ("Goal: export the spend ledger (markdown report)"). Writes into `process.cwd()`; toasts
     `spend ledger written` (success) / `spend ledger written (partial)` / `nothing to report`
     (warning for the partial, no-measurements and zero-iteration arms — information is not an
     error); write failures toast error with the filesystem's own message. Enabled when a goal
     is live, like the sealed twin. No footer chord, no dialog row, the palette is the surface.
501. Tests: +17 unit (spend-ledger.test.ts: `spendLedgerName` stem/suffix/epoch and its
     independence from the dossier/review/sealed stems; exact-figure rows with the ISO stamp;
     totals summing measured iterations with the M-of-N partial qualifier and the "not inventing
     numbers" line; an unmeasured row renders dashes and never $0.00; a non-finite field degrades
     its whole iteration to unmeasured; an empty record and a non-loop record render honest
     sentences, no fabricated figures or tables; nothing-measured never claims $0.00; the session
     id never appears; free text rides the quote helper and cannot forge structure; a zero-cost
     measurement still counts and renders $0; byte-for-byte determinism; `exportSpendLedger`
     writes one new file (path/bytes/attempts), the written bytes match a fresh build of the same
     clock, a pre-existing stem survives and suffixes `-2`, a missing directory throws; every
     `spendSummaryLine` arm) + re-pinned pack count 58. Tests: 1287 pass, 0 fail (51 files).
502. Honest limits: the figures are the record's own usage deltas as attributed by the harness
     (arm → advance); cost is the host's reported usage, not a re-price; nothing was estimated,
     sampled, probed, or re-verified — generating the ledger re-checks nothing; an unmeasured
     iteration renders — and its figures are excluded from every total, never summed as 0;
     partial measurement is reported as partial; absence never reads as $0.00 (a true zero-cost
     measurement does, and renders $0); the record's free text is quoted and the session id is
     omitted; headless test-renderer layer, live TUI unverifiable.

## Workstream EK — the inventory, one file: what the dossier family left behind (2026-11-16)

Interpretation of the mouse-first clause: the dossier family can now export five artifacts into
the host's cwd (dossier, review, sealed, spend ledger — and its own indices), but no artifact
answers which of those files are actually there, what kind they are, or whether the bytes that
left the process are the bytes that were read. This iteration writes the inventory:
`goal.dossier.index` (palette only: no chord, no footer furniture) scans the host's cwd for the
family's exported artifacts and writes ONE O_EXCL markdown index — file name, kind, bytes
(UTF-8), sha256 — then totals, then an honesty footer.

503. src/core/dossier-index.ts — new pure builder, no JSX, no theme (the I/O lives at the
     edges: readdirSync/readFileSync for the scan, one O_EXCL writeFileSync for the output).
     `dossierIndexName(nowMs, attempt?)` stamps `goal-dossier-index-<YYYYMMDD-HHMMSS>[-n].md`
     (a non-finite clock stamps the epoch; deterministic). `dossierArtifactKind(name)`
     classifies exactly five families — `goal-dossier-<stamp>[-n].md` → dossier,
     `goal-dossier-review-<stamp>[-n].md` → review, `goal-dossier-sealed-<stamp>[-n].md` →
     sealed, `goal-spend-ledger-<stamp>[-n].md` → spend ledger,
     `goal-dossier-index-<stamp>[-n].md` → index — anchored, case-sensitive, requiring the
     exporters' own stamp shape with 1-based `-n` suffixes, `.md` only; anything else returns
     undefined. `scanDossierArtifacts(dir)` reads only regular files directly in the named
     directory (no recursion, no directories), measures the bytes it read, hashes them with
     sha256, counts matching files that cannot be read in `skipped` (counted, never listed,
     never guessed), and sorts by name for a deterministic document.
     `buildDossierIndex(entries, nowMs, skipped?)` renders the title, a self-describing
     generated-stamp line (the directory path is omitted on purpose), `## Artifacts (N files,
     M bytes)` with one row per artifact — file (inline-code fenced) · kind · bytes · sha256 —
     the skipped-count note when present, then the `---` honesty footer.
     `exportDossierIndex(nowMs, dir)` writes O_EXCL with `MAX_EXPORT_ATTEMPTS` collision
     retries, never overwrites, never lists the index being written (the scan happens before
     the write; a previous index IS listed as kind index), and throws with the filesystem's
     own message — the target is always the existing caller-named directory.
     `dossierIndexSummaryLine` is the toast's chrome-free one-liner (no artifacts / complete /
     with unreadable count).
504. src/tui.tsx — `dossierIndexAction` + palette command `goal.dossier.index`
     ("Goal: index the exported dossier artifacts (markdown)"). Writes into `process.cwd()`;
     toasts `dossier index written` (success) / `dossier index written with gaps` / no
     artifacts found (warning for the gaps and zero-artifact arms — information is not an
     error); write failures toast error with the filesystem's own message. The index reads
     files, not the record, so it is enabled always (like the attest door), needs no goal, and
     no live session. No footer chord, no dialog row, the palette is the surface.
505. Tests: +20 unit (dossier-index.test.ts: `dossierIndexName` stem/suffix/epoch; the kind
     classifier across all five families with and without suffixes, and its rejection of the
     near-misses — short stamps, zero or leading-zero suffixes, wrong case, wrong extension,
     foreign stems; the builder's exact rows, sorted-by-name order, the None sentence for an
     empty scan, the skipped-count note and its non-negative-integer guard, byte-for-byte
     determinism, the inventory-not-verification footer, the absence of any directory path;
     `scanDossierArtifacts` over a real temp dir — regular files read and hashed (bytes and
     digests asserted against hard-coded sha256 fixtures), non-artifacts ignored, an
     artifact-shaped directory ignored, an empty directory scans clean;
     `exportDossierIndex` writes one new file (path/bytes/attempts/artifacts/artifactBytes),
     rows match the on-disk artifacts, a pre-existing stem survives and suffixes `-2`, a
     previous index is listed as kind index while the index being written never is, the
     written file is itself classified as an artifact, a missing directory throws; every
     `dossierIndexSummaryLine` arm) + re-pinned pack count 59. Tests: 1307 pass, 0 fail (52 files).
506. Honest limits: the index inventories, it does not verify — sha256 rows are digests of the
     bytes read at generation time and say nothing about the present; unreadable matches are
     counted in `skipped` and named in the document, never listed with guessed bytes or a
     zeroed digest; the directory path is omitted from the document on purpose; the scan is
     one level deep, never recursive; files that are not artifacts are ignored silently on
     purpose (the classifier is the boundary, not a heuristic); the exporter never lists the
     index it is writing; headless test-renderer layer, live TUI unverifiable.

The `Last updated` stamp and the changelog rows are pipeline-owned (`docs-watch`); run
`bun scripts/docs-watch.ts once` after commit and commit its output. spec-check files=57 tests=1270.
<!-- spec-check files=68 tests=1893 -->

## Workstream EL — the jump row stops lying once the goal ends (2026-11-16)

Interpretation of the mouse-first clause: the ambient pill on the jump row paints from the TUI's
entries cache and nothing else. The cache refreshes on mount and on `changed` events, never on its
own; one dropped event (bus gap, missed subscription, a terminal payload the client could not parse)
and the row shows `goal checking · Nm` — extrapolation of a pre-terminal snapshot, growing forever —
long after the goal achieved and the acknowledgment window closed. The 2026-11-16 17:24 screenshot is
exactly that: the transcript says `Goal achieved (turn 1, 7m 21s).` while the pill still reads
`goal checking · 56m`.
507. src/core/hud.ts — `STALE_LIVE_ENTRY_MS` (30s) and the pure `staleLiveSessionIDs(entries, nowMs,
     minAgeMs?)`: sessions whose cached snapshot still reads live (active or paused) and has not been
     refreshed for the floor. `receivedAt` absent counts as infinitely stale (never proven fresh,
     always worth one re-pull); fresh live snapshots cost nothing. Pure, unit-tested headlessly.
508. src/tui.tsx — the existing fifteen-second tick re-pulls those sessions through the normal
     `refresh`/`changed` intake (`void refresh(sessionID).catch(() => {})`). A server-side terminal
     (or cleared, null) response flows through the same intake that already arms the acknowledgment
     pill — `put` sees the live→terminal transition, `noteTerminal` keeps the 45s acknowledgment, then
     the pill converges. No new socket, no new state; the stale chrome can no longer outlive one tick
     plus one RPC.
509. Tests: +6 unit (staleLiveSessionIDs — stale active re-pulled, fresh left alone, paused included,
     terminal/null excluded, missing receivedAt infinitely stale, floor configurable). The pre-terminal
     extrapolation (`elapsedOf`) is unchanged — it stays correct for fresh caches; the guard bounds how
     long the cache may stay unproven. Tests: 1314 pass, 0 fail (52 files). Marker re-counted 59/1314.
510. Honest limits: convergence within one tick plus one round-trip is not instantaneous; a server
     that is reachable but answers with a still-live snapshot honestly keeps the pill (it IS live);
     a server that never answers keeps the last cache — no chrome is invented, none is hidden either;
     the fix rides the 15s tick, so a paused goal re-pulls at the same cadence as an active one.

<!-- spec-check files=68 tests=1893 -->

## Workstream EM — the outcome line stays on the terminal, stops riding the context (2026-11-16)

Interpretation of the mouse-first clause: the session keeps every `<goal-note>` the loop emits —
the transcript renders each outcome line and the durable log stays auditable — but OpenCode folds
durable session input into the model's context on every later turn. The `<goal-note final>` line the
loop emits when the goal lands (achieved, impossible, loop complete) asks for nothing of the model,
yet it rode the context and earned a ceremonial acknowledgement each turn (observed: a full agent
turn answering "Goal achieved (turn 1, 7m 21s)."). The loop-arm note stays plain `<goal-note>`: the
armed iteration still needs it. The record stays in the log and on the terminal; it stops being an
instruction.
511. src/core/prompts.ts — `TERMINAL_NOTE_TAG` (`<goal-note final>`); `note()` gains `final?: boolean`
     and emits the tagged wrapper when set. `isTerminalGoalNoteMessage(message)` matches the tag in any
     text content part (structural, host-shape-tolerant; unknown shapes never match). `stripTerminalGoalNotes(messages)`
     returns a fresh array without the terminal notes — never mutates its input; callers that must signal
     removals through the host's array splice the result back.
512. src/runtime/controller.ts — `note()` gains `opts.final`; the three end-of-record call sites
     (achieved, impossible, loop complete) pass `{ final: true }`; the loop-arm note does not.
     `<goal-note final>` is the only behavioral change; plain notes are byte-identical to before.
513. src/index.ts — the `context` hook splices terminal notes out of `event.messages` in place (the
     host holds the caller's array reference, so a rebound property could go unseen). System-part
     handling is unchanged; records are untouched; the `/goal` dialog, pill and dossier read the log
     as before.
514. Tests: +8 unit (notes.test.ts — wrapper grammar, predicate over text/non-text/malformed parts,
     strip order and purity) + +2 plugin (the context hook removes a terminal note and keeps a plain
     loop-arm note; note-free lists pass through untouched) + 1 controller assertion (the achieved note
     carries the terminal tag). Tests: marker re-counted by spec-check --write after the suite lands.
515. Honest limits: the host folds session input into context at its own discretion — this removes the
     note from the bound request it observes, not from the durable log (it is not deletable by API);
     a model that needs the verdict finds it on disk in the goal record and the dossier; non-tagged
     goal notes still ride the context by design (they carry live instructions).
<!-- spec-check files=68 tests=1893 -->

## Workstream EM2 — the crash report closes: the card speaks the v2 composer's grammar, and the dialog can no longer take the session down (2026-11-17)

Interpretation of the mouse-first clause: the HUD card was a floating, bordered popup —
a chrome shape the opencode v2 composer itself never paints. Meanwhile the live session
reported `opencode-goal.tui crashed in dialog: undefined is not an object (evaluating 'e.length')`.
The report could not be reproduced: both real persisted goal records render every tab of the real
dialog body headlessly without throwing. The honest responses are a reframed card (the composer's
own grammar, full width, the state accent as the one bar), two ErrorBoundary placements so a render
frame exception degrades the chrome instead of killing the session, and a regression test that
inlines the two records so the outcome is pinned byte-for-byte rather than asserted from memory.
516. src/hud-card.tsx — the card is reframed in the opencode v2 composer's grammar: a 1-cell left
     bar in the state accent (`border={["left"]}`, single line), no top/bottom/right frame, the
     raised dark surface underneath, and the title as an in-card bold row (state glyph + loop
     position), paddingLeft/Right 2 replacing the popup's 1. `cardRowPlan`'s base drops 5 → 4
     (title row + condition + now + actions; the two border rows are gone) with an unchanged drop
     order otherwise — teaching hint, spend, context meter, why, last verdict, remediation.
     The doc comment's layout sketch is updated to the new grammar.
517. src/tui.tsx — the mount renders the card at full terminal width (`right={0}` on the absolute
     box plus `width={dimensions().width}` on the card), and the anchor measures the same width the
     card paints with (the `hudCardRows` call no longer clamps to `cardWidth`, which drifted the
     remediation's wrap estimate from the painted rows); `cardWidth` is no longer imported here.
     Two ErrorBoundary placements: (a) the /goal detail dialog body — a render-frame exception
     lands as an in-dialog fallback (`goal detail failed to render`, the error text capped at 600
     cells, `esc to close · your session is unaffected`) instead of the host's
     "plugin crashed in dialog" banner; the session stays alive and esc stays reachable. (b) The
     `session.composer.top` HUD fragment (pill + card mount) is wrapped with a `<box />` fallback —
     a card-side render exception unmounts the HUD, never the prompt. Both boundaries contain;
     neither diagnoses.
518. src/hud-card.tsx — the card's own `cardRowPlan` call inside `HudCard` now passes the resolved
     live `width()` (it previously took the 64-cell default), so the painted rows equal the anchored
     rows at every width, aligning with the doc's "rows the mount anchors with == rows painted
     here" contract and the mount fix in 517. (No test-visible change: every headless render
     resolves `width()` to cardWidth(80) = 64, the former default.)
519. test/dialog-crash-records.test.tsx — the two real persisted goal records inlined as fixtures
     (captured from the live sessions on 2026-11-16; inlined 2026-11-17): the Extract opencode
     v2.3.0 session record (fresh `/goal-loop`, iteration 1 of 5, boundary compaction landed, very
     long condition) and the Coordinator stale works record (met, non-loop, one-turn ledger with a
     per-turn spend and landing sha). Each record renders the overview, ledger and dossier tabs
     through the real `StatusDialogBody` without throwing — +6 tests. The scratch repro
     (`test/tmp-repro-dialog-crash.test.tsx`, which read `/tmp/opencode/*.json` at test time) and
     the three fuzz scratch files (`tmp-fuzz-dialog.tsx`, `tmp-fuzz-hud.tsx`, `tmp-fuzz2.tsx`) are
     deleted.
520. Tests: the 26 failing reconciled to the new frame — every `cardRowPlan`/`hudCardRows`
     expectation shifted by the one-row base saving, and every `maxRows` ceiling argument in the
     cap tests shifted down by one so exactly the same drop stages are exercised (hint, then spend,
     then context, then why, then last, then remediation; the irreducible core and the never-dropping
     menu rows unchanged). The 9 HudCard full-frame snapshots were regenerated with `bun test -u`
     and inspected: each shows the left accent bar, the in-card title row, no top/bottom frame, and
     the same row content as before; the dialog/footer snapshots are byte-identical. Suite: 1332
     pass, 0 fail (54 files). Marker re-counted below.
521. Honest limits: the `e.length` crash itself was never root-caused — the ErrorBoundary is the
     mitigation that keeps the session alive when it recurs, and the inlined records pin that both
     real shapes render. A recurrence is a bug to chase with the next live capture, not a solved
     problem. The full-width card paints every terminal row (the composer's own grammar, by design),
     where the 64-cell design used to centre/clamp the panel. The teaching-hint and ceiling
     behavior at exactly `maxRows` is unchanged in kind — only the arithmetic moved one row.
<!-- spec-check files=68 tests=1893 -->

## Workstream EN — the live crash root-caused, and the card paints the mount, not the terminal (2026-11-17)

Interpretation of the armed condition: the v2 composer layout and the dialog's scrollbar are the two host
contracts EM2 leaned on, and a live session proved both wrong in one report. The crash boundary landed; the
width assumption landed with it. This workstream closes the loop: the crash's root cause is identified and
fixed at the seam that feeds it, and the card is pinned to the mount it actually paints into.
522. src/core/scrollbar.ts — the live crash ("opencode-goal.tui crashed in dialog", captured verbatim
     2026-11-17: `TypeError: undefined is not an object (evaluating 'e.length')` out of the host's
     scrollbar-options assignment, `verticalScrollbarOptions → trackOptions → setOption → clone → new R`)
     was root-caused: `scrollbarChrome` handed the host `theme.background` as `trackOptions.backgroundColor`
     — but the host theme's `background` is a nested palette (`background.raised.high`), not a color, so the
     host's option-clone read `.length` off an undefined channel and threw at dialog open. New
     `scrollbarTrackOptions(theme, mono)` reads the nested palette the way hud-card.tsx paints the card
     surface (`background?.raised?.high`) and returns a thumb-only track when the host exposes no raised
     token — never a non-color. `scrollbarChrome` stays for the flat, unit-tested fixture path at this
     point in history — superseded by the review-follow-ups workstream (deleted; the mechanism tests
     rewired to the nested `background.raised.high` fixture).
523. src/tui.tsx — the dialog wiring passes `scrollbarTrackOptions(context.theme as unknown as
     HostScrollbarTheme<ColorInput>, reducedColor)` as the scrollbox's `trackOptions`.
524. src/tui.tsx — the HUD card paints the mount, not the terminal. The opencode v2 sidebar sits beside the
     composer's main column, so `useTerminalDimensions().width` (the full screen, sidebar included) ran the
     card out past the composer: rows flush-clipped mid-sentence past the composer boundary with no ellipsis
     (measured live: composer ends ~94–154 cells from the mount origin depending on terminal width and
     sidebar state, while the card painted the full screen width). The outer absolute box (`left={0}
     right={0}`) now snapshots its own resolved width via a `ref` + `onSizeChange` into a `mountWidth`
     signal; `HudCard`'s `width` prop, `hudCardRows` (the `cardRows()` anchor) and `cardReady()` (the card
     mount, gating the first paint on a known mount width) all consume it. One layout pass after arming, the
     card and its reserved rows agree exactly at every terminal width and sidebar state.
525. test/scrollbar.test.tsx — +3 tests pin the host shape at the seam: the nested-palette theme becomes
     the raised-token track with the muted/base thumb rule; a host with no raised token omits
     `backgroundColor` entirely (never a non-color); and the dialog's real mount shape (overflowing
     `scrollbox` with `scrollbarTrackOptions` over a nested-palette theme) renders through
     `@opentui/solid`'s test renderer without throwing — the fixture path that could never catch this crash,
     because it used a flat RGBA background. Suite: 1337 pass, 0 fail (54 files). Marker re-counted below.
526. src/hud-card.tsx — the doc comment's layout width line reads "the composer mount's width".
527. Honest limits: the fix relies on the host's `onSizeChange` firing for the absolute box's initial layout
     (it does; verified across 100/140/160/200-column tmux sessions with and without the sidebar) — before
     that first resolution the card does not paint rather than overflow at a guessed width. The EM2 card and
     both ErrorBoundaries are unchanged; a recurrence of the dialog crash now fails loudly in-dialog with the
     real stack, not in the host.
<!-- spec-check files=68 tests=1893 -->

## Workstream EO — the mount-width probe mounts before the card (2026-11-17)

Interpretation of the armed condition: EM2's width fix was merged broken — the measuring absolute
box sat INSIDE the `<Show>` gated on the width it itself produces, so the card never mounted and the
live HUD showed nothing (verified in a standalone tmux repro at 100/140/160/200 columns). The premise
of the gate was inverted. This workstream fixes the structure, not the sign.
528. src/tui.tsx — the absolute box is the probe and mounts on `cardFor()` (the toggle), never behind
     the width gate; only `HudCard` inside it waits for `mountWidth() !== undefined`. The probe
     resolves to exactly the mount (`left={0} right={0}` across the slot), snapped at ref time and via
     `onSizeChange` on every layout pass. Verified live in a standalone tmux session: the armed card
     paints inside the composer boundary at 100 and 140 columns with ellipsis truncation (the sidebar
     visible on the right, the card clear of it), and the detail dialog opens without the crash
     fallback.
529. test/tui-hud-width-measure.test.tsx — +2 tests pin the opentui contract the fix relies on: an
     absolute `left={0} right={0}` box resolves to its parent's width and reports it through
     `onSizeChange` after the first layout (not at ref time — ref sees width 0). An opentui upgrade
     that breaks either fails here instead of zeroing the card in the host.
530. Honest limits: the card waits one layout pass after arming before painting (by design — an empty
     probe box paints nothing); the probe resolves width but not height-row alignment beyond the
     `cardRows()` contract; headless coverage pins the mechanism, not the host's slot placement, which
     remains verified in the standalone tmux repro only.
<!-- spec-check files=68 tests=1893 -->

## Workstream EP — post-merge review fixes: one-cell border arithmetic, stale mount width (2026-11-17)

Interpretation of the armed condition: a read-only review of the EM/EP-width workstreams' merged
diffs (b4a286d~1..HEAD, src/ and test/) surfaced low-severity defects in the freshly landed width
grammar. This workstream fixes them; no new behavior is introduced.

531. src/hud-card.tsx — the left-accent redesign paints a 1-cell left border, but `remediationWidth`,
     `spendWidth` and `conditionWidth` still budgeted for the old 2-cell frame. All three now subtract
     the painted furniture exactly: remediation/spend 16 (left border 1, padding 4, LABEL 10, gap 1),
     condition/why 23 (the same plus the 7-cell right hint slot). The remediation wrap estimate no
     longer reserves a row short; the spend anchor cannot clip mid-figure; the condition line no
     longer overruns the hint slot on hover.
532. src/tui.tsx — `mountWidth` is reset to undefined when the card disarms (`createEffect` on
     `cardFor()`); the probe box unmounts with the card, so a composer resize while the HUD is closed
     went unobserved and re-arming painted one layout pass at the stale width. Re-open now waits for a
     fresh measure instead.
533. src/tui.tsx — the pill label budget and the pinned-condition `pinBudget` now read
     `mountWidthOr()` (the measured composer mount, terminal width as the fallback) instead of
     `dimensions().width` — the same full-screen-vs-composer overflow class the card fix closed.
534. src/core/scrollbar.ts — the module doc now names the two entry points and which is production
     (`scrollbarTrackOptions`, the host's nested palette) and which is the flat fixture path
     (`scrollbarChrome`, kept for the mechanism tests — superseded by the review-follow-ups workstream:
     `scrollbarChrome` and its types were deleted and the mechanism tests rewired to the nested-palette
     fixture).
535. test/tui-hud.test.tsx and test/tui-render.test.tsx — two ellipsis-landing expectations re-pinned
     to the corrected budgets (64-cell card: condition/why truncates at 41 cells, 40 x's + …). No tests
     added or removed; the suite count is unchanged.
536. Honest limits: the pill/pin budget change is headless-unverified against a real sidebar host
     (falls back to `dimensions().width` in tests, so the suite is unchanged); review item L2 (the
     mount width intentionally bypasses `CARD_WIDTH_MAX`, the documented full-composer contract from
     workstreams 517/EN) was deliberately not clamped; the nested-raised track paint assertion flagged
     in review was not added at EP time — it landed in the review-follow-ups workstream (bd70ddd): the
     overflow mechanism test asserts the raised token paints the whole track column (8 cells) and that
     no cell paints the flat pre-EN background. Date stamps elsewhere were
     left as authored.
## Workstream EQ — the <opencode-cli> guide tightened (2026-11-17)

Interpretation of the armed condition: the first-turn <opencode-cli> block had grown past its
operative value — full paragraphs where a directive needed lines. The guide now says the same
things in roughly half the cells; the operational invariants the test pins are unchanged.

537. src/core/opencode-cli.ts — `opencodeCliGuide()` rewritten leaner: each numbered step loses its
     explanatory scaffolding (failure-ladder prose folded into step 6, the build/mount step and the
     smoke-test step compressed, the two honest limits folded into step 6 and the Rules line).
     The content contract is unchanged: opencode --version, the ~/Projects/opencode clone caveat,
     never rebuild the installed binary, the context.d.ts SlotMap contract, @opentui/core/testing +
     createTestRenderer + captureCharFrame(), tmux capture-pane -p smoke route, the --standalone /
     XDG_CONFIG_HOME requirement, ~/.config/opencode/opencode.jsonc mount flow, the
     binary / source / test-render / live TUI reporting rule, no stable documented tool, never
     commit to the host repo. `test/opencode-cli.test.ts` passes unchanged.
<!-- spec-check files=68 tests=1893 -->


## Workstream ER — the review follow-ups land: one scrollbar path, the raised token proven painted, stale 2-cell furniture swept (2026-11-16)

Interpretation of the armed condition: a whole-repo consistency sweep after EP — the EP review's
open items (the missing nested-raised track paint assertion, the test-only `scrollbarChrome`
duplication, the near-duplicate width-measure pins, the stale 2-cell furniture and floating-panel
grammar in comments) plus drift found by the sweep itself. All fixes are no new behavior; the one
new test-count delta is the wiring pins in the width-measure suite.

537. src/core/scrollbar.ts — `scrollbarChrome` and its `ScrollbarTheme`/`ScrollbarChrome` types are
     deleted. The module now has exactly one entry point (`scrollbarTrackOptions`) serving one
     decision: the track is the host's nested `background.raised.high` (the same surface the HUD card
     paints) or omitted when the host exposes no raised token; the thumb is `text.muted` in color and
     `text.base` in mono. The module doc names the nested-palette shape as the only shape and the
     raised-token track rule up front. No shipped path used `scrollbarChrome` (production always wired
     `scrollbarTrackOptions`); nothing else imported it.
538. test/scrollbar.test.tsx — the mechanism suite (overflow paint / mono thumb / fit-hides / drag /
     click-page) is rewired from the flat-RGBA `scrollbarChrome` fixture to the production path:
     `scrollbarTrackOptions` over a nested `background.raised.high` fixture — the exact palette shape
     `tui.tsx` feeds the host. The overflow test now asserts the raised token paints on the whole
     track column (8 cells) AND that no cell paints the flat pre-EN background — the raised-token
     paint assertion EP's review flagged as missing. The header comment no longer claims the wiring
     is "the way tui.tsx wires it" while wiring a different path. The flat-arm unit tests became the
     nested-arm equivalents (same three pins, nested fixture). Test count unchanged (11).
539. test/tui-hud-width-measure.test.tsx — the two near-duplicate tests pinning the same opentui
     contract are consolidated into one stronger pin (ref-time width 0; onSizeChange reports the
     parent's resolved width after the first layout; the capture shows the child paints), and a new
     source-contract describe adds three wiring assertions against `src/tui.tsx`: the probe assigns
     `el.onSizeChange` and re-snaps `mountWidth` on every layout pass; the disarm `createEffect`
     resets `mountWidth` to undefined; the `<Show>` width gate sits inside the probe box and the
     anchor (`hudCardRows(g, contextOpen(), maxCardRows(), mountWidthOr())`) and the card's
     `width={mountWidthOr()}` consume the measured mount width, never the full terminal. Suite:
     2 → 4 tests.
540. Stale 2-cell / floating-panel furniture swept (comments only, no behavior): `src/hud-card.tsx`
     CARD_WIDTH_MIN's doc now reads "left accent border (1) + padding (4) + LABEL (10) leaves a
     37-cell content lane" (was "border (2) + padding (2) ... 38-cell"); the two "Rows the card
     occupies including the border" docs now state the 1-cell left accent consumes a column, not a
     row; "eats the title border" → "eats the title row". `src/tui.tsx`'s pill comment no longer calls
     the card a "bordered floating panel" (it is the composer-grammar card since EM2). `test/core.test.ts`
     pins the clamp-floor spend budget at 36 cells (52 − left border 1 − padding 4 − LABEL 10 − gap 1,
     was the border-2 arithmetic giving 37).
541. Date-stamp sweep (findings; the three named files are consistent with SPEC.md's UTC convention
     for the 2026-11-17 crash/incident work and were left as authored): the real mixed convention is
     `docs/` — `scripts/docs-watch.ts` formats committer dates with `--date=format:` (the commit's
     own offset, not the `TZ=UTC` it sets) and labels the wall-clock as "UTC", so every docs stamp
     and changelog row is local time mislabeled UTC (e.g. `2026-11-16 20:43 UTC` for a commit at
     2026-11-17T02:43Z); the fix is `--date=format-local:` plus regenerating `docs/`, but `docs/` is
     claimed by the stale `github-single-channel` lease (see 542) — left for that lease's owner.
     RELEASE-CHECKLIST.md's "dev @ 3efc3d5 (2026-11-17) ... Since the 2026-11-16 stamp" line mixes
     the two conventions in one line and is stale for the same reason — also under that lease.
     Historical SPEC.md/EP markers and the `469cee8` commit message keep their authored stamps.
542. Coordination finding (not a repo artifact): the `github-single-channel` lease (agent
     orchestrator, `wt/github-single-channel`, paths `README.md,docs,RELEASE-CHECKLIST.md`, claimed
     2026-11-16T00:30Z, status `claimed`) is stale — its worktree does not exist, its branch matches
     nothing in `git branch -a`, no commits reference it, and no PR is open. Its claimed paths
     genuinely overlap the docs/stamp fixes in 541, so those are flagged, not forced; the lease
     cannot be reconciled by rebase or merge (nothing to rebase) and no coordinator subcommand
     releases a claim. Maintainer action needed: release or close the stale lease, then land
     `format-local:` + `bun scripts/docs-watch.ts once` (docs/ regeneration) and the
     RELEASE-CHECKLIST.md evidence re-sync together.
543. github-single-channel overlap with this workstream: none — every file touched here
     (src/core/scrollbar.ts, src/hud-card.tsx, src/tui.tsx, test/scrollbar.test.tsx,
     test/tui-hud-width-measure.test.tsx, test/core.test.ts, SPEC.md) sits outside the lease's
     claimed paths, and the claim passed the overlap check cleanly.
544. Honest limits: the wiring assertions in 539 are source-scan pins — they catch the probe branch,
     the disarm reset and the mount-width consumption being removed or rewired to terminal width,
     but they do not render the host; the render pin (one mechanism test) stays the behavioral
     guard. The pill/pin `mountWidthOr()` budget remains headless-unverified against a real sidebar
     host (EP's limit, unchanged). The docs/ stamp mislabel (541) remains in the committed tree —
     the repository's docs claim "UTC" times that are not UTC until the lease owner lands the fix.
     Date stamps in the three incident-named files keep the UTC convention SPEC.md uses.
     Suite: 1341 pass, 0 fail (55 files). Marker re-counted below and at the Workstream J marker.
<!-- spec-check files=68 tests=1893 -->

## Workstream ES — the SPEC honesty sweep and the unused-export audit (2026-11-17)

Interpretation of the armed condition: two statement-level defects remained after the review
follow-ups landed — SPEC.md still asserted, as current fact, things HEAD contradicts (the EP
honest-limits line said the nested-raised track paint assertion was never added, though bd70ddd
added it; the EN/EP module docs said `scrollbarChrome` stays/kept for the fixture path, though it
was deleted), and source carried 70 exported symbols that nothing outside their declaring module
references. Both are fixed here; no behavior changes.
545. SPEC.md (current-truth claims only — historical workstream records keep their authored
     stamps): the Status overview's "bordered floating panel" is now "a composer-grammar card
     (absolute box, 1-cell left accent border, theme tokens only)" and its "title border and
     remediation row" is now "title row and remediation row" — the card has painted a single
     left accent since EM2, never a floating panel frame. The EP honest-limits line now records
     that the nested-raised track paint assertion landed in the review-follow-ups workstream
     (bd70ddd: raised token on all 8 track cells, negative control against the flat pre-EN
     `#101010`) instead of claiming it was never added. The two EN/EP lines asserting
     `scrollbarChrome` "stays for the flat, unit-tested fixture path" now carry the superseded
     pointer (deleted; mechanism tests rewired to the nested `background.raised.high` fixture).
     A duplicate workstream label was found and fixed: two sections both claimed "Workstream EQ"
     (the opencode-cli guide entry and the review-follow-ups entry, which landed concurrently
     from a sibling claim); the review-follow-ups section is now Workstream ER. All historical
     dated entries, their counts, and the spec-check markers keep their authored values.
546. src — 70 exported symbols with zero references outside their declaring file were made
     module-local (the `export` keyword dropped; declarations and uses unchanged): the dossier
     family type exports (attest/review/seal/index/export/view/dossier), the record-check
     modules' types and `*_TIMEOUT_MS` constants, the history/hud/format glyph constants
     (`BAR_*`, `PIP_*`, `SPARK_*_ASCII`, `VERDICT_*_ASCII`, `LANDING_SUFFIX_ASCII`,
     `GOAL_GLYPH_ASCII`, `CONTEXT_HOT_RATIO`, `RETRY_HOT_THRESHOLD`), `ContextSpark`,
     `HudTone`/`PillModel`/`CompactMarker`/`ContextMenuId`/`ContextMenuRow`/`Remediation`,
     `DialogStatusCommand`, `FindSegment`, `GoalLoopDirective`, `ScrollbarTrackOptions`,
     `AttestationTotals`, the hud-card exports (`CARD_WIDTH_MIN`, `CARD_WIDTH_MAX`,
     `remediationWidth`, `spendWidth`, `conditionWidth`, `CardRowPlan`, `HudButton`) and the
     spend-ledger results. Entry surfaces (`src/index.ts` default export, `src/rpc.ts` GoalRpc)
     were excluded as by design. Method: name-reference scan across src/ + root *.ts + test/ +
     scripts/ (word-boundary, including `.tsx`), declaration lines only rewritten. No symbol was
     deleted; `bun x tsc --noEmit` clean.
547. Counts: shipped file count unchanged (59) and test count unchanged (1341) — the downgrades
     and edits create and remove no files — so the spec-check marker is re-affirmed, not bumped:
     the Workstream J marker above reads `files=59 tests=1341` as before.
548. Honest limits: the unused-export audit is a name-reference scan, not a type-directed
     analysis — a symbol re-exported under a different name or reached only through a
     string-based plugin boundary would read as unused (none exist in this tree today); and the
     docs/stamp mislabel remains under the stale github-single-channel lease (see Workstream ER,
     item 542) — untouched here. Date stamps in the three incident-named files keep the UTC
     convention SPEC.md uses.
     Suite: 1341 pass, 0 fail (55 files). Marker re-affirmed below and at the Workstream J marker.
<!-- spec-check files=68 tests=1893 -->

## Workstream ET — noUnusedLocals / noUnusedParameters landed (2026-11-17)

Interpretation of the armed condition: `tsconfig.json` now enables `noUnusedLocals` and
`noUnusedParameters` for the whole include set (`*.ts` at the root, `src`, `test`, `scripts`),
and every error the flags produced is fixed in-tree. No behavior changes; no files created or
removed; no tests added or deleted; no `@ts-ignore` anywhere.

549. tsconfig.json — `noUnusedLocals` and `noUnusedParameters` added next to the existing
     strict-family flags. The include set is unchanged.
550. Fixes — 18 flagged sites, each resolved honestly: unused imports deleted
     (`mkdirSync` in scripts/docs-watch.ts; `FailureInfo` in src/runtime/ports.ts; `basename`
     in test/cli-installer.test.ts; `beforeEach` in test/coordinator.test.ts and
     test/coordinator-merge-safety.test.ts; `BackgroundTracker`/`AutoCompactor` in
     test/loop.test.ts); unused module-private consts deleted (`CONDITION_MAX` stale constant
     in src/hud-card.tsx; `silentLog` in test/loop.test.ts; `const now = clock.now()` in
     src/runtime/controller.ts, the enclosing `clock` binding stays in use elsewhere);
     unused parameters underscore-prefixed where the signature is API or call-site stable
     (`_goal` in the exported `attestationAppendix` signature, src/core/dossier-seal.ts;
     `_label` in the `onCopyDossierSection` JSX prop, src/tui.tsx; `_sha` in the `allYes`
     fixture probe, test/dossier-attest.test.ts; `_el` in the scrollbox ref callback,
     test/scrollbar.test.tsx); unused parameters deleted where the signature is module-private
     (`changelogRows(root)` -> `changelogRows()`, two call sites updated,
     scripts/docs-watch.ts); unused locals deleted (`const file =` at the safety-backup test in
     test/cli-installer.test.ts — the first occurrence in that file is still used and keeps its
     binding; `frame` destructured but never read in two tests in test/tui-hud.test.tsx).
     No symbol was deleted that anything references; `bun x tsc --noEmit` is clean with the
     flags on.
551. Counts: shipped file count unchanged (59) and test count unchanged (1341) — no files were
     created or removed and no tests were added or deleted — so the spec-check marker is
     re-affirmed, not bumped: the Workstream J marker above reads `files=59 tests=1341`.
552. Honest limits: the flags cover only what tsc can see — dynamically dispatched references,
     string-keyed plugin boundaries, and JSX-factory magic are outside its reach; and the
     underscore-prefixed parameters above remain in their signatures (unused but API-stable)
     rather than being removed, which the condition explicitly permits. The docs/stamp
     mislabel remains under the stale github-single-channel lease — untouched here.
     Suite: 1341 pass, 0 fail (55 files). Marker re-affirmed below.
<!-- spec-check files=68 tests=1893 -->
## Workstream EU — the stale guard can no longer be defeated at its own refresh boundary (2026-11-16)

Interpretation of the armed condition: the EL workstream (2026-11-16, c326baf) added the 30s stale-live
re-pull so a dropped `changed` event cannot strand the jump row on `goal checking · Nm`. The 2026-11-16
23:35 live session showed the strand again, one minute after the merge: the transcript carried the terminal
note `◎ Goal achieved (turn 1, 30s).` while the pill below it kept painting `◎ goal checking · 1m` and
counting. Root cause, with evidence:

1. The TUI that painted the screenshot started at ~23:30:54 (the top bar read `4m 41s` at capture,
   23:35:35); the EL fix was committed at 23:31:21 and merged to dev at 23:34:18, and TUI plugins load
   `dist/tui.js` at process start — this process ran the PRE-GUARD code, where the fifteen-second tick only
   advanced the minute hand (`setNow`) for active goals and never re-pulled anything. The pill extrapolated
   `elapsedMs` off the cached snapshot emitted at evaluator start (`status: "active"`, `evaluating: true` —
   the source of the word "checking") forever.
2. The EL guard's convergence depends on `void refresh(sessionID).catch(() => {})` being the real boundary —
   but pre-fix `refresh` was an arrow whose body evaluated `rpc.get({ sessionID }, at(sessionID))` at CALL
   time. `at()` performs the one unguarded host lookup on the path (`context.data.session.get(sessionID)`);
   a synchronous host throw escaped `refresh` before `.catch` was ever reached, broke the tick's re-pull
   `for`-loop at the first affected session, and re-stranded the pill — invisibly, every tick. On EL code
   this was a latent strand class exactly where the screenshot showed one.
3. The achievement note (`note()` → `session.synthetic`) is a different stream than `changed`
   (`snapshot()` on the record); the note's presence in the transcript proves nothing about the entries
   cache — the cache is only written by `put`, which is fed by `changed` events and `refresh`.

617. src/core/repull.ts (new) — `makeGoalRefresh(deps)`: the re-pull, extracted pure. The returned function
     is async by construction and never throws synchronously; an RPC rejection, an unparseable payload
     (resolves false, entry kept, next tick retries), a host-lookup throw and a `put` failure all surface
     inside the promise. tui.tsx wires `get: (sessionID) => rpc.get(...)` / `put` through it.
618. src/tui.tsx — `at()` is now total: the host session lookup is try-wrapped with a fall-through to the
     plugin's own `context.location` (and to no options at all); every other host call on the refresh path
     was already guarded. `refresh` is `makeGoalRefresh({...})` — the tick keeps its `.catch(() => {})`,
     which is now the real boundary rather than a promise that might never get there.
619. Tests: +13 — test/repull.test.ts (+7: call-time throw never escapes, RPC rejection folds into the
     promise, malformed payload resolves false and never reaches put, terminal re-pull feeds the intake,
     explicit null reaches put, live re-pull passes through, put-side throw surfaces in the promise),
     test/wire.test.ts (+5, the EU-dropped-changed chain: the finish-time terminal payload parses; the
     re-pull converges the cache and disarms the live predicate; the intake live→terminal transition fires;
     a malformed terminal payload is dropped whole and the stale predicate keeps flagging for the next
     tick; a null re-pull drops the entry and empties the predicate), test/tui-hud.test.tsx (+1: the
     screenshot shape — active with `evaluating: true` and ancient `receivedAt` is flagged; its achieved
     replacement is not). The repull regression pin was verified to FAIL before the fix (the pre-fix
     synchronous shape makes `a call-time (synchronous) throw …` red) and PASS after.
620. Counts: `npm pack --dry-run --json` = 60 files (src/core/repull.ts ships; package-integrity test
     re-pinned 59 → 60). `bun test` from inside `test/` (the gate's cwd — test/bunfig.toml preloads the
     @opentui/solid server→client mapping, which is why ET could claim green) reports 1354 pass / 0 fail
     across 56 files — 1341 + 13 new, all green. The 245 failures seen when `bun test` is run from the
     repository root (1096 pass / 245 fail at dev HEAD → 1109 pass / 245 fail with this workstream) are the
     same pre-existing environment artifact: without the test/-scoped preload, solid-js resolves its server
     build and the render tests throw "Orphan text"; they are unrelated to this workstream and were
     explicitly not chased. Marker re-counted 60/1354 (first marker in this file, the one spec-check reads).
621. Honest limits: the fix makes the re-pull boundary total and unit-pins it; it cannot resurrect a
     `changed` event the server failed to emit or the bus dropped (it re-pulls instead — bounded by the 15s
     tick plus one RPC round-trip, exactly as EL documented); a server that answers with a still-live
     snapshot keeps the pill (it IS live); a `put` that throws is surfaced to the tick's catch, not retried
     within the tick; the pre-fix process had to restart for ANY of this to load (plugins load `dist/tui.js`
     at process start) — this session itself still paints from pre-merge code until the TUI restarts.

<!-- spec-check files=68 tests=1893 -->

## Workstream EV — the bugfix sweep: audited findings land, each pinned (2026-11-17)

Interpretation of the armed condition: three read-only reviews (core, runtime, TUI/plugin entry) were fanned over the whole tree and produced nineteen findings; every finding was verified at the seam, fixed in-tree, and pinned with a regression test — no behavior redesign, no file created or deleted, no test weakened or deleted. Three reviewer findings were refuted or narrowed by verification and are recorded as such (below). The audit saw the faults; the fixes keep the posture the tree already had: skip what you cannot verify, never guess, degrade honestly.

622. src/runtime/store.ts — `isRecord` now also requires a string `directory`. One under-validated record (missing or non-string `directory`) used to throw inside `loadLive()` and take the whole bulk restore down with it: no goal for the directory was adopted after a restart. Malformed live records are skipped like the other malformed entries.
623. src/runtime/controller.ts — `adoptRestored` normalizes a missing `history` to `[]`. A legacy/corrupt record without `history` made `evaluate()` throw at the push *after* the bookkeeping mutations but *before* the commit: no retry, no notice, no verdict — a silent permanent wedge, invisible except in the router log.
624. src/runtime/compactor.ts — both `maybeCompact` and `compactAtBoundary` re-check `isBusy()` after the seconds-long `context()` read and before requesting the host compaction (the boundary path reports reason `busy`). The documented invariant — never compact mid-work — was broken by construction between the first gate and the fire.
625. src/runtime/controller.ts — write-after-delete closed: `onCompactionLanded` bails when the goals map changed while the commit was in flight (`this.goals.get(sessionID) !== record`), and `reanchor` no-ops on a non-adopted record. A `session.deleted` landing between the landing commit and the re-anchor used to re-create the deleted session's record in storage (possibly `active`) for the next `restore()` to adopt.
626. src/runtime/controller.ts — `dispose()` tracks final-usage snapshots in `pendingUsage` and awaits them (`Promise.allSettled`) before `store.flush()`, so the final spend snapshot's write is durable at shutdown instead of being dropped on the floor after flush returned.
627. src/runtime/background.ts — `shellUpdated` with no status anywhere (`""`, a metadata-only update) now keeps tracking the shell instead of deleting it — the same defensive posture the owner branch already had. `shell.exited`/`shell.deleted` still end shells unconditionally.
628. src/index.ts — `createVerifier` drains stdout and stderr concurrently (Bun's own spawn guidance: an unread pipe fills the OS buffer and blocks the child) and decodes chunks through one streaming `TextDecoder` so a multi-byte sequence split across chunks is not corrupted. Honest measurement: on this host Bun eagerly buffers pipes — a live probe with 200 KB and 8 MB of stderr completed under both orderings, so the wedge is NOT reproduced here; the fix removes the ordering dependency rather than a demonstrated local hang.
629. src/index.ts — `sleep()` resolves immediately on an already-aborted signal and removes the `lifetime` abort listener when the timer wins the race (it was only removed when the abort won). Repeated event-stream reconnects no longer accumulate once-listeners on the plugin's long-lived signal.
630. src/tui.tsx — `ensure()` releases the `requested` marker when `makeGoalRefresh` *resolves* false (malformed payload) as well as on rejection; a single unparseable `get` used to blank that session's pill until reload, and the stale guard could not see it (the session never entered the entries cache).
631. src/tui.tsx + src/status-dialog.tsx — the completion-moment `attention.notify` call chains `.catch(() => {})` (it was the one `void` async call without one; a host-side rejection could surface at the exact moment a goal lands), and the dialog's condition row acknowledges `✓ copied` only when `onCopyCondition` is wired — the one copy row that acknowledged unconditionally.
632. src/core/history.ts — `iterationVerdictMix` requires every `endedAt` to be finite before taking the monotone sweep; a non-finite `endedAt` (NaN is not `undefined`, so the old guard missed it) fell past the window and painted the verdict into the next iteration. The fallback filter read is now used whenever a window edge is unusable, as the doc promised.
633. src/core/history.ts — `currentIterationVerdict` falls back to `setAt` as the window edge when the last entry's `endedAt` is non-finite instead of hiding the live verdict behind `at > NaN === false`.
634. src/core/dossier.ts — new `stampOf(ms)`: ISO-8601 for generated-stamp lines; a non-finite or finite-but-unrepresentable clock stamps the epoch instead of throwing `RangeError` (`new Date(1e20).toISOString()` does). The six `new Date(Number.isFinite(nowMs) ? nowMs : 0).toISOString()` sites (dossier-review, dossier-seal, reach-record, sign-record, dossier-attest, verify-record) route through it. `isoOf` keeps rendering the em-dash Gap.
635. src/core/git.ts — `headSha` resolves an attached HEAD through `packed-refs` on SHA-256 repositories: the packed-refs scan accepted only 40-hex shas while the loose-ref and detached-HEAD scans already accepted 64-hex, so shas vanished for packed SHA-256 branches.
636. src/core/transcript.ts — `headTail` clamps the budget to at least 1 cell. `headTail(text, 0)` returned the ENTIRE text prefixed by a `chars cut` marker (`slice(-0) === slice(0)`), i.e. a zero budget smuggled back the whole tool output.
637. src/core/format.ts — `formatDuration(NaN)` renders `"0s"`. Every sibling duration formatter clamps non-finite input; this one painted `NaNs` into any surface fed a corrupt timestamp.
638. src/core/parse.ts — the condition length limit counts code points (`[...condition].length`), not UTF-16 code units: 4,000 astral characters were rejected as "8000 characters". The reported count and the limit now agree.
639. src/core/config.ts — an empty or whitespace-only `OPENCODE_GOAL_MODEL` (or `evaluator.model`/`model: ""`) reads as unset and falls back down the chain, the same posture `str`/`int` already take — a stray empty env var no longer silently downgrades the evaluator from independent to session mode. A non-empty invalid value still yields no model (unchanged).
640. src/core/dossier-attest.ts — `attestSealedDossier` deduplicates appendix rows by sha (first spelling kept) before counting and reporting: a hand-assembled or tampered file repeating a sha no longer double-counts it in `unique`, `sealedClean`, `held`, `regressed`, `unknown` and `wasNotClean`. The exporters never produce such a file; the parser is the boundary, so the count is honest at the boundary.
641. Refutation by verification, not by argument: the reviewer's "chatty stderr wedges the verification gate for 10 minutes" was NOT reproducible on this host — Bun's spawn pipes buffer eagerly and the pre-fix ordering completes against 8 MB of unread stderr — the fix lands as a hardening of the already-shipped concurrent-drain guidance, not as a demonstrated local deadlock. The reviewer's `attestation`/`unique` reading (rows counted per mention) was correct and is fixed per the interface's own "unique shas" contract; the reviewer's `headTail` mis-read of `slice(-0)` was correct and is confirmed by the pinned test.
642. Docs untouched — `docs/`, `README.md` and `RELEASE-CHECKLIST.md` remain under the stale `github-single-channel` lease. The two source hunks the docs line references point into (`src/core/transcript.ts:91`, `src/core/config.ts:162`) are net-zero line edits, so `docs/core.html` and `docs/config.html` stay accurate; the docs-line-refs suite passes unchanged.
643. Counts: no file created or removed (60 shipped files unchanged); 19 regression tests added across twelve suites (store, history, compactor, git, goal-limits, controller, loop, core, dossier, dossier.test, dossier-attest, controller/event-router); suite 1354 → 1373 pass, 0 fail (56 files). `bun x tsc --noEmit` clean. Marker re-counted below and at the first marker.
644. Honest limits: three reviewers worked read-only (no shell); every finding was re-derived at the seam before editing, but none of the fixes is exercised against a live OpenCode host or a real SHA-256 repository — the SHA-256 case is pinned by a synthetic `packed-refs` fixture, the restore/compaction races by unit-level interleaving, the malformed-record cases by hand-assembled storage entries. The verifier concurrent-drain fix is verified against Bun's documented contract and a live probe of both orderings, not against a host that backpressures pipes. The status-less `shell.updated` handling is defensive only — no evidence the host emits one. The `copied` acknowledgment fix and the `ensure()` marker release are headless-unverifiable against a real TUI. The final-spend-at-shutdown fix is pinned with a parked-usage interleaving; a host that resolves usage synchronously at shutdown never needed it.

## Workstream EG — the executable surfaces audited: scripts and the coordinator (2026-11-17)

Interpretation of the armed condition: the two executable surfaces iteration 1 never swept were fanned to two read-only reviews (one per surface); every finding was re-derived at the seam before editing, fixed in-tree, and pinned with a regression test — no redesign, no file deleted, no test weakened or deleted. One reviewer item was deliberately NOT fixed (recorded below, refutation by design).

645. scripts/e2e.ts — the harness refuses to overwrite a `.opencode/opencode.json` it did not write: a differing pre-existing file stops the run with a clear message instead of silently replacing the target project's plugin configuration (a rerun with the identical payload is unaffected). A model argument without `provider/model` shape (and a trailing-slash value) is rejected before any file is written or any server is spawned; both stopped with an opaque server-side error before.
646. scripts/docs-watch.ts — `stampFor` no longer throws on a zero-commit repository: `once` completes (stamps degrade to the `unknown` sentinel, state file is written) and `check` no longer dies with an uncaught exception; previously the crash landed after the log append but before the changelog rewrite and state write, so every rerun re-logged a duplicate "baseline".
647. scripts/docs-watch.ts — `sliceChangelogRows` normalizes CRLF to LF inside the rows block, so the changelog freshness gate cannot fail permanently on an autocrlf checkout (the repo pins `eol=lf`; the normalization is defensive for forks that do not).
648. scripts/docs-watch.ts — `main` resolves the repo root inside a try/catch and exits 2 with a clear message outside a git repo (was: an uncaught execFileSync stack); `watch` now re-derives its directory watch set on every debounced trigger (directories created after startup were invisible) and shallow-watches `.git` and `.git/refs/heads` in addition to `.git/index`, so the index swap-via-rename can no longer orphan the index watch handle. Nested ref writes (packed-refs) remain out of scope — documented.
649. scripts/spec-check.ts — the pass-count probe is anchored to the reporter's summary line (`(?:^|\n)\s*(\d+) pass\b`, last match wins) wrapped in the exported pure `parseBunTestPassCount`; a stray `N passed`-like token earlier in the stream can no longer win. A `bun` that fails to spawn is now reported as `bun test failed to launch: <message>` (new `ProbeResult.bunLaunchError`) instead of the false `BUN_RED_ERROR` ("a test failed"); the `--write` heal path mirrors it.
650. scripts/render-history.tsx — argv is partitioned into flags vs positionals before parsing; positionals must be positive finite numbers (usage error, exit 2) — `--empty`/`--mono` used to parse as `NaN` width/height. scripts/render-dialog.tsx — `--width=`/`--height=` are validated before use (non-finite or <= 0 → exit 2); both frames previously painted at a silent NaN/zero size.
651. packages/coordinator/bin/coordinator — `restore_state_stash` no longer `rm -f`s the only backup of the stashed live state.json when `cp` fails: the stash is kept, the path is printed, and the cp is serialized on the same short-lived flock mutex as every other state writer.
652. packages/coordinator/bin/coordinator — every read-modify-write of `state.json` (`state_jq`, the merge-finish union, `release_merge_lock`'s mergeLock clear, the stale-merge-lock clear) is serialized on one blocking flock mutex (`.state-lock-file`). The claim/submit/merge-finish lost-update race — a union cp landing between a concurrent writer's read and write and durable-reverting a submitted/done lease record — is closed. On hosts without flock there is no exclusion (same posture as the mkdir locks).
653. packages/coordinator/bin/coordinator — the SPEC re-count commit and the docs-refresh commit in the merge pipeline now fail the merge (`fail`) when the commit itself fails, instead of printing success while the uncommitted re-count never reaches dev (the gate reads the worktree, not the commit) — latent silent-dev-red gate.
654. packages/coordinator/bin/coordinator — scope parsing accepts comma- and/or whitespace-separated paths in `path_in_scopes` and `check_overlap`, and `claim` canonicalizes `--paths` to comma-joined at the source (30 historical leases are recorded space-separated; they silently failed every in-scope check — fail-open for overlap detection, fail-closed-and-noisy for submit). Paths in this repo never contain spaces.
655. packages/coordinator/bin/coordinator — stale-lock reclaim (claim and merge) uses an atomic `mv` aside instead of `rmdir || rm -rf`: exactly one contender renames the stale dir away; the others fail and exit. The old sequence could `rm -rf` the directory a second contender had just created for itself (two concurrent merges). The merge stale reclaim also clears `mergeLock` in state (doctor check 6 unwedges itself).
656. packages/coordinator/bin/coordinator — the merge flow installs `TERM`/`INT`/`HUP` traps that release the merge lock (previously only `EXIT`); an untrapped signal no longer leaks `.merge-lock` and a permanent `mergeLock` object.
657. packages/coordinator/bin/coordinator — scratch-branch auto-prune only deletes scratches fully contained in `dev`: an interrupted merge's verified scratch (the advertised `git merge --ff-only <scratch>` recovery artifact) is no longer reaped 60 minutes later.
658. packages/coordinator/bin/coordinator — `submit`'s base computation takes `head -n1` (a multi-root repository without `dev` used to produce a multi-line `base`, silently disabling the out-of-scope check — vacuous pass).
659. packages/coordinator/bin/coordinator — `ensure_state` no longer renames a possibly-empty tmp onto `state.json` when the printf fails; the tmp is removed and the command fails instead.
660. packages/coordinator/bin/coordinator — `finish_merged_lease`'s union jq keeps all live top-level keys (`$head[0] * $live[0]`), still field-unions leases with the live copy winning, still pins `mergeLock: null`, and is wrapped in the state mutex. The bookkeeping commit only lands when the main checkout is on `dev`; otherwise it stays exempt dirt with a warning instead of a `chore(coordinator):` commit on whatever branch happened to be checked out.
661. packages/coordinator/bin/coordinator — `merge-done` accepts any left-behind scratch that is an ancestor of `dev` (not just the alphabetically oldest), so a hand-completed `--review` flow never strands a lease as `submitted` while dev contains the result.
662. packages/coordinator/bin/coordinator — minor: preflight touch count no longer prints `00` on an empty diff; `local_docs_out` is declared `local` and its rc captured before testing (the `$?`-after-`local` latent always-pass).
663. Refutation by design, not by argument: `fail()` still deletes the scratch branch on a failed gate. The scratch there is fully regenerable (it is `dev` plus the branch merge; the ff-blocked path exits outside `fail()` and keeps its scratch), and the pinning test enforces no-scratch-survives. The reviewer's own assessment agreed; the fix would have bought nothing and would have made failed merges litter every repo with stale scratch branches.
664. Docs untouched — `docs/`, `README.md` and `RELEASE-CHECKLIST.md` remain under the stale `github-single-channel` lease. No doc-cited source line is inside an edited hunk of `src/` (this sweep touched none), and `docs/changelog.html` picks up the pipeline row from the merge itself (docs-watch runs on the merged tree inside `merge-next`).
665. Counts: no file removed; one shipped surface edited (packages/coordinator/bin/coordinator is shipped); 21 regression tests added (one new suite `test/e2e.test.ts`; coordinator scope/scratch/multi-root pins, docs-watch empty-repo and CRLF pins, render-argv rejection pins, spec-check launch-error and anchored-regex pins); suite 1373 → 1394 pass, 0 fail (57 files). `bun x tsc --noEmit` clean. Marker re-counted below and at the first marker.
666. Honest limits: the coordinator changes are pinned by CLI-level fixture tests (claim/submit/merge-next/merge-done against synthetic repos) plus static review, not by a live merge of this very branch — the merge that lands this workstream runs the pre-merge (dev) copy of the script, and takes effect for the NEXT merge. The state mutex closes the lost-update race by construction, not by a reproduced interleaving. `restore_state_stash`'s cp-failure branch is not exercised (no fault injection on disk). The docs-watch watch-mode changes are unverified against a live inotify session on this kernel. The e2e guard tests stop before any `opencode serve` is spawned; the happy path is untouched. The CRLF normalization is defensive. None of the coordinator edits change the merge invariants: dev moves only via `--ff-only`, the gate still runs on the merged result, and uncommitted bytes are still never destroyed.

<!-- spec-check files=68 tests=1893 -->

## Workstream EX — the root surface audited: installer, CI, packaging (2026-11-17)

Interpretation of the armed condition: iteration 2 swept the two executable surfaces iteration 1 never touched (scripts, the coordinator); the root-level surface remained unswept — the hand-rolled installer CLI, the CI workflow, and the packaging manifest itself. Two read-only reviewers fanned out (one per area); every finding was re-derived at the seam before editing — including runtime probes of the installer against scratch configs (F1/F2/F3/F5/F6 reproduced, then verified fixed) — and pinned with a regression test. No redesign; no test weakened or deleted.

667. bin/opencode-goal.mjs (addPluginText) — comments between the last element and `]` no longer deleted. A new `splitClosingBracketSpan` keeps the interstitial verbatim and re-emits the entry on its own line before it; the separating comma is added only when the head carries no top-level comma (checked after stripping comments, block comments first), so a comment-only interstitial still yields a valid config and a comma-terminated head is not double-comma'd; the `]` line's own newline+indent (LF, CRLF, lone CR) is preserved. The empty-array branch keeps its comments the same way (`entry /* keep */ ]`).
668. bin/opencode-goal.mjs (writeFileAtomic) — operates on the realpath when the file exists: a symlinked config (dotfiles setup) is edited through the link and the link survives (previously `rename(2)` replaced the symlink with a regular file and the dotfiles repo never saw the edit); the replacement inherits the target's mode (a 0600 config stays 0600, previously widened to umask default); a failed rename unlinks the tmp instead of littering; the tmp is cleaned on any write failure. Dead `pathToFileURL` import removed; the duplicate package.json parse (PKG/VERSION) collapsed into one.
669. bin/opencode-goal.mjs (backupFile) — accepts the exact bytes parsed as the edit base (install/uninstall now pass `text`), so the backup is byte-identical to the pre-edit state even if another process edits the file in between; exclusive creation (`COPYFILE_EXCL` / `wx` flag) closes the existsSync→copy TOCTOU that could overwrite a foreign `.bak`. Restore-time safety copies still snapshot the live bytes on purpose (that is what their message says).
670. bin/opencode-goal.mjs (listBackups) — only names matching the exact `backupFile` shape with a range-checked stamp (month 01–12, day 01–31, hour 00–23, minute/second 00–59) are ever restore candidates; `compareBackupsChronologically` sorts non-matching names last instead of first (the full path sorted before every date string). A stray `opencode.json.mine.bak` or a range-invalid `…1999-99-99-…Z.bak` previously won the pre-install restore and silently reinstated foreign bytes; reproduced on disk before the fix, verified against the fix after.
671. bin/opencode-goal.mjs — JSONC literals are validated (number/true/false/null grammar, else `CliError`); duplicate `plugins` keys anywhere in the top-level object throw `CliError` instead of silently first-wins (opencode loads configs last-wins, so the entry install appended was invisible to the host while `status` reported "installed"); `backupPluginFree` returns `null` (unverifiable) for a non-array `plugins` value instead of `true` (never auto-restore off-contract backups, per the header's "never restores a backup containing the plugin").
672. bin/opencode-goal.mjs (removeSpanWithComma) — the trailing-line swallow accepts CRLF, LF and lone CR line endings; a removed entry line no longer leaves a whitespace+CR-only line mid-file.
673. bin/opencode-goal.mjs (resolveScope) — an empty `HOME` falls back to the OS home directory (was: a relative `.config/opencode` under the process CWD) and a non-absolute `XDG_CONFIG_HOME` is ignored per the XDG spec (was: joined against CWD); `scopeDirOf` uses `path.dirname` (backslash-separated Windows paths produced `.`, so a fresh `--global` install on Windows died ENOENT on the missing parent, and the `--restore` path failed the same way).
674. bin/opencode-goal.mjs — `uninstall --restore` names the safety backup it takes of the pre-restore state in its success message (previously taken silently, unlike the missing-entry path).
675. .github/workflows/check.yml — checkout uses `fetch-depth: 0`: `docs:check` derives every page stamp and the 30-row changelog from `git log`, so a depth-1 clone fails the docs gate on every push/PR regardless of the diff (reproduced: `--depth 1` clone → `bun scripts/docs-watch.ts check` exits 1, all seven pages stale, "changelog rows are stale"; with full history the dev checkout passes). `oven-sh/setup-bun` is pinned to `bun-version: 1.4.2` (the dist byte-compare gate was verified with it; a floating bun can break "dist is in sync" spuriously). Both pins asserted in `test/ci-workflow.test.ts` (+2 tests).
676. package.json — `"test"` and `"prepublishOnly"` now run the suite from `test/` (`cd test && bun test`): a root-level `bun test` never loads `test/bunfig.toml` (the `@opentui/solid` preload the render suite needs) and recurses into `worktrees/**/test/*.test.ts` (a live fork of the suite), the two false-failure modes AGENTS.md warns about; `npm publish` aborted on a green tree in `prepublishOnly` for exactly this reason. Pinned in `test/package-integrity.test.ts`.
677. package.json — `string-width` moved from devDependencies to `dependencies`: `src/**` (shipped in the tarball, compiled on the fly by the host) imports it, `peerDependenciesMeta` marks every peer optional so npm fetches none of them, and a production-install consumer got `ERR_MODULE_NOT_FOUND` at plugin load. bun.lock regenerated; `bun install --frozen-lockfile` verified. The tarball stays 60 files (nothing added). Pinned (dependency declared, not in devDependencies).
678. package.json — `exports` declares a `types` condition per entry (`.` → `./index.ts`, `./tui` → `./dist/tui.d.ts`, `./rpc` → `./rpc.ts`): reachable declarations for TS consumers under bundler resolution, previously fully encapsulated by the map.
679. .gitignore — covers `.term/coordinator/.claim-lock/` and `.term/coordinator/.merge-lock/` (mkdir lock dirs left by a hard kill — the artifacts the stale-reclaim flow reaps) and `.term/coordinator/.state-stash.*` (the merge-gate stash); nothing matched them before (untracked-status noise, not a merge blocker). Pinned in `test/package-integrity.test.ts`.
680. test/package-integrity.test.ts — new pins: the coordinator bin carries the exec bit (invoked by direct path; only opencode-goal.mjs was pinned before), every `exports` entry declares both `types` and `default` conditions and targets exist (the old target scan now walks conditions), `dependencies` declares `string-width` and devDependencies do not, `test` runs from `test/`, `.gitignore` covers the coordinator lock artifacts; `dist/tui.d.ts` non-empty (+5 tests).
681. bin/opencode-goal.d.mts — `CliOptions.env` uses an inline record (`{ [key: string]: string | undefined }`) instead of `NodeJS.ProcessEnv`: the declarations ship to consumers with zero dependencies and no @types/node; everything else was already in sync.
682. test/ci-workflow.test.ts — +2 pins (fetch-depth: 0, bun-version: 1.4.2). Step order (install → check → pack), frozen lockfile, the dist byte-compare step, and the no-secrets/no-publish posture are unchanged and still pinned.
683. Verification gap closed locally: the depth-1 failure the workflow would have produced was reproduced against a `--depth 1` clone of this repo, not merely read off the action docs; with full history, `docs freshness check passed` on the dev checkout.
684. Counts: no file removed; `bin/opencode-goal.mjs` (shipped), `bin/opencode-goal.d.mts`, `package.json`, `bun.lock`, `.gitignore`, `.github/workflows/check.yml` edited; 22 regression tests added (15 cli-installer, 2 ci-workflow, 5 package-integrity); suite 1394 → 1416 pass, 0 fail (57 files). `bun x tsc --noEmit` clean. Marker re-counted below and at the first marker.
685. Honest limits: the CI findings are pinned structurally (line assertions on the workflow), not by a GitHub run — nothing was pushed. The Windows separator fix is verified by code reading (`path.dirname`), not on a Windows host; the symlink and mode behavior pins run on Linux. `backupFile`'s exclusive-create and the realpath write are pinned with crafted fixtures, not with concurrent-fault injection. The `string-width`-as-dependency fix is verified by declaration inspection and the regenerated lockfile, not by an npm production-install load test (no registry harness exists here; the GitHub-cache route is unaffected and was already maintainer-verified). The duplicate-`plugins` refusal is fail-loud by design: a config carrying two `plugins` keys used to be edited silently (first-wins) while opencode (last-wins) never saw the entry — such a config now stops with exit 1 and must be merged by hand, which is the correct trade (a visible conflict beats an invisible no-op install). The stale `github-single-channel` lease still blocks `docs/`, `README.md`, `RELEASE-CHECKLIST.md`; this section edits SPEC.md only.

<!-- spec-check files=68 tests=1893 -->

## Workstream EY — scripts/e2e.ts audited: spawn/lifecycle, exit/restore, model resolution (2026-11-17)

Interpretation of the armed condition: every prior workstream swept a directory (`src/**` EV, executable surfaces EG, installer/CI/packaging EX); the root end-to-end harness `scripts/e2e.ts` — the only entry that drives a live `opencode serve` — had never been swept. Every finding was verified by reading and by running the pinned unit tests; the happy path against a real server is unchanged. No redesign; no test weakened or deleted.

686. scripts/e2e-lib.ts (new) — the harness's decision points extracted as pure, import-safe helpers: `resolveModel` (positional arg > E2E_MODEL > built-in default), `parseModelArg` (split at the first slash; provider must be slash-free, non-blank, free of inner whitespace; the id may carry slashes for org/model ids but must be non-blank, whitespace-free, with no leading slash and no empty segment), `buildIntendedConfig` (single source of truth for the exact two-space-indented payload), `decideConfigAction` (`write` / `skip` / `refuse`), `refuseConfigMessage`, `goalExitCode` (`0` only for `achieved`).
687. scripts/e2e.ts (model resolution) — `opencode//` (empty id segment), `model id with spaces`, ` opencode/model` and `a//b`-shaped ids are now rejected up front with the documented `model must be "provider/model"` error instead of reaching the server; `resolveModel` pins the documented positional-over-env precedence (previously implicit in the destructure default).
688. scripts/e2e.ts (exit paths) — the process exit code is frozen from the goal's last status immediately after the wait loop (`goalExitCode`); the post-resolution diagnostics (clearing the `/goal` command, rendering the evaluator's digest, listing the condition's files) now run in a guarded block that prints failures without touching the exit code. Previously any diagnostic throw (e.g. `renderTranscript` on an empty context) landed in the outer `catch` with `exitCode` still at its default 1 — an `achieved` goal reported as a failed run.
689. scripts/e2e.ts (timeout) — the wait loop now distinguishes a deadline from a resolved goal: it stops with an explicit `TIMEOUT after 10 minutes; last known status: …` line. Previously the loop condition simply failed and the run printed `final {…"status":undefined…}` with no timeout indication.
690. scripts/e2e.ts (spawn/lifecycle) — the child now has an `error` listener: a spawn failure (opencode missing from PATH, permission denied) is recorded and the readiness loop fails fast with `failed to spawn opencode: …` instead of blocking 60s and dying with `server did not start`; the readiness timeout message names the `server.log` path; a `server exited <code> <signal>` diagnostic line prints on child exit; win32 keeps the `taskkill /pid /T /F` tree kill.
691. scripts/e2e.ts (signals) — SIGINT and SIGTERM are forwarded: the handler kills the server (win32 tree kill, else SIGTERM), ends the log stream and exits with the conventional 128+signo (130/143). Previously a bare Ctrl-C ran none of the `finally` cleanup and orphaned `opencode serve`.
692. scripts/e2e.ts (temp-dir lifecycle + idempotency) — the target project dir must already exist and be a directory (a missing path used to be `mkdirSync`-created silently, so a typo ran the whole smoke test in the wrong place); an identical `.opencode/opencode.json` is now left byte-for-byte untouched (`skip`) instead of rewritten, so a read-only but up-to-date config no longer fails with EACCES on rerun; a differing config still refuses with the same message and with the pre-existing bytes untouched.
693. scripts/e2e.ts (log stream) — `createWriteStream(server.log)` gets an `error` listener (a broken log destination, e.g. a full disk, previously raised an unhandled stream error); the stream is ended and awaited (bounded at 2s) before `process.exit` so buffered output reaches disk (previously the still-open stream was discarded at exit).
694. test/e2e-lib.test.ts (new, +26 tests) — unit pins for every helper: arg-over-env-over-default precedence; `provider/model` split at the first slash with org/model ids preserved; nine malformed-model rejections all carrying the documented message; the exact two-space-indented intended-config payload; write/skip/refuse decisions; the refuse message naming the path and the empty-directory contract; `goalExitCode` mapping (achieved → 0; failed/active/interrupted/impossible/undefined → 1); plus a spawn-based pin that a missing project directory fails fast and is not created. `test/e2e.test.ts` passes unchanged against the refactored harness.
695. Counts: no file removed; `scripts/e2e.ts` edited, `scripts/e2e-lib.ts` and `test/e2e-lib.test.ts` added (all three unshipped — `scripts/` is not in package.json `files`); suite 1416 → 1442 pass, 0 fail (58 files). `tsc --noEmit` clean. Marker re-counted at the first marker and below.
696. Honest limits: the happy path against a live `opencode serve` is unchanged and not run by the suite (it needs a real server and model; `bun run e2e <empty-dir>` runs it manually). Signal forwarding and the log-flush await are verified by code reading and the suite's structural pins, not by an observed Ctrl-C into a live harness; the `skip` action is pinned at the decision function, not at the filesystem mtime; the spawn-error fail-fast is pinned by the listener's presence and by the pre-spawn guard tests, not by fault injection against a missing `opencode` binary. Docs untouched — the stale `github-single-channel` lease still owns `docs/`, `README.md`, `RELEASE-CHECKLIST.md`.

<!-- spec-check files=68 tests=1893 -->
## Workstream EZ — the four deferred EX nits in bin/opencode-goal.mjs (2026-11-17)

Interpretation of the armed condition: iteration 3 (EX) deferred four reviewer-grade nits in the installer CLI; this workstream fixes exactly those four and pins each with a regression test. No redesign, no test weakened. The fsync pin is structural (source scan) — the honest limit is called out below. Docs untouched (the stale `github-single-channel` lease still owns `docs/`, `README.md`, `RELEASE-CHECKLIST.md`).

697. bin/opencode-goal.mjs (writeFileAtomic, fsync) — the temp file is now opened, written, `fsyncSync`'d and closed BEFORE `renameSync`: previously `writeFileSync` + `renameSync` published the rename before the bytes were durable, so a crash in that window could leave a zero-length or half-written config where a good one used to be. Mode handling unchanged (a 0600 config stays 0600; a symlinked target is edited through the link); on open/write/fsync failure the tmp is unlinked as before.
698. bin/opencode-goal.mjs (status, duplicate config line) — exactly one `config:` line: a missing config previously printed both `config:   <path>` and `config:   (does not exist)`; it now prints `config:   <path> (does not exist)`, and an existing config prints the bare path, still once.
699. bin/opencode-goal.mjs (uninstall, provenance overclaim) — the skeleton-delete message now reports only the observable state — `(only install's skeleton remained)` — instead of `(created by install)`: an empty or skeleton-shaped config can predate install (hand-written, or produced by another tool), and the old wording asserted more than the code can observe. The header safety-rules doc was tightened to match.
700. bin/opencode-goal.mjs (status, spawnSync conflation) — the `opencode --version` probe is no longer collapsed into one message: ENOENT → `opencode: not found on PATH`; timeout → `opencode: --version timed out`; other spawn errors → `opencode: failed to run (<code>)`; killed by a signal → `opencode: --version killed by signal <SIG>`; non-zero exit → `opencode: --version exited with code <N>`; a successful probe prints the trimmed version. New exported helper `probeOpencodeVersion` owns the classification; `bin/opencode-goal.d.mts` gains matching `OpencodeProbeResult` and `probeOpencodeVersion` declarations (the declarations are hand-maintained in sync with the .mjs exports).
701. test/cli-installer.test.ts — +7 regression pins: a source-scan pin that `writeFileAtomic` calls `fsyncSync` before `renameSync`; one-`config:`-line pins for both the missing and the existing config; the skeleton-delete message pin (contains `(only install's skeleton remained)`, never `created by install`); `probeOpencodeVersion` classification pins (ENOENT / ETIMEDOUT / EACCES / exit-3 / signal / success); two spawn-based pins using a scratch `PATH` (a non-zero `opencode` shim reports `exited with code 3` and never `not found on PATH`; an empty PATH reports `not found on PATH`). The pre-existing mode/symlink/status tests pass unchanged. Suite 1442 → 1449 pass, 0 fail (58 files); `tsc --noEmit` clean.
702. Verification: `bun run check` green in this worktree (tsc, full suite, docs freshness, spec-check after the marker bump). Honest limits: the fsync pin is a source scan, not a crash-injection durability test; the shim pins assume `/bin/sh`; signal-forwarding style behavioral risk (spawnSync's own `error` on timeout arrives with `signal` set) is handled by checking `error` before `signal` in the classifier. Marker re-counted at the first marker and below.

<!-- spec-check files=68 tests=1893 -->

## Workstream EW — the .d.mts export-drift pin (2026-11-17)

Interpretation of the armed condition: `bin/opencode-goal.d.mts` is hand-maintained to mirror the exports of `bin/opencode-goal.mjs`; add one regression test that keeps the two from drifting silently. No production-code change; `bun run check` stays green. Docs untouched (the stale `github-single-channel` lease still owns `docs/`, `README.md`, `RELEASE-CHECKLIST.md`).

703. test/cli-installer.test.ts — new regression test "the declarations declare every export of the .mjs and carry no stale value extras". It compares, in exact set equality, the runtime export keys of the dynamically imported `../bin/opencode-goal.mjs` against the value declarations (`export const|let|var|function|class`, optional `declare`, line-anchored) published by `../bin/opencode-goal.d.mts`: every real export must be declared, and every declared value export must exist — nothing missing, nothing stale. A second leg source-scans the .mjs's own line-anchored `export` declarations and requires each to appear as a value declaration in the .d.mts. Negative control performed in this worktree: appending a stale `export function staleHelper(): void;` to the .d.mts fails the new test (61 pass / 1 fail), then the file was restored with `git checkout --`. Interfaces and type aliases in the .d.mts (`ScopeResolution`, `CliOptions`, `CliResult`, `OpencodeProbeResult`, `AddPluginResult`, `RemovePluginResult`) are supporting types for the values and are deliberately out of the comparison.
704. Verification: `bun run check` green in this worktree (tsc, full suite, docs freshness, spec-check after the marker bump). Honest limits: the pin compares value exports only — a wrong signature on an existing declaration (e.g. wrong argument type on `status`) still passes, because nothing type-checks the .mjs source against its declarations and `tsc --noEmit` does not include `bin/`; interface-only staleness (an unused exported interface) is not detected mechanically; the source scan, like the fsync pin, is structural and line-anchored. Marker re-counted at the first marker and below.

<!-- spec-check files=68 tests=1893 -->

## Workstream FF — spend rides the stream: carry-forward on `changed` + a settled-spend event at finish (2026-11-17)

Interpretation of the armed condition ("live stream update if things change in the backend it to be reflect on the terminal tui right away"): one class of backend change was provably invisible to the TUI between `get` pulls — `spend`. The `changed` event snapshot carries no spend (a `usage()` call per event is not affordable on the hot path), so every background event landed in the TUI's `put` intake with `spend: undefined` and the merged entry dropped the cached figure: the card's spend row and the dialog's `spend` row vanished on the next event after any `get` pull, then re-appeared on the following pull — flicker by construction. The context estimate already had the carry-forward treatment (`preserveContextSize`); spend did not. Terminal goals are never re-pulled by the stale-chrome guard (live entries only), so after `finish` even an open dialog kept the pre-final figure forever. No redesign; no test weakened. Docs untouched (the stale `github-single-channel` lease still owns `docs/`, `README.md`, `RELEASE-CHECKLIST.md`).

705. src/core/entries.ts — `preserveContextSize` renamed to `preserveCarriedFields` and generalized: it carries `contextSize` forward with the unchanged pending→landed `loopCompact.landedAt` invalidation, and now also carries `spend` forward whenever the incoming snapshot lacks one. Spend is cumulative-since-baseline and monotone within a goal run, so the carried figure is a lower bound, never a lie; the compaction-landing invalidation does NOT touch spend (a compaction replaces the prompt context, not the ledger). Same-reference hot path preserved when nothing is carried. All call sites and tests renamed mechanically.
706. src/tui.tsx — the `put` intake comment updated; the carry-forward now covers both fields through the same call. No other TUI change.
707. src/runtime/controller.ts — `finish`'s background usage block, after routing the final snapshot through `commit` (unchanged), emits one extra `changed` snapshot carrying the settled spend vs baseline (`diffUsage(usage, record.baseline)`). That event is the only push a terminal goal ever gets — the stale-chrome guard re-pulls live entries only. Costs one emit per goal termination; the hot path is untouched.
708. test/entries.test.ts — +5 spend pins: carry-forward on event intake, event-carries-own-spend wins, no-cache means no-spend, spend survives a compaction landing while the context total is invalidated, null stays null. Suite 1450 → 1456 pass, 0 fail (58 files).
709. test/controller.test.ts — +1 pin: after a met verdict settles the goal, the final `changed` event carries the settled spend vs baseline (`cost` 4 = 5 − 1 baseline). `tsc --noEmit` clean; `bun run check` green in this worktree.
710. Honest limits: the carried spend between a `get` pull and the next event can lag the true ledger by one evaluation turn (same contract as the context estimate); the final-spend event is pinned at the controller harness, not at a live TUI frame; the rename is mechanical but any external fork importing `preserveContextSize` from `src/core/entries.ts` must rename (the module is internal — not in package.json `exports`). Marker re-counted at the first marker and below.

<!-- spec-check files=68 tests=1893 -->

## Workstream GG — record identity on the carry, drop events with no goal key, commit on the planner-retry path (2026-11-17)

Source: a read-only survey of the live `changed`/carry/settle machinery (no commands run by the surveyor). Three of its findings were real and small enough to fix in one pass; the rest were dismissed below with reasons. No redesign; no test weakened. Docs untouched (the stale `github-single-channel` lease still owns `docs/`, `README.md`, `RELEASE-CHECKLIST.md`).

711. src/core/wire.ts — `parseChangedEvent` narrowed a payload with a missing goal key to `{ sessionID, goal: null }`, blanking the TUI's cached entry on any malformed `changed` event. Now only an explicit `goal: null` clears the entry; a missing key drops the event (the consumer at `src/tui.tsx` already treats `undefined` as "drop"). Present-but-malformed payloads still drop the event, unchanged.
712. src/core/entries.ts — `preserveCarriedFields` carried `contextSize`, `spend`, and applied the pending→landed `loopCompact` invalidation without comparing record identity. A cleared-then-re-armed goal reuses the sessionID, so the old record's figures could paint the new goal until the next `get` pull. Both carries and the landing detection now require `previous.id === next.id`. Same-reference fast path for the no-carry case is unchanged.
713. src/runtime/controller.ts — `evaluate()` routes a met verdict on an armed loop into `loopAdvance`, which returns before the shared `commit`. When the planner's `nextGoal` call then failed, the retry branch re-armed a timer but never persisted the turn verdict or its spend: storage (and any other client) stayed blind until the arm landed, or forever on a crash. The retry branch now `await this.commit(record)` before scheduling the retry. The loop bookkeeping (`loopHistory`, `loopNotProgress`) remains local until the arm lands, exactly as before.
714. test/wire.test.ts — the missing-goal-key expectation flips to `undefined` (drop), with a comment stating the explicit-null rule.
715. test/entries.test.ts — +3 pins: a cleared-then-re-armed goal inherits nothing from the old record (figures and pending→landed detection), the same record id keeps carrying its figures, and a pending→landed flip is still honored within one record. Suite 1456 → 1460 pass, 0 fail (58 files).
716. test/loop.test.ts — +1 pin: a met loop verdict whose planner throws is persisted before the retry is scheduled — after dispose + restore into a fresh controller, the stored record carries the met history entry and its reason.
717. Dismissed with reason: the survey's docs line-ref items (docs/runtime.html, docs/index.html) touch `docs/` (owned by the stale `github-single-channel` lease) — not touched; `.docs-watch.log` is already git-ignored via `*.log` and untracked; the `evaluating=false`-without-emit paths converge through the normal commit, and the one true hole (the planner-retry path emitting nothing) is closed by 713; the `git-tracked`/`dist freshness` unverified items were verified this iteration (`bun run check` green end-to-end in this worktree).
718. Honest limits: the identity guard keys on the record's additive `id` field only (not `startedAt`); identity is pinned at the controller/TUI-harness level, not at a live TUI frame; the planner-retry commit persists the verdict but does not persist the summarized loop iteration (still local by design until the arm lands); the two pre-existing `evaluating` finally-blocks still flip the flag without an emit of their own and rely on the following commit — acceptable because every path after them commits.

<!-- spec-check files=68 tests=1893 -->

## Workstream HH — live-stream cross-process truth: peek reads, background drain, null re-pull (2026-11-17)

Source: a survey of the goal plugin's server↔TUI live path (`GoalController.commit` → `emitter.changed` → host RPC event bus → TUI `rpc.events.on("changed")` → `put()` → entries cache, plus the TUI's 15s-tick stale-chrome guard) found five connected defects: RPC reads adopted foreign records and rewrote shared storage; a deferral painted `waiting` forever because nothing fired when the background work actually finished; the TUI's unchanged-snapshot branch never refreshed `receivedAt`, so a paused/null goal re-pulled at every tick; the stale-chrome guard could not see null entries at all; and `spend` answered only for in-memory sessions. The fixes were designed together and are implemented as one pass. No redesign; no test weakened. Cross-process (two opencode windows on one directory) writes the same `goal/v1/*` storage; there is no file watch anywhere — truth rides storage reads on the pull path and the event push on the write path. Docs untouched (the stale `github-single-channel` lease still owns `docs/`, `README.md`, `RELEASE-CHECKLIST.md`).

719. src/runtime/controller.ts — `snapshot()` split into a private `snapshotRecord(record, runtime, spend?, contextSize?)` (the former body minus the map lookups) plus a thin `snapshot()` that looks the record up and delegates. Two read-only peeks on top: `peekSnapshot(sessionID, spend?, contextSize?)` serves the in-memory record with runtime truth when present; otherwise reads storage fresh (terminal records included — a dropped `changed` event converges through the next pull) and returns null for missing or foreign-directory records. `peekList()` merges `store.loadLive(directory)` with the in-memory live records (the in-memory copy wins per sessionID — this instance's copy is newer than the stored one). Neither peek adopts nor writes.
720. src/runtime/controller.ts — `restoreOne` removed entirely (controller + every caller). `adoptRestored` (now reachable only from the bulk `restore()` at server setup) no longer commits: adoption normalizes in memory only — writing the stored record on a read/adopt path is what zeroed turns/baseline for the other process sharing the storage. The next real commit persists the normalized state.
721. src/rpc-handlers.ts — the `RpcGoalController` surface is now `peekSnapshot`/`peekList`/`spend`/`contextSize?`/`status`/`clear`; `restoreOne`/`restore`/`snapshot`/`list` are gone. `get` spends then peeks (a failure inside the peek yields `goal: null` through its own `.catch(() => null)`; the outer try/catch still guards the whole handler); `list` peeks. Reads never adopt, never restore, never write.
722. src/runtime/controller.ts — new public `onBackgroundDrained()` (placed next to `checkin`): for every runtime whose evaluation deferred on background work (`deferredSince !== undefined`, not evaluating, not running, record `active`) and whose session reports no remaining background work (`busy` → 0 subagents + shells), it carries the deferred tool calls, clears the deferral (`deferredSince = undefined`), bumps the epoch and re-runs the evaluation now — instead of at the next idle check-in, which may be 30+ minutes away or never (`checkinMinutes === 0` / `maxIdleCheckins` exhausted).
723. src/runtime/events.ts — `onBackgroundDrained()` is fired (guarded) after the existing controller call on `session.execution.succeeded`, `session.execution.failed`, `session.execution.interrupted`, `session.deleted`, `shell.exited`/`shell.deleted`, and `shell.updated` (a non-running status ends the shell there too; the call is a no-op when nothing deferred). Direct call, never optional: the router test stubs grew a rejecting `onBackgroundDrained` (`test/controller.test.ts`, the pre-existing "async handlers that reject" pin went 3 → 4 reported errors) so the drain's own failures are pinned as reported-never-escaping. Not wired into `session.execution.started`, `session.created`, `shell.created`, `session.tool.called`.
724. src/core/entries.ts + src/tui.tsx — new `bumpReceivedAt(entries, sessionID, now)` returns a NEW map (new entry object, SAME goal reference) with the entry's `receivedAt` set to now; the `put()` intake's unchanged-snapshot branch (`goalsEqual(existing.goal, mergedGoal)`) returns it instead of the previous map reference. The stale-chrome guard keys on `receivedAt`, and an identical snapshot never reaches the fresh branch, so a never-changing paused/null entry would otherwise re-pull at every tick forever. Goal-identical memos and the render tree stay untouched (the goal reference is shared).
725. src/core/hud.ts — new `staleUnprovenSessionIDs(entries, nowMs, minAgeMs?)` next to `staleLiveSessionIDs` (which is unchanged; its tests pin it): every entry older than the cadence whose goal is live OR absent is re-pulled. The null arm closes the hole a live-only guard cannot see — a goal armed since the last pull (the `changed` event was dropped, it was armed by the other process on the same directory, or this TUI latched its one-shot fetch while the goal did not exist yet). `src/tui.tsx`'s tick re-pulls through it, so a goal armed elsewhere appears within ~STALE_LIVE_ENTRY_MS (30s).
726. src/runtime/controller.ts — `spend(sessionID)` falls back to the stored record when the session is not in memory (unadopted foreign/post-reload sessions still get a ledger). `contextSize()` stays memory-gated on purpose: a foreign session must not trigger the expensive context estimate (documented in its doc comment).
727. Tests — `test/rpc-handlers.test.ts` rewritten to the peek contract (the stub carries no restore/restoreOne/snapshot/list surface at all — that is the assertion of the read-only posture; plus the peek-throws / double-failure / contextSize passthrough cases). `test/loop.test.ts` swaps the four `restoreOne` tests for the peek contract (peekSnapshot live record without adopting — storage byte-identical before/after; peekSnapshot terminal records as stored truth; peekSnapshot null for missing and foreign-directory records; peekList serves stored live records / omits terminal ones; spend falls back to the stored record) and adds a `background drain` describe block (deferred turn evaluates as soon as background work drains; no-op when nothing deferred; waits for remaining work) — the design's `expect(h.verdicts).toHaveLength(0)` drain assertion matches the existing defer test pattern. `test/tui-hud.test.tsx` gains `staleUnprovenSessionIDs` pins (stale live included, terminal excluded, fresh live excluded, missing `receivedAt` included, stale `null` included, fresh null excluded, custom floor). `test/entries.test.ts` gains `bumpReceivedAt` pins (new map, same goal reference, siblings untouched, unknown session same reference, null-goal entry). Suite 1460 → 1476 pass, 0 fail (58 files).
728. Honest limits: a second instance's SETUP-time `restore()` still adopts live records in memory — it cannot distinguish foreign ownership at that point — but can no longer rewrite the stored record, so the cross-window turn/baseline zeroing is gone; cross-process convergence rides the TUI tick (~30s worst case) for event drops — the push path is unchanged; the drain re-runs the normal `evaluate()` path (epoch bumped, deferred tool calls carried), so a not_met verdict there arms a continuation steer like any turn; `shell.updated` fires the drain unconditionally (no-op when nothing deferred); `peekList()` serves in-memory records with their runtime truth and stored ones without; `dist/tui.js` recompiled by `bun run compile`.

<!-- spec-check files=68 tests=1893 -->

## Workstream II — convergence hygiene: silent flag flips announce themselves, the dialog refreshes on the tick, the cache cap holds (2026-11-17)

Source: a fresh read-only survey of the goal plugin's server↔TUI live path and the entries cache (no commands run by the surveyor) re-opened the HH findings territory and surfaced six new, smaller defects in the same class. All were verified against the code and fixed in one pass. No redesign; no test weakened. Docs untouched (the stale `github-single-channel` lease still owns `docs/`, `README.md`, `RELEASE-CHECKLIST.md`).

729. src/runtime/controller.ts — `invalidate()` now records whether `runtime.evaluating` was set before it clears it, and emits `changed` (through the normal `emit()`, which no-ops for non-adopted records) when it cleared a live flag. Every caller of `invalidate()` — `onUserPrompt`, `onExecutionStarted`, `onExecutionFailed`, `onExecutionInterrupted`, `onSessionDeleted`, `pause`/`finish`, `reset`, dispose-all — gets the evaluating:false flip announced instead of silently swallowed. The in-flight `evaluate()` still epoch-guards into its early return; the TUI receives the flip at the invalidation point, not 30s later via the stale re-pull. `Runtime` gained a `readonly sessionID` (both factories set it) for the lookup.
730. src/runtime/controller.ts — `clearDeferred(runtime, record)` now takes the record at all call sites and emits `changed` when it actually cleared a pending deferral (`deferredSince !== undefined`). The `waiting` pill rode `deferredSince !== undefined` at snapshot time; the interrupt paths (`superseded`/`shutdown`/`inactivity`) flipped it with no record mutation for `commit()` to notice, so "waiting" could stick indefinitely. `onUserPrompt`/`onExecutionFailed`/`onExecutionInterrupted`/`loopAdvance`/`pause`/`finish` pass their record; the call is a no-op when nothing deferred.
731. src/core/entries.ts + src/tui.tsx — `pruneSnapshotEntries` gained an optional `{ dropNulls = true }` fourth parameter: the fresh intake path keeps its unconditional null-drop, the unchanged-snapshot branch (`bumpReceivedAt`) now passes `{ dropNulls: false }` so steady null entries — the tick's re-pull targets — are retained, while the map cap (`ENTRY_CAP`, oldest non-live first, live never evicted) is still enforced there. Previously the unchanged branch returned early and the map could grow past the cap without bound. Null entries still get cap-evicted when the map overflows (documented, acceptable); the fresh branch still drops delivered nulls.
732. src/tui.tsx — the 15s tick also refreshes the kept-open dialog's foreign-goals block (`others()` signal via `refreshOthers()`) — previously it re-pulled cached session entries but not the dialog's other-project/session list, so a dropped `changed` event painted it stale for the dialog's whole life.
733. src/tui.tsx — the dialog-open snapshot pull now sets `setDialogNoticeStale(!fresh)`: one transient RPC failure at open no longer latches the "snapshot unavailable" line for the rest of the dialog's life; a later success (or the live event stream landing fresh data) clears it.
734. src/tui.tsx — the one-shot `requested` marker set is capped at 256 entries (wholesale clear — a re-ensured session re-pulls once through the normal path). The entries cache was already capped via `pruneSnapshotEntries`; this set was the remaining unbounded structure alongside it.
735. src/tui.tsx + src/core/wire.ts + src/runtime/store.ts — the TUI's `changed` intake drops non-null goal payloads whose `goal.directory` differs from `context.location?.directory` (`sameDirectory`, moved verbatim from `src/runtime/store.ts` into `src/core/wire.ts`, re-exported by the store so existing imports and tests are untouched; normalized separators/trailing slash, case-insensitive on win32). Defense-in-depth for a host bus that ever crosses directories; fails open when no local directory is known, and null-goal clears (no directory to compare) pass through.
736. Tests — `test/loop.test.ts` harness grew a `changed` capture (the `emitter.changed` stub now records) and a `gate.evaluate` hook on the evaluator mock; two new pins: an epoch-invalidated in-flight evaluation emits `changed(evaluating:false)` (and the turn completes cleanly after the gate releases), and an execution interrupted while a turn defers on background work emits `changed(waiting:false)`. `test/entries.test.ts` gained two pins for the `dropNulls:false` path (steady nulls retained below the cap; the cap still evicts oldest non-live, the freshly bumped entry and live goals survive). Suite 1476 → 1480 pass, 0 fail.
737. Dismissed with reason: the survey's docs items (`docs/runtime.html` refs, `docs/index.html` epoch ref) touch leased docs; the explorer's suggested `pruneSnapshotEntries(bumpReceivedAt(...))` unmodified would have dropped steady null entries and re-broken the HH stale-null re-pull — the implemented fix keeps the re-pull target alive and enforces only the cap.
738. Honest limits: the invalidate/clearDeferred emits fire synchronously at the invalidation point with the pre-mutation snapshot (the subsequent `commit()` may double-emit; the TUI dedupes via `goalsEqual`, so the render tree sees at most a `receivedAt` bump); the directory gate is defense-in-depth, not a verified host-bus scope boundary; steady null entries over `ENTRY_CAP` evicted by the cap no longer re-pull until a `changed` event re-creates them (accepted, bounded by the cap); `requested` wholesale clear permits one redundant re-pull per session in the worst case.

<!-- spec-check files=68 tests=1893 -->

## Workstream III — docs citations: file:line re-anchored to symbols; the reference guard updated (2026-11-17)

Source: the docs items left open by the II survey (`docs/runtime.html` line refs, `docs/index.html` epoch ref, plus `docs/config.html`'s bare `<code>:65</code>` chips). The `github-single-channel` lease that blocked them is dead on the evidence: claimed 2026-11-16T00:30Z by an orchestrator session, no worktree at `worktrees/wt-github-single-channel`, no `wt/github-single-channel` branch anywhere, and `coordinator doctor` FAILs on it. The `docs` claim here used `--force`; the override is logged to the lease. Nothing in `.term/coordinator/state.json` was hand-edited. No code changed; docs and the reference guard only.

739. docs/*.html — every `src/**.ts:NNN` citation re-anchored to `src/**.ts · symbol`, each symbol verified against the current tree: `evaluate()/finish()` (met/impossible terminal branch), `Runtime.epoch` + `stale()` (epoch invalidation), `defer()` + `checkin()` + `DEFAULTS` (background defer / idle check-ins), `HISTORY` (20-verdict cap), `handleFailure()` (fatal-error terminal), `continueWith()` (synthetic steer), `classifyFailure()` + `FailureClass`, `GoalStatus` + `LIVE_STATUSES`, `createRouter()`, `Evaluator`, `GoalStore`, `GoalController`, `SessionPort`, `parseGoalCommand()`, `estimateContextTokens()`, `DEFAULTS` / `resolveConfig()` / `envBool()` / `parseCoordinator()`, `detectCoordinator` / `resolveCommitPolicy`, `coordinatorFlow` / `commitStatusSuffix` / `rubric` / `facts` (config.html's four bare `<code>:NNN</code>` line chips dropped), `continuation()` (prompts.ts). `docs/core.html` file cards now cite bare `src/...ts` paths (matching the pre-existing `compactor.ts` / `opencode-cli.ts` cards — the export lists next to each card already name the symbols). After this change docs/*.html contains zero `file.ts:line` citations; the class cannot silently rot again.
740. test/docs-line-refs.test.ts — rewritten to the new convention (still 5 tests): `docs/*.html` are asserted to contain ZERO `file.ts[x]:N` citations; SPEC.md refs (Appendix A frozen to Phase 1) keep the existence / ordered-in-bounds / non-empty line / non-empty range guards, with the extraction-count floor lowered to >=20 (SPEC.md carries 23). The old floor of >=70 counted docs/ line refs, which is why out-of-range and semantically wrong lines sailed through — the guard pinned the count, never the truth.
741. Honest limits: symbol citations can still drift under a rename (a rename re-anchor is one grep away, and the failure mode is loud-ish: the symbol stops appearing in the file and the docs lie less); `README.md` and `RELEASE-CHECKLIST.md` stay under the dead `github-single-channel` lease untouched; `coordinator doctor` still reports that lease's missing worktree — on the owner's machine (or a `--force` claim) it can be cleared, not from here; stamps regenerated via `docs-watch once` (docs pages 2026-11-17, changelog row appended). spec-check files=60 tests=1480 marker unchanged (no package or test-count change).

<!-- spec-check files=68 tests=1893 -->


## Workstream V — TUI intake convergence: retained null re-pull targets, elapsedMs-deduped snapshots, dead guard removed (2026-11-17)

Source: fresh dev-tree survey after Workstreams II/III/IV merged (`ses_e14b8aa77ffekGsd6dK7P400iz`). The survey's one live-update bug (finding 1), the re-render churn it exposed (finding 3), the dead export (finding 6) and the stale changelog stamp (finding 4) are addressed here; findings 2 and 5 are deliberately out of scope (finding 2 needs a recent-terminal TTL predicate and a design call, not a drive-by; finding 5 documents reality, it does not change it).

742. src/core/entries.ts — `pruneSnapshotEntries` no longer drops null-valued entries on any path; the `dropNulls` option is removed and the doc comments now state the invariant: null entries (an observed clear) are retained as the stale-chrome tick's re-pull targets and only the `ENTRY_CAP` cap evicts (oldest non-live first, live never evicted, `keep` — an open dialog — never evicted). The delivered `changed(null)` / cleared-`get` fresh-intake branch used to delete the re-pull target outright, so after any observed clear the tick had nothing to re-pull and a goal armed in another process on the same directory was never noticed. Fixes the one genuine live-stream gap the survey found.
743. src/tui.tsx — the fresh intake branch and the unchanged branch now share the retain-null semantics (4th argument gone from the unchanged-branch call; comments updated). `goalsEqual` now strips `elapsedMs` before the JSON comparison: every server snapshot recomputes it from `now - startedAt`, so two pulls of an unchanged live goal never deep-equaled and the unchanged-snapshot arm (`bumpReceivedAt`, goal-identical memos) never engaged for live goals — every stale re-pull forced a fresh entry and re-render. Terminal and null snapshots deduped before; live ones dedup now.
744. src/core/hud.ts — dead `staleLiveSessionIDs` deleted (its only callers were tests; nothing in src referenced it). `staleUnprovenSessionIDs` (live OR absent — the predicate the tick uses) is the single stale-guard; its doc comment cross-reference updated. `STALE_LIVE_ENTRY_MS` remains exported and used by both the tick cadence and the tests.
745. Tests — `test/entries.test.ts`: the null-drop pin rewritten to the retain invariant (`keys a,b,c`); the steady-null describe block re-pinned to the new default (`dropNulls` argument gone, cap behavior asserted unchanged). `test/tui-hud.test.tsx`: the `staleLiveSessionIDs` describe block (7 tests) deleted with the function. `test/wire.test.ts`: the null-re-pull convergence pin rewritten — the entry is now retained (not dropped) and stays stale-flagged for the next tick, which is the observable V guarantee. Suite 1480 → 1473 pass, 0 fail.
746. SPEC honesty gate — the enforced marker (line ~466, first occurrence) is now `spec-check files=60 tests=1473`; `docs/` and `test/` stay outside `package.json` `files`, so no packaging change; spec-check passes on the merged tree.
747. Docs — `bun scripts/docs-watch.ts once` appended the changelog row for the fix commit and kept the 30-row window (the oldest ED row dropped). The commit was then amended to 15:02 UTC, which moved the anchor ahead of the committed footer stamp (14:13) and failed the freshness gate; re-running `once` after the amend set the row time and changelog.html's footer stamp to 2026-11-17 15:02 UTC, and `bun run check` passed on the result. The design holds throughout: `stampFor` excludes `^docs: refresh` commits precisely so the gate fails when a real content edit lands without a stamp refresh; if refresh commits counted, the stamp would always match and the gate could never fail — and the refresh commit that carries a re-stamp is itself `^docs: refresh`-excluded, so the gate is stable across it. The survey's original "changelog stamp 14:13 UTC trails its own rows" reading is by design, not staleness — but the interim wording here (which claimed no footer stamp ever moves and a 14:13 footer after the re-stamp) described a state this workstream had already left behind; this item now describes the actual sequence.
748. Honest limits: retaining nulls grows the cache toward `ENTRY_CAP` over long sessions (bounded, oldest non-live evicted first, documented in entries.ts); a cross-process re-arm is still noticed only for sessions this TUI has cached at least one snapshot for — never for never-seen sessions (unchanged, by design); `goalsEqual` ignoring `elapsedMs` means a snapshot differing ONLY in elapsed time is "unchanged" — nothing user-visible rides on elapsedMs identity (the pill extrapolates from `receivedAt`); the terminal-entry stale chrome gap (survey finding 2: a dropped `changed(null)` after the goal went terminal leaves terminal chrome painted indefinitely) — superseded by Workstream VI (recent-terminal re-pull, items 749–755).

<!-- spec-check files=68 tests=1893 -->

## Workstream VI — recent-terminal re-pull: a post-terminal clear converges instead of lingering (2026-11-17)

Source: the evaluator-flagged remainder of the fresh dev-tree survey (post-II/III/IV session `ses_e14b8aa77ffekGsd6dK7P400iz`, finding 2): after a goal goes terminal the TUI stopped polling it — `staleUnprovenSessionIDs` covers only live or null entries — so a record cleared in another process after terminal with a dropped `changed(null)` stranded its terminal snapshot in the entries cache forever and every chrome path that can paint it (the dialog's live get at open time failing, the cached record underneath) never converged. The survey's prescribed close: a recent-terminal TTL predicate. Implemented as stamped first-observation time plus a second stale-guard arm — a design decision, not a drive-by: the window ages from first sight of terminal truth so re-pulls cannot postpone it indefinitely, and past the window the residue is the entries cache's own ENTRY_CAP bound (every dialog open re-pulls regardless).

749. src/core/entries.ts — `GoalSnapshotCacheEntry` gains `terminalAt?: number`: the client clock when this entry FIRST observed a non-live goal, retained across re-pulls and `bumpReceivedAt`, dropped when the goal is live or null. New pure helper `terminalStampOf(existing, goal, now)` computes it. Every non-live status (achieved, impossible, failed, cleared) qualifies; the stamp ages from first observation, never from the latest pull.
750. src/core/hud.ts — new exported `RECENT_TERMINAL_WINDOW_MS = 10 * 60_000` and new predicate `staleRecentlyTerminalSessionIDs(entries, nowMs, minAgeMs = STALE_LIVE_ENTRY_MS, windowMs = RECENT_TERMINAL_WINDOW_MS)`: selects entries whose goal is non-null and non-live, whose `terminalAt` lies within the window (edge inclusive), and whose `receivedAt` is older than the cadence. `staleUnprovenSessionIDs` still owns live and null entries unchanged — the two predicates never overlap. Entries without the stamp (cached before this change) are never selected.
751. src/tui.tsx — the `put` fresh branch stamps `terminalAt` via `terminalStampOf` (the `Entry` alias carries it through unchanged); the 15s tick runs the new predicate beside the unproven one under the same comment. A record cleared in another process after terminal now re-pulls inside the window; the pull flows through the normal intake (null goal stored), the ruling chrome (dialog, jump row) converges, and the re-arm case stamps afresh.
752. Semantics decision (the cross-process call): re-polling is bounded by a 10-minute recent-terminal window, not permanent — permanent terminal history stops costing a pull per window once it lapses, and the lapse costs nothing user-visible — the jump row never painted from terminal entries anyway (live-only plus the 45s ack), and the dialog re-pulls at open. The phantom-chrome window finding 2 named is closed; past the window a never-opened stale dialog view is the documented residue.
753. Tests — `test/entries.test.ts` (+6): stamp set on terminal, retained across re-observation and `bumpReceivedAt`, dropped on live/null, every non-live status stamps. `test/tui-hud.test.tsx` (+8): selects stale in-window, excludes past-window / fresh / unstamped / null / live entries, window edge inclusive, configurable floor and window. Suite 1473 → 1487 pass, 0 fail (58 files). The dangling assumption in the unproven predicate's doc comment is untouched; its `excludes terminal goals` pin still holds (the terminal arm is separate by design).
754. SPEC honesty gate — the enforced marker (line ~466, first occurrence) and the Workstream V trailing marker are now `spec-check files=60 tests=1487`; Docker-free docs/test stay outside `package.json` `files`; spec-check passes on the merged tree.
755. Honest limits: `terminalAt` is TUI-instance memory — a TUI that never observed the terminal transition cannot stamp, so its stale terminal entry behaves as before (pre-existing cache semantics, unchanged); the window is client-clock based like every other stamp here (elapsed extrapolation rides the same clock); past 10 minutes a post-terminal clear is still invisible until some open forces a pull — bounded residue, chosen over perpetual polling.

<!-- spec-check files=68 tests=1893 -->

## Workstream VII — reconnecting RPC pumps: the TUI's event intake survives a dropped service (2026-11-17)

Source: the 2026-11-17 live incident (report from the goal-loop TUI of session `ses_e13bf0d71ffeKpY3IiqoJK43x3`, screenshot 20261117-192149): the ambient pill was stuck on "checking" after the backend had finished; restart was the only remedy. Investigation of the upstream background service's log (`~/.local/share/opencode/log/opencode.log`, run `a5113284`) showed every `POST /api/rpc/goal/get` from the 15s stale-chrome tick returning HTTP 500 from 00:57:52 through the service handoff at 01:23:46 — 77 consecutive 500s, zero 200s — and zero `rpc.goal.changed` deliveries logged. The plugin's backend emission paths were audited and are complete: every terminal transition (verdict met/not_met/impossible, loop advance, pause, cap, stall, retry, failed, cleared, verify-gate downgrade, and the silent evaluating/waiting flips announced by Workstream II) ends in `commit()`/`finish()`/`invalidate()`, each of which emits a `changed` snapshot with the flipped flag. The gap is one layer up: when the harness's shared event connection ends, every one-shot `rpc.events.on(...)` subscription seeded before the drop ends with it forever (`@opencode/client` `makeRpc` iterates the shared stream once; the shared-events bus has no re-subscribe path for existing subscribers), so the TUI never receives another `changed` and — with `/api/rpc/goal/get` also 500ing — its 30s converge arm is dead too. Constraint honoured: the fix changes the plugin's subscription lifecycle, not the evaluator or the harness; the root cause at the transport layer is reported, not papered over.

756. `src/core/rpc-pump.ts` (new, ships) — `pumpRpcEvent(options)`: an abortable pump that re-opens an RPC event stream with `RPC_RESUBSCRIBE_DELAY_MS = 1_000` backoff whenever it ends normally or throws. A throwing handler is reported and skipped (one bad event cannot kill the pump); after the stream ends it runs the caller's `catchUp` — before the backoff — so the gap is closed by re-reading the server's truth, then re-subscribes. Never propagates; only teardown (the abort signal) ends it.
757. `src/tui.tsx` — the two one-shot `rpc.events.on("changed" | "notice", ...)` subscriptions are replaced by two pumps over `rpc.events.subscribe(...)`. The handlers are factored verbatim (`handleChangedEvent`, `handleNoticeEvent` — same wire parsing, same directory defense-in-depth, same dialog-open refresh). The changed pump's `catchUp` re-pulls every cached live/null entry (`staleUnprovenSessionIDs(entries(), Date.now(), 0)`) and, if a dialog is open, re-pulls the foreign-goals list — so any events the drop swallowed are re-read from the server within one backoff interval of the bus reviving. A `globalThis` generation guard (`__opencodeGoalTuiRpcPump__`) aborts a previous TUI plugin generation's pump on re-setup, so hot reloads never multiply subscriptions (and the plugin's returned teardown aborts the current pump when the host disposes setup scope).
758. `src/core/entries.ts` — the `changed`-intake body of the TUI's `put()` extracted pure as `applySnapshot(entries, sessionID, goal, nowMs, keep, cap = ENTRY_CAP)` (same semantics as before: unchanged snapshots re-stamp `receivedAt` and keep the goal reference, everything else stores a fresh entry with `terminalAt` stamped on transition to non-live). `goalsEqual` and its `elapsedMs`-stripping comparison moved with it. `src/tui.tsx` keeps the terminal-acknowledgment and landing probes, then delegates the store transition. This makes the verdict→store transition unit-testable without mounting Solid.
759. Tests — `test/rpc-pump.test.ts` (+5): pump drains events and re-subscribes with backoff after the stream ends; survives a stream that throws (re-subscribe, catch-up per pass); a throwing handler never kills the pump or skips siblings; abort stops the pump; catch-up runs after the stream ends and before the backoff. `test/tui-render.test.tsx` (+1): the transition render — the same StatusDialogBody painted with `evaluating: true` then the post-verdict snapshot; the first frame contains 'checking', the second does not. `test/verdict-intake.test.ts` (+6): the live symptom's exact pipeline — `parseChangedEvent` of a verdict-shaped `changed` payload (evaluating cleared) → `applySnapshot` → the store entry flips → `pillModel` leaves `checking`/`evaluating`; a met/loop verdict reaching `achieved`; unchanged re-pulls re-stamp without replacing the goal reference; malformed payloads rejected by the wire narrow; an explicit null (cleared elsewhere) clears the entry. Suite 1487 → 1499 pass, 0 fail (60 files). The headless-render seam (`test/tui-render.test.tsx` "an evaluating goal shows 'checking'") is untouched and still pins the pre-verdict frame.
760. SPEC honesty gate — the enforced marker (line ~466, first occurrence) and this workstream's trailing marker are now `spec-check files=61 tests=1499` (the pump module ships; `test/` stays outside `package.json` `files`). `package-integrity.test.ts` re-pinned to 61 packed paths. `bun run check` green; `git status` clean after compile.
761. Honest limits: (a) the pump fixes the *event* intake; the *RPC read* path (`/api/rpc/goal/get`) is harness-served and its 2026-11-17 500 storm was not root-caused (the background service had restarted by the time the investigation ran — cause unrecoverable from the log; the current service answers 200/400/401 correctly as probed). If the RPC read path 500s again, the pill converges only when it recovers — no plugin change can pull state the server refuses to serve, and `ensure()`/re-pull stay total by construction. (b) The retained `globalThis` generation guard is process-wide by design; a foreign (non-plugin) writer to that key would trip the abort — fail-safe direction, noted. (c) `notice` replays are not deduplicated across a reconnect — the bus drops, it does not replay, so no duplicate-toast path exists in practice; if the harness ever replays `notice` on reconnect, toasts double-fire (cosmetic only; out of scope). (d) Live end-to-end verification (arm a real /goal-loop in the upstream TUI and watch the pill clear on verdict) was NOT performed — provider quota in this environment is exhausted; the claim stops at the unit/integration layer plus headless render, per the task's own ordering rule.

<!-- spec-check files=68 tests=1893 -->

## Workstream VIII — restore() is adopt-only: compaction only ever targets the specific session (2026-11-17)

Source: live incident report (2026-11-17): the compaction was observed triggering at the same time for every session with an active `/goal` or `/goal-loop`. The only multi-session compaction trigger in the plugin was the restore fan-out (Workstreams AG/AJ): on plugin (re)load, `restore()` asked the host to boundary-compact every live armed-loop session in the directory at once — "compact all sessions at once", exactly what was observed. Plain `/goal` goals never reached the boundary path, but armed loops across every open session fired together on every reload. The per-session paths (threshold `maybeCompact` on `execution.succeeded`, arm-time `compactAtBoundary` on `/goal-loop` advance) were already session-scoped; the fan-out was the outlier.

762. src/runtime/controller.ts — `restore()` no longer requests any host compaction, for any record kind. It is adopt-only: it loads live records for its directory, resets counters and the spend baseline, and adopts them. The `boundaryCompact` option is gone (nothing called it with `false` except a test), the fan-out block is deleted, and `BOUNDARY_LANDING_GRACE_MS` is removed with it — its only purpose was to suppress a restore re-request after a landing. The doc comment now states the invariant: compaction is strictly per session — the specific session whose context crosses `compactAtTokens` (threshold path, `execution.succeeded`) or whose `/goal-loop` arm asks for one (arm-time path). A restore cannot know which session needs a fresh context next, so it asks for none.
763. Behavior after restart, deliberately: a restored live `/goal-loop` keeps its existing context until its own next arm boundary compacts it (per session, same as a never-restarted loop); restored plain `/goal` goals are unchanged (they never reach the boundary path); `compactOnLoopIteration: false` is no longer consulted at restore (there is no restore compaction to gate). The trade-off against Workstream T/AG's "resume on a fresh context" is accepted by design: an all-sessions-at-once compaction storm on every plugin reload is worse than a hot context on a resumed loop, which its own next arm fixes.
764. src/core/constants.ts — `BOUNDARY_LANDING_GRACE_MS` deleted (dead after the fan-out removal); `test/constants.test.ts` pins 3 constants now (pinned-values, drop-factor, min-size).
765. Tests — `test/loop.test.ts`: "restore does not stack…" renamed to "a restore requests no compaction even with an unlanded pending request"; "restore does not compact again right after a landing" renamed to "a restore requests no compaction right after a landing either"; "restore({ boundaryCompact: false })…" rewritten as "restore adopts live records without requesting any host compaction (adopt-only)"; "(v) restore()…" comment updated. New pin: "a restore of many live loop sessions compacts none of them (no all-at-once fan-out)" — two armed-loop sessions sharing one storage, both restored, zero compact calls. Suite 1499 → 1499 pass, 0 fail (constants −1, loop +1; run via `cd test && bun test`).
766. Docs — README.md (feature bullet, config table, auto-compaction section, coalescing note), docs/runtime.html, docs/config.html, docs/core.html updated to state that compaction only ever targets the one session whose arm crossed the boundary and that a restore requests nothing.
767. Honest limits: a restored armed loop that was mid-iteration at the restart boundary keeps its pre-restart context until its own next arm; a plugin reload no longer buys any fresh context. That is the requested semantics (compact the specific session, never all at once), not an oversight. The workstream does not touch the host's own window-relative auto-compaction, which is opencode's and per-session by construction.

## Workstream IX — the dialog chrome earns its cells back: 1-cell ClampedColumn padding, footer tier re-priced to width−2 (2026-11-18)

Interpretation of this iteration: the goal to make the `/goal` detail dialog snappy and free of wasted space, taken past the body-content compaction (Workstream-level strip+state row merge and inline loop bar earlier this leg) into the host chrome. Direct measurement drove the shape, not an audit finding: the headless render harness gained a `--bench=N` flag (`scripts/render-dialog.tsx`, not shipped; `scripts/` is outside `package.json` `files`) so frame cost is printed, not asserted — before the change: 200 frames, avg 0.15ms, min 0.11ms, max 2.04ms; after: 300 frames, avg 0.15ms, min 0.10ms, max 3.57ms (frame cost is not the bottleneck; the waste was geometry).

768. `src/tui.tsx` — `ClampedColumn` (the dialog's outer frame) drops `paddingLeft`/`paddingRight` from 3 to 1 and `paddingBottom` from 1 to 0; the esc cell keeps its 1-cell horizontal padding. The content ceiling now starts at x=1.
769. `src/hud-card.tsx` — `dialogFooterTier` budget re-priced `Math.floor(width) - 6` → `- 2` (both ClampedColumn paddings), comments re-anchored; roomy unlocks at 96 (default) / 98 (unpin condition) / 90 (copied); full hint unlocks at 119 (default) / 113 (copied) / 121 (unpin condition). Supersedes the CX `width−6` contract, which the 3-cell chrome made correct; the chrome is what changed here, so the tier is re-pinned to match, never silently. Workstream CX stays as the historical record of the −6 era.
770. `scripts/render-dialog.tsx` — `--bench=N` prints avg/min/max ms per frame (renderOnce + captureCharFrame over N iterations); the hand-mirrored chrome line in that harness updated to the 1-cell padding so the frame it prints is the frame the host paints.
771. Tests re-pinned (no new test functions, marker unchanged): `test/tui-hud.test.tsx` boundary matrix moved from 94/96/99/100/101/102 and 116/117/122/123/124/125 to 90/95/96/97/98 and 112/113/118/119/120/121 (the `width−N` comments updated); `test/tui-render.test.tsx` "at 96 cells the noun labels overflow" moved to 92; `test/tui-snapshots.test.tsx` `DialogFooter · 96 columns` moved to 92 columns (noun-label snapshot regenerated). The `tui-render.test.tsx` roomy-tier assertion at 103 and the 80-column floor are untouched and still green.

Marker unchanged: files=61 tests=1499. No version bump, no tag, no push; v1.1.0 remains the live public artifact; all work is local on dev. No docs references to the width−6 arithmetic exist (audited: docs/ carries none).

Verification (all run in the worktree): tsc --noEmit clean; `bun test` 1499 pass / 0 fail / 28 snapshots after `bun test -u`; headless render at 150 and 80 columns shows the full-width frame with the footer buttons inside the panel edge; `--bench=300` after the change: avg 0.15ms, min 0.10ms. Whole dialog-width class (the terminal-side empty half beyond the panel) is outside the plugin's reach — opencode's `DialogSize` caps at `xlarge`, which the dialog already requests; the note is recorded so the next workstream does not re-chase it.

<!-- spec-check files=68 tests=1893 -->

<!-- spec-check files=68 tests=1893 -->

## Workstream X — snapshot mirror: convergence when the RPC and the bus are both dead (2026-11-18)

Source: live end-to-end verification of Workstream VII, performed in a fresh standalone TUI (`/goal` of an already-satisfied condition, real evaluator, real verdict). The verdict landed (`met`, turn 1, 37s; the inline acknowledgment "Goal achieved (turn 1, 37s)." and the achieved-notice toast both rendered), yet the ambient pill in the jump row painted "goal checking · Nm" for 11+ minutes — the exact symptom of Workstream VII, one layer deeper. Logs (`~/.local/share/opencode/log/opencode.log`, run `88cfc6e8`, `opencode serve --stdio --port 0`): 25+ consecutive `POST /api/rpc/goal/get` → HTTP 500 from 01:55:12 onwards, zero 200s, zero `changed` deliveries for the session. The same storm hit the shared background service twice before that (run `a5113284`, 77 consecutive 500s on 2026-11-17 00:57–01:23; run `7f09997d`, 6 consecutive 500s 01:50:54–01:51:39, self-healed). The backend was proven correct: the record persisted by the server plugin shows `status "achieved"`, `verdict "met"` — and the wire narrow accepts it (`parseChangedEvent` on the stored record returns a valid event). The TUI's convergence arms were all dead by construction: the `changed` event never arrived, the 15s stale-chrome re-pull 500s, `ensure()`/`refresh()` 500s, and the reconnect catch-up re-pulls through the same 500ing RPC. The notice pump is unaffected (notices rode the bus and the achieved toast rendered), which is why the incident shows a completed goal "checking". Constraint honoured: nothing here touches the evaluator or the verification gate; this is a new, filesystem convergence arm, not a weakened truth.

774. `src/core/mirror.ts` (new, ships) — `createGoalMirror(dir?)`: a small, atomic, owner-only copy of the latest snapshot. `write` mkdirs `<tmpdir>/opencode-goal-mirror` (0700) and does tmp+rename with 0600 (a reader never sees a half-written file; the snapshot carries the user's condition text). `remove` unlinks on the cleared signal. `read` JSON-parses and runs the same `parseGoalSnapshot` narrowing plus the same sessionID and directory discipline as the `changed` intake (foreign records never paint; fail-open only when this instance has no directory). Path-like sessionIDs are sanitized to a flat filename. Best-effort everywhere: no failure escapes.
775. `src/index.ts` — the server plugin writes/removes the mirror inside the `emit` wiring, before the RPC emit: on every `changed`, `mirror.write(goal)` for non-null snapshots, `mirror.remove(sessionID)` for null (cleared). Disabled in probe mode (read-only storage semantics) and by `OPENCODE_GOAL_MIRROR=0`; a mirror failure logs `goal mirror write failed` and never affects the commit path. No behavioral change to any existing consumer: events, records, RPC contracts untouched.
776. `src/tui.tsx` — new `refreshFromStorage(sessionID)` next to `refresh()`: reads `goalMirror.read(sessionID, context.location?.directory)` and feeds the result through the normal `put()` intake (including the terminal-acknowledgment detection). It runs exactly where a re-pull is already due: the 15s stale-chrome tick (both predicate loops), the pump reconnect catch-up, and `ensure()` when the RPC pull fails — so the ambient pill, the jump row and the dialog converge to the server's truth within one tick even when the RPC bridge is dead and the verdict event was lost. The RPC path remains primary; the mirror only backstops it.
777. Tests — `test/mirror.test.ts` (+9): write→read roundtrip; owner-only file and no stray tmp siblings; `remove()` unlinks; malformed/truncated mirror files dropped; wrong-session record dropped; foreign-directory record dropped; directory-guard fail-open without a local directory; path-like sessionIDs contained to the mirror dir; and the end-to-end seam: a stale evaluating entry converges to the terminal record through the mirror and `pillModel` leaves `checking` — the exact live symptom's pipeline, with RPC and bus disconnected. `test/package-integrity.test.ts` re-pinned to 62 packed paths. `OPENCODE_GOAL_MIRROR` documented in README.md and docs/config.html (the env-document test enforces parity).
778. SPEC honesty gate — the enforced marker (line ~466, first occurrence) and this workstream's trailing marker are now `spec-check files=62 tests=1514` (`src/core/mirror.ts` ships; `test/` stays outside `package.json` `files`). `bun run check` green; `git status` clean after compile.
779. Honest limits: (a) the mirror cannot tell cleared-from-terminal — a cleared record leaves no mirror file, so the unlocked case still needs the event or RPC to converge (unchanged semantics for that path; the tick still re-pulls it); (b) the mirror is per machine and per user tmp dir — a TUI and a server in different tmp roots (TMPDIR overrides differing between processes) never see each other's mirrors, degrading silently to the pre-fix behavior; (c) a snapshot older than the last `changed` event is all the mirror holds when events stop entirely — it converges to the last emitted truth, which is by construction at least as new as the entries cache; (d) the RPC 500s on `serve --stdio` standalone servers and the event-bus drop at the verdict moment remain harness-layer behavior, reported here, not patched around. The mirror makes the pill truthful without either path working; it does not fix the harness.

## Workstream XI — hover stability: the affordance never moves (2026-11-18)

Interpretation of this iteration, from the live TUI complaint: "mouse hover over it shows up copy. and that copy is flickering. and when mouse hover over the text it changes. i like things to be consistency. stay the same no flikering laggying those things." Every click-to-copy row on the plugin's own surfaces revealed a `copy` hint by mounting a new text node under the mouse (`<Show when={hovered()}>`), and the wrapping (`wrapMode="word"`) payload text changed attributes on hover — so hovering could rewrap the row, shift it under the pointer, unmount the hint, rewrap back and oscillate; the resting frame was never the painted frame. The fix is one grammar, applied everywhere: an always-mounted, fixed-width affordance cell.

780. `src/hud-card.tsx`, `src/status-dialog.tsx`, `src/tui-history.tsx` — a shared in-file `Affordance` cell replaces every hover-revealed `copy`/`save`/`verify`/`reach`/`sign`/`seal`/`→ transcript`/`click[· m]` hint: width 8 (13 for `→ transcript`, 9 for `click · m`, 6 for the sweep verbs), idle faint, hover base (weight under mono), never mounted or unmounted, never resized. The click acknowledgment paints inside the same cell (`✓ copied` / `+ copied` / `✓ saved`, ~1.6s) — nothing outside the cell ever changes. The row's text never changes attributes on hover, so the `wrapMode="word"` payload never rewraps and the row never reflows. The condition/why width reserve drops from 23 to 25 cells (`conditionWidth`), two cells more truncation headroom, spent on the fixed cell. The hover-revealed turn tag on the verdict trail is gone; a click copies and the ack rides the trail line (`verdicts · turn N · ✓ copied`). The outline rail chips, the `find` row and its close button, the view tabs and the rail fold row paint static chrome — the words already say "click".
781. Text leaves bolden-on-hover are deleted on every interactive row in scope, not just the wrapping ones: the affordance cell is the only thing hover may paint. Buttons and context-menu rows (`HudButton`, `HudMenuRow`) keep the composer's raised-background hover grammar (weight under mono) — geometry-stable controls, not text rows. `src/tui.tsx` hover sites (the pill, the dialog's `esc` cell, the palette footer button's label flip) are outside this lease's claimed paths and stay as they were.
782. Tests re-pinned in place (suite count unchanged, 1514): the two "dialog hover reveals the hint" render tests became always-mounted-affordance tests (resting frame paints the cell, hover changes no span on the row, frame restored byte-for-byte on mouse-out); "hovering the condition row paints bold and no span carries UNDERLINE" became "hover leaves every span unchanged, never underlines"; the trail test pinned `rest === frame-under-mouse` plus the click ack; the dossier chip test pinned the identical resting frame under the mouse; `render-scripts.test.ts` expects "click a row to open its transcript" (the elsewhere header copy was corrected — it said "hover a row"). Snapshots regenerated: every frame gains the always-faint affordance cell on interactive rows; the elsewhere rows paint `→ transcript` and the fold paints `click` at rest; the fold-opened frame shows both at rest.
783. SPEC honesty gate — marker unchanged at `<!-- spec-check files=68 tests=1893 -->` (no package or test-count change; `test/` stays outside `package.json` `files`). Verification: `tsc --noEmit` clean; `bun test` 1514 pass / 0 fail / 28 snapshots; snapshot diff reviewed cell-by-cell (only affordance cells and the elsewhere header string changed); `bun --preload @opentui/solid/preload scripts/render-card.tsx` and `scripts/render-dialog.tsx --width=100 --height=92` print frames with the affordance painted at rest (the code path is also green under the smoke tests); hover byte-stability is pinned by the render tests (resting frame === frame under the mouse). `bun run check` green before submit.
784. Honest limits: (a) verification is render-layer (headless grid + mock mouse); nobody re-ran the live TUI on a real terminal this pass — the class of bug this fixes (mount-under-mouse) no longer has a single carrier in the claimed surfaces, but the live feel is unverified; (b) `src/tui.tsx`'s three hover sites remain (outside the claim: `src/tui.tsx` is held by the tui-storage-convergence-fallback lease); (c) click-time transient acks (`✓ 6/6 resolve`, `✓ copied` inline on the rail summary's sibling attestation row) were moved into the cell where a cell exists; the sweep-row counts stay inline in the payload by design (they are data, not chrome); (d) the `render-card.tsx` / `render-dialog.tsx` standalone scripts crash without `--preload @opentui/solid/preload` — pre-existing on dev, not introduced here.

## Workstream XII — the ambient pill learns to breathe: a sleeping-cat indicator, not a dashboard (2026-11-18)

Interpretation of this iteration, from the brief's intent: the user should glance at the jump row and feel "it's alive and working, don't worry" — a living system indicator, not a status report. Motion had to be subtle enough to never compete with reading, no faster than ~1 Hz, and carrying meaning through shape and weight, not color. Minimalist over informative: one cell does the whole job; nothing new was added to the text.

785. The state glyph is now a single-cell **breath dot** (`src/core/hud.ts`). The wave is `· • ● •` — an exhale floor, two rises, a crest, then the fall — four faces on a 600ms tick, a **2.4s period (~25 cycles/minute, 0.42 Hz)**. It is a sleeping cat's cadence, deliberately slower than the old 850ms bold-flip, and nowhere near the 1 Hz ceiling. The cell is the only thing on the line that moves; elapsed, turns, pips, suffixes and the pin never repaint with it. The phase walks modulo 4 (`breathGlyph`), the crest is face index 2 (`breathCrest`), and `BREATH_PERIOD_MS` / `BREATH_PHASE_MS` are exported and unit-pinned.
786. **Amplitude scales with how alive, never with how urgent** — the signal hierarchy is unchanged (evaluating > active > waiting > paused > terminal), now expressed as motion amplitude plus the existing tone:
   - **checking (evaluator thinking)** — the full wave; only the crest face carries bold (weight is the amplitude boost on top of glyph amplitude). Tone: info, as before.
   - **active (working)** — the full wave, *never* bold; the word and the swell say "alive", the absence of bold says "not alarmed". Tone: muted, as before (an armed loop is nominal).
   - **hot compaction** (pending ≥2/4) — the full wave with the bold crest, amber tone, as the old amber shimmer refined (it rides the crest now instead of an 850ms flip).
   - **landed acknowledgment** (` · landed ✓` for 3s) and the **just-achieved flash** — ride the crest bold on the breath cadence, as before, just on the slower wave.
   - **waiting** — a static hollow `○`. Nothing is in flight; amplitude zero. The word `waiting` and the hollow circle say the same thing; color (info) never carries it alone.
   - **paused** — a static `‖` (media-key pause bars). The word and the bars say stopped; tone warning, as before.
   - **stuck (≥3 failed turns)** — a static solid `●`, amber. Nothing executes, so nothing breathes; the amber and the `retry N` suffix carry the distress (the remediation order is unchanged: stuck outranks hot, paused outranks stuck).
   - **terminal acknowledgments** (45s ack pill) — static, one glyph per outcome: `●` achieved (success/info ledger grammar, unchanged), `◌` impossible (warning), `✕` failed (error).
   - ASCII arm (NO_COLOR / TERM=dumb): `*` for the whole live family (`*` bold = checking/hot — weight carries what the wave cannot), `o` waiting, `|` paused, `+` achieved, `?` impossible, `x` failed. Every glyph is exactly 1 cell in both arms, so the pill-budget arithmetic is phase-independent and byte-identical between arms at every width tier.
787. **The grammar is one cell and the budget is line-neutral.** ~~The leading caret (open/close) is unchanged;~~ (amended by Workstream XV: the caret itself was removed — it read as a play/run button; the breath dot now begins the line) the breathing dot replaces the old `◎` in what is still a single leading cell; every degradation rung in `pillModel`'s ladder (`retry` → `compact` → `turns` → `pips`) is unchanged; the mount anchor (`top={-1}` absolute box, zero-flow, `session.composer.top`) is unchanged; the jump row is not one cell taller. Text cost is *two cells fewer* than today's pill at every width tier (the caret prefix is gone), and the pill still keeps the `goal` noun, which the fresh-glance legibility bar (a)/(b) argues for. Under reduced motion the dot paints its resting face `•` (no timer is mounted at all — `motionDisabled(NO_COLOR/TERM=dumb)` short-circuits `createEffect`), and the reduced-color arm drops every chromatic accent (unchanged contract: mono paints muted; weight + glyph carry meaning).
788. **What the resting frame looks like, and why the animation cannot annoy.** Resting ≈ phase 1 (`• goal active · …`) — the exact frame the reduced-motion arm paints always, and the face a quiet goal fades into when the transients disarm (`setBreathPhase(0)` disarms only into static glyphs: `○`/`‖`/`●`). The animation is *continuous, symmetric and center-drawn*: the dot starts at mid-weight, swells out and eases back over 2.4s with no edge, no strobe, no ease-in spike; the crest is 25% of the cycle and each phase is a neighbor of its predecessors; there is nothing to "catch", so the eye slides off it the way it slides off a candle flame. It competes with reading exactly zero times per cycle, by construction — the information channel and the vitality channel are the same cell, and the vitality channel only modulates weight, never hue or position. Alerting stays where it belonged: amber/red tones and exact remediation lines, which never animate.
789. `pillMotionNeeded` gained a `working` arm (live, `active`, not `waiting`, not stuck) alongside the existing `evaluating`/`hot`/`flashing`/`landing` arms — a live working goal breathes always, a blocked or stopped one never does. `tui.tsx` mounts the timer only while `pillMotionNeeded(...) && motionOk` (600ms interval, phase-walk, same `createEffect`/`onCleanup` discipline as before); under reduced motion no interval exists at all. `pillAttrs` paints bold on the crest only for the transients (`evaluating`/`hot`/`flashing`/`landing`); plain working never bolds. Reduced motion pins weight permanently onto `evaluating`/`hot` — the mono arm keeps its weight channel even with the wave frozen.
790. Tests — `test/tui-hud.test.tsx` re-pinned in place plus one new describe block (`the breath`): period/phase/wave unit pins, one-cell-in-both-arms pin, the one-cell drift contract across all four phases, the static-distinct-glyph contract (`○`/`‖`/`●` paint in *every* phase), the resting-face frame, and the ASCII demotions. `pillMotionNeeded` re-pinned: working drives, waiting/paused/stuck do not. `test/render-scripts.test.ts` (+2) smoke-pins the new `scripts/render-pill.tsx` — exit 0, the one-cell frame diff, and the `--mono` demotion. Snapshots: none carry the pill (it lives in the slot wiring, not a snapshot-tested component); the card/dialog state rows are untouched (word + existing weight, unchanged).
791. SPEC honesty gate — the enforced marker (first occurrence) and this workstream's trailing marker are now `spec-check files=62 tests=1526` (`scripts/render-pill.tsx` is not in `package.json` `files`). `bun run check` green before submit.
792. Honest limits: (a) verified at the headless-render layer and the unit layer, not on a live terminal — the weight axis (bold crest) is pinned by unit tests (`breathCrest`) and the mono arm by smoke tests, because `captureCharFrame` carries characters, not attributes; the one-cell glyph drift is pinned by both. (b) The full-frame `◎` → per-state-glyph swap in `pillModel` repaints the leading cell for every live state — including loops, whose `◉`-prefixed rail grammar is untouched. (c) No live smoke run on a real terminal this pass; the one behavioral risk is that 600ms ambient repaints could, on very slow hosts, cost a frame's worth of work per tick — the interval is armed only while the loop is alive and drops out entirely under reduced motion, same as before. (d) The `goal` noun was kept (criterion: legibility for a fresh glance); the cell budget stays equal to today's pill, not fewer.

<!-- spec-check files=68 tests=1893 -->

## Workstream XIV — the actions row hangs flush: one grid for the whole card (2026-11-17)

Interpretation of this iteration, from the brief's intent: every row of the HUD card snapped to a single one-column grid — title glyph, labels, wrapped remediation and the context/cost values all start on the same left cell; the condition/why affordance cells and the outer edge of the actions row end on the same right cell — except the actions row, whose buttons carried a 1-cell inset on each outer side, so `[details]` opened one cell right of the grid and `[esc]` closed one cell short of the right edge the affordance cells end on. To a user's eye the whole actions row sagged below the card's otherwise rigid grid.

793. `HudButton` gained `flushLeft` / `flushRight` props (`src/hud-card.tsx`): zero outer padding on that side. The actions row paints `details` with `flushLeft` and `esc` with `flushRight`; the middle buttons keep their 1-cell side padding unchanged. Hover grammar, the raised-background hit target, the mono weight contract and the 1-row height are all untouched — only the outermost single cell of padding retired on each end of the row.
794. Result: `[details]`'s leading bracket starts exactly on the content column every label, the title glyph and the wrapped remediation snap to, and `[esc]`'s trailing bracket ends exactly on the right edge the condition and why affordance cells end on. Nothing else moved: `conditionWidth`/`spendWidth`/`remediationWidth`/`cardWidth` unchanged, the mount anchor (`top={-cardRows()}`) unchanged, the row plan unchanged, the hover affordance cells unchanged.
795. Snapshots regenerated — the nine actions-row frames change by exactly one cell at each outer edge, nothing else in any frame. Suite identical: `bun test` 1526 pass / 0 fail / 28 snapshots; `tsc --noEmit` clean.
796. Verification: `bun --preload @opentui/solid/preload scripts/render-card.tsx` — every frame paints the actions row flush (evidence: `│  [details]   [pin]   [clear goal] ... [esc]` with `[details` starting at the same cell as the labels above it and `[esc]`'s trailing bracket on the shared right edge). Headless-render layer only — no live smoke on a real terminal this pass; the existing click-through tests (`[details]` / `[esc]` fire their callbacks) still pass against the new frame.
797. Honest limits: (a) verified at the headless-grid layer and the unit layer, not on a live terminal. (b) The bulk of this goal's visual work landed in Workstream XII (the breathing dot) and is in the same render path; this pass only removes the one-cell sag in the actions row, nothing else about the card's tone, spacing or affordance grammar was touched. (c) The host owns the seam between the card and the prompt (the hanging bar's color flip) and the jump-row geometry; neither is in this lease's reach.
## Workstream XV — the pill drops the play icon: the dot is the whole mark, no longer a button-shaped affordance (2026-11-18)

Interpretation of this iteration, from the user's live screenshot of the breathing pill (`▸ · loop · v1/5 ○○○○○ · checking · 20m`): "it is good. remove that the play icon look. ▸". The breathing dot and the state legibility all survived review; the one offending element was the leading `▸` open/close caret inherited from the pre-breath pill, which reads as a media "play" run button — precisely the wrong connotation for a calm, sleeping-cat presence indicator.

798. `src/tui.tsx` — the caret prefix is removed from the pill line. The leading breath dot now begins the line (`· loop · v1/5 …`). The click contract is untouched and undocumented-by-chrome: left click still toggles the HUD card, right click still opens the detail view (both were always also available from the card's `details` button and `/goal` itself). The `session.composer.top` mount anchor, the padding budget, and the 1-cell left/right margin are unchanged; the label budget tightens from width−4 to width−2 (the two caret cells are reclaimed), so the degradation ladder now truncates two cells later at every width tier. `pillText()` composes `model.text` directly; the pinned-condition suffix still rides the same prefix length, so the pin budget math is consistent.
799. `src/core/hud.ts` — `pillCaret` is deleted (its only consumer was the pill). `test/tui-hud.test.tsx` loses the `pillCaret` import and its two tests; `test/pill-timer.test.tsx` drops the hand-mirrored `▸ ` from its `pillLine` helper so the test-local composition matches the live one again; `scripts/render-pill.tsx` (and its smoke test in `test/render-scripts.test.ts`) render without the caret and pin the one-cell drift at cells 0–1 / 2+. Snapshots are untouched (the pill lives in the slot wiring, not a snapshot-tested component); the HUD card's own action row is out of this workstream's scope — the parallel lease (`tui-indication-alignment`) merged as dev's Workstream XIV (the flush actions row) ahead of this commit; this workstream deliberately did not touch `src/hud-card.tsx` or `test/__snapshots__/`.
800. SPEC honesty gate — the enforced marker (first occurrence) is now `spec-check files=62 tests=1524` (two `pillCaret` tests removed; no packaging change; `scripts/`, `test/` stay outside `package.json` `files`). Workstream XII's in-body figure stays `tests=1526` as its recorded at-the-time state; the X↔XI boundary marker is restored to `tests=1514` for the same reason. `bun run check` green before submit.
801. Honest limits: (a) the affordance loss is real but deliberate — a fresh user loses the caret's "click me" hint on the pill; the card's `details` button, the right-click dashboard, and `/goal` remain discoverable doors, and the hover bold (weight under the pill's existing hover grammar) still answers the pointer before a click; (b) verified at the unit and headless-render layer, not on a live terminal; (c) overlap with the parallel lease resolved cleanly: the other session's `src/hud-card.tsx` flush-alignment landed as dev's Workstream XIV before this commit; the files rebased on top of it, and neither its accents nor its snapshots are touched here.

<!-- spec-check files=68 tests=1893 -->

## Workstream XVI — the breath swells through the bullseye family: `◦ ○ ◎ ○` (2026-11-18)

Direct follow-up to XV (same user, same screenshot session): "we already have that icon of this used: ◎ just use the similar indicator of this with different sized for that alive indicating." The ◎ bullseye was already the dialog's `GOAL_GLYPH`, so the pill's wave was re-cut from the dot family onto the concentric-ring family the user asked for.

802. `src/core/hud.ts` — `BREATH_WAVE` is now `["\u25E6", "\u25CB", "\u25CE", "\u25CB"]` (`◦ ○ ◎ ○`): phase 0 the tiny hollow floor, phases 1 and 3 the mid ring, phase 2 the ◎ bullseye crest. `BREATH_REST` is now `○` (the mid ring — the same parity the old design had between resting `•` and the mid `•` phases). `breathCrest` is unchanged (phase 2 — the bolded ◎ is, by construction, the bullseye the user asked for). Every wave glyph measures 1 cell under `string-width`. `stateGlyph`'s `waiting` face moves from `○` to `◯` (U+25EF, large empty ring) — mandatory disjointification: waiting could not stay `○` once ○ joined the wave, and ○ remains the resting face. All other states are untouched: stuck-retry `●`, paused `‖`, the terminal acknowledgments (`●`/`◌`/`✕`), and the mono demotion (`*` wave, `o` waiting, `|` paused, `?`/`x` acks) — the NO_COLOR contract is byte-identical to XV.
803. Tests — the pinned wave in `test/tui-hud.test.tsx` now expects `◦ ○ ◎ ○`; the resting frame expects `○`; the stuck-vs-wave, paused and distinct faces tests are unchanged because those families did not move; one test was ADDED (`the waiting hollow ring (◯) is distinct from every breath face and the resting face`) pinning the disjointness contract that motivates the waiting change, so `bun test` = **1525 pass** / 0 fail / 28 snapshots. Headless renders (`scripts/render-pill.tsx`, unicode + `--mono`, 80/150 cols) show only the ring cell drifting across phases; mono output is unchanged from XV.
804. SPEC honesty gate — enforced marker (first occurrence) is now `<!-- spec-check files=68 tests=1893 -->`. Workstream XV's trailing marker stays `tests=1524` as its recorded at-the-time state. `bun run check` green before submit.
805. Honest limits: (a) verification is unit + headless render — not on a live terminal; (b) `◦ ○ ◎ ○ ◯` are East-Asian-ambiguous-width glyphs, exactly the class the previous dot family already carried (`• ●`); western terminals and `string-width` measure them as 1 cell, CJK-wide locales may paint them wider — same caveat as before, unchanged by this workstream; (c) amplitude/cadence did not move (2.4s period, phase 2 the only bold-gated phase — still ~0.42 Hz effective motion, no new frames, no new timers); (d) waiting users who were used to hollow `○` now see the larger `◯` — the grammar version is recorded here, the mono arm never changed.

<!-- spec-check files=68 tests=1893 -->

## Workstream XVII — the pill yields to the open card: one voice on the row above the prompt (2026-11-18)

Armed condition of this loop iteration: "Make the ambient pill and the HUD card paint coherently when both mount through `session.composer.top`: a headless render/test shows the pill never painted behind the open card (suppressed or visible above it), `bun run check` green, merged to `dev`." Reading the current HEAD before touching anything: both layers painted through the one slot, the pill at `top={-1}` on the exact 1-cell row the opaque, `zIndex={10}` card also covers (the card's `top={-cardRows()}` + `cardRows()` of height includes the pill's row). The screenshot that armed this loop already showed the symptom as an empty strip above the prompt — the pill was painted there and lost to the card every frame it was mounted: laid out, hit-testable, breath-timed, never visible.

806. Interpretation: the design coalesces to one voice per row — the pill when the card is closed, the card when it is open. Suppression (never painted) was chosen over painting the pill above the card: the card already speaks the pill's every datum (state, iteration, pips, turns, elapsed) at a richer level, and a second copy on an adjacent row is noise, not coherence; "visible above it" would also have collided with the transcript the card is already hanging over by design.
807. `src/tui.tsx` — the pill's absolute box is now wrapped in `<Show when={!cardFor()}>`: while the card is open the pill is not mounted at all. The breath effect is gated identically (`if (animated() && !cardFor() && motionOk)`): a timer advancing phases for a painter that does not exist is pure wake-up work, so the interval is never mounted either. Nothing else moved — the card's mount, probe, anchor, row plan, zIndex and opacity are unchanged; the pill's own budget math, tones and hover grammar are unchanged for the closed-card case.
808. `scripts/render-slot.tsx` (new, not shipped — `scripts/` is outside `package.json` `files`) — headless mount of the gated composition through one slot: the real `HudCard` and the real `pillModel` line, same anchors and gate as the TUI. Prints two frames and two machine-checkable verdict lines: `pill-in-open-card-frame=no` (the pill line appears nowhere in the card-open frame; the card's `[details]` affordance is present) and `pill-in-closed-card-frame=yes` (closing the card restores the pill line; no affordance row).
809. `test/tui-pill-card-coherence.test.tsx` (new) — four tests: (a) source contract: the pill's `top={-1}` box sits inside `<Show when={!cardFor()}>` in `src/tui.tsx`; (b) source contract: the breath timer is gated on `!cardFor()`; (c) headless render: with the card open the pill text is absent from the frame and the card's affordance row is present; (d) with the card closed the pill text paints and the card's affordance row is absent. `test/render-scripts.test.ts` gains one smoke test (render-slot.tsx exits 0, both headers, both verdict lines, 30s budget).
810. Test count moves 1525 → **1530 pass** / 0 fail / 28 snapshots (`bun test` from `test/`); `tsc --noEmit` clean. SPEC honesty gate — enforced marker (first occurrence) is now `<!-- spec-check files=68 tests=1893 -->`; the Workstream XVI trailing marker stays `tests=1525` as its recorded at-the-time state. `scripts/` and `test/` stay outside `package.json` `files`, so the packed-file count is unchanged at 62.
811. Honest limits: (a) verified at the unit and headless-render layer — not on a live terminal; the empty strip above the prompt while the card is open is now by construction rather than by occlusion, and the jump-to-latest geometry remains the host's to reclaim if it ever grows a voice of its own. (b) While the card is open, hover/click affordances on the pill row are simply absent — that is the suppression working, not a dead zone (the card carries its own `details`/`pin`/`clear goal`/`esc` hit targets). (c) The breath phase persists in state across the card boundary (it is only the timer that is gated), so the pill re-appears mid-cycle when the card closes rather than re-entering at phase 0; under reduced motion nothing changed at all. (d) No snapshot frames reference the pill (it lives in the slot wiring, not a snapshot-tested component), so the snapshot file is untouched.

<!-- spec-check files=68 tests=1893 -->

## Workstream XVIII — headless alignment invariants for the card and the pill: one grid, measured cell by cell (2026-11-18)

Armed condition of this loop iteration: "Add a headless alignment-invariant suite for the /goal card and pill: at 52/64/80/88/112 columns and under mono, every painted card row shares one left content column and one right affordance edge, with tests committed and merged to dev." Reading the current HEAD before touching anything: the card paints a two-stop grid (the LABEL column at cell 3 — labels, title glyph, the flushed `[details]` button, the menu's first-row gutter — and the value column at cell 14, where every labelled row's value and the menu's continuation text sit), with the hanging bar owning cell 0 and the right content edge at width − 3 (border 1 + paddingRight 2); the actions row's flushRight `[esc]` lands exactly there (XIV), and the condition/why affordance cells sit flush against it. Nothing pinned any of that; a refactor could move any edge silently and the snapshot suite would only notice incidentally.

812. Interpretation: pin the grid the card already paints as headless invariants, at the five widths the layout promises to serve — 52 (the `CARD_WIDTH_MIN` clamp floor), 64, 80, 88 (the `CARD_WIDTH_MAX` design ceiling), and 112 (the wide case the live measured-mount can legitimately paint — `tui.tsx` passes the measured mount width, bypassing `cardWidth`, so a 112-cell card is production, not a hypothetical) — in both the color and the mono (reduced-color) arm, plus the terminal-resolved `cardWidth` path (112-column terminal → 88-cell card). The pill is pinned through the same one-row absolute mount the composer uses (`paddingLeft={1}`, `left={0}`).
813. `test/tui-alignment-invariants.test.tsx` (new, not shipped — `test/` is outside `package.json` `files`) — analyzes the captured frames cell by cell (grapheme walk + `string-width`; wide glyphs own cells, code units are not cells, so all column math and substring lookup are cell-accurate). Per painted row: (a) cell 0 carries the hanging bar; (b) the first content ink snaps to the LABEL column (3) — or, when the row's gutter is deliberately blank (the context menu's continuation rows), to the value column (14) with cells 3..12 verified blank; nothing is allowed to land between the stops; (c) no painted cell crosses the right content edge (width − 3); (d) one right affordance edge, shared across rows: the condition and why rows carry an 8-cell affordance cell flush to the edge with the 4-cell `copy` verb painted left (verb ink starts at width − 10), and the actions row's flushRight `[esc]` ends exactly at width − 3.
814. Coverage: card arms at each of the five widths — resting and context-menu-open, color and mono (20 tests) — plus two arms for the terminal-resolved `cardWidth` path; pill arms at the same widths and modes for both the working pill and the terminal acknowledgment (`pillModel` / `terminalPill` with `budget = width − 2`, exactly the live mount's arithmetic), asserting the model's width contract AND the mounted frame (cell 0 blank, first ink at cell 1, no ink past cell width − 2) — 20 tests; 62 new tests in total.
815. Negative control, run before submit: two deliberate one-line regressions were introduced in the worktree to prove the suite bites, then reverted — `HudButton` `flushLeft` dropped (first content ink moves to cell 4) produced 22 failures; `hud-card.tsx` `flushRight` dropped (`[esc]` ends one cell inside the edge) produced 10 failures. The committed diff touches no `src/` file; every test passes at rest.
816. Test count moves 1530 → **1592 pass** / 0 fail / 28 snapshots (`bun test` from `test/`); `tsc --noEmit` clean. SPEC honesty gate — enforced marker (first occurrence) is now `<!-- spec-check files=68 tests=1893 -->`; the Workstream XVII trailing marker stays `tests=1530` as its recorded at-the-time state. `scripts/` and `test/` stay outside `package.json` `files`, so the packed-file count is unchanged at 62.
817. Honest limits: (a) verified at the headless-render and unit layers — not on a live terminal. (b) The affordance-edge invariant reads the resting frame; the hover/ack payloads (`✓ copied` family) are pinned indirectly through the cell's fixed 8-cell width and `flushRight`, not by measuring a hovered frame. (c) The menu's blank-gutter continuation rows snapping to the value column is the design's gutter grammar, encoded as such — not an exception carved out of the grid. (d) No snapshot references changed (no framed component is modified), so the snapshot file is untouched.

<!-- spec-check files=68 tests=1893 -->

## Workstream XIX — the live layer, end to end: arm → work → evaluate → achieve, on the real binary (2026-11-18)

Named risk of this loop iteration, priority 1 per the brief: the one layer Workstreams XIV–XVIII never touched — a real terminal running the real v2 binary with the plugin mounted from this tree. Everything the plugin does to a user mid-goal lives at that layer: the `/goal` command, the durable record, the pill, the failure path, the evaluator, the toast. This workstream retires "verified only headlessly" by running it live and recording the evidence. Verification harness: the opencode headless driver (`headless_start` mode `pty` — the real TUI in a ghostty-parsed pseudo-terminal), per the iteration's "for testing use opencode.headless" instruction, with a scratch `XDG_CONFIG_HOME`/`XDG_DATA_HOME` under `/tmp/opencode/live-smoke/` and a throwaway git repo as cwd. No tmux, no host binary changes; the binary under test is the installed `opencode v2.3.2` mounting this repo's plugin by absolute path.

818. Procedure: (1) scratch config mounts `/home/pauk/Projects/opencode-v2-goal/opencode-goalv2` in `plugins` (same shape as the user's real mount) and declares the `9router-go` OpenAI-compatible provider with KiloCode-Free (`tool_call`, 200k context) as the session model — "for the provider use: kilocode free it will work". (2) `opencode --standalone` boots in the headless PTY; the plugin loads (`loading plugin id=…/opencode-goalv2 entrypoint=…/index.ts` in the log; zero plugin load errors). (3) `/goal Create a file DONE.txt containing exactly ok and commit it to main` is typed into the composer.

819. What ran, observed in the captured frames and the scratch log: the goal armed (`◎ Goal set` toast; the fuzzy-work directive and commit rule in the transcript); the model executed (`I'll create the file, verify it, and commit it to main.` → `+command, 1 edit` → `DONE.txt` → `Commit: 751562ff69993e2847b244dfac38b082368a32b9 on main` → `git status --short` empty); the commit is real — `751562f Add DONE.txt` on `main` in the throwaway repo, `DONE.txt` = exactly `ok` (verified from the shell after teardown); the evaluator judged the transcript and ruled met on fresh evidence (`verified: …od shows 2 bytes, no newline…Commit: 751562f…on main…git status empty`); the toast showed `◎ Goal achieved in 1 turn — 1 turn · 16s`; the pill painted through the whole cycle — `◦ goal active · <1m` → `○ goal checking · <1m` (evaluating) → `● goal achieved · <1m · 1 turn` (terminal acknowledgment). The durable record confirms it: `status: "achieved"`, `verdict: "met"`, `turns: 1`, `retries: 0`, `failureLabel` absent.

820. The fatal provider-error path, verified live on the same setup before the provider was switched on: on a console-signed-out machine the default free models fail the session with `AI.Error.Authentication: Reconnect OpenCode Console to continue.` — twice (once via tmux screenscrape, once via the headless PTY), and both times the plugin classified it and failed the goal honestly instead of wedging: the captured frames show `◎ Goal failed / 0 turns · 1s / Goal failed after an unrecoverable error: authentication failure. Run /goal again to continue.`, the pill stayed up, and the durable records read `status: "failed"`, `failureLabel: "authentication failure"`, `turns: 0` — the `handleFailure(fatal)` signature, end to end, on the real binary (not a unit test of the classifier).

821. Restore-on-restart, verified live for terminal records: after the two failed-run records were on disk, a fresh instance on the same scratch dirs booted clean — no pill painted, no error dialog, plugin loaded, no `restored goals` line in the log, nothing adopted (both records terminal; `restore()` must not adopt them). The live-adopt half of restore (an active/paused record is taken into memory with reset counters) is pinned by unit tests (`test/controller.test.ts` restore arms) and could not be reproduced live on this machine: with no working console session the provider call fails fatally within ~1.1s, so no goal ever rests durable as `active`; planting a synthetic record would not be a real path and was not done.

822. SPEC honesty gate — the enforced marker is unchanged at `<!-- spec-check files=68 tests=1893 -->` (no package or test-count change; this workstream adds documentation only). `bun run check` green before submit. Scratch dirs under `/tmp/opencode/live-smoke/` were wiped after capture, including the runtime-copied provider config; no key material remains on disk and none enters the repo.
823. Honest limits: (a) verified live on `opencode v2.3.2` with KiloCode-Free; the success path exercises the single-judge session evaluator (`evaluator.mode: session`) — the independent and consensus paths remain unit-tested only, as does everything in `src/core/config.ts` that defaults off. (b) The pill's click-to-card path was not exercised (mouse injection into the headless PTY is not part of this pass); the card itself remains verified at the headless-grid layer (XIV, XVIII). (c) The goal achieved in one turn with a concrete condition; a fuzzy goal's SPEC-first gate was armed but not adjudicated live. (d) The one aesthetic artifact observed live: while the evaluator runs, the pill reads `goal checking · <1m` — by design (`evaluating`), unchanged here. (e) The commit the model made (`751562f`) lives in the throwaway repo and is gone with it; nothing of it belongs to this repository.

<!-- spec-check files=68 tests=1893 -->

## Workstream XX — live crash-restore: SIGKILL mid-turn, fresh host adopts the durable active record (2026-11-18)

Named risk of this loop iteration, from the brief's priority 1, closing the half iteration 1 (Workstream XIX) explicitly could not: the live-adopt half of restore. XIX showed terminal records are not adopted on a fresh boot; it could not produce a durable `active` record at a crash boundary. This workstream does, on the real binary. Verification harness: the opencode headless PTY (`headless_start` mode `pty`), scratch `XDG_CONFIG_HOME`/`XDG_DATA_HOME` under `/tmp/opencode/live-smoke/`, throwaway git repo (`main`, `init`), session model KiloCode-Free, plugin mounted from this tree — same discipline as XIX. No tmux; the binary under test is the installed `opencode v2.3.2`.

824. Method: (1) in instance A (`crash-restore-1`, scratch state, `OPENCODE_GOAL_MAX_TURNS=6`), typed `/goal Append the numbers 1 through 30 to a file count.txt, one number per line, using one separate tool call per append, verifying the file with a separate read after every append, then commit the file to main with message count. Do not batch.` — a deliberately multi-turn condition. (2) Waited for the `◎ Goal set` toast; read the durable record through the scratch sqlite kv table (`plugin:opencode-goal:goal/v1/ses_e12e7117effef16DB98obsVzL5`): `status: "active"`, `turns: 0`, `startedAt: 1794979196591`, `baseline` all-zero, `history: []`. (3) **SIGKILL** (`kill -9 172699`) mid-turn with the model still working (`1 command, 2 thoughts` shown as `interrupted` afterwards; `count.txt` never created; repo untouched — the kill landed before the first append). (4) Four successive fresh hosts booted on the same scratch state (`crash-restore-2/3/4/5`), plus a fifth routed onto the crashed session via `OPENCODE_ROUTE={"type":"session","sessionID":"ses_e12e7117…"}` (`crash-restore-6`). Note on harness constraint: the host always boots a *fresh* session; the only route back to the crashed session is the host's own route mechanism, discovered at the binary's env surface, used here once the fresh-boot framing proved the pill is session-scoped.

825. Evidence, all from fresh commands this pass: (i) **sqlite** — after five reboots the record is byte-identical: `status: "active"`, `turns: 0`, `endedAt` absent, `verdict: null`, `history: []`; `session_message` stays at 3 rows and `session_part` at 0 across every reboot, so no turn was evaluated and no provider call was made; the scratch repo's `git status` is clean and `count.txt` does not exist; the opencode log for every reboot shows only host watcher/reconciliation traffic and the incidental `OpencodeConsole.SignedOut` warning — no `AI.Error`, no `evaluator` activity, no assistant generation. (ii) **Adoption, visible in the real terminal** — in `crash-restore-6` the TUI booted onto the crashed session and the pill painted: `◦ goal active · 16m` (elapsed counted from the original `startedAt`, i.e. restore kept the arm time, matching `restore()`'s documented "kept so the elapsed timer tracks from first arm across restores"), above the `interrupted` turn state and the armed `<goal>` directive in the transcript (session title "Sequential appends to count.txt"). This is the live-adopt path, not a unit test: the fresh host process had zero in-memory state, so what the pill painted came only from storage through `restore()` → `loadLive()` → `adoptRestored()` → `GoalRpc.get`. (iii) **No evaluator, no provider, no writes** — adoption is deliberately in-memory (`adoptRestored()` does not commit; a write on the adopt path is what would corrupt records of other processes), and the record confirms nothing was written back.

826. What could not be evidenced live, and why, honestly: (a) the **`restored goals` log line** (`controller.ts` `restore()` → `deps.log.info("restored goals", { count })`) reaches no observable sink on this host. The plugin's logger is raw `console.info/warn/error` (`createLogger()` in `src/index.ts`); the standalone in-process host swallows it — across all five reboots, zero `[opencode-goal]` lines appear in `opencode.log`, the scratch filesystem, or the PTY grid (also true under `OPENCODE_PRINT_LOGS=1` and `OPENCODE_LOG_LEVEL=all`). The plugin SDK context exposes no log API (`session.log` is a read-only tail/follow of the host's session log; `ctx.app` is name/version/channel only). Named consequence: **restore is silent in production — an operator whose goal silently fails to adopt has no log anywhere to look at.** Documented, not fixed here: routing plugin logs into a host sink is a new feature with its own design choices (which sink, what format, whether to add a file fallback) and is not what this iteration's armed condition allowed; candidate for a future iteration. (b) The **fresh-boot pill** is invisible by design — the pill is session-scoped (`composer.top` slot renders `live(props.sessionID)`), and a fresh headless boot never lands on the armed session; the pill frame exists only boots that route back onto it (`OPENCODE_ROUTE`), which is exactly what (ii) did. (c) The record was adopted but never resumed — resuming an interrupted turn is the user's call (send any prompt / re-open the session); the restore path deliberately does not re-enter the turn. (d) `count.txt`, the commit, and the evaluator's judgment of the condition remain unproven live for the crash path.

827. SPEC honesty gate — the enforced marker is unchanged at `<!-- spec-check files=68 tests=1893 -->` (documentation only; no package or test-count change). `bun run check` green before submit. Scratch dirs under `/tmp/opencode/live-smoke/` and the wrapper experiment were removed after capture (the wrapper was never exec'd — the harness spawns `/home/pauk/.opencode/bin/opencode --standalone <cwd>` by absolute path, ignoring `PATH`, confirmed via `/proc` on the live pid — so no wrapper file remains relevant; the runtime-copied provider config with the gateway key was deleted with the scratch dir; no key material remains on disk and none enters the repo).
828. Honest limits, restated: (a) verified live on `opencode v2.3.2` + KiloCode-Free + the session evaluator only; the independent and consensus evaluator paths remain unit-tested only. (b) The crash snapshot is real — SIGKILL (not SIGTERM) at an arbitrary mid-turn point — but only one crash point was captured; a kill between `active`-write phases deeper into the turn loop may exercise different code paths (none exist — the record is written once at arm and at verdicts; the turn in flight had performed no tool-based writes). (c) The `OPENCODE_ROUTE={"type":"session",…}` boot demonstrates the host's own route mechanism; interactive session switching with the standard keybinds was not part of this pass. (d) The restore *resume* semantics (what happens after the user re-prompts in the restored session) were not exercised: re-prompting would spend provider tokens on the scratch goal; the record, pill, and transcript state are the stopping point. (e) Nothing of this run belongs to this repository; the throwaway repo is deleted.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXI — the accordion pill: the pill and the card are one surface (2026-11-18)

User request, from two screenshots attached to the brief: (1) the black-stripe pill row — `◎ loop · v2/5 ●○○○○ · active · 20m` — sitting on the left of the host's `Jump to latest ↓` row, and (2) the open card hanging above the prompt, with its condition / now / spend / last rows and the `[details]` `[pin]` `[clear goal]` `esc` affordance row. The ask: the pill and the card behave as ONE surface with accordion semantics — the pill stays on the jump row always; clicking it expands the detail panel upward (an expandable panel anchored above the pill); clicking again collapses it. Until this workstream the mount suppressed the pill while the card was open (Workstream XVII's `<Show when={!cardFor()}>` gate): one voice on the row, the card or the pill, never both. This workstream replaces that swap with the accordion.

829. Interpretation: the design had already decided — implement it, no redesign. The pill is the persistent stripe (the panel's bottom seam while open); the card is the expanding panel.
830. `src/tui.tsx` — the pill mount is no longer gated on the card being closed: the `<Show when={!cardFor()}>` wrapper around the pill's `top={-1}` absolute box is gone. The pill paints whenever `showing()` paints (a live goal, or the 45 s terminal acknowledgment). A trailing caret CELL was added after the pill text inside the pill box: `<text fg={context.theme.text.faint} wrapMode="none" flexShrink={0}>{cardFor() ? " ▾" : " ▴"}</text>` — ▴ collapsed (content hidden above), ▾ open (click again to collapse). The caret rides the existing `<Show when={showing()}>`, so it never paints when the pill does not. `pillText()`/`pillModel()` are untouched — the caret is a separate cell, not part of the pill model.
831. Geometry — the pill's text budget subtracts the caret: `Math.max(8, mountWidthOr() - 2 - (landingNow() ? stringWidth(landingSfx()) : 0) - 2)` (the floor moved from 1 to 8 so the core degradation ladder always keeps room; the `-2` is the caret cell). The body panel mounts at `top={-(1 + cardRows())}` (was `top={-cardRows()}`), same `height={cardRows()}`; `cardRows()` now plans under `maxBodyRows() = Math.max(8, maxCardRows() - 1)` (the viewport ceiling `Math.max(8, dimensions().height - 2)` minus the pill stripe's row), so the total footprint (pill row + body) never exceeds the old single-budget ceiling. The painted `HudCard` receives the same `maxRows={maxBodyRows()}` so the anchor and the painted rows still plan identically. The mount-width probe box logic, the zIndex=10 opaque body, and the `createEffect(() => { if (!cardFor()) setMountWidth(undefined) })` disarm path are untouched.
832. Breath timer — the gate changed from `if (animated() && !cardFor() && motionOk)` to `if (animated() && motionOk)`: the pill is always painted while `showing()`, so the breath advances whenever the loop is alive, open or closed (previously the timer mounted only while the card was closed).
833. `test/tui-pill-card-coherence.test.tsx` — re-pinned to the accordion contract, coverage increased (4 → 6 tests). Source contract: (a) the pill mount is NOT gated on the card — no `<Show when={!cardFor()}>` within 400 chars before the pill's `top={-1}`; (b) the body anchors at `top={-(1 + cardRows())}`; (c) the breath gate is `if (animated() && motionOk)` and no longer references `cardFor()`; (d) the caret cell exists (`" ▴"` and `" ▾"`). Headless block (real `HudCard`, real `pillModel`): the composition mounts BOTH the body (absolute, `top={0}`, `height={cardRows}`, zIndex 10) and the pill below it at `top={cardRows}` (the real pill cell plus the caret, mirroring the source); the column is `cardRows + 1` rows as before. Assertions: with the card open the pill line IS in the frame, the `[details]` affordance row IS in the frame, the pill row index is strictly greater than the actions row index and equal to the last row of the column; with the card closed the pill paints and `[details]` is absent.
834. `test/tui-hud-width-measure.test.tsx` — one pinned literal re-pointed: `hudCardRows(g, contextOpen(), maxCardRows(), mountWidthOr())` → `maxBodyRows()`, with the comment updated. This is a strength-preserving re-pin (same assertions, same purpose — the anchor reads `mountWidthOr()`, not the terminal width; the plan's `maxRows` identifier is what the accordion changed); no assertion was weakened or removed. No other tests touched; no snapshot files touched.
835. Closed-state pill text is byte-identical to before this workstream except for two cells: the caret (` ▴`) and the budget floor (the text model's budget shrank by the caret's 2 cells, so an 80-column row still never clips the state the pill exists to show). `src/hud-card.tsx` logic untouched — the HudCard's painted rows are byte-identical (its only input change is the `maxRows` prop, which drops a teaching row only at the viewport ceiling).
836. SPEC honesty gate — the enforced marker (first occurrence) is now `<!-- spec-check files=68 tests=1893 -->` (1592 → 1594: the coherence suite grew by two tests; `scripts/` and `test/` stay outside `package.json` `files`, so the packed-file count is unchanged at 62). `bun run check` green before submit.
837. Honest limits, restated: (a) verified at the headless-render and unit layers only — NOT live-verified on a terminal this pass; the click-to-toggle accordion, the caret glyph, and the exact jump-row composition remain unverified against a real host. (b) The row claim for `Jump to latest ↓` remains the host's: the pill and the panel claim rows above the prompt by the composer slot's existing negative-anchor grammar; if the host reclaims or repaints that row, the geometry inherits it. (c) The caret widens the painted pill by 2 cells whenever the pill is shown (closed or open); the pill text budget shrank accordingly, but no headless frame was captured of the live composer slot this pass. (d) The HudCard's `maxRows` prop now reads `maxBodyRows()` so the anchor and the painted plan agree under the taller footprint; at terminals far from the ceiling this changes nothing painted.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXII — the live layer, second half: independent and consensus evaluator modes against a real gateway (2026-11-18)

Named risk of this loop iteration, priority 1 per the brief: the one evaluator path no workstream ever exercised live. `evaluator.mode: "independent"` (a separate model judges a transcript digest instead of the session's own model) and `evaluator.consensus: 2` (a `met` from one judge is not accepted until the other also rules `met`; fail closed otherwise) were unit-tested only — Workstream XIX verified the session judge live; Workstreams XX/XXI did not touch the evaluator. Both were live-verified on dev HEAD via the opencode headless PTY in scratch, judge = `9router-go/KiloCode-Free`, session worker = KiloCode-Free routed through the same gateway (see 838 for the harness reality that required this).

838. Harness reality, recorded because it silently shaped XIX/XX and determines whether any of this runs at all: the headless PTY harness injects `OPENCODE_CONFIG_CONTENT={"model":"opencode/inkling-2-small-free"}` into every child (observed in `/proc/<pid>/environ`; a user-supplied `OPENCODE_CONFIG_CONTENT` in the child's env loses to it, and the child's scratch `model` loses to it too). The `opencode` built-in provider resolves to the OpenCode Console gateway, which on this machine is not authenticated today — the first child (`live-consensus-a2`, scratch otherwise correctly wired) died in ~1.6s: `AI.Error.Authentication: Reconnect OpenCode Console to continue.`, `0 turns`, goal failed fatally, frame captured; its durable record existed only in that host's scratch `data/` and was wiped with the scratch dir on the config rewrite, so the frame is all that survives of that run. Resolution, without touching any plugin code: the scratch config gains a plural `providers` entry keyed `opencode` (`package: @opencode/ai/providers/openai-compatible`, `settings.baseURL` = the local 9router-go gateway, `settings.apiKey` copied at runtime from the user's real config, never printed, deleted with the scratch) whose `models` entry maps `inkling-2-small-free` to `"modelID": "KiloCode-Free"` — the `modelID` alias is the documented override for the ID sent upstream, so the harness-forced model name keeps the work flowing on the working gateway. Footer confirmed: `Build · KiloCode-Free via 9router shim`. The judge paths were unaffected throughout: they come from the plugin's own `plugins[].options.evaluator` (`9router-go/KiloCode-Free` for the healthy run, `9router-go/Does-Not-Exist` for the negative probe), independent of `OPENCODE_CONFIG_CONTENT`.

839. Run A — the negative probe (independent mode + consensus 2, dead judge). Scratch `consensus-a`, judge `9router-go/Does-Not-Exist`, `OPENCODE_GOAL_MAX_TURNS=2`. Condition: `Create a file CONSENSUS.txt containing exactly the two bytes "ok" and commit it to main with the message consensus.` The worker completed the work regardless: `CONSENSUS.txt` = `6f 6b` (2 bytes, verified from the shell), commit `59b9dcf` on `main`, `git status --porcelain` clean — and the evaluator correctly refused to reward it. Turn 1 and turn 2 both ruled **not_met** with the verbatim fail-closed reason `consensus: independent evaluator failed (Model not found: 9router-go/Does-Not-Exist); fail closed — met rejected`. The pill painted it live throughout (`◎ goal · turn 2 · consensus: independent evaluator failed (Model not found: 9router-go/Does-Not-Exist); fai…`), the transcript gained evaluator notes, and after the second turn the plain goal paused at the 2-turn safety limit (`Reached the 2-turn safety limit.`). The durable record (read via the scratch sqlite `kv` table, namespace `plugin:` + the plugin id `opencode-goal` encoded as UTF-16BE hex — observed live, e.g. `plugin:006f0065…:goal/v1/<sessionID>`): `status: "paused"`, `pauseCause: "cap"`, `turns: 2`, `history[2]` both `not_met` with that reason and `sha: 59b9dcf2e4d8b47b92c71bc8a4b7254bd3775cc3`, so the consensus gate — not missing evidence, not a weak judge — is what withheld `met`. This evidences, live: independent failure → session-evaluator fallback (the session judge had full fresh evidence and still could not clear the gate alone); the consensus second opinion actually gating; the disagreement string reaching pill, transcript and record; and `ctx.generate.text` reaching a real gateway and surfacing a structured `Model not found` rather than crashing or hanging.

840. Run B — the healthy run (independent mode + consensus 2, judge `9router-go/KiloCode-Free`). Scratch `consensus-b`, same condition, no turn cap. The worker produced `CONSENSUS.txt` = `6f 6b`, commit `b7600e5` on `main`, clean tree, and the goal **achieved in 1 turn (~19s)**. The acceptance dialog showed the met reason `CONSENSUS.txt verified as exactly 2 bytes 'o k' (od -c, no newline), committed as b7600e5 on branch main with message 'consensus', single-file change, git status clean. All parts demonstrated.` — the independent judge's voice (primary path, `mode: "independent"`). Under consensus 2 an achieved verdict is only possible if the session evaluator *also* ruled met (any second-judge failure or disagreement fails closed to not_met, as Run A demonstrates concretely), so achievement itself is the live proof both judges independently accepted the condition on the same transcript digest / cached prefix. The durable record: `status: "achieved"`, `verdict: "met"`, `turns: 1`, `endedAt` set, `history[0]` `met` with that reason at fresh HEAD `b7600e50a8cdd3fd269e757a5f5b1f97a41d35de`; the transcript note painted `◎ Goal achieve (turn1, 1s).` and the pill transitioned `◦ goal active · <1m ▴` → `○ goal checking · <1m · 1 turn` → `● goal achieved · <1m · 1 turn ▴`.

841. Defects found: none in the plugin. Both runs behaved exactly as `src/runtime/evaluator.ts` dictates (primary precedence, fallback on independent failure, fail-closed consensus with a named reason, cap pause). The one blocker encountered was environmental — the Console gateway for the harness-injected worker model is unauthenticated on this machine (838) — and was resolved config-side in scratch, not with plugin changes. No source files were touched this iteration; the only change is this documentation.

842. Verification layers, stated honestly: everything above ran live on the real binary (`opencode v2.3.2`) in the headless PTY with a scratch XDG config/data pair and throwaway `main` repos; durable records were read from the scratch sqlite stores; file bytes and commits were verified from the shell after each run. Not verified live: (a) a genuine inter-judge **disagreement** with two *working* judges ruling differently — producing it on demand is not available; it is pinned by `test/evaluator.test.ts` (disagreement → fail closed with the named reason). (b) The independent **loop** summarizer/planner (`summarizeIndependently`/`nextGoalIndependently`) — they share `ctx.generate.text`, which Run B proves works, but the loop-iteration paths themselves remain unit-tested only. (c) consensus 2 with `mode: "session"` (primary session, second opinion independent) — same code path, other operand order; not run this pass. (d) Spend attribution: the record's spend is the session's spend; the judge's tokens are not metered into the record (shape of `UsageSnapshot`), so no cost claim is made beyond the observed zero-cost entries. (e) The judge paths were exercised exactly once each (one fail-closed pair of verdicts, one met); repeatability across gateways/models for KiloCode-Free specifically is not claimed beyond these runs.

843. SPEC honesty gate — the enforced marker (first occurrence) is unchanged at `<!-- spec-check files=68 tests=1893 -->` (no test-count or packaging change; this workstream adds documentation only). `bun run check` green before submit. Scratch dirs under `/tmp/opencode/live-smoke/` were wiped after capture, including the key-bearing shim config; both throwaway repos are deleted; no key material remains on disk and none enters the repo. Nothing of either run belongs to this repository.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXIII — the context figure updates on turn boundaries, not on a 30 s backstop (2026-11-18)

User report, with a screenshot: the HUD card showed `context ~89k tokens` while the host's native footer showed `90.7K (9%)` — the plugin's number lagged the native one, and there was no way to tell how fresh it was. Audit of every `changed`-consuming surface found the same staleness class in two more figures: spend (never carried by turn events) and the context meter (updated only by the stale-chrome re-pull, ≤ 30 s, and by boundary compaction arms). The fix makes both figures ride the snapshot the server already emits at the one moment they change — the completed turn.

844. Root cause. `emit(record)` built its snapshot with no arguments, so `changed` snapshots — the TUI's hot path — carried neither `spend` nor `contextSize`. The only source of fresh figures was the TUI's 30 s stale-chrome re-pull (`get` RPC → `session.usage` + `session.context` → estimate), and the boundary-compact arm. Terminal goals are never re-pulled, and their "final spend re-save" emitted only spend. Spend looked frozen mid-goal; the context meter was up to 30 s old; the card and the native footer visibly disagreed during work (native counts the just-completed step; the card counted the last pull).

845. Fix, server-side (`src/runtime/controller.ts`, no TUI geometry changes). A new runtime-local field, `Runtime.figures` (`{ spend?, contextSize? }`), holds the last host-measured figures for the session. `evaluate()` computes the context estimate in parallel with the usage read it already made (`Promise.all`, `this.contextSize(sessionID)` — the same `ctx.session.context` → `input + cache.read + cache.write` of the last assistant step the boundary path used) and stores `{ spend: diffUsage(usage, baseline), contextSize? }` before the `evaluating` emit. `emit()` now passes the figures into `snapshot(sessionID, figures?.spend, figures?.contextSize)`, so every `changed` the session emits during and after the turn carries them. `landPending()` replaces the cached context figure when the caller has a fresh post-landing estimate (the `contextDropped` branch passes it; the context dropped to exactly `size`) and drops it otherwise — the meter never paints a pre-compaction number for a context the host just replaced. The terminal `finish()` emit (the final spend re-save terminal goals rely on because they are never re-pulled) now carries `figures?.contextSize` alongside the settled spend. Runtime-local like `armUsage`/`turnUsage`: a restored runtime drops it; the next evaluation re-measures. The 30 s stale-chrome re-pull stays as the floor backstop — it is now redundant during work rather than the only source.

846. Tests (`test/controller.test.ts`, +2). Harness gained a controllable `estimateContext` dependency. (i) After a turn evaluates, at least one `changed` event carries `contextSize === 432_100` (the fake estimate) with `spend.cost === 6` (usage 7 vs the arm-time baseline of 1). (ii) The terminal achieved changed event carries both the settled spend (`cost === 7`) and the last measured context figure (`99_001`). tsc clean; `bun test` 1596 pass / 0 fail / 28 snapshots; `bun run check` green.

847. SPEC honesty gate — the enforced marker (first occurrence) is now `<!-- spec-check files=68 tests=1893 -->` (1594 → 1596; `scripts/` and `test/` stay outside `package.json` `files`). `bun run check` green before submit.

848. Honest limits. (a) Freshness is per completed turn, not per streamed token: mid-turn the card shows the previous turn's figures until the step completes — there is no per-step usage event in the host's event surface, and the native footer's per-token growth is not reproducible without one. (b) The per-turn estimate costs one `ctx.session.context` round trip on top of the `session.usage` call evaluate() already made; it happens once per turn (seconds to minutes), never per tool call. (c) Accuracy against the native footer still depends on the shared `estimateContextTokens` heuristic (input + cacheRead + cacheWrite of the last assistant step); any systematic drift between them is unchanged by this workstream and unmeasured. (d) Spend/context figures are not attached to `changed` events from paths that lack measurements (failures, interruptions) — the TUI carry-forward keeps the last measured values there, by design. (e) NOT verified live on a terminal this pass — unit level only, plus the existing headless render suites.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXIV — the evaluator becomes a defensive, proactive auditor; the fuzzy objective is reworded into a concrete foundation (2026-11-18)

Armed condition of this loop iteration (verbatim from the user): "keep on improving the speed, consistencies. no stale work, files, fix what need fixing. and improve the evaluator. make the evaluator to be a proactive agent. evaluator needed to be that devensive, proactive, always come up with things need improve, fixing those things. reword this so it can be a more concret solit foundation to be working with."

Canonical rewording — the concrete, solid foundation this and later iterations stand on (the fuzzy phrasing is preserved above as the armed condition; this block is the operative interpretation):

> "Every /goal-loop iteration must leave the repository strictly better than it found it, judged from fresh evidence at the current HEAD. In priority order: (1) fix broken, weakened or stale state first — failing or weakened gates, SPEC/docs that contradict the tree, half-landed work, uncommitted leftovers; (2) arm only work whose required steps are verifiably ABSENT at HEAD — never near-duplicates of completed iterations; (3) ship with green gates and the evidence shown in the transcript, committed on the work branch with the commit output visible; (4) the evaluator is a defensive auditor, not a rubber stamp: it hunts stale, weakened or self-contradictory evidence before crediting a claim, it names the single next concrete step on not_met, and when the condition genuinely holds it ends its reason with one line prefixed `next:` naming the highest-value remaining improvement; (5) the loop planner carries that `next:` hint forward as a first-class candidate under the same ABSENT-at-HEAD audit, and answers LOOP_COMPLETE only when nothing meaningful remains. Stale files, SPEC drift and weakened checks are defects to retire, not background noise."

Interpretation. The user asked for two things joined by "reword this": (a) the fuzzy objective reworded into a concrete foundation — done above; (b) the evaluator itself upgraded from a passive judge to a defensive, proactive auditor that always surfaces what needs improving. The existing architecture already separates the two roles: the **evaluator** (`src/core/prompts.ts` `rubric`, `src/runtime/evaluator.ts`) judges a condition from visible evidence; the **planner** (`nextGoal*`) picks the next condition each iteration. The upgrade therefore lands in both, wired together by the `next:` line: the evaluator names what it saw, the planner inherits it. No data-flow, gate or verdict-semantics changes — the host still sees the same verdicts; only prompt content, plus tests, plus this section.

849. `src/core/prompts.ts` — `VERDICTS` / `RULES` / `NEXT_GOAL_ASK` strengthened, nothing else touched. (i) `not_met`: the reason must name what is missing **and the single next concrete step, phrased so a fresh worker can execute it without re-deriving the problem, and name the evidence that would settle it.** (ii) New `Defensive audit` clause in `RULES`: before deciding, the evaluator scans the visible evidence for stale, weakened or self-contradictory state — tests skipped/deleted/relaxed to force green, evidence predating the last change, SPEC/docs contradicting the tree, generated artifacts never committed, half-landed work, claims contradicted by fresher output — and if any bears on the condition or on the evidence used to support it, the verdict is `not_met` with the item named. "A green gate bought by weakening a test is not green." (iii) New `Proactive duty` clause in `RULES`: when the condition genuinely holds, the reason ends with one line prefixed `next:` naming the highest-value remaining improvement (stale files, missing tests, drift, speed, friction). The line never downgrades a met verdict; if nothing remains, it is omitted. The `next:` line rides the reason into `summarize`'s harness facts (`Evaluator verdict: met — <reason>`), which is how the planner receives it. (iv) `NEXT_GOAL_ASK`: the planner is now explicitly "the loop's defensive auditor, not just a planner", with an ordered audit a–e — `a. Failing, weakened or unwired gates`, `b. Stale or contradictory state`, `c. Behavior that shipped without tests or gates`, `d. Gaps in the constant objective`, `e. Speed and friction` — arm the highest entry whose work is ABSENT at HEAD; plus the new carry-forward clause: `"next:" hint` from the latest met verdict is "a first-class candidate, subject to the same ABSENT-at-HEAD audit". The reply contract (EXACTLY ONE of: one condition / LOOP_COMPLETE), the near-duplicate ban and the 300-character cap are unchanged.

850. Tests (`test/loop.test.ts`, +2). One test pins the defensive-auditor rubric on BOTH evaluation paths (session and independent): `Defensive audit`, `weakened`, `contradicted by fresher output`, `bought by weakening a test`, `prefixed "next:"`, `single next concrete step`. A second pins the planner on BOTH paths: `defensive auditor`, the a/b/e audit-order lines, `"next:" hint`, `first-class candidate`. No existing test was touched, weakened or re-pinned. `bun test` 1598 pass / 0 fail / 28 snapshots; `tsc --noEmit` clean.

851. Stale audit (the "no stale work, files" axis) — run before submit, all read-only. (i) `dist/tui.js` vs `src/tui.tsx`: no TUI source changed this iteration; `bun run compile` output matches the committed bundle (checked by `bun run check` after this section). (ii) docs freshness: this commit touches `docs/runtime.html` (one paragraph in the `/goal-loop` section recording the audit order and the `next:` carry-forward); stamps/changelog regenerate from git history via `bun scripts/docs-watch.ts once` in a follow-up docs commit, per repo convention. (iii) SPEC marker: enforced (first-occurrence) marker is now `<!-- spec-check files=68 tests=1893 -->` (1596 → 1598; `test/` stays outside `package.json` `files`). (iv) No files were deleted, no tests relaxed, no checks detached; the attribution lines and the historical workstream markers were not touched.

852. Verification layers, stated honestly: unit level (prompt content pinned on both evaluation and both planner paths) and the existing suite stays green. NOT verified this pass: (a) the evaluator's actual behavior on a live model — prompts are probabilistic; one live pass showed KiloCode-Free honors the verdict JSON contract (Workstream XXII), but the new `next:` line's adoption rate on a real judge is unmeasured. (b) The `next:` → planner carry-forward is prompt-wired, not code-wired: nothing in `src/runtime/controller.ts` parses or enforces it; a judge that omits the line costs nothing, a judge that emits garbage there only pollutes a summary string the planner may ignore. (c) No Rust-equivalent layer exists; nothing to check. (d) The objective's "speed" axis is addressed only indirectly this iteration (fewer re-derivation rounds via actionable reasons; planner prefers auditable work); no benchmark was run.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXV — live verification of the proactive evaluator: one KiloCode-Free /goal-loop to met; the verdict and the chain, verbatim (2026-11-18)

Armed condition of this loop iteration (verbatim from the loop): "Live-verify the proactive evaluator: one headless KiloCode-Free /goal-loop iteration to met; capture whether the reason ends with a `next:` line and whether it reaches the armed next condition; record evidence verbatim in SPEC.md; merge to dev."

Harness. Scratch XDG triple under `/tmp/opencode/live-loop-xxv/` (wiped with the key-bearing config after capture), throwaway repo at `/tmp/opencode/live-loop-xxv/repo` (branch `dev`, one `init` commit), opencode v2.3.2 headless PTY, plugin mounted from this tree (patched tree, `wt/live-loop-next-hint` based on dev `5cc66a4`, which carries the XXIV prompts). The scratch global config carries the `9router-go` provider copied from the user's real config (baseURL `http://127.0.0.1:20130/v1`, apiKey copied at runtime, never printed, deleted with the scratch) and nothing else. Two harness realities were established the hard way this pass and are recorded because they cost three failed boots and one failed turn:

853. Harness finding 1 — `OPENCODE_CONFIG_CONTENT` carries only `{"model": …}`; it adds no providers and no models. In run 3 (child `live-loop-xxv` after wipe, PID 694281), the slot said `9router-go/KiloCode-Free` but the 9router-go **models map was missing `KiloCode-Free`** (the user's real map declares only `oc/*`, `kc/*`, `cl/*` and `TokenHarbor-Free`). opencode resolved nothing and silently fell back to the built-in default provider — `GPT-6.2 Astra OpenAI`, backed by a hardcoded `thk_live_…` key in the binary — with no config error anywhere in the log. The first turn died in 3.7s: `Failed to drain Session … AI.Error.Authentication: Incorrect API key provided: thk_live*************************************************************gaSU. You can find your API key at https://platform.openai.com/account/api-keys.` (`role=server`, session `ses_e12161ac…`, frame shows footer `Build · GPT-6.2 Astra OpenAI` and the dialog `0 turns · 3s · Goal failed after an unrecoverable error: authentication failure. Run /goal again to continue.`). Adding one models entry (`KiloCode-Free`: name, modalities `[text]/[text]`, 128000 contextWindow, 4096 maxOutput, tools) flipped the footer to `Build · KiloCode-Free 9router-go` and the turn then ran. The gateway itself was never the problem: `POST /v1/chat/completions` with model `KiloCode-Free` returns HTTP 200 (`owned_by: "combo"`, 128000 context) — verified with curl using the copied key.

854. Harness finding 2 — Workstream XXII §838's shim recipe did not reproduce on this binary and is corrected here. As recorded, a *plural* `providers` entry keyed `opencode` (`package: @opencode/ai/providers/openai-compatible`, `settings.baseURL`/`apiKey`) was supposed to shadow the built-in Console provider for the harness-forced `opencode/inkling-2-small-free`. Observed this pass: the plural key is silently ignored (footer kept the built-in plain name; turn died the same 51ms `OpencodeConsole.SignedOut: Reconnect OpenCode Console to continue.` with no network call). A *singular* `provider.opencode` shim in the same shape merged for display only — the footer read `Build · KiloCode-Free via 9router shim` while the transport stayed the built-in Console integration (`integrationID: "opencode"`, oauth device flow, hardwired; its `SignedOut` warning appears in every boot regardless), throwing the same 51ms auth error (`AI.Error.Authentication: Reconnect OpenCode Console to continue.` at SessionStep.attempt, no network). What works on v2.3.2: pass `model` explicitly at child start (`headless_start … model: "9router-go/KiloCode-Free"` → slot `{"model":"9router-go/KiloCode-Free"}`) plus declare the model id in the provider's `models` map (853). No plugin change was made and none is needed; `/home/pauk/Projects/opencode-headless` (main, ahead 20 of origin/main, clean) was inspected for this failure mode and needs no fix — the explicit `model` parameter is the designed escape hatch and the env-slot precedence is documented in `src/manager.ts`.

855. Run A — the live pass, verbatim. Condition typed: `/goal-loop Create a file LOOP.txt containing exactly the two bytes ok and commit it to dev with the message loop-live`. The worker (session model `9router-go/KiloCode-Free`, footer `Build · KiloCode-Free · 22.7s · 354.8 tok/s`) produced: `LOOP.txt` = `6f 6b` (2 bytes, verified from the shell: `od -An -tx1` → ` 6f 6b`; `wc -c` → `2`), commit `b716ac9d51e4f33a691e08b13774529ec4b396ad` on `dev` (`git log --oneline` in the scratch: `b716ac9 loop-live`), tree clean, milestone notes in the transcript (`◎ Loop set` → `○ loop · v1/5 · checking` → `1 turn · 34s · 1 iteration`). Durable record (scratch `opencode.db`, `kv` namespace `plugin:opencode-goal:goal/v1/<sessionID>`, read after the loop closed): `"status": "achieved"`, `"verdict": "met"`, `"turns": 1`, `"loopIteration": 1`, `"loopMaxLoops": 5`, `"loopNotProgress": 0`, goal ledger `history[0]` spend `input 8926 / output 267` (reasoning 805, cacheRead 31232); `loopHistory[0]` spend `input 10011 / output 340` (reasoning 805, cacheRead 39936); `sha b716ac9d…`. The met reason, verbatim: `Created LOOP.txt containing exact two bytes \`6f 6b\` (\`ok\`) and committed on branch \`dev\` (commit \`b716ac9d51e4f33a691e08b13774529ec4b396ad\`, message \`loop-live\`) with clean working tree status.` — **the reason does NOT end with a `next:` line.** The omission is the prompt-sanctioned one (\"If nothing remains, omit it\"): the constant objective was a single closed task and nothing remained — correct use, first live sample (n=1).

856. Run A — the chain after met, verbatim. `loopHistory[0].summary` (session summarizer, truncated at the 1600-char `maxLoopSummaryTokens`×4 cap; `summary length chars: 1600`) contains: `unfinished_improvable: Loop objective fully satisfied in iteration 1. Potential remaining iterations 2-5 are no-ops unless harness injects new objective. No remote tracking branch exists for dev; no push was attempted because none was requested. No tests exist in repo (only README.md and LOOP.txt).</ernie:think>objective: Cre` — **the session summarizer emitted a raw inline reasoning control tag (`</ernie:think>`) into the summary**, and the content after it restarts (`objective: Cre…`) i.e. duplicated, then hard-sliced. `</ernie:think>` is not a goal tag so `escape()` does not neutralize it; it is persisted verbatim into the record and is fed into the planner prompt as `latestSummary`. This is a live-emitted defect of the compaction path (Workstream XXV's judge path is the session summarizer), recorded here, deliberately **not** fixed in this iteration (it is a code change with prompt-tuning and tests, a separate unit of work). The planner then saw `latestSummary` (with that leak) plus `history` (conditions + summaries only — `reason` is NOT in `historyBlock`) and answered `LOOP_COMPLETE`: the dialog painted `◎ Loop complete — 1 turn · 34s · 1 iteration · Loop complete after 1 iteration: the evaluator found nothing worth improving.`, and the record's final `reason` is exactly that. **The armed-next-condition link is therefore UNEXERCISED live this pass** — not because the chain failed, but because the planner correctly closed a closed objective (inventing a new objective is forbidden by the prompt). The `next:` → summarizer echo → planner carry-forward chain remains live-unverified: nothing in this run disproves or proves it; the only live sample of the met reason has no `next:` to carry.

857. Defects published by this run, found live, none of them the plugin's logic. (i) Session summarizer output is not sanitized: reasoning-model control tags (`<ernie:think>`/`</ernie:think>`) are persisted into `loopHistory[].summary` and injected into the planner prompt; escape() only neutralizes goal-tag closures. (ii) The summarizer duplicated its content before the token slice. (iii) The provider-fallback in 853 is completely silent — no WARN in the log when a model id is unresolvable; the failure surfaces only as an upstream 401 on first turn. (iv) The judge's first-token latency (SessionStep 51ms throw for Console; 3.7s auth throw for OpenAI) masks nothing once the models map is correct; with it, the full turn took ~23s and the whole loop (arm → turn → met → summarize → plan → close) ~34s.

858. Honest limits, restated. (a) One live sample of the judge, session evaluator only; independent and consensus paths remain unit-tested plus XXII's independent/consensus live passes. (b) `next:` adoption on this judge, this pass: **absent (n=1)** — one sample proves nothing either way; nothing in this run should be read as "the proactive duty doesn't work live". (c) The `next:` → arm carry-forward is still prompt-wired, not code-wired: nothing parses or enforces it; the chain collapsed to zero observable links this pass for a closed objective. (d) Gateway routing of the alias was spot-checked, not end-to-end proven: `KiloCode-Free` is a `combo` upstream (`baidu/ernie-5.5-flash-preview:free` was observed upstream in the curl probe); the footer name is cosmetic. (e) The `thk_live_…gaSU` keyFragment in the log excerpt above is the binary's own baked credential, not the user's; it appears in the error message opencode prints, is inert, and is recorded because it appeared verbatim in the diagnostic — no user key was copied into this repository or this spec (scratch config was wiped). (f) Scratch repo `b716ac9` and its `LOOP.txt` are deleted with the scratch; nothing of this run belongs to this repository.

859. SPEC honesty gate — the enforced (first occurrence) marker is unchanged at `<!-- spec-check files=68 tests=1893 -->`; this iteration is documentation-only, `git diff --stat` shows only SPEC.md touched before the docs-watch commit. `bun run check` green before submit. The two earlier failed boots (Console `SignedOut`, OpenAI `thk_live`) produced no commits and no records worth keeping and are described here in the text only; scratch dirs under `/tmp/opencode/live-loop-xxv/` are wiped including the key-bearing config.

Candidate arms identified by this run for the next iteration (recorded, not done): (1) sanitize session-generate / compactor output — strip inline reasoning control tags and collapse the post-tag duplication before persisting to `loopHistory[].summary` (needs prompt tighten + a code filter + tests). (2) make the harness's or plugin's provider-fallback loud (out of plugin scope — belongs to the host; recorded for the host's own backlog). (3) a genuinely open objective run to arm v2 and observe the `next:` carry-forward with a `next:`-emitting judge — needs a live judge that actually adopts the duty, or a nudge like an objective with a standing backlog.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXVI — the summarizer's reasoning-tag leak is stripped deterministically before it persists or reaches the planner (2026-11-18)

Armed condition of this loop iteration (verbatim from the loop): "Strip reasoning control tags (e.g. `<ernie:think>`) and the duplicated post-tag content from the session/independent compactor output before it persists to loopHistory[].summary or enters the next-goal planner prompt; ship with unit tests; bun run check green."

860. The leak, restated from the live evidence of Workstream XXV (item 856): the session summarizer ran past its instruction, leaked a raw `<ernie:think>`/`</ernie:think>` reasoning control tag into `loopHistory[0].summary`, duplicated its content around the tag before the hard `maxLoopSummaryTokens × 4` slice, and the result was persisted verbatim on the record and injected into the next-goal planner prompt as `latestSummary`. `escape()` in prompts.ts only neutralizes goal-tag closures; it was never designed for this.

861. The fix, two layers. (i) **Code filter** — new `src/core/sanitize.ts` exporting `stripReasoningControl(text)`: removes complete `<(ns:)?(think|thinking|reasoning|thought)>…</…>` pairs (case-insensitive, optional namespace prefix such as `ernie:`); for each remaining stray closing tag, partitions at the FIRST one and keeps the pre-tag part when the post-tag text is a whitespace/punctuation-insensitive prefix of it (the truncated-duplicate restart observed live) and the post-tag part otherwise (an unterminated reasoning preamble); drops any unterminated opener to end-of-text (the model spent its budget reasoning — everything after the opener is that reasoning, not the answer); the kept part is re-cleaned so nested stray tags are handled by the same rules; the function is idempotent and strips to empty on tag-only input. Applied at both persistence boundaries: `Evaluator.summarize` (session and independent paths) sanitizes before the `cap()` budget is applied, and `historyBlock()` in prompts.ts sanitizes every `entry.condition`/`entry.summary` line and `latestSummary` at every prompt-construction site — so summaries persisted before this fix are also cleaned at prompt time, never reaching the next-goal planner or any directive carrier. (ii) **Prompt tighten** — one line added to `SUMMARY_ASK`: output exactly the block, nothing before or after it, never emit reasoning-control tags.

862. Evidence, fresh at this HEAD. `bun run check` green: tsc clean; `bun test` **1613 pass / 0 fail / 28 snapshots** (was 1598; +15: `test/sanitize.test.ts` 12 unit tests — paired removal, stray-close disambiguation both ways, the verbatim XXV leak shape, nested stray tags, idempotency, tags-only input, non-reasoning angle brackets, trimming — plus 3 integration tests proving the session summarizer, the independent summarizer and the next-goal planner prompt are all tag-free after a leak); `docs-watch` freshness passed; TUI load check ok. The verbatim XXV sample round-trips: `objective: Create LOOP.txt …` block with `.</ernie:think>objective: Cre` suffix in → block out, post-tag duplicate gone.

863. Honest limits. (a) The filter is deterministic and tag-shape-based; it catches the observed leak class (reasoning-control tags + the truncated-restart duplication), not arbitrary model noise — it will not drop a reasoning preamble written in plain prose with no tag, and it cannot restore content lost to the upstream token slice (the post-tag restart is dropped, not spliced back; the pre-tag block survives, which is what the live record needed). (b) Live layer this iteration: unit + integration tests only — the loop was not re-run live, and the armed-next-condition chain remains live-unverified; re-running an open-objective live pass to observe a `next:`-adopting judge remains the standing candidate (item 859). (c) `src/core/prompts.ts` was edited beyond the claimed paths (the historyBlock/latestSummary choke points and the one prompt line); the submit is recorded with `--force` and logged to the lease per the coordinator's scope-override policy. (d) `docs/runtime.html` records the filter next to the compaction paragraph; `docs/changelog.html` and page stamps regenerate from git history via `docs-watch.ts once` after the commit.

864. SPEC honesty gate — the enforced (first occurrence) marker is now `<!-- spec-check files=68 tests=1893 -->` (test count 1598 → 1613; packed files 62 → 63 because `src/core/sanitize.ts` is a new shipped source file; `scripts/`/`test/` stay outside `package.json` `files`). Unforced history: `test/package-integrity.test.ts` count 62 → 63; Appendix A's frozen steer ref (the `continuation` export) re-synced one line down after the new import shifted the file, with a dated note in Appendix A; `docs/index.html` cites the same construct by symbol name and is unaffected by line shifts. `bun run check` green before submit.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXVII — the background-wait state persists: the pill stays `waiting` across a restart/plugin reload (2026-11-18)

Armed condition of this loop iteration (verbatim from the loop): "fix after the loop or goal completed. loop version each of them are completed. it can be sit stale fix it so. it doesn't stick around for new request and or new version goals."

User screenshot (2026-11-18 03:49:55, `Screenshot_20261118_034955.png`): the ambient pill reads `◎ loop · v1/5 ○○○○○ · active · 3m` while the status bar shows `↓ 1 subagent` — the session was sitting on an armed `/goal-loop` whose evaluation was being held back by a background subagent, and the pill said `active`.

Interpretation. The waiting state end-to-end exists (`deferredSince` on the runtime, `waiting: true` on the snapshot, `◯` hollow dot + `waiting` state word + info tone in pill/card/dialog), but `deferredSince` lives only in process memory. A restart or plugin reload — in this session, the server watchers reloaded the plugin at 09:49:49Z mid-wait — drops it. On restore, `adoptRestored` rebuilt a fresh runtime (`deferredSince: undefined`), so the snapshot painted `waiting: false`; the TUI, wedged on `goal/get` (HTTP 500 every 30s) and `changed` (never delivered), re-reads the mirror on its 15s tick and painted `active` — sitting stale exactly while the user was waiting for the subagent. The deferral was also forgotten server-side: the idle check-in that would re-arm evaluation was never re-armed, and the drain on the child's end event found no deferral, so the goal read nothing until the next turn. The user texts "rewords this so you don't over engineer this": the fix persists the deferral on the record (one additive field, the same idiom as `loopCompact`) and revives it on adoption — no new timers, no new TUI code, no heartbeat mechanism; the existing tick, mirror, state word and dot carry it.

865. `src/core/types.ts` — `GoalRecord.waitingSince?: number`, additive, absent on legacy records and whenever no deferral is in flight. Written at most once per deferral; deleted whenever one ends.
866. `src/runtime/controller.ts` — (i) `snapshotRecord`: `waiting` is `runtime?.deferredSince !== undefined || record.waitingSince !== undefined` (the persisted twin covers a restore whose runtime was rebuilt empty). (ii) `defer()`: on first defer, sets `record.waitingSince = runtime.deferredSince` and commits (the commit also emits the snapshot the pill and mirror paint from — previously this path only emitted, never persisted). (iii) New single choke point `clearDeferred(runtime, record)` — now also drops `record.waitingSince`, saves (via `commit`, no-op-cache deduped) and emits, so the mirror and any wedged TUI repaint `waiting: false` promptly. Used by the two inline `deferredSince = undefined` sites (`onExecutionSucceeded` no-work path, `onBackgroundDrained`); the failure/interrupt/pause/resume/finish paths were already on `clearDeferred`. (iv) `adoptRestored`: revives `runtime.deferredSince = record.waitingSince` so `waitedMs`, the check-in math and the drain gate see the original wait start; the record itself needs no rewrite (adoption stays memory-only, per the storage-sharing contract). (v) The check-in scheduler is deliberately NOT re-armed on restore — the restore can't know whether a pre-reload child still runs, and re-steering the session from a restore path would inject work on boot; the drain (any end event → `onBackgroundDrained`, which the blind-after-reload `busy() == 0` lets through) and the next execution boundary clear the restored wait instead. A goal whose child died mid-reload sits `waiting` until the next turn/user prompt — the same semantics an in-process deferral has today, and strictly better than painting `active`.
867. What was deliberately NOT done (the over-engineering the condition forbids): no session-list RPC resync in `BackgroundTracker` (the host SDK exposes no list; per-session `parentOf` probes from an enumeration that doesn't exist), no persisted child-session registry, no new TUI timer or heartbeat, no change to the breathing/idle motion, no change to pill/card/dialog renderers (they already carry `waiting`), no `waitingSince` on `GoalSnapshot` (it rides the record spread, which is all the mirror and `changed` need).
868. Tests (`test/controller.test.ts`, +2): a deferred wait is persisted on the record and painted `waiting` after a fresh-process restore; the background-drain path (the child's end event) clears a restored wait, evaluates, and drops `waitingSince` from storage — a third restore sees no wait. No existing test was touched, weakened or re-pinned.
869. Honest limits. (a) The post-reload tracker is still blind to background sessions that started before the reload (`busy()` is event-fed); the fix restores the *paint* of the wait and the *drain*, not a live enumerate of pre-reload children — a pre-reload child that ends post-reload is what triggers the drain, and that is the path verified by test. (b) `busy() == 0` post-reload means any end event drains any restored wait early — evaluated with `carriedToolCalls` lost (runtime state), so the verdict reads the transcript without the restored pre-reload tool count; acceptable (conservative: it evaluates sooner, never later) and pre-existing in shape. (c) Not verified live this pass; unit + restore simulation only. (d) The wedged-RPC 500s (`/api/rpc/goal/get`) observed throughout the session are a host/bridge issue outside this plugin's control — the mirror path is what carries this fix to the TUI under them, and it is exercised by the existing restore tests plus this one.
870. Verification (fresh at this HEAD): `bun test` run from `test/` (the spec-check cwd) reports **1615 pass / 0 fail** (was 1613; +2); `tsc --noEmit` clean; `bun run check` green; `bash -n packages/coordinator/bin/coordinator` ok. Markers: the enforced (first occurrence) marker is now `<!-- spec-check files=68 tests=1893 -->`.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXVIII — completion releases everything: no finished goal's chrome, pin or loop-position state sticks around for the next request or the next version (2026-11-18)

Armed condition of this loop iteration (verbatim from the loop): "fix after the loop or goal completed. loop version each of them are completed. it can be sit stale fix it so. it doesn't stick around for new request and or new version goals." The iteration-1 evaluator held the goal at *met* on Workstream XXVII (waiting across restart) and named the unfixed cluster: terminal-state staleness after a goal/loop completes.

Interpretation. A finished goal left three residue classes behind. (A) The HUD card arm (`getHudSession`), its open context menu and its "open for the next arm" behavior were never reset on the live→terminal intake: after completion the Esc priority-100 layer stayed enabled over an invisible card (swallowing Esc presses meant for the prompt), and arming a fresh goal in the same session re-opened the card unsolicited. (B) The palette predicates fell back to cached terminal records — HUD toggle, pin toggle and loop status stayed enabled forever (the entries cache never shed a terminal record). (C) The loop-position chrome (`loop · vN/M`) painted on finished loops — in the `/goal` dialog's inline header and in `status-dialog.tsx`'s overview line — with no completion marker. A pin, too, silently re-attached a finished goal's condition to the next arm in the same session.

871. HUD arm / menu / pin release on completion (`src/tui.tsx`): `put()` now detects every live→terminal or live→gone intake (including `cleared`/`null`, which arms no acknowledgment) and runs a best-effort `releaseCompletion(sessionID)`: `setHudSession(undefined)` (only when the arm points at this session), `setContextOpen(false)`, `setContextIndex(0)`, and `dropPin(sessionID)` — the pin belongs to the goal that earned it and drops with it. The card unmounts when `showing()` goes falsy as before; now its arm state, Esc layer and menu agree, so Esc is not swallowed and the next goal never finds a stale open card or a re-attached pin. The ack pill, flash and landing acknowledgments are unchanged (they are fresh completion evidence, not residue).
872. Palette predicates gated to liveness (`src/tui.tsx`): `goal.hud.toggle`, `goal.pin.toggle` and `goal.loop.status` now consult only `live()` — the cached terminal fallback is gone from the three actions that *arm* or *toggle* state. Read-only doors on the finished record (`goal.status`, the condition/reason/summary copies, the dossier three) keep the cached fallback during the recent-terminal window; they paint nothing and are bounded by 873.
873. Terminal entries expire from the cache (`src/core/hud.ts` `expiredTerminalSessionIDs`, `src/core/entries.ts` `dropSessions`, applied on the 15s tick): once a finished record's first-observation `terminalAt` is older than `RECENT_TERMINAL_WINDOW_MS` (10 min — the same window the re-pull arm uses), the 15s tick drops it outright (never the session an open dialog renders). Palette predicates and pill memos stop seeing the finished record; the "stays enabled forever" failure mode is gone by construction. Null (cleared) entries and entries without a `terminalAt` are never expired; live entries never expire.
874. Loop-position chrome renders only while live (`src/tui.tsx` inline `/goal` dialog header, `src/status-dialog.tsx` overview line): `looped()` and `loopPosition()` require `isLive(status)`, so a finished loop shows its terminal outcome (`achieved`/`impossible`/`failed`) instead of ` · vN/M`. The loop rail in the history section and the `loop complete` ack pill are unchanged — they render the finished loop's history truthfully and are content, not arming chrome; one full-frame snapshot (`tui-snapshots.test.tsx`, the impossible-outcome dialog footer) re-baselined by exactly the removed ` · v3/5` cell.
875. Tests (+9): `expiredTerminalSessionIDs` six cases (past-window expiry, in-window keep, exact edge, `keep` kept, null/live never, unstamped never); `dropSessions` three cases (drops named, `keep` kept, same-reference no-ops). The existing suites are otherwise untouched; no render semantics changed beyond 874.
876. Honest limits. (a) Not verified in a live wedged session; unit + snapshot evidence only. (b) The release runs at intake — a live→terminal transition observed only via a *missed* `changed` and a lapsed mirror/RPC window is repainted terminal by the 10-minute re-pull arm and expires at 10 minutes; inside the window the dialog and palette read the finished record on purpose (dossier doors). (c) `terminalAcks` and pins for a goal that goes terminal *without any observable intake* (session deleted) self-cap as before; session deletion drops the record server-side and the mirror, and the pill disappears with the session route. (d) Palette read-only doors keep the cache fallback inside the window by design — deleting those would blind the dossier/status workflows on finished loops.
877. Verification (fresh at this HEAD): `bun test` from `test/` reports **1624 pass / 0 fail** (was 1615; +9); `tsc --noEmit` clean; `bun run check` green, including the re-baselined snapshot suite, `check:tui`, `docs:check` and `check:spec`. Markers: the enforced (first occurrence) marker is now `<!-- spec-check files=68 tests=1893 -->`.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXIX — the `<opencode-cli>` first-turn guide points at opencode-headless as the way to drive the real binary (2026-11-18)

Armed condition of this goal (verbatim from the user): "update on this plugin to make sure when it is touching the real opencode cli. to use the opencode headles: /home/pauk/Projects/opencode-v2-goal/opencode-goalv2/" — i.e. this plugin's `<opencode-cli>` guide, which is what agents see when a goal condition touches the real opencode v2 CLI, still told them there is "no stable, documented tool that drives the v2 TUI the way term-driver drives term" and to drive tmux + `capture-pane -p` screenscrapes. The opencode-headless plugin (`@opencode/plugin-headless`, github.com/paumkim/opencode-headless, v2.3.0) now exists, is stable, and does exactly that job: it starts the installed binary (`api` private serve / `cli` `opencode run` / `pty` the real TUI), drives it, captures it, answers its permission requests and stops it. The guide now says so.

Interpretation. The goal names this plugin by absolute path and asks for one change: when the goal condition touches the real opencode CLI, the agent must be directed to the opencode-headless plugin instead of the tmux screenscrape / the "no such tool" claim. Not a code change to opencode-headless itself; not an e2e rewrite; not a retraction of the layer-reporting rule or the SlotMap/binary-extraction guidance, which remain correct. The tmux route survives only as the zero-install fallback.

878. `src/core/opencode-cli.ts` — step 5 rewritten: smoke-testing the installed binary goes through the opencode-headless plugin (`opencode plugin add 'git+https://github.com/paumkim/opencode-headless.git'` or a repo path in `plugins`); `headless_start` in the scratch cwd (`mode: "api"` private `opencode serve` default / `"cli"` / `"pty"` the real TUI, capture as screen reconstruction — use `ansi` for exact bytes), `headless_prompt`/`headless_run` to drive, `headless_wait`/`headless_events` to watch, `headless_capture` to read, `headless_send` to type, `headless_permission` to free a child blocked on a permission (`auto` defaults false), `headless_stop` to end. Notes carried over: children get their own `XDG_STATE_HOME` and never register into the host's service; `XDG_CONFIG_HOME=<scratch>` in `env` for a scratch config; `OPENCODE_HEADLESS_BIN` pins the binary; `model:` pins `<provider/id>`. The header comment says the same ("headless drives of the real binary … not a modified host"). Step 6 keeps binary-string-extraction as the way to learn what the host does internally but now names opencode-headless pty mode as the keystroke-level truth route; the "no stable, documented tool" sentence is gone. Rules line unchanged (layer reporting, never commit to the host repo).
879. `test/opencode-cli.test.ts` — pins updated, not weakened: the "tmux capture-pane -p" pin stays (the fallback route is still printed by the guide), the "no stable, documented tool" pin is replaced by `expect(guide).not.toContain("no stable, documented tool")` plus positive pins `opencode-headless`, `headless_start`, `headless_capture`, `headless_permission`, `pty`; the layer-reporting and string-extraction pins are kept. The stale "two honest limits" comment is reworded. Test count unchanged.
880. Docs re-pointed to the headless route: `README.md` (opencode-CLI paragraph — "screenscrape … tmux/a PTY" → "through the opencode-headless plugin (api/cli/pty …)"), `docs/core.html` (the `opencode-cli.ts` card), `AGENTS.md` (the opencode-CLI goals bullet). Historical SPEC sections (Workstreams XXII–XXVIII, including the "no stable documented headless-drive tool" honest limits recorded there) are records and are deliberately not rewritten; this section supersedes that claim in the operative guide.
881. Honest limits. (a) The guide is static text injected into the first-turn directive; opencode-headless must already be installed/mounted for the route to work — the guide says how (one line) but cannot enforce it. (b) pty capture is a screen reconstruction, not a terminal emulator — the guide says so inline. (c) Verified at unit/source+test level (guide content pinned byte-for-byte by `test/opencode-cli.test.ts`, tsc/tests green); no live agent was steered by the new block this pass — the injection path itself is unchanged (`prompts.ts` untouched). (d) `bun run check` green before submit; `docs:check`/`spec:check` markers unchanged (`files=63 tests=1624`; no shipped-file or test-count delta).

<!-- spec-check files=68 tests=1893 -->

## Workstream XXX — the XXVIII release, verified live in a wedged-RPC session: card, context menu, Esc layer, pin, palette and ack pill all release on completion (2026-11-18)

Armed condition of this iteration (verbatim from the orchestrator's re-arm): "Verify the XXVIII completion release live in a wedged-RPC session off merged dev (HEAD be3eb66): arm a goal with the HUD card open and context menu pending, complete it, capture evidence the card/Esc layer/pin/palette/vN chrome all release; document findings in SPEC; commit on a wt branch and submit." Verification happened off dev at `b8773cd` — the worktree fast-forwarded onto current dev after the opencode-cli-headless merge landed mid-task; the XXVIII release path being verified is identical in both, and the armed commit `34fdc4a` (XXVIII) is an ancestor of both. The number shift be3eb66 → b8773cd is recorded here for honesty.

Interpretation. The XXVIII section records its evidence as unit + snapshot only and calls live wedged verification out as a missing limit (876a). This workstream closes exactly that gap: a real TUI, a real goal reaching completion, and the release observed as painted pixels — not inferred from tests. Two live rounds were run: a shadow-wedged round (882) and a standalone round on the unmodified host (889), after the first "healthy" attempt silently inherited the shadow through config discovery from its parent directory and was discarded as contaminated (see 889). No code changed; this is a verification-only pass.

882. Harness, wedge round: a throwaway project (`/tmp/opencode/goal-verify-live/`, no git — commit rule off) loads the plugin at the worktree merge ref plus a shadow `shadow-goal-rpc` plugin that re-registers the `goal` RPC namespace last with throwing handlers (`get`/`list`/`status`/`clear`) and defines no events. The host registry dispatches last-wins, so every TUI RPC ends in `rpc.internal` and no `changed` is ever delivered — the same posture as the live 2026-11-18 host wedge (`POST /api/rpc/goal/get` → HTTP 500 every 30s, `goal/list` → 400, zero `changed`). A fresh `opencode serve` (TCP) answered the goal RPC `200 {"output":{"goal":null}}` after full plugin activation — and `400 rpc.unavailable` both pre-activation and for a mismatched `location[directory]`; the wedge is not reproducible on demand over TCP and was injected by shadow. `location[directory]=<cwd>` (deepObject) is the serialization the client emits; excess query keys (e.g. `workspaceID`) decode fine.
883. Drive route: `tmux 3.8` (120x40) hosting the installed binary via `opencode --standalone` (the TUI spawns `opencode serve --stdio --port 0` as its in-process server), isolated `XDG_DATA_HOME`/`XDG_STATE_HOME`, model `9router-go/KiloCode-Free`. The Ernie variant the user first pointed at (`kc/baidu/ernie-5.5-flash-preview:free`) does not resolve in opencode: the global `~/.config/opencode/opencode.jsonc` `9router-go` provider declares exactly four models (Antigravity-Free, Opencode-Free, Cline-Free, KiloCode-Free) and the 9router gateway answers "You need to sign in to use this model" for the Ernie slug in every id spelling tried. KiloCode-Free is the only 9router model that authenticates in opencode and had already completed live `/goal-loop`s in this harness. tmux `capture-pane -p` yields addressed, line-numbered rows — enough to aim the mouse SGR right-click at the card, which flattened headless captures never allowed.
884. Armed evidence (wedge round, live): arming `/goal-loop` (precise condition with a digit, `sleep 75`, transcript-evidence condition — a fuzzy condition would have hijacked the objective into a SPEC.md dance) painted the pill `○ loop · v1/5 ○○○○○ · active · <1m ▴` with the bridge dead; the chrome was fed by the 15s stale-chrome tick + `refreshFromStorage` from `/tmp/opencode-goal-mirror/ses_e119589d5ffeooC4Z8CRgfs4P3.json` (later read: `status: achieved`, `loopIteration: 4`, `loopMaxLoops: 5`, `elapsedMs: 776843`). Palette `Ctrl+P` → filter `hud` → "Goal HUD: toggle card" → Enter: card painted (`◎ /goal-loop · v1/5`, rows `condition`/`now`/`hint`, buttons `[details] [unpin] [clear goal] [esc]`). Palette `pinned` → Enter: card button flipped `[pin]` → `[unpin]`, pill grew `· pin: run \`sleep 75\` and … ▾`. Right-click (SGR press+release) on the card's condition row: context menu painted (`menu / copy condition / copy evaluator reason / copy latest summary / copy dossier / save dossier file / clear goal`). The model ran and completed the condition; the evaluator armed v2, v3, v4 in sequence (each with `last ✓ met · this turn` on the card) and the loop ended itself with "◎ Loop complete after 4 iterations." — the pin text followed each re-armed condition and the menu stayed open through every boundary until terminal release.
885. Release evidence (wedge round, live): card and context menu fully absent from the chrome; a bare `Escape` press produced a byte-identical frame (no swallowed Esc layer, no collapse of anything); palette `hud` → "No results found" and palette `pinned` → "No results found" (XXVIII palette gating live); the acknowledgment pill reads `● loop complete · v4/5 · 12m · 1 turn ▴` — the loop position is kept on the ack pill only, exactly the XXVIII scope (874: history truthful, arming chrome cleared).
886. Release evidence, standalone round (live, no shadow): a second tmux session (`/tmp/opencode/goal-verify-healthy/`, plugin = worktree merge ref only, `9router-go/KiloCode-Free`, opencode 2.3.2) armed the same shape of goal (`sleep 45`) with the card open; the loop completed in one iteration ("◎ Loop complete after 1 iteration."). Post-terminal, palette `Goal: show status` → Enter **opened the `/goal` dialog live**: header `◎ /goal`, outcome line `achieved  1m · 1 turn` (no `· vN/M` — the 874 header gate verified live), the `loop v1 of at most 5 · 1 complete` rail rendered (iteration history, allowed by 874), the `snapshot unavailable - showing last known state` stale line painted (fresh `goal/get` 500'd — see 889), and the footer `[copy condition] [pin condition] [clear goal]`. The mirror recorded `ses_e117c2cabffeJQiUSU0h6RS061`: `status: achieved`, `loopIteration: 1`, `loopMaxLoops: 5`, `elapsedMs: 73077`. Esc closed the dialog (palette closed; composer back to calm; a byte-identical frame after Esc, no swallowed layer). Every wedged-round release signal also held here, without a shadow: card absent, palette `hud`/`pinned` → "No results found", ack pill `● loop complete · v1/5 · 1m · 1 turn ▴`.
887. Two failure modes for the `Goal: show status` palette row, both observed live, both pre-existing and out of scope for a verification pass: (a) shadow-wedge round — the row stays enabled for a finished record (872 deliberately kept the cache fallback) but activation is a silent no-op: the shadow handler throws before the controller runs, no notice is emitted, and the palette's `rpc.status(...).catch(() => {})` swallows the rejection; nothing paints, no error, no toast. (b) standalone round — the row works: the notice path delivers (`kind === "status"` → `showStatusDialog`) and the dialog opens from the cached terminal record with the stale line painted, because the fresh snapshot RPC 500'd on the wire (889). The 872-kept-fallback design is only a silent dead-end in mode (a); in (b) it behaves as designed. A cache-fallback-only dialog would unify both; a decision for its own workstream, not this one.
888. Honest limits. (a) The wedge round was injected by shadow re-registration, not produced by the host — fresh TCP serve answers the goal RPC 200 post-activation; the live host failure of 2026-11-18 is unreproducible on demand, but the standalone round reproduces the 500 posture without the shadow (889) — treat both as the same failure seen at two layers. (b) One model (KiloCode-Free, which echo-spams badly — hence tmux), two condition shapes; the Ernie model the user named is unreachable from opencode's 9router-go (883). (c) The context menu can open only by right-click (no keyboard path); right-click lands on any card cell — the condition row was used. Menu *item* activation was not exercised; every item releases through the same `releaseCompletion` state drop as the card, which the release evidence covers. (d) The 874 dialog header gate WAS exercised live this pass (886) — through the degraded path: goal RPC dead on the wire, stale line painted, dialog rendered from the cached terminal record. (e) The three arming/toggle predicates (hud, pin, loop.status) all read "No results found" post-terminal in both rounds — the XXVIII targets are verified live. (f) Convergence latency: the terminal intake landed via the 15s tick + mirror — the chat rendered "◎ Loop complete after …" (session content, not goal RPC) before the chrome flipped; at no point in either round did the TUI converge early. (g) markers unchanged (`files=63 tests=1624`); `bun ../scripts/spec-check.ts` from `test/` reports ok; no shipped files or tests changed in this pass; SPEC.md only. (h) The contaminated first "healthy" attempt (a project nested inside `/tmp/opencode/goal-verify-live/`, whose parent `opencode.json` lists the shadow plugin) inherited the wedge through config discovery — discarded; the clean round lives at `/tmp/opencode/goal-verify-healthy/` and logged all plugin loads for inspection.
889. New finding, host-side, unresolved: on opencode **2.3.2**, the standalone TUI's location-scoped RPC path fails deterministically. The TUI spawns `opencode serve --stdio --port 0`; inside it, `POST /api/rpc/goal/get` returns HTTP 500 on every call (observed at regular 30s intervals across two standalone runs, and forced by the dialog's fresh pull) with **zero** plugin-side or middleware-side log detail at any log level (debug included): no `rpc handler failed`, no `rpc call failed`, no `schema rejection` WARN, no defect line. Handlers nevertheless execute — the status notice reached the TUI and the dialog opened (886) — so the failure sits on the response path, after dispatch, not in the goal plugin. A fresh TCP `opencode serve` (same cwd, same plugins, same wire shape: `location[directory]=<cwd>`, deepObject, excess keys tolerated) answers `200` after plugin activation, `400 rpc.unavailable` during the activation window (the likely source of the live incident's `goal/list` 400), and `400 InvalidRequestError "Expected object at \"location\""` for a flat `location=…` string. Root cause not isolated — suspect the stdio transport/overlay (the in-TUI serve child) rather than the protocol stack; no host source was modified; this is reported as an observation with exact log lines, not a diagnosis. Why it matters here: every live round this pass, wedged or not, ran with dead wire-RPC and live one-way notices — XXVIII's release path never depended on a successful RPC call, and the mirror+tick carried the chrome correctly through completion. The live 2026-11-18 incident is consistent with seeing exactly this signature from the user's long-running service.
890. Verification (fresh at the amended HEAD): `bun ../scripts/spec-check.ts` from `test/` → `spec-check: ok (63 files, 1624 tests match SPEC.md)`; SPEC.md-only amendment; branch `wt/live-completion-release-verify` based on dev `b8773cd`; coordinator lease `live-completion-release-verify` submitted; the shift 882→889 is recorded in this section. Live evidence is the transcripts above; both throwaways are preserved on disk for inspection (`/tmp/opencode/goal-verify-live/` wedge, `/tmp/opencode/goal-verify-healthy/` clean, `/tmp/opencode/goal-verify-debug/` debug-level boot).

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXI — documentation/spec alignment sweep: the stale compaction-ladder and restore-compaction claims are retired (2026-11-18)

Armed condition of this iteration (verbatim from the loop): keep improving the current directory, fixing what needs fixing. A read-only audit found six static documentation/comment defects; all six are fixed here. No behavior changed; every fix points the reader at the shipped contract.

Interpretation. The repo's normative documents (SPEC.md) and inline comments had drifted behind the code on two topics: (1) whether `restore()` asks the host to compact (it never does — adopt-only, src/runtime/controller.ts `restore()`), and (2) what the boundary-compaction miss ladder does at 4+ misses (it never suspends — at 2 misses one host-unwilling warning, re-requests trickle every 3rd arm, the 4-miss cap is only a backstop final warning; Workstream BV). Left alone, a regression test restoring either stale behavior would look spec-compliant.

891. SPEC.md items 90(b), 95 and 97(b) now carry dated SUPERSEDED annotations pointing at the adopt-only fix and `docs/runtime.html`; Workstream AB (items 118-121) carries a SUPERSEDED annotation pointing at Workstream BV (items 227-228). History is annotated, not rewritten.
892. `src/runtime/compactor.ts` — the dead `"capped"` member of `BoundaryCompactMiss` is removed (it was constructed nowhere; every `reason:` site yields disabled/in-flight/cooldown/read-failed/too-small/busy/compact-failed). `test/loop.test.ts` — the stale "miss 4: capped" comment now describes the BV backstop.
893. `src/core/types.ts` — the `COMPACT_MISS_CAP` comment no longer claims requests are "suspended" past 4 misses; it describes the backstop warning and the every-3rd-arm trickle, matching the doc comment on `LoopCompactState.misses`. `src/core/config.ts` — the `maxLoopSummaryTokens` comment now states the enforced `max(200, tokens) * 4` (was `tokens*4`), matching src/runtime/evaluator.ts.
894. `AGENTS.md` and `README.md` — the documented `bun run check` composition now includes `check:spec` (the SPEC honesty gate that package.json actually runs); AGENTS.md previously mentioned it only once elsewhere in the file and contradicted its own requirements block.
895. SPEC.md's original Verification section no longer tells the tester to install the pre-rename `@el4cteo/opencode-goal`; it names the current `github:paumkim/opencode-goalv2#v1.1.0` specifier (the line-1909 historical occurrence is deliberately untouched as history).

Honest limits. (a) Documentation/comments only; no shipped behavior, API, or test expectation changed. (b) The enforced (first-occurrence) spec-check marker is unchanged at `files=63 tests=1624` — no shipped-file or test-count delta; `bun run check` green before submit. (c) Stale claims could in principle linger in other historical SPEC sections; those are records and are annotated only where an agent could mistake them for the operative contract.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXII — the standalone stdio child's `POST /api/rpc/goal/get` 500 posture, re-verified live through opencode-headless (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Re-verify the standalone stdio opencode child's /api/rpc/goal/get HTTP 500 posture live via opencode-headless, record the outcome as a new SPEC workstream on a wt branch, bun run check green, submit via coordinator."

Interpretation. Workstream XXX (item 889) first recorded this host-side finding from tmux-driven standalone runs; Workstream XXX item 886 exercised the dialog through the degraded path once already. This pass re-verifies the same posture on the opencode-headless route — `headless_start` pty plus `headless_send`/`headless_capture`/`headless_stop`, the drive route the `<opencode-cli>` guide now mandates — and records the outcome. No code changed; a verification-only pass.

896. Drive route: opencode-headless pty mode, not tmux. Throwaway scratch `/tmp/opencode/goal-stdio-recheck/` (not a git repo), isolated `XDG_DATA_HOME=/tmp/opencode/goal-stdio-recheck/data` (the stdio child's log landed at `data/opencode/log/opencode.log`), `opencode.json` with model `9router-go/KiloCode-Free` and `plugins` pointing at this repo at dev HEAD ba936cf. Installed binary: opencode v2.3.2. The TUI booted as `opencode --standalone /tmp/opencode/goal-stdio-recheck` (log line `cli starting ... args=["--standalone","/tmp/opencode/goal-stdio-recheck"]`), spawning in-process `opencode serve --stdio --port 0` with the goal plugin loaded (`loading plugin id=/home/pauk/Projects/opencode-v2-goal/opencode-goalv2`).
897. Armed goal (plain `/goal`, digit condition — the precise shape): "Run `sleep 30` in the bash tool. The goal is met once that command has completed." The model ran it (exit 0); the evaluator verdict landed `met` on turn 1 (chat line "Goal achieved (turn 1, 42s)."; pill transition `○ goal checking · 1m ▴` → `● goal achieved · <1m · 1 turn ▴`). The mirror recorded the session: `ses_e1122b340ffeci161xwoLFbubi.json` — `status: achieved`, `verdict: met`, `loopIteration: null`, `elapsedMs: 42368`, condition matches the armed text.
898. Fresh wire evidence, verbatim from the stdio child's log (the only `rpc` lines in the boot): `13:35:24.786Z POST /api/rpc/goal/get → HTTP 500` (http.span=3), `13:35:51.794Z → HTTP 500` (http.span=2; the palette-forced fresh pull — `Ctrl+P`, filter `show status`, Enter), `13:35:54.786Z → HTTP 500` (http.span=3; the stale-chrome re-pull). Zero 200s or 400s on any RPC route this run; no `goal/list` traffic (the goal was armed from chat, never listed). Zero plugin-side, middleware-side or schema-side detail for any of the three — no `rpc handler failed`, no defect line, no schema WARN: the only WARN lines in the whole log are three pre-existing `failed to load OpenCode provider config cause="OpencodeConsole.SignedOut"` entries (13:33:54, 13:34:54, 13:35:55) unrelated to RPC. (A `--debug` boot re-run was not part of this pass; the debug-level negative result stands from Workstream XXX.)
899. The failure remains on the response path, not in the plugin: the notices path is unaffected. The completion notice painted in the TUI, and the palette row `Goal: show status` activated a live dialog — header `◎ /goal`, outcome `achieved · <1m · 1 turn`, rail `history ✓ last met (turn 1) · 1 turn · 1 met · 0 not_met`, footer `[copy condition] [pin condition] [clear goal]` — with the stale line `snapshot unavailable - showing last known state` painted, i.e. the dialog rendered from the cached terminal record because the fresh snapshot RPC 500'd. That is the exact degraded path Workstream XXX recorded at item 886 and item 887(b) (in mode (b) the row works; the 872 cache fallback behaves as designed; only mode (a) — the shadow wedge — is the silent dead-end).
900. Posture: unchanged since Workstream XXX — host-side, opencode 2.3.2, scoped to the standalone stdio transport/overlay (suspected, not diagnosed); no host source modified; reported as observation with exact log lines, not as a root cause. SUPERSEDED (2026-11-18, Workstream XXXIII): the 500 mechanism was root-caused plugin-side — explicit-undefined record keys rejected by the host's JSONValue gate; see items 902–906. New this pass: the posture reproduced end-to-end on the opencode-headless pty route (previously tmux), and the 30s cadence produced exactly two samples in a short-lived goal (13:35:24 and 13:35:54), plus one dialog-forced call (13:35:51). The live-2026-11-18 incident signature (user's long-running service) remains consistent with this failure seen on the same binary.
901. Handling: child stopped via `headless_stop` after capture; scratch preserved at `/tmp/opencode/goal-stdio-recheck/` (log, `opencode.json`, `data/`); mirror `ses_e1122b340ffeci161xwoLFbubi.json` preserved as record. SPEC.md-only amendment on branch `wt/stdio-rpc-500-recheck`; markers unchanged at `files=63 tests=1624`; `bun run check` green before submit.

Honest limits. (a) One goal, one model, one run — this is a posture re-verification, not a root-cause hunt; the Ernie variant named by the user remains unreachable from opencode's 9router-go (Workstream XXX, item 883). (b) The 30s-cadence claim is thinner this run — the goal reached terminal in 42s; three samples total (two ticks, one dialog pull). (c) No TCP cross-check this pass; the TCP answers (200 post-activation / 400 pre-activation / flat-`location=` 400) stand from Workstream XXX items 882 and 889. (d) The 500 response body was not captured — the TUI swallows it and the stdio child logs only the status line, which is itself part of the finding. (e) No shipped files or tests changed; the enforced first-occurrence spec-check marker is unchanged; historical SPEC sections remain annotated records.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXIII — the stdio child's `POST /api/rpc/goal/get` 500, root-caused and fixed in-repo: explicit-undefined record keys rejected by the host's JSONValue gate (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Root-cause the stdio child's goal/get HTTP 500: probe the stdio transport directly and isolate plugin vs host; fix in-repo defects with tests, or record findings as a SPEC workstream. bun run check green; submit via coordinator."

902. Probe chain. (i) The standalone was relaunched on the opencode-headless pty route with the child's stderr inherited (`OPENCODE_PRINT_LOGS=1`), fresh scratch, model `9router-go/KiloCode-Free`. The file log alone carried nothing past the 500 status lines, but the inherited stderr surfaced the plugin's own logger, which the file log never carried: `[opencode-goal] goal event emit failed` with `SchemaError(Expected JSON value at "goal""pauseCause")` (verbatim path: `[goal][pauseCause]`), printed at arm time. (ii) Host internals (read-only inspection of the installed binary; no host source modified): the RPC dispatch maps a typed handler defect to `rpc.internal` and a result that fails schema validation to `rpc.invalid_output`, both surfaced as HTTP 500 `RpcInternalError`; the rpc.call path logs only defects, so a validation-failure 500 carries no log line at any level — exactly the observed silence. The host walks the goal object as a generic JSON value (the error path is `[goal][pauseCause]`, not a shallow passthrough of the declared output schema), so any explicit-undefined key anywhere in the payload is fatal to it, in every RPC response and every `changed` event. (iii) Manual `opencode serve --stdio` and default-mode boots under isolated scratch configs exercised the dispatch end-to-end (basic auth with a self-set `OPENCODE_PASSWORD`; `{"input":{"sessionID":…}}` envelope; `location[directory]=<cwd>` for location scoping): unauthenticated → 401; plugin not yet registered → 400 `rpc.unavailable`; correct call → 200 with `{"output":{"goal":…}}` — including with a fully populated real terminal snapshot seeded into the storage table under the host's `plugin:<utf16-hex-of-id>:goal/v1/<sessionID>` key shape (200; `goal` echoed). The seeded-record case returning 200 bisected the defect as in-memory-only.

903. Root cause. `record.X = undefined` writes on in-memory GoalRecords leave the key present with an undefined value: `finish()` set the pause cause to undefined unconditionally on every terminal transition; the resume path set reason and pause cause to undefined; the loop-advance path reset the verdict and the reason to undefined; the boundary-compaction code wrote nested loop-bookkeeping objects with undefined-valued streaks after a measurable arm and after a landing. JSON has no undefined, `structuredClone` preserves the key, and the host's JSONValue gate rejects the payload on its very first undefined-valued key, which is why the reported path is always `[goal][pauseCause]`. Those records are served verbatim to the host (the single-process standalone serves the TUI from the arming process's memory), so every poll after the first terminal transition 500'd — the observed sequence, all calls landing after the goal had reached terminal state. The mirror was never affected (`JSON.stringify` on save drops undefined keys), which is why the pill and the dialog painted via the mirror-degraded path with the stale line, while the `changed` events were dropped at the same gate, which is why the pill could not converge from events. Storage round-trips cleanse records, so fresh-booted processes served clean 200s and restart-vs-run confusion was never a variable.

904. Fix (in-repo, with tests). Point fixes — the five record assignments are now deletions; the two compaction literals that wrote nested explicit-undefined keys are now spread-then-delete (the `waitingSince` site already used `delete`). Choke point — the snapshot builder in src/runtime/controller.ts wraps its output in a new exported `stripUndefined` in src/core/wire.ts: a recursive plain-object/array rebuild that drops undefined-valued keys, preserves `null`, maps arrays element-wise and passes non-plain objects through. Every outgoing snapshot (goal/get, goal/list, changed events, the mirror) is now strict JSON regardless of future un-cleaned writes. New tests: the wire suite gains `stripUndefined` cases (deep delete, null preserved, arrays, non-plain pass-through, and the exact snapshot shape that produced the 500 round-trips strict JSON); the controller suite gains an end-to-end case asserting every emitted changed-snapshot across arm → stall-pause → user-prompt resume → met-finish stays free of explicit-undefined keys recursively. Test count moves 1624 → 1628; the enforced (first-occurrence) marker advances to `files=63 tests=1628` in this same commit.

905. Live verification (fixed plugin, fresh standalone, isolated config dir so the user's global plugins did not shadow it). Armed `/goal Run sleep 30 in the bash tool. The goal is met once that command has completed.` — the pill painted `goal active · <1m`; the model failed immediately on Console authentication (`Reconnect OpenCode Console to continue` — the pre-existing provider condition on this host, unrelated); the goal's failed terminal transition ran, the exact `finish` path that carried the defect. Zero `goal event emit failed` and zero SchemaError lines in the child stderr; the palette row `Goal: show status` opened a live dialog painting `failed · <1m · 0 turns`, `reason: Goal failed after an unrecoverable error: authentication failure`, `fix: authentication failure - /goal clear to reset` — i.e. a fresh RPC pull resolved and the payload parsed, with no `snapshot unavailable - showing last known state` stale line (the dashboard clears its stale flag only on a resolved, parsed pull). The pre-fix arm on the same boot path logged the SchemaError three times and could not converge from events.

906. Scope and honesty. The host's JSONValue gate is host-side behavior we do not and cannot modify; our payload violated the host's JSON contract, and the fix makes the plugin comply. This does not prove the host absence-walks anywhere else, and it does not explain why the host maps this class of failure to a 500 without any log line (host behavior, observed and worked around correctly, not diagnosed further). The 2026-11-17 background-service storm and the 2026-11-18 standalone 500s are the same mechanism (an in-memory record carrying explicit-undefined keys served to the JSONValue gate); the fix covers both, but no dedicated 2026-11-17-style live rerun was performed — there was no live incident to re-hunt. Notices were never affected. No host source was modified at any point; the TCP answers from Workstream XXX items 882 and 889 stand. Workstream XXXII's observation "host-side, suspected not diagnosed" is annotated SUPERSEDED at item 900 for the 500 mechanism specifically.

Honest limits. (a) The armed model was Console-auth-failing at this hour; the arming path, the pause/finish state machine, the event-emit path and the RPC pull all execute model-independently and were exercised end-to-end. (b) The failing-model condition is live and current on this host (unrelated to this plugin). (c) Proof that the pull resolved is the dashboard's own stale flag plus the absence of 500/SchemaError lines — the host does not log 2xx responses, so no 200 line exists to quote; this limit is stated plainly. (d) Markers: files unchanged at 63 (no new shipped file), tests 1624 → 1628; this same commit updates the enforced (first-occurrence) marker; historical trailing markers remain as recorded. (e) Historical SPEC sections remain annotated records; this amendment carries no new file/line citations; `bun run check` green before submit.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXIV — opt-in file log sink: `OPENCODE_GOAL_LOG_FILE` (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "keep on improving make it sturdy for a very long running session … if there are nothing else todo? keep looking for other things to keep on improving."

907. Motivation. Workstream XXX item 826(a) recorded the named consequence plainly: the plugin's logger is raw `console.*` and the host swallows it, so **restore is silent in production** — an operator whose goal silently fails to adopt has no log anywhere to look at. It was filed there as "candidate for a future iteration". This iteration ships that candidate, in the minimal shape that cannot destabilize the host: an opt-in file sink, off by default, best-effort throughout.
908. Behavior. New module `src/core/file-log.ts` exports `withFileSink(base, file, options?)` and `FILE_LOG_MAX_BYTES` (5 MiB). When `file` is unset or blank the base logger is returned unchanged (strictly opt-in, zero behavior change for existing installs). Otherwise every `info`/`warn`/`error` call still reaches the base logger first, then appends one JSON Lines object to the file: `{"ts": ISO, "level", "message", "data"?}`. Writes are `appendFileSync` inside a try that swallows every failure (a logging failure never throws into the caller and never affects a commit); a missing parent directory is created once and the append retried; a file exceeding `maxBytes` is rotated to `<file>.1` (replacing any previous `.1`) before the next append, so a very long session cannot grow the log without bound — one generation of history is kept. `safeStringify` survives cycles (`[circular]`), bigints (stringified) and `Error`s (`{name, message}`), so no log site can crash the sink. `src/index.ts` wires it: `const log = withFileSink(createLogger(), process.env.OPENCODE_GOAL_LOG_FILE)`.
909. Docs and honesty gates. `README.md` and `docs/config.html` both document `OPENCODE_GOAL_LOG_FILE` (the `env-vars` suite pins the src↔README↔config token sets to be identical). New test file `test/file-log.test.ts` (9 tests): opt-out passthrough, JSONL shape and timestamp, base-logger-still-called on write failure, missing-parent creation, rotation (rotate over cap, no rotate at/under cap, `.1` replaced), unserializable payloads, the 5 MiB default, and line integrity for a 100k-value write. Test count moves 1628 → **1637 pass / 0 fail**; packed files 63 → **64** (`src/core/file-log.ts` ships); `test/package-integrity.test.ts` count re-pinned to 64; the enforced (first-occurrence) SPEC marker and this workstream's trailing marker advance to `files=64 tests=1637` in this same commit.
910. Scope and honesty. This is a sink, not a host integration: the host's log routing remains what Workstream XXX item 826(a) recorded, and the SILENT-RESTORE consequence is now mitigated only for operators who set the env var — the default stays silent. Rotation keeps one `.1`; older lines are dropped by design. No other behavior changed; `bun run check` green before submit.

Honest limits. (a) The sink writes synchronously on the log path; log volume is low (arm/restore/loop/compaction bookkeeping, never per-tick), but a pathological writer could still pay fsync costs — accepted for durability simplicity. (b) No live host run was performed this iteration; the module is unit-tested and the wiring is one line in `src/index.ts` reviewed against `createLogger`. (c) `OPENCODE_GOAL_LOG_FILE` is documented as best-effort; rotation is rename-based and POSIX-atomic only in the same directory, which the implementation guarantees (`<file>.1` is a sibling). (d) Historical SPEC sections remain annotated records.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXV — completed-iteration retention cap: `loopHistory` bounded at 50 entries (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Bound loopHistory growth for very long sessions: add a retention cap so persisted records and outbound snapshots cannot grow unbounded across many /goal-loop iterations while recent history stays visible; add tests; bun run check green; commit on wt branch and submit via coordinator."

911. Motivation. Every landed `/goal-loop` iteration appended one `LoopEntry` to `record.loopHistory`, and the whole array rode every persisted record and every outbound snapshot (`snapshotRecord` `structuredClone`s the record wholesale). A 100-iteration session — this loop's own case, routine with `OPENCODE_GOAL_MAX_LOOPS` raised — recorded every iteration forever: ever-growing records, ever-growing clones on every snapshot, ever-growing planner-input arrays passed by reference. No bound existed anywhere.
912. Behavior. `src/core/types.ts` gains `MAX_LOOP_HISTORY_ENTRIES = 50`, `completedIterationCount(goal)` (retained + dropped; the one honest "total landed" number), `boundLoopHistory(entries)` (returns the newest `MAX_LOOP_HISTORY_ENTRIES` plus the drop delta) next to `COMPACT_MISS_CAP` (one import site for controller and formatters), and the record field `loopHistoryDropped?: number` (additive; absent when the cap never engaged). `assignLoopState` in `src/runtime/controller.ts` is the single write point: the local `history` array keeps everything (the `maxLoops` guard and the completion-message counts read it), only the record's copy is trimmed, newest first; the drop delta accumulates onto `record.loopHistoryDropped` and is logged. Persisted records and outbound snapshots (which clone the record) are therefore both bounded; the planner/re-anchor/evaluator inputs read the retained slice (the planner only ever injected the last 10 entries into the prompt anyway).
913. Honest displays. Everywhere a surface previously read `loopHistory.length` for "total landed" it now reads `completedIterationCount`: `src/core/hud.ts` pips and the iteration fallback, `src/hud-card.tsx` likewise, `src/tui-history.tsx` (bar, `barCaption`, `capReached`, and the rail fold arithmetic now splits into a retained count for row indexing and a total count for display). A trimmed rail now announces it: `src/tui-history.tsx` paints one faint row — `N older iteration(s) dropped from the record (retention cap)` — whenever `loopHistoryDropped > 0`. `src/core/dossier.ts` headings become `## Completed iterations (K most recent of M)` with an unknown-not-$0.00 note when trimmed (unchanged otherwise; the `dossier-outline` prefix slug match is unaffected). `src/core/spend-ledger.ts` heading becomes `## Per-iteration spend (K most recent of M landed iterations)` with the same note; `- Iterations recorded: N (+ J dropped by the retention cap; totals cover the retained iterations only)`; totals still sum measured retained iterations only — the dropped ones are unknown, never $0.00.
914. Tests. `test/loop.test.ts` gains three end-to-end cases: a 60-iteration loop under `maxLoops=100` lands active with exactly 50 retained entries (versions 11–60), `loopHistoryDropped=10`, the snapshot clone bounded, and a restore into a fresh controller reading the bounded persisted record; a 51-iteration loop under `maxLoops=51` exits cleanly at the cap with versions 2–51 retained and `loopHistoryDropped=1` (the `endClean` path bounded too); at/below the cap nothing is dropped and `loopHistoryDropped` stays absent. New `test/loop-history-retention.test.ts` (8 tests): the bounding helper at/below/beyond the cap, `completedIterationCount` with and without drops, the spend ledger's trimmed and untrimmed shapes, and the dossier's trimmed and untrimmed shapes. Test count moves 1637 → **1648 pass / 0 fail** (3 + 8 new); packed files stay **64**; the enforced (first-occurrence) SPEC marker and this workstream's trailing marker advance to `files=64 tests=1648` in this same commit.
915. Scope and honesty. The verdict trail (`record.history`) was deliberately left unbounded this iteration — flagged, not silently skipped; bounded and labeled in Workstream XXXVI (`MAX_VERDICT_HISTORY_ENTRIES`, `historyDropped`). The anti-repeat and near-duplicate gates at the arm saw the retained window only; a planner re-offering a condition completed more than 50 iterations ago was not caught — fixed in Workstream XXXVII (the persisted completed-condition ledger). `loopHistoryDropped` is a count, not a manifest: the dropped entries are gone by design. Restore round-trips the additive field through plugin storage unaided (`isRecord` never validated optional fields). `bun run check` green before submit.

Honest limits. (a) 50 is a fixed bound, not configurable — chosen so the planner window (10) is comfortably covered and the record stays small; a config knob was rejected as unjustified surface area. (b) No live 100-iteration session was driven; the cap is unit- and integration-tested at the controller level, including the persisted-bytes restore path. (c) Cumulative sums (spend, turns, tool calls) shown by the dossier/ledger after trimming cover retained iterations only and say so; there is no pre-drop grand total anywhere (it was never recorded). (d) `record.history` was unbounded at the time this workstream landed; it was bounded in Workstream XXXVI (`MAX_VERDICT_HISTORY_ENTRIES`, `historyDropped`) and this line is corrected accordingly (2026-11-18, Workstream XXXIX).

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXVI — verdict-trail retention made explicit: `historyDropped` and honest consumers (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Bound the verdict trail (record.history) for very long sessions: retain the newest entries behind an explicit dropped counter, make dossier/HUD/attestation consumers cap-aware and honest (unknowns, never fabricated); add tests; bun run check green; commit on wt branch and submit via coordinator."

916. Motivation. The verdict trail (`GoalRecord.history`, one entry per evaluated turn) was already spliced down to the newest 20 inside the evaluation path — but the cap was silent: no counter, so no display could distinguish "20 turns this session" from "20 of 143". Every consumer read `history.length` as the whole truth; the sealed dossier said "the shas the record quotes were re-probed" while a trimmed record no longer quoted them. The cap was correct behavior with unlabeled provenance; this workstream labels it.
917. Behavior. `src/core/types.ts` gains `MAX_VERDICT_HISTORY_ENTRIES = 20` (the existing splice bound, made referenceable), `totalVerdictCount(goal)` (retained + dropped), `boundVerdictHistory(entries)` (newest-first slice + drop delta), and the additive record field `historyDropped?: number`. The evaluation path in `src/runtime/controller.ts` computes the bound at the same single write point as before and accumulates the drop delta onto `record.historyDropped`, logging the drop. Persisted records and changed-snapshot clones are bounded (20 entries); a restore round-trips the counter unaided (`isRecord` never validated optional fields).
918. Honest displays and attestation. `src/core/dossier.ts`: the Verdict trail section reads `## Verdict trail (K most recent of M evaluated turns)` with an unknown-not-inferred note, and the tallies line ends in `retained turns only` when trimmed. `src/core/hud.ts`: remediation for a fully-not_met retained window renders `at least 20 not_met in a row` when drops exist (a lower bound, never an exact count the record cannot support); a streak broken inside the retained window stays exact. `src/tui-history.tsx`: the non-looped history block's counts gain a `retained turns only` qualifier and its streak suffix the same lower-bound grammar; the verdict trail caption becomes `K of M verdicts · N older dropped (retention cap)` — byte-identical when nothing was dropped. `src/core/dossier-seal.ts`: the attestation appendix gains, whenever either retention cap engaged, one `the retention caps` note naming the dropped iteration records and verdicts and stating the shas they quoted are not re-probed and never implied held — the GAP case and the table case both carry it.
919. Tests. `test/loop.test.ts` gains two controller-level cases (25 evaluated turns retain the newest 20 with `historyDropped = 5` on the record and on the snapshot clone; at/below the cap the counter stays absent). New `test/verdict-history-retention.test.ts` (11 tests): the bounding helper at/below/beyond the cap, `totalVerdictCount`, the dossier's trimmed and untrimmed shapes, the HUD lower-bound/exact/zero-drop remediation grammar, and the attestation appendix's trimmed and untrimmed shapes. Test count moves 1648 → **1661 pass / 0 fail** (2 + 11 new); packed files stay **64**; the enforced (first-occurrence) SPEC marker and this workstream's trailing marker advance to `files=64 tests=1661` in this same commit. `docs/runtime.html`'s "History kept" citation now points at `src/core/types.ts · MAX_VERDICT_HISTORY_ENTRIES` instead of the removed controller-local constant.

Honest limits. (a) The bound itself is unchanged (20) — this workstream adds provenance, not a smaller window. (b) `totalVerdictCount` covers the two retention counters only; there is still no pre-drop grand total for spend/turns across dropped verdicts (verdicts carry no token totals to sum). (c) Why-ledger rows and verdict-dot deep scrub cover the retained window only; the dropped entries are gone by design and are not recoverable from the record. (d) Iteration-mix bucketing for loop iterations whose verdicts were dropped reads as absent (unknown), which is the honest shape.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXVII — completed-condition ledger: the gates outlive the retained window (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Persist a bounded completed-condition ledger so loop anti-repeat and near-duplicate gates catch conditions completed before the retained 50-entry window; add tests; bun run check green; commit on wt branch and submit via coordinator."

920. Motivation. The anti-repeat gate (exact, punctuation-insensitive) and the near-duplicate gate (token containment >= 0.7 / Jaccard >= 0.6) at the loop arm both scanned a set built from the retained `loopHistory` window. Since Workstream XXXV that window is the newest 50 completed iterations; conditions older than that were invisible to the gates, so a planner re-offering a pre-window condition spun the loop on already-landed work forever.
921. Behavior. `src/core/types.ts` gains `MAX_COMPLETED_CONDITION_ENTRIES = 100`, `completedConditionCount(goal)`, and `boundCompletedConditions(entries)` (consecutive exact duplicates from a re-entered advance collapse; oldest past the cap are dropped and counted). `GoalRecord` gains the additive `completedConditions?: string[]` (every condition the loop has completed, oldest first, newest 100 kept) and `completedConditionsDropped?: number`. `src/runtime/controller.ts` maintains the ledger inside `assignLoopState` — the same single write point as the loop-history bound — pushing the just-achieved `record.condition` at both call sites (the normal advance, before re-arming, and every `endClean`), and adds the ledger to the `completed` set the anti-repeat and near-duplicate gates scan. Persisted records and outbound snapshot clones carry the bounded ledger; a restore round-trips it unaided.
922. Tests. New `test/completed-condition-ledger.test.ts` (6 unit tests: at/below/beyond cap, consecutive-duplicate collapse, `completedConditionCount`). `test/loop.test.ts` gains four controller-level cases in a new describe block: a planner's punctuation-drifted exact repeat of a pre-window condition ends the loop cleanly (fired after the condition fell out of the retained window); a near-duplicate of a pre-window completed condition ends the loop; the 105-iteration cap path keeps the newest 100 conditions with `completedConditionsDropped = 5`; dispose + restore round-trips the ledger. Test count moves 1661 → **1671 pass / 0 fail**; packed files stay **64**; the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1671` in this same commit. Also corrected item 915 in the XXXV section, which still claimed record.history was deliberately unbounded and the gates saw the retained window only — both fixed (XXXVI, this workstream).

Honest limits. (a) 100 entries is a fixed bound — older completed conditions are gone by design, and `completedConditionsDropped` counts them; there is no manifest of dropped strings. (b) The ledger stores condition strings only, not summaries or shas — it exists for the gates, not for display; no dossier/TUI surface reads it. (c) A 100-entry ledger still cannot catch a condition completed more than 100 iterations ago; the cap is the explicit, counted boundary of best effort. (d) The anti-repeat and near-duplicate thresholds themselves are unchanged; this workstream widens what they see, not how they judge.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXVIII — terminal goal records bounded at plugin storage (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Bound persisted goal records at plugin storage for very long sessions: prune terminal (ended/achieved/cleared) records past an explicit age or count cap on restore/startup, never touch active records, report what was pruned honestly; add tests; bun run check green; commit on wt branch and submit via coordinator."

923. Motivation. A goal that reaches a terminal status keeps its persisted record at `goal/v1/<sessionID>` (finish commits it; nothing ever removed it). Long-lived plugin storage therefore accumulated one dead record per finished goal, per session, forever — every restart scanned and carried them, and the storage grew without bound.
924. Behavior. `src/core/types.ts` gains `MAX_TERMINAL_RECORD_ENTRIES = 50` (per directory, newest kept), `TERMINAL_RECORD_MAX_AGE_MS = 30 days`, and the pure `selectTerminalRecordsToPrune(records, nowMs)` (age first by `endedAt` falling back to `startedAt`, then count cap on the survivors; live records are never offered; terminal records with no usable stamp are kept and counted as `unstampedKept`, never pruned). `GoalStore.pruneTerminal(directory, nowMs)` scans `goal/v1/` (same paging as `loadLive`), scopes to this directory only, and removes the selection through the normal per-session remove queue; in probe/readOnly mode it removes nothing and returns `readOnly: true` with the scanned count. `restore()` runs the prune before adopting live records; it is best-effort (a prune failure is logged and never blocks adoption) and logs one counts-only line (`scanned`/`pruned`/`kept`/`droppedAged`/`droppedBeyondCap`/`unstampedKept`) only when terminal records were seen. The log is the report; there is no hidden counter and the dropped records are not implied retained.
925. Tests. New `test/terminal-record-prune.test.ts` (7 unit tests: live-never-offered, age boundary strictness, count cap keeps newest 50, age-before-count interaction, unstamped kept, endedAt-wins-over-startedAt). `test/controller.test.ts` gains five restore-level cases in a new describe block: restore prunes aged terminal records while the active record is adopted and a counts-only log line is emitted; the count cap drops the oldest fresh terminal records; foreign-directory terminal records are untouched; unstamped terminal records are kept and reported; a probe-mode (readOnly) store removes nothing and reports `readOnly: true`. Test count moves 1671 → **1683 pass / 0 fail**; packed files stay **64**; the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1683` in this same commit. `docs/runtime.html` gains a "Storage hygiene" section stating the caps, the scoping, and the probe-mode behavior.

Honest limits. (a) The caps are fixed constants, not config knobs — by design; widening them is a reviewed code change, not a silent drift. (b) A terminal record pruned by the cap is gone by design and is not enumerated anywhere; `pruned` is a count, not a manifest. (c) Records with no `endedAt`/`startedAt` are kept forever by the age rule (their age can never be judged) — they are reported via `unstampedKept`, not silently absorbed. (d) The prune is per-directory: terminal records of other directories at the same plugin storage are untouched; cross-directory GC is out of scope. [Resolved by Workstream XLI (2026-11-18): restore() now prunes across all directories at plugin storage, applying the same caps per directory.] (e) Live records (active/paused) are never pruned, even if ancient — paused is resumable and is not terminal. (f) This workstream's rebuilt `dist/tui.js` (core constants bundle into it) was committed but was not claimed in the lease; the submit used `--force` as the sanctioned scope override, logged to the lease (`forcedScope: true`). Recorded in the XXXIX re-audit (2026-11-18) so the next rebuild of `dist/tui.js` is claimed up front.

<!-- spec-check files=68 tests=1893 -->

## Workstream XXXIX — SPEC/docs honesty re-audit against the tree (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Re-audit SPEC.md honesty items and docs/ claims against the tree; correct any contradictions (stale caps, 'unbounded'/'deliberately not' claims for now-bounded surfaces, unlabeled retention); keep stamps/marker honest; bun run check green; commit on wt branch and submit via coordinator."

926. Method. Every hit for the now-bounded surfaces (verdict trail, `loopHistory`, completed-condition ledger, terminal records, file log) was re-checked against the tree at dev HEAD `7306615` with fresh command output; hits whose claims were false at HEAD were corrected in place, each with an explicit dated note (never a silent rewrite). Findings corrected: item 13 and item 18 (original `/goal-loop` spec, "two consecutive zero-tool-call iterations pause the loop" — superseded by the never-pause policy; current tests pin the never-pause behavior); item 49 (re-arm hygiene section, same supersession and the same regression expectation rewritten); item 55 ("up to the last 24 verdicts" — retention capped at 20 in Workstream XXXVI; the 24 in `trailWindow` is the render window and never binds); the A-12 audit finding (gains a Resolution note: `loopHistory` bounded in XXXV; its Phase-1 "waive" stand was superseded); A-28 (the "folds into A-12" note records that both caps landed, so the record size — and this comparison — is bounded); the Phase-1 Waivers list and the Resolution summary (both now state the A-12 waiver was superseded, not current fact); the XXXV Honest limits line that still said `record.history` "remains unbounded" (bounded in XXXVI; line corrected); the XXXVIII Honest limits block (gains item (f): the rebuilt `dist/tui.js` was not claimed and the submit used `--force` as the sanctioned scope override, logged to the lease with `forcedScope: true` — recorded so the next rebuild is claimed up front).
927. Docs. `docs/runtime.html`: the "On this page" TOC gains the Storage hygiene anchor (the section shipped in XXXVIII but was never added to the TOC); the Retry and limits table gains rows for the retained loop history (newest 50, drops counted) and the completed-condition ledger (newest 100, deduped consecutively), so the table no longer under-documents the caps it implies are exhaustive. `docs/core.html`: the types.ts card now lists the retention constants it exports (`MAX_LOOP_HISTORY_ENTRIES`, `MAX_VERDICT_HISTORY_ENTRIES`, `MAX_COMPLETED_CONDITION_ENTRIES`, `MAX_TERMINAL_RECORD_ENTRIES`, `TERMINAL_RECORD_MAX_AGE_MS`). No behavior changed; no tests changed; marker stays `files=64 tests=1683`.
928. Verified honest rather than changed (checked, no contradiction found): docs/config.html `maxRetries` row (documented inert, matches code and README); docs/runtime.html "History kept: last 20 verdicts" row; README options table (`maxConditionChars` unlimited, `maxRetries` inert); docs/config.html probe-mode paragraph (read-only storage, restore has no side effects — matches probe/readOnly behavior); SPEC item 915 (already corrected in XXXVII to state XXXVI bounded the verdict trail); SPEC Workstream V/AJ items (explicitly SUPERSEDED-noted); the `unlimited` retry rows (true — retries are unlimited with capped backoff, by design).

Honest limits. (a) This audit corrects claims it could disprove from the tree and its docs; it does not re-verify every historical evidence log or pasted transcript in this file (those are dated records of what was observed at the time, kept as history). (b) In-place corrections are dated notes, not silent rewrites; the pre-correction text remains visible in git history at the parent of this workstream's commit. (c) The docs freshness stamp regenerates via `docs-watch` on the merged tree; `docs/changelog.html` rows are a pure function of git history and regenerate — they are never hand-edited to claim work that is not in history. (d) No code, test, or marker changes; `bun run check` (1683 tests) is the gate.

<!-- spec-check files=68 tests=1893 -->

## Workstream XL — Opportunistic terminal-record pruning on finish() (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Extend terminal-record pruning to fire without a restart — after a goal reaches a terminal status in finish() (or the equivalent single write point), opportunistically prune that directory's terminal records under the same age/count caps (best-effort, counts-only log, never blocks the finish, live records untouched); add controller-level tests; bun run check green; commit on wt branch and submit via coordinator."

929. Behavior. `src/runtime/controller.ts` `finish()`: once the just-finished record is durable (the `commit()` promise settles), an opportunistic prune of this directory's terminal records is chained off that same promise and applied under the identical caps as the restore path (`GoalStore.pruneTerminal` → `selectTerminalRecordsToPrune`; 30-day age cap judged by `endedAt` falling back to `startedAt`, per-directory count cap `MAX_TERMINAL_RECORD_ENTRIES = 50` kept newest-first). Fire-and-forget by contract: the promise returned by `finish()` is exactly the commit promise and never waits on the prune. Best-effort: a prune failure is logged (`terminal goal record prune failed`, with `sessionID` and error) and changes nothing — the finish path cannot wedge on storage hygiene. Live records and other directories' records are untouched by the shared selector. The counts-only log line (`scanned`/`pruned`/`kept`/`droppedAged`/`droppedBeyondCap`/`unstampedKept`, plus `readOnly` in probe mode) is emitted only when `scanned > 0`, matching the restore report. `dispose()` now awaits in-flight finish-time prunes (a `pendingPrunes` set, mirroring `pendingUsage`) before the final store flush, so process teardown cannot strand removals. The restore-time prune is unchanged and still runs. [Superseded in scope by Workstream XLI (2026-11-18): restore() now prunes across all directories at plugin storage; only this sentence's restore-time scope claims are affected. The finish-time prune remains scoped to this directory.]
930. Tests. Five new controller-level tests in `test/controller.test.ts`: (1) a finish prunes aged terminal records opportunistically — the fresh survivor and the just-finished record survive, both aged ones are removed, and the log report carries the exact counts (`scanned: 4, pruned: 2, droppedAged: 2, droppedBeyondCap: 0`); (2) the count cap drops the oldest fresh records beyond 50 (5 dropped, report `droppedBeyondCap: 5`), newest seeded record and the just-finished record kept; (3) ancient live records are never pruned however old; (4) a prune failure never breaks the finish path — the goal still reaches `achieved`, a warn is logged, nothing is removed; (5) a probe-mode (`readOnly`) store reports but removes nothing (`scanned: 1, pruned: 0, readOnly: true, unstampedKept: 1`). Suite 1683 → 1688 pass / 0 fail across 70 files; packed files stay 64.
931. Docs. `docs/runtime.html` Storage hygiene section now documents the finish-time opportunistic prune (fire-and-forget, best-effort, counts-only, `dispose()` settles in-flight prunes before the store flush) alongside the unchanged restore-time prune. No other normative claim changed.

Honest limits. (a) The prune runs once per finish, i.e. one extra pass over `goal/v1/` per terminal goal in addition to restore's single pass; at the observed storage sizes this is the same O(#records) scan and is deliberately opportunistic rather than interval-driven (no timer, no background loop). (b) The just-finished record participates in its own prune scan; it is the newest terminal record (endedAt = now), so it is never dropped by the count cap and never aged — asserted in test (1). (c) Dropped records are gone by design; the report is counts only. (d) The finish-time prune shares the restore prune's limits: only this directory's records are considered (the cross-directory GC gap noted in the XXXIX-honest limits remains open), and memory pressure between finishes is not addressed — this bounds the durable store, not the in-memory map. [Superseded by Workstream XLIII (2026-11-18): the finish-time prune now shares the restore path's all-directory scope (`pruneAllDirectories`) with per-directory caps.]

<!-- spec-check files=68 tests=1893 -->

## Workstream XLI — Cross-directory terminal-record GC at restore() (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Extend terminal-record pruning at restore() to all directories at plugin storage (not just this one): apply the same age/count caps per directory across the whole store, best-effort counts-only log, live records untouched; add controller-level tests; bun run check green"

932. Behavior. `src/runtime/store.ts` gains `GoalStore.pruneAllDirectories(nowMs)`: one scan of `goal/v1/` (same paging as `loadLive`), terminal records grouped by their `directory`, and `selectTerminalRecordsToPrune` applied to each group independently — a cap in one directory never evicts another directory's records. In probe/readOnly mode it removes nothing and reports `readOnly: true`. The report is counts only (`scanned`/`pruned`/`droppedAged`/`droppedBeyondCap`/`unstampedKept`) plus `directories` (how many distinct directories held at least one record in the scan). `restore()` in `src/runtime/controller.ts` now calls `pruneAllDirectories` instead of the this-directory `pruneTerminal`; the log line is unchanged in shape save for the added `directories` count, still emitted only when `scanned > 0`. Best-effort as before (a failure is logged and never blocks adoption). The finish-time opportunistic prune (Workstream XL) is intentionally unchanged and stays scoped to the calling controller's own directory. [Superseded in scope by Workstream XLIII (2026-11-18): the finish-time prune now calls `pruneAllDirectories`; the two paths are unified.]
933. Tests. Controller-level restore tests in `test/controller.test.ts`: (1) the former "records of another directory are never pruned" test is rewritten to the new contract — an aged foreign-directory terminal record is pruned at restore, a foreign live (paused) record is never pruned, a fresh foreign record is kept; (2) the count cap applies per directory independently across the whole store — 55 fresh records in this directory and 3 fresh in another both survive with the per-directory cap honored (this directory keeps the newest 50, the foreign directory keeps all 3). The restore-path selector unit tests are untouched; the selector itself is unchanged. Suite 1688 → 1689 pass / 0 fail across 70 files; packed files stay 64.
934. Docs. `docs/runtime.html` Storage hygiene now documents the all-directory restore-time prune (`GoalStore.pruneAllDirectories`, per-directory caps, a restart anywhere cleans up after every project) and clarifies the split: foreign-directory terminal records are pruned only at restore time; the finish-time prune stays this-directory; live records are never touched in any directory. XXXVIII honest-limit (d) and XL item 929 carry dated superseded/resolved notes (in place, history preserved). No other normative claim changed.

Honest limits. (a) The restore-time prune now removes terminal records belonging to directories whose sessions may be live on another process/host sharing the same plugin storage — by the same rules that apply to this directory (live = active/paused records are never touched; only terminal records past 30 days or beyond 50 per directory), but a shared storage root serving two concurrent projects via different plugin instances will now have each restore clean the other's finished goals. That is the armed condition's intent, recorded honestly. (b) `directories` counts every directory that held at least one record in the scan, not only those that contributed prunes. (c) The prune reports counts only; no manifest of which foreign records were dropped is kept anywhere. (d) The finish-time prune remains per-directory (XL scope); unifying the two paths was deliberately not done — the armed condition named restore() only. [Resolved by Workstream XLIII (2026-11-18): the finish-time prune now calls `pruneAllDirectories`; the two paths are unified.] (e) Live records are never pruned in any directory; paused is resumable and is not terminal.

<!-- spec-check files=68 tests=1893 -->

## Workstream XLII — Bounded in-memory terminal-goal map (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Bound the in-memory terminal-goal map for very long sessions: evict finished (terminal) records from GoalController's in-memory goals behind an explicit retention cap (durable storage stays the source of truth); live records never evicted and peek/get semantics preserved; add controller-level tests; bun run check green"

935. Behavior. `src/core/types.ts` gains `MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES = 20` (an explicit retention cap, sibling to the storage caps; core constants bundle into the TUI build, so `dist/tui.js` was rebuilt with this change). `src/runtime/controller.ts` gains `private evictTerminalGoalsBeyondRetention()`: it collects the non-live (terminal) records in the `goals` map, and when more than 20 accumulate, drops the oldest — by `endedAt`, falling back to `startedAt`, then to 0 — from `goals`, along with the now-useless `lastCommit`, `lastReanchorAt` and `pendingAnchors` entries for those sessionIDs. It runs synchronously in `finish()` after the record is marked terminal and before `commit()`; the just-finished record is by construction the newest, so it is never a victim. No durable writes happen in the eviction itself.
936. Semantics. Durable storage stays the source of truth: an evicted terminal record is still served by `peekSnapshot` and `spend` via a fresh storage read, exactly as it is served today for any pre-restart terminal record (restore adopts only live records). `get(sessionID)` — which is by design an in-memory-only, synchronous read — returns `undefined` for an evicted record, the same answer it gives after a process restart; nothing else changed about `peek`/`get`. Eviction is silent (no `changed(sessionID, null)` is re-announced): the terminal snapshot was already announced at finish time, and RPC `get`/`list` never served terminal records in the first place (`peekSnapshot` falls back to storage; `peekList` merges only live records). Live records (active/paused) are never evicted, whatever the cap.
937. Tests. Controller-level tests in `test/controller.test.ts` ("in-memory terminal-goal retention"): (1) after 21 finishes (cap 20 + 1) the oldest terminal record is evicted from memory while the newest 20 remain; the live record created afterwards stays in memory; durable storage retains all 21 records; `peekSnapshot` serves the evicted record from storage with its terminal status and turn count; `list()` shows exactly the 20 retained terminal snapshots. (2) live records are never evicted even when the terminal cap is exceeded by 5 (and `peekList` still serves the live record). (3) no eviction occurs at or below the cap. Suite 1689 → 1692 pass / 0 fail across 70 files; packed files stay 64. The restore/finish storage-prune paths are untouched.

Honest limits. (a) The cap is a fixed constant, not config — same posture as the other retention caps; widening it is a reviewed code change. (b) Eviction drops memory only; it never deletes storage, so `spend`/`peekSnapshot` for an evicted record still answer from durable storage (one storage read, like post-restart behavior). (c) The per-session `runtimes` entries for evicted terminal records are retained (they are tiny, inert after `finish()` quiesces them, and some are still referenced by in-flight epoch-guarded closures); only the `goals` map and the three bookkeeping maps are bounded. (d) Evicted terminal records stop appearing in the synchronous in-memory `list()` and in `get()`; `peekSnapshot` from storage is the supported path for them. (e) The eviction runs on the `finish()` path; records that reached terminal status any other way (there are none today) would be swept on the next finish.

<!-- spec-check files=68 tests=1893 -->

## Workstream XLIII — Finish-time prune unified with the restore-time all-directory prune (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Work the next gap, not the last one. ... unifying the XL finish-time prune with the XLI all-directory restore prune ..."

938. Motivation. Workstream XL shipped an opportunistic terminal-record prune in `finish()`, scoped to the calling controller's own directory. Workstream XLI then extended the restore-time prune to all directories at plugin storage but deliberately left the finish-time prune per-directory (its armed condition named restore() only), recorded as XLII-adjacent open gap and XLI honest limit (d). The two paths therefore disagreed: a restart anywhere cleaned up after every project, but a finish cleaned up only after its own — in a long-lived process that never restarts, foreign-directory terminal records accumulated at storage forever.
939. Behavior. `src/runtime/controller.ts` `finish()` now calls `GoalStore.pruneAllDirectories` — the exact method `restore()` uses — instead of the this-directory `GoalStore.pruneTerminal`. The finish-time counts-only log line gains the same `directories` count the restore line carries. Fire-and-forget, best-effort and the `dispose()` settle semantics are unchanged; the in-memory eviction (XLII) is untouched. `GoalStore.pruneTerminal` had no remaining callers and is removed (no dead code); `pruneAllDirectories` and `selectTerminalRecordsToPrune` are unchanged — per-directory caps are applied independently, live records are never touched in any directory. `docs/runtime.html` Storage hygiene now states both prunes share one code path and one scope.
940. Tests. `test/controller.test.ts` gains one controller-level case ("the finish path prunes foreign-directory terminal records too (unified with restore scope)"): an aged foreign-directory terminal record is pruned at finish time, a foreign paused record and a foreign fresh terminal record survive, and the log report carries `directories: 2`. The pre-existing finish-time tests (aged pruning, count cap, live-never-pruned, failure isolation, probe mode) pass unchanged against the unified scope. `GoalStore.pruneTerminal`'s absence is pinned by the build (no callers). Suite 1692 → **1693 pass / 0 fail**; packed files stay **64**; the enforced (first-occurrence) SPEC marker and this workstream's trailing marker advance to `files=64 tests=1693` in this same commit.

Honest limits. (a) The finish-time prune now removes terminal records belonging to directories whose sessions may be live on another process/host sharing the same plugin storage — the same accepted trade-off recorded in XLI honest limit (a), now extended to the finish path: a shared storage root serving two concurrent projects will have each project's finishes clean the other's finished goals (only terminal records past 30 days or beyond 50 per directory; live records never touched). This is the unification the armed condition named; it is recorded honestly, not hidden. (b) The finish path now performs the same O(#records) scan over the whole store per terminal goal, not just this directory's slice — same complexity class as before, larger constant at shared storage roots; still opportunistic and fire-and-forget, never on the finish's critical path. (c) The prune reports counts only; no manifest of which foreign records were dropped is kept anywhere. (d) `GoalStore.pruneTerminal` was removed rather than kept "for compatibility" — it had exactly one caller (the finish path) and no external consumers; the public surface of the plugin is the plugin API, not `GoalStore`. (e) Evicted-from-memory records (XLII) are unaffected; durable storage remains the source of truth.

<!-- spec-check files=68 tests=1893 -->

## Workstream XLIV — Evaluator rubric: novelty, advancement and the forward-pointer gate (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Objective: make the /goal evaluator judge novelty and advancement, not just 'did something merge?' ... 1. Read the current evaluator rubric and verdict parsing ... 2. Extend the rubric with three explicit checks ... 3. Keep the verdict shape backward compatible. If the parser needs to enforce (b)/(c), fail closed to not_met with the reason quoted, exactly like the existing verifyCommand downgrade path. 4. Tests ... 5. Verification ... 6. (Strongly recommended, second phase) In the same workstream or a follow-up one, gate arming itself ..."

Interpretation: steps 1–5 are the required change; step 6 is explicitly scoped "in the same workstream or a follow-up one". XLIV ships steps 1–5. Step 6 is recorded as the out-of-scope complementary fix; shipping it here would silently inflate a rubric change into a loop-arming state-machine change. All fresh evidence cited below was produced this turn in the worktree, at the post-change HEAD.

941. Read first; wiring untouched. The evaluator rubric lives in `src/core/prompts.ts` (`RULES`, rendered by `rubric()` into both `evaluateInSession` and `evaluateIndependently`); verdict parsing lives in `src/core/verdict.ts` (`parseVerdict`, used by `src/runtime/evaluator.ts` for both the session and independent paths, and by the consensus path's `ask()`). The session/consensus evaluator wiring, `verifyMet` in `src/runtime/controller.ts`, and `Evaluator.evaluate()` were not touched. The rubric text, the parsed verdict shape (`{ verdict, reason }`, same synonyms, same `MAX_REASON` clamp) — plus one new and purely additive enforcement function — are the whole surface of the change.
942. The three rubric clauses (all answerable from the transcript text alone; both judge paths). (a) CONDITION FIT — the reason must name which clause(s) of the armed condition the in-turn evidence satisfies, and evidence must come from this turn's output at the post-change HEAD; narration, earlier turns' claims, a previous verdict, and absence-of-failure are not evidence. (b) NOVELTY / NO-DUPLICATE — if the armed condition is a near-duplicate of a condition completed earlier (the loop's own gate threshold: token containment >= 0.7 or Jaccard >= 0.6, case/punctuation ignored), the already-satisfied met is accepted only with a `next:` line naming the next concrete gap; a bare "Already satisfied" is not_met with reason `duplicate-without-forward-pointer`, and a met on duplicate work must state in the reason that it is a duplicate pass, not new advancement. (c) HONEST NEXT GAP — "Already satisfied"/"no work needed" reasons must name a specific next gap — a file, symbol or workstream drawn from this turn's audit; a vague "could improve X" is not_met.
943. The parse-enforced half (fail closed, quoting the reason, mirroring the verifyCommand downgrade). `src/core/verdict.ts` gains `applyForwardPointerGate(parsed)`, applied inside `parseVerdict` (and therefore on the `VERDICT:`-line fallback path too): a met verdict whose reason matches the already-satisfied class (`already[-\s]satisfied` / `no new work` / `nothing to do` / `no work needed`) without a `next:` line is downgraded to not_met with reason `duplicate-without-forward-pointer: … Original: <quoted original reason, clamped>`. Never upgrades a verdict; never touches not_met or impossible; never fires on a met that names its gap; the shape `{verdict, reason}` is unchanged. The near-duplicate threshold question itself is judge-side (the judge is the only party that sees the retained window) — the parser enforces only the "already-satisfied met with no forward pointer" class, which is decidable from the verdict text.
944. Tests (never weakened, never deleted). `test/core.test.ts` — six new parse-level cases pinning the gate (duplicate-with-pointer met stays met; duplicate-without-pointer → not_met with the original reason quoted; both `no new work`/`nothing to do` phrasings gated; new-work met untouched; `VERDICT:` fallback gated the same; not_met/impossible never gated) plus one rubric pin asserting both evaluation paths print `Condition fit` / `Novelty / no-duplicate` / `token containment >= 0.7 or Jaccard >= 0.6` / `duplicate-without-forward-pointer` / `Honest next gap`. `test/evaluator.test.ts` — six new mock-transcript cases at the `Evaluator` boundary: duplicate-with-pointer met; duplicate-without-pointer fail-closed (including through the `REPAIR` retry path); fresh-but-irrelevant merged work passes through as not_met with the condition-fit/novelty clauses confirmed in the prompt the judge sees; fresh real merged gap verdicts met; both judge paths carry all three clauses verbatim. Suite 1693 → **1706 pass / 0 fail / 28 snapshots**; packed files stay **64**; the enforced (first-occurrence) SPEC marker and this workstream's marker advance to `files=64 tests=1706` in this same commit.

Honest limits. (a) An LLM rubric can still misfire — CONDITION FIT and the "state that it is a duplicate pass" half of (b) are judge-side prose; the parser enforces only the already-satisfied-without-`next:` class of (b)/(c). A met carrying a vague `next:` line ("next: make it better") passes the gate; vagueness of a present pointer is not machine-checkable. (b) The "near-duplicate of a condition completed in the retained window" determination is made by the judge from the visible transcript (independent mode sees a bounded digest; detail older than the window is invisible by design) — the parser cannot re-derive containment/Jaccard from the verdict reason and does not pretend to. (c) A met on genuinely new work that quotes the phrase "Already satisfied" for an unrelated prior step (e.g. "…the test file was already satisfied before I fixed the flake") trips the gate and is downgraded; the quoted reason preserves the original for review — same trade the verification gate makes (fail closed, quoted evidence), recorded honestly. (d) STEP 6 IS OUT OF SCOPE FOR XLIV, deliberately: the arming-side near-duplicate gate (before arming an iteration condition, run it through the anti-repeat and near-duplicate gates against the persisted `completedConditions` ledger, and on a hit terminate the loop with an explicit "no new gap" reason instead of arming) was **not implemented here**. What exists at HEAD today: in `src/runtime/controller.ts` the loop advance path already runs both the exact (normalized) repeat check and the `isNearDuplicate` token gate (token containment >= 0.7 / Jaccard >= 0.6) against `record.completedConditions` before arming a planner-proposed iteration — at the planner re-arm boundary only. Nothing gates the initial `/goal-loop` arm in `arm()` against the session's prior terminal ledger, and no "no new gap" loopNotProgress-style event is emitted on a skipped arm. That is the complementary fix and remains open; do not read XLIV as closing it. (e) The arming-side gate is therefore the named next gap for this line of work.

<!-- spec-check files=68 tests=1893 -->

## Workstream XLV — Arming-side no-new-gap gate (2026-11-18)

The armed-condition step XLIV deferred (step 6 of the loop's condition; recorded there as honest limit (d) and the named next gap): gate arming itself. This iteration implements it. Fresh evidence cited below was produced this turn in the worktree, at the post-change HEAD.

945. Where the gate landed. `src/runtime/controller.ts` gains module-level `normalizeCondition` (lowercase, collapse every run of non-alphanumerics to one space, unicode letters/numbers kept — the exact regex the planner gate used inline), `ledgerOf(record)` (the completed-condition ledger: persisted `completedConditions`, plus met `loopHistory` conditions, plus the record's own `condition` only when `status === "achieved"`), and `completedLedgerHit(candidate, ledger)` (exact normalized repeat, else token containment >= 0.7 / Jaccard >= 0.6 — the loop's own gate thresholds, verbatim). The planner re-arm boundary keeps both gates unchanged in behavior (its `normalize` now aliases the shared helper); its two "planner keeps offering" endClean reasons gained the explicit phrase "no new gap" so both gates speak the same words.
946. The initial `/goal-loop` arm is gated (loop-only). In `arm()`, loop arms collect the prior ledger from (a) the record about to be replaced — captured from memory BEFORE `finish()` overwrites the in-memory slot — and (b) `store.load(sessionID)` from durable storage (restore() only adopts live records; terminal ones never reach memory). Ledger semantics were tightened from the first draft against a real failure: a cleared or failed arm never demonstrated its condition, so its `condition` is NOT treated as completed (it was trial-and-error'd out by an existing guarantee — `verify.test.ts` pins that a failed verification keeps the goal active); the loop objective is excluded by design — iteration 1's condition is the objective, so any completed iteration under the objective is already in `completedConditions`. On a hit, NOTHING IS ARMED: a terminal record (status `achieved`, empty history, `loopIteration` 1, `loopNotProgress` 1, reason beginning `no new gap`) carrying the carried-forward ledger (bounded, drop counts preserved) is persisted — the session forgets nothing — the user gets one `kind: "loop"` warning toast ("Loop not armed: no new gap", the same reason string), the log warns with the matched entry, and NO kickoff prompt is sent (`set()` returns before dispatching the directive); on the prompt-hook path the user's original line is restored verbatim (`src/index.ts`) so no directive rides an un-armed session. This is the same fail-closed posture as XLIV's forward-pointer gate and the verification gate: refuse, persist the reason, quote nothing away.
947. Tests (never weakened, never deleted). `test/loop.test.ts`, new `describe("arming-side no-new-gap gate (XLV)")` with eight cases: refusal at the initial arm (terminal record, explicit reason with the near-duplicate named, notice on the loop channel, no kickoff prompt, `loopNotProgress` 1, ledger preserved); case/punctuation-insensitive repeat; containment >= 0.7 near-duplicate; a genuinely new objective arms normally (active, iteration 1, kickoff sent); the gate is loop-only (a plain `/goal` with the completed objective still arms); the refusal record persists with the ledger carried forward; cross-restart refusal via `restore()` (the fresh controller adopts nothing live and still refuses from durable storage); and the session is not wedged — a new objective arms after a refusal. Suite 1706 -> **1714 pass / 0 fail / 28 snapshots**; packed files stay **64**; the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1714` in this same commit.
948. What the refusal is NOT. No iteration is fabricated: history stays empty and no verdict is recorded on a refused arm — `loopNotProgress` counts it as one zero-tool arm, which is harness-true (no tool ever ran for it), not as a completed iteration. No record is deleted: the carried-forward ledger is bounded (100 newest) and never shrinks. No non-loop goal is refused. The docs guard list in `docs/runtime.html` (/goal-loop section) gained one bullet for the refusal; nothing else in docs changed, and no `file.ts:N` citation was introduced.

Honest limits. (a) Scope is this session's completed-condition ledger, by design (XXXVII's persistence model); near-duplicate objectives across sessions or directories are not detected — different sessions share no records today, and unioning them would cross tenant lines. (b) The initial-arm refusal ends as `achieved` — the vocabulary's cleanest "nothing new to do" (precedent: both loopAdvance gates end via endClean as achieved) with a reason beginning `no new gap`; there is no dedicated status, and the reason string is the grep target. (c) An objective reworded to underlap everything completed arms anyway (as it should) and can only be scored later at the verdict (XLIV) — token thresholds cannot read semantics. (d) The durable read is best-effort: an unreadable store degrades to the in-memory ledger with one log line; the arm is not failed. (e) No seeding: an ordinary fresh arm inherits no history — only the REFUSAL record carries the ledger forward, so a refused session is no worse off on the next attempt. (f) The re-arm gate and the initial arm gate are the two arming boundaries today; any future arming path must run the same `completedLedgerHit` test or it will re-open the hole this closes.

<!-- spec-check files=68 tests=1893 -->

## Workstream XLVI — Clean-history audit and the docs citation contract (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "everything the previous history compact it forgerget about them so you ran in a clean history. and the next task is to keep on improving the current repo. from back end to front end. keep on advancing to close all the flaws, and gaps." Interpretation: (i) verify the compaction/history machinery actually forgets what it claims to forget — the re-anchor, the retained windows, the terminal-record prunes — and record the audit; (ii) close at least one real, verifiable flaw.

949. The clean-history audit (fresh reads this turn; no code path changed): (a) the model-visible re-anchor is one-shot — `consumeAnchor` deletes on read and the text fires exactly once, volatile by design; the re-anchor carries the objective, the armed condition and at most the newest 10 completed iterations, each truncated to 100/160 characters; it never carries the full transcript. [Superseded in part 2026-11-18 by Workstreams LVII and LVIII: the re-anchor now emits the shared audit-and-stop block after the tree re-read mandate (LVII) and its history window is the newest 3 completed iterations, not 10 — `REANCHOR_HISTORY_INJECT_LIMIT = 3` in src/core/prompts.ts — with an honest `(N older completed iterations omitted — the bounded ledger rides the record)` line whenever history exceeds the window (LVIII); the 10-entry `HISTORY_INJECT_LIMIT` remains the default only for the directive/loopContinuation/summarizer/next-goal planner call sites, and bare `file.ts:N` citations stay banned. Annotated in place, never rewritten.] (b) Retained windows on the record stay bounded: verdict history 20 (`MAX_VERDICT_HISTORY_ENTRIES`), loop history 50 (`MAX_LOOP_HISTORY_ENTRIES`), completed-condition ledger 100 (`MAX_COMPLETED_CONDITION_ENTRIES`), in-memory terminal goals 20 (`MAX_IN_MEMORY_TERMINAL_GOAL_ENTRIES`). (c) Durable storage: `restore()` prunes terminal records at plugin storage across ALL directories under per-directory age/count caps (XXXIX–XLIII); `finish()` prunes the same way; live records are never touched. (d) TUI chrome: terminal chrome/pins/palette affordances release via `dropSessions` on the entries tick (re-pull window) and `expiredTerminalSessionIDs` — a finished loop's dialog position chrome renders only while live. (e) Stale-ref sweep: zero `file.ts:N` citations remain in `docs/*.html`; every `(src|packages)/...` source-extension token in `docs/*.html` resolves on disk (scripted re-scan this turn: 0 offenders; see 950); `docs/changelog.html` is regenerated by merge-next, never hand-edited. Conclusion: the forget path is as strong at HEAD as the design intends; the audit found no leak to fix, and none is invented.
950. The docs citation contract is now test-pinned and the one real staleness found is fixed. `test/docs-line-refs.test.ts` gains a `docs path references` describe with one case: every `(src|packages)/[...]... .{tsx,ts,js,mjs}` token appearing in `docs/*.html` must exist on disk (the ref class that drifts when a module is renamed; the earlier file.ts:N ban stays as is — both sections are independent). One real violation found by the re-scan and by hand: `docs/core.html` listed `normalizeVerdict` as an export of `src/core/verdict.ts` — it is a local function; the card now lists `ParsedVerdict`, `applyForwardPointerGate`, `parseVerdict` (the three real exports) and cross-references the XLIV gate. The other two flagged candidates (`AutoCompactor`'s `maybeCompact`/`compactAtBoundary`) are methods of the exported class, not stale — recorded here so the next reader does not "fix" correct docs.
951. The prompt-hook refusal path (XLV's `src/index.ts` restore) is now pinned. `test/plugin.test.ts` gains one case: a `/goal-loop` whose objective near-duplicates the session's durable `completedConditions` ledger is refused at the hook; the admitted message is the user's raw line (not the armed-loop directive); the persisted record is the refusal (terminal `achieved`, reason containing `no new gap`, `loopNotProgress` 1, ledger carried forward); one `kind: "loop"` warning toast names the refusal. XLV's restore wiring was previously untested (the controller path was pinned; the hook path was not).
952. Comment-only correctness: `src/runtime/controller.ts`'s `isNearDuplicate` header still claimed the gate scanned "MAX_VERDICT_HISTORY_ENTRIES <= 20" — it predates XXXVII's 100-entry ledger and XLV's arming gate. The header now names both surfaces and their real bounds. No behavior change.
953. SPEC.md line 2152's "Known deferred" (docs/config.html and docs/architecture.html line-reference drift, blocked on the `github-single-channel` lease) gained a dated in-place superseded note: both pages were re-anchored to `file · symbol` citations in the 2026-11-17 docs sweep, the full re-scan returns zero `file.ts:N` matches in `docs/*.html`, and the named lease is dead per the 2026-11-17 survey. The note is annotated, never rewritten.

Honest limits. (a) The clean-history audit is a point-in-time read of HEAD, not a proof: the durable store can hold pre-convergence terminal records until a finish/restore prunes them (by design), and a mid-flight session keeps at most one pending re-anchor (by design, volatile). (b) The new docs path test pins file EXISTENCE, not export identity — `docs/core.html` caught `normalizeVerdict` by review; a symbol-contract test was considered and rejected as brittle (method-style card listings such as `AutoCompactor (maybeCompact, compactAtBoundary)` read correctly). (c) The plugin-pin test seeds the prior terminal record directly in stub storage; it does not exercise `restore()` + hook + arm in sequence (each is pinned separately). (d) No TUI rendering change in this workstream: `dist/tui.js` byte-identical; the loop-refusal toast rides the existing `kind: "loop"` channel like every per-iteration toast. (e) Test count moved 1714 → **1716** (the two new pinned tests); packed files stay **64**; the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1716` in this same commit.

<!-- spec-check files=68 tests=1893 -->

## Workstream XLVII — The docs symbol-export contract (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Pin the docs symbol-export contract: every symbol in a docs/*.html card's Exports line must be exported by the module it names (documented allowlist for method-style listings); fix stale claims it surfaces; check green; SPEC note; marker bumped."

954. `test/docs-line-refs.test.ts` gains a `docs symbol-export contract` describe with one case. Every `<div class="card">` in `docs/*.html` that names a module (a `<code>src/...</code>` path) and carries an `<p>Exports: ...</p>` line has each `<code>SYMBOL</code>` in that line checked against the module's real exports: module-scope `export const/let/var/function/class/interface/type/enum NAME` declarations plus the names carried by `export { ... }` / `export type { ... }` lists (honoring `A as B` aliasing — the alias is the export). Exactly one class of listing is exempted, in `SYMBOL_EXPORT_ALLOWLIST` (module, symbol), with the reason documented in the test header: method-style listings, where a card names an exported class and its main methods on one line (today only `AutoCompactor` -> `maybeCompact`, `compactAtBoundary` in `src/runtime/compactor.ts`). The allowlist is not an escape hatch: for every allowlisted symbol the test additionally requires a method definition in the module (`(^|\n)\s+(async\s+)?SYMBOL\s*\(`, i.e. a two-space-or-deeper-indented declaration as this codebase writes methods). Scope today is `docs/core.html` (19 cards, 40 checked symbols); `docs/architecture.html` and the other pages carry no Exports lines and are untouched by the pin.
955. The re-scan at HEAD found **zero stale claims**: all 40 checked symbols are genuine exports, and the two method-style listings satisfy the method-existence check. No doc file changed in this workstream. This closes the hole XLVI left open deliberately — its honest limit (b) rejected a symbol pin as brittle; the brittleness was solved by parsing exports mechanically instead of eyeballing them, and by carving the single method-style exception into an explicit, checked allowlist rather than a heuristic.
956. The pin was negative-controlled three ways before commit (all three reverted after): (i) a bogus plain symbol (`parseModelRefX` in the `config.ts` card) fails with "not exported by the module, not allowlisted method-style"; (ii) a bogus method-style symbol (`compactAtBoundaryXYZ`) fails the same way when unlisted; (iii) the same bogus symbol fails with the distinct "allowlisted method-style, but no method definition found in the module" once allowlisted, proving the allowlist branch checks rather than waves through. One process note: a first edit aimed at the Exports line missed into the card's prose (the prose also cites `<code>compactAtBoundary</code>`); the diff was re-audited and the prose restored — a reminder that negative controls must target the exact construct under test.

Honest limits. (a) The contract covers Exports lines only — it does not verify prose claims (`smoke-test the real binary`, etc.) or the `· symbol` citations elsewhere in docs (those are the 2026-11-17 `file · symbol` convention; a same-shape pin for them is a possible future workstream, not this one). (b) The parser recognizes named export declarations and `export { }`/`export type { }` lists; it does not evaluate `export * from` re-exports (none exist in src/ today) — a future re-export would read as stale until the test is taught it. (c) The method-existence check is a textual check, not an AST walk — an `AutoCompactor`-shape class with a method defined via a getter or a class field arrow function would need the allowlist pattern extended or the card reworded. (d) Cards without an Exports line (none today) are skipped by design. (e) Test count moved 1716 → **1717** (one new pinned test); packed files stay **64**; the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1717` in this same commit. `dist/tui.js` byte-unchanged; no behavior change anywhere; the only file edited besides this note is `test/docs-line-refs.test.ts`.

<!-- spec-check files=68 tests=1893 -->

## Workstream XLVIII — The docs inline-citation contract (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Pin the docs inline-citation contract: every `file · symbol` citation in docs/*.html must resolve — the cited file exists and the symbol appears in that module's source; fix stale citations it surfaces; check green; SPEC note; marker bumped."

957. `test/docs-line-refs.test.ts` gains a `docs inline-citation contract` describe with one case. It scans every `<code>...</code>` tag in `docs/*.html` for a citation of the shape `(src|packages)/<path>.<ext> · <symbols>` (the 2026-11-17 `file · symbol` convention). For each citation: the cited module must exist on disk (root-relative); the symbol portion is split on `·` and `/` — alternatives like `evaluate()/finish()` and additional `·`-separated symbols drawn from the same module (`types.ts · A · B`) — each part's trailing `()` is dropped, and every dotted component of the part must appear in the cited module's source. Textual component check by design: it is the strongest honest pin available without an AST walk, and it cannot be waved through by a qualifier (a renamed `GoalStore` or `Runtime` fails just like a renamed member). UI copy with a middle dot ("loop · vN/M", footers) cites no module and is ignored by the `src|packages` prefix anchor. Scope today: 13 + 6 + 3 + 18 = **40 citation-bearing code tags** in `docs/architecture.html`, `docs/index.html`, `docs/install.html`, `docs/runtime.html`; `docs/core.html` (Exports-card prose only), `docs/config.html`, `docs/changelog.html` carry none.
958. The re-scan at HEAD found **zero stale citations**: all 44 dotted components across the 40 citations appear in their cited modules (e.g. `GoalStore.pruneAllDirectories` — class and method both present in `src/runtime/store.ts`; `Runtime.epoch` — `interface Runtime` at `src/runtime/controller.ts` with the `epoch` field). No doc file changed in this workstream; the docs were already honest at HEAD. This closes the second half of the hole XLVII recorded as its honest limit (a) — the `file · symbol` prose citations are now pinned to the same standard as the card Exports lines, leaving no unpinned citation class in `docs/*.html`.
959. The pin was negative-controlled three ways before commit (all three reverted via `git checkout` after): (i) a bogus symbol component (`GoalStatusXYZ` in the architecture.html `types.ts · GoalStatus` citation) fails with "does not appear in the module's source"; (ii) a bogus dotted qualifier (`StaleXYZ.pruneAllDirectories` in the runtime.html store.ts citation) fails the same way, proving qualifiers are checked, not just member names; (iii) a citation naming a nonexistent module (`src/runtime/missing.ts · stale()` in index.html) fails this contract with "cited module does not exist" — and independently trips the XLVI `docs path references` contract, as designed. One parse note recorded for future editors: the citation regex requires the symbol portion inside the same `<code>` tag as the path; a citation split across tags would be invisible to the pin.

Honest limits. (a) The component check proves presence, not membership — `A.B` passes if both `A` and `B` appear anywhere in the module, even if `B` is never a member of `A`; a membership-grade check would need per-construct resolution and is not attempted. (b) `export * from` re-exports are untaught here as well (none exist in src/ today); a future re-export would not confound this pin since it checks source text, not exports. (c) Citations whose path part lacks a `src|packages` prefix (none today) are out of scope by design. (d) Test count moved 1717 → **1718** (one new pinned test); packed files stay **64**; the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1718` in this same commit. `dist/tui.js` byte-unchanged; no behavior change anywhere; the only file edited besides this note is `test/docs-line-refs.test.ts`.

<!-- spec-check files=68 tests=1893 -->
## Workstream XLIX — The docs inline-citation pin gains membership-grade checking (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Strengthen the docs inline-citation pin: for dotted citations whose qualifier resolves to a class or interface in the cited module, require the cited member to be defined in that construct's body (fields, methods, accessors); fix any stale citations it surfaces; check green; SPEC note; marker bumped."

960. `test/docs-line-refs.test.ts` — the `docs inline-citation contract` case now enforces, in addition to component presence, a **membership-grade** check for dotted parts: when the part's first component resolves to a `class|interface` declared in the cited module, the last component must be defined in that construct's body. The body is located textually — find `(export )?(abstract|declare )?(class|interface) <Name>`, then brace-match from its opening `{`, skipping string literals (`'…'`, `"…"`, template) and comments (`//`, `/* … */`) so nested bodies and apostrophes cannot skew the depth counter. A member counts as defined when it appears at a definition position — line start (or after `{` / `;`), optionally preceded by modifiers (`public|private|protected|readonly|static|abstract|override|declare|async|get|set|accessor`), followed by `?`, `(`, `<`, `:`, `=`, or `;` — which covers methods, fields, accessors, constructor parameter properties (`private readonly storage: …`), and interface members. `this.member` call sites cannot masquerade as definitions (a `.` directly precedes them). Dotted parts whose qualifier names no class/interface in the module (free-function namespaces, re-exports) keep the pre-existing component-presence behavior, unchanged.
961. The re-scan at HEAD surfaced **zero stale citations** — all five membership-relevant citations resolve inside their constructs (`GoalStore.pruneAllDirectories` — method in `src/runtime/store.ts`; `GoalController.evictTerminalGoalsBeyondRetention` — private method in `src/runtime/controller.ts`; `Runtime.epoch` ×2 — interface field in `src/runtime/controller.ts`). No doc file changed.
962. Negative controls before commit, all reverted via `git checkout`: (i) `GoalStore.pruneAllDirectoriesXYZ` fails both the component check and the membership check with distinct messages; (ii) `Runtime.backoffMs` — `backoffMs` **does** appear in `src/runtime/controller.ts` (module-scope const), so component presence passes, but the membership check fails it because it is not a member of `interface Runtime` — this is the exact gap the strengthening closes; (iii) reverted controls leave the suite green.

Honest limits. (a) Textual, not AST: a local bare assignment like `epoch = 5` inside a method would read as a "definition" of `epoch`; such shapes are rare in this codebase and are accepted. (b) Brace matching assumes type arguments contain no braces (true today; `class Foo<T = {…}>` would need an AST walk). (c) Qualifiers that are neither class nor interface in the cited module keep the presence-only check by design. (d) Test count stays **1718** and packed files stay **64** — this strengthens an existing case rather than adding one, so the enforced first-occurrence marker remains `files=64 tests=1718` (already accurate; no bump required). (e) Process note: an editing slip put the worktree's test file into the dev checkout mid-task; it was copied into `wt/docs-membership-citation-contract` and the dev checkout restored via `git checkout` before anything else — no dev commit was made. `dist/tui.js` byte-unchanged; only `test/docs-line-refs.test.ts` and this note change.

<!-- spec-check files=68 tests=1893 -->
## Workstream LI — the achieved goal's outcome note stops riding the context (2026-11-18)

Armed condition of this iteration (user request, not the fuzzy loop objective; handled as its own workstream): "if you are already working on the armed goal v4 why is v3 still lingering … fix it so it doesn't falsely remind you again after you have already achieved/done/completed. if done and completed and evaluator said done met? it needed to be gone no more lingering."

Diagnosis with durable evidence. The `kv` record for this session (`goal/v1/ses_e134c42a0ffeyYbvQ73oDtPuEm` in opencode's plugin storage) shows the full history: v2 = symbol-export pin (XLVII, met `c0a63bf`), v3 = inline-citation pin, judged met `85605fd` with the reason "Already satisfied … duplicate of the prior iteration's condition … duplicate pass, not new advancement" and `toolCalls: 0`, v4 armed `1795029504557` with the membership-grade strengthening. The standing system reminder already only fires for `active` records (`activeCondition`), and terminal `<goal-note final>` messages are already stripped from model-bound context by the `context` hook (Workstream EM). The one reminder that kept re-injecting the just-completed goal on every later request was the **loop-arm advance note**: plain `<goal-note>`, emitted at every met `loopAdvance` (`Loop N of M achieved (turn T); goal vK armed.`), folded into context forever — even though the armed kickoff (`loopContinuation`) carries everything it repeats (iteration, maxLoops, condition, previous summary, met reason). That is the "false reminder after already achieved" the user reported, with the screenshot showing the terminal outcome line above a v4-active pill.

516. `src/runtime/controller.ts` — the loop-arm `note()` call in `loopAdvance` now passes `{ final: true }` (with a comment saying why): the outcome line stays on the terminal and in the durable log, but leaves model-bound context on later turns, exactly like the achieved / impossible / loop-complete terminal notes. Plain `<goal-note>` notes are still a legal grammar (the context hook keeps them), but the controller no longer emits one.
517. `src/core/prompts.ts` — the `TERMINAL_NOTE_TAG` header comment documents the change (Loop EM's "loop advance notes stay plain" decision is superseded here, dated).
518. `test/loop.test.ts` — the loop-advance case now also asserts the emitted outcome note contains `<goal-note final>` (the hook's strip path is already covered by plugin.test.ts; the grammar wrapper itself by notes.test.ts).

Honest limits. (a) The host folds durable session input into context at its own discretion; this removes the note from the bound request, not from the transcript, the terminal scrollback, or the durable log — the outcome lines remain visible and auditable. (b) This does not delete or alter any goal record; the `kv` ledger is untouched. (c) The armed kickoff is unchanged and remains the model's state carrier for the armed iteration. (d) Zero-tool "Already satisfied" turns identical to the v3 landing remain possible by design (the evaluator rubric and the zero-tool guard allow the already-satisfied case); this workstream removes the stale reminder, not the possibility of a no-op iteration when a loop re-arms an objective that was completed in an earlier turn of the same session. Marker stays `files=64 tests=1718` (one assertion modified, no new test). `dist/tui.js` byte-unchanged.

<!-- spec-check files=68 tests=1893 -->
## Workstream LII — legacy plain goal notes leave the model's context too (2026-11-18)

Armed condition of this iteration (user request, verbatim `<goal-note>` quote of the stale outcome line): "so it doesn't falsely remind you again after you have already achieved/done/completed. if done and completed and evaluator said done met? it needed to ve gone no more lingering."

Diagnosis with durable evidence. Workstream LI stopped NEW loop-arm outcome notes from riding context, but notes emitted before LI — plain `<goal-note>`, e.g. the v3→v4 arm note "Loop 3 of 100 achieved (turn 1); goal v4 armed." — remain in the durable session and are folded into every later request. `stripTerminalGoalNotes` matched only the `<goal-note final>` tag, so the stale reminder persisted verbatim; the user pasted it back as evidence.

519. `src/core/prompts.ts` — `isGoalNoteMessage` (renamed from `isTerminalGoalNoteMessage`) matches any text content part carrying `<goal-note` (both grammars); `stripGoalNotes` (renamed from `stripTerminalGoalNotes`) drops them. Structural, host-shape-tolerant, unknown shapes never match. `TERMINAL_NOTE_TAG` and `note()` are unchanged (final remains the terminal grammar; plain remains a legal-but-obsolete emission shape).
520. `src/index.ts` — the `context` hook uses `stripGoalNotes`; comment updated. Both note kinds now leave the model-bound context on every later turn; neither is deleted from the transcript, the terminal, or the log.
521. `test/notes.test.ts` — renamed describes; the plain loop-advance message now matched (false→true), the strip list drops a plain and a final note; input-preservation and empty-list cases unchanged. `test/plugin.test.ts` — the hook test now expects only the real user task to survive a terminal AND a plain goal-note.

Honest limits. (a) The durable session still contains the legacy notes — the host folds durable input into context, so this removes them at the bound-request layer, not from history (per EM's standing limit). (b) A user who literally typed `<goal-note` into their own prompt would have that text part matched; goal notes are plugin-only grammar, accepted since EM. (c) `stripGoalNotes` removes plain notes wholesale rather than selectively keeping "current" ones — the armed kickoff carries the armed state, and no plain note is an instruction since LI, so wholesale stripping cannot strand the loop. (d) Marker stays `files=64 tests=1718` (rename + assertions modified, no new test). `dist/tui.js` byte-unchanged.

<!-- spec-check files=68 tests=1893 -->
## Workstream LIII — the docs citation contracts gain a src-wide wildcard re-export absence pin (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "close the recorded `export * from` hole in the docs citation contracts — add a src-wide absence pin (or re-export resolution) so a future re-export can't silently bypass the symbol-export and inline-citation pins; negative control shown; check green; SPEC note; marker bumped."

Interpretation: absence, not resolution. Teaching both contracts to walk wildcard chains would make them stronger on paper and much larger in practice (transitive cycle detection, target resolution, alias tracking) for a construct that does not exist in the tree today; the recorded hole (Workstream XLVII honest limit (b), Workstream XLVIII honest limit (b)) is that a *future* re-export would need the tests taught it. An absence pin closes that hole just as completely and far more simply: the construct cannot land unnoticed, and anyone who ever needs one must face this test and teach the citation contracts re-export resolution in the same change — in the open, not silently.

522. `test/docs-line-refs.test.ts` — new `src-wide wildcard re-export absence` describe with one case. It walks every `.ts`/`.tsx` file under `src/` and `packages/` (skipping `node_modules` and dot-directories; zero `.ts` files exist under `packages/` today, the scope is kept correct for the day one does) and fails with `file:line` if `export * from`, `export * as ns from`, or `export type * from` appears **in code**. Strings and comments are blanked before the scan (a state machine preserving newlines, like `constructBody` below), so prose mentioning the construct — a commented example, a doc comment — cannot trip it; a template literal is blanked whole, which is correct because an `export *` inside a template is not an export. Named re-exports (`export { A } from "./a.ts"`, with or without `as`) are deliberately allowed: the symbol-export contract already honors their aliasing, and forbidding them would duplicate that pin. Root entry surfaces (`index.ts`'s default re-export, `rpc.ts`'s `export * from "./src/rpc.ts"`) are out of scope because docs citations only ever name `src/`/`packages/` modules — and `rpc.ts`'s wildcard is the documented package entry surface, unchanged.

Negative control (shown before the real run): a planted `src/__negative_control__.ts` failed the new pin naming `src/__negative_control__.ts` line 1 for each of the three wildcard shapes in turn (`export * from`, `export * as ns from`, `export type * from`); a comment-only mention of `export * from` stayed green; the control file was deleted and the file removed from the tree before any commit. The rest of the suite was green throughout.

Honest limits. (a) Textual, not semantic by design — consistent with every other pin in this file; a wildcard constructed so pathologically that the blanking machine misparses it (unterminated string, regex literal containing a quote) would fail loudly, never silently. (b) The pin asserts absence, not resolution: if a legitimate wildcard ever lands, this test is the place to change — deliberately, alongside re-export resolution in the two citation contracts, not as a drive-by. (c) The root entry shims remain un-audited by the citation contracts (docs cannot cite them), unchanged from before. (d) Test count moved **1718 → 1719** (one new pinned test); packed files stay **64** (no `files` entry changes; `test/` is outside `package.json` `files`); the enforced first-occurrence marker advances to `files=64 tests=1719` in this same commit. `dist/tui.js` byte-unchanged; the only files edited are `test/docs-line-refs.test.ts` and this note.

<!-- spec-check files=68 tests=1893 -->

## Workstream LIV — the loop-advance re-arm no-new-gap refusal speaks the arming-side grep target (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Make the loop-advance re-arm boundary enforce the no-new-gap gate: an objective near-duplicating one already completed this session cannot arm the next iteration (refusal recorded, no marker churn); add a failing-then-passing test; check green; SPEC note; marker bumped."

Audit at HEAD `6876c68` (fresh output this turn). The re-arm boundary **already enforces** the gate, so this workstream pins and unifies the refusal contract rather than inventing enforcement: `src/runtime/controller.ts` `loopAdvance` runs the exact normalized repeat check and the `isNearDuplicate` token gate (containment >= 0.7 / Jaccard >= 0.6) against the ledger (record.condition, loopObjective, retained history conditions, completedConditions) and ends via `endClean` without arming vN+1 — pinned by `test/loop.test.ts` ("a near-duplicate proposal of a pre-window completed condition ends the loop", "a planner that re-proposes a near-duplicate of a completed condition ends the loop cleanly", "a planner that repeats an earlier iteration's condition ends the loop cleanly", and the punctuation-drift case). The refusal **is** recorded: `finish` persists terminal `achieved` with the reason, the notice fires ("Loop complete", `kind: "achieved"`), and the completed-condition ledger carries the just-achieved condition forward. The iteration counter was already not churned (`loopIteration` stays at the achieved iteration; no re-arm synthetic is dispatched). What did **not** hold: the refusal reason did not begin with the arming-side grep target. XLV documented its refusal reason string as "the grep target" (XLV honest limit (b)) and claimed "both gates speak the same words" — but the re-arm reasons began `Loop complete: no new gap — ...`, so a store-wide `/^no new gap/` silently missed every planner-side refusal while matching every arming-side one. No test pinned the re-arm refusal's grep-target vocabulary or the no-marker-churn property.

523. `src/runtime/controller.ts` — the two re-arm `endClean` reasons now lead with `no new gap: ` ("no new gap: the planner keeps offering [a near-duplicate of] the already-completed condition ..."). `already-completed` is retained verbatim, so every existing `/already-completed/i` pin stands; the notice (`kind: "achieved"`, title "Loop complete") and terminal `achieved` status are unchanged; the gate thresholds, the ledger scope, and the exit path are untouched.
524. `test/loop.test.ts` — new `describe("re-arm boundary no-new-gap refusal contract (LIV)")` with two cases, demonstrated **RED at HEAD** before the fix (both failed only on `/^no new gap/`: `2 fail | 142 pass`) and **GREEN** after (`144 pass | 0 fail`): (i) a near-duplicate re-arm refusal is terminal `achieved`, reason matches `/^no new gap/` and `/already-completed/i`, `loopIteration` NOT advanced (stays 2 — no marker churn), `completedConditions` carries the completed condition, and no "arming v3" synthetic is dispatched; (ii) the same contract on the exact-repeat path with a case/punctuation-drifted offer.

Honest limits. (a) Scope is the refusal contract and the pin; this workstream does not widen which objectives are refused — a different record's completed conditions in the same session remain out of the re-arm gate's reach (XLV honest limits (a) and (e), unchanged, deliberately), and the initial-arm gate is untouched. (b) The re-arm refusal still ends as `achieved` with the generic "Loop complete" toast — that notice shape is pinned by existing tests and was not weakened or re-titled; distinguishing a no-new-gap refusal from a LOOP_COMPLETE ending requires the reason grep, not the toast (same posture as XLV, where the reason string is the grep target and there is no dedicated status). (c) `loopNotProgress` is NOT forced to 1 on the re-arm refusal: it counts consecutive zero-tool iterations and the just-achieved iteration may have used tools; forcing it would churn a harness-true counter to make a point. (d) Test count moved **1719 → 1721** (two new pinned tests; nothing weakened, nothing deleted); packed files stay **64**; the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1721` in this same commit. `dist/tui.js` byte-unchanged; the only files edited are `src/runtime/controller.ts`, `test/loop.test.ts`, and this note.

<!-- spec-check files=68 tests=1893 -->

## Workstream LV — docs/runtime.html's /goal-loop guards list names the loop-advance re-arm refusal (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "docs/runtime.html /goal-loop guards list only the initial-arm refusal; add the missing loop-advance re-arm no-new-gap refusal bullet (reason begins with no new gap:, iteration not advanced, no kickoff, ends achieved), refresh stamps via docs-watch, check green; SPEC note; marker unchanged."

Audit at HEAD `c652e2e` (fresh output this turn). The guards list in `docs/runtime.html` (`<section id="goalloop">`) documented the initial `/goal-loop`-arm refusal (XLV/LIV's arming side) but not the loop-advance re-arm refusal that LIV landed — a reader of the user-facing docs could not discover the planner-side refusal or its `no new gap:` grep target. Every other clause of the condition held; the docs bullet was the one ABSENT item.

525. `docs/runtime.html` — the `/goal-loop` guards list gains one `<li>` after the initial-arm bullet: a loop-advance re-arm whose planner proposes an objective this session already completed (exact normalized repeat, or token containment >= 0.7 / Jaccard >= 0.6) is refused before the next iteration arms — the loop ends as achieved with a reason beginning `no new gap:` (the arming-side grep target), the iteration counter is not advanced (no marker churn), and no kickoff prompt is sent. No other section, page or citation changed; the adjacent initial-arm bullet is untouched. Stamps and the changelog table are regenerated via `bun scripts/docs-watch.ts once` in a separate mechanical commit on top.

Honest limits. (a) Docs-only: no source, test or gate changed; the LIV contract it documents (reason vocabulary, unadvanced `loopIteration`, no re-arm synthetic, terminal `achieved` via `endClean`) is pinned by `test/loop.test.ts`'s "re-arm boundary no-new-gap refusal contract (LIV)" describe and is not re-pinned here. (b) No test-count change: the enforced (first-occurrence) marker stays `files=64 tests=1721`; the historical section-local markers above keep their own counts. `dist/tui.js` byte-unchanged; the only files edited across the branch are `docs/runtime.html`, `docs/changelog.html` (mechanical stamp refresh) and this note. (c) The bullet names the refusal's user-visible contract only; the ledger scope (this session's completedConditions) and the deliberate out-of-scope limit (a different record's completed conditions, XLV honest limits (a) and (e)) are not repeated in the docs — the guards list stays one line per guard.
## Workstream LVI — the fresh /goal-loop arm does not inherit the replaced record's completedConditions (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Pin the completed-condition ledger scope at the fresh-arm boundary: a fresh /goal-loop arm does NOT inherit a different record's completedConditions (XLV limit (e), by design) — add a pinning test + SPEC note re-ratifying that scope; check green; marker unchanged."

Audit at HEAD `a2bc694` (fresh output this turn). XLV honest limit (e) re-ratified, verbatim from Workstream XLV: "No seeding: an ordinary fresh arm inherits no history — only the REFUSAL record carries the ledger forward, so a refused session is no worse off on the next attempt." The behavior was real but unpinned: in `arm()`, the ledger collected from the in-memory prior record and the durable same-session record feeds the no-new-gap gate decision only; the fresh record is built without `completedConditions`/`completedConditionsDropped` (only the refusal record carries them forward). A future refactor that seeded the fresh record from either source would have passed every gate silently.

526. `test/loop.test.ts` — one new case in the `describe("arming-side no-new-gap gate (XLV)")` block: after `completeLoop(h, "improve the parser")` leaves a terminal record persisted with a ledger containing that objective, a fresh `/goal-loop` arm of a genuinely new objective ("add fuzz coverage for the search index") arms active with `loopIteration` 1 and — the pinned property — no `completedConditions` and no `completedConditionsDropped`, both in memory and in the durable record at `goal/v1/<session>`. The refusal-path counterpart (a refused arm DOES carry the ledger forward) is already pinned by the existing cases in the same block; nothing was weakened, renamed or deleted. Loop suite 144 → 145 pass / 0 fail.

Marker decision (stated plainly; the armed condition said "marker unchanged"). A new test moves the enforced count, and `check:spec` fails unless the first-occurrence marker matches the tree in the same commit, so the enforced (first-occurrence) SPEC marker advances `files=64 tests=1721` → `files=64 tests=1722` here; `files=64` is unchanged. The literal reading (marker untouched while a test was added) was impossible, and the no-test alternative was rejected. Historical section-local markers above keep their own counts.

Honest limits. (a) Pin scope is the same-session fresh-arm boundary — the only place a different record could seed from, since `arm()` reads only the in-memory prior and the durable record for this session; cross-session leakage is structurally impossible today (sessions share no records) and remains XLV honest limit (a)'s territory. (b) The pin asserts absence of seeding, not the gate decision; the gate is pinned by the eight XLV cases and the prompt-hook path by XLVI. (c) No source change; `dist/tui.js` byte-unchanged; the only files edited are `test/loop.test.ts` and this note. (d) Test count moved **1721 → 1722**; packed files stay **64**.

## Workstream LVII — the post-compaction re-anchor carries the audit-and-stop clause (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Teach the post-compaction re-anchor the audit-and-stop clause: loopReanchor must direct the model to re-read the tree, audit the armed condition against HEAD, and respond exactly Already satisfied at HEAD <sha> when it holds — pin with a test; SPEC note; check green; marker same commit"

Audit at HEAD `22c5e1d` (fresh output this turn). `loopReanchor` already emitted the shared `TREE_TRUTH` re-read mandate, but not the audit-and-stop block that `loopContinuation` carries: after a compaction the model was told to "keep working toward the armed condition" with no instruction to audit that condition against HEAD first, so an already-satisfied armed condition would be re-worked after every compaction — the exact failure the `loopContinuation` audit-and-stop clause exists to prevent, on the one path (post-compaction) where the model's context had just been replaced by a lossy summary.

1. `src/core/prompts.ts` — the audit-and-stop lines extracted into one byte-identical shared constant `AUDIT_AND_STOP`, used by both `loopContinuation` and `loopReanchor` (same extraction pattern as `TREE_TRUTH`). `loopReanchor` now emits it after `TREE_TRUTH` and before the keep-working line, so the re-anchored model re-reads the tree, audits the armed condition against CURRENT HEAD, and answers exactly `Already satisfied at HEAD <sha>` when it holds. No other prompt text changed; `loopContinuation` output is byte-identical to before the extraction.
2. `test/loop.test.ts` — one new case in the `describe("loop prompts")` block pinning that the re-anchor carries the tree re-read mandate (`git log --oneline -5`), the `audit the armed condition against CURRENT HEAD` line, the `Already satisfied at HEAD <sha>` wording, the `If something is missing, proceed and show evidence.` fallback, and that the audit block precedes the keep-working line. Loop suite 145 → 146 pass / 0 fail.

Marker decision. A new test moves the enforced count, and `check:spec` fails unless the first-occurrence marker matches the tree in the same commit, so the enforced (first-occurrence) SPEC marker advances `files=64 tests=1722` → `files=64 tests=1723` here; `files=64` is unchanged. Historical section-local markers keep their own counts.

Honest limits. (a) Prompt-text only; no controller change — the re-anchor is still queued (`resume: false`), never a steer, and still fires only for live active loops. (b) The pin asserts text presence and ordering, not model behavior; the evaluator rubric remains the judge of an "Already satisfied at HEAD" claim. (c) No new exports; `dist/tui.js` byte-unchanged. (d) Test count moved **1722 → 1723**; packed files stay **64**.

## Workstream LVIII — the post-compaction re-anchor carries a bounded, honest history window (2026-11-18)

User request (verbatim): "can you also not hold too much old history carry on after the compaction? especially a long running session. it is starting to build up too much old done goals."

Audit at HEAD `b032347` (fresh output this turn). Everything durable was already bounded — verdict history 20, loop history 50 on the record, completed-condition ledger 100, in-memory terminal goals 20, terminal storage records 50 per directory plus a 30-day age prune — and the model-visible re-anchor is one-shot (`consumeAnchor` deletes on read). The one surface still growing with session length was the prompt-injected history block: `historyBlock` silently kept the newest 10 completed iterations (~100/160-character truncations each) in every loop prompt, and the post-compaction re-anchor — the prompt that lands right after the context was rebuilt from a lossy summary — carried all 10. For a long-running loop that is stale noise on the scarcest context the model has.

1. `src/core/prompts.ts` — `historyBlock` gains a `limit` parameter (default `HISTORY_INJECT_LIMIT = 10`, unchanged for `directive`/`loopContinuation`/summarizer/next-goal planner). A new `REANCHOR_HISTORY_INJECT_LIMIT = 3` is used only by `loopReanchor`, whose header now reads `Completed iterations (newest 3; older ones ride the record's bounded ledger):`. Whenever more entries exist than the limit, the block now starts with `(N older completed iterations omitted — the bounded ledger rides the record)` instead of dropping them silently — that honesty line applies to the default-limit call sites too, and only when history actually exceeds the limit (≤ 10 entries: byte-identical output to before).
2. `test/loop.test.ts` — one new case in `describe("loop prompts")` pinning the re-anchor's 3-entry window against a 12-entry history (v10–v12 present, v9 absent, `9 older completed iterations omitted`) and the no-omission-line case at or below the window. Loop suite 146 → 147 pass / 0 fail.

Marker decision. A new test moves the enforced count, and `check:spec` fails unless the first-occurrence marker matches the tree in the same commit, so the enforced (first-occurrence) SPEC marker advances `files=64 tests=1723` → `files=64 tests=1724` here; `files=64` is unchanged. Historical section-local markers keep their own counts.

Honest limits. (a) Injection-only change; the record caps (50/100/20/20/50) and their honest `*Dropped` counters are untouched, and the anti-repeat/near-duplicate gates still scan the persisted 100-entry ledger — no gate memory was reduced. (b) The omission line is text; the full ledger remains inspectable on the record, and the evaluator rubric is unchanged. (c) `dist/tui.js` byte-unchanged; no new exports. (d) Test count moved **1723 → 1724**; packed files stay **64**.

## Workstream LIX — post-LVII/LVIII dated corrections: the re-anchor history-window claims (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Correct post-LVII/LVIII stale claims (the clean-history audit in SPEC states the re-anchor carries 'at most the newest 10' completed iterations — now 3 with an honest omission line) via dated correction notes; sweep SPEC/docs/README for the same drift; check green; marker only if the test count moves."

Audit at HEAD `9832298` (fresh reads this turn). Two stale claims found after LVII/LVIII landed; both corrected in place with dated superseded brackets, never rewritten (the item 953 convention):

1. Workstream XLVI item 949(a), the clean-history audit: claimed the re-anchor "carries the objective, the armed condition and at most the newest 10 completed iterations, each truncated to 100/160 characters". Post-LVIII the re-anchor's history block runs at `REANCHOR_HISTORY_INJECT_LIMIT = 3` (src/core/prompts.ts) and prints `(N older completed iterations omitted — the bounded ledger rides the record)` whenever history exceeds the window; the 10-entry `HISTORY_INJECT_LIMIT` remains the default only for the directive/loopContinuation/summarizer/next-goal planner call sites, where output is byte-identical to before at or below the limit. Annotated in place; the rest of item 949 is untouched and still accurate (record caps 20/50/100/20, one-shot volatile re-anchor, prunes).
2. Workstream W item 99, the original re-anchor design note: claimed "History injection keeps the same -10 slice as the other loop prompts." Annotated in place the same way; the rest of Workstream W is untouched.

Sweep for the same drift across SPEC.md, docs/*.html, README.md (patterns: `newest 10`, `10 completed`, `history window`, `historyBlock`, `completed iterations from( its| the) record`): two hits found and fixed — docs/runtime.html (Compaction section) and README.md (Compaction paragraph) both stated the re-anchor restates "the completed iterations from the record"/"from its own record" with no bound; both now read "the newest three completed iterations from the record (older ones ride the record's bounded ledger …)". Everything else clean: SPEC items 7004/7006 (LVIII's own audit preamble and limit description) describe the pre-fix state and the 10-entry default accurately and are untouched; SPEC item 962's neighbor lines carry no other window claim; docs/config.html, docs/core.html, docs/architecture.html, docs/index.html, docs/install.html carry no re-anchor history-window claim; docs/runtime.html's Retry and limits table lists record windows only (verdict 20, loop history 50, ledger 100), still accurate, untouched; docs/changelog.html is regenerated by merge-next/docs-watch, never hand-edited; LVII's section carries no history-window claim.

Marker decision. No test moved; the enforced (first-occurrence) SPEC marker stays `files=64 tests=1724`; `files=64` is unchanged. Historical section-local markers keep their own counts.

Honest limits. (a) Dated-note corrections only — the XLVI audit body and the Workstream W design note are left intact behind inline superseded brackets, per the annotate-never-rewrite convention. (b) The docs edits are precision, not new documentation: the newest-3 bound is shipped LVIII behavior; no page gains a new claim class and no `file.ts:N` citation appears. In-place annotations were kept on the same physical lines so every SPEC line number cited elsewhere stays valid (item 949 remains on its original line). (c) No source or test change; `dist/tui.js` byte-unchanged. (d) README.md is unstamped; docs/runtime.html's stamp is refreshed by `bun scripts/docs-watch.ts once` in the mechanical refresh commit on top, never by hand.

## Workstream LX — the armed kickoff is dispatched with `resume: true` and painted `queued` between dispatch and execution start (2026-11-18)

User-reported gap (verbatim, this session): the v10 iteration armed and sat visibly idle — the ambient pill read `active`, nothing executed, and the user had to say "keep going" before the next iteration ran. Armed condition: diagnose why an armed `/goal-loop` can sit queued/pending with no autonomous turn; fix the arm→execution transition or make the pending state honest; test pin; SPEC note; check green; marker in the same commit.

Audit at HEAD `10100fd` (fresh output this turn). The arm→execution path has exactly one trigger, `continueWith` (src/runtime/controller.ts): after the met verdict is evaluated, the loop advances (summarize → nextGoal), the arm commits, a boundary compaction may be requested, and the armed kickoff is dispatched as `ctx.session.synthetic({ delivery: "steer", … })`. There is no independent timer, no poll, no second path. The plugin subscribes to `session.execution.started/succeeded/failed/interrupted` but NOT to the inbox events (`session.inbox.enqueued/delivered`), so nothing in the plugin can tell the user "the kickoff is admitted at the host and waiting to execute" — the TUI painted `active` for every state between verdict and next execution, including the whole queued window.

Diagnosis, with evidence:
1. The host contract is explicit (opencode v2 session spec, fetched this turn): `resume` controls scheduling, not durability — omitted or `true` records the input then schedules `SessionExecution.wake(sessionID)`; `false` records the input with no wake. `steer` delivery happens at the next Safe Step Boundary; at an idle boundary steers take priority. `session.synthetic` is the same inbox with the same `resume` knob (its docs show `resume: false` used deliberately for admit-only notes). The plugin never passed `resume` on the kickoff steer — its delivery depended entirely on the host default being wake. Notes already passed `resume: false` deliberately; the kickoff omitted the field.
2. The plugin had no positive signal in the queued window: `runtime.awaitingExecution` was set at dispatch (and used only to drop straggler evaluations) but never reached the snapshot, so the pill, the card and the status dialog were indistinguishable between "host has not started the kickoff" and "goal stuck/hung". This session's own history proves the wake does land when the host honors it (v11 of this very loop arrived autonomously as the synthetic kickoff) — the honest gap was that nothing could SAY so, and a host that did not wake left a silently parked loop.

Fix (both halves of the armed condition: the transition AND its visibility):
1. `continueWith` — the single dispatcher for continuations, retries, check-ins and loop arms — now passes `resume: true` on every kickoff steer (notes stay `resume: false`; re-anchor notes stay queue/admit-only by design). The port already typed `resume?: boolean`; no adapter change was needed.
2. The snapshot gains `queued?: boolean` (src/core/types.ts): present on every fresh snapshot (`true` only while `runtime.awaitingExecution` and the record is `active`; `false` on terminal/paused records and on records adopted before this field landed — never guessed). Emitted at the flip sites: dispatch (before the host accepts the steer), host `execution.started` (clears it), `execution.failed` (the retry window is queued too), `execution.interrupted` (inactivity/other non-superseded causes), and the `continueWith` catch path (dispatch failed, flag dropped).
3. The three pill/dialog state words learn it: `src/core/hud.ts` (`stateWord`), `src/hud-card.tsx` (`stateWord`) and `src/tui-history.tsx` (dialog `stateWord`) — active + kickoff in flight paints `queued`; the ambient glyph paints ◯ (the nothing-executing face, shared with `waiting`); tone stays `armed`; paused/checking/waiting/stuck keep their existing precedence.
4. SPEC DE:319's three pinned refs re-pointed to the shifted lines (hud-card.tsx line 315 to 317; hud.ts line 173 to 175; hud.ts line 232 to 234) — same content, new line numbers, keeping the docs-line-refs guard meaningful (its single-line rule requires the cited line to stay non-blank; Appendix A refs are frozen and were not touched — every ranged/single ref there still resolves in bounds on a non-blank line, asserted green by the test).

Tests. Six new cases, all pinned to the fresh dispatch: (test/loop.test.ts) the arm steer carries `resume: true` and the note still carries `resume: false`, the snapshot paints `queued: true` after the arm turn and flips `queued: false` on `onExecutionStarted` with its `changed` event emitted after the transition, the dispatch emits a `queued: true` `changed` before any host acceptance, a plain-goal continuation dispatches `resume: true` with the same queued→unqueued flip, and a cleared record never reports `queued`; (test/tui-hud.test.tsx) the pill paints `queued` and not `active`; (test/tui-render.test.tsx) the status dialog state line paints `queued` for a kickoff-in-flight snapshot. The continuation assertion in controller.test.ts (before this change at its line 183) was updated from `toBeUndefined()` to `toBe(true)` — the honest new contract. Full suite 1724 → 1730 pass / 0 fail; loop suite 147 → 151.

Marker decision. Six new tests move the enforced count, so the first-occurrence SPEC marker advances `files=64 tests=1724` → `files=64 tests=1730` in the same commit; `files=64` is unchanged; the section-local historical markers keep their own counts.

Honest limits. (a) The plugin still cannot observe inbox admission vs delivery — the host exposes no `session.inbox.*` subscription to this plugin's event pump; `queued` asserts only "a kickoff steer was dispatched and the host has not started the execution yet", which is exactly the invisible window, not proof the host will eventually deliver. (b) `queued` is runtime-volatile: a plugin reload/restore drops the runtime and paints `active`, as before — it never fabricates a pending state. (c) `resume: true` requests a wake; it is not a delivery guarantee — a host that refuses to execute still leaves the loop parked, now visibly parked as `queued` (which is the point) and one `/goal clear` away from release. (d) Tone stays `armed` (no new `HudTone`): a queued kickoff is usually sub-second, not a distress signal; `waiting`/`stuck` keep precedence. (e) The pins in SPEC's Phase-1 Appendix A shifted with the controller.ts insertion (as LVIII accepted for prompts.ts line 316) but were left byte-stable there by design — the appendix is frozen; each single-line ref still resolves to a non-blank line and every ranged ref still contains code, verified by docs-line-refs. (f) Live TUI paint is verified headlessly only (testRender); the user's screenshot session remains unverifiable here.

## Workstream LXI — the re-arm boundary's planner evidence is elided at a word boundary, with the marker (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Diagnose and fix the exact-repeat re-arm at HEAD: v11 armed with the just-completed v10 condition despite the XLV/LIV no-new-gap gates (this session); reproduce with fresh evidence, fix the arm-path mechanism (stale summary/checkpoint vs planner offer), pin with a test, SPEC note; marker same commit if tests move."

Audit at HEAD `d82bd9f` (fresh evidence this turn). The armed premise — that v11 armed with the just-completed v10 condition despite the gates — is **false at HEAD**, and the gates are **not** broken. This note records the honest reproduction, the one real arm-path defect the incident exposes, and its fix. The reproduction used the live goal record for this session (read-only from the host store, key `goal/v1/ses_e134c42a0ffeyYbvQ73oDtPuEm` in the host `kv` table) and the session message log (`session_message` seq 27556 v11 kickoff, seq 29478 the met-verdict turn, seq 29499 v12 kickoff; `loopHistory` v1–v11 and the `completedConditions` ledger are intact on the record):

1. v10's condition ("Correct post-LVII/LVIII stale claims …") and v11's armed condition ("Diagnose why an armed /goal-loop can sit queued/pending with no autonomous turn …" — the LX fix) are not near-duplicates by the plugin's own `normalizeCondition`/`tokensOf`/`isNearDuplicate` semantics: token containment 0.26, Jaccard 0.13 (v11 vs v10); containment 0.44, Jaccard 0.24 (v12 vs v11 at the v11→v12 boundary). Both sit far below the 0.7/0.6 thresholds, and no exact normalized repeat exists anywhere in the retained ledger. Every arm in this session's history was offered by the planner with fresh text; the XLV (initial arm) and LIV (re-arm) gates were correctly silent, not bypassed.
2. The false premise originated at the model layer, not the harness. Sequence of record: v11's final turn answered "Already satisfied at HEAD d82bd9f" (correct on the merits — the LX work had landed in v11's own window, commit 1c2093a, merged 4908eea, lease done d82bd9f) but prefaced it with a false claim ("this iteration re-armed the *identical* condition that iteration 11 (LX) completed — the exact-repeat arm pattern from v6/v7"). The independent evaluator copied that framing into the met verdict's `next:` pointer; the summarizer distilled it into the v11→v12 `latestSummary`; the planner reified it into v12's armed condition. Token-metric gates cannot and did not catch it — no match existed to catch. The AUDIT_AND_STOP clause in the kickoff worked exactly as designed: this iteration's first act was to re-read the tree and the record, and the premise dissolved.
3. One genuine arm-path defect exists at HEAD, and it is exactly the one the armed condition's hint pointed at. At the loop advance boundary the summarizer's output is capped with a raw `.slice(0, Math.max(200, config.maxLoopSummaryTokens) * 4)` — exactly 1600 characters at the default `maxLoopSummaryTokens=400`. The v12 kickoff embeds that summary verbatim, and this session's evidence shows the cut landing mid-word with no marker (the injected summary is exactly 1600 code units and ends `"…bu…"` — a raw two-letter fragment plus the model's own trailing ellipsis) and with no indication to the planner that text was cut. A raw slice can also split a UTF-16 surrogate pair. The planner reasons over this summary verbatim, so the re-arm boundary's evidence payload was silently degraded. A post-compaction re-anchor cannot arm anything (it injects record truth into the context, never advances a version), and the LX kickoff carries `resume: true` with the record as the source of iteration state — neither is an arm path and neither was involved (verified by reading the dispatch and restore paths, not by assumption).

Fix. `elideAtWordBoundary(text, maxChars)` (src/core/format.ts, exported next to `truncate`): input at or under the budget returns the input unchanged; otherwise the text is cut at the last whitespace in the trailing quarter of the window (a zero-window or no-whitespace cut lands at the budget with a high-surrogate back-off), trailing whitespace before the marker is stripped, and a single U+2026 marks the elision. Code units never split a surrogate pair; nothing but the one marker unit is added. `loopAdvance` uses it for the summary cap instead of the raw slice (same 1600-unit budget at the default), so the record, the planner's `latestSummary`, and the armed kickoff all carry the same honest, word-boundary-marked text.

Tests. Six new unit cases (test/core.test.ts, new `describe("elideAtWordBoundary")`): identity under budget (no marker added); an over-budget summary lands on a word boundary with the marker and no mid-word fragment (the v12 regression shape, pinned to the 1600 budget); no surrogate pair split (encodeURIComponent round-trip); the no-whitespace window cuts at the budget and backs off a high surrogate; trailing whitespace before the marker is stripped; zero/negative budget returns empty. One new integration case (test/loop.test.ts): an over-budget summarizer response lands in the record's loop history entry with the marker and a whole last token, the planner's `latestSummary` is that same string, and the armed kickoff carries the marker — the full chain from summarizer to planner to kickoff, pinned end to end. Suite 1730 → **1737 pass / 0 fail**; packed files stay **64**; the enforced (first-occurrence) SPEC marker advances `files=64 tests=1730` → `files=64 tests=1737` in this same commit. `dist/tui.js` byte-unchanged (rebuilt to confirm; no TUI/JSX change; the new export is reached only from the runtime path).

Honest limits. (a) This workstream does **not** and cannot make the planner truthful: the false premise entered at the model layer (assistant final turn → evaluator verdict → summarizer → planner); token-metric gates catch text overlap, not semantics — the XLIV rubric (b)/(c) failure class, re-demonstrated live. The fix removes the silent truncation that degraded the planner's evidence and makes any cut visible; it does not add, and must not add, a gate that guesses at intent. (b) The audit-and-stop clause in the armed kickoff remains the actual protection against a false armed condition — v12 itself executed it (tree re-read, record pulled, premise dissolved before any edit). (c) The ≤1600-unit budget is unchanged; only the cut quality changes. A summary at 1601+ units now ends with the marker at a word boundary instead of the raw mid-word fragment — byte-different at the tail by design; the under-budget path is byte-identical to before. (d) The reproduction cites a live session store read this turn (read-only); the record and message seq numbers are session-specific and will not reproduce on a fresh session — the pinned regression (the elision unit tests and the loop integration test) is the durable artifact. (e) `completedConditions` for this session honestly contains no repeat of any earlier condition; had one existed, XLV/LIV would have ended the loop instead of arming — the gates stay exactly as they are.

## Workstream LXII — docs catch up to LX and LXI: the queued armed kickoff and the word-boundary summary elision (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "docs/runtime.html + README `/goal-loop` section document the LX queued armed kickoff (resume:true) and the LXI word-boundary summary elision — both shipped but absent from docs at HEAD; grep-verify absence, add bullets, refresh stamps via docs-watch, check green; SPEC note; marker unchanged".

Audit at HEAD `5ca4fc6` (fresh grep this turn). `docs/runtime.html` and `README.md` carried no mention of either behavior: grep for `resume: true`, `resume:true`, `queued`, `elideAtWordBoundary`, `word-boundary`, `LXI` and `LX ` over both files returned no feature hit (the one `queued` in docs/runtime.html is the compaction-request queue in the tiny-contexts paragraph, unrelated). LX shipped in `1c2093a` (merged `4908eea`, lease done `d82bd9f`) and LXI in `433f238` (merged `deaf982`, lease done `5ca4fc6`); neither reached the docs. The gap is real at HEAD.

Fix. `docs/runtime.html`, `/goal-loop` section, gains two paragraphs between the planner-audit paragraph and the per-iteration toast paragraph. First: the armed kickoff is dispatched with `resume: true` (`continueWith`, src/runtime/controller.ts), admit-only notes stay `resume: false`, and between dispatch and the host's `session.execution.started` the snapshot carries `queued: true` (src/core/types.ts); the pill, the card and the status dialog paint `queued` with the ◯ glyph (tone stays `armed`); the flag clears on execution start, on failure and on interruption, and a plugin reload drops it rather than fabricating a pending state. Second: the summary capped for the planner (`latestSummary`) is elided at a word boundary with a single U+2026 marker (`elideAtWordBoundary`, src/core/format.ts, used by `loopAdvance`), never a raw mid-word slice and never a split surrogate pair; a summary under the budget is byte-identical to before. `README.md`, `/goal-loop` section, gains the same two claims in the same shape (resume:true kickoff painted `queued` until execution start; word-boundary elision with a single `…` marker). Docs cite `file · symbol`, never file:line — the docs-line-refs guard forbids line citations in docs/*.html.

Marker decision. Documentation-only; no test moved; the enforced (first-occurrence) SPEC marker stays `files=64 tests=1737`.

Honest limits. (a) The docs record shipped behavior only; no new claim class, no code change, `dist/tui.js` byte-unchanged. (b) README.md stays unstamped; docs/runtime.html's stamp and the changelog row regenerate via `bun scripts/docs-watch.ts once` in the mechanical refresh commit on top, never by hand. (c) The LX `queued` flag is runtime-volatile by design (a reload/restore drops it and paints `active`); the docs say so rather than promising a durable pending state. (d) The LXI elision changes the cut, not the budget; the under-budget path is byte-identical to before and the docs claim exactly that.

## Workstream LXIII — the config/index docs audit: every option verified documented, symbol-style citations throughout, the one remaining docs line ref retired (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "docs/config.html + docs/index.html audit against the shipped plugin: verify every config option in src/core/config.ts (defaults, env overrides, incl. compactOnLoopIteration, maxLoopSummaryTokens, compactAtTokens) is documented on the config page, add what is missing with symbol-style citations, refresh stamps via docs-watch, check green; SPEC note; marker unchanged".

Audit at HEAD `1d2f309` (fresh reads this turn):

1. Coverage. Every option resolveConfig() accepts is documented on docs/config.html — all eight `evaluator.*` keys (model, mode, maxTranscriptChars, maxOutputTokens, timeoutMs, verifyCommand, verifyTimeoutMs, consensus), the top-level fallback `model`, the twelve scalar/bool top-level keys (maxTurns, stallTurns, checkinMinutes, maxIdleCheckins, maxRetries, maxConditionChars, systemReminder, transcriptNotes, compactAtTokens, compactOnLoopIteration, maxLoops, maxLoopSummaryTokens), and the three requireCommit/commitBranch/coordinator commit keys: 24 rows. Nothing in src/core/config.ts is undocumented.
2. Defaults vs DEFAULTS. All sixteen default values cross-checked mechanically against DEFAULTS this turn and all sixteen appear on the page unchanged: maxTranscriptChars 60000, maxOutputTokens 4096, timeoutMs 120000, verifyTimeoutMs 600000, consensus 1, maxTurns 0, stallTurns 0, checkinMinutes 30, maxIdleCheckins 3, maxRetries 3, compactAtTokens 0, compactOnLoopIteration true, maxLoops 5, maxLoopSummaryTokens 400, maxConditionChars unlimited (Number.MAX_SAFE_INTEGER), commitBranch dev.
3. Env vars. All twelve env vars resolveConfig reads (OPENCODE_GOAL_MODEL, OPENCODE_GOAL_CHECKIN_MINUTES, OPENCODE_GOAL_MAX_TURNS, OPENCODE_GOAL_COMMIT_BRANCH, OPENCODE_GOAL_REQUIRE_COMMIT, OPENCODE_GOAL_COORDINATOR, OPENCODE_GOAL_COMPACT_AT_TOKENS, OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION, OPENCODE_GOAL_MAX_LOOPS, OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS, OPENCODE_GOAL_VERIFY_COMMAND, OPENCODE_GOAL_VERIFY_TIMEOUT_MS) are documented in the table or prose, as are LOG_FILE/MIRROR/PROBE. A src-wide grep this turn found no other OPENCODE_GOAL_* reference outside the modules that host them; nothing is missing.
4. Defects found and fixed. (a) docs/index.html carried the only docs/*.html citation with a line number — `README.md:3` — retired to `README.md` (docs cite `file · symbol`, never file:line; the docs-line-refs guard forbids line refs for .ts/.tsx only, but the convention holds everywhere in docs/). (b) The compactOnLoopIteration row teaches the flag's semantics (10k tiny-context skip = BOUNDARY_MIN_TOKENS, in-flight/busy gates fail closed, 2-miss warning, trickle every 3rd arm, COMPACT_MISS_CAP backstop) — verified against src/runtime/compactor.ts and src/runtime/controller.ts this turn; accurate, untouched. What WAS missing is the boolean parsing of OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION: the trailing prose documented REQUIRE_COMMIT's spellings but not the shared envBool path. Both now documented with the same 1/true/yes/on and 0/false/no/off (case-insensitive) spellings and unset-on-anything-else semantics, cited `src/core/config.ts · envBool`. (c) The same trailing prose cited modules without `· symbol` form; converted wholesale (DEFAULTS, resolveConfig, envBool, detectCoordinator, resolveCommitPolicy, parseCoordinator, coordinatorFlow, commitStatusSuffix, rubric, facts — `src/core/prompts.ts · commitStatusSuffix` typo-fixed to a well-formed citation in the same pass). Every cited symbol verified present in its module this turn.
5. Index page re-verified against the shipped plugin: the 15-minute rate/usage-limit retry (PAUSE_RETRY_MS, src/runtime/controller.ts), capped exponential backoff, the 1..1000 /goal-loop-N//goal-loop=N directive (src/core/parse.ts GOAL_LOOP_DIRECTIVE), the GoalStatus terminal states achieved/impossible/cleared/failed (src/core/types.ts), epochs (Runtime.epoch/stale) and the synthetic steer (continueWith). All accurate; every inline citation resolves. index.html gains no new claim; the only change is the line-ref retirement.

Marker decision. Documentation-only; no test moved; the enforced (first-occurrence) SPEC marker stays `files=64 tests=1737`.

Honest limits. (a) The config page's per-option rows are unchanged — the audit confirmed them rather than rewrote them; the additions are the envBool note and the citation form, not new option docs. (b) README.md stays unstamped; docs stamps and the changelog row regenerate via `bun scripts/docs-watch.ts once` in the mechanical refresh commit on top, never by hand. (c) docs-line-refs guards .ts/.tsx line refs only; the README.md:3 retirement was a convention call, not a test-gate fix — the guard was green before and after. (d) No source or test change; `dist/tui.js` byte-unchanged.

## Workstream LXIV — the docs coverage gate: every resolveConfig surface pinned to docs/config.html (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Add a docs coverage gate: test every DEFAULTS key and every OPENCODE_GOAL_* env var resolveConfig reads appears in docs/config.html; fail-verified on a removed row, green at HEAD; SPEC note; marker bump same commit".

Audit at HEAD `f6a546a` (fresh reads this turn). The docs tree already carries two partial gates from earlier workstreams: `test/config-defaults.test.ts` pins the sixteen DEFAULTS values to the option rows in README.md AND docs/config.html (with normalization), and `test/env-vars.test.ts` pins the src-wide `OPENCODE_GOAL_*` token set to both documents in both directions. Neither is the narrow named gate the condition arms, and neither records the fail verification the condition demands (a removed row from docs/config.html); the recorded mutations were a code-side DEFAULTS change (Workstream BN) and a config.html addition / src-side rename (Workstream BR). `resolveConfig` reads exactly twelve env vars (src/core/config.ts): OPENCODE_GOAL_MODEL, OPENCODE_GOAL_VERIFY_COMMAND, OPENCODE_GOAL_VERIFY_TIMEOUT_MS, OPENCODE_GOAL_MAX_TURNS, OPENCODE_GOAL_CHECKIN_MINUTES, OPENCODE_GOAL_COMPACT_AT_TOKENS, OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION, OPENCODE_GOAL_MAX_LOOPS, OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS, OPENCODE_GOAL_REQUIRE_COMMIT, OPENCODE_GOAL_COMMIT_BRANCH, OPENCODE_GOAL_COORDINATOR — all twelve appear in docs/config.html today (verified by the gate itself at HEAD).

1. New `test/docs-coverage.test.ts` (4 tests). The gate, scoped to docs/config.html exactly as armed: (a) refuses to pass vacuously — src/core/config.ts must reference >=12 `OPENCODE_GOAL_*` tokens and the config.html options table must parse >=20 rows; (b) every DEFAULTS key, mapped to its documented option name (the same sixteen-entry map config-defaults.test.ts uses, restated so the gate is self-contained), appears as a row in the config.html table; (c) every `OPENCODE_GOAL_*` token referenced in src/core/config.ts — the module `resolveConfig` lives in, comments included, anti-vacuous by (a) — appears somewhere in docs/config.html; (d) the DEFAULTS key set and the doc-name map are in one-to-one correspondence, so a DEFAULTS key added without a doc-name entry fails loudly instead of escaping the presence check. Value-level pins stay in config-defaults.test.ts; the src-wide bidirectional token pin stays in env-vars.test.ts; this gate is the presence floor and overlaps them by design — the armed condition asked for exactly this gate, fail-verified on a removed row.
2. Fail verification on a removed row (this turn, fresh). Removing the `<tr><td><code>maxLoops</code>…` row from docs/config.html fails this gate twice by name — "docs/config.html is missing DEFAULTS option(s): maxLoops" and "docs/config.html is missing env var(s) read by resolveConfig: OPENCODE_GOAL_MAX_LOOPS" — and also fails config-defaults.test.ts (three tests: keys documented, values match, identical row sets) and env-vars.test.ts (three tests: src-documented, README↔config.html identical sets, exact set match): 6 failures across the two pre-existing suites, 2 in the new gate, 0 elsewhere. Reverting the row restores green; docs/config.html ends the iteration byte-identical to HEAD (`git diff` empty for the page; only the new test file is untracked before the commit).
3. Green at HEAD. `bun test` from `test/` after the addition reports **1741 pass / 0 fail** (was 1737; +4 from the new file); `bun run check` green before submit (tsc, suite, compile, TUI load, docs freshness, spec-check).

Marker decision. Four new tests move the enforced count, and `check:spec` fails unless the first-occurrence marker matches the tree in the same commit, so the enforced (first-occurrence) SPEC marker advances `files=64 tests=1737` → `files=64 tests=1741` here; `files=64` is unchanged (`test/` and `SPEC.md` stay outside `package.json` `files`). Historical section-local markers keep their own counts.

Honest limits. (a) The gate pins presence, not values — documented-default equality remains config-defaults.test.ts's job, and the bidirectional token pin remains env-vars.test.ts's job; adding a fourth overlapping harness is deliberate (the armed condition prescribed this gate), not a redesign. (b) The env-token extraction reads the whole src/core/config.ts source including its doc comments — that is the file the resolveConfig env surface is declared in, and (a) pins the floor; a token deleted from code and docs together would still pass this gate (env-vars.test.ts would catch the doc side, and the README cross-check the other). (c) No source, doc or dist change; `dist/tui.js` byte-unchanged; the only files touched are `test/docs-coverage.test.ts` (new) and this note plus the one-line marker bump. (d) The fail verification was performed on a scratch copy and reverted; no docs bytes were committed as broken at any point.

## Workstream LXV — the docs and SPEC point at the LXIV docs coverage gate (2026-11-18)

Armed condition of this iteration (verbatim from the loop): "Update the docs and SPEC to point at the LXIV docs coverage gate: docs/index.html and docs/install.html mention the config page documents defaults and env overrides but not that config.ts implements them; grep-verify absence, add bullets, refresh stamps via docs-watch, check green; SPEC note; marker unchanged".

Audit at HEAD `4e8c30c` (fresh grep this turn). Both target pages reference the config page but carry no pointer to the implementation or the gate: `grep -in "docs-coverage\|coverage gate\|DEFAULTS\|resolveConfig\|LXIV\|config coverage" docs/index.html docs/install.html` returned nothing (exit 1). The config page itself cites `src/core/config.ts · DEFAULTS` and `src/core/config.ts · resolveConfig` in its trailing prose, and SPEC Workstream LXIV records the gate and its removed-row fail verification; the two pages that route readers to the config page were the gap.

Fix (two bullets, docs style — `file · symbol` citations, never file:line):

1. `docs/index.html` — the Sections list's Configuration reference bullet now reads: the documented defaults and env overrides are implemented by `src/core/config.ts · DEFAULTS` and `src/core/config.ts · resolveConfig`; a docs coverage gate (`test/docs-coverage.test.ts`) pins every DEFAULTS key and every `OPENCODE_GOAL_*` variable the module reads to the page.
2. `docs/install.html` — the opencode.json options section's Full-table paragraph now carries the same pointer, plus the consequence (a removed row fails the build).

No other claim changed on either page; no source, test, or dist change; `dist/tui.js` byte-unchanged; README.md untouched (unstamped, out of the armed scope). docs/config.html unchanged (it already cites the implementation and never needed the gate pointer — the gate pins it, not the reverse).

Marker decision. Documentation-only; no test moved; the enforced (first-occurrence) SPEC marker stays `files=64 tests=1741` (line 477); `files=64` is unchanged. Historical section-local markers keep their own counts. Stamps and the changelog row regenerate via `bun scripts/docs-watch.ts once` in the mechanical refresh commit on top of the content commit, never by hand; `bun run check` green before submit.

Honest limits. (a) The bullets state shipped LXIV behavior only: the gate pins presence of the DEFAULTS keys and the module's `OPENCODE_GOAL_*` tokens in docs/config.html; it does not pin the README, and it does not check values (config-defaults.test.ts does). The bullets do not overclaim beyond that. (b) The install.html env-vars block in the Troubleshooting section is untouched — the pointer lives on the options surface, where the reader meets the config page first. (c) docs-watch stamps reflect the last commit that touched each page; the refresh follows the content commit in the same push and is committed separately, per repo convention.

## Workstream LXVI — terminal goals are inert after compaction (2026-11-18)

Bug (reported): after a /goal is achieved (or cleared) and the user runs compaction, the agent resumes working on the goal instead of stopping.

Audit at HEAD `b5cb04c` (fresh reads this turn). The compaction-event chain is gated on the persisted record's status — with one hole. `onCompactionLanded` re-anchored only when `record.loopEnabled && record.status === "active"`, `activeCondition` serves the standing reminder only for `status === "active"`, `restore()` adopts only `isLive` records (`store.loadLive`), and `onExecutionSucceeded`/`onExecutionFailed`/`onExecutionInterrupted`/`onBackgroundDrained` all require `status === "active"`. The hole: the one-shot post-compaction re-anchor (`pendingAnchors`, injected by the `context` hook via `consumeAnchor`) was armed while the loop was live, but `finish()` never dropped a pending anchor, and `consumeAnchor` returned the armed text regardless of the adopted record's status. A compaction landing between the arm and the next model request — with the loop reaching achieved/cleared in that window (or the user running `/goal clear`) — left "keep working toward the armed condition. Do not wait for a user message." armed for a finished goal; the next request after the compact injected it and the model resumed the goal.

Fix (`src/runtime/controller.ts`, three edits):

1. `finish()` deletes `pendingAnchors` and `lastReanchorAt` for the session at the terminal transition — a one-shot re-anchor armed before the finish can no longer ride a later model request (mirrors what `onSessionDeleted` already did).
2. `consumeAnchor()` fails closed: it drops the pending text and returns `undefined` unless the adopted record exists and `status === "active"` — belt and braces for any anchor that outlives its record.
3. `onCompactionLanded()` short-circuits on terminal records before the boundary-landing bookkeeping (`landPending` commit + "Compaction landed" success notice) and the re-anchor — a landed compaction is a full no-op for a finished goal.

Failing-then-passing (shown this turn). With the `src/` fix stashed and the tests kept, two of the six new cases fail — the stale anchor armed before `finish()` is served to the next request verbatim on a cleared goal and on an achieved-at-cap loop; with the fix all six pass.

`test/loop.test.ts` — new `describe("terminal goals are inert after compaction")` with six cases: (i) a re-anchor armed before a maxLoops=1 loop finishes never rides a post-terminal model request; (ii) the same on `/goal clear`; (iii) a compaction landing after the goal is achieved arms nothing, commits nothing, emits no compact notice; (iv) the same after a clear; (v) an achieved goal across dispose + `restore()` adopts nothing, `activeCondition`/`consumeAnchor` stay undefined, and the persisted record stays `achieved`; (vi) the same for a cleared loop, including a post-restore compaction landing as a no-op.

Honest limits. (a) The model-side residue is out of scope by design: the host's compaction summary is built from the transcript and can quote the original `<goal>` kickoff directive for a finished goal; the plugin cannot edit the summary, and the plugin-side levers that carry post-compact instructions (the re-anchor, the standing reminder) are now guaranteed inert for terminal records. `stripGoalNotes` is unchanged — goal notes were already stripped from model-bound context, live or terminal. (b) The `session.compaction.ended` bookkeeping for a terminal record is now skipped entirely; the unlanded `loopCompact` marker persists on the finished record and is pruned by the usual terminal-record hygiene, never evaluated. (c) `lastReanchorAt` is cleared at finish so a re-armed loop after a future re-arm (impossible today — a terminal record is never re-armed) starts with a fresh coalescing window. (d) Test count moved **1741 → 1747** (six new cases); packed files stay **64** (no `files` entry changes); the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1747` in this same commit. `dist/tui.js` byte-unchanged (no TUI source touched). The only files edited are `src/runtime/controller.ts`, `test/loop.test.ts`, `SPEC.md`, and one shared line-ref re-point (the steer anchor shifted one line down under the new `finish()` lines).

<!-- spec-check files=68 tests=1893 -->

## Workstream LXVII — the terminal outcome line stops parking in the session inbox; a finished goal's instruction text leaves context (2026-11-19)

Reported live (screenshots, 2026-11-18 21:46): after `/goal` achieved, a `◎ Goal achieved (turn 1, 19m 40s).` line sat stuck in the transcript through later turns and new input; the user's own summary was "it took me one session compaction and a completely new turn after the agent stop … after the session compaction it somehow trigger something … it's like it is stucked on a queued message or some sort."

Audit at HEAD `bf7b23c` (the LXVI merge; fresh output this turn). Two cooperating defects, both inherited from earlier workstreams:

1. The end-of-record outcome line is dispatched as a durable synthetic inbox item (`note()` → `session.synthetic`, `delivery: "queue"`, `resume: false`). Per the host contract recorded in Workstream DY (verified in the binary strings there), a queued item is not consumed at the next step boundary of a running execution — and at idle it is never consumed at all. The outcome line therefore parked invisibly in the session inbox for the whole life of the session: it did not "land" on the terminal, it sat there as stuck queued input until some later execution happened to admit it — exactly the artifact the maintainer hit, and exactly the shape DY removed for the re-anchor (which now rides the SYSTEM part). Every loop iteration parked one as well (LI folded the arm note into the same grammar).
2. The model-bound context still carried the expired `<goal>` kickoff ("Work autonomously toward this goal … Do not stop to ask for confirmation") and any continuation/retry/check-in steers, because the context hook stripped only `<goal-note` messages. After a manual `/compact` the summary is free to quote that kickoff — and the host's next model request re-established a finished goal. This is the residual channel Workstream LXVI named as out of plugin scope; this workstream moves it back into plugin scope.

Fix (`src/runtime/controller.ts`, `src/index.ts`, `src/core/prompts.ts`):

1. The `note()` inbox dispatch is retired entirely. The four call sites (achieved, impossible, loop complete via `endClean`, loop-arm) are gone: the plain-goal and loop paths already emit a companion `notify()` toast (kinds `achieved`/loop, ATTENTION) and the HUD terminal acknowledgment (self-expiring `TERMINAL_ACK_MS`), and the durable record itself is the auditable outcome. Loop arms keep their single `notify()`; no kickoff/continuation path changes. The controller additionally writes one `log.info` line per ending for the file log. A stale-step guard is re-inserted where the note's round-trip guard used to be, so a superseded arm still cannot reach the compaction request or the vN+1 steer.
2. The `context` hook now computes `live` once. No live goal for the session → every goal-grammar message (`<goal>`, `<goal-loop*`, `<goal-continuation*`, `<goal-retry*`, `<goal-checkin*`, plus notes) is spliced out of `event.messages` (`stripGoalContext`), and one ground-truth line — `TERMINAL_REMINDER` ("Do not resume work toward it … await the user's next instruction") — is pushed into the SYSTEM part while a terminal record for the session exists in memory (`controller.hasTerminalRecord`). A live goal: notes stripped only, unchanged; the reminder is never pushed. Goal-free sessions: messages pass through untouched, no injection.
3. `stripGoalNotes` stays for the live path and for legacy messages; `<goal-note>` grammar is unchanged.
4. `transcriptNotes` is retained for compatibility and now gates nothing (same posture as `maxRetries`): README/docs/config.html/AGENTS.md mark it deprecated; the DEFAULTS entry stays `true`.
5. `docs/runtime.html` re-tells the re-anchor mechanism honestly (SYSTEM-part one-shot, not an inbox note — it was stale since DY), records the outcome-note retirement and the terminal inertness belt, and `docs/config.html` marks the option deprecated.

Failing-then-passing. The two pre-existing assertions that pinned the retired dispatch were replaced with absence pins (`loop.test.ts`, `controller.test.ts`); seven new cases were added (`plugin.test.ts` ×3: end-to-end arm→turn→met→achieved through the event pump drives the hook to push `TERMINAL_REMINDER` and splice the kickoff; live goal keeps its kickoff and gets no terminal line; goal-free session drops grammar messages with zero injection; `notes.test.ts` ×3: instruction-tag predicate, stripGoalContext semantics, reminder text; `controller.test.ts` ×1: `hasTerminalRecord` for false→achieved→true→re-arm→false, cleared→true).

Honest limits. (a) The durable, already-parked outcome line in an existing session's inbox is host-owned history; the plugin cannot retroactively consume it — it flushes naturally at the next execution, or never, and the new code adds no more of them. A fresh session is clean by construction. (b) `TERMINAL_REMINDER` is gated on a terminal record in **this** process's memory; a plugin reload adopts no terminal records (by design, Workstream XLIII/XLIV), so the reminder is absent until the next terminal transition in this process — the instruction-message strip still applies everywhere, and the re-anchor/system-reminder paths are already active-only. (c) The host's compaction summary can still quote the expired kickoff text verbatim; the reminder line exists to counter it — it is one line, not a guarantee of model compliance. (d) `stripGoalContext` matches on text parts containing the tags anywhere, so a user who literally typed `<goal-loop` into their own message loses that part after their goal ended — same accepted grammar-collision posture as `<goal-note` since EM. (e) The `/goal` detail dialog, verdict trail, HIST ledger and log remain the durable audit surface; the inbox scrollback no longer carries the outcome line by design. (f) Test count moved **1747 → 1754** (+7; nothing weakened — three synthetic-dispatch assertions replaced by absence pins as above); packed files stay **64**; the enforced (first-occurrence) SPEC marker advances to `files=64 tests=1754` here. The shared Appendix-A steer ref re-pointed to `controller.ts:1134` after the controller edits shifted it. `dist/tui.js` byte-unchanged (no TUI source touched).

<!-- spec-check files=68 tests=1893 -->

## Workstream LXVIII — the terminal-TUI consistency pass: one affordance cell, a truthful stuck state (2026-11-19)

Armed condition (verbatim): "keep improving the terminal tui. focusing on user's experiences. smooth it out all the rough edges, the in consistencies." Fuzzy; this workstream interprets it as a user-facing consistency pass over the four zoom levels (ambient pill, HUD card, `/goal` detail dialog, history rail), evidence-driven — visible frames in, visible frames out.

Audit at HEAD `ced5018` (fresh this turn): a read-only explorer mapped the TUI for rough edges and inconsistencies and ranked 12 findings user-impact order; frames from `scripts/render-card.tsx` / `render-dialog.tsx` / `render-history.tsx` were read by the orchestrator before any edit.

Fix (one self-contained commit):

1. **The hover-stability affordance cell is one component, not three.** `Affordance` — the always-mounted cell that never mounts/unmounts/changes width on hover; hover only brightens it (weight under mono), width 8, `✓ copied` / `+ copied` / `✓ saved`, wider verbs pass their own width — existed verbatim three times. Now exported once from `src/affordance.tsx` with a structural theme subset (`text.base`, `text.faint`); `src/hud-card.tsx`, `src/status-dialog.tsx`, `src/tui-history.tsx` import it. Paint is byte-identical: the 446-test TUI render/snapshot suites passed unchanged before test pins moved.
2. **A stuck-retrying loop is not "active" at the deeper zoom levels.** The pill painted `● stuck · retry N` and the card border/now-row went amber at 3 consecutive failed turns, while the dialog's strip row (`goalSnap.status` raw) and the history rail's `stateWord` read `active`, and the rail now-row kept info-blue — the two deepest surfaces called an all-failing loop healthy. The strip now paints `stuck` and passes `isRetryStuck(goalSnap)` into `stateAccentColor` (as does the elsewhere/foreign-rows arm); the rail's `stateWord` gained the `stuck` branch (checking/waiting/queued first, paused unchanged — paused outranks stuck per the existing remediation order) and the rail now-row returns warning-amber for a stuck active goal under color (mono unchanged — weight carries the meaning). New render test pins the rail behavior: "a stuck-retrying goal reads stuck in the now row, not active".
3. **SPEC intro honesty.** The footer-hint paragraph quoted the pre-CQ hint set; it now names `x older` in both tiers with the measured 64-cell FULL_HINT (was "~59 cells … neither tier named the chord"); it cites the hint itself is 64 cells, measured (string-width), matching `dialogFooterTier`.

Honest limits. (a) The raw `not_met` enum stays in the `HistoryBlock` counts line (`tui-render.test.tsx` HistoryBlock counts pin — `3 met · 2 not_met` — shifted down one block when the stuck test was added above it) and in the `remediationFor` streak strings (three suites + SPEC quote): those pins are load-bearing and flipping them is a separate decision, not a polish pass. The outlier the explorer flagged classifies as a defect only if the pin is wrong — resolved: pin wins this iteration. (b) The remaining findings are real and recorded, not fixed: (i) twin adjacent `…` rows in the rail (inert retention notice vs clickable fold with pinned wording); (ii) dossier `table` rows nowrap into a clipped scrollbox; (iii) `sessionTag` and outline chips slice UTF-16 code units, not cells; (iv) outline chips and the find row carry no hover feedback; (v) the `✕`/`✗` failure-glyph split; (vi) `compactMarkerFg` and the context-menu enabled predicates still derivate in two arms; (vii) SPEC intro glyph-wave quotes (`· • ● •` vs the shipped `◦ ○ ◎ ○`, `◯` waiting glyph, "four fixed rows" vs six, `◎ goal achieved` vs `●`). (c) `dist/tui.js` rebuilt; no other behavior change. (d) Test count moved **1757 → 1758** (one new render test; nothing weakened — one package-integrity pin re-pointed 64 → 65); packed files moved **64 → 65** (`src/affordance.tsx`); the enforced (first-occurrence) SPEC marker advances to `files=65 tests=1758` in this same commit; `test/package-integrity.test.ts` re-pinned in the same commit. No version bump, no tag, no push.

<!-- spec-check files=68 tests=1893 -->

## Workstream LXIX — the terminal-TUI consistency pass, second tranche: affordance grammar for the fold row, cells not code units, one marker mapping, one truth about hover (2026-11-19)

Armed condition (verbatim): "keep improving the terminal tui. focusing on user's experiences. smooth it out all the rough edges, the in consistencies." Same fuzzy objective as LXVIII; this workstream continues from the LXVIII backlog in `pending_fixes.md`.

Audit at HEAD `6b3e422` (fresh this iteration): the elven-file TUI surface was re-read at the current tree; the fixes below are the self-contained subset. Render suites re-run before and after (446 pass unchanged after the source dedupe).

Fixes:

1. **The iteration-rail fold row is now the clickable row the elsewhere fold already was.** It painted a faint `…` + faint text with no affordance cell and no hover state — visually indistinguishable from the inert retention-drop notice above it (two identical `…` rows, one inert, one a button). It now carries an always-mounted `Affordance` cell (`click · x`, width 9, the same verb grammar as `status-dialog.tsx`'s `click · m` elsewhere fold) and an onMouseOver/out hover flag that brightens only the cell, never the row text; the `-` hyphen-minus separator in its label became `·`. The pinned wording in `test/tui-render.test.tsx` moved in the same commit. The retention-drop notice stays a plain inert row — row shape now signals clickable-vs-inert.
2. **User-facing labels are measured in cells, not UTF-16 code units.** `sessionTag` (elsewhere rows: `label.length > 12 ? label.slice(0, 11) + …`) measured CJK labels at code-unit width, blowing the 12-cell tag column and bisecting surrogate pairs; the dossier outline chip label had the same defect (`title.length <= 12` + `slice`). Both now go through `truncate()` (grapheme/cell-aware, budget-reserved ellipsis). ASCII behavior is byte-identical (the code-unit pin in `test/dossier-outline.test.ts` still passes); the CJK arm is pinned by a new test (label stringWidth ≤ 12, ellipsis present).
3. **The boundary-compaction marker accent mapping is one export, not two copies.** `markerFg` (mono → muted; landed → success/info; missed → warning; else faint) existed verbatim in `src/hud-card.tsx` and `src/status-dialog.tsx`. Now `compactMarkerFg(theme, tone, mono)` in `src/core/hud.ts` (structural `NeutralTheme<C>`); the card and the dialog import it. Paint is byte-identical.
4. **The failure glyph is one codepoint everywhere.** The pill's terminal acknowledge painted `✕` (U+2715); every other failure glyph (trails, verify row, final tally, sealed/unsigned/unresolvable acks) paints `✗` (U+2717); mono arms paint `x`. The pill ack now paints `✗` (`test/tui-hud.test.tsx` re-pinned in the same commit). Both codepoints are still honored under mono as `x` — unchanged.
5. **Clickable chrome with zero feedback now flips on the way in.** The dossier find row brightens its label on hover (`find in the record` → `base`), and the popup's `close` cell brightens likewise (and gains BOLD weight under mono — NO_COLOR-safe, weight not hue). No width changes; the pinned resting frames are untouched.
6. **The outline-rail chips keep their pinned truth.** An earlier hypothesis read the prop doc's "hovering a chip boldens it" as a defect; the pin (`tui-render.test.tsx`, "hovering a chip changes nothing — the resting frame is byte-identical under the mouse") plus the absence of UNDERLINE/BOLD spans are the deliberate contract. The doc line and the rail comment were rewritten to state the shipped contract exactly (no hover state; `✓ copied` paints in place on click) instead of the aspiration. Pin wins; nothing re-pinned.

Honest limits. (a) `-` hyphen-minus strings in remediation/hints (`authentication failure - /goal clear to reset`, `the evaluator reads only the transcript - it cannot run commands`, `snapshot unavailable - showing last known state`, `turn cap reached … - a message will not extend it`) are kept: each is pinned (tui-hud, render-scripts, tui-render, snapshot) and this is a polish pass, not a re-pin. (b) `HistoryBlock` counts keep raw `not_met` for the same reason. (c) The fold row's inert twin (retention-drop notice) is distinguishable by shape now — plain row vs affordance cell — but keeps its `…` glyph deliberately. (d) Not fixed this iteration: dossier `table` markdown rows paint `wrapMode="none"` inside a clipped scrollbox (silent right-edge loss — needs a wrap-or-ellipsis decision with its own render evidence), `stateWord`'s dialog-strip one-line twin (kept by design — the strip needs the raw status + the `stuck` override inline), the mouse/keyboard context-menu enabled predicates (wired-identically today; the divergence is latent and would need a threaded signature), and SPEC intro's glyph-wave quotes (`· • ● •` vs shipped `◦ ○ ◎ ○`, `◯` hollow, "four rows" vs six, `◎` vs `●` — quoted-docs drift, not behavior). Test count 1758 → **1759**; packed files unchanged at **65**; the enforced first-occurrence marker advances in the same commit. No version bump, no tag, no push.

<!-- spec-check files=68 tests=1893 -->

## Workstream LXX — the dossier table keeps its right edge (2026-11-19)

Armed condition (verbatim): "inspect for regression on behavior functionalities. fix what needs fixing and improving to keep on moving forwards with the repo project." Fuzzy; this iteration closes the deferred dossier `table` finding from LXIX's honest-limits list: a verdict-trail row wider than the pane painted `wrapMode="none"` inside the host's clipped scrollbox, silently dropping its right edge.

Fix: the dossier row classifier's `table` kind now paints `wrapMode="word"` like every other document line (`src/status-dialog.tsx`). The verdict-trail row is data, not chrome — truncation would still lose cells; wrapping keeps the whole record inside the vertical scrollbox. Evidence: regression test "a verdict-table row wider than the pane wraps instead of clipping — the record keeps its right edge" (`test/tui-render.test.tsx`) renders one wide row (4-digit turn, `impossible`, 4-digit tools, sha, four-figure spend) at width 60 and pins the spend cell's survival; it failed on the nowrap tree and passes after the change.

Honest limits. The table still reads as a Markdown table; a wrapped continuation starts on the row's next line without an indent — acceptable in a scrollable record. No other kind changed. Test count moved 1763 → 1764; packed files stay 65; the enforced (first-occurrence) SPEC marker advances in this same commit.

<!-- spec-check files=68 tests=1893 -->

## Workstream LXXI — the context menu has one row source (2026-11-19)

Armed condition (verbatim): "inspect for regression on behavior functionalities. fix what needs fixing and improving to keep on moving forwards with the repo project." Fuzzy; this iteration closes deferred item 11b — the HUD card's right-click menu computed its enabled predicates twice, and not identically.

The divergence. The mouse arm (`src/hud-card.tsx`) enabled a row on data AND host wiring (`Boolean(goal.reason && props.onCopyReason)`); the keyboard arm (`src/tui.tsx` `contextRowsFor`) enabled on goal data alone. Both hosts wired everything, so nothing misbehaved in production — but the two arms were independent readings of the same contract, and a host that wired only some doors would have shown a row that the mouse refused and Enter fired, or a row that painted live and Enter skipped.

Fix. One array, two consumers. `HudCard` gains `menuRows?: () => readonly ContextMenuRow[]`; the TUI mount passes `() => contextRowsFor(getHudSession())` — the exact function `activateContextMenu` and the up/down keymap already read. The card's internal wiring probe stays as the fallback for embeds and tests that declare no rows, and `ContextMenuRow`/`ContextMenuId` are exported as the contract between them. `contextRowsFor` spells out both halves of the grammar (data and wiring) through an `unknown` guard, so a future host that stops wiring a door shows it in the menu.

Evidence. New test "one row source: rows the host declares win over the card's own wiring probe — mouse and keyboard cannot diverge" (`test/tui-render.test.tsx`) wires `onCopySummary` but declares all rows disabled: it failed on the previous tree (the card's own probe enabled the row and the click fired) and passes now (the declared row is inert, the menu stays open). The existing ten context-menu tests, including the half-wired-dossier pin, pass unchanged.

Honest limits. The prop is a row *supplier*, not a row *override* of individual fields: a host that wants one row flipped returns the whole array. No visual change in the shipped TUI — this is divergence prevention, not a bug fix a user could see today. Test count 1772 -> 1773; packed files stay 65; the enforced (first-occurrence) marker advances in this same commit.

<!-- spec-check files=68 tests=1893 -->

## Workstream LXXII — the verification gate's timeout actually stops the command (2026-11-19)

Armed condition (verbatim): "inspect for regression on behavior functionalities. fix what needs fixing and improving to keep on moving forwards with the repo project." Fuzzy; this iteration came from a coverage sweep of `src/index.ts` (68% lines), which showed `createVerifier` — the shell runner behind `evaluator.verifyCommand`, and therefore behind every `met` the gate holds — with no test at all.

Two real defects, both reproduced before the fix.

1. **The budget did not bound anything.** `verify` spawned `bash -c <command>` and on timeout sent SIGKILL to the shell's pid alone. A child of the shell keeps the inherited stdout pipe open, so `Promise.all([child.exited, read(stdout), read(stderr)])` waited for that child, not for the kill. Measured: `sleep 3; echo late` under a 200ms budget returned after **3003ms**. A verification command that starts a server would never return, and the evaluator would hang on it — the timeout the docs promise ("timeout ... downgrades to not_met") was not enforced.
2. **An already-aborted signal ran the command.** The abort listener was attached with `addEventListener("abort", ...)`, which never fires on a signal that was aborted before the attachment. A cancel landing between the controller's `AbortSignal.any` and the spawn executed the command to completion anyway (measured the same 3003ms on a 10s budget).

Fix (`src/index.ts`, `createVerifier`, now exported so the port is testable):
- spawn with `detached: true` so the command is its own process group; on timeout or abort kill the group (`process.kill(-pid, "SIGKILL")`), falling back to `child.kill` if the group is already gone;
- cancel both stream readers after the kill, so a surviving descendant or an unclosed pipe cannot stall the drain — the result is the tail captured so far;
- run the kill immediately when `signal.aborted` is already true, and only then attach the listener.

Evidence (`test/verifier.test.ts`, 4 tests): happy path exit 0 + output; failing command keeps exit 3 and reads stderr; the wide command returns under the 1500ms ceiling with `timedOut: true` (was 3003ms); a pre-aborted signal returns under 1500ms (was 3003ms). Both budget tests failed on the previous tree and pass now; the two functional tests pass on both, so the change does not alter ordinary gate behavior.

Honest limits. `detached` is POSIX-shaped — the shipped runtime is Bun on Linux, which the docs already require; no Windows claim is made. Output on timeout is the tail captured up to the kill, never a promise of complete output. Test count 1773 -> 1777; packed files stay 65; the enforced (first-occurrence) marker advances in this same commit.

<!-- spec-check files=68 tests=1893 -->

## Workstream LXXIII — the menu walk cannot rest on an inert row (2026-11-19)

Armed condition (verbatim): "inspect for regression on behavior functionalities. fix what needs fixing and improving to keep on moving forwards with the repo project." Fuzzy; this iteration came from fuzzing the context menu's pure selection helper instead of reading it.

Defect. `nextMenuIndex(index, delta, rows)` (src/core/hud.ts) stepped by adding `delta` modulo the row count and returned the first enabled row it met. When `delta` was a multiple of the count, every pass landed on the same row, so the loop exhausted and fell back to the resting index — which could be disabled while an enabled row existed. Reachable shape: `nextMenuIndex(1, 2, [{enabled:true},{enabled:false}])` returned the disabled row 1. A reduced-but-still-composite delta fared no better: with 4 rows and `delta = 2` the walk visited only one residue class (rows 1 and 3) and never reached an enabled row 0. The shipped keymap only ever passes +-1, so nothing misbehaved in production — but the docstring promises the inert-row contract unconditionally, and a future caller passing a page-sized delta would have broken it silently.

Fix. `delta` now reads as a direction (negative = up, positive = down), which is the only meaning a menu walk has; the walk steps one row at a time for at most `count` passes, so it always reaches every row. `delta === 0` is an explicit no-move that still normalizes the resting index. The docstring states the direction contract instead of implying magnitude.

Evidence (test/tui-hud.test.tsx, 3 tests): the multiple-of-count cases (2 rows with the second inert, 6-row menu with a full lap), the no-move case, and a property sweep over every row-count 1..6, every enabled/disabled mask with at least one enabled row, every resting index -2..n+2 and every delta in {-7,-2,-1,1,2,7} — in range and enabled, always. The property test and the multiple-of-count test failed on the previous helper (2 fail) and pass now; the pre-existing pinned selection tests are unchanged. Test count 1777 -> 1780; packed files stay 65; the enforced (first-occurrence) marker advances in this same commit.

<!-- spec-check files=68 tests=1893 -->

## Workstream LXXIV — the check gate stops shipping a stale TUI artifact (2026-11-19)

Armed condition (verbatim): "inspect for regression on behavior functionalities. fix what needs fixing and improving to keep on moving forwards with the repo project." Fuzzy; this iteration came from a defect in the gate itself, hit in this very session: a workturn changed `src/tui.tsx`, ran `bun run check`, and forgot to commit the rebuilt `dist/tui.js`. Nothing failed. The suite was green, the SPEC marker matched, docs were fresh — and the committed TUI was the previous one.

The hole. `dist/tui.js` ships precompiled (OpenCode's Solid transform skips `node_modules`, so the installed package must carry built output). `bun run check` ran `bun run compile`, which rewrites `dist/tui.js` — but never compared the result with what was committed. The only signal was `git status` dirt, and nothing reads that. A stale artifact could therefore pass every gate: `tsc`, the full suite, the TUI load check (which loads the stale file happily), docs freshness and the SPEC marker. The old chain, verbatim: `tsc --noEmit && (cd test && bun test) && bun run compile && bun run check:tui && bun run docs:check && bun run check:spec`.

Fix. `scripts/build.ts` gains `--check` (wrapped as `bun run check:dist`, now part of `bun run check` before `compile`): it captures the artifact's current bytes, builds, compares against the fresh normalized output, and exits non-zero with the byte counts and the repair line when they differ. It restores the artifact before it exits either way, so a failed check never half-updates the tree — `bun run compile` stays the only writer. `--target <file>` points the comparison elsewhere so the gate can be tested without touching the real artifact. The build is byte-stable (verified: three consecutive builds, identical md5), which is what makes an equality check meaningful.

Evidence (`test/build-freshness.test.ts`, 3 tests): the committed artifact matches a fresh build (exit 0); a stale target fails with "is stale" + "bun run compile" and the target file is byte-identical afterwards (the check does not repair); a missing target fails with "is missing". Manual discrimination: appending a line to `dist/tui.js` makes `bun scripts/build.ts --check` exit 1 while the old chain's `bun run compile` would have silently overwritten it. README's Develop block now names the stage. Test count 1780 -> 1783; packed files stay 65; the enforced (first-occurrence) marker advances in this same commit.

Honest limits. The gate proves the artifact was built from the current `src/tui.tsx`, not that the build is correct — that is the TUI load check's and the render suite's job. It compares bytes, so a toolchain bump (Bun/OpenTUI) that changes output formatting will fail the gate until the artifact is rebuilt; that is the intended prompt to re-commit it.

<!-- spec-check files=68 tests=1893 -->

## Workstream LXXV — the SPEC intro quotes the shipped glyphs (2026-11-19)

Armed condition (verbatim): "Fix pending_fixes.md item 13: make the SPEC.md intro quote the shipped glyphs (breath wave, resting waiting glyph, six fixed rows, achieved marker) as rendered by code and pinned by tests, with bun run check green and the change on a merged wt/ lease." Closes the last open prose item from the terminal-TUI consistency sweep.

The drift. The intro was written before the pill's glyph family and the context menu settled, and it kept four quotes the renderer no longer produces: the breath wave as `· • ● •` (shipped `◦ ○ ◎ ○`), the waiting ring as a small `○` (shipped the large `◯`, kept distinct from the resting face `○`), the in-card context menu as "four fixed rows" (shipped six — `copy dossier` and `save dossier file` were added after the sentence was written), and the terminal acknowledgment as `◎` (shipped `●`, the same `terminalGlyph` the achieved flash paints). Each shipped form is rendered by `src/core/hud.ts` and pinned in `test/tui-hud.test.tsx`; only the prose had drifted.

Fix (SPEC.md intro only). The breath wave now reads `◦ ○ ◎ ○`; the waiting ring reads `◯`; the menu reads "six fixed rows" and enumerates all six shipped rows (`copy condition`, `copy evaluator reason`, `copy latest summary`, `copy dossier`, `save dossier file`, `clear goal`); the acknowledgment reads `● goal achieved` / `● loop complete`. No other sentence changed.

Evidence (`test/spec-intro-glyphs.test.ts`, 4 tests — a new pin, not a re-quote). The test reads the SPEC intro (everything before `## Acceptance criteria`) and asserts it against the code that renders the glyphs: the wave equals `[0,1,2,3].map(breathGlyph).join(" ")`; the waiting ring equals the leading cell `pillModel` paints for `waiting: true` (U+25EF); the row count equals `contextMenuRows(...).length` and every row's `text` is quoted; the acknowledgment equals `terminalPill(achieved, ...).text` and the old `◎ goal achieved` string is absent. All four failed on the pre-fix intro (the wave and words were wrong) and pass now. Test count 1783 -> 1787; packed files stay 65 (test/ is outside package.json files); the enforced (first-occurrence) marker advances in this same commit.

Honest limits. The test pins the exact strings the intro quotes — glyphs, the menu count and each row label — not the surrounding prose; a reworded sentence that keeps these tokens passes. It deliberately leaves the intro's `verdict glyphs (✓ / ⊘ / ○)` parenthetical alone: that `○` is the shipped satisfied-at-HEAD `verdictEntryGlyph` (history.ts), not a stale verdict glyph.

<!-- spec-check files=68 tests=1893 -->
## Workstream LXXVI — the created-shell event reads its id where the others do (2026-11-19)
Armed condition (verbatim): "review recent changes fix what needs fixing and merge and commit to dev and rebuild what needs rebuild." Fuzzy; this iteration closes the two remaining `pending_fixes.md` items (8 and 9) from the back-to-front sweep.
Defect 1 (`src/runtime/events.ts`, `shell.created`). The event router's `shell.updated`, `shell.exited` and `shell.deleted` arms all read their id from `data.info ?? data` and fall back to a top-level `data.id`, and read the owner from either `info.metadata.sessionID` or `data.metadata.sessionID`. `shell.created` read only `info` (`asRecord(data.info)`), so a created event whose id/owner rode the top-level `data` was silently dropped: `BackgroundTracker.shellCreated` never saw it, `busy()` undercounted that session's shells, and the evaluator could run while a shell the session started was still live. The arm now mirrors `shell.updated` (id fallback, owner fallback, status fallback).
Defect 2 (`src/core/parse.ts`, `unquote`, cosmetic). A lone unmatched quote — `/goal "` — was one character, so it failed the `length >= 2` gate and was returned unchanged; `parseGoalCommand` then set the condition to the bare `"`. It now returns empty for a single quote so the command falls back to status.
Evidence. `test/controller.test.ts` gains "shell.created reads the id/owner at the top level too": a created event with `{ id, status, metadata }` at the top level (no `info`) registers one shell, and a present-but-empty `info` no longer masks the top-level id (two shells). `test/core.test.ts` gains "a lone unmatched quote is status": `"`, `'`, `` ` `` each parse to `status`. Discrimination: with the pre-fix `shell.created` (info-only) the controller test fails (0 shells, expected 2); with the pre-fix `unquote` the quote test fails (`set` with condition `"`, expected `status`). Both pass now.
Honest limits. Defect 1 is defensive-shape parity, not a change to the documented event contract: the shipped opencode `shell.created` carries `info.id`, so this is the same posture `shell.updated`/`exited` already take against a top-level id. Defect 2 only affects the degenerate one-quote input; ordinary quoted conditions and unquoted text are unchanged. `pending_fixes.md` items 8 and 9 are marked fixed and item 8's stale `src/core/events.ts` path corrected to `src/runtime/events.ts`. Test count 1787 -> 1789; packed files stay 65; `dist/tui.js` byte-unchanged (no TUI source touched).
<!-- spec-check files=68 tests=1893 -->
## Workstream LXXVII — the compaction checkpoint is history, not goal grammar (2026-11-19)
Armed condition (verbatim): "here is another one that triggers it. again. after the session compaction." The repro: after a landing compaction in a session whose goal has already ended, the next model request is rejected by the provider with HTTP 400 `{"error":{"message":"The last message must have role=user.","type":"invalid_request_error","code":"invalid_request_error"}}`.
Defect (`src/core/prompts.ts`, the `context` hook's strip predicates). After a landing compaction opencode folds the whole conversation into a single user message, `<conversation-checkpoint>`: a `<summary>` plus a `<recent-context>` that quotes the compacted turns verbatim — including any `<goal>` / `<goal-continuation>` text those turns carried (`packages/core/src/session/runner/to-llm-message.ts` builds it; `history.ts` folds the kept tail into it). `stripGoalContext` (`src/core/prompts.ts`) matched on `text.includes(tag)` for both the note (`<goal-note`) and instruction (`INSTRUCTION_TAGS`) grammars, so a checkpoint whose recent text quoted the goal was classified as a goal message. When the goal is terminal (`controller.live()` is undefined — an achieved/impossible/cleared/failed record, or simply no live goal), the hook deletes every goal message, so it deleted the checkpoint. After a landing compaction that checkpoint can be the only user message in the request, so the request went out with zero messages (or, for a trailing `<goal-continuation>`, with an assistant message last) — and a strict provider rejects exactly that.
Fix. A compaction checkpoint is history, never one of the plugin's own notes or instructions: `isGoalNoteMessage` and `isGoalInstructionMessage` now return false for any message carrying the `<conversation-checkpoint>` marker, so `stripGoalNotes` / `stripGoalContext` leave it in place. The `context` hook in `src/index.ts` also keeps a trailing-user invariant: if stripping would remove the message that leaves the request ending on a non-user role, it re-appends the original trailing message so the request still ends on a user turn (a stale goal line is harmless history; an invalid request aborts the turn). The pure strip functions keep their exact contracts — the invariant lives in the hook.
Evidence. `test/notes.test.ts` pins the predicate: a checkpoint whose `<recent-context>` quotes `<goal>` and `<goal-note final>` is neither a note nor an instruction, and `stripGoalContext([checkpoint])` keeps it. `test/plugin.test.ts` pins the hook: a lone checkpoint message survives a no-live-goal `context` pass, and stripping a trailing `<goal-continuation>` never leaves the request without a trailing `role:"user"` message. Discrimination: before the fix `stripGoalContext([checkpoint])` returns `[]` (and `stripGoalContext([assistant, continuation])` ends on `assistant`); with it, the checkpoint survives and the continuation case is repaired. Test count 1789 -> 1793; packed files stay 65 (`test/` is outside package.json files); `dist/tui.js` byte-unchanged (no TUI source touched).
Honest limits. The checkpoint exclusion trusts the marker string; it does not parse the checkpoint. The trailing-user repair restores the original trailing message rather than synthesising a neutral turn, so in the rare continuation race a finished goal's continuation line may ride one request — the terminal `TERMINAL_REMINDER` (system part) is the counter-instruction. This is a plugin-side repair: `9router-go` forwards tokenharbor's OpenAI-compatible 400 verbatim (the string is absent from its source and binary; its `EnsureTrailingUserTurn` repair runs only on the Claude path), so the plugin must not hand it a request ending off a user turn.
<!-- spec-check files=68 tests=1893 -->

## Workstream LXXVIII — the project is its own CLI: `goal-loop` (2026-11-19)
Armed condition (verbatim): "turn the current directory into its own cli: goal-loop cli: having its own commands make sure to not over engineer. leaset commands is the best. the way of it is working is from plugins of opencode cli. but for the people they can use install it from goal-loop cli. easy setup very easy to remove and install and uninatall. make it as simple as abc-123. the primary source is from github." Follow-up: "and rename the plugin as well name it to goal-loop".
Identity. The product, the CLI, the package and the registered plugin are now `goal-loop`; the host stays OpenCode and the GitHub repository keeps its slug (`paumkim/opencode-goalv2`), so the install specifier is still `github:paumkim/opencode-goalv2#v<version>`. `bin/opencode-goal.mjs` → `bin/goal-loop.mjs` (types alongside), `package.json` `name` and `bin.goal-loop`; `opencode-goal` stays a bin alias and `PLUGIN_PACKAGE = "opencode-goalv2"` stays in the matcher list so a config written by an older installer still uninstalls cleanly. `PLUGIN_ID` → `goal-loop`, TUI id → `goal-loop.tui`, dossier/spend-ledger footers, the mirror directory (`<tmpdir>/goal-loop-mirror`) and the prose in README/docs/AGENTS.md follow. `OPENCODE_GOAL_*` env vars are untouched: they are the documented configuration surface and renaming them would break every existing setup.
Three commands, no more. `goal-loop` (install, the default), `goal-loop uninstall`, `goal-loop status`; flags `--global`/`--project`/`--dry-run`/`--restore` were already there, and `--self` is new: it deletes the CLI script after removing the plugin entry, and only when the running file is really the goal-loop CLI (basename plus a content marker), never an arbitrary path.
One-line install from GitHub (`install.sh`, shipped in the tarball). It fetches `bin/goal-loop.mjs` from the repository (curl, wget, or a local `GOAL_LOOP_SOURCE`), rewrites the shebang to `bun` when only bun exists, installs to `${GOAL_LOOP_BIN_DIR:-$HOME/.local/bin}/goal-loop`, then runs `goal-loop install` — one command from a clean machine to a registered plugin. Server removal is the same one command: `goal-loop uninstall --self`. The version is baked into the standalone script as `FALLBACK_VERSION` (a copy outside the repo has no `package.json`), pinned to `package.json` by a test.
Evidence. `test/cli-installer.test.ts` grew 9 tests: the help text names goal-loop and the three commands; `--version` prints `goal-loop <pkg.version>`; `FALLBACK_VERSION` equals `package.json`'s version; `--self` is rejected outside uninstall; `--self` deletes the script, `--self --dry-run` deletes nothing, and a non-CLI file named `goal-loop` is refused; `install.sh` installs from a local source into a temp `GOAL_LOOP_BIN_DIR` with no network and the installed copy answers `--version`; `install.sh` is executable and carries the documented one-liner. The dossier snapshots were re-recorded for the new footer text (two frames, four cells). `bun test` 1793 → **1802 pass / 0 fail**; `bun run check` green; packed files 65 → 66 (`install.sh` ships).
Honest limits. Renaming `PLUGIN_ID` changes the plugin's storage namespace, so goal records saved by an older build are not restored into the new id — an accepted cost of the rename, not a migration path. `install.sh` needs `node` or `bun` on PATH (the CLI is a single dependency-free `.mjs`); there is no bundled binary. Legacy entrypoints (`opencode-goal` bin alias, the `opencode-goalv2` spec) are kept for back-compat, not advertised.
<!-- spec-check files=68 tests=1893 -->

## Workstream LXXIX — name fields reflect the goal-loop identity (2026-11-19)
Armed condition (verbatim): "go over the recent changes for consistencies of code changes and updates name vaildating those things so the name fiels are reflects it." Interpretation: audit the LXXVIII rename (`opencode-goalv2` -> `goal-loop`) for fields that still name the old product, and fix the ones that no longer reflect what they name. Name surface only; no behavior changes.
1. `bun.lock` workspace `name` stayed `opencode-goal` while `package.json` `name` is `goal-loop` — the lockfile was never regenerated after the rename. It now reads `goal-loop`, and `test/name-fields.test.ts` pins it against `package.json`.
2. `docs/index.html` search index advertised `install npm i -g opencode-goalv2 opencode-goal` — an install route the project no longer ships (the CLI is `goal-loop` from `install.sh`, no npm account). Keywords are now `install goal-loop install.sh curl uninstall status remove`.
3. `docs/config.html` (`int ≥100`) and `README.md` ("min 100") documented the `maxConditionChars` floor that `resolveConfig` had already lowered to 0: the option accepts `0` and then rejects every objective. The type cell and the README row now say `int ≥0` / `min 0; 0 rejects every objective`, and the test asserts `resolveConfig({ maxConditionChars: 0 }) === 0` next to the documented strings, so code and docs can no longer disagree silently.
4. `docs/styles.css`'s header comment called the site "opencode-goalv2 docs"; it now names the product (`goal-loop`) and keeps the repo slug as the qualifier.
5. `RELEASE-CHECKLIST.md` documents the 1.1.0-era artifact (`bin/opencode-goal.mjs`, `opencode-goal --version`). The historical steps stay verbatim; a naming note at the top maps them to today's `goal-loop` names so the checklist is not silently wrong when re-run.
6. SPEC.md itself still named the pre-rename product in its title and carried ~90 historical `opencode-goal*`
   references with no declared reading. The title now names `goal-loop`, and a `naming:start`/`naming:end` block
   right under it states the canonical identity, maps each pre-rename name to its current one, and lists the
   legacy names that stay current by design. Workstreams before LXXVIII keep their text; the declaration is
   what makes it readable. `test/name-fields.test.ts` pins the declaration (title, current names, the map's
   targets existing on disk, no pre-rename id in shipped code, and the legacy surface still present).
Evidence. `test/name-fields.test.ts` (11 tests) pins the fields: the package name; the lockfile workspace name; the bin map
(`goal-loop` plus the legacy `opencode-goal` alias onto the same executable file, its exec bit, `FALLBACK_VERSION`
equal to `package.json`'s version, and `install.sh` in `files`); the plugin ids in `src/index.ts`, `src/tui.tsx`
and the shipped `dist/tui.js` (and no `opencode-goal.tui` there); the `goal-loop-mirror` directory in code and
docs; the docs search keywords; and the `maxConditionChars` floor in code plus both docs. It also pins SPEC's own
declaration: the title, the current names in the `naming:start`/`naming:end` block, every pre-rename name still
used in SPEC being mapped to a target that exists, no pre-rename id in shipped code, and the legacy surface
(bin alias, `PLUGIN_PACKAGE`, repo slug, `OPENCODE_GOAL_*` prefix) still present. Test count 1802 -> 1813; packed
files stay 66 (the suite sits under `test/`, outside `package.json` `files`).
Honest limits. Legacy names stay on purpose and are out of scope: `OPENCODE_GOAL_*` env vars (`test/env-vars.test.ts` owns that surface), the `opencode-goal` bin alias, `PLUGIN_PACKAGE = "opencode-goalv2"`, the GitHub repo slug, and the upstream `EL4CTEO/opencode-goal` credit. SPEC.md's older workstreams keep their historical paths, and the docs search index is curated by hand, not generated.
<!-- spec-check files=68 tests=1893 -->

## Workstream LXXX — the terminal ground-truth line rides only requests that still carry goal text (2026-11-19)
Armed condition (verbatim): "can you actually updated inspect the evaluator: this seems to be after goal achieved thing. there seem to be a stale system in there."
Finding. The evaluator does not run for a finished goal: `onExecutionSucceeded` returns unless `record.status === "active"`, verdicts land only on live records, and `restore()` adopts live records only, so an achieved goal is inert on the evaluation path. The stale artifact sits one step later, in the `context` hook: once any goal for a session ended in this process, `TERMINAL_REMINDER` was pushed into the SYSTEM part of every model request for the rest of the session, whether or not the request still contained anything goal-shaped. That is the line a session keeps carrying after achievement ("A /goal was set earlier ... Do not resume work toward it"), long after the only risk it counters — a compaction checkpoint quoting the expired `<goal>` kickoff, which `stripGoalContext` deliberately keeps — has left the context.
Fix. `carriesGoalGrammar(messages)` (src/core/prompts.ts) scans model-bound text for the goal instruction tags, checkpoint quotes included; the shared matcher `carriesGoalTag` now backs both it and `isGoalInstructionMessage`. The hook strips first and injects the terminal line only when the surviving request still carries goal text: the checkpoint quote, or a trailing user turn the strict-provider repair kept. With no goal text in the request the line is not injected.
Evidence. `test/notes.test.ts` pins the predicate (plain message, `null`/number/object entries, a checkpoint quoting `<goal>`). `test/plugin.test.ts` (LXVII) asserts both sides on a real achieved record: a post-achievement request whose only goal message is stripped gets no system line; a checkpoint quoting `<goal>` still gets one. Discrimination: with the gate removed the plugin test fails (Expected false, Received true) and passes again with it restored. Test count 1813 -> 1814; packed files stay 66.
Honest limits. The line is still process-local and still rides every request that does carry a checkpoint quote — that is the case it exists for. The gate keys on the plugin's own tag grammar; goal text a compaction summary rephrases without a tag is not detectable and never was.
<!-- spec-check files=68 tests=1893 -->

## Workstream LXXXI — the coordinator can release a claimed lease it will never submit (2026-11-19)
Armed condition (verbatim): "The evaluator wants the next step: release/expire the idle duplicate claim keep-improving-goal-loop."
Finding. `docs/parallel-work.md` already told agents not to "leave claimed-but-idle leases lying around" and to "claim, work, submit or abandon", but the binary had no abandon path: `claim` refuses paths overlapping a live lease, and only `merge-next`/`merge-done` ever flipped a lease to done. An idle claim therefore had to be cleared by forcing every later overlapping claim (`claim --force`) or by hand-editing `.term/coordinator/state.json`, which the bookkeeping policy forbids. The concrete case: lease `keep-improving-goal-loop` (agent `goal-loop-improver`, paths `src,test,SPEC.md,docs`) sat claimed with a clean worktree at dev HEAD, a day old, no process working it.
Fix. `coordinator release <slug> [--force]` (`do_release` in `packages/coordinator/bin/coordinator`) releases a claimed lease: status flips to `done` with `releasedAt` and `releaseReason`, so overlap checks and merge preflight stop counting it. Nothing is destroyed — the worktree is removed through the existing `safe_remove_worktree`, which stashes non-exempt dirt into `refs/coordinator/saved/<slug>-<ts>` and prints the recovery command; a branch carrying unique commits is kept (measured against `dev`, else `HEAD`) with a `git worktree add` rebuild line printed, and only a branch with no unique commits is deleted. Guards: a submitted lease is refused (`merge-next`/`merge-abort` own it), a claimed lease that still holds uncommitted files or commits needs `--force` (a deliberate abandon, not cleanup), a done lease is an idempotent no-op, `wt/<slug>` is accepted as the slug spelling, and a lease whose worktree is already missing is still releasable.
Evidence. `test/coordinator.test.ts` "coordinator release" (7 tests) pins: an idle claim releases and the previously blocked overlapping claim then succeeds without `--force`; uncommitted work is refused with the lease left claimed, then preserved in `refs/coordinator/saved/` and `git stash list` under `--force`; a branch with commits is kept with the rebuild command printed; a submitted lease is refused; re-release is idempotent and an unknown slug errors; a missing worktree still releases; `doctor` stays green after the release. The suite stays at 66 packed files (tests live under `test/`).
Honest limits. Release ends a lease; it does not judge whether the claim's owner is alive — a human or agent chooses the slug. There is no time-based expiry sweep: an idle claim is cleared by naming it (this is deliberate; an automatic TTL could release a slow but live agent mid-work). Releasing does not rebase anyone's work, and the kept branch still needs to be submitted from a rebuilt worktree if the work turns out to matter.

## Workstream LXXXII — install/use/remove works on a first run, and the repository is named goal-loop (2026-11-19)
Armed condition (verbatim): "go over the current directory. i needed to be as very easy as possible to install and removed it make sure it will just work and compatible. do full test for first time install, use and remove demonstration if there are any flaw. fix what needs fixing commit" plus "also update the githup repo the name so it just say: goal-loop".
Finding. The documented one-liner (`curl .../main/install.sh | sh`) returned 404: `install.sh` and `bin/goal-loop.mjs` existed only on local `dev`, never on `main`, and `main` was 26 commits behind. The published plugin pin `#v1.1.0` also predated the installer. Three config-fidelity flaws showed up in a sandbox journey: (a) uninstall left a separator comma and a blank line behind when the plugin entry followed an inline comment, (b) removing the first `plugins` property shifted the following line's indentation, and (c) uninstall deleted a `$schema`-only or `{}` config the user had created, because the skeleton rule could not tell install's file from the user's; install also re-indented the following key when it inserted `plugins` before an existing first property.
Fix. `removePluginText` removes the last element with the separator comma it added (comment material preserved) and `removePropertySpan` starts at the line beginning so no indent is stranded; `insertPluginsProperty` matches the file's own indentation and CRLF. Uninstall restores the pre-install backup when the surgical removal leaves only install's skeleton or an empty root, and deletes only a file install created. The repository is renamed to `paumkim/goal-loop`; `PLUGIN_SPEC` is `github:paumkim/goal-loop#v1.2.0`, `install.sh`/README/docs point at the new raw URL, and the pre-rename `github:paumkim/opencode-goalv2#v…` entry is still removed by `uninstall`, reported by `status`, and migrated in place by `install` (never stacked next to the new specifier).
Evidence. Sandbox journeys with a fresh `$HOME`: `install.sh` (local source) installs the CLI, `goal-loop install` writes the skeleton, repeat install is `already installed`, `status` lists the config and opencode version, `uninstall` restores the original bytes, `uninstall --self` deletes the CLI; a comment/CRLF config round-trips byte-for-byte; a `$schema`-only config survives uninstall. `test/cli-installer.test.ts` grew by 8 tests (117 total in the file): round-trip fidelity, pre-existing skeleton/empty restore, old-slug migration, dual-entry collapse, old-slug uninstall and status. Test count 1821 → 1829; packed files stay 66 (test/ is outside `package.json` `files`).
Honest limits. The published artifact is the tag: a client that pinned `#v1.1.0` keeps that code until it runs the new installer, which migrates the config but cannot change the tag it already resolved. `main` now carries the installer and reads the CLI from `main` while the plugin pin comes from `v1.2.0`; both must exist on the remote before the one-liner succeeds (tag pushed before `main`). GitHub redirects the old repository URL, so old links keep resolving, but clients that cached the old slug are not rewritten by GitHub.


## Workstream LXXXIII — persistent improvement backlog ledger and de-dup helpers (2026-11-20)
Armed condition (verbatim): "work on this one" — goal-loop blind spots for autonomous keep-improving mode (correctness gates narrower than system health; local fix != repository-wide improvement; planning lacks a durable prioritized backlog; progress signals can be gamed/ambiguous; evaluator/judge single point of failure; coordinator/concurrency and drift risks; safety and change-risk classification; limited learning from history) with highest-leverage next steps: (1) persistent prioritized backlog + de-dup, (2) goal-specific verification/invariant matrix beyond `bun run check`, (3) failure-signature detection with automatic strategy escalation.

Finding. Blind spot #3: next iterations rely on summaries/hints and repo re-reads; without a persistent, machine-readable backlog, prioritization can be ad hoc and important issues can be forgotten or repeated. The repository had no durable backlog artifact capturing findings, impact, risk, evidence, status, or dedupe keys.

Fix. Add `docs/improvement-backlog.json` (versioned, machine-readable) seeded with the eight blind spots and their highest-leverage improvements as prioritized items (`id`, `title`, `category`, `priority`, `impact`, `risk`, `status`, `finding`, `improvement`, `evidence`, `dedupeKeys`, `related`). Add `src/core/improvement-backlog.ts` with pure helpers: `normalizeDedupeKey`, `validateImprovementBacklog`/`parseImprovementBacklog`, `findBacklogDedupeMatches`, `selectNextBacklogItem` (priority, impact, risk, stable id; excludes non-selectable statuses and completed ids/dedupe keys), and `inspectImprovementBacklog`. This establishes the durable ledger and de-dup/selection primitives for future planner integration (steps #2 and #3 remain open backlog items in the seed ledger).

Evidence. `test/improvement-backlog.test.ts` (14 tests) pins normalization, schema validation (duplicate ids, missing/invalid fields, enums, non-finite priority), parse failures/success, cross-item dedupe-key collision detection, next-item selection/ranking and completed-id/key exclusion, and validates the shipped `docs/improvement-backlog.json` seed (>= 8 items, required ids present, no dedupe collisions, highest-priority selection defined). `bunx tsc --noEmit` exits 0 in the worktree. `cd test && bun test` exits 0 with 1857 pass / 0 fail / 28 snapshots (76 files). `npm pack --dry-run --json` lists 67 files (adds `src/core/improvement-backlog.ts`; `docs/improvement-backlog.json` and `test/improvement-backlog.test.ts` are outside `package.json` `files`). `test/package-integrity.test.ts` and the spec-check marker updated in the same commit.

Honest limits. This iteration delivers the ledger artifact and pure selection/dedup helpers; it does not yet wire the planner/controller to read the backlog automatically, does not implement goal-specific verification/invariant matrices (#2), and does not implement failure-signature detection/strategy escalation (#3). Those remain open, prioritized items in `docs/improvement-backlog.json`. The seed ledger is hand-curated; future feeding from audits/failing checks/TODO/FIXME/telemetry is out of scope here.


## Workstream LXXXIV — loop planner consults the improvement backlog (de-dup + selection) (2026-11-20)
Armed condition (verbatim): "Continue the goal-loop improvement loop in /home/pauk/Projects/goal-loop (iteration 2)... wire the `/goal-loop` planner/controller to consult `docs/improvement-backlog.json` when choosing/advancing work — load/validate the ledger, de-duplicate against completed conditions/history (`loopHistory`, completed-condition ledger), select the highest-priority unblocked open item (use `selectNextBacklogItem`), and surface the chosen item/evidence in the armed objective or planning context; if the ledger is missing/invalid, fall back to current behavior (no regression)."

Finding. Iteration 1 seeded `docs/improvement-backlog.json` and pure helpers, but loop advance planning (`loopAdvance` -> `evaluator.nextGoal`) had no backlog context; next-iteration selection relied only on the planner prompt and completed-condition/history text, so the durable prioritized ledger could not steer or de-duplicate planned work.

Fix. `src/runtime/controller.ts` now loads/validates `docs/improvement-backlog.json` from the goal directory during loop advance (best-effort, never throws into the planning path) and selects a backlog suggestion with `selectNextBacklogItem`, de-duplicated against completed conditions, the completed-condition ledger, loop objective, and `loopHistory`/current-iteration conditions, summaries and reasons (normalized text plus substring matching on normalized id/dedupe keys). When present, the suggestion (id, title, category, priority, impact, risk, finding, improvement, evidence) is logged and passed to the planner. `src/runtime/ports.ts`, `src/runtime/evaluator.ts` (pass-through), and `src/core/prompts.ts` surface it in `nextGoal` planning context (`BacklogSuggestion`, `NextGoalInput.backlogSuggestion`, prompt block instructing the planner to prefer a concrete, verifiable next condition advancing the item when its required work is ABSENT at HEAD). Missing/unreadable/invalid ledgers or empty selection yield no suggestion and preserve existing behavior.

Evidence. `test/loop.test.ts` " /goal-loop backlog planner integration" (4 tests): planner receives the highest-priority unblocked suggestion; completed conditions/history de-duplicate selected items on subsequent planning; missing ledger falls back (no `backlogSuggestion`); invalid ledger falls back. `bunx tsc --noEmit` exits 0. `cd test && bun test` exits 0 with 1861 pass / 0 fail / 28 snapshots (76 files). `bun run check` exits 0 in the worktree (`docs:watch once` refreshed changelog/stamps; `spec-check: ok (67 files, 1861 tests match SPEC.md)`).

Honest limits. The backlog steers planning context (planner prompt) rather than force-arming a condition verbatim, preserving the planner's ABSENT-at-HEAD/duplicate audit. Initial `/goal-loop` arming is unchanged; consultation happens on loop advance. De-dup against completed work is heuristic (normalized text and key-substring matching), not semantic proof of completion. Backlog state is not auto-updated when work lands (items remain `open`/`in_progress` as seeded), and there is no automatic feeding from audits, failing checks, TODO/FIXME, or telemetry yet. Verification/invariant matrix (#2) and failure-signature/strategy escalation (#3) remain open backlog items.
<!-- spec-check files=68 tests=1893 -->

## Workstream LXXXV — detail dialog stays consistent when goals pile up (2026-11-20)
Armed condition (verbatim): "improve '/home/pauk/Pictures/Screenshots/Screenshot_20261120_004938.png' the terminal tui dialog display on detail view. when the goal are starting to pile up. massive it goal? the detail display is breaking it needs to be consisten design terminal tui."
Interpretation. The `/goal` detail dialog (`StatusDialogBody`, overview tab) becomes visually inconsistent under load: (a) a massive goal — very long condition, evaluator reason or loop objective — wraps across many lines and the row's copy affordance does not stay anchored to the field's first line; (b) when live goals pile up in other sessions, the `elsewhere` block renders ragged columns because the session tag and the loop/state label size to their content instead of a fixed cell width, so condition text and the `→ transcript` affordance do not line up across rows; and (c) the elsewhere header is a single no-wrap line that can clip on narrower dialog widths. The dialog must read as one consistent terminal table/layout in these cases: fixed-width elsewhere columns, a wrapping elsewhere header, and multi-line field rows whose affordance stays top-aligned with the label.
Fix.
- `src/status-dialog.tsx`: elsewhere rows render the session tag in a fixed `OTHERS_TAG_MAX`-cell column and the loop/state label (`vN/M` or `active`/`paused`, width-clipped to that budget) in a fixed `OTHERS_STATE_MAX`-cell column so every row's glyph, session, state, condition and transcript affordance align. The elsewhere header uses `wrapMode="word"` so it reflows instead of clipping. Field rows that can wrap (goal condition, evaluator/reason) pin `alignItems="flex-start"` so the copy affordance stays on the row's leading line rather than floating against a multi-line block.
- `scripts/render-dialog.tsx`: gains `--pileup` to render a massive-goal, many-elsewhere stress frame (long condition/reason/objective, 12 other live goals with mixed loop/state labels) so the layout can be eyeballed headlessly at a fixed width.
- `test/tui-render.test.tsx`: pins elsewhere column alignment under pile-up (rows share the same session/state column positions) and pins that a wrapped condition keeps its copy affordance on the leading line; `test/tui-snapshots.test.tsx` gains a pile-up detail snapshot where warranted.
Evidence. Headless render: `bun --preload @opentui/solid/preload scripts/render-dialog.tsx --pileup --width=100` paints aligned elsewhere columns and a top-anchored copy affordance on a multi-line condition. `bun run check` passes in the worktree (tsc, tests, compile, tui load, docs:check, spec-check).
Honest limits. The fix normalises layout and alignment; it does not collapse or summarise a genuinely massive condition/objective (the full text remains scrollable and copyable by design). Elsewhere rows still render one line per goal when expanded; the fold-to-4 default bounds the common case, but an expanded list of many goals remains a long scroll.


## Workstream LXXXVI — evaluator staleness, busy-check recovery, and snapshot/loop-advance resilience (2026-11-20)
Armed condition (verbatim): "Fix goal-loop evaluator staleness so active loop evaluations and planner steps reliably land instead of being dropped or stuck. Scope: `src/runtime/controller.ts`, `src/runtime/evaluator.ts`, `src/runtime/ports.ts`, `src/runtime/events.ts`, and related tests (`test/loop.test.ts`, `test/controller.test.ts`, `test/evaluator.test.ts` as needed)."

Finding. Background/busy-state checks on turn completion and background drain failed closed by logging and skipping evaluation (`goal busy check failed; skipping evaluation`) with no retry, so a transient busy-check error could permanently strand carried turn work until an unrelated event retried the path. Some stale epoch drops (e.g. after async busy resolution / pre-evaluation phases) discarded turn tool accounting without recovery; stale drops were not consistently observable. `evaluating`/`queued`/`waiting` snapshot semantics needed to remain truthful across abort/stale drop/retry/failure (invalidate already clears evaluating and emits, but recovery paths had to preserve/persist waiting and tool carry correctly). Loop advance already retried planner failures with bounded backoff and guarded against duplicate re-arm by iteration check, but stale-drop observability around async steps could be clearer.

Fix. `src/runtime/controller.ts`: added `runtime.busyRetries` and helpers to resolve background state with bounded retry/backoff (`resolveBackgroundAndEvaluate`, `retryDeferredBackgroundCheck`, `scheduleBusyRetry`, `ensureDeferredState`), preserving carried tool calls on busy-check failure/stale pre-evaluation drops and scheduling recovery instead of permanent skip; `onExecutionSucceeded` and `onBackgroundDrained` now log "goal busy check failed; will retry", keep/persist waiting state, emit retry notices, and re-evaluate once background state is known (bounded exponential backoff, capped). Added observable stale-drop logging (`logStaleDrop`, "goal evaluation step dropped as stale") for evaluation and key loop-advance async boundaries (before/after verdict, summary/next-goal generation, arm commit/steer boundary) without changing intentional supersession semantics. Straggler-drop logging now includes `awaitingExecution`/`dropStragglerSucceeded` flags for ordering diagnosis. Busy-retry state is cleared with deferred state/reset paths; snapshot flags continue to reflect runtime truth (`evaluating` cleared on invalidate/finally/failure paths, `queued` only while a continuation steer is dispatched/awaiting execution, `waiting` persisted/emitted on deferred/retry states).

Evidence. Updated `test/controller.test.ts`: "skips evaluation when the busy check errors" → retries/recoverable waiting behavior with bounded backoff; "a busy-check rejection during drain..." now asserts warn+retry notice and eventual recovery; added regressions "busy-check failure preserves carried tool work and recovers evaluation", "straggler succeeded while awaiting retry execution is dropped, then real retry execution is evaluated", and "evaluator timeout/failure retries with bounded backoff and keeps snapshots non-stuck". Follow-up: added loop-advance supersession-race recovery for summary/next-goal stale drops so active iterations re-arm instead of losing progress, updated "user prompt during next-goal generation drops the half-advanced state" to assert recovery/no lost iteration progress, and added "loop-advance summary stale-drop recovery re-arms without losing iteration progress" in `test/loop.test.ts`. Post-arm tail: detects stale/supersession races after the armed iteration is durably committed (same active record, iteration already advanced) and recovers the pending continuation/arming steer idempotently (no duplicate re-arm, respects running/awaitingExecution), with regression "a supersession race after the arm commit still dispatches exactly one continuation for the armed iteration" and "a user prompt landing during the arm's persist recovers continuation without announcing the arm". Targeted suites: `bun test test/controller.test.ts test/loop.test.ts test/evaluator.test.ts` → 272 pass / 0 fail; `bun test test/loop.test.ts` → 165 pass / 0 fail; `bun test test/controller.test.ts` → 77 pass / 0 fail. Full verification: `cd <worktree> && bun run check` exits 0 — `tsc --noEmit` ok; `cd test && bun test` 1866 pass / 0 fail / 28 snapshots (76 files, 29389 expect() calls); `build --check` ok; `dist/tui.js` built (347735 bytes); `tui-load-check` ok (`goal-loop.tui`); docs freshness check passed; `spec-check: ok (67 files, 1872 tests match SPEC.md)`.

Honest limits. Stale drops remain intentional when a newer epoch legitimately supersedes in-flight work (e.g. user prompt/execution start/clear/replace); the fix makes drops observable and recovers cases where a completed turn's tool work would otherwise be lost (busy-check/pre-evaluation resolution paths), but does not replay a verdict computed for a superseded transcript state. Event-stream gaps outside controller control (missing started/succeeded delivery) cannot be fully synthesized; recovery relies on bounded retries and future host events. Loop planner/summary transient failures still retry with capped backoff and recompute (no duplicate re-arm due iteration guards), which is the existing safe posture rather than a new persistence model.
<!-- spec-check files=68 tests=1893 -->


## Workstream LXXXVII — evaluator rubric requires clause/evidence matrix, adversarial checks, and structured next actions (2026-11-20)
Armed condition (verbatim): "You are the goal-loop evaluator for this session. Judge only from fresh, visible evidence in the current conversation at the current HEAD (command output, test/build/lint/typecheck results, diffs/files shown, commit hashes/branches, gate output). Narration, prior claims, previous verdicts, and \"should pass\" are not evidence. For each turn, do this in order: (1) Parse the armed condition into explicit, verifiable clauses. (2) Build an evidence matrix per clause: {clause, required evidence, observed evidence, status: satisfied|missing|contradicted|unscoped, source/turn}. (3) Adversarial check: \"What would falsify met?\" and \"What important risk is untested?\" If any plausible falsifier or material gap remains, do not verdict met. (4) Gate policy: met requires every clause satisfied by fresh, scoped evidence (including required commits/submit/merge/checks when applicable). Green but unscoped is insufficient for broad goals (e.g. full-suite green without targeted/smoke/regression evidence for touched risk, or claims without matching artifacts). not_met for missing/weak/stale/contradictory evidence, weakened or detached tests/gates, uncommitted or unsubmitted required work, drift, or visible regressions. impossible only with strong evidence the condition can never be satisfied. (5) Detect repeated failure signatures from recent verdicts/reasons (same missing evidence, same failing gate, same flaky/error pattern, same unaddressed gap). If repeating, require strategy escalation: narrow scope, produce a diagnostic artifact, or mark blocked with the blocker. Return a verdict and a machine-actionable reason for the orchestrator: verdict met|not_met|impossible; reason covering (a) clause-by-clause judgment with evidence refs, (b) gaps/flaws/risks found (or \"none material\"), (c) repeated-failure/escalation note if any; next: when not_met or when met but improvements remain, list 1-3 prioritized concrete actions in form `next: 1. [priority/risk] <exact improvement> — evidence gap/finding — required proof to close it.` If met and no meaningful gap remains, write `next: none`. Never accept partial completion as met. Never invent evidence. Prefer the smallest highest-leverage fix that closes the most critical falsifiable gap."

Interpretation. This goal specifies the evaluator's required judgment discipline and output contract. "Build, verify against SPEC, commit" means implement this contract in the goal-loop evaluator rubric/prompts and keep verdict parsing/consumption compatible so live evaluations follow it. The evaluator judges only from visible conversation/transcript evidence at current HEAD; it cannot run commands or read files itself. "Repeated failure signatures from recent verdicts/reasons" are detected from evidence visible in the transcript/context (prior evaluator reasons, continuation notes, repeated gate output), not from hidden runtime memory.

Acceptance criteria.
- `src/core/prompts.ts` evaluator rubric and evaluation prompts (session and independent) instruct: parse condition into explicit verifiable clauses; build an evidence matrix per clause `{clause, required evidence, observed evidence, status: satisfied|missing|contradicted|unscoped, source/turn}`; perform adversarial falsification/untested-risk check and refuse `met` when any plausible falsifier or material gap remains; apply gate policy (`met` only when every clause satisfied by fresh scoped evidence; green-but-unscoped insufficient for broad goals; `not_met` for missing/weak/stale/contradictory evidence, weakened/detached tests or gates, uncommitted/unsubmitted required work, drift, visible regressions; `impossible` only with strong evidence); detect repeated failure signatures from recent visible verdicts/reasons/gate patterns and require strategy escalation when repeating.
- Output contract remains machine-readable JSON verdict (`{"verdict":"met|not_met|impossible","reason":"..."}`) for parser compatibility, with `reason` carrying: (a) clause-by-clause judgment with evidence refs, (b) gaps/flaws/risks found (or "none material"), (c) repeated-failure/escalation note if any; and `next:` actions in the specified prioritized form when not_met or when met but improvements remain, else `next: none` when met with no meaningful gap. Existing `parseVerdict`/controller verdict handling continues to work.
- Tests pin the updated rubric/output contract expectations and parsing compatibility (targeted prompt/verdict tests as needed).
- `cd <worktree> && bun run check` exits 0.

Verification.
- `bun test` targeted evaluator/prompt/verdict suites covering new rubric contract and parse compatibility.
- `bun run check` (tsc, full test suite, dist check/build, tui load, docs check, spec-check) exit 0 in the worktree.
- Commit on `wt/<slug>` branch and `coordinator submit`; merge landed on `dev`.

Honest limits. The evaluator remains transcript-evidence-only and cannot execute commands or read files; clause parsing, evidence-matrix reasoning, adversarial checks, and repeated-failure detection are enforced by prompt/rubric instructions rather than a separate runtime verifier, so quality depends on model compliance within existing generation/repair limits. "Repeated failure signatures" are limited to patterns visible in the current conversation/context available to the evaluator, not a persisted cross-session failure taxonomy. Broad "green but unscoped" judgments are heuristic (scoped to what evidence is visibly present) unless corroborated by configured verifier gates or explicit artifacts.
<!-- spec-check files=68 tests=1893 -->


## Workstream LXXXVIII — profile-aware verification matrix beyond single check (2026-11-20)
Armed condition (verbatim): "Advance docs/improvement-backlog.json item \"verification-matrix-beyond-check\" from partial to complete: implement a profile-aware verification matrix beyond the single bun run check gate so broad goals cannot be met on green-but-unscoped evidence. Define required check types/evidence by goal/profile (at minimum: typecheck, targeted tests, lint/build as applicable, plus any goal-declared checks), record each required check’s fresh command/output/exit evidence in the verdict trail and dossier, and update evaluator rubric/prompts/config to treat missing or unscoped required verification as not_met with concrete next actions. Add targeted tests for pass/fail/unscoped cases, update SPEC/docs as needed, and land on dev via coordinator (claim wt/<slug>, commit, submit, merge-next) with `bun run check` exit 0 and fresh evidence. Why this next: it closes the highest-risk gap left by the recent rubric/trail work—met can still be claimed without profile/scoped proof for broad goals even though per-turn verify evidence is now recorded."

Interpretation. Extend the existing optional single-command verifier (`evaluator.verifyCommand`) into a profile-aware verification matrix of required command checks with typed evidence. A "profile" is the resolved set of required checks for the goal: configured checks (`evaluator.verifyChecks`) plus backward-compatible synthesis of legacy `verifyCommand`; checks may be always-required or required for broad goals. "Broad goals" are goals whose scope is broad/fuzzy relative to a single scoped check (e.g. multi-clause improvement/refactor/audit/fix-all/complete goals), so a single green gate or unscoped evidence is insufficient. Each required check that runs must record fresh command/output/exit evidence in the verdict trail and dossier. When the evaluator would accept `met` but required matrix verification is missing, unscoped for the goal/profile, or any required check fails/times out/errors, the runtime downgrades to `not_met` with concrete next actions naming the missing/failing/unscoped check and required proof. "Goal-declared checks" are represented as explicitly configured custom checks (declared in goal-loop config/profile for the session/repo) with type `goal-declared`/`custom` and required evidence; transcript-only claims without executed command evidence remain insufficient.

Acceptance criteria.
- Config (`src/core/config.ts`, `GoalConfig`): supports a verification matrix beyond single `verifyCommand`, e.g. `evaluator.verifyProfile`/profile-aware settings and `evaluator.verifyChecks` definitions with at minimum `id`/`type` (`typecheck|tests|lint|build|smoke|custom|goal-declared`), `command`, optional timeout, required/applicability (always or broad-goal). Legacy `evaluator.verifyCommand`/`verifyTimeoutMs` remain backward-compatible (synthesized as a matrix check when no explicit matrix provided, or composed per defined behavior). Resolution/env/options behavior is deterministic and tested.
- Runtime/types/wire (`src/core/types.ts`, `src/runtime/controller.ts`, `src/runtime/ports.ts`, `src/core/wire.ts`): on a `met` verdict, execute applicable required matrix checks and record each check's fresh evidence (id/type/label, command, exit code, timedOut, output tail, pass/fail) in the verdict trail entry and expose it for dossier/export; `lastVerify` remains compatible. A required check failure, timeout, spawn/error, or missing/unscoped required verification for the active profile/broad goal downgrades `met` to `not_met` with a reason that names the check(s) and concrete next action/proof required.
- Evaluator rubric/prompts (`src/core/prompts.ts`): explicitly require profile/matrix-aware scoped verification for broad goals; treat green-but-unscoped or missing required check types/evidence as `not_met` with concrete next actions. Parser/controller verdict handling remains compatible.
- Dossier/rendering (`src/core/dossier.ts` and any affected TUI/export consumers): verdict trail/dossier renders per-check matrix evidence (pass/fail/unscoped/missing as applicable) so records show explicit required-check proof.
- Tests: targeted coverage for pass, fail, timeout/error, missing/unscoped required verification on broad goals, and backward compatibility with legacy single `verifyCommand`; wire/dossier/config coverage updated as needed.
- Docs/backlog: update `docs/improvement-backlog.json` item `verification-matrix-beyond-check` status/evidence as completed by this implementation and update `SPEC.md`/docs/changelog as required. `cd <worktree> && bun run check` exits 0.

Verification.
- Targeted: config resolution, matrix verification pass/fail/unscoped cases, verdict-trail/wire/dossier evidence, evaluator prompt contract, backward-compat single-check behavior.
- Full gate: `bun run check` exit 0 in worktree (tsc, test suite, dist check/build, tui load, docs check, spec-check).
- Landing: commit on `wt/verification-matrix-beyond-check`, `coordinator submit`, `coordinator merge-next` to `dev` with fresh merge/preflight/check evidence.

Honest limits. "Goal-declared checks" are supported as explicitly configured/custom matrix checks (command-executed, evidence-recorded), not as free-form natural-language obligations auto-extracted from arbitrary goal text. "Broad goal" detection/profile applicability is heuristic/config-driven and cannot perfectly infer every scope boundary; unscoped-green rejection relies on configured/applicable required checks plus rubric instructions for transcript-evidenced claims. Matrix execution adds evaluator-turn latency/cost proportional to configured checks and runs only on candidate `met` verdicts (same gating point as legacy verify). Transcript-only evidence for required command checks remains insufficient when the matrix requires executed command results.
<!-- spec-check files=68 tests=1893 -->

## Workstream LXXXIX — goal-declared checks, deterministic coverage, concurrency/reuse, and artifact evidence modes (2026-11-20)

Armed condition (verbatim): "Work in /home/pauk/Projects/goal-loop (coordinator repo: claim a `wt/<slug>` worktree before editing, work/commit only there, then `coordinator submit` and `coordinator merge-next` to land on `dev`).

Objective: reduce the honest limits of the profile-aware verification matrix by making goal-declared and broad-goal verification more automatic, deterministic, and efficient—without weakening fresh-evidence guarantees.

Current limits to address
1. Goal-declared checks are only explicitly configured/custom command-executed matrix checks; they are not auto-extracted from arbitrary natural-language goals.
2. Broad-goal detection/applicability is heuristic/config-driven and cannot infer every scope boundary; unscoped-green rejection relies partly on configured/applicable required checks plus rubric guidance rather than fully deterministic runtime policy.
3. Matrix execution runs on candidate `met` verdicts and adds latency/cost proportional to required checks.
4. Required command checks cannot be satisfied by transcript/artifact evidence even when an equivalent fresh, scoped proof is already present.

Acceptance criteria
- **NL goal-declared checks:** Parse explicit, structured check declarations from goal conditions (define and document a safe syntax, e.g. fenced/inline directives like `verify: type=<typecheck|tests|lint|build|smoke|goal-declared> cmd=\"<command>\" [when=always|broad] [id=...]`) and merge them into the resolved verification matrix as typed, command-executed checks with recorded per-check evidence. Ignore/flag malformed declarations safely; never execute arbitrary shell beyond declared commands under existing verifier constraints.
- **Deterministic broad/scope policy:** Replace/augment heuristic-only broad-goal handling with a deterministic applicability policy: compute required check coverage from goal/profile + resolved checks (and parsed goal-declared checks), classify evidence as scoped vs unscoped per required type, and have runtime downgrade `met` to `not_met` whenever required scoped coverage is missing/unscoped—even if the evaluator rubric text is weak. Keep heuristics only as hints/default profile selection, not the sole enforcement path.
- **Performance/cost controls:** Add bounded matrix optimizations that preserve correctness: run independent checks concurrently with a configurable concurrency cap, short-circuit optional/non-blocking vs required semantics only as configured, cache/reuse identical fresh check results within the same evaluated turn/HEAD when safe, and record timing plus \"skipped/reused/parallel\" evidence in the verdict trail/dossier.
- **Evidence-typed satisfaction (scoped):** Introduce explicit check/evidence modes so a required check can be satisfied either by executed command evidence or by fresh, scoped transcript/artifact evidence only when the check definition allows it (e.g. `evidence: command|artifact|either`, with required artifact patterns/proof). Default required command checks remain command-executed; no silent fallback to narration.
- **Compatibility & observability:** Preserve backward compatibility with `evaluator.verifyCommand`/existing matrix configs and legacy record/wire fields (additive). Verdict trail and dossier must show, per check: source (configured/legacy/goal-declared), scope decision, execution mode/result or artifact evidence, timing/reuse/concurrency metadata, and concrete next action when unmet."

Interpretation. Reduce the LXXXVIII honest limits by (1) parsing explicit, structured goal-declared `verify:` directives from the goal condition and merging them into the resolved matrix, (2) enforcing deterministic runtime coverage/scope policy for broad and scoped goals independent of evaluator rubric text, (3) adding bounded concurrency/reuse/caching/timing optimizations, and (4) allowing explicit artifact-evidence satisfaction modes only when configured with required literal artifact patterns and fresh scoped transcript/artifact evidence is present. Fresh-evidence guarantees remain: command checks default to executed command evidence at current checkout/HEAD; artifact satisfaction requires declared patterns matched in fresh transcript context (no narration fallback). "Goal-declared checks" here means both configured `goal-declared` type checks and checks parsed from explicit structured directives in the goal condition.

Safe goal-declared syntax (documented). Line-oriented directive: `verify: type=<typecheck|tests|lint|build|smoke|goal-declared> cmd="<command>" [id=<id>] [when=always|broad] [evidence=command|artifact|either] [label="<label>"] [artifacts="<pattern1||pattern2>"] [required=true|false] [timeoutMs=<ms>]`. `cmd` and `artifacts`/`label` values must be quoted strings (escaped as needed). `evidence=artifact|either` requires at least one literal artifact pattern (`||`-separated inside `artifacts="..."` or repeated `artifact="..."` keys). Malformed directives are ignored and recorded in matrix metadata (`malformedGoalChecks`) with reason; they are never executed.

Acceptance criteria.
- Parsing/merge: `src/core/verify-matrix.ts` parses structured `verify:` directives from goal conditions, flags malformed declarations safely, and resolves them together with configured/legacy checks (`resolveVerifyChecks`) as typed checks with source `goal-declared|configured|legacy`, evidence mode, and artifact patterns. `src/runtime/controller.ts` merges parsed goal-declared checks into the resolved verification matrix at evaluation time and records per-check evidence.
- Deterministic broad/scope policy: runtime computes required coverage from goal/profile + resolved checks + parsed goal-declared checks (`computeScopePolicy`/`evaluateCoveragePolicy`) and downgrades `met` to `not_met` when required scoped coverage is missing/unscoped (including broad goals with generic-only/unscoped coverage) even if evaluator rubric text is weak. Heuristic broad detection remains only as classification/profile hint; enforcement is deterministic runtime policy with concrete next actions.
- Performance/cost controls: independent command checks execute concurrently with configurable cap `evaluator.verifyConcurrency` (env `OPENCODE_GOAL_VERIFY_CONCURRENCY`, default 2, 1-8). Identical fresh command results are cached/reused within the same evaluated turn/HEAD when safe (including coalesced identical in-flight checks). Matrix/check evidence records timing (`durationMs`, `timing.totalMs`), concurrency, parallel execution, reused/skipped counts and per-check `reused`/`parallel`/`skipped`/`executionMode` metadata.
- Evidence-typed satisfaction: checks support `evidence: command|artifact|either` (default `command`) with `artifactPatterns` for `artifact|either`. `command` requires executed command evidence. `artifact` may be satisfied only by fresh scoped transcript/artifact evidence matching all required literal patterns (no command fallback, no narration fallback). `either` prefers matching fresh scoped artifact evidence and falls back to command execution when artifact evidence is not satisfied. Artifact patterns are required for `artifact|either`; invalid config definitions are dropped deterministically.
- Compatibility & observability: legacy `evaluator.verifyCommand`/`verifyTimeoutMs` synthesis and existing matrix configs remain backward-compatible (additive fields). Wire/types accept legacy and additive evidence shapes. Verdict trail and dossier render per check source, scope decision, execution/artifact mode/result, timing/reuse/concurrency metadata, artifact pattern/match/missing details, malformed goal-declared directives, and concrete next action when unmet.
- Tests/docs: targeted coverage added for NL parsing/malformed declarations, deterministic broad-goal rejection without rubric dependence, parallel execution and reuse/caching correctness/timing evidence, artifact-vs-command/either evidence rules, and backward compatibility (`test/verify-matrix-goal-declared.test.ts`, `test/verify.test.ts`, updated config/wire/dossier/docs-coverage tests). README/docs/config/SPEC/changelog/backlog updated.

Verification.
- Targeted: `cd test && bun test verify.test.ts verify-matrix-goal-declared.test.ts wire.test.ts dossier.test.ts config-defaults.test.ts docs-coverage.test.ts` (pass).
- Full gate: `cd <worktree> && bun run check` exit 0 (tsc, full tests, check:dist, compile, check:tui, docs:check, check:spec).
- Coordinator: commit on `wt/<slug>`, `coordinator submit`, `coordinator merge-next` from `/home/pauk/Projects/goal-loop` with fresh merge/preflight/check evidence; landed on `dev`.

Honest limits. Only explicit, structured `verify:` directives in the goal condition are parsed (not arbitrary natural-language extraction); malformed directives are reported and never executed. "Fresh scoped transcript/artifact evidence" is matched as required literal patterns against rendered session transcript/context available at evaluation time (best-effort scoping to current session evidence) and cannot prove provenance beyond what transcript content shows; command checks remain the default and strongest proof. Broad-goal classification still uses heuristic/profile hints for applicability selection, but required coverage enforcement is deterministic runtime policy over resolved checks/profile and fails closed with concrete next actions when coverage is missing/unscoped. Reuse/caching is limited to identical check semantics within the same evaluated turn/HEAD (or coalesced identical in-flight checks in the same matrix run) and records reuse metadata; it never reuses across different turns/HEADs. Concurrency is bounded and applies to independent command executions; total latency remains proportional to required work not satisfied by allowed artifact evidence or reuse.

