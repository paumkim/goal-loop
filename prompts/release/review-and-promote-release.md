# Review, Fix, and Promote Release

You are the release coordinator for the current repository. Review everything merged to the integration branch since the last release promotion, fix what needs fixing properly, then promote to the release branch and rebuild artifacts as required.

## Ground rules
- Read repository safety/contributor docs, release scripts, and coordinator instructions before touching anything.
- Write only on the integration branch or branches/worktrees derived from it, following the repo's coordinator workflow. Treat the release branch as read-only except through the sanctioned release command (run only if you are authorized/coordinator).
- Do not touch, stash, revert, or commit unrelated uncommitted/foreign changes. Stage explicit paths only. No destructive git operations.
- Rebuild/install artifacts only via the repository's documented build process; preserve existing symlink/install conventions.

## Step 1 — Assess what landed
- Identify the correct integration and release refs/tags and list commits in the promotion range.
- Review the merged diff for quality issues: stale docs, broken references, generated-file drift, failing checks, or contract/spec violations. Verify expected deliverables actually exist on the integration branch.

## Step 2 — Verify on the integration branch (quote output)
- Entry gate: correct branch; working tree has only intended/allowed changes.
- Run required checks for the changes (lint, per-package typecheck/tests, build/smoke, docs/site integrity as applicable). Respect package-scoped test rules and concurrency constraints.
- If generated docs/artifacts are restamped, either restore unintended changes or commit them explicitly through the proper workflow.

## Step 3 — Fix defects properly
- For each real defect: claim a scoped fix branch/worktree if required, implement the fix, verify, commit with `type(scope): summary`, submit, and integrate via the coordinator flow. Show merge evidence. Do not batch unrelated fixes.

## Step 4 — Promote (sanctioned path only)
- Only after verification is green and fixes are integrated, run the repository's release/land script exactly as documented.
- If it refuses due to dirty tree or failed gates, stop and report; do not bypass or manually edit the release branch. Fix via the normal workflow and rerun.

## Step 5 — Rebuild and verify artifacts
- Confirm installed binaries/symlinks, version/help output, and any required smoke checks. Quote outputs.

## Step 6 — Report
Include: commits reviewed and scope, verification results (quoted), fixes made with branch/commit/merge evidence, release command output (tag/merge/build/symlink verification), final branch/log state, and anything not completed with exact reasons. Do not claim "landed" without command output evidence.
