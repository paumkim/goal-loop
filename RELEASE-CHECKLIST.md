# Release checklist — @el4cteo/opencode-goal 1.1.0

Status as of 2026-11-15: the `/goal-loop-<N>` feature (Workstream AY, merge f26a758) and the cli-installer
work (Workstream AZ, merge 9cb0678) are on `dev` only. Nothing below has been done yet. Do not merge your own
lease into `dev`; this checklist runs after `dev` is green and a release is explicitly approved.

## What is on dev, not released (evidence)

- `dev` @ `f844355` (2026-11-15), 351+ commits ahead of `origin/main`.
- Feature merge `f26a758` (2026-11-15 16:45) — not contained in `main`, `origin/main`, `upstream/main`, or tag `v1.0.1` (`git merge-base --is-ancestor f26a758 <ref>` fails for each).
- `main` (local, `1f00860`, ahead of `origin/main`) and `origin/main` @ `3cc7d7f` = tag `v1.0.1` (2026-10-15). Feature absent.
- npm: latest is `1.0.1` (published 2026-10-15). The published tarball has 25 files and zero occurrences of `goal-loop` (verified by downloading `@el4cteo/opencode-goal@1.0.1` and grepping).
- GitHub default branch (`origin` HEAD → `main` = `3cc7d7f`): `opencode plugin add github:paumkim/opencode-goalv2` at the default ref installs the v1.0.1 code without the feature.
- No release artifacts exist: `.github/workflows/` has only `check.yml` (build/test, no publish), no CHANGELOG file, no release tags after `v1.0.1`. Docs changelog page exists (`docs/changelog.html`) and is git-derived.
- The locally installed plugin is loaded from this repository (`~/.config/opencode/opencode.jsonc`, "Local clone of the goal plugin"), so local sessions run dev code — that is not a release.

## Steps to ship 1.1.0

1. **Claim the release worktree.** `coordinator claim release-1.1.0 --agent orchestrator --paths package.json,SPEC.md,docs`. Never edit `dev` directly.
2. **Bump** `package.json` `version` `1.0.1` → `1.1.0` (semver minor: new feature, no breaking changes). Confirm `bin` still points at `bin/opencode-goal.mjs` (ships the installer from Workstream AZ).
3. **Refresh docs**: `bun scripts/docs-watch.ts once` so stamps reflect the release commit; changelog page updates itself from `git log`.
4. **SPEC.md honesty gate**: run `npm pack --dry-run --json` (must list the new/changed shipped files; today 41) and update the `<!-- spec-check files=N tests=N -->` marker in the same commit. `bun run check` must stay green (it runs `spec-check`).
5. **Commit** on `wt/release-1.1.0`, `coordinator submit`. Coordinator merge-next lands it on `dev` (do not self-merge).
6. **Land on `main`**: only via the sanctioned path for this repo (open a `dev` → `main` merge through the coordinator/owner's process). Tag `v1.1.0` on the merge commit on `main`. Push `main` and the tag to `origin`.
7. **Publish**: `npm publish` (prepublishOnly runs compile + test). Verify `npm view @el4cteo/opencode-goal version` prints `1.1.0` and `npm view @el4cteo/opencode-goal dist-tags` points `latest` at it. Whoever publishes needs npm 2FA/rights for `@el4cteo/opencode-goal` — confirm before starting; if the fork cannot publish under `@el4cteo`, stop and resolve ownership with the maintainer (alternative: publish the fork's own scope, but that is a product decision, not a default).
8. **Verify the GitHub install path**: after `main` and `v1.1.0` are pushed, run from a scratch directory `opencode plugin add github:paumkim/opencode-goalv2@v1.1.0` (or the ref documented in `docs/install.html`) and confirm the installed ref contains `parseGoalLoopDirective` (e.g. `grep -r "goal-loop-188" node_modules/... | head`), and that `/goal-loop-3 test objective` arms a loop with `max="3"`. Note: `docs/install.html:12` currently advertises `opencode plugin add github:EL4CTEO/opencode-goal` (the upstream repo) — decide which repo the release ships from and make the docs match reality.
9. **Smoke-test the published package**: `npm i -g @el4cteo/opencode-goal@1.1.0` in a scratch prefix, `opencode-goal status`, `opencode-goal install --dry-run`, then one real `/goal-loop-2` cycle under a probe session (`OPENCODE_GOAL_PROBE=1` for anything touching live plugin storage).
10. **Verify the npm tarball** contains the feature and installer: `npm pack @el4cteo/opencode-goal@1.1.0` → `tar tzf` lists `src/core/parse.ts` with `parseGoalLoopDirective` (grep after extract) and `bin/opencode-goal.mjs`.
11. **Do not** rebuild or replace the installed binary at `~/.opencode/bin/opencode`; `opencode plugin add` paths above are config-level only.
12. **Close the loop**: mark the release lease done, update SPEC.md release notes, and record the tag/provenance in the changelog.

## Pre-release gate (this branch)

- `bun run check` green on the merged tree with these fixes: raw-prompt `maxConditionChars` enforcement (review finding 1), sanitized `invalidCount` echo (finding 3), readable empty-count warning (finding 5), per-iteration toast shows the effective cap (finding 2), legacy records render a real fallback max in `/goal` status (finding 4). Findings 6–8 remain open (documented as acceptable or folded into a hygiene iteration).
- Fresh `bun run check` output must be attached to the release PR before step 6.
