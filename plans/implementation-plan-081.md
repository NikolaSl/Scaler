# Implementation Plan 081 — GAP-016 Commit Artifact Reports

## Goal
Close GAP-016 by recording a durable post-commit artifact for validated task commits.

## Scope
- Add commit report records under `.scaler/reports/commits.json`.
- Record commit id, task id, included paths, git safety summary, and latest validation summary after successful task commits.
- Add `/scaler-commits [taskId]` to inspect commit reports.
- Add unit, mocked integration, and targeted real Pi command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not commit `.scaler/` runtime artifacts.
- Do not create reports for refused/skipped commits except existing audit logs.
- Do not change allowed-path commit safety rules.

## Validation
- Targeted git/report unit tests.
- Targeted mocked commit integration.
- Targeted real Pi command inspection test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-081: add commit report plan`
2. `IMPL-317: add commit report workflow`
3. `IMPL-318: cover commit report workflow`
4. `IMPL-319: document commit report coverage`
