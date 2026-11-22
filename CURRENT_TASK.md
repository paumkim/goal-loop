# CURRENT_TASK — continuous improvement logging (archived, complete)

**Status: landed.** The iteration-1 objective below was implemented and shipped; this file is kept as the
historical task record, not a to-do. Verify current behavior in the source and tests, not in this document.

## What was delivered

- `src/core/learning-log.ts` — pure builders and serialization for all five entry kinds:
  `goal_terminal`, `loop_iteration`, `turn_verdict`, `goal_armed`, `session_outcome`.
- Durable append-only JSONL persistence via `appendLearningEntry` (default
  `.term/goal-loop/learnings.jsonl`), best-effort so I/O failures never break a goal or loop.
- Runtime integration in `src/runtime/controller.ts`: `appendLearning` writes entries at terminal goal
  transitions, landed loop iterations, evaluated turns and goal-arming; `readLearningEntriesTail` feeds
  `src/core/outcome-telemetry.ts` for the recent-learnings context.
- Configuration in `src/core/config.ts`: `learning.enabled` / `learning.path` (with the
  `OPENCODE_GOAL_LEARNING_LOG` and `OPENCODE_GOAL_LEARNING_LOG_PATH` env overrides), defaulting to enabled.
- Coverage in `test/learning-log.test.ts` plus controller-level emission tests.

## Original objective (historical, 2026-11-20)

Treat every turn, session, loop, and goal as an opportunity to log what happened, learn from it, and improve
the system for next time. Iteration 1 implemented the durable learning/outcome journal described above.
Per-turn entries were originally listed as deferred; they are now emitted too.
