# Implementation Plan 083 — GAP-018 Planner PRD Coverage Automation

## Goal
Close GAP-018 by ingesting structured planner output that synchronizes runtime PRD requirements, execution plans, task `prdRefs`, and coverage diagnostics before execution.

## Scope
- Add a planning report workflow that persists `.scaler/reports/planning-reports.json`.
- Ingest planner-provided requirements and execution-plan tasks.
- Save the current execution plan, create/update task records from plan tasks, and keep task `prdRefs` aligned.
- Upsert runtime PRD requirement coverage links and report diagnostics for unlinked requirements, unknown plan refs, and plan tasks without PRD refs.
- Add `scaler_planning_report` and `/scaler-planning-reports` inspection.
- Add unit, mocked integration, and targeted real Pi command coverage.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- No autonomous full planner model loop beyond structured report ingestion.
- No semantic PRD decomposition.
- Do not invalidate validated task work without evidence.

## Validation
- Targeted plan/prd/tool/command tests.
- Targeted mocked integration for planning report → PRD coverage → tasks.
- Targeted real Pi `/scaler-planning-reports` command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-083: add planner coverage automation plan`
2. `IMPL-323: add planner coverage workflow`
3. `IMPL-324: cover planner coverage workflow`
4. `IMPL-325: document planner coverage automation`
