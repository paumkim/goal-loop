# Release checklist — opencode-goalv2 1.1.0

Status as of 2026-11-16. Complete as shipped: this is a GitHub-only release. The npm registry publish is
not part of the 1.1.0 release (see step 7, skipped by maintainer decision). The release ships from `aff3a49`
(the merge of the docs release lease into `dev`), tagged in git as `v1.1.0` and published as a GitHub
release; `dev` has since moved past it (proof session merged `3011b6a`) and is not the content of the 1.1.0
artifact.

What is shipped and verified:

- `v1.1.0` tag on `aff3a49` pushed to `origin`; GitHub release `paumkim/opencode-goalv2/releases/tag/v1.1.0`
  carries `opencode-goalv2-1.1.0.tgz` (bundle of 41 files, `shasum 908fb7ce85f8c4555c842648b48583e5682d818e`).
- The tarball installs and runs: anonymous download md5-identical to the packed artifact; `npm i -g` into a
  scratch prefix; `opencode-goal --version` prints `opencode-goal 1.1.0`; `install --dry-run` works in a scratch scope.
- `bun run e2e` against a detached export of the release tree: goal set and achieved in 1 turn,
  evaluator-verified (`status: achieved`).
- GitHub install route documented and verified: `opencode plugin add github:paumkim/opencode-goalv2#v1.1.0`
  (scratch config) — registers the specifier in the global config.
- npm-registry journey rehearsed end-to-end with the published upstream package (`@el4cteo/opencode-goal@1.0.1`)
  in a scratch config + cold `XDG_CACHE_HOME`: `opencode plugin add` resolved it from npmjs.org into
  `<cache>/opencode/npm/@el4cteo/opencode-goal@latest/<hash>/node_modules/...`, and a fresh standalone
  `opencode serve` loaded it per location
  (`loading plugin id=@el4cteo/opencode-goal entrypoint=file:///<cache>/opencode/npm/@el4cteo/opencode-goal@latest/.../index.ts`).
  The machinery `opencode-goalv2` will use once it is on the registry is proven working on this machine.
- `npm publish --access public --dry-run` from the `v1.1.0` checkout: green (prepublishOnly compile+test pass,
  41 files) and prints `+ opencode-goalv2@1.1.0` (dry-run). `npm view opencode-goalv2` returns 404 (name free).
- `npm whoami` on this machine now prints `paukim` (user ran `npm login` on 2026-11-16).

Not pending anything. The npm publish was attempted on 2026-11-16 and rejected with `403 E403` (the
`npm login` session token cannot publish; npm requires an account OTP or a bypass-2fa granular token).
Maintainer decision on 2026-11-16: drop the registry publish from the 1.1.0 release. The canonical install
is the GitHub one — see README and `docs/install.html`. If a registry publish is ever wanted later, the
unblock is unchanged: `npm publish --access public --otp=<code>` or a granular token with bypass-2fa;
`npm publish --access public --dry-run` from the `v1.1.0` tag is green and the package passes the gate.
The v1.1.0 installer writes the bare npm specifier — fixed on `dev` in Workstream BF (registers the
GitHub specifier; uninstall migrates v1.1.0-installed configs), ships in the next release.

## What is on dev, not released (evidence)

- `dev` @ `831dfd5` (2026-11-16), 294 commits ahead of `origin/main` (`main` @ `1f00860`) — the count drifts by one coordinator merge per merge; measure with `git rev-list --count origin/main..dev`.
- Feature merge `f26a758` (2026-11-15 16:45) — not contained in `main`, `origin/main`, `upstream/main`, or tag `v1.0.1` (`git merge-base --is-ancestor f26a758 <ref>` fails for each).
- `main` and `origin/main` are both @ `1f00860` (2026-11-15); main is not ahead of the remote. It was merged from dev on 2026-11-15 in two `merge dev into main` commits, so it carries the v1.1.0-era feature work merged into dev earlier that month (including the goal-loop merges), but it does NOT contain the `v1.1.0` tag (`aff3a49`) and is ~294 commits behind dev (`git rev-list --count origin/main..dev`).
- npm: latest is `1.0.1` (published 2026-10-15). The published tarball has 25 files and zero occurrences of `goal-loop` (verified by downloading `@el4cteo/opencode-goal@1.0.1` and grepping).
- GitHub default branch (`origin` HEAD → `main` @ `1f00860`): `opencode plugin add github:paumkim/opencode-goalv2` at the default ref now installs the v1.1.0-era feature work merged on 2026-11-15 (it contains the goal-loop feature), but it is NOT the released `v1.1.0` artifact — it lacks the `v1.1.0` tag content (the installer/`PLUGIN_SPEC` work, Workstream BF and later) and is not dev either. The documented, verified install remains the `#v1.1.0` specifier; the default-branch ref is unsupported and untested as an install source.
- Release artifacts: `.github/workflows/` has only `check.yml` (build/test, no publish); no `CHANGELOG` file; the `v1.1.0` tag IS pushed to `origin` (annotated `f92d1af` → `aff3a49`) alongside `v1.0.1` — it just precedes the dev-only block above. Docs changelog page (`docs/changelog.html`) exists and is git-derived.
- The locally installed plugin is loaded from this repository (`~/.config/opencode/opencode.jsonc`, "Local clone of the goal plugin"), so local sessions run dev code — that is not a release.

