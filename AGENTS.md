# opencode-goal

Claude Code-style `/goal` loop for OpenCode v2: an evaluator judges a completion condition after every turn until it is met. Shipped as a plugin (`@el4cteo/opencode-goal`).

## Entrypoints

- `index.ts` → `src/index.ts` `Plugin.define setup()` — the server plugin. Only place wiring lives (config, commit policy, bootstrap, RPC, `/goal` + `/goal-loop` commands, hooks, event pump). `/goal-loop <objective>` is a `/goal` whose `met` verdicts arm a summarized next iteration until `maxLoops`, `LOOP_COMPLETE`, impossible, clear, or two zero-tool-call iterations; loop state rides the persisted `GoalRecord` (`loopEnabled`, `loopIteration`, `loopObjective`, `loopMaxLoops`, `loopHistory`, `loopNotProgress`; additive, `version` stays 1).
- `src/core/*` — pure, no I/O beyond fs reads: `config.ts` (options + env), `git.ts` (commit policy), `prompts.ts` (directive + evaluator rubric), `bootstrap.ts` (first-run layout), `parse/verdict/transcript/errors/format`.
- `src/runtime/*` — stateful: `controller.ts` (goal state machine, `/goal-loop` advance: met → summarize → arm next iteration, `maxLoops`/`LOOP_COMPLETE`/not-progress guards), `evaluator.ts`, `store.ts`, `events.ts`, `background.ts`, `ports.ts`.
- `tui.ts` → `dist/tui.js` (precompiled). Edit TUI in `src/tui.tsx`, never `tui.ts`/`dist/`. `rpc.ts` → `src/rpc.ts` (shared client contract).

## Commands

```sh
bun install
bun run check                 # tsc --noEmit && bun test && bun run compile && bun run check:tui (TUI load check; order matters: tsc first)
bun test test/git.test.ts     # single file; bun test <file-or-pattern> for the rest
bun run compile               # rebuild dist/tui.js from src/tui.tsx (required after any TUI/JSX change)
bun run e2e <empty-dir> [provider/model]  # real opencode server + live model, ~10min; E2E_MODEL overrides model
```

- Runtime is Bun only. TS is strict + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`; imports use `.ts` extensions (`from "./git.ts"`), type imports must be `import type`.
- Tests are `bun:test`, no runner config, no fixtures on disk: fake repos are bare `.git/` dirs (HEAD + `refs/heads/*`, no git binary needed), `plugin.test.ts` mocks the plugin context. `e2e.ts` is the only suite needing a real server/model.

## How it works (non-obvious)

- **The plugin never runs git or edits files.** It reads `.git`/`HEAD`/`refs`/`packed-refs` (see `src/core/git.ts`) and directs the *agent* to commit; the evaluator judges only visible transcript evidence, so commit output must appear in the conversation.
- **Cold-start:** on `setup()` in a git repo, `ensureCoordinatorLayout()` creates `.term/coordinator/{config,state}.json` + `worktrees/` if missing (never overwrites) and the commit policy becomes coordinator mode. Detection needs `.term/coordinator/config.json` + `state.json`, or the coordinator bin + one json.
- **Commit rule:** coordinator repos → agent works on `wt/<slug>` and `submit`s; `merge-next` merges into `dev` and gates on `bun run check`. Outside a git repo the rule is off. `resolveCommitPolicy` takes an optional absolute plugin coordinator bin — never emit a repo-relative bin path.
- **Vague goals** (`isFuzzyCondition` in `prompts.ts`): first turn writes `SPEC.md` (acceptance + verification incl. screenshot for visual requests), then builds, verifies, commits. Precise conditions skip this.
- **State/robustness:** per-session records (`goal/v1/<sessionID>`), restore on restart, epoch-guarded async work, 3-turn stall pause, 200-turn cap (pauses and *stays* paused until `/goal clear` or a new goal; a message alone will not extend the cap).

## Coordinator (`packages/coordinator/bin/coordinator`)

- Flow: `claim <task> --agent <you> --paths <scope>` → work in `worktrees/wt-<slug>` on `wt/<slug>` → `submit`. Never commit to `dev`/`main` directly; only `merge-next` lands on `dev`.
- Requires `jq` (plus `git`, `bun` for the merge gate). Claim is flock-locked with lease re-check; path overlap without `--force` is a hard error; `status --json` lists leases (`state.json` is the coordination bus).
- `merge-next` removes the merged worktree + `wt/` branch and marks the lease `done`. Leftover `worktrees/wt-*` dirs are safe to prune; leases in `.term/coordinator/state.json` are the source of truth.
- This repo's own `opencode.json` forces `coordinator: true`. Work here the same way: claim, worktree, submit.

## Config

Options in `opencode.json` `plugins[].options`, parsed by `resolveConfig`: `evaluator.model/mode/maxTranscriptChars/maxOutputTokens/timeoutMs`, `maxTurns`, `stallTurns`, `checkinMinutes`, `maxIdleCheckins`, `maxRetries`, `maxConditionChars` (unlimited by default), `systemReminder`, `transcriptNotes`, `requireCommit`, `commitBranch` (default `dev`), `coordinator` (`auto`/`true`/`false`), `compactAtTokens`, `maxLoops` (default 5), `maxLoopSummaryTokens` (default 400). Env overrides: `OPENCODE_GOAL_MODEL`, `OPENCODE_GOAL_MAX_TURNS`, `OPENCODE_GOAL_CHECKIN_MINUTES`, `OPENCODE_GOAL_COMMIT_BRANCH`, `OPENCODE_GOAL_REQUIRE_COMMIT`, `OPENCODE_GOAL_COORDINATOR`, `OPENCODE_GOAL_COMPACT_AT_TOKENS`, `OPENCODE_GOAL_MAX_LOOPS`, `OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS` (see `src/core/config.ts`).

`docs/` is a static, build-free site (open `docs/index.html`); update `install.html`/`config.html` when install or options change.
