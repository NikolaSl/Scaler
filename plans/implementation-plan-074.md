# Implementation Plan 074 — GAP-012 Tool Iteration Correction Loops

## Goal
Narrow GAP-012 by adding a policy-driven tool-agent iteration controller that can retry open tool requests after missing structured results, while preserving structured-result enforcement and safe defaults.

## Scope
- Add persisted tool iteration policy under `.scaler/tool-requests/iteration-policy.json`.
- Add persisted tool iteration run ledger under `.scaler/tool-requests/iteration-runs.json`.
- Add `/scaler-tool-iteration-policy` to inspect/update max-iteration and auto-replay settings.
- Add `/scaler-tool-iterate [requestId] [execute] [max=N]` to prepare or execute bounded correction loops for open prepared tool requests.
- In each loop, run the initial tool transaction and then replay the latest missing-result transaction until a structured result closes the request, the request is blocked/failed, or the iteration cap is reached.
- Keep closed-request replay blocked unless a later approval slice changes that behavior.
- Add unit/parser/mock/targeted real command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not add closed-request replay approvals in this slice.
- Do not enumerate MCP servers in this slice.
- Do not add parallel tool scheduling in this slice.
- Do not weaken structured `scaler_tool_result` requirements.

## Validation
- Targeted tool iteration unit/command/mock tests.
- Targeted real Pi tool-iteration policy command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-074: add tool iteration correction plan`
2. `IMPL-296: add tool iteration correction workflow`
3. `IMPL-297: cover tool iteration correction flows`
4. `IMPL-298: document tool iteration correction coverage`
