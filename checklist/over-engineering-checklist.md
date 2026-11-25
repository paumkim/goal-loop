# Over-Engineering / Messy Code Checklist

Scan date: 2026-11-25 (UTC)
Base: `dev` @ `9d878dfb48d2b2760fa3b36eb6b8350951e8878e` (`chore(coordinator): record over-eng-checklist lease done after merge`)
Work branch: `wt/over-engineering-audit` (leased via `coordinator claim over-engineering-audit --agent build --paths checklist/`)
Method: read-only audit; no production behavior changed. Findings are listed, not fixed. `file:line` references are against the base commit.

## Scope inspected

- `src/core/**` (50 files), `src/runtime/**` (8 files)
- `src/index.ts`, `src/tui.tsx`, `src/rpc.ts`, top-level `src/*.tsx|ts` helpers
- `src/prompter/**`, `bin/**`, `install.sh`
- `scripts/**` (21 files), `packages/coordinator/**`, root config/docs, representative `test/**` sample
- Source total: ~61k lines across `src`, `bin`, `scripts`, `packages`, `test` (`wc -l`)

Excluded from findings: `node_modules/`, `dist/` (generated), `SPEC.md` / `SPEC-workstreams.md` (spec log), `.term/`, `worktree/`, lockfiles, snapshots. See **Exclusions** below.

## Findings by severity

| Severity | Count |
| --- | --- |
| High | 0 |
| Medium | 5 |
| Low | 3 |

## Confirmed findings

### Medium

- `src/tui.tsx:286` — **complexity hot spot (over-engineering)**. `Plugin.define({ setup(context) { ... } })` is a single ~1623-line function ending at the file's close (~1909 lines). It owns RPC wiring, ~10 signals, keybind/plumbing tables, status-dialog/history/menu state, and the whole render tree. Evidence: brace-counted span from `setup(context)` at :286 to EOF; `showStatusDialogInner` alone is 97 lines at :401. Impact: any UI change must load the entire function; state and side effects are shared implicitly. Recommended action: split setup into focused factory functions (state, RPC subscriptions, keybinds, render) that return typed slices; keep one thin composition root. Status: open.

- `src/index.ts:260` — **complexity hot spot (over-engineering)**. `setup(ctx)` is ~886 lines (:260–:1145), mixing startup scaffold, agent registration, ports onto the host, two long-lived child-session runtimes (`spawnEvaluator` :380, `planGoal` :550), commands, hooks, RPC, and update timers. Evidence: brace-counted span ; `createVerifier` at :164 is a separate 79-line helper. Impact: mixed responsibilities make hook-order regressions hard to localize. Recommended action: extract the evaluator/planner child runtime and the hook registration into modules; leave setup as composition only. Status: open.

- `src/runtime/controller.ts:1401` — **complexity hot spot (over-engineering)**. `private async evaluate(...)` runs ~195 lines (:1401 to next method `evaluationFailed` :2596) inside a 3187-line controller. Evidence: method boundary read at :1398–:1406 and `evaluationFailed` at :2596. Impact: turn evaluation, check verification, check-in timers, and verdict dispatch are interleaved in one method. Recommended action: split verification and timer/disarm logic into helpers on the controller; add a test per branch. Status: open.

- `packages/coordinator/bin/coordinator:1020` — **complexity hot spot (over-engineering)**. `do_merge_next()` is 588 lines (:1020 to next function `finish_merged_lease` :1608) in a 2149-line bash script with 51 functions. Evidence: `grep -c '^[a-zA-Z_][a-zA-Z0-9_]*()'` = 51; awk span for `do_merge_next` = 588 lines; dispatcher at :2112. Impact: merge lock handling, trial merge, gate, bookkeeping union, and worktree removal all live in one function — the safety-critical path is the hardest to review. Recommended action: factor lock acquisition, trial merge, and bookkeeping into separate functions with explicit inputs; add shell tests per phase. Status: open.

- `src/index.ts:380` and `src/index.ts:550` — **duplicate implementation (messy code)**. `spawnEvaluator` (:380–:469) and `planGoal`'s child runtime (:550–:632) repeat the same ~85-line lifecycle: cached child id per session, `background.noteInternal`, a Set add/remove, `AbortController`, an event-subscribe loop (identical shape at :421 and :597), a `Promise.race` of host prompt and a `done` promise, and a `finally` guard that evicts the child on failure/abort (near-identical predicates at :465 and :628). Evidence: read :385–:455 and :565–:615. Impact: two copies already differ (`failure` vs `childFailed`, `finish(answer)` vs `finish()`), so a fix to timeout/abort handling must be applied twice. Recommended action: extract one `spawnHostChild({ id map, set, agentId, timeout, onText })` helper and keep verdict/plan parsing at the call sites. Status: open.

### Low

