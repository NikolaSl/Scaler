# Commands

All registered SCALER commands write command audit events to `.scaler/logs/events.jsonl` with full command detail records under `.scaler/logs/details/`.

## `/scaler <request>`

Starts a minimal adaptive Scaler run.

Current behavior:

- creates/loads `.scaler/state.json`
- selects a complexity level from the request text
- moves supervisor state to the initial stage for that level
- logs the request to `.scaler/logs/events.jsonl`
- shows compact status

This is an early entrypoint. It does not yet execute the full Stage I-IV workflow.

## `/scaler-step [execute]`

Runs one minimal deterministic conductor step.

Current behavior:

- selects the next `ready` task, or promotes/selects the first `pending` task
- transitions the task to `running`
- builds a task-agent prompt from resolved context
- prepares an isolated Pi task-agent invocation
- writes a checkpoint under `.scaler/checkpoints/`

By default it prepares only. Passing `execute` runs the task-agent subprocess. A successful task-agent run moves the task to `validating` and writes a validation handoff under `.scaler/reports/validation-handoffs.json`; a failed task-agent run moves the task to `failed` where valid. Executed task-agent runs are recorded under `.scaler/reports/task-agent-runs.json`.

`/scaler-step` runs under the repo-wide execution lock.

## `/scaler-validation-add <taskId> | <id> | <command> | <description> | <required> | <gate> | <expected> | <evidence refs> | <environment> | <disposition>`

Adds or replaces one command in a task validation manifest.

Examples:

```text
/scaler-validation-add T-001 | test | npm test | Run tests | required | unit | exits 0 | tests:T-001 | host
/scaler-validation-add T-001 | lint | npm run lint | Run lint | optional | static_checks | exits 0
/scaler-validation-add T-001 | local-ci | docker compose run --rm test | Run local CI in Compose | required | local_ci | exits 0 | ci:T-001 | compose
/scaler-validation-add T-001 | integration | npm run test:integration | Integration tests | required | integration | exits 0 | tests:T-001 | host | skipped:No integration surface changed
```

`required` accepts true/yes/required/1 and false/no/optional/0. Unknown or omitted values default to required when saved. Gate aliases are normalized to typed values such as `dependency_check`, `test_first`, `unit_tests`, `build_compile`, `static_checks`, `integration_tests`, `security_checks`, `local_ci`, `acceptance_smoke`, and non-software evidence gates such as `completeness`, `consistency`, `compliance`, `source_validation`, `adversarial_review`, and `uncertainty_report`. Environment aliases normalize to `host`, `docker`, `compose`, `devcontainer`, `minikube`, or `local_ci`. The optional disposition field defaults to `run`; it also accepts `skipped:<reason>` (including skip/not-applicable aliases) or `blocked:<reason>`. Required skipped gates need an accepted reason and are recorded as `skipped` without executing the command; blocked gates need a blocker reason and required blocked gates block validation/task progress. Missing required skip reasons and any missing block reason fail policy before command execution. Required `dependency_check` commands must precede non-policy validation gates, and required `test_first` commands must precede implementation validation gates; required `local_ci` gates must declare a non-host environment. Commands that invoke Docker/Compose/dev-container/Minikube tooling without matching environment metadata fail policy before execution. Declared non-host environments are prepared before command execution and cleaned up afterward with lifecycle evidence under `.scaler/reports/validation-environments.json`; missing required external tooling blocks the command before its shell command runs.

## `/scaler-validation-checklist <taskId> | <gate> | <summary> | <id::status::required::statement::evidence;...> | <evidence refs>`

Records a deterministic non-software validation checklist under `.scaler/reports/validation-checklists.json` and applies the rolled-up result to the task. Item statuses are `passed`, `failed`, `blocked`, or `not_applicable`; required failed items fail the checklist, required blocked items block it, and optional failures are recorded without failing the checklist. Evidence-required gates (`acceptance_smoke`, `completeness`, `compliance`, `source_validation`, and `adversarial_review`) also fail when a required passed item has no item-level evidence and the checklist has no top-level evidence refs.

Example:

```text
/scaler-validation-checklist T-001 | completeness | Acceptance checklist complete | scope::passed::required::Scope covered::docs:scope;edge::failed::optional::Edge cases documented::docs:edge | review:T-001
```

## `/scaler-commit [taskId] | [allowed paths comma list]`

Commits a validated task using the git safety helper. Commits run under the repo-wide execution lock.

Selection rules:

1. explicit task id
2. current task if it is validated
3. first validated task

Allowed paths come from explicit command args or the task's stored allowed paths.

Examples:

```text
/scaler-commit T-001 | src,test
/scaler-commit
```

The command refuses commits when unrelated changes are detected, the task is not validated, or the project is not a git repository.

## `/scaler-validate-loop [taskId] [execute] [max=N]`

Runs validation first and, only if validation fails and the task becomes `debugging`, starts `/scaler-debug-loop` after the validation execution lock is released. Validation always executes; the optional `execute` flag controls whether the debug loop executes child agents or only prepares the first handoff. The workflow does not auto-accept replans.

## `/scaler-validate [taskId]`

Runs validation for a task id, the current validating task, or the first validating task. Validation runs under the repo-wide execution lock.

Current behavior:

- uses a per-task validation manifest from `.scaler/reports/validation-manifests.json` when present
- otherwise falls back to default project commands from `package.json` scripts (`npm test`, `npm run build`)
- evaluates dependency/test-first, environment, and skipped/blocked disposition policy diagnostics before command execution
- prepares declared non-host validation environments (`local_ci`, Docker, Compose, devcontainer, Minikube), blocks required commands when required tooling is unavailable, and records prepare/cleanup evidence in `.scaler/reports/validation-environments.json`
- writes validation runs to `.scaler/reports/validation-runs.json`
- records dispositioned commands as `skipped` or `blocked` without executing them
- moves all-passing validating tasks to `validated`
- moves failing validating tasks to `debugging`
- moves blocked validating tasks to `blocked` and requests replanning where allowed

## `/scaler-validation-envs`

Shows recent validation environment lifecycle records from `.scaler/reports/validation-environments.json`, including command id, environment, prepare/cleanup phase, status, and message.

## `/scaler-pause [reason]`

Pauses the current Scaler run through the supervisor transition rules and writes a checkpoint under `.scaler/checkpoints/`.

## `/scaler-resume [reason]`

Resumes a paused run only to its previous active stage and writes a checkpoint under `.scaler/checkpoints/`.

## `/scaler-storage-status`

Scans `.scaler/`, writes `.scaler/storage/index.json`, updates the `storageBytes` budget counter, and shows total bytes, top-level summaries, largest files, and the storage budget decision. A configured `storageBytes` hard limit pauses the run through the existing budget gate.

## `/scaler-storage-maintain [execute] [delete-cache] [delete-archives] [delete-raw-logs] [delete-memory] [no-compress] [rotate-active] [min-age-days=N] [min-size=N] [max-active-bytes=N] [min-free-bytes=N] [max-archive-bytes=N] [max-archive-age-days=N] [max-raw-log-bytes=N] [max-raw-log-age-days=N] [max-memory-bytes=N] [max-memory-age-days=N]`

Plans or executes safe maintenance inside `.scaler/`. Without `execute`, SCALER writes a dry-run report to `.scaler/storage/maintenance.json` and does not mutate storage. With `execute`, it gzips eligible old/large files under `.scaler/logs/details/`, non-active `.scaler/reports/`, and `.scaler/memory/`, removes the source only after a non-empty `.gz` is written, optionally deletes `.scaler/cache/` files when `delete-cache` is present, optionally rotates active `.scaler/logs/events.jsonl` and known append-style `.scaler/reports/*` ledgers when `rotate-active` is present and they exceed `max-active-bytes`, optionally deletes only `.scaler/storage/archive/` files when `delete-archives` is present and `max-archive-bytes`/`max-archive-age-days` select retention targets, optionally deletes `.scaler/logs/details/` files only when `delete-raw-logs` plus raw-log age/size quotas select targets, optionally deletes `.scaler/memory/*` content files only when `delete-memory` plus memory age/size quotas select targets, prunes deleted memory entries from `.scaler/memory/index.json`, records an optional `min-free-bytes` disk-space check, refreshes storage accounting, updates the `storageBytes` budget counter, and writes command/state audit events.

Defaults: compression enabled, cache deletion disabled, archive/raw-log/memory deletion disabled, active rotation disabled, `min-age-days=7`, `min-size=1048576`, `max-active-bytes=10485760`, and no minimum-free-disk/archive/raw-log/memory quota thresholds.

Examples:

```text
/scaler-storage-maintain min-age-days=30 min-size=1048576
/scaler-storage-maintain execute delete-cache min-age-days=30 min-size=1048576
/scaler-storage-maintain no-compress delete-cache min-age-days=14
/scaler-storage-maintain execute rotate-active no-compress max-active-bytes=10485760 min-free-bytes=1000000000
/scaler-storage-maintain execute no-compress delete-archives max-archive-bytes=50000000 max-archive-age-days=30
/scaler-storage-maintain execute no-compress delete-raw-logs max-raw-log-age-days=30 delete-memory max-memory-age-days=90
```

## `/scaler-storage-schedule [enable|disable] [run] [force] [execute=on/off] [interval-hours=N] [compress=on/off] [delete-cache=on/off] [rotate-active=on/off] [delete-archives=on/off] [delete-raw-logs=on/off] [delete-memory=on/off] ...`

Shows or updates `.scaler/storage/schedule.json`. When enabled, SCALER checks the schedule at Pi `session_start`; if due, it runs the configured storage maintenance policy, updates `lastRunAt`/`nextRunAt`, refreshes `storageBytes`, and logs the result. The command can also run the due check immediately with `run`; `force` ignores `nextRunAt` for that check. Scheduled maintenance defaults to dry-run (`execute=false`) and does not enable archive deletion, cache deletion, raw-log deletion, or memory deletion unless explicitly configured.

Examples:

```text
/scaler-storage-schedule
/scaler-storage-schedule enable interval-hours=24 execute=off rotate-active=on max-active-bytes=10485760
/scaler-storage-schedule enable run force execute=off rotate-active=on max-active-bytes=1
/scaler-storage-schedule disable
```

## `/scaler-safety-policy [allow-internet=on/off] [allow-external=on/off] [allow-sandbox=on/off]`

Shows or updates persisted safety policy at `.scaler/safety/policy.json`. Persisted `allow-internet` and `allow-external` settings are merged into the tool-call safety hook for internet-transfer and external-mutation command classes. `allow-sandbox=on` enables only bounded sandbox destructive-command exceptions for commands wrapped in recognized sandbox envelopes (`docker run --rm`, `docker compose run`, `podman run`, or `devcontainer exec`) without privileged mode, host networking, broad host mounts, protected paths, secret exposure, internet transfer, or external mutation patterns. The policy does not override protected-path, secret-environment, or task allowed-path blocks.

## `/scaler-safety-approval [approve|revoke] ...`

Lists, creates, or revokes scoped safety approvals under `.scaler/safety/approvals.json`.

Examples:

```text
/scaler-safety-approval
/scaler-safety-approval approve | bash | exact_command | npm publish --dry-run | external | Release dry run | max-uses=1 ttl-minutes=60
/scaler-safety-approval approve | edit | target | docs/release.md | medium | Allow one edit outside current task path | max-uses=1
/scaler-safety-approval revoke | <approval-id> | no longer needed
```

Approvals are audited and consumed by use count. They can approve non-secret risky decisions such as exact external/destructive commands or exact targets, but they do not override protected-path or secret-environment blocks.

## `/scaler-safety-scan [execute] [kinds=npm_audit,trivy_fs]`

Discovers optional dependency/image security scanner candidates from manifests and records results under `.scaler/safety/scans.json`. Without `execute`, the command records planned or unavailable scanner candidates only. With `execute`, available scanners are run and recorded as passed or failed. Supported candidate kinds include `npm_audit`, `pnpm_audit`, `yarn_audit`, `pip_audit`, `cargo_audit`, `trivy_fs`, and `grype_fs`.

## `/scaler-budget-status`

Shows state-backed budget usage, soft/hard limits, checkpoint count, and the strongest current budget decision. When Pi/provider usage metadata is available, parent turns and child-agent runs increment `contextTokens` and `estimatedCostMicros` before this status is rendered.

## `/scaler-budget-set <key> | <soft> | <hard>`

Persists a budget limit in `.scaler/state.json`. Supported keys are `toolCalls`, `spawnedAgents`, `debugAttempts`, `wallClockMs`, `checkpoints`, `contextTokens`, `validationLoops`, `storageBytes`, `researchReports`, and `estimatedCostMicros`. Use `-` to clear one side while setting the other side.

Examples:

```text
/scaler-budget-set validationLoops | 2 | 3
/scaler-budget-set estimatedCostMicros | - | 500000
```

## `/scaler-lock`

Shows the current repo-wide SCALER execution lock, or reports that no lock exists.

## `/scaler-lock-clear <reason>`

Manually clears the current execution lock and logs the reason. This is explicit manual recovery; SCALER does not automatically clear stale locks.

## `/scaler-runs [taskId]`

Lists recent task-agent run records. Optional `taskId` filters records.

Output includes status, exit code, timeout/abort flags, stdout event count, and stderr summary when present.

## `/scaler-tasks`

Lists all known supervisor tasks with status, current-task marker, title, allowed path metadata, dependencies, and runtime PRD refs when present.

## `/scaler-context-init [taskId]`

Creates a default task context manifest under `.scaler/context/tasks/<taskId>.json`. Missing manifests include discovered context from changed files, execution plans, PRD coverage, validation history, and ranked memory matches when available.

## `/scaler-context-status [taskId]`

Shows the task context manifest summary for a task.

## `/scaler-stage-status`

Shows latest Stage I-IV artifact status from `.scaler/stages/stage-artifacts.json`.

## `/scaler-stage-validate <stage>`

Validates readiness of the latest recorded artifact for a stage.

## `/scaler-stage-advance <stage>`

Advances the supervisor stage after validating stage artifact readiness, deterministic stage-specific semantics, and available cross-artifact consistency gates.

## `/scaler-stage-step [execute]`

Runs one deterministic stage-conductor step for the current supervisor stage. If a ready, semantically valid, and consistent artifact already exists for the active stage, SCALER validates and advances it. Otherwise SCALER prepares the matching focused stage agent; with `execute`, it runs the agent, ingests a valid `scaler_stage_artifact` JSON event, and attempts advancement.

## `/scaler-stage-loop [execute] [max=N]`

Runs bounded deterministic stage-conductor steps, carrying forward supervisor state after every successful advancement. Stops on completion, max steps, unsupported stages, rejected steps, prepare-mode handoff, or executed stage-agent output that does not advance. Default max is 5 and bounds normalize to 1..20.

## `/scaler-stage-run <stage> [execute]`

Prepares or executes a focused stage-agent subprocess for `prd`, `knowledge`, `planning`, `execution`, or `replanning`. Successful executed runs ingest a valid `scaler_stage_artifact` JSON event and attempt ready-artifact advancement automatically.

## `/scaler-stage-runs [stage]`

Lists stage-agent run records from `.scaler/reports/stage-agent-runs.json`.

## `/scaler-stage-record <stage> | <status> | <title> | <path> | <summary> | <evidence refs> | <PRD refs> | <task refs>`

Records a normalized stage artifact for `prd`, `knowledge`, `planning`, `execution`, or `replanning`.

## `/scaler-prd-status`

Shows runtime PRD requirement coverage from `.scaler/prd/requirements.json`, `.scaler/prd/coverage.json`, and task `prdRefs` links.

## `/scaler-plan-status`

Shows execution plan summary from `.scaler/plans/current-plan.json`, runtime PRD requirements, and supervisor task state.

## `/scaler-plan-apply`

Creates missing supervisor task records from `.scaler/plans/current-plan.json`. Existing tasks are preserved.

## `/scaler-replans`

Lists replan requests from `.scaler/plans/replan-requests.json`.

## `/scaler-replan-run [execute]`

Prepares or executes the focused replanner agent. With `execute`, SCALER ingests a valid `scaler_replan_proposal` JSON event and saves `.scaler/plans/proposed-plan.json` for preservation-gated review.

## `/scaler-replan-runs`

Lists replanner-agent run records from `.scaler/reports/replan-agent-runs.json`.

## `/scaler-debug-run [taskId] [execute]`

Prepares or executes the focused debug agent for a selected debugging task. With `execute`, SCALER ingests a valid `scaler_debug_report` JSON event and stores it under `.scaler/debug/reports.json`.

Debug report statuses:

- `next_approach` records an evidence-backed untried approach.
- `needs_research` creates research requests.
- `needs_replan` and `blocked` create debug-blocked replan requests.

## `/scaler-debug-retry [taskId] [execute]`

Prepares or executes the latest accepted debug `next_approach` for a debugging task. It requires a previous failed validation run, injects the next approach and exact failed validation command(s) into the retry task-agent prompt, and writes `.scaler/debug/retries.json`. The command honors `.scaler/debug/retry-policy.json`: executed retries can require one-use approval records, and exact-validation success can optionally chain into full validation or full validation plus a validated-task commit.

## `/scaler-debug-retry-policy [auto-start=on/off] [require-approval=on/off] [post-exact-pass=stop|validate|validate-commit]`

Shows or updates debug retry policy. Defaults are no auto-start, no approval requirement, and no post-exact-pass chaining. `auto-start=on` lets `/scaler-debug-loop execute` immediately start a supervised retry after it ingests a `next_approach` report. `post-exact-pass=validate` runs full validation after the exact failing command passes; `post-exact-pass=validate-commit` also attempts a validated-task commit using the task allowed paths after full validation passes. Replans are never auto-accepted.

## `/scaler-debug-retry-approve <debugReportId> | [taskId] | [reason]`

Creates a one-use approval under `.scaler/debug/retry-approvals.json` for policies with `require-approval=on`.

## `/scaler-debug-retry-approvals`

Lists debug retry approval records.

With `execute`, the task agent runs once. If the task-agent run succeeds, SCALER reruns only the exact command(s) that failed in the prior validation run. Exact-validation success records a `fixed` debug attempt and leaves the task `validating` for full validation. Exact-validation failure records a `same_failure` debug attempt and returns the task to `debugging`. The command never auto-validates the full task and never accepts replans.

## `/scaler-debug-loop [taskId] [execute] [max=N]`

Runs a bounded deterministic debug conductor for a debugging task. The loop selects the explicit task, current debugging task, or first debugging task.

Current behavior:

- runs the focused debug agent when no task-local research or debug replan request is open;
- runs the focused research agent when a task-local research request is open;
- runs the focused replanner agent when a task-local debug-cycle/debug-blocked replan request is open;
- stops on prepare-mode handoff, rejected ingestion, `next_approach`, proposed replan generation, missing task, or max steps;
- does **not** accept proposed replans automatically.

Default max is 5 and bounds normalize to 1..20.

## `/scaler-debug-runs [taskId]`

Lists debug-agent run records from `.scaler/reports/debug-agent-runs.json`.

## `/scaler-debug-reports`

Lists debug reports from `.scaler/debug/reports.json`.

## `/scaler-debug-retries`

Lists next-approach retry records from `.scaler/debug/retries.json`.

## `/scaler-mcp-enumerate`

Scans project-local MCP declaration files and writes concise server records/runs to `.scaler/tool-requests/mcp-servers.json`. Supported sources include `.mcp.json`, `mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.claude/mcp.json`, `claude_desktop_config.json`, and `package.json` MCP fields. Enumeration records server name, source path, transport, command or redacted URL, env key names only, risk level, status, and message. It does not start MCP servers or store secret env values.

## `/scaler-mcp-servers [name|runs]`

Lists enumerated MCP server records, optionally filtered to one server name. Passing `runs` lists enumeration run records.

## `/scaler-tool-catalog [toolName]`

Lists static Tool/MCP catalog entries plus discovered schema/docs metadata from `.scaler/tool-requests/catalog.json`, optionally filtered to one tool.

## `/scaler-tool-discover <toolName> [execute] [tools=a,b]`

Prepares or executes a supervised Tool/MCP schema discovery probe. SCALER grants only `scaler_tool_schema` plus explicitly supplied `tools=...`; the target tool name is not a tool grant. Execute mode marks the probe `completed` only if a new structured `scaler_tool_schema` record is ingested for the target tool, otherwise `missing_schema`.

## `/scaler-tool-discovery-runs [toolName]`

Lists schema discovery probe records from `.scaler/tool-requests/schema-runs.json`.

## `/scaler-tool-replay <transactionId> [execute] [approval=<id>]`

Prepares or executes a replay of a persisted isolated tool-agent transaction. Replay uses the stored prompt/tools invocation and writes a new transaction linked by `replayOfTransactionId`. Execute mode is allowed for open `prepared` requests. Requests already closed as `completed`, `failed`, or `blocked` remain refused unless `approval=<id>` names an active exact replay approval for the original transaction/request; successful approved closed replay consumes one approval use. Free-form/no-result output is recorded as `missing_result`.

## `/scaler-tool-replay-approval [approve|revoke] ...`

Lists, creates, or revokes exact closed-replay approvals from `.scaler/tool-requests/replay-approvals.json`.

Examples:

```text
/scaler-tool-replay-approval
/scaler-tool-replay-approval approve | <transactionId> | Re-run closed docs lookup for audit | max-uses=1 ttl-minutes=60
/scaler-tool-replay-approval revoke | <approvalId> | No longer needed
/scaler-tool-replay <transactionId> execute approval=<approvalId>
```

Approvals are not auto-selected by `/scaler-tool-replay`; closed replay execution requires the explicit approval id.

## `/scaler-tool-run [requestId] [execute]`

Prepares or executes an isolated tool-agent transaction for a prepared `scaler_tool_request`. Prepare mode rebuilds the stored request prompt/invocation and writes `.scaler/tool-requests/transactions.json`. With `execute`, SCALER runs the child agent with only the request's allowed tools, reloads request/result ledgers, and marks the transaction complete only when a structured `scaler_tool_result` closed the request. Child prose without `scaler_tool_result` becomes `missing_result` and is not treated as completion.

## `/scaler-tool-iteration-policy [max=N] [auto-replay=on|off]`

Shows or updates `.scaler/tool-requests/iteration-policy.json`. `max` is clamped to 1..10 and defaults to 3. `auto-replay` controls whether `/scaler-tool-iterate execute` replays the latest `missing_result` transaction after a failed structured-result attempt; it defaults to on.

## `/scaler-tool-iterate [requestId] [execute] [max=N]`

Prepares or executes a bounded correction loop for an open prepared tool request. Prepare mode records one prepared transaction and one iteration-run ledger. Execute mode runs the request once, then replays the latest `missing_result` transaction while the request is still `prepared`, `auto-replay` is enabled, and the iteration cap has not been reached. The loop stops when a structured `scaler_tool_result` closes the request as `completed`, `failed`, or `blocked`, or records `exhausted` when child agents continue to produce no structured result. It does not replay closed requests.

## `/scaler-tool-iteration-runs [requestId]`

Lists bounded tool-agent correction loop records from `.scaler/tool-requests/iteration-runs.json`, optionally filtered to one request id.

## `/scaler-tool-schedule [execute] [parallel=N]`

Plans or executes all currently prepared tool requests and records `.scaler/tool-requests/schedules.json`. Requests are eligible for the parallel batch only when the request risk is `low` and every allowed tool's compact/discovered catalog entry is also low risk. Unknown, medium/high, destructive, external, secret, or otherwise uncertain requests are serialized. Without `execute`, the command only records the schedule plan. With `execute`, SCALER runs parallelizable requests in bounded batches (`parallel` defaults to 2 and clamps to 1..8), then runs serialized requests one at a time. Each child transaction still requires structured `scaler_tool_result` completion.

## `/scaler-tool-schedules [requestId]`

Lists tool scheduling records from `.scaler/tool-requests/schedules.json`, optionally filtered to schedules that included a request id.

## `/scaler-tool-transactions [requestId]`

Lists isolated tool-agent transaction records from `.scaler/tool-requests/transactions.json`, optionally filtered to one request id.

