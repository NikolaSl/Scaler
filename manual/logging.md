# Logging

SCALER writes append-only audit events to:

```text
.scaler/logs/events.jsonl
```

Each event is one JSON object per line. Large payloads are stored as JSON detail files under:

```text
.scaler/logs/details/
```

Events that have a `detailsPath` point at a detail file with the full prompt, report, command payload, tool payload, validation summary, or commit result.

## Logged coverage

Implemented audit coverage includes:

- command lifecycle: `start`, `end`, and `error` events for registered SCALER commands.
- tool calls: observed Pi `tool_call` events plus SCALER tool result records with detail refs.
- agent prompts: task, stage, replanner, research-agent, and debug-agent prompts are persisted to detail files.
- structured reports: supervisor reports, stage artifacts, replan proposals, research reports, and debug reports are logged with detail refs when ingested or rejected.
- transitions: report-driven accepted/rejected transitions are logged as `transition` or `rejected_transition` events.
- validation: validation runs record command summaries and append validation audit detail files.
- git commits: commit attempts and accepted commit ids are logged with detail refs and commit hashes in `outputRefs`.
- safety/budget/state/debug/memory events continue to use the same JSONL log.

## Event types

Common event types include:

- `command`
- `state`
- `transition`
- `rejected_transition`
- `agent`
- `tool`
- `report`
- `validation`
- `debug`
- `research`
- `git`
- `safety`
- `budget`
- `system`

## Notes

SCALER preserves structured JSON audit data; it does not parse arbitrary free-form child-agent text into reports. Child report ingestion remains structured-only.
