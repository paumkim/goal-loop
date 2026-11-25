# Apply a Database Migration Safely

Add a schema migration for `<change>` and apply it to a disposable local
database. Generate the migration with the project's own tool and give it a
reversible up and down script, with a reviewed backfill before any destructive
change. Confirm the schema changes as intended, then run up, down, and up again
to prove it rolls back.

Update models and queries only where the new schema requires it, and add tests
for the new shape. I should end with the database in the migrated state and no
real credentials or connection strings in the output.
