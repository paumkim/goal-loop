# Write Tests for Existing Behavior

Add focused tests that lock in real behavior and cover meaningful gaps.

## Before acting
- Discover the project's test framework, conventions, fixtures, and commands from
  its manifests, config, and existing tests.
- Identify the behavior to cover: bug-prone paths, recent changes, public APIs,
  or uncovered branches. Read the implementation before writing assertions.

## Write tests
1. **Pick targets:** choose a small set of high-value behaviors. Prefer critical
   paths, edge cases, and regression-prone logic over chasing a raw coverage number.
2. **Characterize behavior:** confirm the current intended behavior from code,
   docs, and existing tests. If behavior is ambiguous or buggy, report it instead
   of encoding the wrong expectation.
3. **Add tests:** write clear, deterministic tests that follow the project's style.
   Name tests by behavior, not by implementation detail. Cover happy path, edge
   cases, and failure modes where relevant.
4. **Keep them isolated:** avoid shared mutable state, real network/time
   dependence, and order dependence. Use existing fixtures/helpers; add new ones
   only when they reduce duplication clearly.

## Rules
- Do not weaken, delete, or loosen existing tests.
- Do not change production behavior just to make a test easier unless the change
  is clearly a bug fix and is separately verified.
- Do not add sleeps or broad retries to mask flakiness.
- Keep tests fast and scoped; do not add heavyweight end-to-end tests when a
  smaller test proves the behavior.

## Verify
- Run the new tests first, then the relevant suite; paste quoted output.
- Confirm the tests fail for the right reason when the behavior is broken (a
  quick local assertion flip or targeted check), then restore.
- Show `git diff --stat` and confirm only test-related files (and necessary
  fixtures/helpers) changed.

## Report
- Behaviors covered with `file:line`:
- Tests added/updated:
- Commands run and quoted output:
- Gaps intentionally left uncovered and why:
