# Env / Config Drift Check

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Reconcile the current repository's sample configuration with the configuration
the code actually reads.

## Before acting
- Discover the project's env/config mechanism and sample files (for example
  `.env.example`, `.env.sample`, `config.example.*`) from its docs and file layout.
- Never print real secret values. Show variable names and line numbers only.

## Check
- Find every configuration/environment variable the code reads (from source and
  config parsing) and every variable the sample files declare.
- Compare the two sets:
  - **Read in code, missing from sample:** add a documented, empty/placeholder
    entry with a short description.
  - **In sample, no longer read:** remove the stale entry, or flag it if it may
    be consumed externally.
  - **Renamed:** update the sample and any docs referencing the old name.
- Confirm ignore rules keep real env files untracked while sample files stay
  tracked.

## Fix
- Edit only sample config and its documentation. Update config parsing/docs only
  when the mismatch is a clear documentation bug with evidence.
- Do not change runtime behavior, make new variables required at startup as a
  side effect, or add real values.

## Verify
- Re-run the comparison: sample and code-read variable sets match, or list
  justified exceptions.
- Confirm real env files remain untracked (`git status --short --ignored` as needed).
- Show `git diff --stat` and the final sample-config content.
