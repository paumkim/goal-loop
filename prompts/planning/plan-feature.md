# Plan a Feature or Change

Turn a request into a small, verifiable plan before writing code.

## Before acting
- Discover the repository's layout, conventions, test commands, and contribution
  gates from its docs, manifests, and scripts.
- Read the request carefully. Identify the user-visible outcome, constraints, and
  what "done" means. If the request is ambiguous in a way that changes the
  implementation, state the assumption you are making and proceed with the
  smallest reversible choice.

## Plan
1. **Scope:** restate the goal in one sentence. List what is in scope and what is
   explicitly out of scope.
2. **Current state:** find the relevant files, entry points, data flow, and tests.
   Note existing patterns to follow. Cite `file:line` references.
3. **Design:** describe the smallest change that satisfies the request. Prefer
   existing patterns over new abstractions. Call out public API, schema, config,
   or migration impacts.
4. **Work units:** break the work into ordered, independently verifiable units.
   Each unit should be small enough to review and commit on its own, with a clear
   check command or test that proves it.
5. **Risks:** list behavior changes, compatibility concerns, rollback steps, and
   unknowns. For each unknown, say what evidence would resolve it.

## Rules
- Do not write production code during planning unless a tiny spike is needed to
  resolve an unknown; label any spike as throwaway and do not commit it.
- Do not guess file paths, commands, or APIs. Verify them in the repository.
- Keep the plan concrete. Avoid vague steps like "update code as needed."

## Verify
- Confirm every referenced file and command exists in the current repository.
- Check that each work unit has an observable verification step.
- Check that the plan covers tests, docs, and generated artifacts affected by the
  change.

## Report
- Goal and non-goals:
- Relevant files (`file:line`):
- Proposed approach:
- Ordered work units with verification for each:
- Risks and open questions:
