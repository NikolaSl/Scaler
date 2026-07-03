# Implementation Plan 045 — GAP-022 Validation-Triggered Debug Loop Handoff

## Goal
Extend the bounded debug conductor from Plan 044 with an explicit validation workflow that runs validation first and, when validation fails into a debugging task, starts the bounded debug/research/replan conductor after the validation lock is released.

## Scope
- Add a validation-debug workflow function that:
  - runs `runValidationWithExecutionLock` for a selected task;
  - reloads persisted state after validation;
  - starts `runDebugConductorLoop` only when validation was accepted, failed, and the task is now `debugging`;
  - avoids nested execution locks by starting the debug loop only after validation returns;
  - preserves no-auto-replan-acceptance behavior.
- Add `/scaler-validate-loop [taskId] [execute] [max=N]` command support.
- Add unit coverage for passed validation, failed validation triggering the debug loop, and rejected validation/lock behavior where feasible.
- Add mocked integration coverage for real validation failure → debug needs-research → research completion → debug next-approach.
- Add opt-in real Pi/model integration coverage for validation failure → bounded debug loop with cardinal structured outputs.
- Update manuals, integration docs, inventory, traceability, and gap backlog.

## Non-goals
- Do not change default `/scaler-validate` semantics.
- Do not auto-accept proposed replans.
- Do not execute code patches after a `next_approach`; that remains future GAP-022 work.
- Do not make real Pi/model tests part of default `npm test`.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-045: add validation-triggered debug loop plan`
2. `IMPL-173: add validation debug loop workflow`
3. `IMPL-174: add validate-loop command integration`
4. `IMPL-175: add mocked validation debug loop integration coverage`
5. `IMPL-176: add real validation debug loop integration coverage`
6. `IMPL-177: document validation debug loop workflow`
