# Dependency dedupe audit

Scope: `package.json` manifests and `bun.lock` at the repository root.

Method: parse every `packages` entry, group by package name, compare resolved versions,
then inspect each requesting edge to classify the blocker.

## Result

- Distinct package names resolved at more than one version: **15**
- Same-major duplicates eligible for a fix: **0**
- Fixes applied: **0**
- Skips: **15** (all major-version gaps)

Regeneration from the repo root: `bun install --lockfile-only` -> `Done! Checked 340 packages (no changes)`; `git diff -- bun.lock` empty.

No local `file:`/`link:`/`workspace:` aliases exist in the lockfile, and no manifest edit was
needed, so no new dependencies, major bumps, or behavior changes were introduced.

## Skips

### `@smithy/util-buffer-from` — 2.2.0, 4.5.2 (majors 2, 4)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@aws-crypto/sha256-browser/@smithy/util-utf8` (dependencies) requests `^2.2.0` [range]
- `@aws-crypto/util/@smithy/util-utf8` (dependencies) requests `^2.2.0` [range]
- `@smithy/util-utf8` (dependencies) requests `^4.2.2` [range]

### `@smithy/util-utf8` — 2.3.0, 4.2.2 (majors 2, 4)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@aws-crypto/sha256-browser` (dependencies) requests `^2.0.0` [range]
- `@aws-crypto/util` (dependencies) requests `^2.0.0` [range]
- `@opencode/ai` (dependencies) requests `4.2.2` [exact pin]

### `balanced-match` — 1.0.2, 4.0.4 (majors 1, 4)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `babel-plugin-module-resolver/glob/minimatch/brace-expansion` (dependencies) requests `^1.0.0` [range]
- `brace-expansion` (dependencies) requests `^4.0.2` [range]

### `brace-expansion` — 2.1.7, 5.0.12 (majors 2, 5)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `babel-plugin-module-resolver/glob/minimatch` (dependencies) requests `^2.0.1` [range]
- `minimatch` (dependencies) requests `^5.0.5` [range]

### `entities` — 6.0.1, 7.0.1 (majors 6, 7)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@opentui/solid` (dependencies) requests `7.0.1` [exact pin]
- `parse5` (dependencies) requests `^6.0.0` [range]

### `glob` — 13.0.5, 9.3.5 (majors 9, 13)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@npmcli/map-workspaces` (dependencies) requests `^13.0.0` [range]
- `@npmcli/package-json` (dependencies) requests `^13.0.0` [range]
- `@opencode/util` (dependencies) requests `13.0.5` [exact pin]
- `babel-plugin-module-resolver` (dependencies) requests `^9.3.3` [range]
- `cacache` (dependencies) requests `^13.0.0` [range]

### `isexe` — 2.0.0, 4.0.0 (majors 2, 4)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@npmcli/git/which` (dependencies) requests `^4.0.0` [range]
- `@npmcli/promise-spawn/which` (dependencies) requests `^4.0.0` [range]
- `node-gyp/which` (dependencies) requests `^4.0.0` [range]
- `which` (dependencies) requests `^2.0.0` [range]

### `lru-cache` — 10.4.3, 11.5.3, 5.1.1 (majors 5, 10, 11)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@babel/helper-compilation-targets` (dependencies) requests `^5.1.1` [range]
- `@npmcli/agent` (dependencies) requests `^11.2.1` [range]
- `@npmcli/arborist` (dependencies) requests `^11.2.1` [range]
- `@npmcli/git` (dependencies) requests `^11.2.1` [range]
- `babel-plugin-module-resolver/glob/path-scurry` (dependencies) requests `^10.2.0` [range]
- `cacache` (dependencies) requests `^11.1.0` [range]
- `hosted-git-info` (dependencies) requests `^11.1.0` [range]
- `path-scurry` (dependencies) requests `^11.0.0` [range]

### `minimatch` — 10.2.5, 8.0.7 (majors 8, 10)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@npmcli/arborist` (dependencies) requests `^10.0.3` [range]
- `@npmcli/map-workspaces` (dependencies) requests `^10.0.3` [range]
- `@opencode/util` (dependencies) requests `10.2.5` [exact pin]
- `@tufjs/models` (dependencies) requests `^10.1.1` [range]
- `babel-plugin-module-resolver/glob` (dependencies) requests `^8.0.2` [range]
- `glob` (dependencies) requests `^10.2.1` [range]
- `ignore-walk` (dependencies) requests `^10.0.3` [range]

