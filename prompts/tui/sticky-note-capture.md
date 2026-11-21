# TUI Persistent Sticky-Note Capture

Build a low-friction, persistent sticky-note capture system in the TUI so users can jot thoughts, feedback, bugs, and feature ideas mid-conversation without losing focus.

## Discovery and constraints
- Read relevant project docs, safety rules, settings/dialog patterns, and architecture boundaries before editing.
- TUI/UI should communicate through the approved server/API/config layers; do not bypass boundaries or edit generated/vendored/temp output paths.
- Keep the feature isolated and cleanly disableable; avoid transcript rendering/layout changes unless strictly required.
- Do not ask for UX choices; pick sensible defaults, state them, and note what would reverse each choice.

## Behavior
1. **Gate:** off by default. Enable via a settings toggle (e.g. Developer/Sticky notes). Developer mode toggle lives in settings if not already present.
2. **Dock:** when enabled, show a small unobtrusive marker at a fixed edge (default: right/lower area above status line) with icon/glyph and note count. Must never cover transcript or prompt input.
3. **Open:** click marker or use a configurable keybind to open a floating overlay near the anchor without resizing/reflowing the transcript.
4. **Capture:** Enter saves; Shift+Enter inserts newline; optional tags like `#bug`, `#idea`, `#todo` are parsed and stored as tags (not stripped). Escape closes. Show brief confirmation and clear input on save.
5. **Minimize/persist UI state:** closing returns marker to prior dock position; persist dock position/size.
6. **Review:** list recent notes newest first (timestamp, tags, preview). Support edit, delete, and mark done. Deletion must be reversible (undo/soft delete) or confirmed.
7. **Persistence:** notes survive restart/reboot. Store outside the repo in user data/config dir using safe atomic writes (e.g. one file per note or append-only JSONL). Never store in repo temp/build dirs. Load on startup and show count immediately.
8. **Failure behavior:** write failures show a plain sentence with one suggested fix (no stack trace). Corrupt storage must not crash UI; load valid entries and report the rest.

## UX
- Mouse-first with keyboard equivalents for every action.
- No jargon in default UI; advanced details behind existing disclosure patterns if needed.
- Reuse existing dialog/settings/storage primitives where possible.

## Deliverables
- Implementation plus focused tests for note store (persistence, atomic write, corrupt-file recovery, tag parsing) and relevant UI state logic.
- Short documentation describing storage location, enablement, and export/review.

## Verification
- Run relevant typecheck, lint (0 errors), focused tests, build, and smoke checks as required.
- Manual check: enable in settings, add notes, restart app, confirm notes and dock state persist.
- Report defaults chosen (dock edge, keybind, storage path, tag syntax), verification output, commit hash, and residual gaps. Use "landed" only with evidence.
