# Apply a Database Migration Safely

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Author a schema migration, apply it to a local database, and prove it rolls back.

## Before acting
- Discover the migration tool, schema/migration directory, naming convention, and
  the commands to apply and revert migrations from the repo's docs/scripts.
- Identify the target change and its data implications (defaults, nullability,
  backfill, table locks). Confirm how the app reads/writes the affected schema.

## Steps
1. **Generate:** create the migration with the repo's generator (or follow its
   hand-written convention). Use the correct next revision/name.
2. **Review the SQL:** read the generated up/down SQL. Make it reversible, avoid
   destructive operations without an explicit backfill, and note any lock risk.
3. **Apply:** run the migration against a disposable local database. Confirm the
   schema changed as intended.
4. **Verify both directions:** run `up`, inspect the result, run `down`, inspect
   again, then re-run `up` to leave the DB in the migrated state.
5. **Update code:** adjust models/queries only as required by the schema change and
   add or update tests that exercise the new shape.

## Rules
- Never point at a production or shared database; use a local/disposable one.
- Do not make irreversible changes (drop column/table) without a reviewed backfill
  plan stated explicitly.
- Do not print real connection strings or credentials.

## Verify
- Paste quoted `up`/`down`/`up` output and a schema inspection before and after.
- Run the project's tests/typecheck; paste quoted output.
- Show `git diff --stat` and confirm migration + code + tests are scoped to the change.

## Report
- Migration file and revision:
- SQL summary and reversibility:
- Quoted up/down evidence:
- Risks or follow-ups (max 3):
