# Scaler Tools

Scaler currently registers structured tool skeletons:

- `scaler_report`
- `scaler_memory_write`
- `scaler_memory_retrieve`
- `scaler_memory_search`
- `scaler_research_report`
- `scaler_task_report`
- `scaler_spawn_task`
- `scaler_tool_request`
- `scaler_tool_result`
- `scaler_task_create`
- `scaler_task_update`
- `scaler_planning_report`
- `scaler_prd_write`
- `scaler_prd_requirement_update`
- `scaler_validation_manifest_write`
- `scaler_validation_report`
- `scaler_debug_attempt`

Current behavior:

- SCALER tool calls and results write redacted audit events to `.scaler/logs/events.jsonl`; larger audit payloads are stored under `.scaler/logs/details/`, and oversized Pi `tool_result` content is stored by reference under `.scaler/logs/tools/`.
- `scaler_report` can request supervisor stage/task transitions and persists accepted/rejected state
- `scaler_debug_attempt` persists failures/attempts under `.scaler/debug/`, rejects repeated failed attempts without new evidence, detects direct and longer fingerprint cycles, requests replanning for blocked/cyclic debugging, and logs debug decisions
- `scaler_validation_report` applies validation-driven task transitions
- `scaler_memory_write` writes `.scaler/memory/` files and index entries with optional tags and summaries
- `scaler_memory_search` searches memory candidates by query/tag/task/validity and returns summary references only
- `scaler_memory_retrieve` retrieves memory by id/path and requested scope (`summary`, `full`, or `section:<heading>`)
- `scaler_research_report` records structured research findings with source quality, confidence, contradictions, and optional raw evidence stored in memory
- `scaler_task_report` records the required structured completion report for task-agent runs under `.scaler/reports/task-agent-reports.json`
- `scaler_spawn_task` prepares a Pi subprocess invocation, or executes it when `execute: true`; executed spawns are refused while the repo-wide execution lock is held
- `scaler_tool_request` persists isolated tool-agent requests under `.scaler/tool-requests/requests.json` and prepares invocations with only explicitly allowed tools, compact selected-tool catalog entries, requester id, expected output, required format, risk level, permission requirement, and safety notes
- `scaler_tool_result` records structured proposals under `.scaler/tool-requests/results.json` and stores outputs, evidence refs, validation performed, errors, and recommendations; an isolated child must use the runtime-owned active execution id, and recording the proposal does not close the request
- `scaler_tool_schema` records discovered Tool/MCP docs/schema metadata under `.scaler/tool-requests/catalog.json`; later tool-request prompts merge the latest discovered metadata for explicitly allowed tools
- `/scaler-mcp-enumerate` scans project-local MCP config files and records concise server declarations under `.scaler/tool-requests/mcp-servers.json` without executing servers or storing env secret values
- `/scaler-mcp-servers [name|runs]` lists enumerated MCP server records or enumeration runs
- `/scaler-tool-catalog [toolName]` lists static plus discovered Tool/MCP metadata
- `/scaler-active-tools [catalog|focus|restore]` uses Pi runtime tool APIs to show a compact parent-session catalog, narrow requester turns to SCALER requester tools, or restore the previous active-tool set
- `/scaler-tool-discover <toolName> [execute] [tools=a,b]` prepares or executes a supervised schema discovery probe under `.scaler/tool-requests/schema-runs.json`; the target tool is not granted implicitly, and execute mode completes only when a new structured `scaler_tool_schema` record appears
- `/scaler-tool-discovery-runs [toolName]` lists schema discovery probe runs
- `/scaler-tool-run [requestId] [execute]` records isolated tool-agent transactions under `.scaler/tool-requests/transactions.json`; prepare mode persists the invocation, while execute mode creates an active execution before dispatch and lets the parent close the request only after one exact-bound proposal and a successful process outcome
- `/scaler-tool-replay <transactionId> [execute] [approval=<id>]` reuses a persisted transaction invocation and links the new transaction with `replayOfTransactionId`; execute mode is allowed while the originating request is still `prepared`, or for a closed request only when an exact active replay approval id is atomically reserved before dispatch
- `/scaler-tool-replay-approval [approve|revoke] ...` lists, creates, and revokes exact transaction approvals under `.scaler/tool-requests/replay-approvals.json` for closed-request replays; one-use approvals cannot authorize concurrent executions
- `/scaler-tool-iteration-policy [max=N] [auto-replay=on|off]` shows or updates bounded correction-loop defaults under `.scaler/tool-requests/iteration-policy.json`
- `/scaler-tool-iterate [requestId] [execute] [max=N]` prepares or runs a bounded open-request correction loop; a new ambiguous execution blocks without automatic replay, while the retained policy can only affect compatible legacy open `missing_result` records
- `/scaler-tool-iteration-runs [requestId]` lists correction-loop ledgers from `.scaler/tool-requests/iteration-runs.json`
- `/scaler-tool-schedule [execute] [parallel=N]` plans prepared tool requests with advisory risk classification, but executes all requests sequentially; `parallel=N` is retained for compatible planning/audit input and does not authorize overlapping workspace execution
- `/scaler-tool-schedules [requestId]` lists schedule ledgers from `.scaler/tool-requests/schedules.json`
- `/scaler-tool-transactions [requestId]` lists transaction records, including execution identity, process outcome, accepted result id and replay linkage where present; new missing/foreign/duplicate-result executions are blocked rather than recorded as replayable `missing_result`
- `scaler_task_create` creates supervisor task records, stores optional allowed paths/dependencies/runtime PRD refs, and rejects duplicate ids
- `scaler_task_update` updates task metadata, including runtime PRD refs, and only accepts valid status transitions
- `scaler_planning_report` ingests structured planner output, writes runtime requirements/current execution plan, creates or updates planned tasks and task `prdRefs`, links coverage, and records `.scaler/reports/planning-reports.json` diagnostics
- `scaler_prd_write` writes `.scaler/prd/current.md` and optionally replaces the runtime PRD requirement catalog
- `scaler_prd_requirement_update` upserts one runtime PRD requirement and optional explicit coverage status
- `scaler_validation_manifest_write` persists task validation commands under `.scaler/reports/validation-manifests.json`

