# Commands

## `/scaler <request>`

Starts a minimal adaptive Scaler run.

Current behavior:

- creates/loads `.scaler/state.json`
- selects a complexity level from the request text
- moves supervisor state to the initial stage for that level
- logs the request to `.scaler/logs/events.jsonl`
- shows compact status

This is an early entrypoint. It does not yet execute the full Stage I-IV workflow.

## `/scaler-step [execute]`

Runs one minimal deterministic conductor step.

Current behavior:

- selects the next `ready` task, or promotes/selects the first `pending` task
- transitions the task to `running`
- builds a task-agent prompt from resolved context
- prepares an isolated Pi task-agent invocation
- writes a checkpoint under `.scaler/checkpoints/`

By default it prepares only. Passing `execute` runs the task-agent subprocess. A successful task-agent run moves the task to `validating` and writes a validation handoff under `.scaler/reports/validation-handoffs.json`; a failed task-agent run moves the task to `failed` where valid.

## `/scaler-pause [reason]`

Pauses the current Scaler run through the supervisor transition rules and writes a checkpoint under `.scaler/checkpoints/`.

## `/scaler-resume [reason]`

Resumes a paused run only to its previous active stage and writes a checkpoint under `.scaler/checkpoints/`.

## `/scaler-status`

Creates/loads `.scaler/state.json`, logs the status request, and shows:

- current stage and complexity level
- validated task count
- task status counts
- rejected transition count
- memory count
- debug failure and attempt counts
- known budget usage counts
- event log path
