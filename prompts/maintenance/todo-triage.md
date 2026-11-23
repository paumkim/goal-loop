# TODO / FIXME Triage

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Turn scattered `TODO`, `FIXME`, `HACK`, and `XXX` comments in the current
repository into either tracked work or deleted noise.

## Before acting
- Discover the project's issue/task tracker conventions (issue tracker, local
  backlog file, or plain markdown) from its docs; do not assume a specific tool
  exists.
- Record a baseline of test/lint/typecheck results.

## Inventory
- Search tracked source/config/docs for `TODO`, `FIXME`, `HACK`, `XXX`
  (case-insensitive), excluding dependencies, build output, vendor code, and
  fixtures/snapshots.
- Record each hit with `file:line` and a one-line summary.

## Triage each
- **Stale or done:** delete the comment.
- **Actionable and self-contained:** fix it now as a small verified change if it
  is low risk; otherwise promote it to a tracked task with `file:line` and enough
  context to act later.
- **Vague ("handle later"):** rewrite it into a concrete, actionable note or
  remove it.
- **Noise/decorative:** delete it.
- **Unsure:** keep it and flag it with `file:line`.

## Rules
- Comment-only removals must not change behavior. Do not edit code beyond the
  comment unless the item is being fixed as its own verified unit.
- Do not introduce new TODOs. Follow repository safety rules for staging and checks.

## Verify
- Re-run the inventory and show the before/after count.
- Re-run the baseline checks; quote output and confirm no behavior change.
- Show `git diff --stat` and a list of promoted tasks with their references.
