# Check Documentation Freshness

Find and fix documentation in this repository that has drifted from the code and configuration it describes. Compare the docs against source of truth in manifests, scripts, config files, and CI, not against the docs themselves. Correct paths that no longer resolve, commands that no longer run, and outdated version requirements. Also fix renamed flags and environment variables, broken links, and stale index lists. Where code and docs disagree and the correct behavior is unclear, report the conflict instead of guessing.

- Fix only references you can prove stale, using the discovered source-of-truth values.
- Re-check each corrected link, command, and path before finishing.
