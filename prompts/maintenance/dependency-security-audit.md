# Audit Dependency Security

Run this repository's dependency audit and apply only safe, verified fixes. Discover the audit tool from the manifests and lockfiles, such as `npm audit`, `cargo audit`, or `govulncheck`, and record the baseline finding count. Apply patched upgrades that need no major bump and cause no breaking change, then run the full checks. Record each advisory you defer with its ID, severity, package, and exact blocker, including dev-only or unexploitable findings. Show me the new finding count and the list of deferred advisories.

- Update the lockfile through the package manager, never by hand.
- Work one coherent upgrade at a time and add no new dependencies.
