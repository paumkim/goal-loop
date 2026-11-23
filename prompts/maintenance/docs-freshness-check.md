# Documentation Freshness Check

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Find and fix documentation in the current repository that has drifted from the
code and configuration it describes.

## Before acting
- Map the project's docs (README, docs directory, contributing guide, examples,
  in-repo wiki) and discover real commands, paths, versions, and settings from
  the source of truth — manifests, scripts, config files, and CI — not from the
  docs themselves.

## Check
1. **Paths and filenames:** referenced files/directories that no longer exist or
   were renamed.
2. **Commands:** install/build/test/run commands that no longer match manifests
   or scripts.
3. **Versions and requirements:** language/runtime/tool versions that conflict
   with manifests, lockfiles, or CI config.
4. **Configuration and options:** documented flags, env vars, and endpoints that
   are gone or renamed, plus new ones that are undocumented.
5. **Relative links and anchors:** broken internal links, images, and stale
   heading anchors.
6. **Structure:** category/index lists that no longer match the actual file layout.

## Fix
- Correct only documentation that is provably stale, using discovered
  source-of-truth values and `file:line` evidence for each claim.
- If code and docs disagree and the correct behavior is ambiguous, report the
  conflict with evidence instead of guessing which side to change.

## Verify
- Re-check every corrected reference (link target exists, command runs, path
  resolves).
- Show `git diff --stat` and quote the before/after lines for each documentation fix.
- List unresolved conflicts as follow-ups with file references.
