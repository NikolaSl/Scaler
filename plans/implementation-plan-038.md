# Implementation Plan 038 — Expanded Chain Integration Coverage

## Goal
Expand the dedicated integration suite so implemented SCALER subcomponents are tested together in realistic persisted workflows, not only as unit-level modules.

## Scope
- Add deterministic temp-repository integration tests for stage conductor/artifact ingestion/advancement across implemented Stage I-IV boundaries.
- Add deterministic temp-repository integration tests for runtime PRD, execution plans, replan requests, replanner-agent proposal ingestion, preservation checks, proposal acceptance, task creation, snapshots, decisions, and audit logs.
- Keep child-agent behavior mocked by default; optional real Pi/model tests remain opt-in only.
- Update integration-suite documentation and traceability after coverage changes.

## Atomic tasks

### PLAN-038 — Plan
- Create this plan and commit it. This is a PLAN task, not an IMPL task.

### IMPL-146 — Add chain integration scenarios
- Add integration tests under `test/integration/` for staged conductor and replan proposal/acceptance workflows.
- Assert durable `.scaler/` artifacts and audit logs, not only return values.
- Run `npm test` and `npm run build`.

### IMPL-147 — Document expanded integration coverage
- Update `test/integration/README.md`, manuals, inventory, traceability, and backlog if coverage changes.
- Run `npm test` and `npm run build`.

## Validation

```bash
npm test
npm run build
```
