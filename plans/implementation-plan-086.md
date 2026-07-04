# Implementation Plan 086 — GAP-024 Autonomous Stage Workflow Coordinator

## Goal
Close GAP-024 by adding a deterministic Stage I-III/refresh coordinator that can run PRD, knowledge, planning, research, and replanning workflows end-to-end instead of only one-shot stage agents.

## Scope
- Add an autonomous stage workflow coordinator that:
  - advances ready stage artifacts;
  - runs PRD/planning/replanning stage agents when artifacts are missing;
  - creates Stage II research requests from runtime PRD requirements;
  - runs bounded research-agent fanout and merges/deduplicates reports into a knowledge artifact;
  - ingests structured PRD/planning child outputs into runtime PRD and execution-plan ledgers;
  - detects execution-time coverage/plan gaps and starts/accepts safe replanning refreshes while preserving validated progress.
- Add `/scaler-stage-workflow [execute] [max=N] [research=N] [requests=N] [internet] [tools=a,b] [auto-accept-replan=on/off]`.
- Persist coordinator run reports for audit/debugging.
- Add unit and mocked integration coverage for research fanout/merge, planner ledger sync, and execution discovery refresh.
- Update manuals, implementation inventory, traceability, and backlog.

## Non-goals
- Do not add missing-context request lifecycle beyond Stage II research coordination (GAP-025).
- Do not implement Pi compaction hooks/fresh-agent handoff (GAP-026).
- Do not implement parent-session active-tool narrowing (GAP-033).

## Validation
- Targeted stage-workflow and command tests.
- Targeted mocked integration for Stage I-III plus replan refresh.
- `npm test`
- `npm run build`
- Targeted opt-in real Pi command/prepare coverage if practical.

## Commits
1. `PLAN-086: add autonomous stage workflow plan`
2. `IMPL-332: add autonomous stage workflow coordinator`
3. `IMPL-333: cover autonomous stage workflow coordinator`
4. `IMPL-334: document autonomous stage workflow coverage`
