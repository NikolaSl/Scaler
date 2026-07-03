# Stage Artifacts

SCALER tracks Stage I-IV workflow outputs in `.scaler/stages/stage-artifacts.json`.

Implemented artifact stages:

- `prd` — Stage I polished PRD output.
- `knowledge` — Stage II knowledge/research output.
- `planning` — Stage III plan output.
- `execution` — Stage IV execution output/progress reference.
- `replanning` — replacement-plan/replanning output.

Implemented artifact statuses:

- `draft`
- `in_progress`
- `ready`
- `accepted`
- `blocked`
- `superseded`

Each record stores a stable id, stage, status, title, optional path, optional summary, evidence refs, PRD requirement refs, task refs, and timestamps.

## Commands

```text
/scaler-stage-status
/scaler-stage-validate <stage>
/scaler-stage-advance <stage>
/scaler-stage-run <stage> [execute]
/scaler-stage-runs [stage]
/scaler-stage-record <stage> | <status> | <title> | <path> | <summary> | <evidence refs> | <PRD refs> | <task refs>
```

`/scaler-stage-status` summarizes latest artifacts by stage and highlights missing/blocked stages.

`/scaler-stage-validate` checks the latest artifact for a stage. A ready artifact must have status `ready` or `accepted`; PRD, knowledge, planning, and replanning artifacts must include an existing file path. Execution artifacts may be summary/task-ref based.

`/scaler-stage-advance` validates the latest artifact and advances the supervisor through the deterministic mapping: `prd -> knowledge`, `knowledge -> planning`, `planning -> execution`, `replanning -> execution`, and `execution -> completed` when supervisor completion guards allow it.

`/scaler-stage-run` prepares a focused Pi subprocess prompt for a selected stage. Passing `execute` runs the stage agent under the repo-wide execution lock. Runs are recorded under `.scaler/reports/stage-agent-runs.json`. Successful executed stage runs extract the latest `scaler_stage_artifact` JSON event from child output, record it as a stage artifact when valid, and attempt ready-artifact advancement automatically.

Accepted child JSON event shape:

```json
{
  "type": "scaler_stage_artifact",
  "stage": "planning",
  "status": "ready",
  "title": "Execution plan",
  "path": ".scaler/plans/current-plan.json",
  "summary": "Plan ready",
  "evidenceRefs": ["run:1"],
  "requirementRefs": ["PRD-W04"],
  "taskRefs": ["T-001"]
}
```

`/scaler-stage-runs` lists recent stage-agent run records, optionally filtered by stage.

`/scaler-stage-record` appends a normalized stage artifact record. Comma lists are accepted for evidence, PRD refs, and task refs.

`/scaler-status` uses stage artifacts when recommending next actions. For active `prd`, `knowledge`, `planning`, or `replanning` stages, it recommends recording a ready stage artifact before task execution when no ready/accepted artifact exists.

## Current limitations

Stage artifacts are deterministic records and command-visible supervisor context. SCALER can prepare and execute focused stage-agent subprocesses, ingest structured artifact events, validate ready artifacts, and advance stages when artifacts are ready. It does not parse arbitrary free-form child text into artifacts; child output must include the structured JSON event or the operator must use `/scaler-stage-record`.
