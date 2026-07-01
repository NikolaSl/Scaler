# Scaler Tools

Scaler currently registers structured tool skeletons:

- `scaler_report`
- `scaler_memory_write`
- `scaler_memory_retrieve`
- `scaler_spawn_task`
- `scaler_validation_report`
- `scaler_debug_attempt`

Current behavior:

- `scaler_report` can request supervisor stage/task transitions and persists accepted/rejected state
- debug/validation requests are logged to `.scaler/logs/events.jsonl`
- `scaler_memory_write` writes `.scaler/memory/` files and index entries
- `scaler_memory_retrieve` retrieves memory by id/path
- `scaler_spawn_task` prepares a Pi subprocess invocation, or executes it when `execute: true`

Full supervisor and task execution integration will be added in later tasks.
