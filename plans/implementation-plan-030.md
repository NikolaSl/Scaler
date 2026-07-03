# Implementation Plan 030 — Focused Research Agent

## Goal
Advance remaining GAP-004 by adding a focused research-agent workflow that prepares/runs a Pi subprocess for open research requests and ingests only structured `scaler_research_report` JSON events.

## Scope
- Add research-agent run records under `.scaler/reports/research-agent-runs.json`.
- Build deterministic research-agent prompts from open research requests, runtime PRD requirements/coverage, current execution plan, supervisor tasks, and prior research reports.
- Prepare/execute an isolated Pi invocation for a selected request or the oldest open request.
- Ingest valid structured `scaler_research_report` events into the research report ledger.
- Add commands to run/list research-agent runs.
- Update manuals, inventory, traceability, and gap backlog.

## Out of Scope
- Real internet/browser/MCP execution beyond tools the operator explicitly grants to the subprocess.
- Parsing arbitrary free-form child output.
- Automatic Stage II advancement based solely on research reports.

## Atomic Tasks
1. **IMPL-122 — Add research-agent core workflow**
   - Add research-agent prompt preparation, structured report extraction/ingestion, run records, and tests.
   - Validate with `npm test` and `npm run build`.
2. **IMPL-123 — Add research-agent commands**
   - Add command parsing, `/scaler-research-run`, `/scaler-research-runs`, command tests, and extension registration tests.
   - Validate with `npm test` and `npm run build`.
3. **IMPL-124 — Document research-agent workflow**
   - Update manuals, implementation inventory, traceability, and gap backlog.
   - Validate with `npm test` and `npm run build`.

## Validation
Run after implementation tasks:

```bash
npm test
npm run build
```
