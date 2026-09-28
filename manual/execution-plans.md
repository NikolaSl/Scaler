# Execution Plan Artifacts

SCALER can persist a deterministic execution plan for the active run under `.scaler/plans/`.

Implemented artifacts:

- `.scaler/plans/current-plan.json` — current structured execution plan.
- `.scaler/plans/versions/PLAN-vNNN.json` — versioned execution plan snapshots.
- `.scaler/plans/replan-requests.json` — newest-first replan request records.
- `.scaler/plans/proposed-plan.json` — staged replacement plan for a replan request.
- `.scaler/plans/replan-decisions.json` — applying/accepted/rejected proposal decisions.
- `.scaler/reports/planning-reports.json` — structured planner coverage synchronization reports.

Current plan task fields:

- `id`
- `title`
- optional `description`
- optional `taskKind` (`software`, `non_software`, or `mixed`)
- optional `atomicityRationale`
- optional `prdRefs`
- optional `allowedPathPrefixes`
- optional `dependsOn`
- optional `definitionOfDone`
- optional `validationRefs`
- optional `validationCommands`
- optional `validationInputPaths`
- optional `qualityWaivers`

Plan statuses:

- `draft`
- `active`
- `superseded`
- `completed`

## Commands

```text
/scaler-plan-status
/scaler-plan-apply
/scaler-planning-reports
/scaler-replans
/scaler-replan-run [execute]
/scaler-replan-runs
/scaler-replan-proposal-status
/scaler-replan-accept
/scaler-replan-request <reason> | <taskId> | <evidence refs> | <PRD refs>
```

`/scaler-plan-status` shows a deterministic summary of the current plan, runtime PRD requirements, and supervisor task state:

- plan version and status
- planned task count
- created/missing/validated planned task counts
- linked and unlinked requirement counts
- task ids missing from supervisor state
- plan tasks without PRD refs
- runtime PRD requirements not linked by plan tasks

`/scaler-plan-apply` creates missing supervisor task records from the current plan. Existing task records are preserved. Created tasks inherit title, kind, atomicity rationale, allowed paths, dependencies, PRD refs, DoD, validation refs/commands, validation input paths, and quality waivers from plan tasks. Unwaived missing quality requirements reject the affected task instead of silently creating a loose task.

`validationInputPaths` lists exact project-relative regular files that implement or configure local validation commands, such as checker scripts, fixtures, and validation-specific configuration. SCALER fingerprints those bytes when the policy is established and rejects validation when they drift. `[]` means the commands are deliberately self-contained; omission preserves a prior declaration when an existing task is updated. Missing files, symlinks, duplicates, traversal, absolute paths, and runtime-metadata paths are refused before plan publication. If a task itself creates a validator, create the file first and configure it through the validation manifest tool before the first validation run.

Structured `scaler_planning_report` output synchronizes planner-provided runtime requirements, saves the current execution plan, creates missing tasks, updates existing task metadata/`prdRefs` when requested by the planner report, links requirement coverage to plan tasks, and records coverage diagnostics. Before any publication, the report must cover every current or proposed requirement, every task must reference at least one known requirement, and dependency references must exist without cycles. The exact prospective task definitions are also checked against the same DoD, path, atomicity and validation/test-first rules used by task creation/update, including stored validation manifests and explicit `qualityWaivers`. Accepted replan proposals use the same coverage and task-contract gates before snapshot or active-plan publication; tasks that the replan path leaves unchanged are not spuriously revalidated. A failed coverage, graph or task-contract preflight writes no requirements, plan, planning report or tasks. Software plans should also decide whether `validationCommands.environment` needs `local_ci`, Docker, Compose, devcontainer, or Minikube execution so validation can generate deterministic CI/CD wrappers. `/scaler-planning-reports` lists accepted report records.

`/scaler-replans` lists recorded replan requests.

`/scaler-replan-request` records a manual replan request and attempts to transition the supervisor stage to `replanning` when the current stage allows it.

`/scaler-replan-run [execute]` prepares or executes a focused replanner agent. The prompt includes open replan requests, current execution plan JSON, runtime PRD requirements, runtime PRD coverage, supervisor tasks, and preservation rules. Executed replanner agents must emit a structured `scaler_replan_proposal` JSON event with a proposed `ExecutionPlanArtifact`; SCALER validates and saves that proposal to `.scaler/plans/proposed-plan.json` and records preservation-check details. Runs are recorded under `.scaler/reports/replan-agent-runs.json`.

`/scaler-replan-runs` lists recent replanner-agent run records.

`/scaler-replan-proposal-status` validates `.scaler/plans/proposed-plan.json` against the current plan, runtime PRD requirements, and supervisor state.

`/scaler-replan-accept` accepts `.scaler/plans/proposed-plan.json` only when preservation checks pass. Acceptance snapshots the previous current plan, journals an `applying` decision, saves or resumes the exact proposed plan version, applies missing task records, resolves the journaled replan requests, and finalizes the same decision as `accepted`. If current requirement coverage is explicitly `needs_replan`, validated tasks linked through that coverage or their `prdRefs` must remain in the proposed plan and are reopened to `ready`; unrelated validated tasks remain accepted. Their prior evidence stays historical, the coverage entry becomes `in_progress`, and the decision records the reopened task ids. The journal captures requirement revisions, the complete affected coverage rows and the previous active-plan fingerprint. The PRD lock covers verification, coverage transition and downstream active-plan/state/task publication even when no coverage row is affected, so a competing material amendment starts only after that transaction. Proposal and plan identity include every plan field except the persistence-normalized `updatedAt`, keeping timestamp-only retries idempotent. A changed same-version plan, newer same-row invalidation or requirement revision fails closed; duplicate coverage requirement ids are invalid and unrelated concurrent invalidations remain untouched. The immutable snapshot of the previous plan may precede this check and is not executable state. This does not authorize model-written replacement of an exercised task contract.

## Replan triggers and preservation checks

SCALER records replan requests when:

- a validation report has status `blocked`
- a debug attempt reports `blocked`
- a debug attempt detects a failure-fingerprint cycle, including longer hidden chains
- a debug-agent report has status `needs_replan` or `blocked`
- an operator uses `/scaler-replan-request`

Blocked validation keeps the task in `blocked` and attempts a stage transition to `replanning`. Debug cycles or blocked debug attempts mark a `debugging` task as `needs_replan` before entering `replanning`. Debug-agent reports can create debug-blocked replan requests after realistic debug/research approaches are exhausted. The task conductor also refuses retries for unresolved repeated failed fingerprints until later `newEvidence` with a fresh evidence reference is recorded or the related debug replan request is accepted/resolved.

Execution plan replacement preservation checks are available in code. They report dropped validated task ids, dropped validated requirement refs, runtime requirements unlinked by the next plan, and next-plan tasks without PRD refs.

## Current limitations

Autonomous planner-loop coordination exists through `/scaler-stage-workflow`, and structured planner output can be ingested through `scaler_planning_report` to write the initial/current plan, synchronize PRD requirements, align task metadata/quality fields, and record coverage diagnostics before execution. The current-plan artifact can also be written directly and applied through `/scaler-plan-apply`.

Replanner proposal generation exists through `/scaler-replan-run execute`, but proposal acceptance remains an explicit preservation-gated step via `/scaler-replan-accept`.
