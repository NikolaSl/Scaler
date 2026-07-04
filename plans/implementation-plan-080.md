# Implementation Plan 080 — GAP-015 Atomic Task Definition Warnings

## Goal
Close GAP-015 by adding lightweight task-definition quality checks and planner/task-creation hints for atomic tasks that lack Definition of Done, validation, or allowed-path scope.

## Scope
- Add optional `definitionOfDone` metadata to task records, create/update inputs, and task command parsing.
- Add deterministic task-definition review records under `.scaler/reports/task-quality.json`.
- Warn when tasks lack Definition of Done, task-specific validation manifest commands, or allowed paths.
- Add `/scaler-task-quality [taskId]` to recompute/list task-definition warnings.
- Surface task quality hints in task lists and workflow/docs without blocking compatibility.
- Add unit, mocked command integration, and targeted real Pi command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not reject existing tasks solely for missing DoD/validation/paths.
- Do not infer semantic atomicity across arbitrary code changes.
- Do not replace planner PRD/coverage automation tracked by GAP-018.

## Validation
- Targeted task/command/unit tests.
- Targeted mocked task-quality command test.
- Targeted real Pi task-quality command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-080: add task definition warning plan`
2. `IMPL-314: add task definition quality workflow`
3. `IMPL-315: cover task definition quality warnings`
4. `IMPL-316: document task definition quality coverage`
