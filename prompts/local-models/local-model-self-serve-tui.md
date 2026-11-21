# Fully Self-Serve Local Models in TUI

Make the local-model experience fully usable from the TUI with no terminal or jargon required.

## Outcome
A user can discover, install, configure, run, switch, and repair local models entirely through clickable in-app settings.

## Discover current implementation
- Inspect existing settings UI, model discovery/scanning, server/runtime lifecycle, metadata readers, config surface, API/routes/handlers, and framework adapters.
- Preserve architecture boundaries, persistence conventions, and project rules (no generated/vendored/temp edits, respect naming/IDs, follow branch/worktree/commit workflow).

## Required capabilities (all in TUI)
1. **Discover:** scan default folders and show models with name, size, format, and status (Ready/Loading/Error). Add/remove folders via UI picker, not typed paths.
2. **Install:** search/download from a catalog (where feasible), show size/fit guidance, progress/cancel, and recommended quantization/options.
3. **Fit assist:** detect hardware/resources automatically and suggest safe defaults in plain language; warn when too large and offer alternatives.
4. **Run & switch:** one-click load/unload/switch with honest progress/cancel; failures explained plainly with a single suggested fix action.
5. **Tune:** expose human-meaningful controls (memory/speed/quality tradeoffs) mapped to technical flags internally; persist per-model settings.
6. **Repair:** detect common breakages (runtime/server issues, port conflicts, missing/moved files, memory errors) and offer one-click fixes where possible.
7. **Explain:** beginner-friendly labels and help; hide technical detail behind Advanced disclosures.

## UX principles
- Mouse-first; keyboard as courtesy.
- No jargon in default flow; every action has immediate feedback and is reversible.
- Errors state what happened and offer a way forward.

## Definition of done
- A fresh non-technical user can complete the full flow by clicks only: add folder, find/install model, check fit, load/chat, adjust, switch, and recover from failure.
- Tests cover discovery, fit/config derivation, state transitions, empty states, and error paths.
- Relevant typecheck, lint, focused tests, and smoke/build checks pass with quoted evidence.
- Report "landed" only with commit hash or quoted output.
