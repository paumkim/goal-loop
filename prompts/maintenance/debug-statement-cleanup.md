# Debug Statement Cleanup

Remove temporary debug code from the current repository while preserving
intentional logging and required literals.

## Before acting
- Discover the languages, toolchain, and logging conventions used here (logger
  vs prints, log levels) from the project's config and existing code; do not guess.
- Establish a baseline: run the repository's standard checks (lint, typecheck,
  tests) so pre-existing failures are distinguishable from regressions you add.

## Find
Search tracked source (exclude dependencies, build output, fixtures/snapshots,
and docs that describe the patterns themselves):
- ad-hoc prints/console logging and debug breakpoints (for example `console.log`,
  `print(`, `debugger;`, `breakpoint()`, `fmt.Println`, `System.out`, `dbg!`);
- temporary guards, hardcoded test values, commented-out code, always-true
  feature toggles, and `temp`/`debug`/`scratch` markers;
- leftover debug TODOs.

## Decide
- **Remove:** statements whose only effect is debug output, and dead temporary code.
- **Keep:** intentional leveled logging; output that is the program's actual
  contract (CLI tools, scripts, examples); literals required by tests, fixtures,
  docs, or snapshots.
- **Unsure:** keep and flag with `file:line` rather than guessing.

## Verify
- Re-run the same search: no unintended debug statements remain outside the
  justified cases, which you list with `file:line`.
- Re-run the baseline checks; show that results are unchanged and quote output.
- Show `git diff --stat` and `git status`.
