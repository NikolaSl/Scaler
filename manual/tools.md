# Scaler Tools

Scaler currently registers structured tool skeletons:

- `scaler_report`
- `scaler_memory_write`
- `scaler_memory_retrieve`
- `scaler_spawn_task`
- `scaler_tool_request`
- `scaler_task_create`
- `scaler_task_update`
- `scaler_validation_manifest_write`
- `scaler_validation_report`
- `scaler_debug_attempt`

Current behavior:

- `scaler_report` can request supervisor stage/task transitions and persists accepted/rejected state
- `scaler_debug_attempt` persists failures/attempts under `.scaler/debug/`, rejects repeated failed attempts without new evidence, and logs debug decisions
- `scaler_validation_report` applies validation-driven task transitions
- `scaler_memory_write` writes `.scaler/memory/` files and index entries
- `scaler_memory_retrieve` retrieves memory by id/path
- `scaler_spawn_task` prepares a Pi subprocess invocation, or executes it when `execute: true`; executed spawns are refused while the repo-wide execution lock is held
- `scaler_tool_request` persists isolated tool-agent requests under `.scaler/tool-requests/` and prepares invocations with only explicitly allowed tools
- `scaler_task_create` creates supervisor task records, stores optional allowed paths/dependencies, and rejects duplicate ids
- `scaler_task_update` updates task metadata and only accepts valid status transitions
- `scaler_validation_manifest_write` persists task validation commands under `.scaler/reports/validation-manifests.json`

Full supervisor and task execution integration will be added in later tasks.
