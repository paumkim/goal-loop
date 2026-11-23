# TUI Transcript Verbosity Consistency and Dead-Code Cleanup

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Audit and polish the TUI transcript with focus on verbosity-level consistency and removal of dead or silent-failure code.

## Scope
1. **Trace verbosity levels end-to-end:** config → state → transcript render → animation. Document how each level renders (spacing, grouping, headers, indicators, thinking/tool blocks).
2. **Make levels consistent:**
   - Same vertical rhythm (padding/gaps between turns) across levels.
   - Consistent collapse affordances (glyph, position, click/key behavior).
   - Animation/streaming indicators must not change layout height when appearing/disappearing (fixed-height slots or overlay).
   - No blank rows/gaps when switching verbosity mid-session or on re-render.
3. **Remove silent failures and dead code:**
   - Settings that save but do not apply.
   - Collapsed state that resets unexpectedly or toggles that do nothing in some levels.
   - Unreachable render branches/props/helpers after verbosity changes — delete them.
   - Swallowed errors/fallbacks must surface visibly/log appropriately or be intentionally documented.
4. **Visual-glitch pass:**
   - Fix overflow, misaligned indicators, duplicated/missing headers.
   - Streaming text must not cause footer/prompt jumps; keep content area stable.
5. **Tests:**
   - Add/extend frame/render tests per verbosity level asserting consistent spacing, indicator presence, and no extra blank rows.
   - Add tests for toggling verbosity and collapse without changing unrelated content/rows.

## Rules
- Remove dead code entirely; do not keep unused branches.
- No silent failures.
- Preserve highest-verbosity behavior except for consistency fixes.
- Small commits per coherent fix where practical; keep working tree clean.

## Verification and report
- Run build, smoke tests (with required env/config), typecheck, lint, and new/focused tests as applicable. Paste real output.
- Report commit hashes, `file:line` references for each render change, and before/after excerpts showing at least one consistency fix.
