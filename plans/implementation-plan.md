# SCALER Implementation Plan

## Rule

Build Scaler in atomic, validated, committed tasks.

Each implementation task must:

- Keep the project buildable/testable.
- Include or update tests where practical.
- Update manual/docs only for implemented behavior.
- Update traceability artifacts when it changes requirement coverage: `dev-progress-tracker/implementation-inventory.md`, `dev-progress-tracker/traceability-matrix.md`, and when applicable `dev-progress-tracker/gap-backlog.md`.
- Commit with task id and short message.

## Initial tasks

### IMPL-001: Project skeleton

Create TypeScript package structure, minimal Pi extension entrypoint, state helpers, tests, and build/test scripts.

Definition of Done:

- `npm test` passes.
- `npm run build` passes.
- Extension exports a Pi extension factory.
- `/scaler-status` command is registered.

### IMPL-002: Supervisor state core

Implement deterministic state model, load/save, default state, and basic transition validation.

Definition of Done:

- Unit tests cover state creation, persistence, and valid/invalid transitions.
- Manual documents state file location.

### IMPL-003: Structured logging core

Implement append-only `.scaler/logs/events.jsonl` writer and basic event types.

Definition of Done:

- Unit tests cover event writing and JSONL format.
- `/scaler-status` shows log path.

### IMPL-004: Safety gate skeleton

Add basic tool-call safety interception for protected paths and destructive shell commands.

Definition of Done:

- Unit tests cover policy decisions.
- Manual documents current safety behavior.

### IMPL-005: Task-agent spawn skeleton

Implement minimal isolated Pi subprocess runner for a generated task prompt.

Definition of Done:

- Unit tests cover command construction.
- Manual documents experimental task-agent behavior.
