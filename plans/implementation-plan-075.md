# Implementation Plan 075 — GAP-012 Closed Tool Replay Approvals

## Goal
Narrow GAP-012 by adding explicit approval controls for replaying closed tool-agent transactions without weakening the default closed-request replay refusal.

## Scope
- Add persisted replay approval records under `.scaler/tool-requests/replay-approvals.json`.
- Add `/scaler-tool-replay-approval` to list, create, and revoke exact transaction replay approvals.
- Extend `/scaler-tool-replay <transactionId> [execute] [approval=<id>]` so execute mode can replay a closed request only when a matching active approval is supplied.
- Consume approval use counts and mark approvals consumed/expired/revoked deterministically.
- Preserve existing default: closed-request replay without an approval remains rejected.
- Add unit/parser/mock/targeted real command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not add MCP server enumeration in this slice.
- Do not add parallel tool scheduling in this slice.
- Do not auto-approve or auto-select closed replay approvals.
- Do not weaken structured `scaler_tool_result` requirements for replay completion.

## Validation
- Targeted tool replay approval unit/command/mock tests.
- Targeted real Pi replay-approval command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-075: add closed tool replay approval plan`
2. `IMPL-299: add closed replay approval workflow`
3. `IMPL-300: cover closed replay approval flows`
4. `IMPL-301: document closed replay approval coverage`
