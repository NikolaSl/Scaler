# Scaler Budgets

Implemented budget support is a deterministic skeleton.

Current behavior:

- Budget data is stored in the supervisor state's `budgets` field.
- Helpers support usage counts for `toolCalls`, `spawnedAgents`, `debugAttempts`, `wallClockMs`, and `checkpoints`.
- Soft-limit decisions are logged as `budget` events.
- Hard-limit decisions are logged and try to pause the run through the supervisor transition rules.
- Scaler tool executions increment `toolCalls`; executed task spawns increment `spawnedAgents`; accepted debug attempts increment `debugAttempts`.

Full budget configuration commands and status output are planned in later implementation tasks.
