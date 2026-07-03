# Implementation Plan 026 — Stage Artifact Consistency Gates

## Goal

Continue closing GAP-001 by adding cross-artifact consistency gates for stage advancement. Semantic validation now checks per-artifact fields; consistency validation should compare stage artifact refs against runtime PRD requirements, execution plan tasks, supervisor tasks, and replan request/proposal artifacts where available.

## Scope

- Add deterministic consistency validation helpers.
- Keep checks data-driven and non-invasive: only compare against ledgers/artifacts that exist or have entries.
- Integrate consistency checks into stage advancement after readiness and semantic validation.
- Update docs, inventory, traceability, and gap backlog.

## Atomic tasks

### IMPL-110 — Add stage consistency validation helper

- Add `src/stage-consistency.ts`.
- Validate:
  - requirement refs exist in runtime PRD requirements when the PRD ledger has requirements.
  - planning task refs exist in the current execution plan when the plan has tasks.
  - execution task refs exist in supervisor tasks when tasks exist.
  - replanning evidence refs reference open/known replan requests when requests exist.
  - replanning artifacts that point at a proposed plan require `.scaler/plans/proposed-plan.json` to exist.
- Add formatting and unit tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-111 — Gate advancement on consistency validation

- Integrate consistency validation into `advanceStageAfterReadyArtifact` after semantic validation.
- Include consistency validation details in advancement results.
- Add tests for rejected inconsistent advancement and conductor propagation.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-112 — Document consistency gates

- Document consistency gate rules and effects.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
