# Add an End-to-End Test

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Write and run a test that drives the real app through a user-facing flow.

## Before acting
- Discover the E2E framework, how the app is started for tests, selectors/helpers,
  and where E2E specs live. Find an existing spec to copy conventions from.
- Pick one real user flow (sign-in, create-and-read, checkout) with an observable
  outcome. Avoid testing internals that unit tests already cover.

## Steps
1. **Set up:** use the repo's fixture/seed mechanism to create deterministic state.
   Start the app the same way the existing E2E suite does.
2. **Write the test:** drive the flow through its real interface (browser, HTTP, or
   CLI). Assert on user-visible results, not implementation details.
3. **Make it robust:** avoid fixed sleeps; wait on conditions/selectors. Ensure the
   test cleans up state and can run repeatedly.
4. **Prove it catches something:** confirm the test fails if the core behavior is
   broken (you may temporarily invert an assertion, then restore it).
5. **Wire it in:** place the spec with the suite and confirm the test-runner command
   discovers it.

## Rules
- Do not use real credentials or external services; use local fixtures/mocks for
  third parties.
- Do not add flaky waits or weaken assertions to make the test pass.
- Do not commit screenshots, traces, or artifacts unless the repo already does.

## Verify
- Paste quoted output of the new test passing.
- Paste quoted output showing it fails when the behavior is broken (then restored).
- Run the full E2E suite (or the relevant file) and paste quoted output.

## Report
- Flow covered and user-visible assertions:
- Spec file with `file:line`:
- Quoted pass + fail evidence:
- Flakiness risks (max 3):
