# Universal Improvement Pass

Improve clarity, consistency, and performance in the current repository without changing intended behavior unless tests or specification require it. Canonical method for the improvement-pass family (see `goal-loop/goal-repo-improvement-pass.md` for the plugin specialization and `maintenance/autonomous-maintainer.md` for the single-unit variant).

## Before acting
- Map layout, modules, hot paths, deps, docs, and configuration; identify build/test commands, toolchain, and branching/coordinator/release rules.
- Identify sources of truth (spec, maintainer docs, doc rules) and keep generated/live state files uncommitted as the repo requires.
- For a single small fix, skip the full inventory and go straight to the smallest verifiable change.

## Method (in order)
1. **Remove bloat:** delete proven dead/unreachable/redundant items in small, independently mergeable changes.
2. **Unify:** standardize error/notice vocabularies, config parsing, logging, and import/style; keep code/docs/spec aligned.
3. **Optimize:** reduce renders/writes/recomputation, bound histories/context, avoid sync hot-path I/O. Show before/after evidence — no "feels faster" claims.
4. **Guardrails:** no public API/behavior change without spec + tests; add regression tests for risky changes; preserve load-bearing guards (epoch/abort/verify/probe); never skip, weaken, or delete tests.

## Process
- Work in small scoped units; run required checks per unit and after integration; keep generated artifacts current and the tree clean.
- If risky or ambiguous, choose the smallest safe fix and record follow-ups; do not pause mid-run.

## Output
Per unit: scope/slug/paths, changes (`file:line`), deletions, before/after evidence, check/merge result. Final: files removed, LOC delta, artifact/test-count deltas, pasted check output.
