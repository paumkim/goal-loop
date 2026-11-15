# opencode-goal

Claude Code's `/goal` for **OpenCode v2**. Give the agent a finish line; it keeps working, turn after turn, until an evaluator confirms the condition is met.

![/goal in the OpenCode CLI](https://raw.githubusercontent.com/EL4CTEO/opencode-goal/main/assets/goal-status.png)

## Install

```sh
opencode plugin add @el4cteo/opencode-goal
```

Or from GitHub: `opencode plugin add github:EL4CTEO/opencode-goal`, or point `plugins` in `opencode.json` at a local clone:

```json
{ "plugins": ["/path/to/opencode-goal"] }
```

Requires OpenCode 2.0.29 or newer.

## Use

| Command | What it does |
| --- | --- |
| `/goal <condition>` | Sets the goal and starts working on it right away |
| `/goal` | Shows status: condition, time, turns, spend, last evaluator reason |
| `/goal clear` | Removes the goal (`stop`, `off`, `reset`, `none`, `cancel` also work) |
| `/goal-loop <objective>` | Like `/goal`, but when a goal is met the loop summarizes it and arms the next, harder goal automatically |
| `/goal-loop` | Shows the loop status: objective, iteration, per-iteration history |
| `/goal-loop clear` | Ends the loop (same aliases as `/goal clear`) |

```text
/goal bun test passes with 0 failures and no test file is modified
```

While a goal runs, the footer shows its state:

![footer indicator](https://raw.githubusercontent.com/EL4CTEO/opencode-goal/main/assets/goal-running.png)

**Write a good condition:** one measurable end state, how to prove it (`npm test exits 0`), and anything that must not change. Add a limit for open-ended work, e.g. `or stop after 20 turns`.

## How it works

- After every turn, an evaluator reads the conversation and answers **met**, **not met** or **impossible**.
- **Not met:** the agent gets the reason and starts the next turn on its own.
- **Met / impossible:** the goal ends and a note is added to the transcript.
- The evaluator only accepts **fresh evidence**: command output produced at the current HEAD, after the last change — not earlier turns' claims or the agent's own summary. If the agent says tests pass with no test output in front of you, that is **not met**.
- When `evaluator.verifyCommand` is set, a met verdict is not accepted until the plugin itself runs that command (e.g. `bun run check`) and it exits 0. The evaluator proposes; the verifier disposes. A failing command downgrades the verdict to not-met with the output tail in the reason, so the next turn knows exactly what broke.
- By default the evaluator reuses the session's cached context, so each check costs little more than a short answer.
- Finished work has to be committed before the goal counts as met. See [the commit rule](#the-commit-rule).

Safety rails:

- **Never pauses automatically:** it keeps going across turns, failure retries (rate limits every 15 minutes, transient errors with capped exponential backoff) and zero-tool-call stretches. It stops only on (1) your interrupt (Esc), (2) a terminal provider error the user must fix — auth, credit balance, quota exhaustion — the goal fails instead of waiting, (3) an explicit `maxTurns` cap you set yourself (default 0 = off), or (4) `/goal clear`. (An explicit cap still stays paused at the cap; a message will not extend it.)
- **Retries** dropped connections and overloads forever with capped exponential backoff; rate/usage-limit failures are retried every 15 minutes. `checkinMinutes: 0` only disables idle check-in nudges, not retries.
- **Fails** (distinct from `cleared`) on errors you must fix: auth, credit, context overflow, missing model. A failed goal is terminal and is not resumable by sending a message; fix the cause and run `/goal` again. `cleared` only means you (or a replacement goal) ended it.
- **Waits** while subagents or background shells run, with check-ins at 30 min, then 60, then 120.
- **Restores** active goals after a restart or plugin reload, and compacts them at the boundary so they resume from a fresh context.

## The commit rule

A goal that ends with its work uncommitted leaves the job half done, because nothing about it is in the
repository's history. Inside a git repository the plugin tells the agent to commit the finished work and to show
the commit output, and the evaluator treats uncommitted work as **not met**. The reason it names is the commit
itself, so the next turn has something to do.

The rule follows the repository:

- The branch is `dev` by default. If the repository has no `dev` branch, the checked out branch is used instead.
- Outside a git repository there is nothing to commit, so the rule switches itself off.
- `requireCommit: false` turns it off everywhere.

### Coordinator mode and first-run bootstrap

When the plugin loads inside a git repository, it creates `.term/coordinator/` and `worktrees/` for you (plus stub `config.json`/`state.json`, never overwriting existing files). If a `.gitignore` is present it also appends `worktrees/` and `.term/coordinator/*.lock` to it (idempotent; missing entries only). No manual setup is needed beyond `git init` and installing the plugin. The agent claims a `wt/<slug>` lease, works in its own worktree, commits there, and submits; the coordinator merges to `dev` and removes the worktree and branch. `main` stays read-only for agents. `merge-next` gates on `bun run check` of the merged result (trial merge on a scratch branch): a branch whose merge fixes a failing gate is merged, not rejected, and `dev` is left untouched when the merged result fails. The main checkout must be clean apart from the coordinator's own `state.json`; that exempt dirt is stashed for the duration of the trial merge and restored afterwards, so a branch that records only `state.json` lease bookkeeping merges cleanly through the gate.
With `coordinator: true` the agent always goes `claim -> wt/<slug> -> submit`.
The evaluator is read-only and gates `not_met` until wt commit + submit evidence appears.
If no coordinator binary can be located (neither the project's `packages/coordinator/bin/coordinator` nor one bundled with the plugin), the prompt says so instead of naming a path; the agent works on a `wt/<slug>` branch and the merge to the target branch is left to you.

Prerequisites: a git repository where the coordinator's target branch exists (`dev` by default; `merge-next` checks it out), and `jq` for coordinator state.

Parallel sessions: each session claims its own slug/worktree. Overlapping paths are a hard error without `--force`. Run `status --json` to see the other leases.

Fuzzy requests: a vague goal like "make it look like a rabbit" is turned into a `SPEC.md` loop. The agent writes `SPEC.md` first (interpretation, acceptance criteria, verification including screenshot/render for visual), then builds, verifies against the spec, and commits.

## `/goal-loop`: keep improving after the finish line

`/goal <objective>` stops the moment the evaluator says **met**. `/goal-loop <objective>` does not: each met
verdict triggers a compact summary of what was achieved (a short machine-consumable block, not a transcript
dump), then the evaluator generates the next, harder goal from that summary, and the agent arms it immediately
under the same `/goal` rules — turn cap, stall guard, retries, commit rule, restore on restart.

```text
/goal-loop make the docs site faster and more complete
```

The footer shows the iteration (`◎ loop · v2 · active · 14m · 2 turns`); the status dialog shows the objective
and one line per completed iteration.

The loop only advances on a **met** verdict — never on not-met, stall, pause, interrupt or retry paths. It
keeps arming across failure retries and zero-tool-call stretches: two consecutive zero-tool iterations are
recorded (`loopNotProgress`) but never pause the loop; the loop keeps arming. At every iteration boundary the
plugin asks the host to compact the session first (`compactOnLoopIteration`, default on), so each version
arms with a fresh context. It ends when any of these happens:

- You run `/goal-loop clear` (or `stop`, `off`, `reset`, `none`, `cancel`), or set a new goal.
- The evaluator judges an iteration **impossible** (terminal, like `/goal`).
- The loop reaches `maxLoops` completed iterations (default 5) — ends cleanly as achieved.
- The evaluator finds nothing meaningful left to improve and replies `LOOP_COMPLETE` — ends cleanly as achieved.
- The evaluator machine cannot summarize or plan at all (unsupported evaluator) — ends cleanly as achieved.
- A planner that repeats an already-completed condition — ends cleanly as achieved instead of spinning.

Each achieved iteration fires one info toast (`◎ Loop 1 achieved · → v2: …`); the end of the loop fires the
normal achieved toast once.

## Running the loop safely (fresh session checklist)

A fresh session that picks up or continues a `/goal-loop` should not trust anything carried over by the
arming steer. The failure modes this avoids: stale summaries describing work that was reverted, zero-progress
iterations waved through because the model said so, met verdicts accepted from narrated evidence, and probe
servers overwriting the live goal records.

1. **Re-read HEAD before working.** Every armed iteration is told to re-read `git log --oneline -5`,
   `git status --short`, `git branch --show-current` (plus `coordinator status --json` / `git worktree list`
   in a coordinator repo) and the current check output *before* touching anything. The loop summary is a hint,
   not ground truth; the tree is.
2. **Zero-progress is measured by the harness.** An iteration with zero tool calls (as counted by the plugin's
   own `onToolCalled` events) increments `loopNotProgress`; consecutive zero-tool iterations are recorded but
   never pause the loop. The model's account of how much work it did is irrelevant to this count.
3. **Met means verified, not narrated.** The evaluator requires fresh command output at the current HEAD, and
   with `evaluator.verifyCommand` set the plugin itself reruns the check before accepting met. Without the gate,
   a persuasive transcript that never shows the check passing is still not met.
4. **Probes are read-only.** Launch probe/scratch instances with `OPENCODE_GOAL_PROBE=1` so the plugin never
   writes goal storage; point them at a throwaway checkout. Live sessions are then unaffected by probe accidents.
5. **Bookkeeping is the merge's job.** Lease records in `.term/coordinator/state.json` are committed by
   `merge-next` itself (see above); never hand-commit them and never commit to `dev` directly.

For the operational version of this checklist see `docs/runtime.html`.

## Options

All optional, set in `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "@el4cteo/opencode-goal",
      "options": {
        "evaluator": { "model": "opencode-go/deepseek-v4.1-flash" },
        "maxTurns": 0,
        "stallTurns": 0,
        "checkinMinutes": 30,
        "maxRetries": 3,
        "systemReminder": false,
        "transcriptNotes": true,
        "compactAtTokens": 0,
        "compactOnLoopIteration": true,
        "maxLoops": 5,
        "maxLoopSummaryTokens": 400,
        "requireCommit": true,
        "commitBranch": "dev",
        "coordinator": "auto"
      }
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | — | Top-level fallback for `evaluator.model` (used only when it is unset; the env var wins over both) |
| `evaluator.model` | session model | Separate model that judges the goal (fresh eyes, uses a transcript digest) |
| `evaluator.mode` | `auto` | `session`, `independent`, or `auto` (independent when a model is set) |
| `evaluator.maxTranscriptChars` | `60000` | Transcript digest budget for the independent evaluator (min 4000) |
| `evaluator.maxOutputTokens` | `4096` | Verdict answer budget (min 256) |
| `evaluator.timeoutMs` | `120000` | Evaluation timeout in ms (min 5000) |
| `evaluator.verifyCommand` | `""` | When set, a met verdict is accepted only after this command exits 0 against the current checkout; empty disables. Env `OPENCODE_GOAL_VERIFY_COMMAND` |
| `evaluator.verifyTimeoutMs` | `600000` | Wall-clock budget for one verification run; a timeout counts as failure, never as a pass. Env `OPENCODE_GOAL_VERIFY_TIMEOUT_MS` |
| `maxTurns` | `0` | Hard turn cap, opt-in; `0` = none (default) |
| `stallTurns` | `0` | Turns without tool use before pausing, opt-in; `0` = never (default) |
| `checkinMinutes` | `30` | First background check-in; `0` disables idle check-in nudges (automatic retries never stop) |
| `maxIdleCheckins` | `3` | Max idle check-ins while background work runs |
| `maxRetries` | `3` | Retained for compatibility; no longer gates anything — automatic retries are unlimited with capped backoff |
| `maxConditionChars` | unlimited | Condition length cap (min 100); default never rejects |
| `systemReminder` | `false` | Also put the goal in the system prompt (costs one cache miss) |
| `transcriptNotes` | `true` | Record achieved/impossible verdicts in the transcript |
| `compactAtTokens` | `0` | Auto-compact at this many estimated model-visible tokens; `0` disables |
| `compactOnLoopIteration` | `true` | Request a host compaction at every loop-iteration boundary (and on restore of a live goal), so each iteration arms with a fresh context. Never requested mid-work (defers while a turn or background work is in flight); an unlanded request is re-requested after 2 armed iterations. Env `OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION` |
| `maxLoops` | `5` | `/goal-loop` cap on completed iterations; each met goal arms the next until the cap |
| `maxLoopSummaryTokens` | `400` | Token budget for the per-iteration loop summary (and the next-goal input); enforced as max(200, tokens) × 4 characters |
| `requireCommit` | `true` | Finished work has to be committed before the goal counts as met |
| `commitBranch` | `dev` | Branch the finished work has to land on (target branch in coordinator mode) |
| `coordinator` | `auto` | `auto` detects coordinator repos and uses `wt/<slug>` + submit; `true` forces it, `false` disables it |

Environment overrides: `OPENCODE_GOAL_MODEL`, `OPENCODE_GOAL_MAX_TURNS`, `OPENCODE_GOAL_CHECKIN_MINUTES`,
`OPENCODE_GOAL_COMMIT_BRANCH`, `OPENCODE_GOAL_REQUIRE_COMMIT`, `OPENCODE_GOAL_COORDINATOR`, `OPENCODE_GOAL_COMPACT_AT_TOKENS`,
`OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION`, `OPENCODE_GOAL_MAX_LOOPS`, `OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS`, `OPENCODE_GOAL_VERIFY_COMMAND`, `OPENCODE_GOAL_VERIFY_TIMEOUT_MS`.

`OPENCODE_GOAL_PROBE=1` puts the plugin in probe mode: plugin storage becomes read-only (goal records are never written or deleted, so `restore()` has no side effects). Use it for any probe opencode server or scratch instance that loads the plugin — otherwise a probe can mutate the live goal records shared with your real sessions. Verification commands still execute in the probe's working directory, so point probes at a throwaway checkout.

### Auto-compaction

`compactAtTokens` makes the plugin itself ask the host to compact the session once the estimated model-visible
context reaches an absolute token count — a window-independent complement to opencode's `compaction.buffer`,
which is relative to the model's context window.

`compactOnLoopIteration` (default `true`) is the loop-boundary complement: at every `/goal-loop` iteration arm
the plugin asks the host to compact the session regardless of the token threshold, so the next version arms
with a fresh context. It also compacts restored live goals on plugin startup. Boundary compaction is skipped
for tiny contexts (< 10k estimated tokens), honors the same in-flight/cooldown guards, and is queued *before*
the armed iteration's synthetic steer. `compactOnLoopIteration: false` (or `OPENCODE_GOAL_COMPACT_ON_LOOP_ITERATION=0`)
turns it off. opencode's own auto-compaction near the model window remains the backstop.

**Compaction never fires mid-work.** Both paths refuse to request a compaction while the session has work in
flight — a turn executing, or background subagents/shells running (tracked from the event stream) — and defer
with only a log line. The busy check fails closed: if the probe errors, the compaction is deferred. Even a
forced re-request (see below) skips only the 2-minute request cooldown; the in-flight and busy gates always hold.

**Accepted is not landed.** The host decides the actual compaction point, so the plugin tracks every boundary
request on the goal record (`loopCompact`: requestedAt, estimated context, iteration, misses). Landing is
detected two ways — the `session.compaction.ended` event, or a context-size drop at the next arm (≤60% of the
requested estimate) — and surfaced as a "Compaction landed" notice, in `/goal` output, in the `/goal` detail
dialog (a `compact` row under the objective while pending or after landing), and in the status line (the footer
marker carries the miss count while a request is outstanding).
A request that has not landed by the next two armed iterations is re-requested (forced past the cooldown,
never past the busy gate) with a "Compaction pending" warning.

**Compaction cuts the context, not the loop.** When a compaction lands, the history the armed directive, the
objective and the completed iterations live in is replaced by a lossy summary. The plugin then queues a
`<goal-loop-reanchor>` note restating the objective, the armed condition, the iteration position and the
completed iterations from its own record, plus the re-read-the-tree mandate. It is delivered as a queued,
non-waking message: it never interleaves into a turn in flight and never wakes the session — the next
continuation steer carries it into view. Plain goals rely on the per-turn system reminder instead.

The estimate is the last assistant message's `input + cache.read + cache.write` token usage, measured right
after each turn ends (`session.execution.succeeded`). Reasoning and output tokens are not counted: output has
already become input for the next step. Set e.g. `"compactAtTokens": 260000` in `opencode.json` or
`OPENCODE_GOAL_COMPACT_AT_TOKENS=260000`. `0` (the default) disables the check entirely. A compaction in flight
or requested within the last 2 minutes is not re-requested; a lost in-flight marker is swept after 10 minutes.

## Develop

```sh
bun install
bun run check                         # typecheck + unit tests + compile + TUI load check + docs freshness check (also runs in CI, see .github/workflows/check.yml)
bun run e2e <empty-dir> [provider/model]  # real run against a private opencode server (model also via E2E_MODEL, default opencode/deepseek-v4.1-flash-free)
E2E_MODEL=opencode/deepseek-v4.1-flash-free bun run e2e <empty-dir>
```

Every push to `dev`/`main` and every pull request runs `bun install --frozen-lockfile`, `bun run check` and an `npm pack --dry-run` smoke test on GitHub Actions (`.github/workflows/check.yml`).

## Documentation

Full docs live in `docs/` as a single-folder, dependency-free HTML/CSS site — no build step, no internet, no frameworks.

```sh
xdg-open docs/index.html   # Linux (or just double-click the file)
```

Pages: `index.html` (landing + search + FAQ) · `architecture.html` (diagram, state machine, data flow) · `runtime.html` (controller, events, evaluator, retry) · `config.html` (every option, default, env var) · `core.html` (per-file reference) · `install.html` (install, `/goal` commands, troubleshooting) · `changelog.html` (recent changes from `git log`).

Every page carries a "Last updated" stamp in the footer, derived from `git log` for that page (newest non-merge commit touching it, excluding mechanical `docs: refresh` commits). The stamp reflects the last content commit that touched the page, not necessarily the latest code change. The stamps and the changelog table are regenerated by `bun scripts/docs-watch.ts once`;

Freshness is enforced by `bun scripts/docs-watch.ts check` (`bun run docs:check`), which exits non-zero when a page's stamp trails the last content commit touching it or the changelog table diverges from git history. It runs as part of `bun run check` and CI. Workflow after committing docs-content changes: `bun scripts/docs-watch.ts once && git add -A && git commit -m "docs: refresh stamps and changelog"` — the refresh commit is excluded from the freshness anchor, so the gate stays green across merges and CI. The check is read-only. `bun scripts/docs-watch.ts watch` keeps them fresh automatically (event-driven, debounced, no polling, no server) and logs working-tree changes to a local `.docs-watch.log` (view with `bun scripts/docs-watch.ts log`). Both logs and state files are gitignored; the docs folder itself stays static HTML/CSS/JS with no build step.

All files are plain `.html` + `styles.css` + vanilla `app.js` and work by opening `docs/index.html` directly from the filesystem. Keep the `docs/` folder together — pages link to each other with relative paths.

## License & credits

MIT — see [LICENSE](LICENSE).

This project is based on the original `/goal` plugin by EL4CTEO, at https://github.com/EL4CTEO/opencode-goal. This fork is maintained by paumkim at https://github.com/paumkim/opencode-goalv2.

The original copyright notice is preserved verbatim in [LICENSE](LICENSE); the modifications and maintenance in this fork are copyright 2026 paumkim. The MIT license covers both.
