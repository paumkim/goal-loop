# Dependency Upgrade

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Upgrade one dependency safely, with a clean revert path if it does not work.

## Before acting
- Discover the manifest, lockfile, package manager commands, and CI checks from
  the current project. Confirm which package manager owns the lockfile.
- Read why the upgrade is needed and record the currently installed version.

## Steps
1. **Pick one package.** Target the smallest version bump that solves the need;
   prefer the same major version unless there is a documented reason to cross it.
2. **Upgrade through the package manager.** Update the manifest and let the tool
   regenerate the lockfile. Never hand-edit a lockfile.
3. **Install and check.** Run install, typecheck, lint, and the full test suite.
   Capture new warnings and deprecation notices.
4. **Adapt call sites.** For breaking changes, update the code to the new API.
   Do not silence type errors, loosen assertions, or add compatibility shims
   that hide the change.
5. **Decide.** If the upgrade needs unrelated behavior changes or cannot be
   verified, revert the manifest and lockfile cleanly and report the blocking
   error output with the reason.

## Rules
- One dependency per unit; do not bundle unrelated bumps.
- Do not commit installed packages, build output, or caches.
- Do not change application behavior except what the new version requires.
- Keep generated and vendored files consistent with the manifest.

## Verify
- Show before and after versions with quoted commands.
- Paste install, typecheck, lint, and test output.
- Show the diff is limited to the manifest, lockfile, and required call sites.

## Report
- Package and version change:
- Reason:
- Checks with quoted output:
- If reverted: exact error and decision:
