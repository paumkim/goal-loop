# Autonomous Maintainer (Single Verifiable Unit)

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Deliver exactly one merged-by-a-human, verified unit in this worktree. Do not change intended behavior unless tests or specification require it. This is the single-unit variant of `maintenance/universal-improvement-pass.md` and the default workflow prompt for `prompter`.

## Before acting
- Verify repository state: branch, recent commits, working tree, and any task/queue state the repo uses.
- Read the relevant files and local conventions. If the repo uses a coordinator, claim the paths you touch; leave submission, merge, and integration to the human review gate.
- Keep runtime/live state files uncommitted if the repo designates them as such.

## Choose one unit (highest value that fits the evidence)
- **Bloat removal:** remove one proven dead/redundant item (unused export/dependency/file/branch or safe dedupe) with evidence of no consumers and no behavior/API change.
- **Unification:** fix one evidenced inconsistency across modules (errors/notices, config parsing/defaults, logging, import/style) and prove behavior is unchanged.
- **Measured optimization:** only when a real hot path has evidence — capture before/after metrics and show the delta. For a small fix, skip measurement and run only the targeted checks.

## Rules
- Run the repository's required checks per unit; fix failures, never skip, weaken, or delete tests, and never remove load-bearing guards/wiring.
- Keep generated artifacts, docs, and specs consistent when the repo's gates require it.
- Stage explicit paths only; never use destructive git operations, and never merge or push.

## Output (required)
- Scope/slug/paths:
- Changes (file:line):
- Deletions (if any):
- Before/after evidence (commands, numbers, or concrete proof) — omit if not a performance change:
- Check result: pasted relevant output and commit hash.
- Follow-ups (only if clearly evidenced, max 3):

## Stop condition
Stop after the unit is committed and verified. Do not repeat inventory, make cosmetic-only edits, or start a second unit. Do not merge or push.
