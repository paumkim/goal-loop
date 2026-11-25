# coordinator

claim: packages/coordinator/bin/coordinator claim <task> --agent <you> --paths <scope> [--force]
Work on wt/<slug> in worktree/wt-<slug>; work stays inside the claimed scope.
submit: commits are checked against the claimed paths (submit --force overrides, logged to the lease).
release: release <slug> [--force] releases a claimed lease that will never be submitted (idle or abandoned). It flips the lease done, removes its worktree, keeps uncommitted bytes in refs/coordinator/saved/<slug>-<ts>, and keeps a branch that carries unique commits (the recovery command is printed). Submitted leases leave via merge-next or merge-abort; a lease that still holds unsubmitted work needs --force.
merge-next: oldest submitted lease -> dedicated merge worktree -> trial merge -> SPEC marker re-count -> preflight -> gate (bun run check) on the merged result -> fast-forward dev. --review stops before the fast-forward; merge-done finishes, merge-abort discards. Uncommitted bytes are preserved in refs/coordinator/saved/<slug>-<ts> before any worktree removal.
status --json: per-lease dirty state and merge-in-progress. queue: FIFO with ETA. doctor: main checkout, worktree, node_modules, SPEC marker, merge lock health; doctor --json emits one machine-readable object {ok,failures,checks:[{name,level,message}]} (name is a stable identifier for the check; level is ok/warn/fail; failures counts fail checks; ok is true when failures is 0), with the same exit status as the human output.
wait/wake: after submit, call the plugin's `goal_standby` tool with your slug and end the turn instead of polling `merge-status` or `merge-next --wait` yourself. The plugin watches this state file; when your lease reaches the FIFO head with no merge lock held, it sends you a message and resumes your turn with the `merge-next --wait --target <slug>` step. A submitted lease is merge-ready, not done — land it and confirm `status --json` shows it done.
Protocol: docs/parallel-work.md
