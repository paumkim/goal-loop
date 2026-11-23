# Fix TUI Post-Send Transcript Flicker

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Fix a TUI flicker/regression where sending a message causes the transcript to flash, jump, or reflow after the message lands.

## Reproduction
1. Identify the chat/session transcript send flow in the current repository.
2. Reproduce: send a message; observe any post-landing flicker, scroll jump, or layout flash.

## Investigate likely causes
- Post-send scroll/anchor handling (restore/scroll order, double scroll actions).
- Windowed/list height changes after optimistic user message insertion.
- State update ordering (optimistic insert, streaming start, busy/loading/prefetch causing late re-render and repeated scroll/restore).
- Ensure no second render pass forces a visible jump when already pinned to bottom.

## Fix requirements
- Message send lands with zero flicker: single scroll action where appropriate, no unnecessary anchor restore when pinned to bottom, no height recalculation flash.
- Do not refactor unrelated code or change intended send UX beyond removing post-landing flicker.

## Tests and verification
- Add or extend a focused test pinning the behavior (e.g. scroll/restore must not fire twice on send).
- Run relevant focused UI/session tests, typecheck, lint, and any required build/smoke checks for the affected area.
- Commit with an appropriate message (e.g. `fix(tui): stop post-send flicker in transcript`) using explicit paths only.
- Report root cause, fix (`file:line`), tests added/updated, and quoted verification output.
