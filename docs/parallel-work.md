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
   rough ETA; `coordinator status --json` shows **active** leases (non-`done`) with their worktree path,
   uncommitted-file count and whether a merge is in progress, plus a `summary` of submitted/done/active/total
   counts. Pass `--all` to include historic `done` leases. **`submit` makes work merge-ready, not merged.**
4a. `coordinator release <slug>` abandons a claimed lease that will never be submitted (an
   idle or dead claim). The lease flips to done — it stops blocking overlapping claims and
   stops warning in merge preflight — and its worktree is removed. Nothing is deleted:
   uncommitted bytes go to `refs/coordinator/saved/<slug>-<ts>` and a branch with unique
   commits is kept, with the command to rebuild its worktree printed. A lease that still
   holds unsubmitted work needs `release --force`; a submitted lease is refused (use
   `merge-next` or `merge-abort`). Releasing a done lease is a no-op.
5. **The submitting agent runs `coordinator merge-next`** from the main repo when their lease is ready/next (unless a designated integrator/process is explicitly assigned). Do not wait on an unspecified other actor. Before running it: `queue/status --json` shows your lease submitted and next/unblocked; the worktree has no uncommitted changes and the branch tip contains all intended commits; the main checkout is acceptable for merge-next (exempt `.term/coordinator/state.json` dirt is fine — never hand-edit `dev`). Run the sanctioned path (`merge-next` trial-merge + gate), never `git merge`/commit to `dev` or `main`. "Done"/merged evidence comes from `merge-next` succeeding for that lease.
   `coordinator merge-next` merges the oldest submitted lease into `dev`:
   - builds `merge-check-<slug>-<ts>` from `dev` inside a dedicated
     `worktrees/wt-merge-check-<slug>-<ts>` worktree (never the main checkout),
   - re-counts the SPEC.md `<!-- spec-check files=N tests=N -->` marker on the merged tree
     itself (`bun scripts/spec-check.ts --write`), so nobody hand-bumps counters,
   - regenerates the changelog and page stamps on the merged tree
     (`bun scripts/docs-watch.ts once`) and commits any change on the scratch branch,
     so parallel agents never race docs/changelog.html,
   - refuses a worktree whose HEAD drifted past the submitted branch tip (post-submit commits must be
     discarded or re-submitted); uncommitted bytes are preserved as a saved ref, never merged,
   - prints a preflight: what the merge touches, which in-flight lease overlaps it, and a
     `SEMANTIC-RISK` warning when another active lease shares a module (e.g. `src/core`) even without
     a literal path overlap — re-run that lease's checks after this merge lands,

   - runs the gate (`bun run check`) on the merged result. Red gate: `dev` untouched,
     exact recovery printed. Green gate: `dev` fast-forwards onto the merged result,
     a post-merge health line reports landed-tree cleanliness and the SPEC marker,
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

## Reading state during a peer's merge

A merge stashes the exempt live dirt and resets `.term/coordinator/state.json` to the committed
copy for the trial merge, then restores the live snapshot when the merge finishes (green or red).
During that window `coordinator status --json` and `coordinator queue` can transiently omit a
lease that was just claimed or submitted, or report a lease back as `claimed` after its submit.
That is the reset copy, not lost work. **Do not re-claim:** the live record is restored when the
peer's merge completes, and a second claim creates a duplicate lease that forces other agents to
rebase. Wait for the merge lock to clear (`coordinator status --json` shows `mergeLock: null`),
then re-check. The same applies to workstream headings in `SPEC.md`: several sessions append at
once, so derive the label from your lease slug instead of guessing the next Roman numeral.

## Shared artifacts

Some files must be touched by everyone: `.term/coordinator/state.json` and
`docs/changelog.html` (defaults), plus whatever the repo adds to `sharedPaths` in
`.term/coordinator/config.json` (comma-separated scopes). Shared files never fail the
submit scope check. The SPEC.md marker does not need to be shared: merge-next re-counts
it on the merged tree.

