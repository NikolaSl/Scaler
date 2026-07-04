# Implementation Plan 076 — GAP-012 MCP Server Enumeration

## Goal
Narrow GAP-012 by adding deterministic local MCP server enumeration records so SCALER can see available project-declared MCP servers without injecting full MCP documentation into requester-agent context.

## Scope
- Add persisted MCP server enumeration catalog under `.scaler/tool-requests/mcp-servers.json`.
- Discover server declarations from project-local JSON config files such as `.mcp.json`, `mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.claude/mcp.json`, `claude_desktop_config.json`, and `package.json` MCP fields.
- Record concise server metadata: name, source path, transport, command/url shape, env key names only, risk level, status, and message.
- Add `/scaler-mcp-enumerate` to run local config enumeration and `/scaler-mcp-servers [name]` to inspect records.
- Never execute MCP servers or expose secret env values during enumeration.
- Add unit/mock/targeted real command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not connect to or execute MCP servers in this slice.
- Do not add parallel tool scheduling in this slice.
- Do not inject full MCP schemas into normal requester-agent context.

## Validation
- Targeted MCP enumeration unit/mock tests.
- Targeted real Pi MCP enumeration command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-076: add MCP enumeration plan`
2. `IMPL-302: add MCP enumeration workflow`
3. `IMPL-303: cover MCP enumeration flows`
4. `IMPL-304: document MCP enumeration coverage`
