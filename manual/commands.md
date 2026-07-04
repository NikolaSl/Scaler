# Commands

All registered SCALER commands write command audit events to `.scaler/logs/events.jsonl` with full command detail records under `.scaler/logs/details/`.

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

## `/scaler-validation-add <taskId> | <id> | <command> | <description> | <required> | <gate> | <expected> | <evidence refs>`

Adds or replaces one command in a task validation manifest.

Examples:

```text
/scaler-validation-add T-001 | test | npm test | Run tests | required | unit | exits 0 | tests:T-001
/scaler-validation-add T-001 | lint | npm run lint | Run lint | optional | static_checks | exits 0
```

`required` accepts true/yes/required/1 and false/no/optional/0. Unknown or omitted values default to required when saved. Gate aliases are normalized to typed values such as `unit_tests`, `build_compile`, `static_checks`, `integration_tests`, `security_checks`, `acceptance_smoke`, and non-software evidence gates such as `completeness`, `consistency`, `compliance`, `source_validation`, `adversarial_review`, and `uncertainty_report`.

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

## `/scaler-validate-loop [taskId] [execute] [max=N]`

Runs validation first and, only if validation fails and the task becomes `debugging`, starts `/scaler-debug-loop` after the validation execution lock is released. Validation always executes; the optional `execute` flag controls whether the debug loop executes child agents or only prepares the first handoff. The workflow does not auto-accept replans.

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

## `/scaler-storage-status`

Scans `.scaler/`, writes `.scaler/storage/index.json`, updates the `storageBytes` budget counter, and shows total bytes, top-level summaries, largest files, and the storage budget decision. A configured `storageBytes` hard limit pauses the run through the existing budget gate.

## `/scaler-budget-status`

Shows state-backed budget usage, soft/hard limits, checkpoint count, and the strongest current budget decision.

## `/scaler-budget-set <key> | <soft> | <hard>`

Persists a budget limit in `.scaler/state.json`. Supported keys are `toolCalls`, `spawnedAgents`, `debugAttempts`, `wallClockMs`, `checkpoints`, `contextTokens`, `validationLoops`, `storageBytes`, `researchReports`, and `estimatedCostMicros`. Use `-` to clear one side while setting the other side.

Examples:

```text
/scaler-budget-set validationLoops | 2 | 3
/scaler-budget-set estimatedCostMicros | - | 500000
```

## `/scaler-lock`

Shows the current repo-wide SCALER execution lock, or reports that no lock exists.

## `/scaler-lock-clear <reason>`

Manually clears the current execution lock and logs the reason. This is explicit manual recovery; SCALER does not automatically clear stale locks.

## `/scaler-runs [taskId]`

Lists recent task-agent run records. Optional `taskId` filters records.

Output includes status, exit code, timeout/abort flags, stdout event count, and stderr summary when present.

## `/scaler-tasks`

Lists all known supervisor tasks with status, current-task marker, title, allowed path metadata, dependencies, and runtime PRD refs when present.

## `/scaler-context-init [taskId]`

Creates a default task context manifest under `.scaler/context/tasks/<taskId>.json`. Missing manifests include discovered context from changed files, execution plans, PRD coverage, validation history, and ranked memory matches when available.

## `/scaler-context-status [taskId]`

Shows the task context manifest summary for a task.

## `/scaler-stage-status`

Shows latest Stage I-IV artifact status from `.scaler/stages/stage-artifacts.json`.

## `/scaler-stage-validate <stage>`

Validates readiness of the latest recorded artifact for a stage.

## `/scaler-stage-advance <stage>`

Advances the supervisor stage after validating stage artifact readiness, deterministic stage-specific semantics, and available cross-artifact consistency gates.

## `/scaler-stage-step [execute]`

Runs one deterministic stage-conductor step for the current supervisor stage. If a ready, semantically valid, and consistent artifact already exists for the active stage, SCALER validates and advances it. Otherwise SCALER prepares the matching focused stage agent; with `execute`, it runs the agent, ingests a valid `scaler_stage_artifact` JSON event, and attempts advancement.

## `/scaler-stage-loop [execute] [max=N]`

Runs bounded deterministic stage-conductor steps, carrying forward supervisor state after every successful advancement. Stops on completion, max steps, unsupported stages, rejected steps, prepare-mode handoff, or executed stage-agent output that does not advance. Default max is 5 and bounds normalize to 1..20.

## `/scaler-stage-run <stage> [execute]`

