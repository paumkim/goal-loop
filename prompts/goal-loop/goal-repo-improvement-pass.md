# Goal/Plugin Repository Improvement Pass

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Run a continuous, evidence-based improvement pass over a goal-loop-style plugin repository: remove bloat, unify inconsistencies, and improve speed/responsiveness without changing intended behavior unless tests or spec require it.

Repo-specific specialization of `maintenance/universal-improvement-pass.md`; the shared method is inlined here so this file stands alone.

## Scope
- Prioritize goal-loop/plugin hot paths: evaluator/controller, render and HUD updates, transcript/context handling, store writes, coordinator merge path.
- Keep the repo's gates and generated artifacts in sync (compiled TUI, SPEC marker, docs, changelog).

## Method
1. Inventory before editing: map modules, hot paths, deps, docs, config; quantify bloat and inconsistency. Skip the full inventory for one small, obvious fix.
2. Remove bloat, then unify patterns, then optimize — in small, independently mergeable units.
3. For performance work show before/after evidence; never claim "feels faster".
4. Guardrails: no public API/behavior change without spec + tests; add regression tests for risky changes; preserve load-bearing guards (epoch/abort/verify/probe); never skip, weaken, or delete tests.
5. Follow the repo workflow (claims/worktrees, submit/merge, clean tree, generated-file sync) and run required checks per unit and after integration.

## Output
Per unit: scope/slug/paths, changes (`file:line`), deletions, before/after evidence, check/merge result. Final: files removed, LOC delta, artifact/test-count deltas, pasted check output.
