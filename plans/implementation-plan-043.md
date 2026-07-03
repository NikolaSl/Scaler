# Implementation Plan 043 — Additional Real Pi Remaining-Flow Parity Tests

## Goal
Add opt-in real Pi integration coverage for remaining mocked-flow scenarios that can be mirrored safely with deterministic cardinal model instructions, while keeping default integration tests deterministic and model-free.

## Scope
- Add real Pi flow-parity tests for structured-output rejection across non-debug child agents.
- Add real Pi flow-parity tests for unsafe replan proposals that fail preservation and cannot replace the active plan.
- Add real Pi flow-parity tests for debug `needs_replan` reports that create replan requests and safe replan acceptance that clears the retry gate.
- Add real Pi flow-parity tests for research reports with raw evidence that is externalized into SCALER memory and later appears in task context manifests.
- Update integration documentation, manual testing guidance, inventory, traceability, and gap backlog to reflect the expanded opt-in real suite.

## Non-goals
- Do not make real Pi/model tests part of the default `npm test` path.
- Do not implement the full automatic bounded validation-failure → debug-agent → research-agent → replanner conductor loop (`GAP-022`).
- Do not assert final prose from real models; assert only structured reports, Pi JSON events, and persisted `.scaler/` ledgers.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-043: add remaining real flow-parity plan`
2. `IMPL-161: add real structured rejection parity test`
3. `IMPL-162: add real unsafe replan parity test`
4. `IMPL-163: add real debug blocked replan parity test`
5. `IMPL-164: add real research memory parity test`
6. `IMPL-165: harden real negative parity tests`
7. `IMPL-166: document expanded real flow parity coverage`
