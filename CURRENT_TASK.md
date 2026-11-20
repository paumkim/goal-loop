# CURRENT_TASK — continuous improvement logging (iteration 1 of 5)

## Objective (constant)
Treat every turn, session, loop, and goal as an opportunity to log what happened, learn from it, and improve the system for next time.

## Interpretation (iteration 1)
The goal-loop system already records loop history, verdict history, and uses an improvement backlog for planning, but it lacks a durable, append-only **learning journal** that explicitly captures outcomes and lessons at key boundaries in a form that persists across sessions/goals and can be reviewed to improve future work.

This iteration implements a first concrete slice: a persistent learning/outcome log written by the runtime for **goal terminal outcomes** and **completed loop iterations**. Each entry records what happened (condition/objective, status/verdict, reason, metrics, evidence refs like sha) and a "lesson/improvement" takeaway derived from available evidence, so every completed loop and goal leaves behind a learnable trace.

Scope boundaries (deferred to later iterations): automatic per-turn journal entries for every evaluated turn, automatic backlog mutation from learnings, and richer UI surfacing beyond persistence.

## Acceptance criteria
1. **Core learning-log module**: a pure module (e.g. `src/core/learning-log.ts`) defines structured learning entry types and builders for:
   - goal terminal outcomes (achieved/impossible/cleared/failed), and
   - completed loop iterations (landed entries).
   Entries are JSON-serializable, include timestamp, kind, session/goal identifiers, condition/objective context, outcome fields (status/verdict/reason), metrics (turns/toolCalls/elapsed/spend/sha where available), and a `lesson` string capturing what to learn/improve next time (derived from summary/reason/outcome without fabricating evidence).
2. **Durable append-only persistence**: the runtime appends one JSONL record per event to a learning log file. Default path is `.term/goal-loop/learnings.jsonl` under the goal's working directory (falling back sensibly when no directory is known). Writes are best-effort and must never break goal/loop execution on I/O failure.
3. **Integration points**:
   - A terminal goal transition (`finish`) emits a goal-outcome learning entry.
   - A loop iteration that is recorded/landed (successful advance/end with a loop entry) emits a loop-iteration learning entry.
4. **Configuration**: learning-log behavior is configurable via plugin options/env in line with existing config patterns (at minimum an on/off toggle and/or path override) with safe defaults that enable durable logging.
5. **Tests**: automated tests cover the core entry builders/serialization and the runtime emission behavior for at least goal terminal outcomes and loop iteration outcomes.
6. **Verification**: `bun run check` passes in the worktree (including typecheck, tests, compile/build checks as enforced by the repo), and test output demonstrates the new learning-log behavior.

## Verification
- `cd <worktree> && bun run check` exits 0; tail recorded in transcript.
- Targeted tests for the new learning-log module and integration points pass.
- Changes committed on `wt/<slug>` branch and submitted via coordinator.

## Implementation notes
- Follow existing patterns: pure core helpers, best-effort I/O (see file-log), controller/runtime integration, config in `src/core/config.ts`.
- Do not fabricate evidence in lessons; derive from known record/entry fields.
- Keep the canonical root `SPEC.md` unchanged except only if required by spec-check policy for shipped behavior (update carefully if needed).
