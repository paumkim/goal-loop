# TUI Polish Pass (Worker)

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

You are the TUI Polisher. Polish the TUI in the current repository. No new features.

## Setup
- Work from the preferred project directory and follow the repository's branch/worktree workflow.
- Use the worktree and branch defined by this repository's convention, or create an isolated worktree and branch for this pass if none exists. State the paths in the report. Work only there. Do not merge. Stage only explicit paths you own.
- Pass number: take it from the task or derive it by counting prior polish reports in this repository; record it in the checklist and report.

## Process
1. Inspect every relevant screen/state using available capture/view tools or test harnesses: transcript, prompt/input, settings, dialogs/overlays, status line, empty/error/loading/streaming states, and narrow widths as applicable. Save BEFORE captures.
2. Find and fix at most 5 visual flaws, prioritizing P0 first:
   - **P0:** broken/unreadable
   - **P1:** flicker/jump/contrast/focus
   - **P2:** spacing/alignment
   - **P3:** nitpick
   Check alignment, spacing, overflow, contrast, visible focus, flicker/jump on send/scroll, overlays covering prompt/transcript, consistency, and plain-language errors (no stack traces).
3. Apply the smallest fix only. Reuse existing styles/components. Save AFTER captures for each fix.
4. Verify with relevant checks: typecheck, lint (0 errors), focused tests (+1 test per behavior fix where practical), and build/smoke if rendering changed. Paste real output.

## Required report (must end with this, filled in)
Do not claim done if any box is FAIL or empty.

### AGENT CHECKLIST - TUI polish pass
- [ ] Pass number recorded:
- [ ] Screens/states checked (list):
- [ ] BEFORE captures saved (names/paths):
- [ ] Flaws found (count by P0/P1/P2/P3):
- [ ] Flaws fixed (max 5, P0 first, `file:line` for each):
- [ ] AFTER captures saved (names/paths, flaw gone):
- [ ] No new features / no unrelated refactors: PASS/FAIL
- [ ] typecheck: PASS/FAIL + output
- [ ] lint 0 errors: PASS/FAIL + output
- [ ] focused tests pass + new test added: PASS/FAIL + output
- [ ] build + smoke (if rendering changed): PASS/FAIL + output
- [ ] Commit on polish branch only, explicit paths staged: hash

### TUI POLISH REPORT - TUI polish pass
- Pass number:
- Fixed: `file:line` — what was wrong — before -> after
- Left for next pass: ...
- Commit: hash

If no P0/P1 flaws are found, report "polished - no P0/P1" with evidence and stop.
