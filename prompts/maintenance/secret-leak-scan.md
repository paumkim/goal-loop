# Secret Leak Scan

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Check the current repository's working tree for accidentally committed or added
credentials, then remove them safely. Do not rewrite git history in this pass.

## Before acting
- Identify tracked source/config/docs and discover the project's secret
  conventions (env files, vault usage, sample configs) from its own docs and
  ignore rules.
- Never print full secret values into logs or reports. Show file and line only.

## Scan
Search tracked files (skip dependencies and build output) for:
- private keys and certificate blocks (`BEGIN ... PRIVATE KEY`), token prefixes
  (for example `sk-`, `ghp_`, `AKIA`), bearer tokens, connection strings with
  embedded passwords, and `password`/`secret`/`api_key`/`token` assignments
  holding literal values;
- tracked credential files or local env files (`*.env`, `.env.*`,
  `credentials.json`, `.npmrc` with auth tokens).

## Triage
- **Real secret in a tracked file:** remove the literal from the working file,
  replace it with an env-var/config reference, and flag the value for rotation.
- **Placeholder/example value:** keep it and note it is a sample, not a secret.
- **Required literal (test fixture or doc example):** keep it and justify with
  `file:line`.
- **Tracked env/credential file:** add a precise ignore rule and stop tracking it
  going forward (`git rm --cached`). Never delete someone's local copy.

## Rules
- Do not amend or rewrite history. If a secret appears in `git log -S`, report the
  exposure with commit hashes; rotation and history scrubbing are explicit
  follow-ups, not actions here.
- Stage explicit paths only and keep runtime/live state uncommitted.

## Verify
- Re-run the scan: no real secrets remain in tracked working files.
- Show `git status --short`, `git diff --stat`, and any ignore rule you added.
- Provide a rotation checklist and any history-scrub follow-up as reported items,
  not actions taken.
