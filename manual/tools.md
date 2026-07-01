# Scaler Tools

Scaler currently registers structured tool skeletons:

- `scaler_report`
- `scaler_memory_write`
- `scaler_memory_retrieve`
- `scaler_spawn_task`
- `scaler_task_create`
- `scaler_validation_report`
- `scaler_debug_attempt`

Current behavior:

- `scaler_report` can request supervisor stage/task transitions and persists accepted/rejected state
- debug requests are logged to `.scaler/logs/events.jsonl`
- `scaler_validation_report` applies validation-driven task transitions
- `scaler_memory_write` writes `.scaler/memory/` files and index entries
- `scaler_memory_retrieve` retrieves memory by id/path
- `scaler_spawn_task` prepares a Pi subprocess invocation, or executes it when `execute: true`
- `scaler_task_create` creates supervisor task records and rejects duplicate ids

Full supervisor and task execution integration will be added in later tasks.
