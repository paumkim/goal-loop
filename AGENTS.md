# goal-loop

> Compact cold-start version; every rule preserved. Full prose/history/rationale: SPEC.md, README.md, docs/*.html. If they disagree, the tree is truth — re-read before acting (Loop re-arm hygiene).

Claude Code-style `/goal` loop for OpenCode v2: an evaluator judges a completion condition each turn until met. Plugin `goal-loop`.

## Entrypoints

- `index.ts` → `src/index.ts` `Plugin.define setup()`: server plugin; sole wiring (config/commit-policy/bootstrap/RPC/`/goal`+`/goal-loop` commands/hooks/event-pump). `/goal-loop <objective>` = `/goal` whose `met` verdicts arm a summarized next iteration until `maxLoops`/`LOOP_COMPLETE`/impossible/clear/two zero-tool-call iterations; state on persisted `GoalRecord` (loopEnabled, loopIteration, loopObjective, loopMaxLoops, loopHistory, loopNotProgress; additive, `version` stays 1).
- `src/core/*` pure (I/O only fs reads): `config.ts` options+env, `git.ts` commit policy, `prompts.ts` directive+rubric, `opencode-cli.ts` `<opencode-cli>` guide, `bootstrap.ts` first-run layout, `parse/verdict/transcript/errors/format`.
- `src/runtime/*` stateful: `controller.ts` state machine + `/goal-loop` advance (met→summarize→arm next; `maxLoops`/`LOOP_COMPLETE`/not-progress guards), `evaluator.ts`, `store.ts`, `events.ts`, `background.ts`, `ports.ts`.
- `tui.ts` → `dist/tui.js` precompiled: edit `src/tui.tsx`, never `tui.ts`/`dist/`. `rpc.ts` → `src/rpc.ts` (shared client contract).
- `bin/goal-loop.mjs` CLI install/uninstall/status + `update`/`channel <main|dev>`/`updates <auto|off>`; `install.sh` GitHub one-liner → `~/.local/bin` + registers plugin. Bare `/goal-loop` (no objective) triggers a background GitHub update check (`src/index.ts · scheduleUpdateCheck` + `handleBareLoop`) with an immediate and a result toast; no new slash command. `update.mode: off` falls back to status; use `/goal` for status otherwise. First-class options `plugins[].options.update = {channel, mode}` (default main/auto), resolved by `config.ts · resolveConfig` and read/written by `bin/goal-loop.mjs · readPluginState/writePluginState` — one source of truth, no sidecar. main = newest semver tag, dev = latest dev SHA (unstable), off = never check. `bin/goal-loop.mjs · resolveLatestRef/update` resolves the ref and surgically repins the plugin config (backup + atomic write; restart opencode to take effect); tests inject `opts.fetch`, no live network.
- `src/prompter/*` + `bin/prompter.mjs` + `prompts/` — bundled autonomous work loop (one package, no separate project): `prompter init|tick|status|review|approve|reject|stop|resume|cleanup`. Picks one `AUTONOMY.md` task, runs headless `/goal` in an isolated worktree on `<prefix><id>`, verifies, commits, parks as `in_review` (one at a time); never merges/pushes. `approve` requires `git merge-base --is-ancestor <commit> <baseBranch>`. Caps: tasks/dollars/tokens/wall clock + kill switches (`PROMPTER_STOP`, `~/.prompter/STOP`, `.prompter/STOP`, SIGTERM). Default `promptLibrary` resolves from `src/prompter/defaults.ts` to `<package>/prompts`; `PROMPTER_*` env overrides. Tests: `test/prompter-*.test.ts`.

## Commands

```sh
bun install
bun run check   # tsc --noEmit → (cd test && bun test) → check:dist → compile → check:tui → docs:check → check:invariant → check:spec (tsc first)
bun test test/git.test.ts   # or bun test <file-or-pattern>; worktrees/ has suite forks
bun run compile             # rebuild dist/tui.js from src/tui.tsx; required after TUI/JSX change
bun run e2e <empty-dir> [provider/model]  # real server + live model ~10min; E2E_MODEL overrides
```

- Bun only. TS strict + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`; imports use `.ts` extensions (`from "./git.ts"`); types via `import type`.
- `bun:test`, no runner config, no on-disk fixtures: fake repos = bare `.git/` dirs (HEAD + `refs/heads/*`, no git binary); `plugin.test.ts` mocks context; `e2e.ts` only suite needing real server/model.

## How it works (non-obvious)

- Never git / edits files: reads `.git`/`HEAD`/`refs`/`packed-refs` (`src/core/git.ts`), directs the *agent* to commit; evaluator sees only visible transcript evidence → commit output must be in conversation.
- Fresh evidence only: command output at current HEAD after last change; not earlier claims/narration/prior verdict. `verifyCommand` gate (env OPENCODE_GOAL_VERIFY_COMMAND, timeout evaluator.verifyTimeoutMs default 600s): `met` held, spawn via `bash -c` in goal dir, accept only exit 0; non-zero/spawn error/timeout → `not_met` + output tail + warning; no loop advance on failed verification; missing port fails closed; default `""` off (byte-compatible). Locations: `controller.ts verifyMet`, `index.ts createVerifier`, `prompts.ts` rubric.
- Probe isolation: probe server/scratch loading plugin must set `OPENCODE_GOAL_PROBE=1` → storage read-only (`GoalStore` drops saves/removes, reads pass), `restore()` can't mutate live records; verification commands still run in probe cwd → throwaway checkout only, never live `.term/` or a live session's data.
- Cold-start scaffold: `setup()` (+ later runs), idempotent in git repos: `.term/coordinator/{config,state}.json` + `worktrees/` (create-if-missing), goal runtime dirs (`.term/goal-loop/`), minimal docs if absent (SPEC.md, docs/README.md, MAINTAINER.md), append-only gitignore; never overwrite existing, fill gaps; outside git repo → runtime-only + note. Coordinator detection: `config.json`+`state.json` or bin + one json; `coordinator: false` opts out of coordinator commit mode.
- Parallel sessions: `docs/parallel-work.md` is the full protocol. `status --json` can transiently omit a just-created lease while another agent's `merge-next` resets `state.json` to its committed copy — do not re-claim; the live dirt is restored when that merge finishes, and a repeat claim creates a duplicate lease. `SPEC.md` workstream numbers are likewise contested: derive the label from the lease slug instead of guessing the next Roman numeral.
- Commit rule: coordinator repos → `wt/<slug>`, `submit`, then `merge-next` when lease ready/next; `merge-next` only path to `dev`, gates on `bun run check` of merged result (trial merge on scratch branch, `dev` untouched on fail); `submit` = merge-ready not merged; done = `merge-next` succeeded for that lease; off outside git repo; `resolveCommitPolicy` takes optional absolute coordinator bin, never repo-relative.
- Vague goals (`isFuzzyCondition`, `prompts.ts`): first turn writes SPEC.md (acceptance + verification incl. screenshot for visual), then builds/verifies/commits; precise skip.
- opencode-CLI goals (`isOpencodeCliCondition`, `opencode-cli.ts`): condition mentions opencode → first-turn directive injects `<opencode-cli>` block: check `opencode --version`, never rebuild installed binary, SlotMap (`node_modules/@opencode/plugin/dist/tui/context.d.ts`) only stable TUI surface, verify via headless opentui render in /tmp + driving installed binary headlessly via opencode-headless (`api`/`cli`/`pty`), report layer (binary/source/test-render/live TUI) per claim; no "opencode" → no injection.
- State/robustness: per-session records (`goal/v1/<sessionID>`), restore on restart, epoch-guarded async; turn cap + stall guard opt-in (default 0 off), plain goals only — armed /goal-loop never pauses (one notice each); fatal provider error fails goal; `/goal clear` stops.

## Coordinator (`packages/coordinator/bin/coordinator`)

- Flow: `claim <task> --agent <you> --paths <scope>` → `worktrees/wt-<slug>` on `wt/<slug>` → `submit` → `merge-next`; never commit `dev`/`main` directly, only `merge-next` lands on `dev`; submit = merge-ready; submitting agent owns `merge-next` from main repo once lease ready/next (unless integrator assigned), don't wait on unnamed actor; done = `merge-next` succeeded for that lease.
- Readiness: `coordinator queue/status --json` shows lease submitted + next/unblocked; worktree clean, tip has all commits; main checkout acceptable (exempt bookkeeping dirt fine; never hand-edit `dev`); run `merge-next` (trial merge + gate), never `git merge`/commit to `dev`/`main`.
- Main checkout clean aside from exempt `.term/coordinator/state.json`; `merge-next` stashes/restores that dirt around trial merge; state.json-only bookkeeping branch merges cleanly.
- `release <slug>` abandons idle/dead claim: lease done, worktree removed, dirty bytes → `refs/coordinator/saved/<slug>-<ts>`, unique-commit branch kept + rebuild command printed; unsubmitted needs `--force`; submitted leave via `merge-next`/`merge-abort`.
- Bookkeeping: `merge-next` unions live + committed `state.json` (keys from both, live wins per key, `mergeLock` null), auto-commits on `dev` as `chore(coordinator): record <slug> lease done after merge`; union stops wt-landed bookkeeping reverted by merge's flip; chore part of merge flow (only sanctioned dev path), not direct agent dev commit; on failure dirt stays exempt, next merge-next retries; don't hand-commit `state.json`, don't extend exemption.
- Requires `jq` (+ `git`, `bun` for gate); claim flock-locked + lease re-check; path overlap without `--force` = hard error; `status --json` lists active (non-`done`) leases + a counts `summary` (pass `--all` for historic `done` leases); `state.json` = bus.
- `merge-next` removes worktree + `wt/` branch, marks lease `done`; leftover `worktrees/wt-*` safe to prune; `state.json` leases = source of truth.
- Copy `opencode.json.example` → `opencode.json` (gitignored) wires coordinator; example uses placeholder path; here: claim, worktree, submit, merge-next.

## Gates / loop hygiene

- SPEC honesty gate: `bun run check` runs `scripts/spec-check.ts` `check:spec`, reads `<!-- spec-check files=N tests=N -->` in SPEC.md, fails if `npm pack --dry-run --json` file count or `bun test` pass count trails; read-only, counts not sizes. In a coordinator worktree, regenerate the marker/changelog locally only to make your own `bun run check` green — `merge-next` re-counts both on the merged tree and owns the final committed values, so do not ship separate marker/changelog commits.
- Loop re-arm: armed /goal-loop re-reads repo (`git log --oneline -5`, `git status --short`, `git branch --show-current`, + `coordinator status --json`/`git worktree list` in coordinator repos) + check output before touching anything; summary hint, tree truth; zero-progress by harness (`onToolCalled` → `iterationToolCalls`), not self-report; two consecutive zero-tool iterations recorded (`loopNotProgress`) but never pause; heavy-claim/zero-call still zero.

## Config

`opencode.json` `plugins[].options` via `resolveConfig`: evaluator.model/mode/maxTranscriptChars/maxOutputTokens/timeoutMs/verifyCommand/verifyTimeoutMs, maxTurns, stallTurns, checkinMinutes, maxIdleCheckins, maxRetries, maxConditionChars (unlimited default), systemReminder, requireCommit, commitBranch (default dev), coordinator (auto/true/false), compactAtTokens, maxLoops (default 5), maxLoopSummaryTokens (default 400). Env: OPENCODE_GOAL_MODEL, OPENCODE_GOAL_MAX_TURNS, OPENCODE_GOAL_CHECKIN_MINUTES, OPENCODE_GOAL_COMMIT_BRANCH, OPENCODE_GOAL_REQUIRE_COMMIT, OPENCODE_GOAL_COORDINATOR, OPENCODE_GOAL_COMPACT_AT_TOKENS, OPENCODE_GOAL_MAX_LOOPS, OPENCODE_GOAL_MAX_LOOP_SUMMARY_TOKENS, OPENCODE_GOAL_MAX_RETRIES, OPENCODE_GOAL_VERIFY_COMMAND, OPENCODE_GOAL_VERIFY_TIMEOUT_MS (src/core/config.ts). Probe: `OPENCODE_GOAL_PROBE=1`.
`docs/` static build-free site (docs/index.html); update install.html/config.html when install or options change.
