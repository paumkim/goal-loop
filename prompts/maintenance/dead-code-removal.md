# Dead Code Removal

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Remove provably dead code in small, behavior-preserving units.

## Before acting
- Discover the repository's build, test, lint, and typecheck commands.
- Identify the code's public surface: exported APIs, CLI flags, config keys,
  routes, jobs, reflection/dynamic entry points, and documented behavior.

## Find candidates
1. Search for unused exports, files, functions, classes, constants, feature
   flags, dependencies, and scripts. Use static references, symbol search, build
   warnings, and coverage/tooling where available.
2. For each candidate, prove it has no runtime or build-time consumers. Check
   dynamic usage: string-based imports, reflection, registries, config-driven
   loading, external packages, and documentation/examples.
3. Rank candidates by confidence. Start with high-confidence, low-risk removals.

## Remove
- Delete one small cohesive unit at a time. Remove related tests only when they
  exclusively cover the dead code; keep or update tests that cover live behavior.
- Update imports, exports, docs, and config that reference the removed item.
- Do not remove compatibility surfaces, deprecation shims, or public APIs without
  evidence they are unused and safe to drop.

## Rules
- If you cannot prove it is dead, do not delete it; record it as a follow-up with
  evidence.
- No behavior changes. No drive-by refactors.
- Stage explicit paths only and follow repository safety rules.

## Verify
- Run the repository's standard checks (lint, typecheck, tests, build as
  applicable) and paste quoted output.
- Show `git diff --stat` and summarize what was removed and why it was safe.
- Confirm no new unused-import/export warnings were introduced.

## Report
- Removed items with `file:line` and deadness evidence:
- Checks run and quoted output:
- Candidates not removed and why:
