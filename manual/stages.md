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

`/scaler-stage-run` prepares a focused Pi subprocess prompt for a selected stage. Passing `execute` runs the stage agent under the repo-wide execution lock. Runs are recorded under `.scaler/reports/stage-agent-runs.json`. Successful executed stage runs attempt the same ready-artifact advancement automatically.

`/scaler-stage-runs` lists recent stage-agent run records, optionally filtered by stage.

`/scaler-stage-record` appends a normalized stage artifact record. Comma lists are accepted for evidence, PRD refs, and task refs.

`/scaler-status` uses stage artifacts when recommending next actions. For active `prd`, `knowledge`, `planning`, or `replanning` stages, it recommends recording a ready stage artifact before task execution when no ready/accepted artifact exists.

## Current limitations

Stage artifacts are deterministic records and command-visible supervisor context. SCALER can prepare and execute focused stage-agent subprocesses, validate ready artifacts, and advance stages when artifacts are ready. It does not yet parse a child agent's free-form final response into an artifact automatically; operators or future structured reports must record the artifact first.
