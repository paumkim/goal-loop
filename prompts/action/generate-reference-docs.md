# Generate Reference Docs

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Generate reference documentation from code/annotations with the repo's own tooling and verify it is current.

## Before acting
- Find the docs generator, its config, source annotations/comments, and the output
  directory. Check whether generated docs are committed or ignored.
- Identify which symbols or endpoints should be covered and whether there is a
  freshness check in CI.

## Steps
1. **Baseline:** record current generated docs and whether the tree is clean.
2. **Generate:** run the repo's own docs generator. Do not hand-edit generated
   output; change source comments/annotations or config instead.
3. **Reconcile:** inspect the diff. Confirm each change follows from a source
   change. Investigate and explain unexpected churn (version skew, unstable order).
4. **Check links/coverage:** verify generated links resolve and that new/changed
   public symbols or endpoints are present. Fix missing source annotations rather
   than patching output.
5. **Wire freshness:** if the repo has a docs-freshness check, run it; if none
   exists, note that in the report instead of inventing a new CI system.

## Rules
- Do not commit generated noise or unrelated churn.
- Do not manually edit files the generator owns.
- Do not claim docs are complete if coverage/freshness was not checked.

## Verify
- Paste quoted generator output and `git diff --stat` of generated docs.
- Paste quoted freshness/link-check output (or state why unavailable).
- Confirm no generated file was hand-edited.

## Report
- Generator command and config:
- Docs generated/changed with reasons:
- Quoted verification output:
- Gaps in coverage (max 3):
