# Implementation Plan 051 — GAP-019 Explicit Research Internet Tool Grants

## Goal
Make internet/mixed research execution explicit and auditable by distinguishing research scope from actual tool grants, so internet-capable tools are only passed to research agents when the operator explicitly grants them.

## Scope
- Add research-agent option fields for `allowInternet` and explicit `tools` grants.
- Add deterministic research tool-policy formatting in focused research-agent prompts:
  - local requests: no internet tools required;
  - internet/mixed requests without explicit grants: instruct the agent to report limitation as partial/blocked;
  - internet/mixed requests with `allowInternet` and tools: list granted tools and safety constraints.
- Extend `/scaler-research-run [requestId] [execute] [internet] [tools=a,b]` parsing and command integration.
- Add unit tests for parser/tool-policy formatting/invocation args.
- Add mocked integration coverage showing an internet-scope request first prepares without tools, then with explicit grants includes only requested tools and logs prompt details.
- Add opt-in real Pi/model coverage for a cardinal internet-scope research report with explicit no-tools disabled only when grants are provided.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not implement browser/MCP discovery or actual web search automation yet.
- Do not grant `bash` internet transfer by default.
- Do not bypass existing safety hooks for internet-capable shell commands.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-051: add research internet grant plan`
2. `IMPL-202: add research internet grant core`
3. `IMPL-203: wire research-run internet grant command args`
4. `IMPL-204: add mocked research internet grant integration coverage`
5. `IMPL-205: add real research internet grant coverage`
6. `IMPL-206: document research internet grant coverage`
