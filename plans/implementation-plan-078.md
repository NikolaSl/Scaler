# Implementation Plan 078 — GAP-013 Adaptive Escalation and De-escalation

## Goal
Close GAP-013 by adding deterministic adaptive orchestration reassessment during a run, not just initial complexity selection.

## Scope
- Add adaptive assessment rules driven by validation/debug failures, blocked/replan tasks, rejected transitions/uncertainty, and budget soft/hard limits.
- Add a safe apply helper that updates complexity and performs only valid supervisor transitions.
- Add `/scaler-adapt [apply]` to inspect or apply the adaptive recommendation.
- Add unit, mocked command, and targeted real Pi command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not autonomously expand budgets or skip existing safety approvals.
- Do not force invalid supervisor transitions; surface recommendations when a stage cannot change directly.
- Do not replace the bounded debug/replan conductors.

## Validation
- Targeted adaptive unit and command/mock tests.
- Targeted real Pi `/scaler-adapt` command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-078: add adaptive reassessment plan`
2. `IMPL-308: add adaptive reassessment workflow`
3. `IMPL-309: cover adaptive reassessment flows`
4. `IMPL-310: document adaptive reassessment coverage`
