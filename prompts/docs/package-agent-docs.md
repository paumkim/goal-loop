# Create/Update Package AGENT Documentation

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Write a documentation system for future agents so they can use, configure, and maintain the current project without guessing.

## Deliverable
- Create or update a root `AGENTS.md` index that maps the repository and links to all area/package docs.
- Create or update one `AGENT.md` per major package/area (and for any plugin, provider, theme, skill, or extension system you find).
- Upgrade/merge existing docs rather than duplicating them.

## Required content for each area doc
1. **Purpose** — what this area does and why it exists.
2. **Entry points** — commands, binaries, and files users/agents actually touch.
3. **Configuration** — config files, env vars, and settings with concrete examples where relevant (e.g. changing models/providers/themes/keybinds, adding local/custom endpoints) using exact, verified paths/commands.
4. **Setup & connection** — copy-paste runnable steps to install/start/connect/verify.
5. **Common tasks** — plain-language tasks and the agent workflow to perform them (what to edit, where, how to verify).
6. **Agent rules** — what agents must/must not do in this area (branches, worktree, tests, commits).
7. **Troubleshooting** — common failures and fixes.
8. **Code map** — key files/directories and ownership.
9. **Verification** — commands that prove setup/changes work.

## Ground rules
- Derive everything from actual code, scripts, and existing docs in the repo. Never invent settings, commands, or files. If something cannot be verified, state that explicitly.
- Keep tone consistent: short, imperative, practical, agent-oriented.
- Prefer concrete examples over theory.
- Fix stale or incorrect docs you discover while working.
- Run the repository's relevant verification commands (lint, typecheck, tests/smoke as applicable) and confirm docs match reality.

## Done when
- Every major package/area has accurate documentation, the root index links to them, and a fresh agent can answer common operational questions (e.g. how to change model/theme/settings) from the docs alone.
