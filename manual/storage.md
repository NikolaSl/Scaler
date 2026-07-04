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
- Executed maintenance can gzip eligible old/large files under `.scaler/logs/details/`, non-active `.scaler/reports/`, and `.scaler/memory/`.
- Cache deletion is limited to `.scaler/cache/` files and requires the explicit `delete-cache` flag.
- Active ledger rotation is opt-in with `rotate-active`; known active ledgers that exceed `max-active-bytes` are archived under `.scaler/storage/archive/` and reset to empty JSONL/JSON-array files.
- `min-free-bytes=N` records a local filesystem free-space check in the maintenance report and marks it failed when available space is below the threshold.
- Project files outside `.scaler/`, already compressed files, maintenance/index artifacts, and validation manifests/current configuration ledgers are not cleanup targets.

Examples:

```text
/scaler-budget-set storageBytes | 5000000 | 10000000
/scaler-storage-status
/scaler-storage-maintain min-age-days=30 min-size=1048576
/scaler-storage-maintain execute delete-cache min-age-days=30 min-size=1048576
/scaler-storage-maintain execute rotate-active no-compress max-active-bytes=10485760 min-free-bytes=1000000000
```

Remaining storage work includes richer retention/deletion approval policies for raw logs or memory, scheduled maintenance policy, and compression/rotation quotas.
