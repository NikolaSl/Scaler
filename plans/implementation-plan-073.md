# Implementation Plan 073 — GAP-019 Web Research Transactions and Tool Discovery

## Goal
Narrow GAP-019 by adding deterministic browser/MCP research tool discovery, multi-query web research transaction records, and source freshness/version evidence for internet/mixed research requests.

## Scope
- Add `.scaler/research/transactions.json` for web research tool-discovery, query, and source-review transaction records.
- Discover candidate browser/search/MCP documentation tools from the existing tool schema catalog.
- Add `/scaler-research-web` to plan or execute multi-query internet/mixed research using explicit or discovered tools.
- Add `/scaler-research-transactions` for transaction inspection.
- Preserve explicit internet grants and safety defaults: no network-capable child tools are granted unless `internet` is supplied and tools are explicit or discovered.
- Record source freshness/version diagnostics from ingested research reports.
- Add unit, command, mocked integration, and targeted opt-in real Pi coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not run browser/MCP/network research by default.
- Do not bypass existing research internet-grant or safety policy.
- Do not require live internet in default tests.
- Do not implement full autonomous Stage II knowledge orchestration.

## Validation
- Targeted research web unit/command/mock tests.
- Targeted real Pi web-research planning command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-073: add web research transaction plan`
2. `IMPL-293: add web research transaction workflow`
3. `IMPL-294: cover web research transaction flows`
4. `IMPL-295: document web research transaction coverage`
