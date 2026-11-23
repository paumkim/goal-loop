# Build a Local Docs System with Freshness Radar

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Design and implement a local, human-facing documentation system for the current repository that is both a reader's guide and a maintainer freshness radar.

## Discovery first
- Study existing docs, site generators/tooling, theme tokens, and any reference doc systems in or near the repo before designing.
- Reuse existing design systems/tokens/components where available; avoid introducing parallel systems or heavy dependencies without justification.
- Follow repository contribution, branching, and verification rules.

## What to build
1. **Reader-facing docs**: clear guides for users/maintainers (setup, configuration, usage, troubleshooting, FAQ as relevant), with strong information architecture and navigation.
2. **Freshness radar**: a live/build-time view of doc freshness showing what is stale, recently touched, and what changed.

## Design requirements
- Clean, fast, readable: constrained measure (~65–75ch), comfortable line height, clear typographic hierarchy, minimal dashboard chrome.
- One consistent design language (shared tokens and components: shell, TOC, callouts, code blocks, navigation).
- First-class light/dark mode (toggleable, persisted, respects system preference on first visit) with accessible contrast.
- Static-first delivery for reading; generate freshness data at build time or via a small local watcher (choose and justify).
- Accessibility: keyboard navigation, visible focus states, AA contrast in both themes.
- Performance: fast local load; minimal/no JS for content pages, interactivity only where needed (e.g. dashboard).

## Freshness tracking
- Define machine-readable doc metadata (e.g. title, audience, area, `last_reviewed`, `source_of_truth`, owners).
- Derive "last touched" from git history where possible; reserve explicit review timestamps for human re-checks to avoid noisy auto-commit churn.
- Detect docs whose `source_of_truth` changed since last review (git-based) and classify freshness with deterministic color/status thresholds.
- Generate a freshness dashboard (sortable/filterable by area/audience) and a machine-readable JSON export.
- Provide a human-readable, git-derived history/timeline view (global and/or per-file) without introducing a new storage layer.
- Ensure freshness/color results are deterministic from git + metadata so CI can enforce staleness rules.

## Deliverables
- Working docs site (location justified by repo conventions).
- Freshness pipeline: metadata schema, generator/watcher, dashboard, JSON export.
- History/timeline view derived from git.
- Contributor documentation explaining how to add/edit docs and interpret timestamps/colors.
- Example/fixture demonstrating stale vs fresh detection.
- Verification: build passes, dashboard works in both themes, freshness output is correct against fixture/history, and required checks/lint pass. Provide real command output.
