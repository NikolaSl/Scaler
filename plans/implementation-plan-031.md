# Implementation Plan 031 — Audit Logging Coverage

## Goal
Close GAP-005 by expanding deterministic audit logging for command starts/ends, agent prompts, tool calls/results, full structured reports, transitions, validation summaries, and commit ids.

## Scope
- Add durable audit detail files under `.scaler/logs/details/` for large prompts/reports/tool payloads.
- Add logging helpers for command lifecycle, agent prompts, structured reports, validation summaries, and git commits.
- Wire focused task/stage/replan/research agents to log prompts and report ingestion summaries without parsing free-form child text.
- Wrap extension commands so command start/end/error events are logged consistently.
- Ensure tools record input/result detail refs, not only concise summaries.
- Update manuals, inventory, traceability, and gap backlog.

## Out of Scope
- Token/cost metering beyond existing optional usage fields.
- Secret redaction beyond current safety/protected-path policies.
- External log shipping or rotation.

## Atomic Tasks
1. **IMPL-125 — Add audit logging primitives**
   - Extend log event types and add detail file persistence plus command/prompt/report/validation/git helper functions.
   - Add focused logging tests.
   - Validate with `npm test` and `npm run build`.
2. **IMPL-126 — Integrate audit logs across commands, agents, tools, validation, and git**
   - Wrap commands, log agent prompts, full structured report ingestion, validation run summaries, and commit ids.
   - Add/update tests.
   - Validate with `npm test` and `npm run build`.
3. **IMPL-127 — Document audit logging coverage**
   - Update manuals, implementation inventory, traceability matrix, and gap backlog.
   - Validate with `npm test` and `npm run build`.

## Validation
Run after implementation tasks:

```bash
npm test
npm run build
```
