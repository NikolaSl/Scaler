# Implemented Workflow

This page documents the current happy path implemented by SCALER.

SCALER operations are sequential per repository. Task steps, task-agent executions, validation, and commits use `.scaler/locks/execution-lock.json` and are refused while another SCALER operation holds the lock.

## 1. Start or inspect a run

```text
/scaler <request>
/scaler-status
```

`/scaler` creates or loads `.scaler/state.json`, selects an adaptive complexity level, and logs the request. `/scaler-status` shows supervisor state plus a deterministic workflow summary, including stage-artifact recommendations when a PRD, knowledge, planning, or replanning stage lacks a ready artifact. `/scaler-adapt [apply]` can reassess during a run and, when requested, update complexity or move through a valid supervisor transition based on failures, blockers, uncertainty, and budgets.

Stage outputs can be advanced one deterministic step at a time or through a bounded loop with:

```text
/scaler-stage-step
/scaler-stage-step execute
/scaler-stage-loop max=5
/scaler-stage-loop execute max=5
/scaler-stage-status
/scaler-stage-runs planning
```

Lower-level stage commands are also available:

```text
/scaler-stage-run planning
/scaler-stage-record planning | ready | Execution plan | .scaler/plans/current-plan.json | Initial plan
/scaler-stage-validate planning
/scaler-stage-advance planning
```

## 2. Create or apply tasks

Tasks can be created directly:

```text
/scaler-task-create T-001 | Add parser tests | src,test | | | tests pass; parser behavior documented
/scaler-task-create T-002 | Add dependent work | src | T-001 | REQ-002 | dependency validated
/scaler-tasks
```

Or created from the current execution plan artifact:

```text
/scaler-plan-status
/scaler-plan-apply
```

Tasks may include allowed paths for later commit safety, dependency ids, runtime PRD refs, and Definition of Done items. The conductor will not select a task until its dependencies are validated. Runtime PRD refs are shown by `/scaler-prd-status` and help identify which requirements have validated task coverage. Task creation/update records non-blocking quality warnings when DoD, task-specific validation, or allowed paths are missing; recompute them with `/scaler-task-quality [taskId]`.

## 3. Optionally add validation commands

```text
/scaler-validation-add T-001 | test | npm test | Run tests | required | unit | exits 0 | tests:T-001 | host
```

Validation commands can carry typed gate metadata (`dependency_check`, `test_first`, `unit_tests`, `build_compile`, `static_checks`, `integration_tests`, `security_checks`, `acceptance_smoke`, `regression`, or non-software gates such as `completeness`, `consistency`, `compliance`, `source_validation`, `adversarial_review`, and `uncertainty_report`), expected results, and evidence references. If no task manifest exists, validation falls back to supported `package.json` scripts and classifies common scripts such as `test`, `build`, `lint`, `typecheck`, `format:check`, `test:integration`, `smoke`, and `audit` into typed gates.

Before running validation commands, SCALER evaluates manifest ordering, environment policy, and skipped/blocked dispositions. Required `dependency_check` commands must appear before non-policy validation gates, and required `test_first` commands must appear before implementation gates. Missing dependency/test-first gates on implementation-only manifests are warnings for compatibility; misordered required gates are failures and create a failed validation run without executing blocked commands. Required `local_ci` gates and Docker/Compose/dev-container/Minikube commands must declare non-host environment metadata (`docker`, `compose`, `devcontainer`, `minikube`, or `local_ci`) so sandbox-like validation is explicit rather than silently treated as host execution. Declared non-host environments are lifecycle-managed: SCALER probes/prepares the environment before command execution, blocks required commands when required external tooling is unavailable, records prepare evidence, and records cleanup evidence after execution under `.scaler/reports/validation-environments.json`. Required skipped gates are accepted only with an explicit reason and are recorded without executing their commands; blocked gates require a reason and required blocked gates create a blocked validation run/task state.

