# Safe Refactor

Restructure code to improve clarity or reduce duplication while preserving
observable behavior.

## Before acting
- Discover the target module's callers, tests, and the repository's check
  commands from its source and configuration.
- Map the module's entry points, public surface, and any load-bearing guards
  before editing.

## Method
1. **Baseline:** run the existing tests and record the result. If a behavior is
   not covered, add a characterization test that captures current output first.
2. **Choose one unit:** pick the smallest cohesive piece with the highest churn
   or coupling. Write down the behavior you are preserving in one sentence.
3. **Change structure only:** extract, rename, split, inline, or consolidate.
   Keep signatures and error text stable unless a test proves a change is safe.
4. **Check after each step:** run focused tests and compare against the baseline.
   Stop and revert the step if observable behavior changed.
5. **Deduplicate cautiously:** merge implementations only when callers are proven
   identical in inputs, outputs, and failure modes.
6. **Finish:** remove the now-unused imports, branches, and helpers left behind.

## Rules
- No public API or behavior change without a spec and tests.
- Preserve guards, cancellation, and lifecycle wiring even when they look
  redundant.
- Never skip, weaken, or delete tests to make a step pass.
- Keep each step small enough to commit independently.

## Verify
- Run typecheck, linter, and the full relevant test suite; paste quoted output.
- Show `git diff --stat` and confirm the change is structural, not behavioral.
- Report the baseline result and the after result side by side.

## Report
- Unit and preserved behavior:
- Changes with `file:line`:
- Baseline vs after test evidence:
- Checks and commit hash:
