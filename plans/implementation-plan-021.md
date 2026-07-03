# Implementation Plan 021 — Stage Artifact Validation and Advancement

## Goal

Continue closing GAP-001 by validating produced Stage I-IV artifacts and advancing the deterministic supervisor stage when a ready artifact is present.

## Scope

- Add deterministic validation for latest stage artifacts.
- Require ready/accepted artifacts, enough artifact detail, and existing referenced files where paths are provided.
- Add a stage advancement helper that maps ready artifacts to allowed supervisor transitions.
- Integrate advancement after successful executed stage-agent runs when validation passes.
- Add commands to validate and advance stages manually.
- Update docs and traceability.

## Atomic tasks

### IMPL-094 — Stage artifact validation

- Add stage artifact readiness validation helpers.
- Validate latest artifact status and required artifact detail/path rules.
- Add unit tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-095 — Deterministic stage advancement helper

- Add helper to validate a stage artifact and advance supervisor stage where valid.
- Save updated state and preserve rejected transition behavior through supervisor rules.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-096 — Stage validation/advance commands and run integration

- Add `/scaler-stage-validate <stage>`.
- Add `/scaler-stage-advance <stage>`.
- Attempt automatic advancement after successful `/scaler-stage-run <stage> execute` when a ready artifact exists.
- Update command tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-097 — Documentation and traceability

- Document stage validation and advancement behavior.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
