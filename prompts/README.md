# Prompt Library

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Focused, copy-paste prompts for common development workflows.

## How to use
1. Open a terminal in your preferred project directory.
2. Start your CLI/agent session from that directory.
3. Copy the full contents of a prompt file and paste it as your instruction.
4. Do not run from the wrong directory: prompts assume the current working directory is the target repository unless stated otherwise.

## Organization
- `audit/` — codebase audits, regression hunting, and review passes
- `coordinator/` — claim/submit/merge coordinator workflows
- `development/` — daily development workflows: implementation, debugging, review, refactors, upgrades, and orientation
- `docs/` — documentation systems and maintainer docs
- `goal-loop/` — goal-driven improvement loops
- `local-models/` — local model setup, routing, and UX
- `maintenance/` — cleanup, consistency, dependency health, and upkeep
- `planning/` — scope, break down, and de-risk work before coding
- `project/` — bootstrap and project-lifecycle setup
- `release/` — verification, promotion, landing, and rebuild flows
- `tui/` — terminal UI fixes, polish, features, and debugging

## Audit prompts

Index of `prompts/audit/`. Copy a file's full contents and paste it as your instruction.

- `bug-regression-audit.md` — use to audit recent changes for bugs/regressions in an isolated worktree and fix only proven defects.
- `security-review.md` — use to review code for security risks, prioritize confirmed findings, and fix issues with evidence.

## Coordinator prompts

Index of `prompts/coordinator/`. Copy a file's full contents and paste it as your instruction.

- `drain-merge-queue.md` — use to clear a coordinator merge queue by validating, integrating, and reporting queued work.
- `implement-coordinator.md` — use to design or implement a CLI-independent coordinator system in a repository.
- `single-agent-coordinator.md` — use to run coordinator-style isolated work as a single agent following the repo's workflow.

## Development prompts

Index of `prompts/development/`. Copy a file's full contents and paste it as your instruction; run one at a time and verify after each.

- `address-review-feedback.md` — use to work through review comments systematically with an explicit disposition and evidence for each.
- `api-contract-check.md` — use to verify producers and consumers of an API or config contract still agree, then regenerate derived files.
- `change-summary-and-pr-description.md` — use to write a short, accurate change summary or PR description from the final diff.
- `dependency-upgrade.md` — use to upgrade one dependency through the package manager with a clean revert path and full checks.
- `diff-self-review.md` — use before committing or handing off to review the current diff for defects, scope leaks, and missing tests.
- `error-handling-audit.md` — use to find and fix swallowed failures, missing handling, and inconsistent error vocabulary.
- `fix-failing-checks.md` — use to diagnose and fix failing build, lint, typecheck, test, or CI checks without hiding the root cause.
- `fresh-repo-orientation.md` — use to map an unfamiliar repo's layout, commands, config, and contribution gates without guessing.
- `implement-feature.md` — use to implement a requested feature end-to-end with scoped changes, tests, and verification.
- `performance-investigation.md` — use to profile a real performance symptom, fix the measured bottleneck, and prove before/after improvement.
- `reproduce-and-minimize-bug.md` — use to turn a vague bug report into a minimal reproduction, a stated root cause, and a regression test.
- `safe-refactor.md` — use to restructure code without changing behavior, with a baseline, regression tests, and per-step checks.
- `write-tests.md` — use to add focused tests for existing behavior, covering meaningful paths and edge cases without weakening the suite.

## Docs prompts

Index of `prompts/docs/`. Copy a file's full contents and paste it as your instruction.

- `docs-system-freshness-radar.md` — use to build a local docs system with metadata-driven freshness tracking and a radar/dashboard.
- `package-agent-docs.md` — use to create or refresh package-level agent/maintainer documentation from the actual codebase.
- `write-or-update-readme.md` — use to create or update a README so it matches verified commands, structure, and current project behavior.

## Goal loop prompts

Index of `prompts/goal-loop/`. Copy a file's full contents and paste it as your instruction.

- `goal-repo-improvement-pass.md` — use for a goal-loop/plugin-specific pass (hot paths, gates, generated artifacts); shares the method with the universal pass.

## Local model prompts

Index of `prompts/local-models/`. Copy a file's full contents and paste it as your instruction.

