# Implementation Plan 046 — GAP-007 Budget Configuration and Status Commands

## Goal
Add user-facing budget configuration/status commands so existing state-backed budget gates can be inspected and configured without test-only/programmatic state mutation.

## Scope
- Add budget key validation/normalization helpers and a human-readable budget status formatter.
- Add command arg parsing for `/scaler-budget-set <key> | <soft> | <hard>`.
- Add `/scaler-budget-status` to display current usage, soft/hard limits, strongest current decision, and checkpoint count.
- Add `/scaler-budget-set` to persist limits in `.scaler/state.json` and log command lifecycle through existing command audit.
- Add unit tests for parser/formatter/configuration behavior.
- Add mocked integration coverage for command-driven budget configuration causing a later validation hard-stop.
- Add opt-in real Pi extension command-dispatch coverage for `/scaler-budget-set` and persisted state.
- Update manuals, integration docs, inventory, traceability, and gap backlog.

## Non-goals
- Do not implement provider-native token/cost accounting in this slice.
- Do not change existing budget gate semantics.
- Do not make real Pi/model tests part of default `npm test`.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-046: add budget command plan`
2. `IMPL-178: add budget formatting and command parsing`
3. `IMPL-179: add budget command integration`
4. `IMPL-180: add mocked budget command integration coverage`
5. `IMPL-181: add real budget command integration coverage`
6. `IMPL-182: document budget command coverage`
