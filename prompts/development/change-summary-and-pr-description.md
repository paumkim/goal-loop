# Change Summary and PR Description

Turn a finished diff into an accurate, short change summary or pull request
description.

## Before acting
- Discover the repository's commit, changelog, and PR conventions: templates,
  required sections, labels, and issue-link format.
- Read the full diff and recent commit subjects before writing anything.

## Write
1. **Scope:** group changes by user-visible outcome, not by file.
2. **Why:** state the problem or need in one or two sentences.
3. **What changed:** list the outcomes with `file:line` references for key
   changes.
4. **Impact:** note behavior changes, migrations, configuration changes, and
   rollout or rollback steps.
5. **Verification:** list the exact commands run and the result of each.
6. **Risk:** name what is not covered or still uncertain.

## Rules
- Every claim must be traceable to the diff or quoted command output.
- Follow the repository template exactly; keep it short and factual.
- No filler, no model or tool attribution, no absolute local paths.
- If docs or tests are missing for a behavior change, say so plainly.
- Do not include secrets, tokens, or private data.

## Verify
- Re-read the diff and check each sentence against it.
- Confirm every referenced `file:line` still matches the final diff.
- Run any template or link check the repository provides and paste the output.

## Report
- The finished description, then a short list of the commands used to check it.
