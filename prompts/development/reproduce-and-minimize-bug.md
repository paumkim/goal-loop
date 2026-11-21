# Reproduce and Minimize a Bug

Turn a vague bug report into a minimal reproduction, a proven root cause, and
a regression test.

## Before acting
- Discover how to run the app or tests, where logs and configuration live, and
  which commands are safe to run locally from the project's docs and scripts.
- Gather the report, expected versus actual behavior, and relevant non-secret
  environment details. Do not print real credentials.

## Steps
1. **Reproduce:** write the smallest deterministic command, input, or test that
   fails. Capture the exact output and the conditions required to trigger it.
2. **Triage:** check recent changes, input variations, state, timing, and order.
   Identify which condition flips the result from pass to fail.
3. **Minimize:** reduce the input, configuration, and code path to the smallest
   case that still fails. Remove unrelated state and dependencies.
4. **State the cause:** explain the mechanism in one sentence before editing.
   If you cannot, keep investigating instead of patching symptoms.
5. **Fix:** make the smallest change that addresses the stated mechanism.
6. **Lock it in:** add a regression test that fails on the old behavior and
   passes on the fix.

## Rules
- Do not add sleeps, retries, or broader catches that only mask the symptom.
- Do not delete or weaken tests. Do not commit reproduction artifacts or logs.
- Do not fix unrelated defects found along the way; record them instead.

## Verify
- Show the regression test failing before the fix and passing after, with quoted
  output.
- Run the relevant test suite, typecheck, and linter; paste the output.
- Show `git diff --stat` and confirm the fix and test are scoped to the cause.

## Report
- Minimal reproduction (command or test):
- Root cause in one sentence:
- Fix with `file:line`:
- Before/after test evidence:
