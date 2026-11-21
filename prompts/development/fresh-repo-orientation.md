# Fresh Repository Orientation

Build a quick, durable map of an unfamiliar repository so future work starts
from verified facts instead of guesses.

## Before acting
- Discover the repository's documentation, tooling, and conventions from the
  current project before mapping anything; do not rely on generic defaults.
- Stay read-only while mapping. Do not change source code during orientation.
- Read the root docs, manifests, directory tree, scripts, and CI configuration.

## Map
1. **Purpose:** what the project does, its language and runtime, and its main
   data flow, in one paragraph.
2. **Layout:** which directory owns which concern, where entry points live, and
   where generated or vendored files sit.
3. **Commands:** the exact commands for install, run or dev, build, lint,
   typecheck, test, and any release step. Mark each as verified or unverified.
4. **Configuration:** where settings and environment variables are defined, and
   which sample files describe them. Never record real secret values.
5. **Contribution gates:** branch and worktree rules, commit format, required
   checks, review, merge, and release flow.
6. **Gaps:** missing or stale docs, commands you could not verify, and anything
   that contradicted itself, each with a `file:line` reference.

## Persist
- Store the map where this repository keeps agent or maintainer documentation.
- If no such place exists, state that clearly and provide the map in the report
  instead of inventing a convention.

## Rules
- Derive every statement from a file; never guess a command or a path.
- Keep the map short and structured with headings and bullets.
- Do not copy secrets, tokens, or machine-specific absolute paths into the map.

## Verify
- Re-open the source file for each recorded command and confirm it matches.
- Check that a fresh reader can answer how to run tests and where to make a
  change using only the map.
- List which commands were actually run versus only read from config.

## Report
- The map, plus a short note of what was verified by running and what was not.
