# pending_fixes — opencode-goalv2 back-to-front sweep (iteration 1)

Sweep done by a general subagent (read-only, worktree: wt-keep-improving-keep-on-fixing-the-current-directory-codebase-from-back-to-front). Findings — some fixed and verified, others reviewed/rejected.

## Rejected — contradicts pinned behavior (tests)
- `src/runtime/controller.ts:1447` — proposed clearing `iterationDeferred` in `clearDeferred`: contradicts `loop.test.ts:1938` ("an iteration spent waiting on background work is not a zero-tool iteration" — the suppression while waiting is by design). Fix applied by a general subagent, then reverted; targeted rerun on base: 1 pass / 0 fail.

## Open (reviewed, minor — not fixed per mandate)
1. `src/runtime/controller.ts:731` — busy() failure fails open in the controller, fails closed in the compactor (`catch(() => ({subagents:0, shells:0}))`).
2. `src/runtime/controller.ts:921-926` — the "BT already-satisfied at HEAD" met exemption is dead: `applyForwardPointerGate` downgrades such met verdicts, so the controller exemption never fires; reconciles to "next: required" or drop the exemption (see prompts.ts:135, core/prompts.ts:359-362).
3. `src/runtime/controller.ts:1029-1031` — `verifyMet` registers no `runtime.abort` during the verification await (impact: wasted verify compute on interrupt, up to verifyTimeoutMs).
4. `src/runtime/store.ts:119-121` — `flush()` doesn't await writes enqueued after it takes its snapshot (dispose can return with the last write in flight).
5. `src/runtime/controller.ts:1189` — the iteration cap is unreachable when `maxLoops > 50` (loopHistory is capped at 50).
6. `src/core/config.ts:132` — `maxConditionChars` floor of 100 on the otherwise-unlimited default.
7. `src/core/index.ts:288-290` — the goal-loop length check counts UTF-16 units, `parseGoalCommand` counts code points.
8. `src/core/events.ts:121-124` — a `shell.created` without an id never registers the shell (background undercount).
9. `src/core/parse.ts:28-29` — `unquote` returns the one-char input `"` for `/goal "` (cosmetic).
