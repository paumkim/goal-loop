# Headless TUI Debug Frame Protocol

Build a headless debug mode for a terminal UI so a text-only agent can debug the TUI live without pixels or screenshots.

## Goal
Expose a structured, text-based view of the running TUI (transport/mechanism can use existing debug/MCP/driver tooling if present). Prefer semantic frames and diffs over images.

## Required capabilities
1. **Screen model from terminal cells:** emit structured JSON per frame (e.g. cursor, viewport, regions, text, styles, scroll, focus) plus a diff against the previous frame. No screenshots as primary output.
2. **Semantic layer:** tag regions with role/label/value/bounds (prompts, lists, dialogs, transcript/content zones, status areas) as first-class concepts.
3. **Live stream:** provide a command/mode that streams frames, diffs, and an event log (input, focus changes, renders, errors) to stdout as text for real-time following.
4. **Assertions and test runner:** implement assertions such as `expect_visible`, `expect_focus`, `expect_no_overlap`, and any project-specific rendering-zone expectations. Provide a headless scenario/test runner that fails with a useful diff.
5. **Rendering safety:** respect existing rendering/transcript zone rules; never break transcript rendering, streaming, or layout behavior.
6. **Docs and examples:** document the protocol/usage and include a conformance test demonstrating that a text-only agent can identify a bug from the stream alone.

## Constraints
- Reuse existing terminal driver/capture infrastructure where possible.
- Keep output deterministic and diff-friendly.
- Follow repository architecture, testing, and contribution rules.

## Verification
- Run relevant typecheck and tests for new/affected packages.
- Provide a headless run transcript/log as evidence showing frames, diffs, events, and assertion behavior.
- Report changed files, protocol/schema summary, and how to run the debug stream and tests.
