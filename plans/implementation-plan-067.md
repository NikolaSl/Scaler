# Implementation Plan 067 — GAP-007 Provider Usage Budget Ingestion

## Goal
Add deterministic token/cost usage ingestion from Pi/provider metadata so SCALER budgets can account for native model usage when Pi exposes it.

## Scope
- Extract provider usage from Pi JSON events and assistant message `usage` metadata, including input/output/cache/reasoning tokens and native cost totals.
- Attach extracted usage to `TaskAgentRunResult` for Pi subprocess agents.
- Apply extracted token/cost usage to `contextTokens` and `estimatedCostMicros` budget counters, with audit log entries that include usage details.
- Record parent-session usage from Pi `turn_end` events.
- Add unit, mocked integration/extension-shape, and targeted opt-in real Pi coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not change provider pricing or estimate costs when providers do not report native cost metadata.
- Do not require every provider to expose usage.
- Do not replace existing context-token estimates, spawn/tool counters, or hard-limit gates.

## Validation
- Targeted provider-usage unit and extension tests.
- Targeted real Pi provider-usage test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-067: add provider usage budget ingestion plan`
2. `IMPL-275: add provider usage budget ingestion`
3. `IMPL-276: cover provider usage budget flows`
4. `IMPL-277: document provider usage budget coverage`
