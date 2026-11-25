# Automate a Repetitive Task

Turn the repeated manual task `<task>` into a script or command wired into the
repository. Capture the exact current steps, inputs, and expected output first,
then implement the smallest script that reproduces them using the project's
existing tools. Add input validation, clear errors, and a dry-run or help mode if
the task is destructive.

Expose the command through the repo's normal mechanism and document it where the
manual steps were described. I should be able to run the command and see output
that matches the manual sequence, with no machine-specific paths or secrets.
