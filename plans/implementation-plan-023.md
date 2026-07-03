# Implementation Plan 023 — Staged Conductor Step

## Goal

Continue closing GAP-001 by adding a deterministic stage conductor step that can chain active supervisor stages without requiring operators to manually decide whether to validate/advance an artifact or run the focused stage agent.

## Scope

- Add a stage-conductor helper that inspects the current supervisor stage.
- If the latest artifact for the active stage is ready, validate and advance it.
- If no ready artifact exists, prepare or execute the matching focused stage agent.
- After executed stage-agent runs, use existing structured artifact ingestion and ready-artifact advancement.
- Add a command for the one-step staged conductor workflow.
- Update docs, inventory, traceability, and gap backlog.

## Atomic tasks

### IMPL-101 — Add staged conductor helper

- Add `src/stage-conductor.ts` with a deterministic one-step stage workflow.
- Support `prd`, `knowledge`, `planning`, `execution`, and `replanning` stages.
- Return explicit action, readiness, stage-agent, ingestion, and advancement details.
- Add unit tests for ready-artifact advancement, prepare-only behavior, executed ingestion plus advancement, and unsupported stages.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-102 — Add staged conductor command

- Register `/scaler-stage-step [execute]`.
- Wire the command to the new stage-conductor helper.
- Update extension shape tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-103 — Document staged conductor step

- Document `/scaler-stage-step` in manuals.
- Update implementation inventory, traceability matrix, and gap backlog to reflect implemented staged conductor stepping and remaining autonomy gaps.
- Run `npm test` and `npm run build`.
- Commit.
