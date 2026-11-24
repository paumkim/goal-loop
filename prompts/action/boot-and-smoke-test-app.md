# Boot and Smoke-Test the App

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Take a clean checkout to a running app and prove it responds to a real request.

## Before acting
- Discover setup steps from the repo's README, manifests, lockfiles, env samples,
  and scripts. Do not guess package managers, ports, or config keys.
- Note which commands are safe to run locally and what a "healthy" response looks
  like (endpoint, expected status/body, log line).

## Steps
1. **Prepare:** install dependencies with the repo's own package manager using
   the committed lockfile. Create required env/config from samples, filling only
   non-secret local values. Never print real credentials.
2. **Start:** launch the app with the documented dev/start command. Capture the
   startup log and the actual address/port it bound to.
3. **Probe:** send a real request to a health or root endpoint (or invoke the
   CLI's `--help`/version). Confirm the expected status and body.
4. **Record:** write down the exact sequence of commands that worked, including
   any non-obvious prerequisite you had to discover.

## Rules
- Do not change application code; the goal is a working local run, not a refactor.
- Do not disable checks, use `--no-verify`, or bypass config to force a boot.
- Stop any background process you started when finished.

## Verify
- Paste quoted startup output and the quoted probe response (status + body).
- If setup docs were wrong or missing, say exactly what was wrong and what worked.

## Report
- Commands run, in order:
- Address/port actually used:
- Quoted health/probe output:
- Doc corrections needed (if any):
