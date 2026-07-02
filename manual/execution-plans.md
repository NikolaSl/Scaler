# Execution Plan Artifacts

SCALER can persist a deterministic execution plan for the active run under `.scaler/plans/`.

Implemented artifacts:

- `.scaler/plans/current-plan.json` — current structured execution plan.
- `.scaler/plans/versions/PLAN-vNNN.json` — versioned execution plan snapshots.

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

## Current limitations

SCALER does not yet include a planner agent that writes the current plan automatically. The plan artifact can be written by future planner tooling or direct file creation, and then applied through `/scaler-plan-apply`.

Evidence-driven replanning triggers are not yet automated.
