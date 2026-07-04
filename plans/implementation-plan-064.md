# Implementation Plan 064 — GAP-011 Storage Rotation and Free-Space Checks

## Goal
Add explicit, deterministic `.scaler/` active-log/report rotation and minimum-free-disk checks to storage maintenance so long-running runs can preserve audit/report history while bounding active ledger size and surfacing disk-pressure blockers.

## Scope
- Extend storage maintenance policy/options with:
  - `rotateActive` opt-in flag;
  - `maxActiveBytes` threshold for active ledger rotation;
  - `minFreeBytes` disk-space check threshold.
- Add maintenance actions for active ledger rotation and free-disk checks.
- Rotate only known active `.scaler` ledgers:
  - `.scaler/logs/events.jsonl`;
  - append-style `.scaler/reports/*-runs.json`, validation run/checklist/handoff ledgers, and agent-run ledgers.
- Archive rotated ledgers under `.scaler/storage/archive/...` and reset active ledgers to empty JSONL/JSON-array files.
- Keep project files outside `.scaler/` untouched and keep unknown report files on existing compression path.
- Extend `/scaler-storage-maintain` parsing and command wiring with `rotate-active`, `max-active-bytes=N`, and `min-free-bytes=N`.
- Add unit, mocked integration, and opt-in targeted real Pi slash-command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not delete raw logs or memories beyond existing explicit cache cleanup.
- Do not schedule maintenance automatically.
- Do not rotate validation manifests or other configuration-like current-state files.
- Do not guarantee provider/cloud disk quota semantics beyond local filesystem `statfs` checks.

## Validation
- Targeted real Pi storage rotation test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-064: add storage rotation free-space plan`
2. `IMPL-266: add storage active rotation and free-space checks`
3. `IMPL-267: cover storage rotation command flows`
4. `IMPL-268: document storage rotation coverage`
