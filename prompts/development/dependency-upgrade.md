# Dependency Upgrade

Upgrade <package> to <version> in this project with a clean revert path if it fails. Use the smallest version bump that solves the need, and prefer the same major version unless there is a documented reason to cross it. Update the manifest and let the package manager regenerate the lockfile, never hand-editing it. Run install, typecheck, lint, and the full test suite, and adapt call sites for any breaking changes without silencing errors. If the upgrade needs unrelated behavior changes or cannot be verified, revert cleanly and report the blocking error.
