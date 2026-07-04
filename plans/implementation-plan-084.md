# Implementation Plan 084 — GAP-021 Automatic Context Split Artifacts

## Goal
Close GAP-021 by recording automatic context-split artifacts when resolved task context remains over the active context target.

## Scope
- Add `.scaler/context/splits.json` records for oversized resolved task context.
- Capture task id, token estimate, target, overage, included refs, exact/summary/reference classifications, externalization candidates, and minimal-context recommendations.
- Record split artifacts during conductor prompt preparation/execution when compression assessment recommends splitting.
- Add `/scaler-context-splits [taskId]` to inspect split records.
- Add unit, mocked integration, and targeted real Pi command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not automatically mutate project files to externalize content.
- Do not spawn a second agent automatically in this slice.
- No semantic chunking or embeddings.

## Validation
- Targeted context-split/conductor/command tests.
- Targeted mocked integration for oversized context conductor preparation.
- Targeted real Pi `/scaler-context-splits` command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-084: add context split artifact plan`
2. `IMPL-326: add context split artifact workflow`
3. `IMPL-327: cover context split artifacts`
4. `IMPL-328: document context split artifact coverage`
