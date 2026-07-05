# Implementation Plan 013 — Runtime PRD Ledger for Replanning

Goal: keep a versioned, structured polished PRD ledger for each active SCALER run so replanning can make deterministic decisions from requirement coverage, task links, validation evidence, and preserved PRD versions.

Rules:

- Keep tasks atomic and project-compilable after every task.
- Run `npm test` and `npm run build` after each implementation task.
- Commit each validated task separately with its task id.
- Document only behavior implemented in that task.
- Update traceability artifacts when requirement coverage changes.

## IMPL-061 — Add runtime PRD ledger schema and storage helpers

Create runtime PRD ledger types and helpers under `.scaler/prd/`.

Acceptance:

- Add types for PRD requirements, requirement statuses, coverage entries, and PRD change records.
- Add helpers to load/save `.scaler/prd/current.md`, `.scaler/prd/requirements.json`, `.scaler/prd/coverage.json`, and `.scaler/prd/changes.jsonl`.
- Add helper to create versioned snapshots under `.scaler/prd/versions/`.
- Unit tests cover missing-file defaults, save/load round trips, status validation, and version snapshot naming.

## IMPL-062 — Link tasks to runtime PRD requirements

Extend task metadata so each task can reference runtime PRD requirement IDs.

Acceptance:

- Add `prdRefs: string[]` to task metadata/state types.
- Update task create/update helpers and command parsing to accept optional PRD refs without breaking existing syntax.
- Update task list formatting to show PRD refs when present.
- Unit tests cover create/update/list behavior.

## IMPL-063 — Add deterministic PRD coverage computation

Compute runtime PRD coverage from requirements, explicit coverage records, and linked task state.

Acceptance:

- Add a pure coverage summary helper that reports counts by status, unlinked requirements, and task-linked requirements.
- Treat validated linked tasks as validated coverage unless an explicit blocked/needs_replan coverage entry exists.
- Unit tests cover status precedence, linked task aggregation, and missing ledger defaults.

## IMPL-064 — Add runtime PRD commands and tools

Expose implemented PRD ledger behavior through commands/tools.

Acceptance:

- Add `/scaler-prd-status` to show current PRD ledger summary.
- Add `/scaler-prd-link <taskId> <REQ-001,REQ-002>` to link an existing task to PRD requirements.
- Add structured tools for writing/updating runtime PRD ledger entries where practical.
- Unit tests cover command parsing/registration and tool behavior.

## IMPL-065 — Document runtime PRD ledger and update traceability

Document the implemented PRD ledger and update traceability artifacts.

Acceptance:

- Add or update manual docs for runtime PRD ledger commands/artifacts.
- Update `dev-progress-tracker/implementation-inventory.md`, `dev-progress-tracker/traceability-matrix.md`, and `dev-progress-tracker/gap-backlog.md` for replanning/traceability coverage changes.
- Keep wording limited to implemented behavior.
