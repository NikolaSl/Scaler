# Implementation Plan 065 — GAP-011 Storage Archive Retention Approvals and Quotas

## Goal
Add explicit retention controls for SCALER-owned storage archives so maintenance can enforce archive age/size quotas only when deletion is deliberately approved.

## Scope
- Extend `/scaler-storage-maintain` with:
  - `delete-archives` approval flag;
  - `max-archive-bytes=N` archive quota;
  - `max-archive-age-days=N` age-retention threshold.
- Plan archive deletion actions only under `.scaler/storage/archive/` and only when `delete-archives` is present.
- Delete oldest archive files first until archive usage is within `max-archive-bytes`; delete archive files older than `max-archive-age-days`.
- Persist deletion actions in the storage maintenance report.
- Add unit tests, mocked integration, and targeted opt-in real Pi command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not delete active logs, active report ledgers, memory files, or project files.
- Do not add automatic scheduled execution yet.
- Do not enforce cross-filesystem/cloud quotas beyond local archive file sizes.

## Validation
- Targeted real Pi archive-retention test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-065: add storage archive retention plan`
2. `IMPL-269: add storage archive retention approvals`
3. `IMPL-270: cover archive retention command flows`
4. `IMPL-271: document archive retention coverage`