## Steps to ship 1.1.0

1. **Claim the release worktree.** `coordinator claim release-1.1.0 --agent orchestrator --paths package.json,SPEC.md,docs`. Never edit `dev` directly.
2. **Bump** `package.json` `version` `1.0.1` → `1.1.0` (semver minor: new feature, no breaking changes). Confirm `bin` still points at `bin/opencode-goal.mjs` (ships the installer from Workstream AZ).
3. **Refresh docs**: `bun scripts/docs-watch.ts once` so stamps reflect the release commit; changelog page updates itself from `git log`.
4. **SPEC.md honesty gate**: run `npm pack --dry-run --json` (must list the new/changed shipped files; today 41) and update the `<!-- spec-check files=N tests=N -->` marker in the same commit. `bun run check` must stay green (it runs `spec-check`).
5. **Commit** on `wt/release-1.1.0`, `coordinator submit`. Coordinator merge-next lands it on `dev` (do not self-merge).
6. **Land on `main`**: only via the sanctioned path for this repo (open a `dev` → `main` merge through the coordinator/owner's process). Tag `v1.1.0` on the merge commit on `main`. Push `main` and the tag to `origin`.
7. **Publish** — SKIPPED (maintainer decision, 2026-11-16). Attempt on 2026-11-16 failed with `403 E403` (session token from `npm login` has no publish grant). Unblock one of two ways: (a) `npm publish --access public --otp=<code from your authenticator>`; (b) create a granular access token on npmjs.com with publish permission on `opencode-goalv2` and bypass 2fa, then `npm publish --access public`. Verify afterwards: `npm view opencode-goalv2 version` prints `1.1.0`, `npm view opencode-goalv2 dist-tags` points `latest` at it, then run the registry install journey check (step 8 analog with the new package). Note for the fork: this checklist's publish under `@el4cteo/opencode-goal` is superseded — the package ships as unscoped `opencode-goalv2` (the name every artifact now uses).
8. **Verify the GitHub install path** — DONE 2026-11-16 (scratch config; specifier registered). Originally: after `main` and `v1.1.0` are pushed, run from a scratch directory `opencode plugin add github:paumkim/opencode-goalv2@v1.1.0` (or the ref documented in `docs/install.html`) and confirm the installed ref contains `parseGoalLoopDirective` (e.g. `grep -r "goal-loop-188" node_modules/... | head`), and that `/goal-loop-3 test objective` arms a loop with `max="3"`. Note: `docs/install.html` now advertises the v1.1.0 GitHub route (`opencode plugin add github:paumkim/opencode-goalv2#v1.1.0`); the release ships from the `paumkim/opencode-goalv2` fork.
9. **Smoke-test the published package** — registry install path rehearsed with `@el4cteo/opencode-goal@1.0.1` (plugin add → cache layout → `opencode serve` loads it). Re-run against `opencode-goalv2@1.1.0` after step 7. Originally: `npm i -g @el4cteo/opencode-goal@1.1.0` in a scratch prefix, `opencode-goal status`, `opencode-goal install --dry-run`, then one real `/goal-loop-2` cycle under a probe session (`OPENCODE_GOAL_PROBE=1` for anything touching live plugin storage).
10. **Verify the npm tarball** contains the feature and installer: `npm pack @el4cteo/opencode-goal@1.1.0` → `tar tzf` lists `src/core/parse.ts` with `parseGoalLoopDirective` (grep after extract) and `bin/opencode-goal.mjs`.
11. **Do not** rebuild or replace the installed binary at `~/.opencode/bin/opencode`; `opencode plugin add` paths above are config-level only.
12. **Close the loop**: mark the release lease done, update SPEC.md release notes, and record the tag/provenance in the changelog.

## Pre-release gate (this branch)

- `bun run check` green on the merged tree with these fixes: raw-prompt `maxConditionChars` enforcement (review finding 1), sanitized `invalidCount` echo (finding 3), readable empty-count warning (finding 5), per-iteration toast shows the effective cap (finding 2), legacy records render a real fallback max in `/goal` status (finding 4). Findings 6–8 remain open (documented as acceptable or folded into a hygiene iteration).
- Fresh `bun run check` output must be attached to the release PR before step 6.

## Dev carries ongoing improvements that are NOT for public release yet (maintainer decision 2026-11-16)

- v1.1.0 remains the stable live artifact. Release steps (merge to main, tag, GitHub release, optional npm publish) are to be run only when the maintainer declares a major milestone.
- PLUGIN_SPEC is derived from package.json in dev, so a future release never ships a stale install pin.
