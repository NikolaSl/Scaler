# Implementation Plan 049 — GAP-011 Storage Inventory and Hard-Pause Status

## Goal
Add deterministic `.scaler/` storage management foundations: indexed usage scans, largest-file summaries, user-facing storage status, and budget-coupled pause behavior.

## Scope
- Add `.scaler/storage/index.json` path support.
- Add `src/storage.ts` with recursive `.scaler/` inventory scanning that never leaves `.scaler/`, reports total bytes, file/dir counts, per-top-level-directory bytes, and largest files.
- Persist the latest inventory index under `.scaler/storage/index.json`.
- Add `/scaler-storage-status` command that scans storage, writes the index, updates `storageBytes` budget usage, persists budget decisions, logs storage/status details, and pauses on hard storage limits through existing budget logic.
- Add unit tests for inventory scanning, index persistence, and top-level/largest-file summaries.
- Add command tests/extension shape coverage.
- Add mocked integration coverage for command-driven storage hard pause.
- Add opt-in real Pi command-dispatch coverage for `/scaler-storage-status` persisted inventory/logs.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not compress or rotate logs/memory in this slice.
- Do not delete cache/temp data automatically yet.
- Do not implement minimum free disk checks yet.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-049: add storage inventory plan`
2. `IMPL-192: add storage inventory core`
3. `IMPL-193: add storage status command integration`
4. `IMPL-194: add mocked storage status integration coverage`
5. `IMPL-195: add real storage status command coverage`
6. `IMPL-196: document storage inventory coverage`
