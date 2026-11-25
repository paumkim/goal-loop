# Safe Refactor

Refactor <module> in this project to improve clarity or reduce duplication while preserving observable behavior. Run the existing tests first, and add a characterization test for any behavior they do not cover. Pick the smallest cohesive unit, write down the behavior you are preserving, and change structure only. Run focused tests after each step and revert any step that changes observable behavior. Remove unused imports, branches, and helpers left behind, then tell me the preserved behavior and the baseline and after results.
