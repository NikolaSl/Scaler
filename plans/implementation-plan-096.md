# Implementation Plan 096: Full `/scaler` automation and conformance guardrails

## Gap
The user-facing `/scaler <request>` contract must be understandable and auditable later. A previous slice implemented the runtime behavior but did not create a PLAN/IMPL trail. This plan records the context: SCALER must prove top-level automation end-to-end, not merely expose helper commands that require the operator to manually advance stages/tasks.

## Scope
- [x] IMPL-362: Add the full automation entrypoint loop (`src/autopilot.ts`) and wire `/scaler <request>` to run staged workflow, plan/task synchronization, task-agent execution, validation, debug next-approach retry/revalidation, commit or commit-skip, and completion until a deterministic blocker.
- [x] IMPL-363: Harden child-agent default tool grants so stage agents can inspect local project state and task agents can modify files and emit `scaler_task_report` without requiring manual tool wiring.
- [x] IMPL-364: Add conformance policy checks (`src/conformance.ts`) for automation stop-reason classification, implemented-row evidence in traceability, requirement-catalog/matrix row coverage, and `/scaler` documentation consistency.
- [x] IMPL-365: Add top-level acceptance/conformance tests and documentation/traceability updates so future changes catch drift between specification, manual, implementation, and user-facing behavior.

## Validation
- Test-first evidence: focused `test/autopilot.test.ts`, `test/conformance.test.ts`, and `test/conductor.test.ts` failed before the new automation/conformance code and default tool grants existed.
- `npm run build` passed.
- `npm run test:conformance` passed (`7/7`).
- `npm run test:unit` passed (`485/485`).
- `npm run test:integration:mock` passed (`64/64`).

## Notes for future readers
This slice was triggered by discovering that `/scaler <request>` initialized state but did not itself execute the full workflow promised by the specifications. The fix is intentionally guarded by product-level conformance checks so the same class of miss is caught even if individual helper commands continue to pass their unit tests.
