# Universal Improvement Pass

Improve clarity, consistency, and performance in this project without changing intended behavior unless tests or specification require it. Treat this as the canonical method for the improvement-pass family. Map the layout, modules, hot paths, dependencies, docs, and configuration first, then identify the build and test commands and any project rules. Work in small, scoped units, run the checks after each one, and keep generated artifacts current. Choose the smallest safe fix when something is ambiguous, and record follow-ups rather than pausing.

- Remove proven dead or redundant items in small, independently mergeable changes.
- Unify error and logging vocabularies, config parsing, and import style across modules.
- Optimize measured hot paths with before and after evidence, not guesses.
- Preserve load-bearing guards and never skip, weaken, or delete tests.
