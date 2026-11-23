# Dependency Security Audit

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Run the current repository's dependency audit, triage findings, and apply only
safe, verified fixes.

## Before acting
- Discover the project's package manager and audit tooling from its manifests and
  lockfiles (for example `npm audit`, `pnpm audit`, `yarn audit`, `cargo audit`,
  `pip-audit`, `govulncheck`, `bundle audit`). Prefer the repo's own documented
  command. Record the baseline output before any change.

## Triage each advisory
- **Safe patched upgrade (no major bump, no breaking change):** apply it, update
  the lockfile, and run the repository's full checks (lint, typecheck, tests) in
  each affected area.
- **Major bump, breaking change, or no fix yet:** do not force it. Record the
  advisory ID, severity, affected package, and concrete blocker.
- **Dev-only or not exploitable here:** record the rationale for deferral.
- **Failure also present on the base branch:** report it as pre-existing; do not
  fix unrelated issues in this pass.

## Rules
- Work one coherent, verifiable upgrade unit at a time; keep changes scoped and
  stage explicit paths.
- Never bypass or weaken checks to make an audit pass, and never hand-edit a
  lockfile.
- Do not add new dependencies.

## Verify
- Re-run the audit and show the changed finding count with quoted output.
- Show the upgrade diff (manifest plus lockfile), check output, and a deferred list
  with the exact blocker per advisory.
- Show `git status --short`.
