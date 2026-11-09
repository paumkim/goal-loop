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

- **Pauses** after 3 turns in a row without tool use, on rate limits, on interrupt (Esc), or at the 200-turn cap. Send any message to resume.
- **Retries** dropped connections and overloads with backoff (up to 3 times).
- **Clears** on errors you must fix: auth, credit, context overflow, missing model.
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

### Coordinator repositories (term)

If at least 2 coordinator markers are detected, coordinator mode is on: the agent works on `wt/<slug>` and runs `submit`, the coordinator merges to `dev`, and `main` stays read-only for agents.

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
| `maxTurns` | `200` | Hard turn cap, `0` = none |
| `stallTurns` | `3` | Turns without tool use before pausing |
| `checkinMinutes` | `30` | First background check-in; `0` disables check-ins and retries |
| `maxRetries` | `3` | Automatic retries after transient errors |
| `systemReminder` | `false` | Also put the goal in the system prompt (costs one cache miss) |
| `transcriptNotes` | `true` | Record achieved/impossible verdicts in the transcript |
| `requireCommit` | `true` | Finished work has to be committed before the goal counts as met |
| `commitBranch` | `dev` | Branch the finished work has to land on (target branch in coordinator mode) |
| `coordinator` | `auto` | `auto` detects coordinator repos and uses `wt/<slug>` + submit; `true` forces it, `false` disables it |

Environment overrides: `OPENCODE_GOAL_MODEL`, `OPENCODE_GOAL_MAX_TURNS`, `OPENCODE_GOAL_CHECKIN_MINUTES`,
`OPENCODE_GOAL_COMMIT_BRANCH`, `OPENCODE_GOAL_REQUIRE_COMMIT`, `OPENCODE_GOAL_COORDINATOR`.

## Develop

```sh
bun install
bun run check                         # typecheck + unit tests
bun run e2e <empty-dir> [provider/model]  # real run against a private opencode server
```

## Documentation

Full docs live in `docs/` as a single-folder, dependency-free HTML/CSS site — no build step, no internet, no frameworks.

```sh
xdg-open docs/index.html   # Linux (or just double-click the file)
```

Pages: `index.html` (landing + search + FAQ) · `architecture.html` (diagram, state machine, data flow) · `runtime.html` (controller, events, evaluator, retry) · `config.html` (every option, default, env var) · `core.html` (per-file reference) · `install.html` (install, `/goal` commands, troubleshooting).

All files are plain `.html` + `styles.css` + vanilla `app.js` and work by opening `docs/index.html` directly from the filesystem. Keep the `docs/` folder together — pages link to each other with relative paths.

## License

MIT
