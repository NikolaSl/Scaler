# SCALER Implementation Plan 006

## Purpose

Phase 6 adds deterministic validation execution and git progress safety helpers after the minimal conductor step.

The goal is to close the first useful supervised loop:

`task_create -> scaler-step execute -> validation handoff -> scaler-validate -> validated -> git commit`

This plan must be committed before implementation.

## Tasks

### IMPL-026: Add validation manifest model

Definition of Done:

- Define typed validation manifest and validation command models.
- Persist manifests under `.scaler/reports/validation-manifests.json`.
- Support per-task manifests and default project validation commands.
- Unit tests cover writing, loading, and fallback defaults.

### IMPL-027: Add validation command runner

Definition of Done:

- Run validation commands with optional timeout.
- Capture exit code, stdout/stderr summaries, and command status.
- Persist validation run records under `.scaler/reports/validation-runs.json`.
- Automatically apply validation reports: all pass -> `validated`, any fail -> `debugging` where valid.
- Unit tests cover passing and failing validation using safe local commands.

### IMPL-028: Add `/scaler-validate` command

Definition of Done:

- Register `/scaler-validate [taskId]` command.
- If task id is omitted, validate current validating task or first validating task.
- Use manifest if present, otherwise default project checks.
- Manual documents current validation command behavior.
- Unit tests cover command registration.

### IMPL-029: Add git status safety helper

Definition of Done:

- Detect whether working tree is clean.
- Detect runtime-only `.scaler/` changes.
- Detect unrelated user changes outside allowed task paths.
- Return deterministic safety decisions without mutating git state.
- Unit tests cover clean, runtime-only, allowed, and unrelated changes using temporary git repositories.

### IMPL-030: Add per-task commit helper

Definition of Done:

- Commit validated task changes with message format `TASK-ID: short title`.
- Exclude `.scaler/` runtime data from commits.
- Refuse commit if unrelated changes are detected.
- Persist/log commit result details.
- Unit tests cover refusal behavior and successful commit in a temporary git repository.

## Validation

After each task:

- `npm test`
- `npm run build`

Each task must be committed separately.
