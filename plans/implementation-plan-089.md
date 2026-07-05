# Implementation Plan 089 — GAP-027 Watchdogs, Scoped Budgets, and Resume Verification

## Goal
Close GAP-027 by adding deterministic watchdog/progress ledgers, scoped budget policies, no-progress/repeated-replan detection, cleanup evidence, and resume verification before paused runs continue.

## Scope
- Add watchdog paths under `.scaler/watchdogs/` for heartbeats, watchdog events, subprocess cleanup records, and resume verification records.
- Record progress heartbeats from Pi lifecycle/tool events and provide a command for manual/deterministic heartbeat records.
- Add watchdog assessment for stale heartbeats/no progress, repeated replanning without progress, timeout/abort cleanup evidence, and budget policy approval needs.
- Add scoped budget policy records to budget state and complexity-level budget helpers with explicit approval requirements for higher-complexity expansions.
- Verify resume readiness by checking state/log/index/checkpoint/git evidence before transitioning out of `paused`.
- Add commands to inspect/apply watchdog checks, resume checks, heartbeat records, cleanup records, and complexity budget policies.
- Add unit, mocked integration, and targeted real Pi command coverage.

## Non-goals
- Do not create CI/CD sandbox provisioning (GAP-029).
- Do not change validated-task git commit ordering (GAP-030).
- Do not implement secret redaction or tool-result large-output storage (GAP-031).

## Validation
- Unit tests for heartbeat/progress ledgers, stale watchdog triggers, repeated-replan detection, cleanup records, resume verification, and complexity budget policy approval.
- Mocked integration for watchdog pause and resume verification behavior.
- `npm test`
- `npm run build`
- Targeted opt-in real Pi command coverage.

## Commits
1. `PLAN-089: add watchdog and resume verification plan`
2. `IMPL-341: add watchdog ledgers and scoped budget policies`
3. `IMPL-342: cover watchdog and resume verification behavior`
4. `IMPL-343: document watchdog and budget policy coverage`
