# Implement a Feature

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Implement a requested feature end-to-end with small, verified changes.

## Before acting
- Discover the repository's layout, conventions, test commands, and contribution
  gates from its docs, manifests, and scripts.
- Read the request and identify the user-visible outcome, constraints, and
  acceptance criteria. If a detail is ambiguous, make the smallest reasonable
  assumption, state it, and proceed.
- Find the relevant code paths, existing patterns, and tests before editing.

## Implement
1. **Plan the slice:** pick the smallest end-to-end slice that delivers value.
   Identify files to change and the behavior to preserve.
2. **Baseline:** run relevant existing tests or checks to understand the starting
   state. Record failures that are unrelated and do not hide them.
3. **Build:** implement the feature following existing project patterns. Prefer
   clear, boring code over new abstractions.
4. **Test:** add or update focused tests that cover the new behavior and important
   edge cases. Update docs or config samples if the feature changes them.
5. **Refine:** remove dead code, debug statements, and unintended scope creep.

## Rules
- Do not guess APIs, file paths, or commands; verify them in the repo.
- Do not claim behavior is supported unless it is tested or otherwise verified.
- Keep changes scoped to the request. Record unrelated issues separately.
- Never weaken, skip, or delete tests to make checks pass.
- Stage explicit paths only; do not commit secrets or generated noise.

## Verify
- Run the repository's relevant lint, typecheck, tests, and build/smoke commands;
  paste quoted output.
- Show `git diff --stat` and confirm the diff matches the requested scope.
- If the feature is user-visible, describe or capture how it was exercised.

## Report
- Assumptions made:
- Changes with `file:line`:
- Tests added/updated and why:
- Commands run and quoted output:
- Remaining risks or follow-ups (max 3):
