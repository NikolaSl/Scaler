# Implementation Plan 088 — GAP-026 SCALER-Aware Compaction and Fresh Handoff

## Goal
Close GAP-026 by turning context split guidance into enforceable runtime behavior: deterministic externalization of oversized context, SCALER-aware Pi compaction hooks, explicit compaction records, and fresh minimal-context continuation handoffs.

## Scope
- Extend compression/split handling so oversized exact or summary-ok context items are written to external memory and referenced in split artifacts.
- Add `.scaler/context/compactions.json` records and a `session_before_compact` hook that returns a deterministic SCALER-aware `CompactionResult` preserving supervisor state, task status, validated progress, blockers, memory refs, split refs, plan/PRD summaries, and next action.
- Add automatic `ctx.compact()` triggering when Pi-reported active context exceeds the SCALER target.
- Add `/scaler-compact`, `/scaler-compactions`, `/scaler-context-handoff`, and `/scaler-context-handoffs` commands.
- Add `.scaler/context/handoffs.json` plus prompt artifacts for fresh minimal-context continuation agents derived from split records.
- Validate that handoff prompts shrink below the active-context target before execution.

## Non-goals
- Do not add semantic/RAG search or UI context curation (GAP-032).
- Do not add watchdog/resume verification (GAP-027).
- Do not add tool-result redaction/externalization hooks (GAP-031).

## Validation
- Unit tests for externalization, compaction summary/ledger creation, and fresh handoff shrink checks.
- Mocked integration coverage for split externalization to fresh handoff.
- Extension command/hook shape coverage.
- `npm test`
- `npm run build`
- Targeted opt-in real Pi command coverage.

## Commits
1. `PLAN-088: add scaler-aware compaction plan`
2. `IMPL-338: add compaction externalization and handoff runtime`
3. `IMPL-339: cover compaction and fresh handoff runtime`
4. `IMPL-340: document compaction and handoff coverage`
