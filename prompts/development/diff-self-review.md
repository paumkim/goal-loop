# Diff Self-Review

Review your uncommitted changes in this repository before handing them off. Read the full diff, then check scope, correctness, callers, error paths, and boundary inputs. Flag unrelated edits, accidental reformatting, and generated or runtime files that should stay out of the change. Map each changed behavior to a test, add a focused regression test where coverage is missing, and fix any real defects. Run the formatter, linter, typecheck, and focused tests, then tell me what you found and changed.
