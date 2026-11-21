# Test Health Check

Run the current repository's tests and improve test health without lowering
coverage or hiding failures.

## Before acting
- Discover the project's test commands and structure from its manifests, scripts,
  and docs (unit, integration, end-to-end). Run the standard suite and record a
  baseline: passed, failed, skipped, and any flaky/intermittent results.

## Triage
- **Failing test:** determine whether the code or the test is wrong, then fix the
  root cause. Never delete, weaken, or skip a test to make the suite green. If the
  failure is pre-existing on the base branch, prove it and report it rather than
  fixing unrelated issues.
- **Skipped/disabled/`.only`/`.skip`:** identify why. Re-enable ones that are safe
  and unblocked with a verified fix; leave the rest with a `file:line` note
  explaining the blocker.
- **Flaky:** capture evidence of nondeterminism (timing, order, shared state) and
  make it deterministic where possible; otherwise report it with reproduction steps.
- **Critical path with no tests:** add a focused regression test only if a real
  gap is found in scope.

## Rules
- Keep test count and coverage from decreasing. Do not add sleeps or loosen
  assertions to mask races without justification.
- Work one verified change unit at a time and follow repository staging/safety rules.

## Verify
- Re-run the full suite and show after numbers vs baseline with quoted output.
- Confirm no test was deleted, weakened, or newly skipped; list any still
  disabled with reasons.
- Show `git diff --stat` and `git status --short`.
