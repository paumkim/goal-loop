# Maintainer workflow

A minimal, repeatable workflow for making changes safely.

## Where things go
- **Specs / acceptance:** define or update the task's acceptance and verification (see `SPEC.md` if present) before or alongside implementation.
- **Code & tests:** implement in the appropriate source locations; keep changes scoped to the task.
- **Docs:** update user/maintainer docs when behavior or workflow changes.
- **Runtime/state:** local runtime artifacts (caches, learnings, locks, scratch worktrees/state) are not source-of-truth and should stay untracked.

## How work moves
1. **Claim scope:** identify the task and the files/areas in scope.
2. **Isolate work:** do work in a dedicated branch/work area (e.g. a task worktree) rather than directly on the main integration branch.
3. **Implement & verify:** make the change, run the checks/tests the acceptance requires, and capture fresh evidence.
4. **Submit:** commit with a clear message and submit the work for integration/review.
5. **Merge/land:** only the designated integration/merge step lands changes on the target branch after required checks pass. "Done" means landed (or submitted per your process), not just edited locally.

## Handoff
- Leave a short note of what changed, how it was verified, and anything unfinished or risky for the next person.
