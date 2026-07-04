# Implementation Plan 087 — GAP-025 Missing-Context Request Lifecycle

## Goal
Close GAP-025 by adding first-class missing-context request records and deterministic retrieval/investigation/unblock behavior instead of leaving missing data as prompt-only task-agent text.

## Scope
- Add `.scaler/context/missing-requests.json` with normalized request status/kind, task/report links, evidence refs, result summaries, and timestamps.
- Create missing-context requests automatically from accepted `scaler_task_report` records with `needs_data`/`blocked` status or `missingData` entries.
- Add deterministic dispatch for memory search, file retrieval, local/internet research request creation, and user-clarification/manual resolution.
- Add commands to list, run, and manually resolve missing-context requests.
- Automatically unblock blocked tasks once all associated missing-context requests are resolved or superseded so conductor retries are deterministic.
- Add unit, mocked integration, and targeted real command coverage.

## Non-goals
- Do not add semantic/RAG context search or UI curation (GAP-032).
- Do not add compaction/handoff behavior (GAP-026).
- Do not make task-quality warnings hard gates (GAP-028).

## Validation
- Targeted missing-context/conductor/command tests.
- Mocked integration for task needs-data → request → resolution → retry.
- `npm test`
- `npm run build`
- Targeted opt-in real Pi command coverage.

## Commits
1. `PLAN-087: add missing-context lifecycle plan`
2. `IMPL-335: add missing-context request lifecycle`
3. `IMPL-336: cover missing-context request lifecycle`
4. `IMPL-337: document missing-context lifecycle coverage`
