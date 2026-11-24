# Plan: fix evaluator trigger timing (judge subagent work on completion)

Date: 2026-11-23
Scope: investigation + implementation plan only. No runtime, gate or generated file is changed by this document.

## 1. The observation

The screenshot at `/home/pauk/Pictures/Screenshots/Screenshot_20261123_232258.png` shows a working session under a goal:

1. `General finished · Implement evaluator finish + loop planner changes` — a regular subagent completes.
2. The parent's `Thought` turn — the harness injects the subagent report and wakes the parent, which verifies and narrates.
3. `Evaluator finished · evaluator` — the goal-loop judge appears in the **parent** session, after the subagent.

The complaint to resolve: the evaluator is triggered only for the parent agent, not for the subagent, and it fires only after the regular subagent has finished its job. The judge should be attached to and triggered by the work unit that actually did the work.

## 2. Cause (verified in this tree)

Evidence commands run before writing this plan (worktree `wt-evaluator-subagent-trigger-plan`, branch at `da1fc41`):

- `git log dev --oneline -5` → `da1fc41`, `07bf5c3`, `7ba122d merge wt/evaluator-goal-achieved-planner into dev`, `55b967c fix(runtime): only verdict children emit the worker completion report`. The non-waking verdict fix is already merged (`git merge-base --is-ancestor f11185c dev` → YES). Step 1 is therefore already done; the remaining steps start from the current tree.
- `grep -n` on the runtime files produced the line references below.

### 2.1 Evaluation is owned by one session

`GoalController` stores a goal keyed by the session that armed it. Every event handler does `this.goals.get(sessionID)` (`src/runtime/controller.ts:1004` and the same lookup throughout `:343-613`). A subagent session has no goal record.

### 2.2 A subagent's completion never triggers evaluation

- `src/runtime/events.ts:89-95` routes **every** session's `session.execution.succeeded` to `controller.onExecutionSucceeded(sessionID)`.
- `src/runtime/controller.ts:1002-1005`:
  ```ts
  const record = this.goals.get(sessionID)
  if (!record || record.status !== "active") return
  ```
  For a child session this is an early return. No evaluation, no verdict, no attribution.

### 2.3 Subagents are modeled only as work to wait for

- `events.ts:111` → `background.sessionCreated(sessionID, data.parentID)` caches the parent link.
- `events.ts:83` → `background.executionStarted(sessionID)`; `background.ts:22-24` adds the session to `running`.
- `background.ts:60-67 busy()` counts running descendants via `descendsFrom()` (`:69-77`) as `subagents`.
- `controller.ts:1043`: `if (work.subagents + work.shells > 0) return this.defer(record, runtime, work, tools)`.
- `controller.ts:2654-2680 onBackgroundDrained()` re-runs the parent's `evaluate()` only when `busy()` reaches zero — i.e. only after the last subagent's completion removed it from `running`.

So the judge child is created (only inside `evaluate()` → `nativeVerdict()` → `spawnEvaluator()`, `src/index.ts:442-…`, `338-…`) **after** the subagent drains, and the report is attributed to the parent. `SPEC.md:1698-1700` records that the deferral itself is deliberate; the defect is that a subagent completion is a gate for the parent's verdict rather than an evaluation trigger in its own right, and that the verdict is parent-attributed.

### 2.4 The wake/invalidate constraint that any fix must respect

When the harness injects the subagent report it wakes the parent. `controller.ts:929-949 onExecutionStarted()` calls `invalidate(runtime)`, and `invalidate()` (`:2997-…`) bumps the epoch and aborts the in-flight judge (`runtime.abort?.abort()`). An evaluation started directly on a subagent completion would be silently dropped by that wake unless the fix accounts for it. This is the main reason a naive "call evaluate() from the child's succeeded handler" is not sufficient.

## 3. Design decision

