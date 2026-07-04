# Implementation Plan 079 — GAP-014/GAP-020 Task-agent Report Enforcement

## Goal
Close GAP-014 and GAP-020 by requiring successful executed task agents to emit a structured `scaler_task_report` before a task can move to validation.

## Scope
- Add a task-agent report ledger under `.scaler/reports/task-agent-reports.json`.
- Define and ingest `scaler_task_report` payloads from child-agent JSON events or exact assistant JSON output.
- Require report ingestion for successful `/scaler-step execute` runs before writing validation handoffs.
- Track missing/invalid reports in task-agent run records and handoff/audit events; keep such tasks out of validation.
- Add a `scaler_task_report` tool schema for extension/tool-assisted reporters.
- Add unit, mocked integration, and targeted real Pi command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not auto-validate tasks based on reports alone.
- Do not require debug/research/replan/stage specialized agents to use `scaler_task_report`; they keep their specialized report contracts.
- Do not force invalid supervisor/task transitions.

## Validation
- Targeted task-report unit/conductor tests.
- Targeted mocked conductor integration.
- Targeted real Pi prepare/execute report contract test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-079: add task-agent report enforcement plan`
2. `IMPL-311: add task-agent report ingestion workflow`
3. `IMPL-312: cover task-agent report enforcement`
4. `IMPL-313: document task-agent report enforcement coverage`
