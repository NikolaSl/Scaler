# Sequential Execution Policy

SCALER enforces mandatory sequential work per repository.

## Policy

Only one SCALER operation may run at a time in the same project tree. This includes:

- task-agent prepare/execute steps
- direct `scaler_spawn_task` executions
- validation runs
- validated-task commits

No read-only/research parallelism is implemented or allowed by SCALER, because read-only agents can observe state while it is changing and produce stale analysis.

## Execution lock

SCALER stores the repo-wide execution lock at:

```text
.scaler/locks/execution-lock.json
```

The lock records:

- lock id
- operation
- task id when available
- reason when available
- creation timestamp

Lock creation is atomic. If a lock already exists, the new operation is refused.

## Commands

Inspect the current lock:

```text
/scaler-lock
```

Manually clear a lock:

```text
/scaler-lock-clear confirmed stale after interrupted process
```

Manual clear is explicit recovery. SCALER does not automatically clear stale locks.