Make evaluation **goal-scoped and work-unit-triggered**: the completion of any session in a goal's descendant tree can trigger that goal's evaluation, and the judge child plus its visible completion are attributed to the session that did the work. The goal keeps a single terminal verdict authority so one subagent finishing does not by itself end the goal.

- **Choice:** one goal, one verdict at a time, triggered by the completing work unit rather than only by the owner's turn end; subagent verdicts are evidence plus per-work-unit steers, terminal `met`/`not_met` stays with the owner.
- **Reason:** the condition describes work performed anywhere in the tree; binding the verdict to the arming session both delays it behind the parent's extra verifying turn and misattributes the judge to the parent.
- **Reversal condition:** if the host cannot deliver a subagent-attributed, non-waking completion report (the mechanism landed in `7ba122d`/`55b967c`), keep owner-only evaluation and limit the change to prompt/guidance text. Do not ship a trigger that wakes the parent on every subagent completion.

The non-waking prerequisite is already on `dev`, so this plan starts at step 2. Steps are ordered by dependency.

## 4. Ordered implementation plan

### Step 2 — Resolve a session to its owning goal

Files: `src/runtime/background.ts`, `src/runtime/controller.ts`, `src/runtime/ports.ts`.

- Add `BackgroundPort.ancestorsOf(sessionID): Promise<string[]>` (or a narrower `goalOwnerOf`) implemented in `BackgroundTracker` by walking the cached `parents` map using the existing `parent()` helper (`:79-88`) up to `MAX_DEPTH` (`:8`). Reuse `descendsFrom()` (`:69-77`) rather than duplicating the walk.
- In the controller add `private goalOwnerFor(sessionID): GoalRecord | undefined` that walks those ancestors and returns the first session present in `this.goals`. A session with its own record resolves to itself; a child resolves to its nearest goal-bearing ancestor.
- Deterministic rule to pin: nearest ancestor wins; a cycle or an unresolved chain yields `undefined` (no evaluation), never a guess.

Verify: a unit test in `test/controller.test.ts` (or `test/plugin.test.ts` where the host is mocked) arms a goal on a parent, creates a child and grandchild via `background.sessionCreated(id, parentID)`, and asserts both resolve to the parent's record; an orphan resolves to `undefined`.

### Step 3 — Make subagent completion an evaluation trigger

Files: `src/runtime/events.ts`, `src/runtime/controller.ts`.

- Keep `events.ts:89-95` routing child completion events unchanged; the change is inside `onExecutionSucceeded` (`:1002-1021`). Replace the bare early return at `:1005` with: resolve `goalOwnerFor(sessionID)`; when it differs from `sessionID`, call a new `onWorkUnitCompleted(owner, completedSessionID, epoch, tools)` instead of returning. Sessions with no owning goal still return.
- `onWorkUnitCompleted` runs the same tool/heartbeat bookkeeping as the owner path, then calls a `resolveBackgroundAndEvaluate`-variant that passes the completed session id through to evaluation. Do not wait for `onBackgroundDrained()` as the only post-subagent path.
- Protect the in-flight verdict from the parent wake (§2.4): tag the runtime's evaluation with the work-unit session id it belongs to. In `onExecutionStarted` (`:929-949`), skip `invalidate()` only when the newly executing session is the goal owner resuming from an injected report for that same tagged work unit, and let the verdict land first. Every other new turn invalidates exactly as today. Drop a straggler parent turn via the existing epoch guard (`:1031-1034`, `stale()`).
- Keep `defer()` when sibling subagents or shells are still running (`:1043`) so the verdict sees the complete work; the trigger moves earlier, not the completeness rule.

Verify: a focused controller test drives `session.execution.succeeded` for a child while the goal is armed on the parent and asserts `evaluate()` runs with the child as work unit; a second test wakes the parent immediately afterward and asserts the verdict is not aborted (the `not_met` steer or `met` history entry still lands).

### Step 4 — Attribute the judge and define verdict semantics

Files: `src/index.ts`, `src/runtime/evaluator.ts`, `src/runtime/ports.ts`, `src/runtime/controller.ts`.

