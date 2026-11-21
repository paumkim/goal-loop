# Security Review

Review the current codebase or change for security risks and fix only the issues
you can prove.

## Before acting
- Discover the project's threat surface from its code, config, and docs: entry
  points, auth, file/network/process boundaries, dependency management, and
  secret handling.
- Read repository security/contributor guidance if present. Follow existing
  disclosure or secret-handling rules.

## Review
1. **Inputs and boundaries:** trace untrusted input (HTTP, CLI, files, env,
   IPC, deserialized data) to sinks. Look for injection, path traversal, unsafe
   shell/exec, SSRF, unsafe deserialization, and missing validation.
2. **Auth and access:** check authentication, authorization, tenant boundaries,
   default-deny behavior, and privilege escalation paths.
3. **Secrets and data:** look for hardcoded credentials, tokens in logs/errors,
   overly broad file permissions, insecure temp files, and sensitive data in
   fixtures or docs. Never print secret values.
4. **Dependencies and config:** review dependency audit results, insecure
   defaults, debug modes, CORS/TLS/cookie settings, and missing timeouts/limits.
5. **Regression tests:** for each confirmed issue, add or identify a focused test
   that would catch it.

## Rules
- Report evidence with `file:line`; do not speculate without reading the code.
- Prioritize by exploitability and impact. Separate confirmed issues from
  hardening suggestions.
- Do not weaken security controls, silence scanners, or broaden permissions to
  "fix" a warning.
- Do not rewrite git history or expose secrets while remediating.

## Verify
- Reproduce or otherwise justify each confirmed finding. After a fix, run the
  relevant tests and security/audit commands; paste quoted output.
- Show `git diff --stat` for fixes and confirm scope is limited to the issue.

## Report
- Findings ordered by severity: `file:line`, impact, evidence, fix/status.
- Hardening suggestions (clearly labeled):
- Commands run and quoted output:
- Residual risks or items needing human judgment:
