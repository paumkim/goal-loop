# Dependency Deduplication (One Cycle)

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Keep the current repository dependency-healthy by removing one duplicate dependency version per cycle.

## Each cycle
1. **Scan and classify duplicates** (e.g. lockfile and package manifests): same package with more than one version.
   - **A. Same-major, safe to unify** → fix it.
   - **B. Major-version gap** → record, skip.
   - **C. Transitive/external exact pin** → record, skip.
   - **D. Local/path alias** → record, skip.
2. If any class-A duplicate exists, pick the worst (most versions, then most consumers). If using a coordinator workflow, claim it with explicit paths (manifests and lockfile as applicable).
3. In an isolated worktree/branch (if required), unify every in-scope consumer onto the highest compatible version.
   - No new dependencies, no major bumps, no behavior changes.
4. **Verify:** reinstall/update lockfile from repo root as required; run lint (0 errors), typecheck in each touched package/area, and tests in each touched package/area.
   - If a failure also occurs on the base branch, report it as pre-existing; do not fix unrelated issues in this cycle.
5. Commit with a clear message (e.g. `chore(deps): unify <pkg> on <version>`), submit/integrate through the repo's workflow, and show merge evidence.
6. Re-scan.

## Stop condition
Stop when no class-A duplicates remain. Report the full class-B/C/D list with the exact blocker for each, plus a tally of duplicates fixed in this run. That report is success.

## Rules
- Do not stop early or wait for confirmation; pick the next actionable duplicate and proceed.
- If integration is rejected, fix the cause and resubmit in the same turn.
- Stage explicit paths only and follow repository safety/release rules.
