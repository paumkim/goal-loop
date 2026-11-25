# Add Persistent Sticky-Note Capture to the TUI

Add low-friction sticky-note capture so users can jot thoughts, bugs, and ideas mid-conversation without losing focus. Keep it off by default and enable it through a settings toggle. Show a small marker with the note count that never covers the transcript or prompt.

- Open a floating overlay on click or a configurable keybind without resizing or reflowing the transcript.
- Save on Enter, insert newlines with Shift+Enter, parse tags like #bug and #idea without stripping them, and close with Escape after confirmation.
- Persist notes across restarts in the user data directory with atomic writes, never inside the repository.
- List recent notes with timestamp, tags, and preview, and support edit, undoable delete, and mark done.
- Detect runtime, port, and missing-file problems and offer one-click fixes.
- Show plain errors with one suggested fix, and recover gracefully from corrupt storage.

Keep it mouse-first with keyboard equivalents and hide advanced detail behind existing disclosures. Add tests for storage, atomic writes, corrupt-file recovery, and tag parsing, and document enablement.
