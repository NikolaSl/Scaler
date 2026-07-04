# Scaler Tools

Scaler currently registers structured tool skeletons:

- `scaler_report`
- `scaler_memory_write`
- `scaler_memory_retrieve`
- `scaler_research_report`
- `scaler_spawn_task`
- `scaler_tool_request`
- `scaler_tool_result`
- `scaler_task_create`
- `scaler_task_update`
- `scaler_prd_write`
- `scaler_prd_requirement_update`
- `scaler_validation_manifest_write`
- `scaler_validation_report`
- `scaler_debug_attempt`

Current behavior:

- SCALER tool calls and results write audit events to `.scaler/logs/events.jsonl`; larger payloads are stored under `.scaler/logs/details/`.
- `scaler_report` can request supervisor stage/task transitions and persists accepted/rejected state
- `scaler_debug_attempt` persists failures/attempts under `.scaler/debug/`, rejects repeated failed attempts without new evidence, detects direct and longer fingerprint cycles, requests replanning for blocked/cyclic debugging, and logs debug decisions
- `scaler_validation_report` applies validation-driven task transitions
- `scaler_memory_write` writes `.scaler/memory/` files and index entries
- `scaler_memory_retrieve` retrieves memory by id/path
- `scaler_research_report` records structured research findings with source quality, confidence, contradictions, and optional raw evidence stored in memory
- `scaler_spawn_task` prepares a Pi subprocess invocation, or executes it when `execute: true`; executed spawns are refused while the repo-wide execution lock is held
- `scaler_tool_request` persists isolated tool-agent requests under `.scaler/tool-requests/requests.json` and prepares invocations with only explicitly allowed tools, compact selected-tool catalog entries, requester id, expected output, required format, risk level, permission requirement, and safety notes
- `scaler_tool_result` records structured results under `.scaler/tool-requests/results.json`, links them to the originating request, updates the request status to `completed`, `failed`, or `blocked`, and stores outputs, evidence refs, validation performed, errors, and recommendations
- `/scaler-tool-run [requestId] [execute]` records isolated tool-agent transactions under `.scaler/tool-requests/transactions.json`; prepare mode persists the invocation, execute mode runs only the request's allowed tools and marks completion only if a structured `scaler_tool_result` closes the request
- `/scaler-tool-transactions [requestId]` lists transaction records, including `missing_result` runs where a child exited without the structured result signal
- `scaler_task_create` creates supervisor task records, stores optional allowed paths/dependencies/runtime PRD refs, and rejects duplicate ids
- `scaler_task_update` updates task metadata, including runtime PRD refs, and only accepts valid status transitions
- `scaler_prd_write` writes `.scaler/prd/current.md` and optionally replaces the runtime PRD requirement catalog
- `scaler_prd_requirement_update` upserts one runtime PRD requirement and optional explicit coverage status
- `scaler_validation_manifest_write` persists task validation commands under `.scaler/reports/validation-manifests.json`

Debug-agent subprocesses emit structured `scaler_debug_report` JSON events rather than using a registered tool; accepted reports are stored under `.scaler/debug/reports.json` and can create research or replan requests.

Tool request prompts intentionally include only selected catalog entries for the requested/allowed tools. Unknown tools are represented as `unknown` risk with no docs/schema claim so the isolated tool agent must inspect help/schema when available instead of guessing. Tool-agent prompts require a structured `scaler_tool_result` completion; free-form prose is not the durable completion signal.

Remaining tool/MCP work includes multi-iteration correction loops, richer transaction replay controls, parallel scheduling, and automatic MCP documentation/schema discovery.
