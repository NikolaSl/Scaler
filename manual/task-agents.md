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