For non-software gates, `/scaler-validation-checklist` records deterministic checklist items under `.scaler/reports/validation-checklists.json` and applies the rolled-up result: required failed items fail, required blocked items block, and optional failures remain evidence without failing the checklist. Acceptance/completeness/compliance/source/adversarial gates require evidence for required passed items; missing item-level evidence is allowed only when checklist-level evidence refs are supplied, otherwise the checklist fails deterministically.

## 4. Run one conductor step

```text
/scaler-step
/scaler-step execute
```

Without `execute`, SCALER prepares the isolated task-agent invocation and writes a checkpoint. With `execute`, it runs the task-agent subprocess and records the run under `.scaler/reports/task-agent-runs.json`. A successful task-agent run must emit a structured `scaler_task_report`; only status `completed` moves the task to `validating`. Missing/invalid reports or blocked/needs-data/needs-replan report statuses keep the task out of validation, and accepted reports are stored under `.scaler/reports/task-agent-reports.json`. A failed subprocess run moves the task to `failed` when that transition is valid.

The conductor refuses a selected task before locking when the debug retry gate finds unresolved repeated failed fingerprints, blocked debug attempts, or debug cycles, including longer hidden cycles such as A→B→C→A. Record `newEvidence` through `scaler_debug_attempt`, run `/scaler-debug-run [taskId] execute` to obtain a structured next approach/research/replan decision, or accept/resolve the related debug replan request before retrying.

Inspect execution records with:

```text
/scaler-runs
/scaler-runs T-001
```

## 5. Validate

```text
/scaler-validate T-001
/scaler-validate
/scaler-validate-loop T-001 execute max=5
```

Validation runs the task manifest commands and records results under `.scaler/reports/`. Non-host environment lifecycle records can be inspected with `/scaler-validation-envs`. Passing validation moves a validating/debugging task to `validated`; failing validation moves a validating task to `debugging`; blocked validation moves the task to `blocked` and requests replanning where stage rules allow. `/scaler-validate-loop` keeps `/scaler-validate` semantics, then starts the bounded debug loop after failed validation and after the validation lock is released.

When debugging stalls, use either individual focused-agent commands or the bounded debug loop:

```text
/scaler-debug-run T-001
/scaler-debug-run T-001 execute
/scaler-debug-loop T-001 execute max=5
/scaler-debug-reports
/scaler-debug-runs T-001
```

A debug report with `needs_research` creates research requests for `/scaler-research-run`; a report with `needs_replan` or `blocked` creates a replan request for the replanner workflow. `/scaler-debug-loop` chains those handoffs deterministically until it reaches a `next_approach`, stages a proposed replan, encounters rejected structured output, or hits its bound. It does not accept replans automatically.

After a `next_approach`, use:

```text
/scaler-debug-retry T-001
/scaler-debug-retry T-001 execute
```

`/scaler-debug-retry execute` runs the next approach through the task-agent path, reruns the exact previously failing validation command(s), records the retry and debug attempt, and leaves exact-pass work in `validating` so full `/scaler-validate` is still required.

## 6. Commit validated work

```text
/scaler-commit T-001
/scaler-commit
```

Commits are allowed only for validated tasks. The git helper refuses commits when unrelated changes are present, when a task is not validated, or when the project is not a git repository. Allowed paths come from task metadata or explicit command arguments. Successful commits record post-commit artifacts in `.scaler/reports/commits.json`; inspect them with `/scaler-commits [taskId]`.

## Useful maintenance commands

```text
/scaler-task-update T-001 | Better title | ready | src,test | T-000 | REQ-001 | tests pass; docs updated
/scaler-prd-status
/scaler-prd-link T-001 | REQ-001,REQ-002
/scaler-task-retry T-001 | retry after fixing blocker
/scaler-pause manual pause
/scaler-resume manual resume
```

Task status updates and retries must follow deterministic supervisor transition rules.
