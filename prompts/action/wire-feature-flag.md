# Wire a Feature Flag End-to-End

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Add a feature flag with a safe default, code guards, and tests for both states.

## Before acting
- Discover how the repo defines flags/config (env, config file, remote flags,
  in-code registry) and how existing flags are named, typed, and read.
- Define the flag's name, default, scope (global/user/percentage), and the exact
  behavior it gates.

## Steps
1. **Define:** add the flag to the canonical config/registry with a safe default
   (off unless the task says otherwise). Add it to env/config samples if applicable.
2. **Guard:** wrap the gated behavior at the narrowest sensible boundary. Keep the
   old path intact and reachable when the flag is off.
3. **Test:** write tests that exercise both on and off states and confirm the
   default is safe. Include the cleanup path if the flag removes a code branch.
4. **Exercise:** run the app/tests with the flag toggled both ways and inspect the
   behavior in each state.
5. **Document:** note the flag, default, and removal condition in the relevant doc
   or TODO so it does not become permanent dead config.

## Rules
- Do not default a risky feature to on.
- Do not scatter ad-hoc env reads; use the repo's config/flag mechanism.
- Do not leave the flag undocumented or without a cleanup note.

## Verify
- Paste quoted output showing behavior with the flag on and off.
- Run the relevant tests, typecheck, and lint; paste quoted output.
- Show `git diff --stat` and confirm samples/docs are updated with the flag.

## Report
- Flag name, type, and default:
- Guard location with `file:line`:
- Quoted on/off evidence:
- Removal condition / cleanup note:
