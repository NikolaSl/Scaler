# Task Agents

Scaler has an experimental task-agent subprocess runner.

The runner builds isolated Pi invocations using JSON print mode:

```text
pi --mode json -p --no-session --no-tools <task-prompt>
```

Supported options:

- deny-by-default tools via `--no-tools` when no explicit tool grant exists
- limited tools via `--tools`
- model selection via `--model`
- generated system prompt file via `--append-system-prompt`
- extension loading via `-e`
- working directory per task

Child agents now default to `--no-tools` for omitted or empty tool lists. When a child agent is granted tools, SCALER automatically adds the project SCALER extension path unless an explicit extension path is supplied, so parent safety hooks and policy checks are loaded in the child process. Explicit `noTools` suppresses granted tools even if a tool list is present.

Current implementation provides the invocation builder, subprocess runner, persisted run records under `.scaler/reports/task-agent-runs.json`, structured task-agent report records under `.scaler/reports/task-agent-reports.json`, and repo-wide execution locking for task-agent execution.

Task definitions are quality-gated before user-facing creation/update and planner application. A task must carry allowed paths, Definition of Done, an atomicity rationale, task-specific validation refs/commands, and task kind metadata; software/mixed tasks must also include test-first/update-tests-before-implementation coverage or an explicit waiver with a reason. Reviews and waivers are persisted under `.scaler/reports/task-quality.json`.

`scaler_spawn_task` supports:

- `execute: false` or omitted — prepare invocation only; the task is not marked running.
- `execute: true` — run the task-agent subprocess.
- `timeoutMs` — optional timeout.

Task-agent run results include:

- exit code
- parsed stdout event count in run records
- stderr summary in run records
- `timedOut` flag
- `aborted` flag
- task-report ingestion status (`accepted`, `missing`, `invalid`, or `not_required`)

Timeouts return exit code 124, cancellation returns 130, and signal-only exits are failures. The runner sends SIGTERM and escalates to SIGKILL after five seconds if the directly owned process has not exited. Cleanup evidence is recorded after process closure. Descendant-process containment is not established by this mechanism.

The conductor marks a task running only after admission, immediately before dispatch. After execution it reloads persisted state to preserve child updates and rejects results when the run was replaced or the task is no longer eligible. General revision-checked writes and attempt-bound acceptance remain planned work.

Use `/scaler-runs [taskId]` to inspect recent run records and `/scaler-task-reports [taskId]` to inspect accepted structured reports.

Current conductor integration starts selected tasks, records run results, writes validation handoffs, and transitions only successful executions with an accepted `scaler_task_report` status `completed` to `validating`. Successful executions that omit the report or emit an invalid/mismatched report are moved to `blocked` and recorded with `task_agent_report_missing` or `task_agent_report_invalid` handoffs. Reports with status `blocked`, `needs_data`, or `needs_replan` also block validation; `blocked`/`needs_data` reports with `missingData` create structured missing-context requests under `.scaler/context/missing-requests.json` and resolved requests can move the task back to `ready`. Reports with status `failed` fail the task before validation. Task-agent prepare/execute operations are sequential per repository and are refused while another execution lock is held.

Before preparing or executing a selected task, the conductor checks the debug retry gate. A task is refused when unresolved repeated failure fingerprints, blocked debug attempts, or debug cycles exist without later `newEvidence` or an accepted/resolved debug replan request. Cycle detection includes longer hidden fingerprint chains such as A→B→C→A.

Focused debug-agent runs are available through `/scaler-debug-run [taskId] [execute]`. The debug agent receives the failure records, compact attempt stack, detected cycles, related research summary, and related replan requests. It must emit exactly one structured `scaler_debug_report` JSON event. Accepted debug reports either record the next evidence-backed approach, create research requests, or create a debug-blocked replan request when realistic debug/research paths are exhausted.

Task-agent prompts include a compression and exact-preservation section derived from resolved context metadata. Agents are instructed to preserve `exact` refs unchanged, summarize only `summary-ok` refs, keep `reference-only` refs compact, externalize large exact material to memory/files, and split work when active context exceeds the 75% target.
