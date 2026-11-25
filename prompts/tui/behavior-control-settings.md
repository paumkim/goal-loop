# Build TUI Agent Behavior Controls

Build a complete behavior control system in the TUI so users change how the parent and each subagent behave through in-app settings. No CLI flags or config-file edits should be required. Discover agent types dynamically and show parent and subagent controls separately.

- Add quick-switch profiles for model, verbosity, reasoning, autonomy, safety, and visibility, with individual overrides.
- Provide model selection, reasoning budget, verbosity, and autonomy controls for each agent type, with an option to apply a preset to all.
- Expose understandable reasoning and thinking-display controls that map only to supported fields, never fake ones.
- Control tool-call, subagent activity, and transcript visibility, with a show-everything troubleshooting preset that affects the live session and persists.
- Offer plain read-only, ask-first, and auto-approve choices, with safety settings overriding profiles.
- Audit meaningful config options into settings, grouped under Advanced, with search, descriptions, reversible Apply and Undo, and reset to defaults.

Keep it click-first with plain labels, beginner help, and errors offering one fix. Add tests for profiles, overrides, mapping, persistence, and error states.
