# Add a CLI Command

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Add a new command or subcommand end-to-end and verify it with a real invocation.

## Before acting
- Discover the CLI framework, command registration point, arg/flag parsing
  conventions, help/usage style, and how existing commands are tested.
- Read the request and define the command's name, arguments, flags, output shape,
  exit codes, and error behavior.

## Steps
1. **Register:** add the command using the existing command/parser pattern. Keep
   naming and flag style consistent with sibling commands.
2. **Implement:** write the handler with input validation and clear errors. Use
   the repo's output/error helpers rather than ad-hoc printing.
3. **Help:** add usage text, descriptions, and examples so the command is
   discoverable via the tool's help output.
4. **Test:** add focused tests for arguments, happy path, validation failures, and
   exit codes using the project's CLI test harness.
5. **Exercise:** run the built CLI with real arguments and inspect stdout, stderr,
   and exit code.

## Rules
- Do not guess parser APIs or flag names; verify them in code and docs.
- Do not add a second CLI framework for one command.
- Do not swallow errors or always exit 0; preserve meaningful exit codes.

## Verify
- Paste quoted output of the real invocation (success and one failure case).
- Run the project's tests/lint/typecheck; paste quoted output.
- Show `git diff --stat` confirms the change is scoped to this command.

## Report
- Command signature and flags:
- Files changed with `file:line`:
- Quoted real-invocation output:
- Risks or follow-ups (max 3):
