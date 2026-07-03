# Implementation Plan 044 — GAP-022 Bounded Debug Conductor Slice

## Goal
Implement the first deterministic slice of `GAP-022`: a bounded conductor that can start from a validation-failed/debugging task and automatically chain focused debug, research, and replanner-agent steps based on structured ledger outputs.

## Scope
- Add a `debug-conductor` module with one-step and bounded-loop orchestration.
- Select the active debugging task deterministically from `currentTaskId` or the first debugging task.
- Prioritize open research requests for the task before asking the debug agent again.
- Run the debug agent when no task-local research is open.
- Run the replanner agent when task-local debug-cycle/debug-blocked replan requests are open.
- Stop deterministically on prepared steps, rejected ingestion, `next_approach`, `max_steps`, missing work, or proposed replan generation.
- Do **not** accept proposed replans automatically; `/scaler-replan-accept` remains the only current-plan replacement path.
- Add `/scaler-debug-loop [taskId] [execute] [max=N]` command support.
- Add unit tests plus mocked integration and opt-in real Pi/model flow tests.
- Update manuals, inventory, traceability, and gap backlog for this partial GAP-022 coverage.

## Non-goals
- Do not implement automatic task-agent retry/patch execution after `next_approach`.
- Do not implement automatic replan acceptance.
- Do not add browser/MCP internet research execution.
- Do not require real Pi/model tests in default `npm test`.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-044: add bounded debug conductor plan`
2. `IMPL-167: add bounded debug conductor core`
3. `IMPL-168: add debug loop command integration`
4. `IMPL-169: add mocked debug conductor integration coverage`
5. `IMPL-170: add real debug conductor integration coverage`
6. `IMPL-171: harden real stage conductor parity test`
7. `IMPL-172: document bounded debug conductor slice`
