# Implement a Coordinator for Multiple Agents

Build a CLI-independent coordinator so agents from different tools work safely without collisions. Agents claim tasks, get an exclusive lease and paths, work in their own worktree and branch, then submit. The repository's coordinator validates and merges submissions serially into the integration branch, with no direct agent writes.

Use repository-local files for leases and metadata, following conventions.

- Provide shell-usable commands: init, status, claim, heartbeat, release, submit, merge-next, queue, reject, and stale-lease takeover.
- Track task and agent IDs, paths, branch, lease times, and status.
- Reject overlapping path claims and edits or commits outside claimed paths.
- Extend leases on heartbeat, deactivate on release, and reject non-owner actions.
- Run lint, typecheck, and scoped tests before each merge and block on failure.
- Guard integration-branch writes, require explicit staging, serialize merges, and never stash foreign changes.

Add tests for ownership, overlap detection, stale takeover, status transitions, and merge serialization. Document startup and claiming, and require coordinator-mediated work in safety instructions. Demonstrate overlapping-claim rejection, a clean merge, and a blocked direct integration-branch commit.