- Thread `completedSessionID` through `evaluate()` (`:1379-…) → Evaluator.evaluate (`:1420`) → `nativeVerdict` (`src/index.ts:442-…`) → `evaluatorContext` and `spawnEvaluator` (`:338-…`). The digest is built from the completed work unit's transcript; the condition still comes from the owner's record, so worker and judge cannot drift.
- Keep the parentless verdict child and the queued, non-waking `<subagent>` report from `7ba122d`; target that report at the completed work unit so the visible completion appears where the work happened. `isJudgeReport` continues to strip it from model-bound context (SPEC-workstreams.md CXLI).
- Define and pin the semantics when the verdict arrives:
  - `not_met` on a subagent → a continuation steer scoped to that work unit, recorded in the goal history with `source: <child id>`; it does not end the goal.
  - `met` on a subagent → recorded as evidence with the same source id; terminal goal state remains owned by the owner's turn-end verdict.
  - Idempotency key `(goal session, work-unit session, turn)` prevents a second verdict for the same completion.
  - The existing zero-tool / state-inspection downgrade, verifier matrix gate and loop advance stay unchanged.

Verify: a plugin test pins one non-waking report per completion, attributed to the child, with no parent wake on a `met` subagent verdict; a controller test asserts a child `met` does not clear the goal and a child `not_met` produces exactly one steer.

### Step 5 — Reconcile the drain path

Files: `src/runtime/controller.ts`.

- Keep `onBackgroundDrained()` (`:2654-2685`) as the shell/drain fallback and the final owner-turn gate, but make it skip work units already judged by step 3 (check the idempotency key before calling `evaluate()` at `:2680`). Remove no guard: `runtime.evaluating`/`this.running` (`:2658`) and the busy check (`:2675`) stay.
- Verify: one subagent plus one live shell yields exactly one verdict; the shell's exit does not produce a duplicate.

### Step 6 — Tests and gates

New regressions:

| File | Assertion |
| --- | --- |
| `test/controller.test.ts` | child/grandchild resolves to the arming goal; orphan resolves to none |
| `test/controller.test.ts` | child completion triggers `evaluate()` with the child as work unit |
| `test/controller.test.ts` | parent wake after child completion does not abort the verdict |
| `test/plugin.test.ts` | one queued, non-waking report per completion, attributed to the child |
| `test/controller.test.ts` | child `met` is evidence only; child `not_met` steers once |
| `test/controller.test.ts` | drain after a judged work unit produces no second verdict |
| `test/controller.test.ts` | deferral still holds while a sibling or shell is running |

Verification commands (from the worktree):

```
bun test test/controller.test.ts test/plugin.test.ts test/loop.test.ts test/core.test.ts
bun run check
```

`bun run check` must cover dist freshness, TUI load, docs freshness, invariant sweep and spec-check. Regenerate artifacts and re-count the SPEC marker for any added test. No gate or generated file may be weakened.

### Step 7 — Docs and coordinator close-out

- Add a `SPEC.md` workstream entry and a `docs/changelog.html` behavior-change line describing the new trigger and attribution; update `DELEGATE_VERDICT` (`src/core/prompts.ts:18-23`) so workers know subagent work is judged when it completes and that the harness still injects reports to wake them.
- Work on `wt/evaluator-subagent-trigger-plan`, commit on that branch, run `coordinator submit`, then merge into `dev` via `coordinator merge-next`. Never commit to `dev` directly.

## 5. Risks

- **Host wake timing (§2.4)** is the main correctness risk; step 3 must be verified with an explicit wake-after-completion test before step 4 builds on it.
- **Cost:** judging each work unit adds evaluator children. The idempotency key and the retained busy deferral bound this to one verdict per completed work unit; if cost is unacceptable, reverse to owner-only evaluation and keep only the attribution fix.
- **No live event reordering was observed during this investigation.** All claims above are derived from source control flow plus the screenshot; step 6 tests are the first executable confirmation.
