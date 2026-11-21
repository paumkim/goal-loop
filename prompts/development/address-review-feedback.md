# Address Review Feedback

Work through code review comments systematically and leave clear evidence for each
decision.

## Before acting
- Read all review comments before changing code. Group them by file, theme, and
  severity (blocking, suggestion, question).
- Discover the repository's check commands, commit conventions, and any review
  workflow rules from its docs.

## Address
1. **Clarify intent:** for each comment, determine whether it requests a code
   change, a test, a docs update, or an explanation. If a comment is ambiguous,
   state your interpretation before acting.
2. **Fix blocking issues first:** make the smallest correct change that resolves
   the concern. Add or update tests when behavior or edge cases are involved.
3. **Evaluate suggestions:** accept suggestions that improve correctness, clarity,
   or maintainability. If you decline one, prepare a concrete, evidence-based
   reason.
4. **Keep scope tight:** do not bundle unrelated refactors into review fixes.
   Record worthwhile follow-ups separately.
5. **Respond clearly:** map each comment to an outcome: fixed, answered, or
   declined with rationale. Include `file:line` for code changes.

## Rules
- Do not silently ignore comments. Every comment gets an explicit disposition.
- Do not mark feedback resolved without evidence when the code changed.
- Preserve behavior unless the review identifies a bug or the requester agreed to
  a behavior change.
- Do not weaken tests or checks to satisfy a comment.

## Verify
- Run formatter, linter, typecheck, and relevant tests after changes; paste
  quoted output.
- Show `git diff --stat` and confirm the diff only addresses review feedback or
  necessary supporting fixes.
- Re-read the original comments against the final diff.

## Report
- Comment-by-comment disposition (fixed/answered/declined) with evidence:
- Files changed (`file:line`):
- Checks run and quoted output:
- Follow-ups not included in this pass:
