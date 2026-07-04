# Implementation Plan 077 — GAP-012 Safe Parallel Tool Scheduling

## Goal
Close GAP-012 by adding safe scheduling for multiple prepared tool-agent requests, including parallel batches for independent low-risk requests and serialized handling for side-effecting or uncertain requests.

## Scope
- Add persisted tool schedule records under `.scaler/tool-requests/schedules.json`.
- Add `/scaler-tool-schedule [execute] [parallel=N]` to plan or execute prepared tool requests.
- Classify requests as parallelizable only when the request and allowed tool catalog metadata are low-risk/read-only; unknown, medium/high/destructive/external/secret requests are serialized.
- Execute safe batches with bounded parallelism when explicitly requested; otherwise only record the plan.
- Add `/scaler-tool-schedules [requestId]` for inspection.
- Preserve structured `scaler_tool_result` enforcement for every child transaction.
- Add unit/parser/mock/targeted real command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not run schedules by default.
- Do not parallelize risky, side-effecting, external, secret, or unknown requests.
- Do not infer dependencies beyond conservative risk/tool classification.

## Validation
- Targeted scheduler unit/command/mock tests.
- Targeted real Pi schedule planning command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-077: add safe tool scheduling plan`
2. `IMPL-305: add safe tool scheduling workflow`
3. `IMPL-306: cover safe tool scheduling flows`
4. `IMPL-307: document safe tool scheduling coverage`
