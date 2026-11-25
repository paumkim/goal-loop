# Build a Local Docs System With a Freshness Radar

Build a local documentation site for this project that serves as both a reader guide and a maintainer freshness radar. Give readers setup, configuration, usage, and troubleshooting pages with clear navigation, one shared design language, and a 65 to 75 character measure. Support light and dark themes with AA contrast, a persisted toggle, and keyboard navigation. Add a dashboard that flags stale docs from git history and metadata, plus a JSON export and a git-derived history view. Contributors should be able to add a doc and read its freshness status without a new storage layer.

- A metadata schema with title, audience, area, last_reviewed, source_of_truth, and owners.
- A freshness pipeline that derives last touched from git and flags changed sources.
- A sortable, filterable dashboard with deterministic colors and a JSON export.
- A git-derived history timeline and a fixture proving stale versus fresh detection.
- Contributor docs on adding docs and interpreting the freshness colors.
