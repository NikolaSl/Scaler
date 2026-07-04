# Implementation Plan 050 — GAP-012 Tool Catalog and Structured Tool Requests

## Goal
Strengthen tool/MCP isolation by giving requester agents a compact tool catalog model and richer structured tool-request metadata before future multi-iteration tool-agent execution.

## Scope
- Add `ToolRiskLevel`, `ToolCatalogEntry`, default SCALER tool catalog helpers, and catalog formatting.
- Extend `ToolRequestInput`/records with requester agent id, expected output, required format, risk level, permission requirement, and safety notes.
- Include selected catalog entries and the richer request contract in isolated tool-agent prompts without exposing unrelated tool docs.
- Extend the `scaler_tool_request` tool schema and executor to persist the new metadata.
- Add unit tests for catalog formatting, metadata normalization, persistence, and prompt isolation.
- Add mocked integration coverage for command/tool-request preparation with rich metadata and audit logs.
- Add opt-in real Pi/model coverage for a cardinal `scaler_tool_request` call with exact metadata.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not implement multi-iteration tool-agent execution in this slice.
- Do not fetch MCP docs/schemas automatically yet.
- Do not execute requested tools beyond preparing the isolated invocation.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-050: add tool catalog request plan`
2. `IMPL-197: add tool catalog and request metadata core`
3. `IMPL-198: wire tool request metadata into SCALER tool`
4. `IMPL-199: add mocked tool request metadata integration coverage`
5. `IMPL-200: add real tool request metadata coverage`
6. `IMPL-201: document tool request metadata coverage`