If your claim genuinely spans shared files, keep the edits minimal and expect conflicts.
The preflight in merge-next names every in-flight lease whose scope your merge overlaps, and separately
warns about shared-module semantic risk when two leases touch different files of the same module.

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

## Field gotchas (audited against the binary, 2026-11-21)

A note circulated with eight "gotchas". The table keeps what the code actually enforces and corrects
what did not hold; every verdict was checked against `packages/coordinator/bin/coordinator` (and
`scripts/spec-check.ts` for the marker claim).

| Field note | Verdict | Working rule |
|---|---|---|
| Overlapping live lease rejects `claim` without `--force` | Accurate | Claim a broad scope up front. Caveat: `claim --force` only prints `warning: path overlap with <slug> (forced)` to stderr — it is **not** persisted to the lease (unlike `submit --force`, which records `forcedScope*`). Overlaps with `done` leases never block. |
| Scope is checked at `submit`, not `claim`; `--force` overrides | Accurate | Submit from the worktree; expect listed violations and a logged override. Shared paths (`state.json`, `docs/changelog.html`, config `sharedPaths`) never fail the check. |
| `submit` takes no slug argument | Accurate | It derives the slug from the current `wt/<slug>` branch; any positional arg is `unexpected argument`. |
| `merge-next` needs an explicit target from the main repo | Accurate, now discoverable | From the main repo, pass `--target <slug>` (or the bare slug); from a `wt/<slug>` worktree it defaults to your own lease. Top-level `--help` now lists `[<slug>|--target <slug>]`. |
| `dev` can move while you work | Accurate | The stale-base guard fails with `merge-base(...) is not dev tip` and leaves `dev` untouched. Check `status --json`/`queue --json` first and expect to `git rebase dev` in the worktree, resolve, re-run `bun run check`. |
| Rebase conflicts cluster in `SPEC.md` / `docs/changelog.html` | Accurate; advice was outdated | Both are shared/contested. Keep both sections and drop stale markers, but you do **not** have to ship a docs commit to land: `merge-next` re-counts the SPEC marker and regenerates changelog/stamps on the merged tree. Local regeneration is only for making your own `bun run check` green. |
| The SPEC gate reads the first `spec-check` marker, not the last | Accurate | Only the first occurrence is parsed/rewritten (`scripts/spec-check.ts`); trailing per-workstream markers are historical. |
| A submitted lease cannot be re-submitted | Accurate; conclusion was too hedged | **Do not re-submit.** After `git rebase dev` the `wt/<slug>` branch itself is rewritten, so its tip is the rebased commit and `merge-next` tracks it — no re-submit, no release/re-claim. `submit` refuses a `submitted` lease (`expected claimed`); release + re-claim only if you are abandoning that work. |

Two omissions worth remembering:

- **Drift is not "committed after submit".** A commit on the checked-out branch advances the branch tip
  too, so there is no drift. Drift requires a detached HEAD or a branch reset; `merge-next` refuses it
  (`dev` untouched) with `git reset --hard <branch>` as the discard path. The recovery no longer advises
  the impossible "re-submit".
- **The main checkout must be clean** apart from exempt `.term/coordinator/state.json` dirt before
  `merge-next`; the preflight also names overlapping in-flight leases and `SEMANTIC-RISK` module
  neighbours so you can re-run their checks after your merge lands.

## Never

- Commit `dev` or `main` directly. The only commits on `dev` are merges by the pipeline
  and its bookkeeping commits (`chore(coordinator): record <slug> lease done`).
- Touch the `github-single-channel` lease or worktree. It belongs to another pipeline.
- Force-push anything. There is no remote in this flow.
- Leave claimed-but-idle leases lying around. Claim, work, submit or `release`. Releasing an idle claim (`coordinator release <slug>`) clears it without losing a byte; a claim that still holds unsubmitted work needs `--force`.
- `git worktree remove` a linked worktree that carries uncommitted bytes.
  `coordinator merge-next` and `merge-abort` handle this safely; use them.
