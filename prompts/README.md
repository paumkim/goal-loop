# Prompt Library

Pick a prompt, copy its whole contents, and paste it as your instruction in an
agent session started in the project you want to change. Every prompt assumes the
current directory is that project. Replace `<placeholder>` values before you
paste.

Each prompt states an outcome. It does not prescribe steps. Start from a vague
goal and let the agent discover the project's commands, conventions, and checks.

## Action

Build or run a real artifact and show that it works.

- [Add a CLI command](action/add-cli-command.md): add and exercise a new CLI command.
- [Add an end-to-end test](action/add-end-to-end-test.md): drive a real user flow through the app.
- [Apply a database migration](action/apply-database-migration.md): author, apply, and roll back a schema change.
- [Automate a repetitive task](action/automate-repetitive-task.md): turn a repeated manual step into a verified command.
- [Boot and smoke test the app](action/boot-and-smoke-test-app.md): take a clean checkout to a live request.
- [Build a release artifact](action/build-release-artifact.md): build and smoke test the distributable.
- [Containerize the app](action/containerize-app.md): add an image build and serve a request from it.
- [Generate an API client](action/generate-api-client.md): regenerate client code and types from the spec.
- [Generate reference docs](action/generate-reference-docs.md): generate docs from code and check freshness.
- [Seed local data](action/seed-local-data.md): add deterministic seed data and prove two runs match.
- [Set up a CI check](action/set-up-ci-check.md): add a CI job that enforces a real check.
- [Wire a feature flag](action/wire-feature-flag.md): add a flag with a safe default and tests for both states.

## Audit

Find problems and prove them before changing code.

- [Bug regression audit](audit/bug-regression-audit.md): audit recent changes and fix only proven defects.
- [Over-engineering checklist](audit/over-engineering-checklist.md): record an evidence-backed checklist of bloat and messy code.
- [Security review](audit/security-review.md): triage security risks and fix confirmed findings.

## Coordinator

Work through a claim and merge workflow.

- [Drain the merge queue](coordinator/drain-merge-queue.md): validate and integrate queued work.
- [Implement a coordinator](coordinator/implement-coordinator.md): design a claim, worktree, submit, and merge flow.

## Development

Daily work: implement, debug, review, and upgrade.

- [Address review feedback](development/address-review-feedback.md): resolve each review comment with evidence.
- [Check an API contract](development/api-contract-check.md): verify producers and consumers agree, then regenerate derived files.
- [Upgrade a dependency](development/dependency-upgrade.md): upgrade one dependency with a clean revert path.
- [Review the current diff](development/diff-self-review.md): catch defects, scope leaks, and missing tests before handoff.
- [Audit error handling](development/error-handling-audit.md): fix swallowed failures and inconsistent error vocabulary.
- [Fix failing checks](development/fix-failing-checks.md): find the root cause of each red check and fix it.
- [Orient in a new repo](development/fresh-repo-orientation.md): map layout, commands, config, and contribution gates.
- [Implement a feature](development/implement-feature.md): deliver a requested feature end to end in a small slice.
- [Investigate performance](development/performance-investigation.md): profile a symptom, fix the measured bottleneck, and show before and after.
- [Reproduce and minimize a bug](development/reproduce-and-minimize-bug.md): get to a minimal reproduction, root cause, and regression test.
- [Refactor safely](development/safe-refactor.md): restructure code without changing behavior.
- [Write tests](development/write-tests.md): add focused tests for existing behavior and edge cases.

## Docs

- [Build a docs freshness radar](docs/docs-system-freshness-radar.md): add a docs system with metadata-driven freshness tracking.
- [Package agent docs](docs/package-agent-docs.md): write maintainer docs from the actual codebase.
- [Write a README](docs/write-or-update-readme.md): make the README match verified commands and behavior.

## Local models

- [Fix local model chat routing](local-models/local-model-chat-routing-fix.md): make chat requests reach the intended local backend.
- [Make local models self-serve in a TUI](local-models/local-model-self-serve-tui.md): let a user discover, install, run, tune, and repair models through the UI.

## Maintenance

Cleanup and consistency work, one verified unit at a time.

- [Autonomous maintainer](maintenance/autonomous-maintainer.md): deliver exactly one committed, verified unit from a task list.
- [Remove dead code](maintenance/dead-code-removal.md): delete code you can prove has no consumer.
- [Clean up debug statements](maintenance/debug-statement-cleanup.md): remove temporary prints while keeping intentional logging.
- [Deduplicate a dependency](maintenance/dependency-dedupe.md): unify one duplicate dependency version per cycle.
- [Audit dependency security](maintenance/dependency-security-audit.md): triage advisories and apply only safe patched upgrades.
- [Check docs freshness](maintenance/docs-freshness-check.md): fix documentation that drifted from code and config.
- [Reconcile env config drift](maintenance/env-config-drift.md): match sample config to the variables the code reads.
- [Normalize format and lint](maintenance/format-lint-normalize.md): conform to the project's formatter and linter config.
- [Sweep git hygiene](maintenance/git-hygiene-sweep.md): tidy local branches, stashes, and ignores without rewriting history.
- [Scan for secret leaks](maintenance/secret-leak-scan.md): find and remove committed credentials without printing them.
- [Check test health](maintenance/test-health-check.md): fix root-cause test failures without lowering coverage.
- [Triage TODOs](maintenance/todo-triage.md): turn scattered TODO comments into tracked work or delete stale noise.
- [Run a universal improvement pass](maintenance/universal-improvement-pass.md): improve clarity, consistency, and measured performance in the current directory.

## Planning

- [Plan a feature](planning/plan-feature.md): turn a request into scoped, ordered, verifiable work units.

## Project

- [Bootstrap a new project](project/bootstrap-new-project.md): start a minimal, verified project layout with tooling and tests.

## Release

- [Land an integration branch](release/land-dev-to-main.md): land work to the release branch through the project's sanctioned flow.
- [Review and promote a release](release/review-and-promote-release.md): review merged work, fix real defects, and promote with evidence.

## TUI

- [Add behavior control settings](tui/behavior-control-settings.md): add settings that control agent behavior with clear UX and persistence.
- [Fix post-send flicker](tui/fix-post-send-flicker.md): stop the transcript from flickering after a message is sent.
- [Run a TUI polish pass](tui/polish-pass.md): make small, verified visual and interaction improvements.
- [Add sticky note capture](tui/sticky-note-capture.md): let users pin notes in the TUI without disrupting core flows.

## Conventions

- The current directory is the target unless a prompt says otherwise.
- Discover commands and rules from the project itself before acting.
- If a workflow a prompt mentions does not exist in the project, say so rather than inventing one.
