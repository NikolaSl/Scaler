# Implementation Plan 058 — GAP-012 Tool Transaction Replay Controls

## Goal
Add supervised replay controls for persisted isolated tool-agent transactions so previous invocations can be re-prepared or re-executed deterministically without trusting final prose.

## Scope
- Extend `.scaler/tool-requests/transactions.json` records with optional replay linkage.
- Add a transaction replay runner that:
  - selects an explicit prior transaction id;
  - reconstructs prompt/tools from the persisted invocation;
  - records prepare-mode replay transactions without child execution;
  - executes only when the originating request is still `prepared`;
  - marks completion only when a structured `scaler_tool_result` closes the request;
  - records `missing_result` when replayed child output lacks a structured result.
- Add `/scaler-tool-replay <transactionId> [execute]` command.
- Add unit tests for prepare replay, structured completion replay, closed-request refusal, and missing-result replay.
- Add mocked integration for missing-result transaction replay to structured completion.
- Add opt-in real Pi prepare-mode replay command coverage.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not add automatic correction loops in this slice.
- Do not replay completed/failed/blocked requests without a future explicit approval policy.
- Do not infer or grant extra tools beyond the persisted transaction invocation.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-058: add tool transaction replay plan`
2. `IMPL-240: add tool transaction replay runner`
3. `IMPL-241: add tool transaction replay command`
4. `IMPL-242: cover mocked tool transaction replay flow`
5. `IMPL-243: add real Pi tool replay coverage`
6. `IMPL-244: document tool transaction replay coverage`
