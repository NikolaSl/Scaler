# Implementation Plan 063 — GAP-009 Blocked/Skipped Validation Gate Policy

## Goal
Add deterministic validation gate disposition handling so required gates can be explicitly skipped with accepted reasons or blocked with durable task/blocking state instead of being silently omitted or collapsed into generic failures.

## Scope
- Extend validation manifest commands with optional `disposition` metadata:
  - `run` (default)
  - `skipped`
  - `blocked`
- Store optional disposition reasons in manifests and validation run records.
- Extend `/scaler-validation-add` with optional tenth field for disposition (`run`, `skipped:<reason>`, or `blocked:<reason>`).
- Add policy diagnostics:
  - required skipped gates must provide a reason;
  - blocked gates must provide a reason;
  - optional skipped gates without reasons record warnings.
- Extend command run status to include `skipped` and `blocked`.
- Make validation run status `blocked` when any required gate is blocked, and apply a blocked validation report to task state.
- Treat required skipped gates with accepted reasons as non-failing; required skipped gates without reasons fail policy before command execution.
- Add unit tests, mocked integration, and opt-in real Pi command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not create a human approval workflow for skipped gates.
- Do not infer skip/block reasons from prose.
- Do not auto-replan for skipped gates; blocked validation continues using existing blocked-validation behavior.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-063: add validation disposition policy plan`
2. `IMPL-262: add validation skipped blocked dispositions`
3. `IMPL-263: cover mocked validation disposition flow`
4. `IMPL-264: add real Pi validation disposition coverage`
5. `IMPL-265: document validation disposition coverage`
