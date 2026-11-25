# Add a CI Check

Add a CI job to this project that enforces `<check>` (a test suite, lint,
typecheck, build, or generated-file freshness check). Follow the repo's existing
workflow conventions for runners, triggers, and dependency install from the
committed lockfile, and reuse its caching setup. Prove the check passes locally
first and fix genuine failures rather than weakening it. Validate the CI config
with the tool the repo provides.

Note the new check in the contributing docs. I should be able to confirm the job
is scoped to CI config and docs, with no new secrets or unresolved variables.
