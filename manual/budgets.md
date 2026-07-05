# Scaler Budgets

Implemented budget support is deterministic and state-backed.

Current behavior:

- Budget data is stored in the supervisor state's `budgets` field.
- Helpers support usage counts/estimates for `toolCalls`, `spawnedAgents`, `debugAttempts`, `wallClockMs`, `checkpoints`, `contextTokens`, `validationLoops`, `storageBytes`, `researchReports`, and `estimatedCostMicros`.
- When Pi/provider usage metadata is available, SCALER extracts input/output/cache/reasoning token counts and native cost totals from parent-session `turn_end` events and child-agent JSON output, then increments `contextTokens` and `estimatedCostMicros`.
- `/scaler-budget-status` shows usage, soft/hard limits, checkpoint count, scoped policy count, and the strongest current decision.
- `/scaler-budget-set <key> | <soft> | <hard>` persists limits in `.scaler/state.json`; use `-` to clear one side while setting the other side.
- Scoped budget policies can be attached to run/stage/plan/task/agent/validation/debug scopes. `/scaler-budget-policy [level=N] [approve]` writes default run and task-agent policies for a complexity level; level 4+ expansion requires explicit approval.
- Soft-limit decisions are logged as `budget` events.
- Hard-limit decisions are logged, try to pause the run through the supervisor transition rules, and block supported execution paths before expensive work starts.
- Scaler tool executions increment `toolCalls`; executed task spawns increment `spawnedAgents`; accepted debug attempts increment `debugAttempts`.
- Task-agent conductor prompts record estimated `contextTokens`; executed conductor task agents increment `spawnedAgents` and are refused on hard limits before the child process runs. After child agents complete, any native provider token/cost usage exposed in Pi JSON events is persisted on the run record and budget counters.
- Locked validation runs increment `validationLoops` and are refused on hard limits before validation commands run.
- Memory/research tool writes scan `.scaler/` and record `storageBytes`; `/scaler-storage-status` writes `.scaler/storage/index.json`, records `storageBytes`, and pauses on configured hard storage limits; `/scaler-storage-maintain` refreshes `storageBytes` after dry-run or executed maintenance; research reports increment `researchReports`.
- Checkpoints record wall-clock usage and checkpoint counts.
- Watchdog ledgers under `.scaler/watchdogs/` record progress heartbeats, watchdog trigger events, subprocess timeout/abort cleanup records, and resume verification checks.
- `/scaler-watchdogs [execute]` detects stale/no-progress heartbeats and repeated replanning without validated progress; with `execute`, hard triggers pause and checkpoint the run.
- `/scaler-resume-check` and `/scaler-resume` verify state, git, logs, memory index, checkpoints, and budget metadata before resuming a paused run.

Examples:

```text
/scaler-budget-set validationLoops | 2 | 3
/scaler-budget-set estimatedCostMicros | - | 500000
/scaler-budget-status
/scaler-budget-policy level=4 approve
/scaler-heartbeat T-001 | implementing | progress | T-001
/scaler-watchdogs execute
/scaler-resume-check
```

Provider-native accounting is best-effort: providers that do not expose usage metadata simply leave these counters unchanged beyond SCALER's existing estimates and explicit updates.
