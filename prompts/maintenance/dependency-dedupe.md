# Deduplicate Dependencies

Unify one duplicate dependency version per cycle in this repository until none remain. Scan the lockfile and package manifests for packages declared at more than one version. Fix same-major duplicates by moving every in-scope consumer to the highest compatible version, with no new dependencies, major bumps, or behavior changes. Skip major-version gaps, transitive exact pins, and local path aliases, and report each with its blocker.

- Reinstall or update the lockfile from the repository root.
- Run lint, typecheck, and tests in each touched package.
- Stop when no same-major duplicates remain, with a tally of fixes and skips.
