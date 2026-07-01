# State

Scaler stores deterministic supervisor state in:

```text
.scaler/state.json
```

The state file is created by `/scaler-status` if it does not exist.

Current state fields include:

- run id
- orchestration complexity level
- current stage
- previous stage when paused
- current task id
- task states
- completed and validated task ids
- blockers and memory references
- rejected transitions
- budget placeholder
- timestamps

The supervisor is algorithmic code. It validates stage/task transitions and records rejected transitions instead of trusting free-form LLM claims.
