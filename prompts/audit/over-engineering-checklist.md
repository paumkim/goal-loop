# Audit for Over-Engineering and Messy Code

Scan this repository for over-engineering and messy code, then record findings in a persistent checklist future sessions can reuse. Gather evidence rather than refactoring, and fix nothing unless a fix is its own verified unit.

- Flag abstractions, hooks, flags, or machinery with a single caller or no current use.
- Flag dead code, duplicated logic, stale comments, and hand-edited generated files.
- Flag complexity hot spots, magic values, swallowed errors, and copy-paste drift.
- Flag performance work with no measurement or load-bearing reason.

Separate confirmed findings from suspicions, assign severity, and leave safety checks and tests intact. Update an existing checklist in place instead of replacing it.