- `local-model-chat-routing-fix.md` — use to diagnose and fix local model chat routing so requests reach the intended local backend.
- `local-model-self-serve-tui.md` — use to make local models fully self-serve in a TUI, from discovery/setup to use.
- `local-model-settings-setup.md` — use to add an easy settings flow for configuring local model providers and defaults.

## Maintenance prompts

Index of `prompts/maintenance/`. Copy a file's full contents and paste it as your instruction; run one at a time and verify after each.

- `autonomous-maintainer.md` — use to deliver exactly one committed, verified unit in an isolated worktree; also the default workflow prompt for `prompter`.
- `dead-code-removal.md` — use to remove provably dead code in small units with consumer evidence and full checks.
- `debug-statement-cleanup.md` — use to remove temporary debug prints/statements while preserving intentional logging and required literals.
- `dependency-dedupe.md` — use to unify one duplicate dependency version per cycle (same-major, safe only), recording and skipping major-gap or transitive/alias cases.
- `dependency-security-audit.md` — use to run the repo's dependency audit, triage advisories, and apply only safe patched upgrades with full checks.
- `docs-freshness-check.md` — use to find and fix documentation that has drifted from the code and configuration it describes.
- `env-config-drift.md` — use to reconcile sample env/config files with the variables the code actually reads, without printing real secrets.
- `format-lint-normalize.md` — use to bring the repo into conformance with its own formatter/linter config without changing behavior.
- `git-hygiene-sweep.md` — use to tidy local git state (branches, stashes, ignores) without rewriting history or discarding anyone's work.
- `remove-model-attribution.md` — use to strip AI model/tool attribution stamps while keeping legitimate code and required literals.
- `secret-leak-scan.md` — use to detect and remove accidentally committed credentials without printing secret values or rewriting history.
- `test-health-check.md` — use to run the suite and fix root-cause failures without lowering coverage, skipping, or deleting tests.
- `todo-triage.md` — use to turn scattered TODO/FIXME/HACK/XXX comments into tracked work or delete stale noise.
- `universal-improvement-pass.md` — use as the canonical improvement-pass method; the goal-loop pass is its repo-specific specialization.

## Planning prompts

Index of `prompts/planning/`. Copy a file's full contents and paste it as your instruction.

- `plan-feature.md` — use before coding to turn a request into scoped, ordered, verifiable work units with risks and assumptions.

## Project prompts

Index of `prompts/project/`. Copy a file's full contents and paste it as your instruction.

- `bootstrap-new-project.md` — use to start a new project from scratch with a minimal verified layout, tooling, tests, and README.

## Release prompts

Index of `prompts/release/`. Copy a file's full contents and paste it as your instruction.

- `land-dev-to-main.md` — use to land an integration branch to the release branch through the repository's sanctioned flow.
- `merge-coordinator-to-main.md` — use to merge coordinator-managed work into the release branch and rebuild required artifacts.
- `review-and-promote-release.md` — use to review merged work, fix real defects, and promote a release with verification evidence.

## TUI prompts

Index of `prompts/tui/`. Copy a file's full contents and paste it as your instruction.

- `behavior-control-settings.md` — use to add or refine TUI settings that control agent behavior with clear UX and persistence.
- `fix-post-send-flicker.md` — use to diagnose and fix transcript flicker that appears after sending a message in a TUI.
- `headless-debug-frame-protocol.md` — use to define or debug a headless frame protocol for inspecting TUI rendering state.
- `polish-evaluator.md` — use to evaluate a TUI polish pass against quality criteria and report concrete issues.
- `polish-pass.md` — use to execute a focused TUI polish pass with small, verified visual/interaction improvements.
- `sticky-note-capture.md` — use to add persistent sticky-note capture in a TUI without disrupting core workflows.
- `transcript-verbosity-consistency.md` — use to normalize transcript verbosity and remove dead or inconsistent rendering paths.

## Conventions
- Prompts are written to be self-contained and low-bloat.
- Discover repo-specific paths, commands, and conventions from the current project before acting.
- Prefer small, verifiable changes with quoted command output as evidence.
- When a prompt mentions coordinator or release tooling, use the mechanisms that exist in the current repository; if they do not exist, report that clearly.
- The three improvement passes share one method: `maintenance/universal-improvement-pass.md` is canonical, `goal-loop/goal-repo-improvement-pass.md` is the plugin specialization, and `maintenance/autonomous-maintainer.md` is the single-unit variant. Prefer the narrowest one that fits the task.
