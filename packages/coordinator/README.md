# coordinator

claim: packages/coordinator/bin/coordinator claim <task> --agent <you> --paths <scope> [--force]
Work on wt/<slug> in worktree/wt-<slug>; work stays inside the claimed scope.
submit: commits are checked against the claimed paths (submit --force overrides, logged to the lease).
release: release <slug> [--force] releases a claimed lease that will never be submitted (idle or abandoned). It flips the lease done, removes its worktree, keeps uncommitted bytes in refs/coordinator/saved/<slug>-<ts>, and keeps a branch that carries unique commits (the recovery command is printed). Submitted leases leave via merge-next or merge-abort; a lease that still holds unsubmitted work needs --force.
merge-next: oldest submitted lease -> dedicated merge worktree -> trial merge -> SPEC marker re-count -> preflight -> gate (bun run check) on the merged result -> fast-forward dev. --review stops before the fast-forward; merge-done finishes, merge-abort discards. Uncommitted bytes are preserved in refs/coordinator/saved/<slug>-<ts> before any worktree removal.
status --json: per-lease dirty state and merge-in-progress. queue: FIFO with ETA. doctor: main checkout, worktrees, node_modules, SPEC marker, merge lock health; doctor --json emits one machine-readable object {ok,failures,checks:[{name,level,message}]} (name is a stable identifier for the check; level is ok/warn/fail; failures counts fail checks; ok is true when failures is 0), with the same exit status as the human output.
Protocol: docs/parallel-work.md
