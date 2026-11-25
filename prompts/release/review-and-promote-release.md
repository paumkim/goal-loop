# Review and Promote a Release

Act as the release coordinator. Review everything merged to the integration branch since the last promotion, and fix real defects through the proper workflow. Then promote to the release branch and rebuild the required artifacts.

- Identify the promotion range and review the merged changes for stale docs, broken references, generated-file drift, and failing checks.
- Confirm the expected deliverables exist on the integration branch and run the required checks for the changes.
- Fix each defect in its own scoped change, verify it, and integrate it through the project's merge flow.
- Promote only after verification and fixes are green, using the sanctioned release command exactly as documented.
- If a gate or dirty tree blocks promotion, stop, report it, fix the cause through the normal workflow, and rerun.

Treat the release branch as read-only except through the sanctioned command, and leave foreign changes untouched. Verify installed entrypoints, version output, and smoke checks before calling it landed.
