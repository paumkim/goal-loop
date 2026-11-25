# Over-Engineering and Messy Code Checklist

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Scan the current repository for over-engineering and messy code, then record the
findings in a persistent `checklist/` file that future sessions can reuse. This
is an audit: produce evidence, not a refactor spree. Do not change behavior
unless a fix is called out as its own verified unit.

## Before acting
- Confirm you are in the target repository root; work in the current checkout unless repo rules require an isolated worktree.
- Identify unrelated uncommitted changes and leave them untouched.
- Discover the repo's layout, sources of truth, checks, and branching/claim rules; follow them (if a claim/lease protocol exists, claim `checklist/` before writing).
- Record a baseline of relevant checks (typecheck, lint, tests) so later claims are grounded.

## Scan for over-engineering
- **Premature abstraction:** wrappers, interfaces, factories, or layers with a single implementation/caller; generic code used only once.
- **Speculative generality:** unused extension points, plugin hooks, feature flags, config knobs, or "future-proofing" with no current consumer.
- **Solution inflation:** dependencies, frameworks, or machinery doing work a few lines of existing code could do.
- **Dead weight:** unreachable branches, unused exports/deps/assets, commented-out code, duplicate implementations, stale TODOs.
- **Complexity hot spots:** deep nesting, long functions/files, mixed responsibilities, indirection that hides a simple flow.
- **Cost without proof:** caching, batching, concurrency, or micro-optimizations with no measurement or load-bearing reason.

## Scan for messy code
- Inconsistent naming, formatting, error vocabulary, or import/style conventions relative to the rest of the repo.
- Magic values, hidden mutable state, swallowed errors, and unclear control flow.
- Copy-paste with drift, comments that contradict code, and docs/config that disagree with the implementation.
- Debug prints, temporary hacks, and weakened or flaky tests. Report hand-edited generated/vendored files; do not "fix" them here.

## Rules
- Cite `file:line` (or `path` for docs/config) for every finding; read the code before claiming — no speculation.
- Separate confirmed findings from suspicions and hardening ideas; assign severity (high/medium/low).
- Do not delete tests, guards, or safety checks to simplify code; do not weaken checks to pass.
- Keep generated, vendored, dependency, and build-output paths out of the checklist except as explicit exclusions.
- Prefer listing a finding over fixing it. If you fix something, make it a small, separately verified change with its own evidence.

## Persistent checklist
- Create `checklist/` if absent and write `checklist/over-engineering-checklist.md` (use this stable path unless the repo documents a different one).
- Include scan date, base branch/commit, scope inspected, and a short count of findings by severity.
- For each finding record: `file:line`, category (over-engineering/messy code), severity, evidence (what you read or ran), impact, recommended action, and status (`open`, `fixed`, `deferred`) with a commit hash when fixed.
- Add a "Recurring patterns / watch list" section for issues likely to return, and an "Exclusions" section for paths intentionally out of scope.
- If a checklist already exists, update it in place: append new findings, correct resolved ones, keep prior dates and context; do not dump raw command output.
- Keep it terse and scannable so another agent can act on it without repeating the whole scan.

## Verify and handoff
- Re-run the baseline checks; quote the output and show `git diff --stat`.
- Confirm the checklist is the only artifact added and commit it per repo rules (branch, message format, and claim release where applicable).
- Report: checklist path and commit hash, findings by severity with top `file:line` references, commands run with quoted output, and residual risks or items needing human judgment.
