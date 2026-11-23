# Format / Lint Normalize

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Bring the current repository into conformance with its own formatter and linter
configuration without changing behavior.

## Before acting
- Discover the project's formatter/linter tooling and config from manifests,
  config files, and scripts (for example prettier, eslint, black, gofmt, rustfmt,
  clang-format). Determine the canonical check/fix commands and whether a
  pre-commit hook or CI gate enforces them.
- Establish a baseline: run the check command and record the violation count and
  the files affected.

## Normalize
1. **Config present:** if no formatter/linter config exists, say so clearly.
   Propose a minimal config only if the project already declares the tool as a
   dependency; do not introduce new tooling in this pass.
2. **Apply the repository's own fix command** to source files it owns. Never
   hand-format generated, vendored, or minified files; exclude them via
   config/ignore.
3. **Remaining violations:** fix manually only when the rule is unambiguous and
   behavior-preserving. Use a targeted inline suppression only when the violation
   is intentional, and justify it with `file:line`.
4. **Docs/spec alignment:** if formatting or lint rules are documented, keep those
   docs consistent with the real config.

## Rules
- Formatting-only changes must not alter behavior or the public API. Do not
  weaken, relax, or delete lint rules to reduce the violation count.
- Keep generated artifacts consistent: regenerate them, do not hand-edit.
- Stage explicit paths only.

## Verify
- Re-run the check command: 0 violations, or only justified and documented
  suppressions.
- Run the repository's standard build/typecheck/tests; quote output and show
  unchanged results.
- Show `git diff --stat` and confirm the diff is formatting-only.
