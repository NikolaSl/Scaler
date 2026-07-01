# SCALER Logging Spec

## Purpose

Scaler must keep active context small, but preserve a full audit trail of what happened.

Agents may summarize or remove middle steps from active context after a decision, but raw execution history must remain available in structured logs.

## Principle

Active context is for current reasoning. Logs are for audit, replay, debugging, and later Scaler improvement.

## Log location

Store logs under `.scaler/logs/`.

See also `specs/storage.md` for compression, rotation, retention, and disk safety rules.

Suggested files:

- `.scaler/logs/events.jsonl` — append-only structured event log.
- `.scaler/logs/agents/` — agent prompts, reports, and outputs.
- `.scaler/logs/tools/` — large tool requests/results when too big for event log.
- `.scaler/logs/validation/` — validation commands and results.

## Event fields

Each log event should include:

- timestamp
- run id
- stage
- state
- task id, if any
- agent id, if any
- agent type
- event type
- short summary
- input/reference ids, if any
- output/reference ids, if any
- details or details file path
- token/cost usage when available

## Events to log

- Supervisor state transitions.
- Rejected transitions and reasons.
- Plan versions, replanning triggers, replanning input packages, and replanning reports.
- Agent spawn requests.
- Agent prompts and allowed tools.
- Memory writes and retrievals.
- Tool/MCP requests, exact commands/calls, results, failures, and safety decisions.
- Local/internet investigations, search queries, source quality decisions, contradictions, and research reports.
- Validation manifests, commands, results, skipped gates, and acceptance decisions.
- Debug failure records, attempt records, fingerprints, cycles, and outcomes.
- Decisions and evidence references.
- Git repository initialization, status checks, commits, skipped commits, and dirty-tree blockers.
- Safety decisions, approvals, blocked actions, policy overrides, and security scan results.
- Budget, timeout, watchdog, checkpoint, pause, resume, and approval events.

## Investigation logging

Task agents may investigate local data and internet sources when needed.

Investigation order:

1. Local files, docs, logs, tests, and history.
2. External sources only when local data is insufficient and internet access is allowed.

The active context should keep only the final useful conclusion, evidence references, and next action. Raw investigation steps should stay in logs and memory files when useful.

## Later analysis

Logs should be structured enough for another agent or human to answer:

- What happened?
- Why was a decision made?
- Which evidence was used?
- Which attempts failed?
- Which validation accepted the result?
- Where did tokens/time get spent?

This allows Scaler to improve from real executions without bloating active task context.

Large logs should be compressed and rotated according to `specs/storage.md`.
