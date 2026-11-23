# Merge Coordinator Work into Release and Rebuild

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Integrate previously completed coordinator-system work from the integration branch into the release branch, update build/packaging if needed, and rebuild/verify artifacts.

## Safety first
- Confirm you are on the integration branch (or a branch off it), not the release branch. Do not work on the release branch directly.
- Follow the repository's coordinator/release rules. Promotion to the release branch must happen only via the designated coordinator/integration or release process.
- Do not touch unrelated uncommitted changes. Stage explicit paths only.

## Tasks
1. **Identify the work:** locate the coordinator-related commits/branches/work and assess what must be included.
2. **Prepare integration:** create or use the appropriate integration branch/worktree as required by repo workflow.
3. **Verify before landing:** run lint, typecheck, and tests for affected packages/areas (at minimum the coordinator package and any touched UI/runtime areas). Record outputs. Report pre-existing failures with evidence; do not hide them.
4. **Build/packaging:** ensure workspace/build scripts include the coordinator package as needed. Rebuild using the repo's documented build command and verify install targets/symlinks remain correct.
5. **Merge to release:** use only the sanctioned coordinator/release path. Preserve existing branch-safety rules and update safety/docs to accurately describe the release process if needed.
6. **Documentation:** update coordinator and safety documentation with the correct release flow and agent responsibilities.
7. **Final verification:** confirm clean working state as required, release branch contains the expected commits, and rebuilt binaries/tools run and report expected version/help. Provide commit hashes and quoted command output.

## Report
State what was merged, checks run, build/symlink verification, final branch/log evidence, and any blockers. Use "landed" only with evidence.
