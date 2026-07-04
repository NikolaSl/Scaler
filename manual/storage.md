# Storage Management

SCALER-managed data lives under `.scaler/`. The storage inventory feature only scans inside this directory and never rotates or deletes project files outside `.scaler/`.

## Implemented behavior

- `/scaler-storage-status` recursively scans `.scaler/`.
- The latest inventory is written to `.scaler/storage/index.json`.
- The inventory records total bytes, file count, directory count, top-level directory summaries, and largest files.
- The command updates the `storageBytes` budget counter.
- If a configured `storageBytes` hard limit is reached, the existing budget gate pauses the run and logs a `budget` event.
- `/scaler-storage-maintain` plans safe maintenance by default and executes only when `execute` is present.
- Maintenance reports are written to `.scaler/storage/maintenance.json`.
- Executed maintenance can gzip eligible old/large files under `.scaler/logs/details/`, `.scaler/reports/`, and `.scaler/memory/`.
- Cache deletion is limited to `.scaler/cache/` files and requires the explicit `delete-cache` flag.
- Project files outside `.scaler/`, active `events.jsonl`, already compressed files, and maintenance/index artifacts are not cleanup targets.

Examples:

```text
/scaler-budget-set storageBytes | 5000000 | 10000000
/scaler-storage-status
/scaler-storage-maintain min-age-days=30 min-size=1048576
/scaler-storage-maintain execute delete-cache min-age-days=30 min-size=1048576
```

Remaining storage work includes active log/report rotation, richer retention/deletion approval policies for raw logs or memory, compression scheduling, and minimum-free-disk checks.
