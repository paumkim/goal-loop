# Add a CI Check

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Add a CI job that enforces a real check and verify it locally before handing off.

## Before acting
- Identify the CI system and config location from the repo (YAML workflows,
  pipeline files, scripts). Read an existing job to copy conventions for runners,
  caching, and triggers.
- Define the check to enforce (test suite, lint, typecheck, build, generated-file
  freshness) and the command that runs it locally.

## Steps
1. **Prove locally:** run the check command locally and confirm it passes on the
   current tree. Fix genuine failures first; do not weaken the check.
2. **Add the job:** write the CI job using the repo's existing config patterns,
   with the correct trigger paths/branches and dependency install from the lockfile.
3. **Cache thoughtfully:** reuse the repo's caching setup if present; avoid adding
   a second cache strategy for the same dependencies.
4. **Validate config:** lint or parse the CI config with whatever local tool the
   repo provides (or the CI CLI if available) to catch syntax errors.
5. **Document:** note the new check in the contributing/dev docs if checks are
   listed there.

## Rules
- Do not disable existing checks to make room for the new one.
- Do not add secrets or unresolved variables to the config; reference existing ones.
- Do not merge config changes you cannot validate locally without saying so.

## Verify
- Paste quoted local output of the check passing.
- Paste quoted config-validation/lint output (or state why none is available).
- Show `git diff --stat` confirms the change is scoped to CI config + docs.

## Report
- CI system and config file:
- Check enforced and local command:
- Quoted local + validation output:
- Anything that can only be confirmed after CI runs:
