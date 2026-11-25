# Sweep Git Hygiene

Clean this repository's local git state without changing committed history or discarding anyone's work. Classify untracked and modified files as intentional work, generated artifacts, or stray junk, and propose cleanup only for clearly safe junk. List local branches fully merged into the integration branch, stale worktrees, and old stashes, and flag them as deletion candidates. Never drop a stash, remove a worktree holding uncommitted bytes, or run a history-rewriting command without my approval. Show me the tally of what you cleaned and what you only proposed.
