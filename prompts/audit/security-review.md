# Security Review

Review this codebase for security risks and fix only the issues you can prove. Trace untrusted input to its sinks and check authentication, access boundaries, secrets, dependency hygiene, and insecure defaults.

- Find injection, traversal, unsafe execution, SSRF, and deserialization flaws in input handling.
- Check authorization, tenant boundaries, and privilege escalation paths.
- Find hardcoded credentials, leaked secrets, and overly broad permissions without printing secret values.
- Review dependency audits, debug modes, and weak transport, cookie, or timeout settings.
- Add a focused regression test for each confirmed issue.

Separate confirmed issues from hardening ideas, prioritize by exploitability and impact, and never weaken a control to silence a warning.