- `src/index.ts:393,394,422,448,449,573,598,610` — **type escapes (messy code)**. Eight `as any` casts on `ctx.session.create`, `ctx.session.prompt`, and `(evt as any).data` for evaluator/planner children. Evidence: read :385–:455 and :565–:615. Impact: a field rename in `@opencode/*` fails at runtime instead of compile time. Recommended action: define a minimal structural type for event payloads and create/prompt options, cast once at the boundary. Status: open.

- `src/index.ts:272,283` — **double cast (messy code)**. `agent.name = "Evaluator" as unknown as typeof agent.name` and the planner equivalent bypass the host's literal-string type. Evidence: read :260–:290. Impact: typos in display names/types are not caught. Recommended action: narrow via the host's exported agent-name type or a single documented cast helper. Status: open.

- `src/core/dossier.ts:331` — **complexity hot spot (over-engineering)**. `buildLoopDossier(goal, nowMs)` is 130 lines that assemble multiple dossier sections in one function. Evidence: brace-counted span from :331; module is 460 lines. Impact: section ordering/formatting changes touch one long function. Recommended action: split by section into small builders composed at the end. Status: open.

## Verified non-findings (checked, no action)

- Zero-reference exports: a repo-wide scan of `src/**`, `scripts/**`, `packages/coordinator/**`, `test/**`, and root shims (including `.tsx` consumers) found **0** exported symbols with no reference. No dead-export cleanup needed.
- No `TODO` / `FIXME` / `HACK` / `XXX` markers in `src`, `bin`, `scripts`, `packages`.
- No commented-out code blocks; the few `// if ...` lines are explanatory prose.
- `bun run check` wiring gate: 26/26 config fields have a consumer, 20/20 env vars documented in README and config, 38/38 wiring checks passed — no speculative config knobs detected.
- Debug `console.*` uses (`src/index.ts:126,127`, `src/prompter/cli.ts:17,18`, `src/tui.tsx:56`) are intentional logger/CLI output, not leftovers.
- `scripts/positive-finite.ts`, `scripts/render-fixtures.ts`, `scripts/render-theme.ts` already de-duplicate shared render logic — do not "fix" again.

## Recurring patterns / watch list

- Long-lived orchestration files accrete branching and inline state: `src/tui.tsx` (1909 lines), `src/runtime/controller.ts` (3187), `src/index.ts` (1147), `packages/coordinator/bin/coordinator` (2149). Watch new guards for copy-paste drift and for new responsibilities added to `setup`/`evaluate`/`do_merge_next`.
- The two host-child runtimes in `src/index.ts` are the likeliest place for a timeout/abort fix to be applied to only one copy. Any change there should update both or extract the helper first.
- Wiring/invariant gates catch new config-field consumers; verify each new field still has a real consumer beyond the gate regex.
- TUI bind/keybind plumbing is repeated across dialogs; watch for drift in the chord tables.

## Exclusions

- `node_modules/**` — vendored dependencies.
- `dist/tui.js`, `dist/tui.d.ts` — generated by `bun run compile`; never hand-edit.
- `SPEC.md`, `SPEC-workstreams.md` — spec/log artifacts, not implementation.
- `.term/**`, `worktree/**`, `bun.lock`, snapshots — runtime state / generated / vendored.
- Root `index.ts`, `rpc.ts`, `tui.ts` — thin re-export shims, intentionally minimal.

## Baseline checks

Ran `bun run check` at the base commit before any edits (exit 0). Quoted output:

```text
 2457 pass
 0 fail
Ran 2457 tests across 114 files. [49.37s]
$ bun scripts/build.ts --check
ok: dist/tui.js matches a fresh build
$ bun scripts/build.ts
built dist/tui.js (365780 bytes)
$ bun scripts/tui-load-check.ts ./tui.ts
ok: loaded TUI plugin "goal-loop.tui"
$ bun scripts/docs-watch.ts check
docs freshness check passed
$ bun scripts/invariant-sweep.ts
invariant-sweep: ok (no src/core|src/runtime behavior changes without SPEC.md and docs/changelog.html updates)
$ bun scripts/spec-check.ts
spec-check: ok (160 files, 2457 tests — computed at gate time)
$ bun scripts/wiring-audit.ts
...
wiring-audit: 38/38 checks passed
```

`git status --short` after baseline: clean (compile reproduced the committed `dist/tui.js` byte-for-byte).

## Verification / handoff

- Re-run `bun run check` after writing this checklist; quote output.
- `git diff --stat` must show only `checklist/over-engineering-checklist.md`.
- Commit on `wt/over-engineering-audit`; `coordinator submit`; `coordinator merge-next --wait --target over-engineering-audit`; confirm lease `done` and worktree removed.
- Residual risk: severity is a review judgment, not a measured defect rate; "high" is intentionally unused because no finding blocks correctness today. Hot-spot line spans are brace/method counted and can drift by a few lines with unrelated edits.
