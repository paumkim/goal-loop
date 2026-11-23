# Bootstrap a New Project

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Start a new project from scratch with a small, verified, maintainable foundation.

## Before acting
- Confirm the target directory, project name, language/runtime, and intended
  deliverable (library, CLI, service, web app, etc.). If the user did not
  specify, pick the simplest sensible default and state it clearly.
- Check for existing files before creating anything. Do not overwrite user work.

## Bootstrap
1. **Layout:** create the minimum directory structure for the chosen stack.
   Keep it conventional and shallow; avoid speculative folders.
2. **Tooling:** initialize the package/build manifest, lockfile policy, formatter,
   linter, and test runner using the ecosystem's standard tools. Pin or constrain
   versions where the ecosystem expects it.
3. **Entrypoint:** add the smallest runnable "hello" path that proves the project
   works (a main module, CLI command, route, or library export).
4. **Tests:** add one passing test that exercises the entrypoint or core behavior.
5. **Docs:** write a short `README.md` with purpose, prerequisites, setup, run,
   test, and lint commands that you actually verified.
6. **Repo hygiene:** add a `.gitignore` appropriate for the stack, and initialize
   git only if the directory is not already a repository. Do not commit secrets
   or generated build output.

## Rules
- Prefer boring, widely supported defaults over clever scaffolding.
- Do not install unnecessary dependencies or generate large template trees.
- Do not hardcode machine-specific paths, credentials, or local ports in tracked
  files unless the project requires them; document defaults instead.
- Keep every generated command and file consistent with the chosen stack.

## Verify
- Run install, lint/format check, test, and the run/build command; paste quoted
  output for each.
- Confirm the README commands match the commands you ran.
- Show the final tree (`find` or `tree`-equivalent) and `git status --short`.

## Report
- Chosen stack and defaults (and why):
- Files created with purpose:
- Commands run and quoted results:
- Next sensible improvements (max 3):
