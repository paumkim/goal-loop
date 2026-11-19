# CURRENT_TASK — opencode-goalv2 improvement loop (iteration 1)

Objective (constant): keep improving keep on fixing the current directory codebase. from back to front.

## Interpretation
- "Back to front": sweep from the back of the pipeline (src/runtime — the execution back end) forward to the front (src/core, then the entry points index.ts / rpc.ts).
- "Improving/fixing": find real bugs — logic errors, broken invariants, dead code, edge cases — and fix what is worth fixing, verified by the project checks.
- Scope: the opencode-goalv2 plugin at /home/pauk/Projects/opencode-v2-goal/opencode-goalv2.

Note: the repo's own SPEC.md is the plugin's spec (enforced by the spec-check gate in `bun run check`); the goal-loop fuzzy-goal spec is recorded here instead of overwriting it.

## State so far
- Two verified improvements from the previous pass (stashed in the main checkout, visible via `git stash list | head -1` — restored via `git stash pop` after submit):
  - src/core/file-log.ts — safeStringify: shared (DAG) objects encoded as "[circular]"; fixed with seen.delete() after the array/object branches.
  - src/runtime/controller.ts — verifyMet: verify child not cancellable on invalidate; fixed by registering runtime.abort during verification.
- Both verified: bun run check exit 0 (1754 pass / 0 fail); test/file-log.test.ts 9/9; empirical probe through withFileSink.

## Acceptance (this iteration)
- Back-to-front sweep of src/runtime → src/core → index.ts/rpc.ts: actionable bugs found are fixed (minimal, behavior-correct changes only).
- `cd <worktree> && bun run check` exits 0 (tsc --noEmit + bun test); tails recorded in the transcript.
- All changes committed on branch wt/<slug> of this worktree; `coordinator submit` run from the worktree.

## Verification
- bun run check in the worktree (exit code + tail).
- Tester subagent: git diff stat/diff + re-run of the checks after fixes.
