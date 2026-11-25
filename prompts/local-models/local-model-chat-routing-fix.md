# Fix Local Model Chat Routing

Wire local model selection into the chat and completion pipeline so choosing a local model routes requests to it immediately. When local mode is off, leave the cloud path unchanged.

- Register the local provider and model from discovered local models when local mode is enabled, reusing existing client adapters.
- Route chat and completion requests to the selected local model while it is available.
- On a missing, corrupted, or unreachable model, show a friendly in-chat error and fall back gracefully without crashing or silently misrouting.
- Keep the persisted selected model ID consistent with the runtime provider and model ID used for requests.

Add tests for local routing, unchanged cloud behavior when disabled, and the friendly error fallback.