## `/scaler-research-run [requestId] [execute] [internet] [tools=a,b]`

Prepares or executes the focused research agent for a selected request or the oldest open request. With `execute`, SCALER ingests a valid `scaler_research_report` JSON event and stores the report under `.scaler/research/reports.json`.

For `internet` or `mixed` requests, tools are withheld unless both an explicit `internet` grant and a `tools=a,b` list are supplied. Without the grant, the prompt instructs the agent to produce a `partial`/`blocked` report rather than pretending web access exists. Only listed tools are passed to the subprocess.

Example:

```text
/scaler-research-run RESEARCH-001 execute internet tools=browser,mcp-docs
```

## `/scaler-research-web [requestId] [execute] [internet] [tools=a,b] [max-queries=N]`

Plans or executes bounded multi-query web research for `internet`/`mixed` research requests. Candidate browser/search/MCP tools are discovered from the tool schema catalog when `tools=` is omitted. Without `execute`, the command records planned tool-discovery/query transactions under `.scaler/research/transactions.json`. With `execute internet`, it runs the focused research agent with the planned queries and records query/source-review transactions with freshness/version diagnostics. It does not grant network tools unless `internet` is present and tools are explicit or discovered.

## `/scaler-research-transactions [requestId]`

Lists web research transaction records.

## `/scaler-research-runs [requestId]`

Lists research-agent run records from `.scaler/reports/research-agent-runs.json`.

## `/scaler-research-status`

Shows research request/report counts and recent open requests/reports from `.scaler/research/`.

## `/scaler-research-request <question> | <reason> | <taskId> | <PRD refs> | <scope>`

Creates a research request. `scope` is `local`, `internet`, or `mixed`.

## `/scaler-research-report <question> | <conclusion> | <confidence> | <sourceId> | <sourceTitle> | <sourceQuality> | <sourceRef> | <requestId> | <taskId> | <PRD refs>`

Records a compact research report with one source and one conclusion. Use `scaler_research_report` for richer reports with contradictions and raw evidence.

## `/scaler-replan-proposal-status`

Shows preservation status for `.scaler/plans/proposed-plan.json` against the current plan, runtime PRD, and supervisor state.

## `/scaler-replan-accept`

Accepts `.scaler/plans/proposed-plan.json` only when preservation checks pass, snapshots the previous plan, saves the proposal as current, applies missing tasks, resolves open replan requests, and records a decision.

## `/scaler-replan-request <reason> | <taskId> | <evidence refs> | <PRD refs>`

Records a manual replan request and attempts to transition the supervisor stage to `replanning`.

## `/scaler-prd-link <taskId> | <REQ-001,REQ-002>`

Links an existing task to runtime PRD requirement ids by updating the task's `prdRefs` metadata.

## `/scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list> | <PRD refs comma list>`

Creates a supervisor task record.

Examples:

```text
/scaler-task-create T-001 | Add parser tests | src,test
/scaler-task-create T-002 | Add dependent task | src | T-001
/scaler-task-create T-003
```

Allowed paths are used later for safe per-task git commits. Dependencies prevent the conductor from selecting a task until all listed task ids are validated. PRD refs link the task to runtime PRD requirements for coverage/replanning summaries.

## `/scaler-task-retry <taskId> | <reason>`

Retries a task through deterministic supervisor task transitions:

- `debugging` -> `running`
- `blocked` -> `ready`
- `needs_replan` -> `ready`

Terminal `failed` tasks are rejected by current retry rules.

## `/scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies> | <PRD refs>`

Updates task metadata. If `status` is provided, the update must be a valid supervisor task transition.

Examples:

```text
/scaler-task-update T-001 | Better title
/scaler-task-update T-001 | | ready | src,test | T-000
/scaler-task-update T-001 | | | | | REQ-001,REQ-002
```

## `/scaler-status`

Creates/loads `.scaler/state.json`, logs the status request, and shows:

- current stage and complexity level
- validated task count
- task status counts
- rejected transition count
- memory count
- debug failure and attempt counts
- known budget usage counts
- event log path
- workflow summary with current task, next recommended action, hints, and warnings
