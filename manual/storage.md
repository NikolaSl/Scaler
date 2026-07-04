# Storage Management

SCALER-managed data lives under `.scaler/`. The storage inventory feature only scans inside this directory and never rotates or deletes project files outside `.scaler/`.

## Implemented behavior

- `/scaler-storage-status` recursively scans `.scaler/`.
- The latest inventory is written to `.scaler/storage/index.json`.
- The inventory records total bytes, file count, directory count, top-level directory summaries, and largest files.
- The command updates the `storageBytes` budget counter.
- If a configured `storageBytes` hard limit is reached, the existing budget gate pauses the run and logs a `budget` event.

Example:

```text
/scaler-budget-set storageBytes | 5000000 | 10000000
/scaler-storage-status
```

Current storage management is inventory/status only. Compression, rotation, retention cleanup, cache deletion, and minimum-free-disk checks are planned later.
