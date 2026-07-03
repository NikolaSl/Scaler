# Implementation Plan 019 — Stage Artifact Model

## Goal

Start closing GAP-001 by adding deterministic Stage I-IV artifact records that let the supervisor track PRD, knowledge, planning, execution, and replanning outputs without relying on compressed conversation memory.

## Scope

- Add `.scaler/stages/stage-artifacts.json` as the runtime ledger for stage outputs.
- Represent stage artifacts with stable ids, stage, status, optional file path, summary, evidence refs, requirement refs, task refs, and timestamps.
- Add helpers to load, validate, save, upsert, summarize, and format stage artifacts.
- Add commands to inspect and record stage artifacts.
- Integrate stage artifact awareness into workflow next-action recommendations.
- Update docs and traceability.

## Atomic tasks

### IMPL-086 — Stage artifact storage

- Add stage artifact paths and TypeScript model/helper module.
- Add load/save/upsert/format helpers with deterministic normalization.
- Add unit tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-087 — Stage artifact commands

- Add `/scaler-stage-status`.
- Add `/scaler-stage-record <stage> | <status> | <title> | <path> | <summary> | <evidence refs> | <PRD refs> | <task refs>`.
- Add parser/extension shape tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-088 — Stage-aware workflow recommendations

- Make workflow summaries recommend missing Stage I-IV artifacts for active non-execution stages before task execution.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-089 — Documentation and traceability

- Document stage artifacts and commands.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
