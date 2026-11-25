# Fix Post-Send Transcript Flicker

Fix the TUI flicker where sending a message makes the transcript flash, jump, or reflow after the message lands. Reproduce it first, then trace the send flow through scroll and anchor handling, list height changes, and state update ordering.

The result should be a single scroll action on send, no anchor restore when pinned to the bottom, and no height recalculation flash. Change only what removes the flicker and keep the intended send behavior.

Add or extend a focused test that pins the behavior, such as scroll or restore firing only once on send.
