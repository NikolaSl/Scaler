# Task Agents

Scaler has an experimental task-agent subprocess runner.

The runner builds isolated Pi invocations using JSON print mode:

```text
pi --mode json -p --no-session <task-prompt>
```

Supported options:

- limited tools via `--tools`
- model selection via `--model`
- generated system prompt file via `--append-system-prompt`
- extension loading via `-e`
- working directory per task

Child agents must load Scaler safety/logging rules or run inside an approved sandbox before unattended use.

Current implementation provides the invocation builder, subprocess runner, persisted run records under `.scaler/reports/task-agent-runs.json`, and repo-wide execution locking for task-agent execution.

`scaler_spawn_task` supports:

- `execute: false` or omitted — prepare invocation only.
- `execute: true` — run the task-agent subprocess.
- `timeoutMs` — optional timeout.

Task-agent run results include:

- exit code
- parsed stdout event count in run records
- stderr summary in run records
- `timedOut` flag
- `aborted` flag

Use `/scaler-runs [taskId]` to inspect recent run records.

Current conductor integration starts selected tasks, records run results, writes validation handoffs, and transitions successful executions to `validating`. Task-agent prepare/execute operations are sequential per repository and are refused while another execution lock is held.

Before preparing or executing a selected task, the conductor checks the debug retry gate. A task is refused when unresolved repeated failure fingerprints, blocked debug attempts, or debug cycles exist without later `newEvidence` or an accepted/resolved debug replan request.

Task-agent prompts include a compression and exact-preservation section derived from resolved context metadata. Agents are instructed to preserve `exact` refs unchanged, summarize only `summary-ok` refs, keep `reference-only` refs compact, externalize large exact material to memory/files, and split work when active context exceeds the 75% target.
