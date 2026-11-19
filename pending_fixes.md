# pending_fixes — opencode-goalv2 back-to-front sweep (iteration 1)

Sweep done by a general subagent (read-only, worktree: wt-keep-improving-keep-on-fixing-the-current-directory-codebase-from-back-to-front). Findings — some fixed and verified, others reviewed/rejected.

## Fixed (fixed by general subagent + verified by tester subagent)
4. `src/runtime/controller.ts:731` — `onExecutionSucceeded` now fails closed when `background.busy(sessionID)` errors: logs "goal busy check failed; skipping evaluation" and returns without evaluating. Regression test "skips evaluation when the busy check errors" added to `test/controller.test.ts` (harness: `busyError` + `setBusyError`). Verified: new test passes with the fix (1 pass / 0 fail); with the fix stashed it fails (Expected 0, Received 1); tester re-ran: `bun run check` suite 1756 pass / 0 fail; regression test exit 0.
5. `src/runtime/store.ts:119-121` — `flush()` now drains: `while (this.chains.size > 0) { await Promise.all([...this.chains.values()]) }`. Regression test added to `test/store.test.ts` ("GoalStore.flush > flush drains writes enqueued while it is awaiting"). SPEC marker updated (tests=1754→1755). Verified: `bun run check` exit 0 (1755 pass / 0 fail, spec-check ok); `bun test test/store.test.ts` exit 0 (10 pass / 0 fail); discrimination: with the buggy flush the new test fails (9 pass / 1 fail).

## Rejected — contradicts pinned behavior (tests)
- `src/runtime/controller.ts:1447` — proposed clearing `iterationDeferred` in `clearDeferred`: contradicts `loop.test.ts:1938` ("an iteration spent waiting on background work is not a zero-tool iteration" — the suppression while waiting is by design). Fix applied by a general subagent, then reverted; targeted rerun on base: 1 pass / 0 fail.

## Open (reviewed, minor — not fixed per mandate)
1. `src/runtime/controller.ts:731` — busy() failure fails open in the controller, fails closed in the compactor (`catch(() => ({subagents:0, shells:0}))`).
2. `src/runtime/controller.ts:921-926` — the "BT already-satisfied at HEAD" met exemption is dead: `applyForwardPointerGate` downgrades such met verdicts, so the controller exemption never fires; reconciles to "next: required" or drop the exemption (see prompts.ts:135, core/prompts.ts:359-362).
3. `src/runtime/controller.ts:1029-1031` — `verifyMet` registers no `runtime.abort` during the verification await (impact: wasted verify compute on interrupt, up to verifyTimeoutMs). [Moot: main checkout carries the verifyMet abort registration fix — iteration 1's second verified improvement; confirm at merge time.]
5. `src/runtime/controller.ts:1189` — the iteration cap is unreachable when `maxLoops > 50` (loopHistory is capped at 50).
6. `src/core/config.ts:132` — `maxConditionChars` floor of 100 on the otherwise-unlimited default.
7. `src/core/index.ts:288-290` — the goal-loop length check counts UTF-16 units, `parseGoalCommand` counts code points.
8. `src/core/events.ts:121-124` — a `shell.created` without an id never registers the shell (background undercount).
9. `src/core/parse.ts:28-29` — `unquote` returns the one-char input `"` for `/goal "` (cosmetic).
