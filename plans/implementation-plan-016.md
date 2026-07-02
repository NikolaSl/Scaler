# Implementation Plan 016 — Replan Request Records and Preservation Checks

## Goal

Continue closing GAP-003 by adding deterministic replan request artifacts, plan replacement preservation checks, and runtime triggers that turn blocked/cyclic evidence into replanning state.

## Scope

- Add `.scaler/plans/replan-requests.json` for open/resolved replan requests.
- Add helper APIs for recording, loading, and formatting replan requests.
- Add deterministic execution-plan replacement preservation checks for validated tasks and runtime PRD coverage.
- Add commands for manual replan requests and request status.
- Add automated replan request creation for blocked validation and debug cycles.
- Update manuals and traceability artifacts.

## Atomic tasks

### IMPL-072 — Replan request artifact storage

- Add replan request path helpers.
- Add `ReplanRequest` schema and load/append/format helpers in `src/plans.ts`.
- Add tests for defaults, append ordering, validation, and formatting.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-073 — Execution plan preservation checks

- Add a pure preservation check comparing current/next execution plans against supervisor state and runtime PRD requirements.
- Report dropped validated task ids, dropped validated requirement refs, and unlinked runtime requirements.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-074 — Replan commands

- Add `/scaler-replan-request` and `/scaler-replans` commands.
- Manual request records evidence and attempts transition to `replanning` when valid.
- Add command registration tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-075 — Evidence-driven replan triggers

- Create replan requests when validation reports `blocked`.
- Create replan requests and mark debugging tasks `needs_replan` when debug attempts detect fingerprint cycles or report `blocked`.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-076 — Documentation and traceability

- Document replan request artifacts, commands, and current limitations.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
