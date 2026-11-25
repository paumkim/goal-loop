# Error Handling Audit

Audit <scope> in this project for error-handling defects and fix the ones you find. Look for swallowed failures, empty or broad catches, ignored promises, catch blocks that only log, and silent fallbacks. Standardize messages and codes to the project's convention, adding operation and target context without logging secrets. Keep stack traces in logs and show users plain-language errors. Add a focused test for each failure path you change, and tell me which findings you fixed and which you left alone.
