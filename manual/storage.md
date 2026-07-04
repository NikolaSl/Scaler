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
- Archive deletion is opt-in with `delete-archives`; only files under `.scaler/storage/archive/` can be deleted, and only when `max-archive-bytes` or `max-archive-age-days` selects retention targets.
- Raw log detail deletion is opt-in with `delete-raw-logs`; only files under `.scaler/logs/details/` can be deleted, and only when `max-raw-log-bytes` or `max-raw-log-age-days` selects retention targets.
- Memory file deletion is opt-in with `delete-memory`; only `.scaler/memory/*` content files can be deleted, `.scaler/memory/index.json` is preserved, and deleted memory entries are pruned from the index.
- `/scaler-storage-schedule` persists `.scaler/storage/schedule.json`, checks due maintenance at Pi `session_start`, and can run the due check immediately with `run`/`force`.
- Scheduled maintenance updates `lastRunAt`, `nextRunAt`, and `lastReportGeneratedAt`; when a due run produces a report, storage budget usage is refreshed.
- Project files outside `.scaler/`, active raw logs/reports outside approved rotation/reset paths, memory files without explicit `delete-memory` approval, already compressed files outside approved retention selectors, maintenance/index/schedule artifacts, and validation manifests/current configuration ledgers are not cleanup targets.

Examples:

```text
/scaler-budget-set storageBytes | 5000000 | 10000000
/scaler-storage-status
/scaler-storage-maintain min-age-days=30 min-size=1048576
/scaler-storage-maintain execute delete-cache min-age-days=30 min-size=1048576
/scaler-storage-maintain execute rotate-active no-compress max-active-bytes=10485760 min-free-bytes=1000000000
/scaler-storage-maintain execute no-compress delete-archives max-archive-bytes=50000000 max-archive-age-days=30
/scaler-storage-maintain execute no-compress delete-raw-logs max-raw-log-age-days=30 delete-memory max-memory-age-days=90
/scaler-storage-schedule enable interval-hours=24 execute=off rotate-active=on max-active-bytes=10485760
/scaler-storage-schedule enable run force execute=off rotate-active=on max-active-bytes=1
```

GAP-011 storage management coverage is complete for the currently tracked inventory, maintenance, rotation, scheduling, and approved retention controls.
