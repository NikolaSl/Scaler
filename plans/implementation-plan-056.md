# Implementation Plan 056 — GAP-012 Tool/MCP Schema Discovery Ledger

## Goal
Add a deterministic discovery ledger for tool/MCP schemas and docs so isolated tool-agent prompts can include verified locally persisted metadata instead of relying only on static defaults or guessing unknown tools.

## Scope
- Add `.scaler/tool-requests/catalog.json` discovered-tool records.
- Add structured `scaler_tool_schema` ingestion for tool/schema/doc metadata:
  - tool name, source, risk/permission/safety metadata;
  - schema/docs references and concise notes;
  - structured evidence refs and provenance agent id.
- Merge latest discovered metadata into selected tool catalog entries used by `scaler_tool_request` and `/scaler-tool-run` prompts.
- Add `/scaler-tool-catalog [toolName]` to list static + discovered catalog metadata.
- Add unit tests for schema ingestion, latest-record merge behavior, prompt injection, and command parsing/registration.
- Add mocked integration covering discovery → request → transaction prompt includes discovered schema metadata.
- Add opt-in real Pi cardinal contract coverage for exact `scaler_tool_schema` tool-call ingestion if deterministic.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not call external MCP servers automatically in this slice.
- Do not grant internet/network tools by default.
- Do not execute discovered tools automatically.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-056: add tool schema discovery ledger plan`
2. `IMPL-228: add tool schema discovery ledger`
3. `IMPL-229: add tool schema command and tool wiring`
4. `IMPL-230: cover mocked tool schema prompt flow`
5. `IMPL-231: add real Pi tool schema coverage`
6. `IMPL-232: document tool schema discovery coverage`
