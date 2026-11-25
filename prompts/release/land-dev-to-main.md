# Land the Integration Branch to the Release Branch

Promote the integration branch to the release branch using the repository's sanctioned release process, from a clean checkout. Confirm you are on the integration branch with a clean working tree and release authority before starting.

- Run the required pre-release checks and fix any issues through the normal workflow, not by bypassing gates.
- Run the sanctioned release command instead of merging or rewriting branches by hand.
- If a gate or dirty tree blocks it, stop, report the failure, fix the cause, and rerun from the top.
- After landing, verify branch positions, any snapshot or tag, rebuilt artifacts, installed entrypoints, and a version or help smoke check.

Leave foreign or unrelated changes untouched, and never push, retag, or change user config unless the sanctioned flow does it. Call it landed only when the release command reports success and the post-landing checks pass.
