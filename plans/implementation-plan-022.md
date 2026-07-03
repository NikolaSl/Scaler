# Implementation Plan 022 — Stage Agent Report Ingestion

## Goal

Continue closing GAP-001 by letting executed stage agents return a structured artifact report that SCALER can ingest into `.scaler/stages/stage-artifacts.json` automatically, reducing manual `/scaler-stage-record` use.

## Scope

- Define a deterministic stage-agent artifact report schema in TypeScript.
- Teach stage-agent prompts to request JSON report events with artifact fields.
- Extract artifact reports from Pi JSON stdout events.
- Ingest valid reports after successful executed stage-agent runs.
- Preserve invalid/missing reports as explicit non-ingestion results.
- Update commands/docs/traceability.

## Atomic tasks

### IMPL-098 — Stage-agent report extraction

- Add report schema/types and validation/extraction helpers.
- Support deterministic extraction from stdout events containing a `scaler_stage_artifact` payload.
- Update stage-agent prompt final-response contract.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-099 — Ingest stage-agent reports into artifacts

- In `runStageAgentStep`, after successful executed runs, extract the report and upsert the corresponding stage artifact.
- Return ingestion status in the step result.
- Add tests for successful, missing, invalid, and mismatched reports.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-100 — Command integration and docs

- Make `/scaler-stage-run <stage> execute` report ingestion status and then attempt advancement using the newly ingested artifact.
- Document structured report ingestion and current limitations.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