Prepares or executes a focused stage-agent subprocess for `prd`, `knowledge`, `planning`, `execution`, or `replanning`. Successful executed runs ingest a valid `scaler_stage_artifact` JSON event and attempt ready-artifact advancement automatically.

## `/scaler-stage-runs [stage]`

Lists stage-agent run records from `.scaler/reports/stage-agent-runs.json`.

## `/scaler-stage-record <stage> | <status> | <title> | <path> | <summary> | <evidence refs> | <PRD refs> | <task refs>`

Records a normalized stage artifact for `prd`, `knowledge`, `planning`, `execution`, or `replanning`.

## `/scaler-prd-status`

Shows runtime PRD requirement coverage from `.scaler/prd/requirements.json`, `.scaler/prd/coverage.json`, and task `prdRefs` links.

## `/scaler-plan-status`

Shows execution plan summary from `.scaler/plans/current-plan.json`, runtime PRD requirements, and supervisor task state.

## `/scaler-plan-apply`

Creates missing supervisor task records from `.scaler/plans/current-plan.json`. Existing tasks are preserved.

## `/scaler-replans`

Lists replan requests from `.scaler/plans/replan-requests.json`.

## `/scaler-replan-run [execute]`

Prepares or executes the focused replanner agent. With `execute`, SCALER ingests a valid `scaler_replan_proposal` JSON event and saves `.scaler/plans/proposed-plan.json` for preservation-gated review.

## `/scaler-replan-runs`

Lists replanner-agent run records from `.scaler/reports/replan-agent-runs.json`.

## `/scaler-debug-run [taskId] [execute]`

Prepares or executes the focused debug agent for a selected debugging task. With `execute`, SCALER ingests a valid `scaler_debug_report` JSON event and stores it under `.scaler/debug/reports.json`.

Debug report statuses:

- `next_approach` records an evidence-backed untried approach.
- `needs_research` creates research requests.
- `needs_replan` and `blocked` create debug-blocked replan requests.

## `/scaler-debug-loop [taskId] [execute] [max=N]`

Runs a bounded deterministic debug conductor for a debugging task. The loop selects the explicit task, current debugging task, or first debugging task.

Current behavior:

- runs the focused debug agent when no task-local research or debug replan request is open;
- runs the focused research agent when a task-local research request is open;
- runs the focused replanner agent when a task-local debug-cycle/debug-blocked replan request is open;
- stops on prepare-mode handoff, rejected ingestion, `next_approach`, proposed replan generation, missing task, or max steps;
- does **not** accept proposed replans automatically.

Default max is 5 and bounds normalize to 1..20.

## `/scaler-debug-runs [taskId]`

Lists debug-agent run records from `.scaler/reports/debug-agent-runs.json`.

## `/scaler-debug-reports`

Lists debug reports from `.scaler/debug/reports.json`.

## `/scaler-research-run [requestId] [execute] [internet] [tools=a,b]`

Prepares or executes the focused research agent for a selected request or the oldest open request. With `execute`, SCALER ingests a valid `scaler_research_report` JSON event and stores the report under `.scaler/research/reports.json`.

For `internet` or `mixed` requests, tools are withheld unless both an explicit `internet` grant and a `tools=a,b` list are supplied. Without the grant, the prompt instructs the agent to produce a `partial`/`blocked` report rather than pretending web access exists. Only listed tools are passed to the subprocess.

Example:

```text
/scaler-research-run RESEARCH-001 execute internet tools=browser,mcp-docs
```

## `/scaler-research-runs [requestId]`

Lists research-agent run records from `.scaler/reports/research-agent-runs.json`.

## `/scaler-research-status`

Shows research request/report counts and recent open requests/reports from `.scaler/research/`.

## `/scaler-research-request <question> | <reason> | <taskId> | <PRD refs> | <scope>`

Creates a research request. `scope` is `local`, `internet`, or `mixed`.

## `/scaler-research-report <question> | <conclusion> | <confidence> | <sourceId> | <sourceTitle> | <sourceQuality> | <sourceRef> | <requestId> | <taskId> | <PRD refs>`

Records a compact research report with one source and one conclusion. Use `scaler_research_report` for richer reports with contradictions and raw evidence.

## `/scaler-replan-proposal-status`

Shows preservation status for `.scaler/plans/proposed-plan.json` against the current plan, runtime PRD, and supervisor state.

## `/scaler-replan-accept`

Accepts `.scaler/plans/proposed-plan.json` only when preservation checks pass, snapshots the previous plan, saves the proposal as current, applies missing tasks, resolves open replan requests, and records a decision.

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
