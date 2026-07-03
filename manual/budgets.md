# Scaler Budgets

Implemented budget support is deterministic and state-backed.

Current behavior:

- Budget data is stored in the supervisor state's `budgets` field.
- Helpers support usage counts/estimates for `toolCalls`, `spawnedAgents`, `debugAttempts`, `wallClockMs`, `checkpoints`, `contextTokens`, `validationLoops`, `storageBytes`, `researchReports`, and `estimatedCostMicros`.
- Soft-limit decisions are logged as `budget` events.
- Hard-limit decisions are logged, try to pause the run through the supervisor transition rules, and block supported execution paths before expensive work starts.
- Scaler tool executions increment `toolCalls`; executed task spawns increment `spawnedAgents`; accepted debug attempts increment `debugAttempts`.
- Task-agent conductor prompts record estimated `contextTokens`; executed conductor task agents increment `spawnedAgents` and are refused on hard limits before the child process runs.
- Locked validation runs increment `validationLoops` and are refused on hard limits before validation commands run.
- Memory/research tool writes scan `.scaler/` and record `storageBytes`; research reports increment `researchReports`.
- Checkpoints record wall-clock usage and checkpoint counts.

Budget limits are currently configured programmatically in state/tests; user-facing budget configuration commands and provider-native token/cost accounting are planned in later implementation tasks.
