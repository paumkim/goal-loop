# Diff Self-Review

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Review your own uncommitted diff before you commit or hand work off. Catch
defects, scope leaks, and missing tests while the change is still cheap to fix.

## Before acting
- Discover the repository's check commands, commit/staging rules, and which
  paths are generated or runtime state from its docs and configuration.
- Read the full diff (`git status`, `git diff`, staged diff) before judging any
  single hunk. Do not review from memory of what you intended to write.

## Review pass
1. **Scope:** list changed files and group them as feature, fix, cleanup, or
   generated. Flag unrelated edits, accidental reformatting, and artifacts that
   must stay untracked.
2. **Correctness:** read each hunk for callers not updated, error paths, empty
   and boundary inputs, resource cleanup, ordering, and concurrency.
3. **Contracts:** if a public function, CLI flag, config key, schema, or event
   changed, confirm types, callers, docs, and tests were updated with it.
4. **Tests:** map each changed behavior to a test. Add or adjust a focused
   regression test where coverage is missing.
5. **Security:** check for secrets, unvalidated external input, unsafe path or
   shell construction, and new logging that could leak sensitive values.
6. **Cleanup:** remove debug statements, dead code, and stale comments introduced
   by this change.

## Rules
- Fix real defects; do not reinterpret or expand the task.
- Do not reformat lines outside the change. Do not weaken or delete tests.
- Do not stage generated, vendored, or live-state files. Stage explicit paths.

## Verify
- Run the repository's formatter, linter, typecheck, and focused tests; paste
  the relevant output.
- Run `git diff --check` and show `git status --short`.
- Show that every finding was fixed or explicitly recorded with a `file:line`
  reference.

## Report
- Findings: `file:line` — what was wrong — what you changed.
- Checks: commands and quoted output.
- Remaining risks: at most three, each with evidence.