Debug-agent subprocesses emit structured `scaler_debug_report` JSON events rather than using a registered tool; accepted reports are stored under `.scaler/debug/reports.json` and can create research or replan requests.

Tool request prompts intentionally include only selected catalog entries for the requested/allowed tools. Unknown tools are represented as `unknown` risk unless a prior `scaler_tool_schema` record supplied local docs/schema metadata. Tool-agent prompts require a structured `scaler_tool_result` proposal; free-form prose is not a durable completion signal. The parent accepts exactly one proposal only when it is bound to the active execution and the worker exits successfully without timeout or abort. Possible-effect failures, missing or duplicate proposals, ownership drift, and late/foreign execution ids fail closed without automatic replay.

For parent requester sessions, SCALER uses Pi `ExtensionAPI.getAllTools`/`getActiveTools`/`setActiveTools` during SCALER-guided turns when those runtime APIs are available. These methods belong to the extension API, not the event/command context. Initial focus runs in Pi's `before_agent_start` lifecycle so the first provider request snapshots the selected set; the context hook only injects approved context and a compact runtime catalog. That catalog contains name, short purpose, risk, active flag and docs/schema availability while omitting parameter schemas and prompt guidelines. SCALER snapshots the previous active-tool set, narrows the requester turn to SCALER requester/report tools, and restores the original tools at turn/agent end or via `/scaler-active-tools restore`.

Each verified parent selection also produces a non-prompt-facing envelope profile over the complete selected definitions: names, descriptions, parameter schemas, prompt guidelines and source metadata. The audit event records the selected tool names, UTF-8 byte size and SHA-256 fingerprint. Sparse arrays, explicit `undefined`, `null` and empty arrays have distinct canonical identities. A selected profile is unavailable when host selection APIs are missing or the post-selection active set differs; SCALER records no invented size/fingerprint for that unknown footprint. This identity is evidence for later request-specific admission and routing, not a token count or proof of savings.

Pi 0.80.3 rebuilds its private base prompt when active tools change but retains the earlier prompt value inside the current `before_agent_start` extension chain. SCALER therefore verifies the incoming prompt against Pi's installed builder, rebuilds it with only the selected snippets and guidelines, and returns that prompt to later extensions. A later extension may append ordinary instructions without restoring excluded tool material. If an earlier extension already rewrote the prompt, or the installed host builder cannot be reconciled, SCALER restores the prior tool set and aborts at `before_provider_request`; it does not discard unknown safety instructions or send a falsely narrowed request.

That refusal remains active for retries and queued continuations until a fresh
request-start lifecycle establishes a supported composition. Cancellation is
performed before audit I/O; unavailable audit storage therefore cannot turn a
refusal into provider traffic or suppress a successfully selected prompt.

Processes launched by the SCALER agent runner are marked as children and preserve
their explicitly selected tools; parent focus/catalog injection is not applied to
them. This routing marker is not an authorization mechanism.

SCALER can now compute internal request-specific route advice for `direct`,
`current-agent`, `isolated` or `blocked`. The assessor uses the persisted request,
the verified selected-tool profile and complete concrete provider payload legs;
it does not treat the profile's canonical byte size as tokens or provider wire
size. Current-agent evidence requires its request leg. Isolated evidence requires
both the worker request and the caller continuation, and every leg must pass its
own provider-envelope limit before aggregate overhead is compared. Unknown
bounds and malformed evidence fail closed.

Route advice is deliberately non-authorizing (`executionAuthorized: false`) and
is not consumed by the executor. A direct recommendation requires authority,
validated exact arguments and a named deterministic adapter; the installed host
does not provide a generic adapter. The audit helper records hashes, reason codes
and measurements without raw provider history or request arguments. Dispatch
must later recompute and bind the assessment at the execution boundary.

The current tool/MCP implementation covers catalog isolation, pre-snapshot parent active-tool focus, prompt-chain-safe selected instruction composition for the verified Pi host, selected-definition envelope identity, non-authorizing request-specific route assessment, schema discovery, local MCP enumeration, execution-bound isolated result acceptance, atomically reserved closed replay approvals, bounded correction loops, and sequential schedule execution. Route execution, direct adapters, dispatch-time reassessment, isolated-executor admission and observed result-size accounting remain open. Execution-ledger indexes are individually atomic but not one multi-file transaction; request closure is published last, so an interrupted publication retains active ownership for explicit reconciliation instead of advertising request completion or inviting automatic replay.
