# TUI Agent Behavior Control System

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Build a complete TUI-only agent behavior control system in the current repository. Users must be able to change how the parent and every subagent behave entirely through in-app settings (e.g. `/settings`) with no CLI flags, shell commands, or hidden config-file edits required.

## Before editing
- Inspect the existing settings UI, config schemas, provider/model selection, session rendering, tool-call display, thinking display, agent/subagent wiring, persistence, and tests.
- Reuse existing settings/patterns where possible and remove duplication.
- Follow repository architecture boundaries (e.g. schema/core/protocol/server/UI separation), persistence conventions, and generated/vendored file rules.
- Delegate complex implementation to subagents when useful, then independently verify their work. Do not weaken tests.

## Required capabilities

### 1. Behavior profiles
- Add quick-switch profiles (e.g. Calm, Quick, Expert, Careful, Creative).
- One-action profile switching controls defaults for model choice, verbosity, reasoning, autonomy, safety, tool visibility, and thinking visibility.
- Users can override individual settings without losing the active profile.

### 2. Parent and subagent controls
- Discover available agent types dynamically.
- Provide controls for parent/main agent and each available subagent type: selected model, profile or "inherit parent", reasoning budget, verbosity, autonomy/safety, tool visibility, thinking visibility, and tool access where configurable.
- Show parent and subagent settings separately, with an option to apply a preset to all agents.

### 3. Thinking and reasoning
- Expose understandable controls for reasoning budget (e.g. Off/Low/Medium/High/Maximum), thinking display (Hidden/Summary/Full), parent/subagent visibility, reasoning summaries (without exposing raw chain-of-thought), and max reasoning time/effort where supported.
- Map controls only to supported runtime/config fields or add properly typed, persisted fields. Never add fake controls with no effect.

### 4. Tool-call and session visibility
- Controls for tool calls/results, subagent activity, reasoning blocks in transcript, tool status/progress/stderr/expanded output where applicable, and an optional "show everything" troubleshooting preset.
- Changes must affect the live session and persist across restarts.

### 5. Autonomy, safety, and communication
- Simple choices for read-only / ask-before-changes / auto-approve low-risk / auto-approve trusted actions (as supported), destructive-action confirmation, answer verbosity, proactive questions vs autonomous continuation, and beginner-friendly vs technical explanations.
- Safety settings must override behavior profiles.

### 6. Settings audit
- Audit all meaningful user-facing config/runtime options. Anything important not in settings must be added or grouped under an Advanced disclosure.
- Include search, descriptions, reversible Apply/Undo/Cancel, reset-to-default, and immediate feedback.

## UX requirements
- Mouse/click-first, keyboard as courtesy.
- Plain language labels; no terminal commands or config paths required.
- Beginner help text for advanced options.
- Every action reversible; errors explain what happened and offer one clear fix.

## Validation
- Add tests where logic lives (profiles, overrides, reasoning/visibility mapping, persistence, empty/error states).
- Run relevant typecheck, lint, focused tests, rebuild/relink, and smoke tests as required by the repo. Report "landed" only with commit hash and quoted validation output.
