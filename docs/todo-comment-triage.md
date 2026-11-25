# TODO / FIXME / HACK / XXX triage

Scope: tracked source, config, and docs at `dev` (`2eed46c`), before any edits. Dependencies,
build output, vendor code, fixtures, and binary assets are out of scope.

## Reproduce

```sh
# Broad token scan (includes Roman-numeral workstream labels in prose)
git grep -n -I -E 'TODO|FIXME|HACK|XXX' -- .
# Marker-shaped tokens only (word boundary)
git grep -n -I -E '\b(TODO|FIXME|HACK|XXX)\b' -- .
# Lowercase status literals too
git grep -n -I -i -E '\b(todo|fixme|hack|xxx)\b' -- .
```

`.term/coordinator/state.json` is runtime bookkeeping, not config: lease slugs can contain
`todo` and are excluded from the counts below.

## Result

| Measure | Count |
| --- | --- |
| Broad token matches (tracked text files) | 167 |
| Word-boundary matches, case-sensitive | 19 |
| Word-boundary matches, case-insensitive (runtime state excluded) | 26 |
| Actionable marker comments in tracked source/config/docs — before | **0** |
| Actionable marker comments in tracked source/config/docs — after | **0** |
| Deleted / rewritten / flagged uncertain | 0 / 0 / 0 |
| Low-risk self-contained fixes applied | 0 |
| Tasks promoted to `docs/improvement-backlog.json` | 0 |

No source, config, or doc content changed. Nothing was stale, done, decorative, vague, or large
enough to promote.

## Why no match is actionable

The 167 broad matches are all false positives or historical/definitional references:

| Group | Matches | Classification |
| --- | --- | --- |
| `SPEC-workstreams.md` | 121 | Append-only workstream log. `XXX`/`CXXXVIII`/`XXXVII` are Roman-numeral workstream labels; other hits are quoted historical goal text and cross-references. Never hand-edit this aggregate. |
| `packages/coordinator/bin/coordinator` | 11 | `mktemp` templates such as `.state.XXXXXX`, not markers. |
| `SPEC.md` | 9 | Roman-numeral workstream labels (`XXXV`, `XXXVI`, `XXXIX`) in historical resolutions. |
| `docs/changelog.html` | 8 | Roman-numeral workstream labels inside pending/behavior-change HTML comments. |
| `test/plugin.test.ts`, `test/core.test.ts`, `src/hooks.ts`, `src/runtime/controller.ts` | 8 | Roman numerals in test names and explanatory comments (`CXXX`, `LXXXVII`, `XXXVII`, `CXXXVIII`). |
| `bun.lock` | 3 | `XXX` inside base64 integrity hashes. Dependency lockfile — out of scope. |
| `docs/improvement-backlog.json` | 3 | Workstream labels plus the word `TODO/FIXME` inside a **done** item's historical `improvement` text. Not a marker comment. |
| `prompts/maintenance/todo-triage.md`, `prompts/README.md` | 3 | This maintenance prompt's own definition and its index link. Keep. |
| `checklist/over-engineering-checklist.md` | 1 | Standing rule: `No TODO / FIXME / HACK / XXX markers in src, bin, scripts, packages.` Keep. |

The word-boundary scans narrow this further: the 19 case-sensitive matches are 15 workstream-log
lines plus the four definitional references above. The 26 case-insensitive matches add four
`"todo"` status/tool-name literals (`src/prompter/backlog.ts:63`,
`test/improvement-backlog.test.ts:76`, `test/intent-icons.test.ts:100`,
`test/prompter-backlog.test.ts:75`) and two lowercase quoted `todo` lines in
`SPEC-workstreams.md`. None is a marker comment.

Binary asset hits (`assets/goal-status.png`, `assets/goal-verifier.png`, `assets/goal-workflow.png`)
are byte coincidences; `-I` excludes them.

## Follow-up

None. The backlog already tracks the broader "feed from TODO/FIXME, audits, failing checks, and
telemetry" idea under the done item `persistent-prioritized-backlog-dedup`; its honest limits in
`SPEC-workstreams.md` record that automatic feeding remains unimplemented. That is a distinct,
larger planning item and is not promoted here because this triage found no marker comments to act on.

This report names the four markers in prose, so a future scan will see this file and the triage
prompt itself. Both are definitions of the task, not debt.
