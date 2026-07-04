# Implementation Plan 069 — GAP-011 Storage Scheduled Maintenance

## Goal
Add explicit scheduled `.scaler/` storage maintenance controls so storage cleanup can be configured, checked, and run automatically without relying only on ad-hoc `/scaler-storage-maintain` invocations.

## Scope
- Persist storage maintenance schedule configuration under `.scaler/storage/schedule.json`.
- Add schedule helpers that determine due/not-due state, run dry-run or executing maintenance using the configured policy, update last/next run metadata, and preserve the existing explicit destructive controls.
- Add `/scaler-storage-schedule` to show/update schedule policy and optionally run the due check immediately.
- Add a `session_start` hook that runs due scheduled maintenance and refreshes storage budget usage when scheduling is enabled.
- Add unit, command, mocked integration, and targeted opt-in real Pi coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not add background timers or daemon behavior outside Pi session starts and explicit commands.
- Do not delete raw logs or memory beyond currently approved cache/archive policies.
- Do not enable archive/raw deletion by default.

## Validation
- Targeted storage schedule unit/command/mock tests.
- Targeted real Pi storage schedule command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-069: add storage schedule plan`
2. `IMPL-281: add storage maintenance schedule controls`
3. `IMPL-282: cover storage maintenance schedule flows`
4. `IMPL-283: document storage schedule coverage`
