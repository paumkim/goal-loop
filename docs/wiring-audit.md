# Shadow wiring audit

An independent read-only audit of the goal-loop plugin: every control, toggle, command, RPC method and
interactive key that is *declared* must be *connected*, and every toggle must behave both when enabled and
when disabled. The audit ran while other agents held leases on the runtime entry, prompts, messaging and
tests; their claimed paths were left untouched.

## How to reproduce

```sh
bun scripts/wiring-audit.ts   # 38 mechanical source assertions; exit 0 = all pass
bun run check                 # typecheck + 2430 tests + dist/TUI/docs/invariant/spec gates
```

`scripts/wiring-audit.ts` is the machine-checkable half of this report. It fails the moment a consumer,
an OFF branch, a command registration, an RPC handler or a keybinding disappears. The tables below are
the human-readable evidence behind those assertions.

## 1. Configuration toggles — all 26 fields consumed

Every field of `GoalConfig` (`src/core/config.ts:17-67`) has at least one consumer outside its own module,
and every OFF/ZERO branch is reachable. Representative evidence:

| Toggle | ON path | OFF / ZERO path | Evidence |
|---|---|---|---|
| `evaluator.mode` | `session`/`independent` select the generation model for `summarize`/`nextGoal` | absent → `auto` resolves to `session` | `config.ts:239-241,249`, `evaluator.ts:207,229`, `index.ts:1061` |
| `evaluator.consensus` | `2` runs a second vote, fail-closed on disagreement | `1` returns the native verdict untouched | `evaluator.ts:132` |
| `evaluator.verifyChecks` / `verifyTimeoutMs` | build the verification matrix, run on a `met` verdict | empty matrix → gate skipped | `controller.ts:1707,1999` |
| `commit.enabled` | `required: true` policy | `git.ts:149` → `required: false` | `config.ts:282`, `git.ts:149` |
| `systemReminder` | pushes the stable reminder into `event.system` | no push | `index.ts:971-973` |
| `update.mode` | schedules the GitHub check | `!== "auto"` → status-only fallback | `index.ts:730,766` |
| `compactOnLoopIteration` | requests a boundary compaction | `requested: false, reason: "disabled"` | `compactor.ts:133` |
| `compactAtTokens` | carries the estimate into evidence | `<= 0` → omitted | `controller.ts:474` |
| `learning.enabled` | resolves a journal path and writes/injects entries | `controller.ts:2969` returns `undefined`, no file | `controller.ts:2969,2991,3017` |
| `maxTurns`, `stallTurns`, `maxRetries` | cap turns / stall / retries | `> 0` guard, `0` = unlimited/disabled | `controller.ts:987,1608,1616,2620,2643` |
| `checkinMinutes`, `maxIdleCheckins` | schedule idle nudges | `0` disables | `controller.ts:2687,2711` |
| `maxLoops`, `maxLoopSummaryTokens`, `maxConditionChars` | cap loop versions, summary chars, condition length | bounded/unbounded by config | `controller.ts:644,712,2297,2410` |

`update.channel` is consumed only in the progress toast inside `src/`, but the check itself is effective:
`bin/goal-loop.mjs` re-reads `plugins[].options.update` from disk (`normalizePrefs`, `readPluginState`,
`readUpdatePrefs`) and both `channel` and `updates` commands persist it in that shape. `evaluator.mode`
likewise drives generation, not per-turn judgment: since the native-only-verdict change, `evaluate()`
always scores the host verdict and `mode` selects the independent/session generation model.

## 2. Commands, RPC and events

| Surface | Registered | Dispatched | Verdict |
|---|---|---|---|
| `goal` | `index.ts:809` | `controller.command` at `index.ts:797`; e2e and prompter drivers | wired |
| `goal-loop` | `index.ts:810` | loop branch + bare directive at `index.ts:850-908` | wired |
| `reset-context` | `index.ts:817` | consumed by the compaction hook at `index.ts:841-844` | wired |
| `parse` controls `status`/`clear`/`set`/`invalid` | `core/parse.ts:8-24` | `controller.ts:679-693` | wired |
| RPC `get`/`list`/`status`/`clear` | `rpc.ts:18-35`, handlers `rpc-handlers.ts` | `ctx.rpc.register` at `index.ts:701`; TUI/e2e/prompter clients | wired, contract and handler sets match exactly |
| events `changed`/`notice` | `rpc.ts:36-56` | emitted `index.ts:713,715`, subscribed `tui.tsx:863,871` | wired, re-subscribes with backoff |

No handler is defined without a registration, no caller names a missing method, and subscriptions are
established in TUI setup rather than merely declared.

## 3. Interactive controls

All 12 core dialog bindings (`dialog-keys.ts:75-257`) reach a real action: `p`/`x`/`m`/`t` toggle their
flag both ways, `c`/`r`/`1`-`4` copy or navigate, `up`/`down`/`pageup`/`pagedown`/`home`/`end` move the
scrollbox. The keymap factory is mounted at `tui.tsx:1641`. HUD keys (`escape`/`up`/`down`/`enter`),
mouse affordances, dossier rows, the find row, view tabs and every palette item all resolve to a state
setter, RPC, clipboard write or router call. No stub or no-op handler was found.

Every destructive clear path funnels through `requestClearGoal` (`tui.tsx:1225-1252`), which uses a native
confirm and fails closed — footer, card, context menu (keyboard and mouse) and palette are all guarded.

## 4. Defect found and fixed — the mirror toggle only worked on one side

`OPENCODE_GOAL_MIRROR=0` is documented as disabling the owner-only convergence mirror, but the flag was
checked only on the server's **write** side (`src/index.ts:705`). The TUI's **read** side
(`src/tui.tsx:618`) was unconditional: with the flag off, a mirror left behind by an earlier run could
still be read on a re-pull and painted over a wedged RPC. That is both a stale-state hazard and a
half-working toggle.

Fix: `src/tui.tsx:622` gates `createGoalMirror()` on the same flag and `refreshFromStorage` uses
`goalMirror?.read(...)`, so the disabled state behaves exactly like a missing mirror. `dist/tui.js`
was rebuilt. The audit script pins both halves of the symmetry so the asymmetry cannot return.

## 5. Residual risk, deliberately out of scope

- Host keymap validity for `pageup`/`pagedown`/`home`/`end` cannot be checked from this repo; the footer
  prints the shorthand `pgup/pgdn` while the binds are the host-contract names. Tests pin the binds.
- `foreignMoreExpanded` and `dialogView` are not reset when the dialog closes; all states remain reachable.
- Files claimed by the concurrent agents (`src/index.ts`, `src/core/prompts.ts`,
  `src/runtime/messaging.ts`, their tests, `SPEC.md`) were audited read-only and not edited here.
