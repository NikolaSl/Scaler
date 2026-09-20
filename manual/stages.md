# Stage Artifacts

SCALER tracks Stage I-IV workflow outputs in `.scaler/stages/stage-artifacts.json`.

Implemented artifact stages:

- `prd` — Stage I polished PRD output.
- `knowledge` — Stage II knowledge/research output; supporting requests, reports, focused research-agent runs, and autonomous merge artifacts live under `.scaler/research/`, `.scaler/knowledge/`, `.scaler/reports/research-agent-runs.json`, and `.scaler/reports/stage-workflow-runs.json`.
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
/scaler-stage-step [execute]
/scaler-stage-loop [execute] [max=N]
/scaler-stage-workflow [execute] [max=N] [research=N] [requests=N] [internet] [tools=a,b] [auto-accept-replan=on/off]
/scaler-stage-workflow-runs
/scaler-stage-run <stage> [execute]
/scaler-stage-runs [stage]
/scaler-stage-record <stage> | <status> | <title> | <path> | <summary> | <evidence refs> | <PRD refs> | <task refs>
```

`/scaler-stage-status` summarizes latest artifacts by stage and highlights missing/blocked stages.

`/scaler-stage-validate` checks the latest artifact for a stage. A ready artifact must have status `ready` or `accepted`; PRD, knowledge, planning, and replanning artifacts must include an existing file path. Execution artifacts may be summary/task-ref based.

`/scaler-stage-advance` validates the latest artifact for readiness, stage-specific semantics, and cross-artifact consistency, then advances the supervisor through the deterministic mapping: `prd -> knowledge`, `knowledge -> planning`, `planning -> execution`, `replanning -> execution`, and `execution -> completed` when supervisor completion guards allow it.

Semantic advancement gates:

- `prd`: requirement refs or a summary.
- `knowledge`: evidence refs or a summary.
- `planning`: task refs or requirement refs.
- `replanning`: evidence refs and requirement refs or task refs.
- `execution`: task refs or a summary.

Consistency advancement gates compare available ledgers/artifacts:

- requirement refs must exist in the runtime PRD ledger when requirements exist.
- planning task refs must exist in the current execution plan when plan tasks exist.
- execution task refs must exist in supervisor tasks when tasks exist.
- replanning evidence refs must reference known replan request ids when requests exist.
- replanning artifacts that point at `.scaler/plans/proposed-plan.json` require a valid proposed plan artifact.

`/scaler-stage-step` runs one deterministic stage-conductor step for the current supervisor stage. If the current stage already has a ready artifact, it validates and advances that artifact. Otherwise it prepares the focused stage agent; passing `execute` runs that stage agent, ingests a valid `scaler_stage_artifact` JSON event, and attempts ready-artifact advancement.

`/scaler-stage-loop` runs bounded stage-conductor steps, carrying forward supervisor state after each advancement. It stops on completion, `max=N` steps, unsupported stages, rejected steps, prepare-mode stage-agent handoff, or executed stage-agent output that does not advance. Default max is 5; accepted bounds are normalized to 1..20.

`/scaler-stage-workflow` is the autonomous Stage I-III/replanning coordinator. It advances ready artifacts; runs PRD and planning stage agents when artifacts are missing; grants only SCALER ledger tools needed for PRD/plan ingestion by default; creates Stage II research requests from runtime PRD requirements; runs bounded research-agent fanout; merges/deduplicates reports and memory refs into `.scaler/knowledge/knowledge-report.md`; ingests `scaler_prd_write` and `scaler_planning_report` child outputs; applies current plans before Stage IV; detects execution-time coverage gaps; and refreshes Stage III through preservation-gated replanner proposal acceptance. It records runs under `.scaler/reports/stage-workflow-runs.json`. Without `execute`, it prepares the next needed child agent or records the deterministic next action.

`/scaler-stage-run` prepares a focused Pi subprocess prompt for a selected stage. The complete final prompt must fit the runtime-owned allowance (8,000 estimated tokens by default), and the child invocation uses strict provider admission with ambient extensions, skills, templates and context files disabled. Refusal occurs before prompt audit, run-record publication or process launch. The provider hook evaluates the actual supported live model and its context window; this path does not yet bind an exact parent-selected provider/model identity. Passing `execute` runs the stage agent under the repo-wide execution lock. Runs are recorded under `.scaler/reports/stage-agent-runs.json`. Successful executed stage runs extract the latest `scaler_stage_artifact` JSON event from child output, record it as a stage artifact when valid, and attempt ready-artifact advancement automatically.

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

Stage artifacts are deterministic records and command-visible supervisor context. SCALER can run one-step and bounded multi-step stage conductors, run the autonomous Stage I-III/replanning coordinator, prepare and execute focused stage/research/replan subprocesses, ingest structured artifact/PRD/planning events, validate ready artifacts, enforce deterministic semantic and consistency advancement gates, merge Stage II research evidence, and refresh Stage III after execution discoveries. It does not parse arbitrary free-form child text into artifacts; child output must include structured JSON events or the operator must use explicit recording commands.
