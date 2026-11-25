# Audit for Bugs and Regressions

Audit the recent changes in this repository for bugs and regressions using an isolated worktree you create from the integration branch. Check the diff against the behavior it should preserve, and fix only defects you can prove with a reproduction or a failing check. Add a focused regression test for each behavior fix. Leave unrelated code and unrelated changes alone.
