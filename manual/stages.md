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
/scaler-stage-run <stage> [execute]
/scaler-stage-runs [stage]
/scaler-stage-record <stage> | <status> | <title> | <path> | <summary> | <evidence refs> | <PRD refs> | <task refs>
```

`/scaler-stage-status` summarizes latest artifacts by stage and highlights missing/blocked stages.

`/scaler-stage-run` prepares a focused Pi subprocess prompt for a selected stage. Passing `execute` runs the stage agent under the repo-wide execution lock. Runs are recorded under `.scaler/reports/stage-agent-runs.json`.

`/scaler-stage-runs` lists recent stage-agent run records, optionally filtered by stage.

`/scaler-stage-record` appends a normalized stage artifact record. Comma lists are accepted for evidence, PRD refs, and task refs.

`/scaler-status` uses stage artifacts when recommending next actions. For active `prd`, `knowledge`, `planning`, or `replanning` stages, it recommends recording a ready stage artifact before task execution when no ready/accepted artifact exists.

## Current limitations

Stage artifacts are deterministic records and command-visible supervisor context. SCALER can prepare and execute focused stage-agent subprocesses, but it does not yet automatically validate their produced artifacts or advance all Stage I-IV transitions end-to-end.
