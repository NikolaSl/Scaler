# SCALER Git Workflow Spec

## Purpose

Scaler should make project progress visible and recoverable through git history.

Every project should be a git repository unless this is explicitly disabled or impossible.

## Repository setup

At the beginning of a Scaler run:

1. Check whether the active project is inside a git repository.
2. If not, initialize git when allowed.
3. Create or update ignore rules for Scaler runtime data when needed.
4. Record the initial git status in logs.

Scaler must not silently mix unrelated existing user changes with its own task commits.

If the repository has unrelated dirty changes before a task starts, Scaler should either:

- ask for approval,
- create an explicit checkpoint when allowed,
- or pause with a clear report.

## Runtime data

Large Scaler runtime data should not be committed by default.

Usually ignore:

- `.scaler/logs/`
- `.scaler/cache/`
- large `.scaler/artifacts/`
- compressed raw outputs

Commit only project changes and intentional lightweight Scaler files when useful, such as plans, reports, or configuration.

## Task commits

Each validated task should create a git commit when it changes project files.

Commit only after:

1. task output exists,
2. required validation gates pass,
3. task report is written,
4. unrelated changes are excluded.

Commit message format:

```text
<TASK_ID>: <short meaningful message>
```

Example:

```text
T-004: add config parser validation tests
```

The commit body may include:

- task summary
- validation results
- important report paths
- known risks

## Commit rules

- One task should usually produce one commit.
- Do not commit failed attempts unless explicitly useful and approved.
- Do not commit secrets or unsafe generated files.
- Do not include unrelated files.
- If a task has no file changes, record this in the task report instead of creating an empty commit unless configured.

## State and reports

After committing, record in supervisor state and task report:

- task id
- commit hash
- commit message
- changed files
- validation report reference

## Replanning and meta commits

If Stage II/III outputs are updated during replanning, commit them separately when they are project artifacts.

Use clear messages such as:

```text
PLAN-002: update execution plan after T-004 blocker
```

## Logging

Log repository initialization, git status checks, commits, skipped commits, commit failures, and dirty working tree blockers according to `specs/logging.md`.
