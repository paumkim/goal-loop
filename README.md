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
- The evaluator only sees what's in the conversation, so the agent is told to show proof (test output, command results).
- By default the evaluator reuses the session's cached context, so each check costs little more than a short answer.
- Finished work has to be committed before the goal counts as met. See [the commit rule](#the-commit-rule).

Safety rails:

- **Pauses** after 3 turns in a row without tool use, on rate limits, or on interrupt (Esc). Send any message to resume. At the 200-turn cap it pauses and stays paused until you `/goal clear` or set a new goal (raising `maxTurns`); a message alone will not extend the cap.
- **Retries** dropped connections and overloads with backoff (up to 3 times).
- **Fails** (distinct from `cleared`) on errors you must fix: auth, credit, context overflow, missing model. A failed goal is terminal and is not resumable by sending a message; fix the cause and run `/goal` again. `cleared` only means you (or a replacement goal) ended it.
- **Waits** while subagents or background shells run, with check-ins at 30 min, then 60, then 120.
- **Restores** active goals after a restart or plugin reload.

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

When the plugin loads inside a git repository, it creates `.term/coordinator/` and `worktrees/` for you (plus stub `config.json`/`state.json`, never overwriting existing files). No manual setup is needed beyond `git init` and installing the plugin. The agent claims a `wt/<slug>` lease, works in its own worktree, commits there, and submits; the coordinator merges to `dev` and removes the worktree and branch. `main` stays read-only for agents.
With `coordinator: true` the agent always goes `claim -> wt/<slug> -> submit`.
The evaluator is read-only and gates `not_met` until wt commit + submit evidence appears.

Prerequisites: a git repository where the coordinator's target branch exists (`dev` by default; `merge-next` checks it out), and `jq` for coordinator state.

Parallel sessions: each session claims its own slug/worktree. Overlapping paths are a hard error without `--force`. Run `status --json` to see the other leases.

Fuzzy requests: a vague goal like "make it look like a rabbit" is turned into a `SPEC.md` loop. The agent writes `SPEC.md` first (interpretation, acceptance criteria, verification including screenshot/render for visual), then builds, verifies against the spec, and commits.

## Options

All optional, set in `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "@el4cteo/opencode-goal",
      "options": {
        "evaluator": { "model": "opencode-go/deepseek-v4.1-flash" },
        "maxTurns": 200,
        "stallTurns": 3,
        "checkinMinutes": 30,
        "maxRetries": 3,
        "systemReminder": false,
        "transcriptNotes": true,
        "compactAtTokens": 0,
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
| `evaluator.model` | session model | Separate model that judges the goal (fresh eyes, uses a transcript digest) |
| `evaluator.mode` | `auto` | `session`, `independent`, or `auto` (independent when a model is set) |
| `evaluator.maxTranscriptChars` | `60000` | Transcript digest budget for the independent evaluator (min 4000) |
| `evaluator.maxOutputTokens` | `4096` | Verdict answer budget (min 256) |
| `evaluator.timeoutMs` | `120000` | Evaluation timeout in ms (min 5000) |
| `maxTurns` | `200` | Hard turn cap, `0` = none |
| `stallTurns` | `3` | Turns without tool use before pausing |
| `checkinMinutes` | `30` | First background check-in; `0` disables check-ins and retries |
| `maxIdleCheckins` | `3` | Max idle check-ins while background work runs |
| `maxRetries` | `3` | Automatic retries after transient errors |
| `maxConditionChars` | unlimited | Condition length cap (min 100); default never rejects |
| `systemReminder` | `false` | Also put the goal in the system prompt (costs one cache miss) |
| `transcriptNotes` | `true` | Record achieved/impossible verdicts in the transcript |
| `compactAtTokens` | `0` | Auto-compact at this many estimated model-visible tokens; `0` disables |
| `requireCommit` | `true` | Finished work has to be committed before the goal counts as met |
| `commitBranch` | `dev` | Branch the finished work has to land on (target branch in coordinator mode) |
| `coordinator` | `auto` | `auto` detects coordinator repos and uses `wt/<slug>` + submit; `true` forces it, `false` disables it |

Environment overrides: `OPENCODE_GOAL_MODEL`, `OPENCODE_GOAL_MAX_TURNS`, `OPENCODE_GOAL_CHECKIN_MINUTES`,
`OPENCODE_GOAL_COMMIT_BRANCH`, `OPENCODE_GOAL_REQUIRE_COMMIT`, `OPENCODE_GOAL_COORDINATOR`, `OPENCODE_GOAL_COMPACT_AT_TOKENS`.

### Auto-compaction

`compactAtTokens` makes the plugin itself ask the host to compact the session once the estimated model-visible
context reaches an absolute token count — a window-independent complement to opencode's `compaction.buffer`,
which is relative to the model's context window.

The estimate is the last assistant message's `input + cache.read + cache.write` token usage, measured right
after each turn ends (`session.execution.succeeded`). Reasoning and output tokens are not counted: output has
already become input for the next step. Set e.g. `"compactAtTokens": 260000` in `opencode.json` or
`OPENCODE_GOAL_COMPACT_AT_TOKENS=260000`. `0` (the default) disables the check entirely. A compaction in flight
or requested within the last 2 minutes is not re-requested; a lost in-flight marker is swept after 10 minutes.

## Develop

```sh
bun install
bun run check                         # typecheck + unit tests
bun run e2e <empty-dir> [provider/model]  # real run against a private opencode server (model also via E2E_MODEL, default opencode/deepseek-v4.1-flash-free)
E2E_MODEL=opencode/deepseek-v4.1-flash-free bun run e2e <empty-dir>
```

## Documentation

Full docs live in `docs/` as a single-folder, dependency-free HTML/CSS site — no build step, no internet, no frameworks.

```sh
xdg-open docs/index.html   # Linux (or just double-click the file)
```

Pages: `index.html` (landing + search + FAQ) · `architecture.html` (diagram, state machine, data flow) · `runtime.html` (controller, events, evaluator, retry) · `config.html` (every option, default, env var) · `core.html` (per-file reference) · `install.html` (install, `/goal` commands, troubleshooting) · `changelog.html` (recent changes from `git log`).

Every page carries a "Last updated" stamp in the footer, derived from `git log` for that page (`git log -1 --format=%cd -- docs/<page>.html`). The stamp reflects the last commit that touched the page, not necessarily the latest code change. The stamps and the changelog table are regenerated by `bun script/docs-watch.ts once`; `bun script/docs-watch.ts watch` keeps them fresh automatically (event-driven, debounced, no polling, no server) and logs working-tree changes to a local `.docs-watch.log` (view with `bun script/docs-watch.ts log`). Both logs and state files are gitignored; the docs folder itself stays static HTML/CSS/JS with no build step.

All files are plain `.html` + `styles.css` + vanilla `app.js` and work by opening `docs/index.html` directly from the filesystem. Keep the `docs/` folder together — pages link to each other with relative paths.

## License & credits

MIT — see [LICENSE](LICENSE).

This project is based on the original `/goal` plugin by EL4CTEO, at https://github.com/EL4CTEO/opencode-goal. This fork is maintained by paumkim at https://github.com/paumkim/opencode-goalv2.

The original copyright notice is preserved verbatim in [LICENSE](LICENSE); the modifications and maintenance in this fork are copyright 2026 paumkim. The MIT license covers both.
