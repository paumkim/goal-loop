# Seed Deterministic Local Data

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Create a repeatable seed/fixture generator for local dev or tests and prove it is deterministic.

## Before acting
- Discover the data model/schema, the ORM or insert mechanism, and how existing
  fixtures/seeds are structured. Find the command used to load seed data locally.
- Define what a useful minimal dataset is (core entities, relationships, edge cases).

## Steps
1. **Design:** choose fixed identifiers and values so output is reproducible. Avoid
   timestamps or randomness unless the repo has a way to freeze them.
2. **Implement:** add the seed script/fixtures using the repo's insert patterns.
   Make it idempotent (safe to run twice) where the tooling allows.
3. **Run:** load the seed into a disposable local database or test store. Confirm
   the expected records and relationships exist.
4. **Prove determinism:** run the seed twice into clean stores and compare the
   resulting data (dump/hash/diff). Show the two results match.
5. **Wire it in:** expose a documented command (script, Makefile target, npm task)
   and note it in the dev/README docs.

## Rules
- Do not seed real or production data; use synthetic values.
- Do not print real credentials or connection strings.
- Do not leave a half-loaded state; provide a clean/reset path.

## Verify
- Paste quoted seed-run output and a data inspection (counts or sample rows).
- Paste quoted diff/hash output proving two runs produced identical data.
- Show `git diff --stat` and confirm docs expose the new command.

## Report
- Seed command and file locations:
- Entities and relationships seeded:
- Quoted determinism evidence:
- Risks or follow-ups (max 3):
