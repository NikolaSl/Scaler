# Scaler Budgets

Implemented budget support is deterministic and state-backed.

Current behavior:

- Budget data is stored in the supervisor state's `budgets` field.
- Helpers support usage counts/estimates for `toolCalls`, `spawnedAgents`, `debugAttempts`, `wallClockMs`, `checkpoints`, `contextTokens`, `validationLoops`, `storageBytes`, `researchReports`, and `estimatedCostMicros`.
- `/scaler-budget-status` shows usage, soft/hard limits, checkpoint count, and the strongest current decision.
- `/scaler-budget-set <key> | <soft> | <hard>` persists limits in `.scaler/state.json`; use `-` to clear one side while setting the other side.
- Soft-limit decisions are logged as `budget` events.
- Hard-limit decisions are logged, try to pause the run through the supervisor transition rules, and block supported execution paths before expensive work starts.
- Scaler tool executions increment `toolCalls`; executed task spawns increment `spawnedAgents`; accepted debug attempts increment `debugAttempts`.
- Task-agent conductor prompts record estimated `contextTokens`; executed conductor task agents increment `spawnedAgents` and are refused on hard limits before the child process runs.
- Locked validation runs increment `validationLoops` and are refused on hard limits before validation commands run.
- Memory/research tool writes scan `.scaler/` and record `storageBytes`; `/scaler-storage-status` writes `.scaler/storage/index.json`, records `storageBytes`, and pauses on configured hard storage limits; `/scaler-storage-maintain` refreshes `storageBytes` after dry-run or executed maintenance; research reports increment `researchReports`.
- Checkpoints record wall-clock usage and checkpoint counts.

Examples:

```text
/scaler-budget-set validationLoops | 2 | 3
/scaler-budget-set estimatedCostMicros | - | 500000
/scaler-budget-status
```

Provider-native token/cost accounting remains planned for a later implementation task; current `contextTokens` and `estimatedCostMicros` values are state-backed estimates or explicit updates from SCALER code paths.
