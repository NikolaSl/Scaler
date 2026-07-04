# Implementation Plan 070 — GAP-011 Raw Log and Memory Retention Approvals

## Goal
Close GAP-011 by adding explicit opt-in retention/deletion approvals for non-archive raw SCALER log detail files and memory files, while preserving safe defaults.

## Scope
- Extend storage maintenance policy with explicit raw-log and memory deletion approvals plus age/size quota selectors.
- Limit raw-log deletion to `.scaler/logs/details/` files and memory deletion to `.scaler/memory/*` content files while preserving active ledgers and indexes.
- Prune memory index entries when approved memory files are deleted.
- Wire options through `/scaler-storage-maintain` and `/scaler-storage-schedule`.
- Add unit, command, mocked integration, and targeted opt-in real Pi coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not delete active `.scaler/logs/events.jsonl` except through existing active-ledger rotation.
- Do not delete validation manifests, state, plans, safety policy, storage indexes, or schedule/maintenance config.
- Do not enable raw log or memory deletion by default.

## Validation
- Targeted storage retention unit/command/mock tests.
- Targeted real Pi raw-retention command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-070: add raw storage retention plan`
2. `IMPL-284: add raw log and memory retention approvals`
3. `IMPL-285: cover raw storage retention flows`
4. `IMPL-286: document raw storage retention coverage`
