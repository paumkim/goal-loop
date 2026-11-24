# Generate an API Client or Types

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Regenerate the API client, SDK, or shared types from the repo's spec and prove it matches the contract.

## Before acting
- Locate the source of truth (OpenAPI/GraphQL/protobuf/JSON Schema) and the
  generator command/config in the repo's scripts or docs.
- Identify what is generated and committed versus ignored, and which consumers
  import the generated output.

## Steps
1. **Baseline:** record the current generated files and note their diff state.
2. **Regenerate:** run the repo's own generator against the current spec. Do not
   hand-edit generated files; change the spec or config instead.
3. **Reconcile:** inspect the diff. For each change, confirm it follows from a spec
   change. Revert or explain unexpected drift (e.g. generator version skew).
4. **Check consumers:** update call sites only where the generated contract
   changed, and add/adjust tests for changed fields or methods.
5. **Verify build:** compile/typecheck the generated code and its consumers.

## Rules
- Do not modify generated files directly; regenerate them.
- Do not bump the generator version unless the repo pins one and the bump is the task.
- Do not regenerate unrelated outputs; keep the diff scoped to the spec change.

## Verify
- Paste quoted generator output and `git diff --stat` of generated files.
- Paste quoted typecheck/build/test output for the generated code and consumers.
- Confirm no generated file is hand-edited (diff matches spec changes).

## Report
- Spec source and generator command:
- Generated files changed with reasons:
- Consumer updates with `file:line`:
- Quoted verification output:
