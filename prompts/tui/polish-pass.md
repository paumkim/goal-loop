# Run a TUI Polish Pass

Polish the TUI without adding features. Inspect every screen and state, save a before capture, and fix at most five visual flaws, highest severity first. Work only in the isolated worktree for this pass and record its path and pass number.

Check alignment, spacing, overflow, contrast, focus, flicker on send and scroll, overlays covering the prompt or transcript, and plain-language errors. Apply the smallest fix using existing styles and components, and save an after capture for each one.

Record each fix with its before and after, note what you left for the next pass, and stop if no high-severity flaws are found. Add a focused test for each behavior fix where practical.
