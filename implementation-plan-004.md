# SCALER Implementation Plan 004

## Purpose

Phase 4 starts replacing remaining prompt-only reliability controls with deterministic runtime mechanisms.

This plan must be committed before implementation.

## Tasks

### IMPL-016: Persist debug attempts and reject repeated loops

Definition of Done:

- Add persistent debug failure/attempt records under `.scaler/debug/`.
- `scaler_debug_attempt` validates attempt result values and stores accepted attempts.
- Repeated failed attempts with the same task, failure, signature, and failure fingerprint are rejected unless new evidence is supplied.
- Cycle detection reports when recent attempts move between known failure fingerprints.
- Unit tests cover accepted attempts, invalid result rejection, duplicate rejection, and new-evidence override.

### IMPL-017: Add budget usage skeleton

Definition of Done:

- Add typed budget usage/limit helpers for tool calls, spawned agents, debug attempts, and wall-clock checkpoints.
- Log soft-limit and hard-limit decisions.
- Hard-limit decisions can transition the run to `paused` where valid.
- Unit tests cover budget increments and limit decisions.

### IMPL-018: Add pause/resume/checkpoint commands

Definition of Done:

- Add `/scaler-pause` command that applies a valid pause transition and logs a checkpoint.
- Add `/scaler-resume` command that resumes only to the previous active stage.
- Add checkpoint file writing under `.scaler/checkpoints/`.
- Unit tests cover command registration and checkpoint helper behavior.

### IMPL-019: Add isolated tool request skeleton

Definition of Done:

- Add `scaler_tool_request` tool for structured isolated tool/MCP requests.
- Persist and log tool-request records.
- Prepare isolated tool-agent spawn prompts without exposing all tools by default.
- Unit tests cover request persistence and prompt construction.

### IMPL-020: Add status details for debug and budgets

Definition of Done:

- `/scaler-status` includes debug attempt/failure counts.
- `/scaler-status` includes known budget usage counts.
- Status formatting remains compact.
- Unit tests cover new summary fields.

## Validation

After each task:

- `npm test`
- `npm run build`

Each task must be committed separately.
