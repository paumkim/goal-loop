# Automate a Repetitive Task

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Turn a repeated manual task into a script or command wired into the repo, and verify it replaces the manual steps.

## Before acting
- Identify one concrete task people repeat (data cleanup, codegen + copy steps,
  multi-command setup, repetitive edits). Confirm it is genuinely repeated by
  looking for docs/scripts that describe the manual sequence.
- Discover the repo's command conventions (scripts dir, Makefile, package scripts)
  and where automation belongs.

## Steps
1. **Capture the manual steps:** write down the exact current sequence, inputs, and
   expected output. Note anything error-prone.
2. **Implement:** write the smallest script/command that performs those steps using
   the repo's existing tools. Prefer clear, boring code over clever abstractions.
3. **Make it safe:** add input validation, clear errors, and a dry-run or help mode
   if the task is destructive. Never guess paths; resolve them from the repo.
4. **Wire it in:** expose the command via the repo's normal mechanism and document
   it where the manual steps were previously described.
5. **Verify equivalence:** run the command and confirm its output matches what the
   manual sequence produced.

## Rules
- Do not automate a task that runs once; confirm repetition first.
- Do not hardcode machine-specific absolute paths or secrets.
- Do not delete the documented manual process until the command is proven to work.

## Verify
- Paste quoted output of the new command and its help/dry-run mode.
- Show evidence that output matches the manual steps (diff or inspection).
- Run the repo's tests/lint/typecheck if the automation touches code; paste output.
- Show `git diff --stat` confirms the change is scoped.

## Report
- Task automated and evidence it was repetitive:
- Command name and location with `file:line`:
- Quoted equivalence evidence:
- Risks or follow-ups (max 3):
