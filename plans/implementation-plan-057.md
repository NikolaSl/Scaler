# Implementation Plan 057 — GAP-012 Supervised Tool Schema Discovery Probes

## Goal
Add a supervised discovery-probe runner for Tool/MCP schema metadata so SCALER can prepare or execute a focused child agent that inspects explicitly granted schema/help tools and must complete through `scaler_tool_schema`.

## Scope
- Add `.scaler/tool-requests/schema-runs.json` for schema discovery probe runs.
- Add a schema-discovery child-agent prompt builder and runner:
  - requires an explicit target tool name;
  - never grants the target/internet/MCP tools implicitly;
  - includes only `scaler_tool_schema` plus explicitly supplied `tools=...` grants;
  - records prepare-mode invocations;
  - in execute mode, marks `completed` only if a new structured `scaler_tool_schema` record appears for the target tool;
  - marks `missing_schema` when child output lacks structured schema ingestion.
- Add `/scaler-tool-discover <toolName> [execute] [tools=a,b]` and `/scaler-tool-discovery-runs [toolName]` commands.
- Add unit tests for prompt/grant behavior, prepare, structured completion, and missing-schema handling.
- Add mocked integration for discovery probe → schema ledger → later tool request prompt injection.
- Add opt-in real Pi prepare-mode command coverage; no real external MCP/network access.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not auto-connect to arbitrary external MCP servers.
- Do not infer internet/browser grants from target tool names.
- Do not treat free-form child-agent prose as discovery completion.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-057: add tool schema discovery probe plan`
2. `IMPL-235: add tool schema discovery probe runner`
3. `IMPL-236: add tool schema discovery commands`
4. `IMPL-237: cover mocked schema discovery probe flow`
5. `IMPL-238: add real Pi schema discovery probe coverage`
6. `IMPL-239: document schema discovery probe coverage`
