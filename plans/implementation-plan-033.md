# Implementation Plan 033 — Budget Watchdog Enforcement Slice

## Goal
Advance GAP-007 by adding concrete budget counters and hard-gate enforcement for token estimates, validation loops, spawned task agents, storage usage, and research reports.

## Scope
- Extend budget usage keys beyond the current skeleton.
- Add reusable budget application helpers for single and multi-counter updates.
- Add `.scaler/` storage byte scanning and budget recording.
- Gate task-agent conductor execution on context-token and spawned-agent budgets.
- Gate validation execution on validation-loop budgets.
- Record storage/research budget usage from relevant tools.
- Update manuals, inventory, traceability, and gap backlog.

## Out of Scope
- Provider-native token/cost accounting; this slice uses deterministic estimates only.
- User-facing budget configuration commands.
- Full watchdog processes or timers outside existing command/tool execution boundaries.

## Atomic Tasks
1. **IMPL-131 — Add richer budget counters/helpers**
   - Add new usage keys and budget application helpers.
   - Add storage scan/record helper.
   - Add tests for normalization, strongest decision selection, storage, and hard-limit persistence.
   - Validate with `npm test` and `npm run build`.
2. **IMPL-132 — Integrate budget gates into execution paths**
   - Conductor records context tokens and spawned-agent execution counts, refusing hard-limit runs before child execution.
   - Validation locked operation records validation-loop usage and refuses hard-limit validation runs.
   - Tool paths record storage and research-report budget usage where applicable.
   - Add/update tests.
   - Validate with `npm test` and `npm run build`.
3. **IMPL-133 — Document budget watchdog slice**
   - Update manuals, implementation inventory, traceability matrix, and gap backlog.
   - Validate with `npm test` and `npm run build`.
