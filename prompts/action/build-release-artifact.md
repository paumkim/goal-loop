# Build and Smoke-Test a Release Artifact

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Build the repo's real distributable and prove the artifact itself runs.

## Before acting
- Find the project's build/release commands in its scripts, manifests, or release
  docs. Identify the artifact type (binary, package, bundle, container image) and
  where build output is written.
- Check that build outputs are ignored by git before generating them.

## Steps
1. **Clean baseline:** make sure the working tree has no unintended changes and
   dependencies are installed from the lockfile.
2. **Build:** run the repo's own build/release command with production settings.
   Do not substitute a dev build unless the repo has no release target (say so).
3. **Inspect:** list the artifact(s), size, and contents where meaningful. Confirm
   it matches the expected type and platform.
4. **Smoke-test:** run or launch the produced artifact directly — not the source
   tree — and verify a real behavior (version output, health request, or a tiny
   workflow). For an image, run a container and probe it.
5. **Cleanup:** remove or ignore generated artifacts so the tree stays clean.

## Rules
- Do not commit build output or generated bundles unless the repo already tracks them.
- Do not claim the release works unless the artifact (not the dev server) was exercised.
- Keep secrets out of build args and logs.

## Verify
- Paste quoted build output and the final artifact listing (`file`/`ls -lh`).
- Paste quoted smoke-test output from the artifact itself.
- Show `git status --short` is clean after cleanup.

## Report
- Build command used:
- Artifact path, type, and size:
- Quoted smoke-test evidence:
- Issues found (max 3):
