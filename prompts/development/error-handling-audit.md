# Error Handling Audit

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Find and fix error-handling defects: swallowed failures, missing handling,
and inconsistent error vocabulary.

## Before acting
- Discover the repository's error types, logging setup, and existing message or
  code conventions from its source and tests.
- Decide the scope: one package, one request path, or one module per pass.

## Inventory
- Empty or overly broad catch blocks, ignored promises, and fire-and-forget work.
- Catch blocks that only log and continue without a recovery policy.
- Generic error strings, mixed error classes or codes, and lost context.
- Missing cleanup on failure, unhandled rejections, and silent fallbacks.
- User-facing errors that expose stack traces or raw system messages.

## Fix pass
1. Prove each finding with a reproduction or a failing test before editing.
2. Fix the root cause: propagate, translate at the boundary, or retry only where
   the project defines that policy.
3. Standardize messages and codes to the existing convention. Add the operation
   and target for context, never secrets or personal data.
4. Keep stack traces in logs; show plain-language errors to users.
5. Add a focused test for every failure path you change.

## Rules
- No broad refactor bundled with the fixes.
- Do not log secrets or credentials. Do not turn a real error into a silent
  fallback without an explicit, documented policy.
- Leave intentional silent paths alone and note why they are intentional.

## Verify
- Run the relevant tests, typecheck, and linter; paste quoted output.
- Show the failure-path tests passing and confirm no test was weakened.
- List each finding with its `file:line` and resolution.

## Report
- Findings fixed:
- Findings intentionally left with reasons:
- Checks with quoted output:
