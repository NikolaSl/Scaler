# Implementation Plan 028 — Replanner Agent Proposal Workflow

## Goal
Advance GAP-003 by adding a focused replanner/planner subprocess workflow that consumes replan requests, runtime PRD coverage, current execution plan, and supervisor state, then stages a proposed replacement plan at `.scaler/plans/proposed-plan.json` through structured report ingestion.

## Scope
- Add deterministic replanner-agent prompt preparation with current plan, open replan requests, runtime PRD coverage, supervisor task state, and preservation rules.
- Add structured `scaler_replan_proposal` report extraction and ingestion that validates/saves a proposed execution plan.
- Add run records and commands to prepare/execute the replanner agent and inspect recent runs.
- Update docs and traceability.

## Out of Scope
- LLM-free automatic plan synthesis.
- Automatic acceptance of proposed plans.
- Planner creation of runtime PRD requirements from scratch.
- Interactive proposal editing UI.

## Atomic Tasks
1. **IMPL-116 — Add replanner-agent helper**
   - Implement prompt building, invocation prep, structured proposal extraction, proposal ingestion, and run records.
   - Add focused tests for prompt contents, extraction validation, proposal save, and run records.
   - Validate with `npm test` and `npm run build`.
2. **IMPL-117 — Wire replanner-agent commands**
   - Add `/scaler-replan-run [execute]` and `/scaler-replan-runs`.
   - Add command parsing/extension tests.
   - Validate with `npm test` and `npm run build`.
3. **IMPL-118 — Document replanner-agent workflow**
   - Update manuals, inventory, traceability, and gap backlog.
   - Validate with `npm test` and `npm run build`.

## Validation
Run after implementation tasks:

```bash
npm test
npm run build
```
