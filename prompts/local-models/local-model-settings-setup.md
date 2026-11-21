# Local Model Setup in Settings (Easy Mode)

Implement a local-model feature that lets users run LLMs on their own machine with minimal setup through in-app settings.

## Goal
Users can toggle local mode on/off, pick a locally available model, and start chatting with it. If model files already exist on disk, auto-detect them without manual path entry.

## User outcomes
- **Toggle:** settings control to enable/disable local model usage.
- **Picker:** when enabled, list detected local models with useful metadata (name, size, format/path) and status (Ready/Loading/Error/Not Found).
- **Auto-detect:** scan common/default model locations on open/rescan for known model formats.
- **Seamless chat:** selected local model is used for chat immediately; disabling local mode restores previous cloud/remote behavior unchanged.
- **Empty state:** clear actions to add a model folder, rescan, download/recommend (if supported), or stay on existing provider.
- **Persistence:** local mode and selected model persist across restarts.

## Technical requirements
- **Settings UI:** toggle, model selector, status badges, rescan action, and add-folder/download affordances as applicable.
- **Discovery service:** configurable scan directories, metadata extraction, no manual path typing required for defaults.
- **Inference routing:** abstract local and remote backends behind a common interface; route based on settings/state; load/unload safely (avoid keeping multiple large models in memory when possible).
- **State/storage:** persist selection using existing settings/config mechanisms.
- **Error handling:** missing/corrupt/load failures show friendly UI messages and fall back gracefully.

## Deliverables
- Settings UI updates, discovery service, local inference adapter/routing integration, and types/interfaces for local models/providers.
- Brief documentation: where to place model files and supported formats/engines.

## Verification
- Toggle persists and controls routing.
- Auto-detection finds supported models in default folders.
- Selecting a model routes chat locally; disabling returns to prior behavior.
- Errors are user-friendly and non-crashing.
- Run relevant tests/typecheck/lint/build/smoke checks and report results.
