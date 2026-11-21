# Git Hygiene Sweep

Clean the current repository's local git state without changing committed history
or discarding anyone's work.

## Before acting
- From the repository root, record a baseline: `git branch --show-current`,
  `git status --short --branch`, `git worktree list`, `git stash list`, and
  `git log --oneline -5`.
- Discover repo-specific rules (AGENTS.md, maintainer docs, coordinator state)
  for what counts as generated, runtime, or shared state. Treat those as
  read-only for this pass.
- Never run destructive or history-rewriting commands (`reset --hard`,
  `clean -fd`, branch `-D`, `rebase`, `push -f`) without explicit authorization.

## Sweep
1. **Working tree:** classify untracked/modified files as (a) intentional local
   WIP, (b) generated/runtime artifacts that should be gitignored, or (c) stray
   junk. Only propose ignore rules or deletion for (c) when clearly safe;
   otherwise report it.
2. **Gitignore gaps:** if generated artifacts keep reappearing, propose a precise
   `.gitignore` rule. Do not ignore source or user content.
3. **Stale branches:** list local branches already merged into the current
   integration branch (`git branch --merged`). Report deletion candidates;
   delete only branches you can prove are fully merged and are authorized to remove.
4. **Worktrees:** list worktrees; flag ones whose branch is gone or whose directory
   is missing. Never remove a worktree that still holds uncommitted bytes.
5. **Stashes:** list stashes with age; report stale ones. Never drop a stash
   without authorization.
6. **Large/newly tracked files:** flag surprisingly large tracked files that look
   generated. Report them; do not bulk-delete.

## Rules
- Stage explicit paths only. Keep runtime/live state files uncommitted as the
  repository specifies.
- If a cleanup would require a destructive command, stop and report the exact
  command and reason instead of running it.

## Verify
- Re-run the before-acting commands and show the delta.
- Show `git status --short`, `git diff --stat`, and `git worktree list`.
- Report a short tally: artifacts ignored, branches/stashes/worktrees flagged,
  and every action that was only proposed, not taken.
