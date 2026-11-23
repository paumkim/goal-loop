# Implement a CLI-Independent Coordinator System

Implement a coordinator system for the current repository so multiple agents (from different CLIs/tools) can work safely without colliding.

## Problem
- Agents may overwrite each other, collide on files, or corrupt shared state when working directly on the integration branch.
- Coordination must work through a CLI-independent filesystem protocol usable from plain shell commands.

## Goal
Build a coordinator that enforces this workflow:
1. Claim a task.
2. Receive an exclusive lease and claimed file paths.
3. Create a worktree and audit branch.
4. Work only inside the claimed scope.
5. Commit only explicit paths on that audit branch.
6. Submit the completed audit branch to the coordinator.
7. Coordinator validates it.
8. Coordinator merges audit branches serially into the integration branch.

No regular agent should write directly to the integration branch.

## Required design

### Filesystem protocol (CLI-independent)
Use repository-local files/state, for example:
- Claim leases: `.tmp/claims/<task-id>.json` (or repo-equivalent)
- Worktrees: `worktree/wt-<slug>`
- Audit branches: `wt/<slug>`
- Coordinator-owned tracked metadata: a tracked directory such as `.term/coordinator/` or repo-equivalent

Choose paths consistent with existing repo conventions if they already exist.

### Coordinator commands
Provide a CLI entrypoint that supports at least:
- `init`
- `status`
- `claim <task-id> <agent-id> --paths <glob-or-path,...>`
- `heartbeat <task-id> <agent-id>`
- `release <task-id> <agent-id> [reason]`
- `submit <task-id> <branch>`
- `merge-next`
- `queue` and/or `reject`
- `takeover <task-id>` for stale leases

Commands must be usable from a plain shell.

### Lease and ownership state
Track at least: task ID, agent ID, host/session identifier, claimed paths, branch/worktree, lease/heartbeat times, status (`claimed`, `working`, `submitted`, `merging`, `done`, `failed`, `expired`), and dependencies if needed.

Rules:
- Reject overlapping path claims.
- Restrict edits/commits to claimed paths.
- Heartbeats extend leases; stale leases can be taken over.
- Release is explicit and deactivates the claim.
- Reject heartbeat/release from a non-owner agent.

### Worktree workflow
- Provide helpers to create worktree/branches (e.g. `git worktree add worktree/wt-<slug> -b wt/<slug>`).
- Agents work inside the worktree on the audit branch.
- Integration runs in a clean integration worktree and merges one audit branch at a time under a coordinator lock.

### Validation before merge
Before merging, run required checks (discover from repo): lint, and for touched packages/areas typecheck and tests as applicable. Treat validation failures as merge blockers and return the task with failure reason.

### Safety enforcement
Implement practical guards (not just docs):
- Block normal-agent edits/commits on the integration branch.
- Detect out-of-scope file changes and refuse submission.
- Require explicit path staging (never `git add -A`).
- Never stash/discard foreign changes.
- Serialize merges with a lock.

## Deliverables
1. Coordinator implementation and shell-usable CLI commands.
2. State schema and status output.
3. Lease/heartbeat/takeover/release/submit/merge workflows.
4. Worktree/audit-branch helpers.
5. Path-overlap detection.
6. Scoped-edit and integration-branch-write guards.
7. Tests for ownership, overlap detection, stale takeover, status transitions, and merge serialization.
8. Documentation for launching coordinator, claiming work, and integrating results.
9. Updated project safety instructions requiring coordinator-mediated multi-agent work.

## Verification / acceptance
- Demonstrate two non-overlapping claims succeed, overlapping claim is rejected.
- Demonstrate submit/validate/merge integrates one task without overwriting another.
- Demonstrate normal agents cannot commit directly to the integration branch.
- Demonstrate stale lease takeover.
- Demonstrate clean integration branch state after merge.
- Run relevant typecheck, lint, and tests (including coordinator tests) and report quoted results.
