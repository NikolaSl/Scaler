# Implementation Plan 090: Enforce atomic task quality and explicit validation waivers

## Gap
GAP-028: planner/task creation must enforce or explicitly waive atomic sizing, Definition of Done, validation, allowed-path, and test-first/update-tests-before-implementation requirements.

## Scope
- IMPL-344: Add task-quality policy metadata, waivers, strict review status, and task create/update enforcement modes.
- IMPL-345: Wire planner/tool/command task creation to strict mode with plan-supplied DoD, validation commands, task type, atomicity rationale, and waivers; add unit and mocked/real command coverage.
- IMPL-346: Document the enforced task definition contract and close GAP-028 in traceability/backlog docs.

## Validation
- Unit tests for task quality warnings/errors/waivers and task create rejection/acceptance.
- Unit tests for planner task application creating validation manifests and rejecting unwaived invalid tasks.
- Mocked integration for slash-command strict task creation and waiver records.
- Targeted real Pi command test for enforced task quality.
- Full `npm run build`, `npm test`, and `./scripts/run-real-integration.sh` after the slice.
