# Implementation Plan 052 — GAP-012 Tool-Agent Result Ledger

## Goal
Add a deterministic structured result ledger for isolated tool-agent work so `scaler_tool_request` is not only a prompt/invocation artifact but can be closed by a validated result report.

## Scope
- Add `.scaler/tool-requests/results.json` path and typed `ToolResultRecord` schema.
- Implement `recordToolResult`, `loadToolResults`, validation, newest-first sorting, and request status updates from `prepared` to `completed`/`failed`/`blocked`.
- Add a registered `scaler_tool_result` tool for structured result ingestion with fields for request id, status, summary, outputs, evidence refs, validation performed, errors, and follow-up recommendations.
- Update tool-agent prompt to require `scaler_tool_result` as the completion mechanism.
- Add unit tests for result validation, persistence, and request status updates.
- Add mocked integration coverage for request → result ledger closure.
- Add opt-in real Pi/model cardinal coverage for exact `scaler_tool_result` tool invocation and persisted state.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not implement multi-iteration autonomous tool-agent execution yet.
- Do not discover MCP schemas automatically yet.
- Do not execute arbitrary external/browser tools by default.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-052: add tool result ledger plan`
2. `IMPL-207: add tool result ledger core`
3. `IMPL-208: register structured tool result ingestion`
4. `IMPL-209: add mocked tool result integration coverage`
5. `IMPL-210: add real tool result cardinal coverage`
6. `IMPL-211: document tool result ledger coverage`
