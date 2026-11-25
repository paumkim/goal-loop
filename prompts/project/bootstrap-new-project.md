# Bootstrap a New Project

Set up a new project in <directory> with a small, verified, maintainable foundation. Choose a conventional layout, standard tooling, and the smallest runnable entrypoint, and state any default you pick when the stack is unspecified. Check for existing files before creating anything so you never overwrite user work. When you are done, a contributor should be able to install, run, test, and lint the project using commands verified against this stack.

- Create only the minimum directory structure the chosen stack needs, with no speculative folders.
- Initialize the package or build manifest, lockfile, formatter, linter, and test runner using standard tools.
- Add a smallest runnable hello entrypoint and one passing test that exercises it.
- Write a short README with verified setup, run, test, and lint commands.
- Add a .gitignore for the stack and initialize git only if the directory is not already a repository.
- Confirm install, lint, test, and build pass, and keep generated files consistent with the chosen stack.
