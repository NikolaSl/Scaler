# Implementation Plan 017 — Task Context Manifests

## Goal

Continue closing GAP-002 by replacing purely ad hoc context inputs with deterministic per-task context manifests that can resolve state, task metadata, files, memory refs, validation manifests, and explicit omissions into task-agent prompts.

## Scope

- Add `.scaler/context/tasks/<taskId>.json` manifest storage.
- Add schema, validation, save/load, default manifest creation, and formatting helpers.
- Resolve manifest entries into `ContextItem`s from inline content, files, memory, state, task metadata, PRD refs, and validation manifests.
- Integrate manifests into conductor prompt creation.
- Add commands to initialize and inspect task context manifests.
- Update manual and traceability artifacts.

## Atomic tasks

### IMPL-077 — Context manifest artifact storage

- Add context path helpers.
- Add task context manifest types, validation, load/save/default helpers.
- Add tests for defaults, round trip, and validation failures.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-078 — Context manifest source resolution

- Resolve manifest sources into context items from inline content, files, memory, supervisor state, task metadata, PRD refs, and validation manifests.
- Preserve omitted/unresolvable entries as context items describing missing context.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-079 — Conductor manifest integration

- When no explicit `contextItems` are supplied, the conductor loads or creates the task context manifest and resolves it for the task-agent prompt.
- Add tests that prompts include manifest-derived file/memory/validation context.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-080 — Context manifest commands

- Add `/scaler-context-init` and `/scaler-context-status` commands.
- Add command parsing/tests and extension registration tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-081 — Documentation and traceability

- Document context manifests and commands.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
