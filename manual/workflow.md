# Implemented Workflow

This page documents the current happy path implemented by SCALER.

SCALER operations are sequential per repository. Task steps, task-agent executions, validation, and commits use `.scaler/locks/execution-lock.json` and are refused while another SCALER operation holds the lock.

## 1. Start or inspect a run

```text
/scaler <request>
/scaler-status
```

`/scaler` creates or loads `.scaler/state.json`, selects an adaptive complexity level, and logs the request. `/scaler-status` shows supervisor state plus a deterministic workflow summary.

## 2. Create tasks

```text
/scaler-task-create T-001 | Add parser tests | src,test
/scaler-task-create T-002 | Add dependent work | src | T-001
/scaler-tasks
```

Tasks may include allowed paths for later commit safety and dependency ids. The conductor will not select a task until its dependencies are validated.

## 3. Optionally add validation commands

```text
/scaler-validation-add T-001 | test | npm test | Run tests | required
```

If no task manifest exists, validation falls back to supported `package.json` scripts (`npm test`, `npm run build`).

## 4. Run one conductor step

```text
/scaler-step
/scaler-step execute
```

Without `execute`, SCALER prepares the isolated task-agent invocation and writes a checkpoint. With `execute`, it runs the task-agent subprocess and records the run under `.scaler/reports/task-agent-runs.json`. A successful task-agent run moves the task to `validating`; a failed run moves it to `failed` when that transition is valid.

Inspect execution records with:

```text
/scaler-runs
/scaler-runs T-001
```

## 5. Validate

```text
/scaler-validate T-001
/scaler-validate
```

Validation runs the task manifest commands and records results under `.scaler/reports/`. Passing validation moves a validating/debugging task to `validated`; failing validation moves a validating task to `debugging`.

## 6. Commit validated work

```text
/scaler-commit T-001
/scaler-commit
```

Commits are allowed only for validated tasks. The git helper refuses commits when unrelated changes are present, when a task is not validated, or when the project is not a git repository. Allowed paths come from task metadata or explicit command arguments.

## Useful maintenance commands

```text
/scaler-task-update T-001 | Better title | ready | src,test | T-000
/scaler-task-retry T-001 | retry after fixing blocker
/scaler-pause manual pause
/scaler-resume manual resume
```

Task status updates and retries must follow deterministic supervisor transition rules.
