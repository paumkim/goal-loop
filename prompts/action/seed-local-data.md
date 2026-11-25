# Seed Deterministic Local Data

Add a repeatable seed or fixture generator for this project's local development
or tests. It should load a minimal but useful dataset into a disposable local
database using the repo's existing insert patterns, and it should be deterministic
and safe to run twice.

- Choose fixed identifiers and values so the output is reproducible.
- Cover core entities, their relationships, and useful edge cases.
- Expose a documented command and note it in the dev or README docs.
- Provide a clean or reset path so a failed run leaves no half-loaded state.
- Prove determinism by seeding two clean stores and showing the data matches.
