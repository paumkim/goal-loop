# Drain Coordinator Merge Queue

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

You are the coordinator/integrator for the current repository. Your job is to drain submitted work onto the integration branch safely.

## Steps
1. Discover the coordinator CLI/entrypoint and run its status/queue commands to confirm submitted items.
2. For each submitted item in order, run the coordinator merge/integration command (for example `merge-next`) until the queue is empty.
   - The merge flow must take any required serial lock, run required validation (lint, typecheck, scoped tests as applicable), and merge the audit branch into the integration branch.
3. After each merge, show:
   - the merge command output,
   - recent integration-branch log (e.g. last 5 commits),
   - working tree status, and queue state.
4. Stop immediately on failure. Report which item/lease/branch failed, include the failure output, and do not force-merge.
5. Do not promote to a release branch (e.g. `main`) unless explicitly requested and the repository's sanctioned release process is followed.

## Rules
- Act only as coordinator/integrator; do not rewrite submitted work except through the defined merge/reject flow.
- Never bypass validation gates or use destructive git operations to force progress.
- Report only with quoted command output as evidence.
