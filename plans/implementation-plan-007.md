# SCALER Implementation Plan 007

## Purpose

Phase 7 adds user-facing workflow commands and task metadata needed to complete the first practical supervised loop from task creation through validation and git progress commit.

This plan must be committed before implementation.

## Tasks

### IMPL-031: Add task allowed path metadata

Definition of Done:

- Extend task state with `allowedPathPrefixes`.
- `createTask` and `scaler_task_create` accept allowed paths.
- Task prompt includes allowed paths when present.
- Unit tests cover persistence and prompt rendering.

### IMPL-032: Add validation manifest write tool

Definition of Done:

- Add `scaler_validation_manifest_write` tool.
- Tool persists validation commands for a task using existing manifest storage.
- Unit tests cover tool registration and manifest persistence helper.
- Manual documents current tool behavior.

### IMPL-033: Add `/scaler-task-create` command

Definition of Done:

- Register `/scaler-task-create <taskId> | <title> | <allowed paths comma list>`.
- Command creates a task record with optional title and allowed paths.
- Unit tests cover parser behavior and command registration.
- Manual documents command behavior.

### IMPL-034: Add `/scaler-commit` command

Definition of Done:

- Register `/scaler-commit [taskId] [allowed paths comma list]`.
- If task id is omitted, select current validated task or first validated task.
- Use task allowed paths unless paths are explicitly provided.
- Refuse unsafe commits using existing git helper.
- Unit tests cover task/path selection helper and command registration.
- Manual documents command behavior.

### IMPL-035: Add `/scaler-tasks` command

Definition of Done:

- Register `/scaler-tasks` command.
- Show compact task list with id, status, title, and allowed paths.
- Unit tests cover task list formatting and command registration.
- Manual documents command behavior.

## Validation

After each task:

- `npm test`
- `npm run build`

Each task must be committed separately.
