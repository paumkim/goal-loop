# API and Config Contract Check

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Verify that providers and consumers of a contract still agree: endpoints,
events, schemas, CLI flags, configuration keys, and feature flags.

## Before acting
- Discover the source of truth for contracts: type definitions, schemas,
  generated clients, config samples, and docs in the current repository.
- Identify how generated files are produced and which files must not be
  hand-edited.

## Steps
1. **Pick one contract** and name its source of truth.
2. **Enumerate both sides:** list every producer and consumer, with required and
   optional fields, defaults, allowed values, and versioning rules.
3. **Compare:** look for renamed or removed fields, changed defaults, new enum
   values consumers do not handle, missing validation, and docs that disagree
   with code.
4. **Fix drift at the source:** update the source of truth first, then regenerate
   derived files with the repository's generator. Never hand-edit generated code.
5. **Protect it:** add or update a contract test where the project supports one.
6. **Migrate if needed:** if a breaking change is required, keep old consumers
   working through a documented migration or versioned path.

## Rules
- Be version-aware; do not assume consumers upgrade at the same time.
- Do not print secret values from configuration or environment samples.
- Do not invent fields or endpoints; derive everything from existing files.
- Keep sample config and documentation aligned with the real schema.

## Verify
- Run the generator, typecheck, and contract tests; paste quoted output.
- Confirm source-of-truth and generated files are consistent in the diff.
- Show that each drift item is fixed or recorded with a `file:line` reference.

## Report
- Contract and source of truth:
- Producers and consumers checked:
- Drift found and resolution:
- Checks with quoted output:
