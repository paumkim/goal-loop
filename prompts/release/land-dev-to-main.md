# Land Integration Branch to Release Branch

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Promote the integration branch to the release branch using the repository's sanctioned release process, from a clean checkout.

## Preconditions (must all hold; stop and report if not)
- Run from the repository root in your preferred working directory.
- You are on the correct integration branch (commonly `dev`) as required by the release script.
- Working tree is clean except any explicitly allowed runtime/state files documented by the repo (release tooling may refuse otherwise).
- You have coordinator/release authority if the repo restricts this action.
- Read the release script and project safety rules before running anything.

## Steps
1. Confirm branch and status:
   - current branch
   - `git status --short`
   - recent commits and relationship between integration and release branches
2. Run required pre-release verification as defined by the repo (lint, typecheck, tests, docs/site checks, etc.) and fix issues through the normal workflow (not by bypassing gates).
3. Execute the sanctioned release command (for example `bun run script/land.ts` or the repo-equivalent). Do not manually merge/rewrite release branches unless the documented process requires it.
4. If the release script fails due to a real gate or dirty tree, stop, report the exact output, fix the cause through the proper workflow, and rerun from the top. Do not work around guards.
5. After landing, verify and report with quoted output:
   - release/integration branch positions and latest commits
   - snapshot/tag created (if applicable)
   - build artifacts/binary rebuilt as required
   - symlinks/installed entrypoints point to the expected targets
   - version/help smoke check as applicable
   - final `git status`

## Rules
- Never stash, revert, reset, or commit unrelated/foreign changes to force a release.
- Never stage with `git add -A`.
- Do not push, retag, or modify user/global config unless the sanctioned release flow does it and you have evidence.
- Use "landed" only with commit hash/tag and quoted command output as evidence.
