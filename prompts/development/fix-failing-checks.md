# Fix Failing Checks

Diagnose failing build, lint, typecheck, test, or CI checks and make them pass
without hiding the problem.

## Before acting
- Discover the repository's standard check commands and CI configuration. Identify
  which check is failing, where it fails, and whether it is reproducible locally.
- Capture the failing output before changing anything.

## Diagnose
1. **Reproduce:** run the narrowest command that reproduces the failure. Confirm
   it fails for the same reason reported.
2. **Classify:** determine whether the cause is the code, the test, configuration,
   environment, flakiness, or a stale artifact. Do not guess.
3. **Trace root cause:** read the relevant code, test, config, and recent changes.
   State the cause in one sentence before fixing.
4. **Fix:** make the smallest correct fix. If the check exposed a real bug, fix
   the bug; if the test/config is wrong, fix it with evidence.

## Rules
- Do not skip, weaken, delete, or mark tests flaky just to get green.
- Do not silence linters/typecheckers with broad ignores unless the ignore is
  justified and narrowly scoped.
- Do not claim environment-only failures are fixed without reproducing in the
  relevant environment or clearly reporting the limitation.
- Keep fixes scoped to the failing check; record unrelated failures separately.

## Verify
- Show the failing command/output before the fix and the passing output after.
- Run the next broader relevant checks to ensure no regression; paste quoted output.
- Show `git diff --stat` and confirm the change addresses the stated cause.

## Report
- Failing check and baseline output:
- Root cause in one sentence:
- Fix with `file:line`:
- Before/after evidence and broader checks:
- Unrelated or unresolvable failures (if any):
