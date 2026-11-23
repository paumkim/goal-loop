# Write or Update README

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Create or refresh a project's README so it matches the current code and commands.

## Before acting
- Read the existing README, docs, manifests, scripts, CI config, and entry points.
- Discover the real install, run, build, lint, test, and release commands; do not
  copy commands you have not verified.
- Identify the project's audience: user, contributor, operator, or mixed.

## Write
1. **Purpose:** explain what the project does, who it is for, and what it is not.
2. **Quick start:** list prerequisites and the shortest verified path to run or
   use it.
3. **Common tasks:** document install, dev/run, test, lint/format, build, and
   configuration with exact commands.
4. **Structure and concepts:** describe only the key directories, modules, or
   concepts a newcomer needs. Link to deeper docs if they exist.
5. **Troubleshooting/contributing:** include the repo's real contribution gates,
   support path, or known gotchas when evidenced by the project.

## Rules
- Prefer accuracy over completeness. Remove or flag stale sections you cannot
  verify; do not guess.
- Keep examples runnable and minimal. Do not include secrets, tokens, or
  machine-specific absolute paths.
- Match the project's existing tone and formatting conventions.
- Do not turn the README into a changelog or dump internal implementation detail.

## Verify
- Run every command you document, or clearly label it as unverified with evidence
  of why it could not be run.
- Check links, file paths, and referenced scripts exist.
- Read the README top to bottom as a newcomer and confirm it answers: what is
  this, how do I run it, how do I test it?

## Report
- Sections added/updated/removed:
- Commands verified with quoted output:
- Stale or unknown items left for follow-up (`file:line` or reason):
