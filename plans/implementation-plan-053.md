# Implementation Plan 053 — GAP-011 Storage Maintenance Policy Foundation

## Goal
Move storage management beyond inventory/status by adding deterministic maintenance planning plus safe execution for compression and cache cleanup inside `.scaler/` only.

## Scope
- Add `.scaler/storage/maintenance.json` maintenance reports.
- Add a storage maintenance planner that proposes actions for:
  - compressing old/large uncompressed `.scaler/logs/details`, `.scaler/reports`, and `.scaler/memory` files;
  - deleting only `.scaler/cache` files when explicitly allowed.
- Add stream-based gzip compression execution that writes `<file>.gz` and removes the original only after successful compression.
- Add cache deletion execution gated by explicit `delete-cache` command args.
- Add `/scaler-storage-maintain [execute] [compress] [delete-cache] [min-age-days=N] [min-size=N]`.
- Persist maintenance reports, update storage inventory after execution, and audit command/state events.
- Add unit tests for planning/execution safety.
- Add mocked command integration coverage for compression/cache cleanup under `.scaler/` only.
- Add opt-in real Pi command-dispatch coverage for executed maintenance persistence.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not delete raw logs or memory automatically.
- Do not rotate active `events.jsonl` yet.
- Do not implement minimum-free-disk pausing yet.
- Do not touch project files outside `.scaler/`.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-053: add storage maintenance plan`
2. `IMPL-212: add storage maintenance planner and executor`
3. `IMPL-213: add storage maintenance command`
4. `IMPL-214: add mocked storage maintenance integration coverage`
5. `IMPL-215: add real storage maintenance command coverage`
6. `IMPL-216: document storage maintenance coverage`
7. `IMPL-217: fix storage maintenance test type check`
