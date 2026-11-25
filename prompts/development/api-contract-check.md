# API and Config Contract Check

Check that the providers and consumers of <contract> still agree on its shape. Cover endpoints, events, schemas, CLI flags, configuration keys, and feature flags, and name the source of truth you checked against. Find renamed or removed fields, changed defaults, new enum values, missing validation, and docs that disagree with code. Fix drift in the source of truth first, regenerate derived files with the project's generator, and never hand-edit generated code. Keep sample config and docs aligned, and tell me each drift you found and how you resolved it.
