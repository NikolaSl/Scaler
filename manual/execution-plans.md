# Execution Plan Artifacts

SCALER can persist a deterministic execution plan for the active run under `.scaler/plans/`.

Implemented artifacts:

- `.scaler/plans/current-plan.json` — current structured execution plan.
- `.scaler/plans/versions/PLAN-vNNN.json` — versioned execution plan snapshots.
- `.scaler/plans/replan-requests.json` — newest-first replan request records.
- `.scaler/plans/proposed-plan.json` — staged replacement plan for a replan request.
- `.scaler/plans/replan-decisions.json` — accepted/rejected proposal decisions.

Current plan task fields:

- `id`
- `title`
- optional `description`
- optional `prdRefs`
- optional `allowedPathPrefixes`
- optional `dependsOn`
- optional `validationRefs`

Plan statuses:

- `draft`
- `active`
- `superseded`
- `completed`

## Commands

```text
/scaler-plan-status
/scaler-plan-apply
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

`/scaler-plan-apply` creates missing supervisor task records from the current plan. Existing task records are preserved. Created tasks inherit title, allowed paths, dependencies, and PRD refs from plan tasks.

`/scaler-replans` lists recorded replan requests.

`/scaler-replan-request` records a manual replan request and attempts to transition the supervisor stage to `replanning` when the current stage allows it.

`/scaler-replan-run [execute]` prepares or executes a focused replanner agent. The prompt includes open replan requests, current execution plan JSON, runtime PRD requirements, runtime PRD coverage, supervisor tasks, and preservation rules. Executed replanner agents must emit a structured `scaler_replan_proposal` JSON event with a proposed `ExecutionPlanArtifact`; SCALER validates and saves that proposal to `.scaler/plans/proposed-plan.json` and records preservation-check details. Runs are recorded under `.scaler/reports/replan-agent-runs.json`.

`/scaler-replan-runs` lists recent replanner-agent run records.

`/scaler-replan-proposal-status` validates `.scaler/plans/proposed-plan.json` against the current plan, runtime PRD requirements, and supervisor state.

`/scaler-replan-accept` accepts `.scaler/plans/proposed-plan.json` only when preservation checks pass. Acceptance snapshots the previous current plan, saves the proposed plan as current, applies missing task records, resolves open replan requests, and records a decision.

## Replan triggers and preservation checks

SCALER records replan requests when:

- a validation report has status `blocked`
- a debug attempt reports `blocked`
- a debug attempt detects a failure-fingerprint cycle
- an operator uses `/scaler-replan-request`

Blocked validation keeps the task in `blocked` and attempts a stage transition to `replanning`. Debug cycles or blocked debug attempts mark a `debugging` task as `needs_replan` before entering `replanning`.

Execution plan replacement preservation checks are available in code. They report dropped validated task ids, dropped validated requirement refs, runtime requirements unlinked by the next plan, and next-plan tasks without PRD refs.

## Current limitations

SCALER does not yet include a planner agent that writes the initial/current plan automatically. The current-plan artifact can be written by future planner tooling or direct file creation, and then applied through `/scaler-plan-apply`.

Replanner proposal generation exists through `/scaler-replan-run execute`, but proposal acceptance remains an explicit preservation-gated step via `/scaler-replan-accept`.