### `minipass` — 3.3.6, 4.2.8, 7.1.3 (majors 3, 4, 7)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@isaacs/fs-minipass` (dependencies) requests `^7.0.4` [range]
- `babel-plugin-module-resolver/glob` (dependencies) requests `^4.2.4` [range]
- `babel-plugin-module-resolver/glob/path-scurry` (dependencies) requests `^5.0.0 || ^6.0.2 || ^7.0.0` [range]
- `cacache` (dependencies) requests `^7.0.3` [range]
- `fs-minipass` (dependencies) requests `^7.0.3` [range]
- `glob` (dependencies) requests `^7.1.2` [range]
- `make-fetch-happen` (dependencies) requests `^7.0.2` [range]
- `minipass-collect` (dependencies) requests `^7.0.3` [range]
- `minipass-fetch` (dependencies) requests `^7.0.3` [range]
- `minipass-flush` (dependencies) requests `^3.0.0` [range]
- `minipass-pipeline` (dependencies) requests `^3.0.0` [range]
- `minipass-sized` (dependencies) requests `^7.1.2` [range]
- `minizlib` (dependencies) requests `^7.1.2` [range]
- `npm-registry-fetch` (dependencies) requests `^7.0.2` [range]
- `pacote` (dependencies) requests `^7.0.2` [range]
- `path-scurry` (dependencies) requests `^7.1.2` [range]
- `ssri` (dependencies) requests `^7.0.3` [range]
- `tar` (dependencies) requests `^7.1.2` [range]

### `path-scurry` — 1.11.1, 2.0.2 (majors 1, 2)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `babel-plugin-module-resolver/glob` (dependencies) requests `^1.6.1` [range]
- `glob` (dependencies) requests `^2.0.0` [range]

### `semver` — 6.3.1, 7.8.5 (majors 6, 7)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@babel/core` (dependencies) requests `^6.3.1` [range]
- `@babel/helper-compilation-targets` (dependencies) requests `^6.3.1` [range]
- `@babel/helper-create-class-features-plugin` (dependencies) requests `^6.3.1` [range]
- `@npmcli/arborist` (dependencies) requests `^7.3.7` [range]
- `@npmcli/config` (dependencies) requests `^7.3.5` [range]
- `@npmcli/fs` (dependencies) requests `^7.3.5` [range]
- `@npmcli/git` (dependencies) requests `^7.3.5` [range]
- `@npmcli/metavuln-calculator` (dependencies) requests `^7.3.5` [range]
- `@npmcli/package-json` (dependencies) requests `^7.5.3` [range]
- `node-gyp` (dependencies) requests `^7.3.5` [range]
- `npm-install-checks` (dependencies) requests `^7.1.1` [range]
- `npm-package-arg` (dependencies) requests `^7.3.5` [range]
- `npm-pick-manifest` (dependencies) requests `^7.3.5` [range]

### `undici` — 6.29.1, 8.12.2 (majors 6, 8)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@effect/platform-node` (dependencies) requests `^8.11.2` [range]
- `node-gyp` (dependencies) requests `^6.25.0` [range]

### `which` — 2.0.2, 6.0.1 (majors 2, 6)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@npmcli/git` (dependencies) requests `^6.0.0` [range]
- `@npmcli/promise-spawn` (dependencies) requests `^6.0.0` [range]
- `cross-spawn` (dependencies) requests `^2.0.1` [range]
- `node-gyp` (dependencies) requests `^6.0.0` [range]

### `yallist` — 3.1.1, 4.0.0, 5.0.0 (majors 3, 4, 5)
Blocker: major-version gap — the competing ranges are in different majors, so moving a
consumer to the higher version would be a major bump (out of scope).

- `@babel/helper-compilation-targets/lru-cache` (dependencies) requests `^3.0.2` [range]
- `minipass-flush/minipass` (dependencies) requests `^4.0.0` [range]
- `minipass-pipeline/minipass` (dependencies) requests `^4.0.0` [range]
- `tar` (dependencies) requests `^5.0.0` [range]

