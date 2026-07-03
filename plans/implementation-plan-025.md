# Implementation Plan 025 — Stage Artifact Semantic Validation

## Goal

Continue closing GAP-001 by adding deterministic semantic checks for stage artifacts before supervisor advancement. Readiness currently checks status/path basics; semantic validation should verify that each stage artifact carries the minimum refs/summaries needed for later stages.

## Scope

- Add a semantic validation helper for PRD, knowledge, planning, replanning, and execution artifacts.
- Keep semantic rules deterministic and artifact-local.
- Integrate semantic checks into stage advancement, and therefore into `/scaler-stage-advance`, `/scaler-stage-step`, and `/scaler-stage-loop`.
- Preserve explicit rejection reasons.
- Update docs, inventory, traceability, and gap backlog.

## Atomic tasks

### IMPL-107 — Add semantic stage validation helper

- Add semantic validation result/format helpers.
- Rules:
  - `prd`: artifact must include requirement refs or a summary.
  - `knowledge`: artifact must include evidence refs or a summary.
  - `planning`: artifact must include task refs or requirement refs.
  - `replanning`: artifact must include evidence refs and requirement refs or task refs.
  - `execution`: artifact must include task refs or a summary.
- Add tests for passing/failing semantic validation.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-108 — Gate advancement on semantic validation

- Integrate semantic validation into `advanceStageAfterReadyArtifact` after readiness and before supervisor transition.
- Include semantic validation details in advancement results.
- Update affected advancement/conductor tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-109 — Document semantic stage gates

- Document semantic stage gate rules and command effects.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
