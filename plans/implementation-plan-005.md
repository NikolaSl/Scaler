# SCALER Implementation Plan 005

## Purpose

Phase 5 adds a minimal deterministic conductor loop around existing task, context, spawn, validation, and checkpoint primitives.

This is not the full autonomous Stage I-IV workflow yet. It creates the first supervised execution step that can select one task, resolve its context, prepare/optionally execute an isolated task agent, hand off to validation, and checkpoint progress.

This plan must be committed before implementation.

## Tasks

### IMPL-021: Add deterministic next-task selection

Definition of Done:

- Add helper that selects the next task in stable order.
- Prefer `ready` tasks, then promote/select `pending` tasks.
- Ignore terminal or blocked tasks.
- Return clear no-task reasons.
- Unit tests cover ready, pending, blocked, validated, and empty states.

### IMPL-022: Add task prompt/context builder

Definition of Done:

- Build task-agent prompt from supervisor task state and resolved context.
- Include task id, title, current status, validation/report instructions, and selected context.
- Support caller-supplied context items and token budget.
- Unit tests cover prompt content and context omission behavior.

### IMPL-023: Add one-step conductor execution helper

Definition of Done:

- Add `runConductorStep` helper.
- It selects/promotes one task, transitions it to `running`, prepares a spawn invocation, and optionally executes the task agent.
- It logs the conductor decision and writes a checkpoint.
- Unit tests cover prepare-only and execute paths using an injected fake runner.

### IMPL-024: Add validation handoff artifact

Definition of Done:

- Successful executed task-agent run moves task from `running` to `validating`.
- Failed executed task-agent run moves task to `failed` where valid.
- Write validation handoff records under `.scaler/reports/validation-handoffs.json`.
- Unit tests cover success and failure handoffs.

### IMPL-025: Add `/scaler-step` command

Definition of Done:

- Register `/scaler-step` command for one minimal conductor step.
- Default behavior prepares, but does not execute, the task agent.
- `execute` argument enables execution.
- Manual documents current conductor-step behavior.
- Unit tests cover command registration.

## Validation

After each task:

- `npm test`
- `npm run build`

Each task must be committed separately.
