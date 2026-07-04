# Implementation Plan 085 — GAP-023 Child-Agent Safety Defaults

## Goal
Close GAP-023 by making child Pi agent invocation deny tools by default and by loading the SCALER extension/safety hooks whenever child agents are granted tools.

## Scope
- Change child-agent invocation construction so omitted or empty tool lists become `--no-tools`.
- Add a deterministic default SCALER extension path for child agents with granted tools, unless an explicit extension path is already supplied.
- Preserve explicit `noTools` behavior as an override that suppresses tool grants.
- Record and test invocation policy behavior for task/stage/research/debug/replan/tool subprocesses through shared subagent construction.
- Update docs, inventory, traceability, and backlog to close GAP-023.

## Non-goals
- Do not implement parent-session active-tool narrowing (tracked by GAP-033).
- Do not implement audit redaction/large-output externalization (tracked by GAP-031).
- Do not implement sandbox execution wrappers (tracked by GAP-029).

## Validation
- Targeted subagent/tool-agent/stage/research tests.
- `npm test`
- `npm run build`
- Targeted real Pi child/tool invocation coverage where practical.

## Commits
1. `PLAN-085: add child-agent safety defaults plan`
2. `IMPL-329: enforce child-agent safe invocation defaults`
3. `IMPL-330: cover child-agent safety defaults`
4. `IMPL-331: document child-agent safety coverage`
