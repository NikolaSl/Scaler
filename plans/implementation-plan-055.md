# Implementation Plan 055 — GAP-012 Tool Transaction Execution Ledger

## Goal
Move isolated tool/MCP requests beyond prompt preparation/result closure by adding deterministic transaction records for prepared/executed tool-agent runs, with durable completion recognized only through structured `scaler_tool_result` ledger updates.

## Scope
- Add `.scaler/tool-requests/transactions.json` transaction records for isolated tool-agent activity.
- Add a tool-request runner that:
  - selects an explicit prepared/open tool request;
  - rebuilds the isolated tool-agent prompt/invocation from the stored request;
  - records prepare-mode transactions without executing;
  - executes the isolated tool-agent with only the request's allowed tools when `execute` is present;
  - reloads request/result ledgers after execution;
  - marks transaction completion only when a structured `scaler_tool_result` closed the request;
  - records `missing_result` when a child process exits without a structured result, preserving structured-only completion semantics.
- Add concise transaction formatting/replay metadata so a previous invocation/run can be inspected without trusting final prose.
- Add `/scaler-tool-run [requestId] [execute]` and `/scaler-tool-transactions [requestId]` commands.
- Add unit tests for prepare, execution with structured result closure, and missing-result handling.
- Add mocked integration coverage for request → tool-run → structured result closure and free-form/missing result rejection.
- Add opt-in real Pi command-dispatch coverage for prepare-mode transaction persistence; avoid requiring real external MCP/network access.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not implement automatic MCP/browser discovery in this slice.
- Do not perform external network/browser transactions by default.
- Do not treat free-form child-agent prose as completion.
- Do not add parallel scheduling yet.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-055: add tool transaction ledger plan`
2. `IMPL-223: add tool transaction runner and ledger`
3. `IMPL-224: add tool transaction commands`
4. `IMPL-225: cover mocked tool transaction execution`
5. `IMPL-226: add real Pi tool transaction command coverage`
6. `IMPL-227: document tool transaction coverage`
