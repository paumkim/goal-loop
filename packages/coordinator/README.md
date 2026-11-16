# coordinator

claim: packages/coordinator/bin/coordinator claim <task> --agent <you> --paths <scope> [--force]
Work on wt/<slug> in worktrees/wt-<slug>; work stays inside the claimed scope.
submit: commits are checked against the claimed paths (submit --force overrides, logged to the lease).
merge-next: oldest submitted lease -> dedicated merge worktree -> trial merge -> SPEC marker re-count -> preflight -> gate (bun run check) on the merged result -> fast-forward dev. --review stops before the fast-forward; merge-done finishes, merge-abort discards. Uncommitted bytes are preserved in refs/coordinator/saved/<slug>-<ts> before any worktree removal.
status --json: per-lease dirty state and merge-in-progress. queue: FIFO with ETA. doctor: main checkout, worktrees, node_modules, SPEC marker, merge lock health.
Protocol: docs/parallel-work.md
