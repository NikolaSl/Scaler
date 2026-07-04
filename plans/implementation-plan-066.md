# Implementation Plan 066 — GAP-010 Persistent Safety Policy Configuration

## Goal
Add durable, auditable safety policy configuration so explicit internet/external-mutation allowances survive across Pi sessions instead of existing only as in-memory call options.

## Scope
- Add `.scaler/safety/policy.json` with normalized policy fields:
  - `allowInternet`;
  - `allowExternalMutations`;
  - `updatedAt`.
- Add load/save/format helpers for persisted safety policy.
- Merge persisted policy into the extension `tool_call` safety hook while preserving task-local allowed-path restrictions.
- Add `/scaler-safety-policy` for status and explicit `allow-internet=on/off`, `allow-external=on/off` updates.
- Add unit, mocked integration, and targeted opt-in real Pi command persistence coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not create interactive approval prompts.
- Do not weaken protected-path, destructive, or secret-environment blocks.
- Do not add sandbox execution or scanner integrations.

## Validation
- Targeted real Pi safety-policy command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-066: add persistent safety policy plan`
2. `IMPL-272: add persisted safety policy config`
3. `IMPL-273: cover safety policy command and hook flow`
4. `IMPL-274: document safety policy coverage`
