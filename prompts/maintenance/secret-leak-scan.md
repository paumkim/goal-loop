# Scan for Secret Leaks

Check this repository's tracked files for accidentally added credentials and remove them safely from the working tree. Replace real secrets with env-var references and flag the values for rotation, while keeping placeholders and required test fixtures with a note. Add ignore rules for tracked env or credential files without deleting anyone's local copy, and never print full secret values. Report any exposure in history as a follow-up rather than rewriting history.

- Search source, config, and docs for private key blocks, token prefixes, and bearer tokens.
- Look for connection strings with passwords and literal password, secret, api_key, or token assignments.
- Flag tracked env and credential files for untracking and ignore rules.
