# Parallel work: how multiple agent sessions share one repo

One clone, many sessions. Each session works in its own git worktree on its own branch.
The coordinator (`packages/coordinator/bin/coordinator`) hands out leases and lands merged
work on `dev`. Plain git underneath. No GitHub. Bun only.

The rules below are enforced by the binary, not by trust.

## The loop

1. `coordinator claim <task> --agent <you> --paths <scope>` claims a lease and creates
   `wt/<slug>` plus `worktrees/wt-<slug>`. `--paths` is a comma-separated scope:
   `packages/coordinator/**`, `src/core/types.ts`, `test`, `.`. A `**` suffix matches the
   whole subtree; a bare path matches the file or the directory it names.
   Claiming an existing lease, or paths overlapping a live lease's scope, needs `--force`.
   Overlaps against already-merged (`done`) leases never block.
2. Work in `worktrees/wt-<slug>` on branch `wt/<slug>`. Never work in the main checkout.
   Never commit `dev` or `main` directly.
3. Commit as you go. Commits are checked against your claimed paths at submit time.
   Files outside your claim fail `submit`. Override with `submit --force`; the override is
   logged to your lease record (`forcedScope`, `forcedScopeAt`, `forcedScopeFiles`).
4. `coordinator submit` marks the lease submitted when your commits stay inside your claim.
   The queue is FIFO by `submittedAt`. `coordinator queue` shows positions, wait times and a
   rough ETA; `coordinator status --json` shows every lease with its worktree path,
   uncommitted-file count and whether a merge is in progress.
4a. `coordinator release <slug>` abandons a claimed lease that will never be submitted (an
   idle or dead claim). The lease flips to done — it stops blocking overlapping claims and
   stops warning in merge preflight — and its worktree is removed. Nothing is deleted:
   uncommitted bytes go to `refs/coordinator/saved/<slug>-<ts>` and a branch with unique
   commits is kept, with the command to rebuild its worktree printed. A lease that still
   holds unsubmitted work needs `release --force`; a submitted lease is refused (use
   `merge-next` or `merge-abort`). Releasing a done lease is a no-op.
5. `coordinator merge-next` merges the oldest submitted lease into `dev`:
   - builds `merge-check-<slug>-<ts>` from `dev` inside a dedicated
     `worktrees/wt-merge-check-<slug>-<ts>` worktree (never the main checkout),
   - re-counts the SPEC.md `<!-- spec-check files=N tests=N -->` marker on the merged tree
     itself (`bun scripts/spec-check.ts --write`), so nobody hand-bumps counters,
   - regenerates the changelog and page stamps on the merged tree
     (`bun scripts/docs-watch.ts once`) and commits any change on the scratch branch,
     so parallel agents never race docs/changelog.html,
   - prints a preflight: what the merge touches and which in-flight lease overlaps it,
   - runs the gate (`bun run check`) on the merged result. Red gate: `dev` untouched,
     exact recovery printed. Green gate: `dev` fast-forwards onto the merged result,
     your lease flips to done, your worktree is removed.
   - With `--review`, it stops after the green gate and prints the exact command to finish
     (`git merge --ff-only <scratch>`) or discard (`coordinator merge-abort <slug>`);
     after you fast-forward by hand, `coordinator merge-done <slug>` records the lease done.

## Uncommitted bytes are safe

Any path that deletes a worktree first stashes the non-exempt dirt into
`refs/coordinator/saved/<slug>-<epoch>` (a real stash commit, also listed in `git stash list`)
and prints recovery commands, e.g. `git stash apply refs/coordinator/saved/<slug>-<epoch>`.
The only exempt dirt is `.term/coordinator/state.json`. Claim and submit leave it dirty
by design, and the merge flow restores it. Your uncommitted work never vanishes with a
worktree.

## Shared artifacts

Some files must be touched by everyone: `.term/coordinator/state.json` and
`docs/changelog.html` (defaults), plus whatever the repo adds to `sharedPaths` in
`.term/coordinator/config.json` (comma-separated scopes). Shared files never fail the
submit scope check. The SPEC.md marker does not need to be shared: merge-next re-counts
it on the merged tree.

If your claim genuinely spans shared files, keep the edits minimal and expect conflicts.
The preflight in merge-next names every in-flight lease whose scope your merge overlaps.

## When you are blocked

The merge pipeline never force-lands a red tree. If your lease is the loser of a conflict:

1. `git -C worktrees/wt-<slug> rebase dev`
2. resolve the conflict
3. re-run the gate in your worktree (`bun run check`)
4. `coordinator merge-next` again. Your lease is still submitted; no need to re-submit

If the gate fails on the merged result, `dev` is untouched and the error prints the fix
and the exact recovery. Fix the branch, then re-run `merge-next`. If you only need the SPEC
marker re-counted, run `bun scripts/spec-check.ts --write` and commit the result.

If a merge died mid-flight, `coordinator doctor` tells you: main-checkout state, dangling
worktrees, dangling `node_modules` symlinks, SPEC marker vs reality, merge-lock health.
Exit code 1 means at least one check failed; the output says what and how to fix it.

## Never

- Commit `dev` or `main` directly. The only commits on `dev` are merges by the pipeline
  and its bookkeeping commits (`chore(coordinator): record <slug> lease done`).
- Touch the `github-single-channel` lease or worktree. It belongs to another pipeline.
- Force-push anything. There is no remote in this flow.
- Leave claimed-but-idle leases lying around. Claim, work, submit or `release`. Releasing an idle claim (`coordinator release <slug>`) clears it without losing a byte; a claim that still holds unsubmitted work needs `--force`.
- `git worktree remove` a linked worktree that carries uncommitted bytes.
  `coordinator merge-next` and `merge-abort` handle this safely; use them.
