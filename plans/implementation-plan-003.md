# SCALER Implementation Plan 003

## Purpose

Phase 3 connects Scaler's current building blocks into a minimal supervised workflow.

This plan must be committed before implementation.

## Tasks

### IMPL-011: Add report schemas and stronger validation

Definition of Done:

- Define typed report transition schemas.
- Validate stage/task transition values before applying.
- Return clear rejected-report reasons without corrupting state.
- Unit tests cover invalid report values and valid report ingestion.

### IMPL-012: Connect task spawn tool to subprocess execution

Definition of Done:

- `scaler_spawn_task` supports `execute: true`.
- Captures subprocess result.
- Logs prepared/executed task spawn result.
- Supports timeout parameter.
- Unit tests cover parameter behavior without requiring real Pi execution.

### IMPL-013: Add task creation tool/path

Definition of Done:

- Add deterministic task creation helper.
- Add `scaler_task_create` tool.
- Persist task records in supervisor state.
- Reject duplicate task ids.
- Unit tests cover task creation and duplicate handling.

### IMPL-014: Add validation report state integration

Definition of Done:

- `scaler_validation_report` applies task state transitions.
- `passed` can move validating/debugging task to validated.
- `failed` can move validating task to debugging.
- `blocked` can move running/validating task to blocked where valid.
- Unit tests cover validation-driven transitions.

### IMPL-015: Add status summary improvements

Definition of Done:

- `/scaler-status` includes task status counts.
- Status includes rejected transition count.
- Status includes memory count.
- Status includes log path.
- Unit tests cover summary formatting.

## Validation

After each task:

- `npm test`
- `npm run build`

Each task must be committed separately.
