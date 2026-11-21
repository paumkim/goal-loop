# Fix Local Model Chat Routing

Wire local model selection into the actual chat/completion pipeline so that choosing a local model routes requests to it immediately, with safe fallback behavior.

## Discovery
- Inspect existing local model discovery, config/state, settings UI, provider/model resolution, and session/chat request path.
- Reuse existing adapters, identifiers, and config fields; do not change cloud behavior when local mode is off.

## Tasks
1. **Provider/runtime wiring:** seed/register the local provider/model from discovered local models when local mode is enabled, using the existing compatible client path where appropriate.
2. **Chat routing:** when local mode is on and a model is selected, route chat/completions to that local provider/model. When the selected model/file/server is missing, corrupted, or unreachable, surface a friendly in-chat/session error and fall back gracefully (no crash, no silent incorrect routing).
3. **ID consistency:** ensure the persisted selected model ID matches the runtime provider/model ID used for requests.
4. **Tests:** add/update tests covering: local enabled+selected routes locally; local disabled leaves cloud path unchanged; missing/unreachable model produces friendly error and fallback.
5. **Verification:** run relevant typecheck, lint, focused/new tests, and smoke checks as required by the repo.

## Deliverables
- Code changes with `file:line` references in report.
- Passing verification output (quoted) and commit hash if committed per repo workflow.
