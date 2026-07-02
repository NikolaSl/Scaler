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

By default it prepares only. Passing `execute` runs the task-agent subprocess. A successful task-agent run moves the task to `validating` and writes a validation handoff under `.scaler/reports/validation-handoffs.json`; a failed task-agent run moves the task to `failed` where valid. Executed task-agent runs are recorded under `.scaler/reports/task-agent-runs.json`.

`/scaler-step` runs under the repo-wide execution lock.

## `/scaler-validation-add <taskId> | <id> | <command> | <description> | <required>`

Adds or replaces one command in a task validation manifest.

Examples:

```text
/scaler-validation-add T-001 | test | npm test | Run tests | required
/scaler-validation-add T-001 | lint | npm run lint | Run lint | optional
```

`required` accepts true/yes/required/1 and false/no/optional/0. Unknown or omitted values default to required when saved.

## `/scaler-commit [taskId] | [allowed paths comma list]`

Commits a validated task using the git safety helper. Commits run under the repo-wide execution lock.

Selection rules:

1. explicit task id
2. current task if it is validated
3. first validated task

Allowed paths come from explicit command args or the task's stored allowed paths.

Examples:

```text
/scaler-commit T-001 | src,test
/scaler-commit
```

The command refuses commits when unrelated changes are detected, the task is not validated, or the project is not a git repository.

## `/scaler-validate [taskId]`

Runs validation for a task id, the current validating task, or the first validating task. Validation runs under the repo-wide execution lock.

Current behavior:

- uses a per-task validation manifest from `.scaler/reports/validation-manifests.json` when present
- otherwise falls back to default project commands from `package.json` scripts (`npm test`, `npm run build`)
- writes validation runs to `.scaler/reports/validation-runs.json`
- moves all-passing validating tasks to `validated`
- moves failing validating tasks to `debugging`

## `/scaler-pause [reason]`

Pauses the current Scaler run through the supervisor transition rules and writes a checkpoint under `.scaler/checkpoints/`.

## `/scaler-resume [reason]`

Resumes a paused run only to its previous active stage and writes a checkpoint under `.scaler/checkpoints/`.

## `/scaler-lock`

Shows the current repo-wide SCALER execution lock, or reports that no lock exists.

## `/scaler-lock-clear <reason>`

Manually clears the current execution lock and logs the reason. This is explicit manual recovery; SCALER does not automatically clear stale locks.

## `/scaler-runs [taskId]`

Lists recent task-agent run records. Optional `taskId` filters records.

Output includes status, exit code, timeout/abort flags, stdout event count, and stderr summary when present.

## `/scaler-tasks`

Lists all known supervisor tasks with status, current-task marker, title, allowed path metadata, dependencies, and runtime PRD refs when present.

## `/scaler-prd-status`

Shows runtime PRD requirement coverage from `.scaler/prd/requirements.json`, `.scaler/prd/coverage.json`, and task `prdRefs` links.

## `/scaler-plan-status`

Shows execution plan summary from `.scaler/plans/current-plan.json`, runtime PRD requirements, and supervisor task state.

## `/scaler-plan-apply`

Creates missing supervisor task records from `.scaler/plans/current-plan.json`. Existing tasks are preserved.

## `/scaler-replans`

Lists replan requests from `.scaler/plans/replan-requests.json`.

## `/scaler-replan-request <reason> | <taskId> | <evidence refs> | <PRD refs>`

Records a manual replan request and attempts to transition the supervisor stage to `replanning`.

## `/scaler-prd-link <taskId> | <REQ-001,REQ-002>`

Links an existing task to runtime PRD requirement ids by updating the task's `prdRefs` metadata.

## `/scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list> | <PRD refs comma list>`

Creates a supervisor task record.

Examples:

```text
/scaler-task-create T-001 | Add parser tests | src,test
/scaler-task-create T-002 | Add dependent task | src | T-001
/scaler-task-create T-003
```

Allowed paths are used later for safe per-task git commits. Dependencies prevent the conductor from selecting a task until all listed task ids are validated. PRD refs link the task to runtime PRD requirements for coverage/replanning summaries.

## `/scaler-task-retry <taskId> | <reason>`

Retries a task through deterministic supervisor task transitions:

- `debugging` -> `running`
- `blocked` -> `ready`
- `needs_replan` -> `ready`

Terminal `failed` tasks are rejected by current retry rules.

## `/scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies> | <PRD refs>`

Updates task metadata. If `status` is provided, the update must be a valid supervisor task transition.

Examples:

```text
/scaler-task-update T-001 | Better title
/scaler-task-update T-001 | | ready | src,test | T-000
/scaler-task-update T-001 | | | | | REQ-001,REQ-002
```

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
- workflow summary with current task, next recommended action, hints, and warnings
