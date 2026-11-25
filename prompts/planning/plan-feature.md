# Plan a Feature or Change

Turn a request into a small, verifiable plan before writing code. Identify the user-visible outcome, constraints, and definition of done, and state assumptions when the request is ambiguous. Discover the layout, conventions, test commands, and contribution gates from the repo's docs, manifests, and scripts. Find the relevant files, entry points, data flow, and existing patterns so each work unit names real paths and commands. Make the plan concrete enough to execute unit by unit, and write no production code beyond a throwaway spike.

- Restate the goal in one sentence and list what is in and out of scope.
- Describe the smallest design that satisfies the request, noting any public API, schema, config, or migration impact.
- Break the work into ordered, reviewable units, each with a check command that proves it.
- List behavior changes, compatibility concerns, rollback steps, and unknowns, with the evidence that would resolve each one.
- Verify every referenced file and command exists and that each unit covers tests, docs, and generated artifacts.
