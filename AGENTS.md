# opencode-goal

Claude Code-style `/goal` loop for OpenCode v2: an evaluator judges a completion condition after every turn until it is met. Shipped as a plugin (`@el4cteo/opencode-goal`).

## Entrypoints

- `index.ts` → `src/index.ts` `Plugin.define setup()` — the server plugin. Only place wiring lives (config, commit policy, bootstrap, RPC, `/goal` + `/goal-loop` commands, hooks, event pump). `/goal-loop <objective>` is a `/goal` whose `met` verdicts arm a summarized next iteration until `maxLoops`, `LOOP_COMPLETE`, impossible, clear, or two zero-tool-call iterations; loop state rides the persisted `GoalRecord` (`loopEnabled`, `loopIteration`, `loopObjective`, `loopMaxLoops`, `loopHistory`, `loopNotProgress`; additive, `version` stays 1).
- `src/core/*` — pure, no I/O beyond fs reads: `config.ts` (options + env), `git.ts` (commit policy), `prompts.ts` (directive + evaluator rubric), `opencode-cli.ts` (`<opencode-cli>` guide injected into the directive for goals that mention opencode), `bootstrap.ts` (first-run layout), `parse/verdict/transcript/errors/format`.
- `src/runtime/*` — stateful: `controller.ts` (goal state machine, `/goal-loop` advance: met → summarize → arm next iteration, `maxLoops`/`LOOP_COMPLETE`/not-progress guards), `evaluator.ts`, `store.ts`, `events.ts`, `background.ts`, `ports.ts`.
- `tui.ts` → `dist/tui.js` (precompiled). Edit TUI in `src/tui.tsx`, never `tui.ts`/`dist/`. `rpc.ts` → `src/rpc.ts` (shared client contract).

## Commands

```sh
bun install
bun run check                 # tsc --noEmit && (cd test && bun test) (worktrees/ carries forks of the suite) && bun run compile && bun run check:tui && bun run docs:check (TUI load + docs freshness; order matters: tsc first)
bun test test/git.test.ts     # single file; bun test <file-or-pattern> for the rest
bun run compile               # rebuild dist/tui.js from src/tui.tsx (required after any TUI/JSX change)
bun run e2e <empty-dir> [provider/model]  # real opencode server + live model, ~10min; E2E_MODEL overrides model
```

- Runtime is Bun only. TS is strict + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`; imports use `.ts` extensions (`from "./git.ts"`), type imports must be `import type`.
- Tests are `bun:test`, no runner config, no fixtures on disk: fake repos are bare `.git/` dirs (HEAD + `refs/heads/*`, no git binary needed), `plugin.test.ts` mocks the plugin context. `e2e.ts` is the only suite needing a real server/model.

## How it works (non-obvious)

- **The plugin never runs git or edits files.** It reads `.git`/`HEAD`/`refs`/`packed-refs` (see `src/core/git.ts`) and directs the *agent* to commit; the evaluator judges only visible transcript evidence, so commit output must appear in the conversation.
- **Evaluator evidence requirements.** The evaluator accepts only fresh evidence: command output produced at the current HEAD, after the last change — not earlier turns' claims, the agent's narration, or a previous verdict. When `evaluator.verifyCommand` is set (env `OPENCODE_GOAL_VERIFY_COMMAND`, timeout `evaluator.verifyTimeoutMs`, default 600s), a `met` verdict is held at the plugin's verification gate: it spawns the command via `bash -c` in the goal's directory and accepts met only on exit 0. Non-zero exit, spawn error or timeout downgrades to `not_met` with the output tail in the reason (and a warning notice); the loop cannot advance on a failed verification. A missing verifier port fails closed. Default is `""` (gate off, byte-compatible behavior). `src/runtime/controller.ts` `verifyMet`, `src/index.ts` `createVerifier`, `src/core/prompts.ts` rubric.
- **Probe isolation.** Any probe opencode server or scratch instance that loads the plugin must run with `OPENCODE_GOAL_PROBE=1`. The plugin then makes plugin storage read-only (`GoalStore` drops saves/removes; reads pass through), so `restore()` and friends cannot mutate the live goal records. Verification commands still execute in the probe's cwd — point probes at a throwaway checkout, and never at this repo's live `.term/` or a live session's data.
- **Cold-start:** on `setup()` in a git repo, `ensureCoordinatorLayout()` creates `.term/coordinator/{config,state}.json` + `worktrees/` if missing (never overwrites) and the commit policy becomes coordinator mode. Detection needs `.term/coordinator/config.json` + `state.json`, or the coordinator bin + one json.
- **Commit rule:** coordinator repos → agent works on `wt/<slug>` and `submit`s; `merge-next` merges into `dev` and gates on `bun run check` **of the merged result** (trial merge on a scratch branch; `dev` is untouched on failure). Outside a git repo the rule is off. `resolveCommitPolicy` takes an optional absolute plugin coordinator bin — never emit a repo-relative bin path.
- **Vague goals** (`isFuzzyCondition` in `prompts.ts`): first turn writes `SPEC.md` (acceptance + verification incl. screenshot for visual requests), then builds, verifies, commits. Precise conditions skip this.
- **opencode-CLI goals** (`isOpencodeCliCondition` in `opencode-cli.ts`): when the condition mentions opencode, the first-turn directive injects an `<opencode-cli>` block — check `opencode --version`, never rebuild the installed binary, SlotMap (`node_modules/@opencode/plugin/dist/tui/context.d.ts`) is the only stable TUI extension surface, verify in a headless opentui render in /tmp, and report the layer (binary/source/test-render/live TUI) each claim was verified at. Conditions without "opencode" get nothing extra.
- **State/robustness:** per-session records (`goal/v1/<sessionID>`), restore on restart, epoch-guarded async work; the turn cap and stall guard are opt-in (default 0 = off) and apply to plain goals only — an armed /goal-loop never pauses at either (one notice each); a fatal provider error fails the goal; /goal clear stops it.

## Coordinator (`packages/coordinator/bin/coordinator`)

- Flow: `claim <task> --agent <you> --paths <scope>` → work in `worktrees/wt-<slug>` on `wt/<slug>` → `submit`. Never commit to `dev`/`main` directly; only `merge-next` lands on `dev`. The main checkout must be clean (the coordinator state file is exempt; merge-next stashes that exempt dirt around the trial merge and restores it, so a branch recording only `state.json` lease bookkeeping merges cleanly).
- **Bookkeeping policy (one, documented).** `merge-next` unions the live `.term/coordinator/state.json` with the committed copy (lease keys from both, live bus wins per key, `mergeLock` reset to null) and auto-commits it on `dev` as `chore(coordinator): record <slug> lease done after merge`. The union means an entry a wt bookkeeping branch landed on `dev` is never reverted by the merge's own lease flip. The chore commit is part of the merge flow — the only sanctioned path to `dev` — not a direct dev commit by an agent. If the commit fails the dirt stays exempt and the next merge-next retries. Do not hand-commit `state.json`; do not extend the exemption beyond this one file.
- Requires `jq` (plus `git`, `bun` for the merge gate). Claim is flock-locked with lease re-check; path overlap without `--force` is a hard error; `status --json` lists leases (`state.json` is the coordination bus).
- `merge-next` removes the merged worktree + `wt/` branch and marks the lease `done`. Leftover `worktrees/wt-*` dirs are safe to prune; leases in `.term/coordinator/state.json` are the source of truth.
- This repo's own `opencode.json` forces `coordinator: true`. Work here the same way: claim, worktree, submit.

- **SPEC honesty gate.** `bun run check` runs `scripts/spec-check.ts` (`check:spec`): it reads the `<!-- spec-check files=N tests=N -->` marker in SPEC.md and fails when the `npm pack --dry-run --json` file count or the `bun test` pass count trails it. Update the marker in the same commit that ships shipped-file or test changes. It is read-only and never enforces sizes, only counts.
- **Loop re-arm hygiene.** An armed `/goal-loop` iteration is steered to re-read the repository (`git log --oneline -5`, `git status --short`, `git branch --show-current`, plus `coordinator status --json` / `git worktree list` in coordinator repos) and the current check output before touching anything; the summary is a hint, the tree is truth. Zero-progress iterations are counted by the harness (`onToolCalled` events → `iterationToolCalls`), never by the model's self-report; two consecutive zero-tool iterations are recorded (loopNotProgress) but never pause the loop. A model claiming heavy work with zero harness tool calls still counts as zero.

## Config

Options in `opencode.json` `plugins[].options`, parsed by `resolveConfig`: `evaluator.model/mode/maxTranscriptChars/maxOutputTokens/timeoutMs/verifyCommand/verifyTimeoutMs`, `maxTurns`, `stallTurns`, `checkinMinutes`, `maxIdleCheckins`, `maxRetries`, `maxConditionChars` (unlimited by default), `systemReminder`, `transcriptNotes`, `requireCommit`, `commitBranch` (default `dev`), `coordinator` (`auto`/`true`/`false`), `compactAtTokens`, `maxLoops` (default 5), `maxLoopSummaryTokens` (default 400). Env overrides: `OPENCODE_GOAL_MODEL`, `OPENCODE_GOAL_MAX_TURNS`, `OPENCODE_GOAL_CHECKIN_MINUTES`, `OPENCODE_GOAL_COMMIT_BRANCH`, `OPENCODE_GOAL_REQUIRE_COMMIT`, `OPENCODE_GOAL_COORDINATOR`, `OPENCODE_GOAL_COMPACT_AT_TOKENS`, `OPENCODE_GOAL_MAX_LOOPS`, `OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS`, `OPENCODE_GOAL_VERIFY_COMMAND`, `OPENCODE_GOAL_VERIFY_TIMEOUT_MS` (see `src/core/config.ts`). Probe mode: `OPENCODE_GOAL_PROBE=1`.

`docs/` is a static, build-free site (open `docs/index.html`); update `install.html`/`config.html` when install or options change.
