# Implementation Plan 034 — Debug Retry Conductor Gate

## Goal
Advance GAP-008 by making repeated failed debug fingerprints a hard conductor retry gate unless new evidence has been recorded or a relevant replan request has been accepted/resolved.

## Scope
- Add a deterministic debug retry gate assessment helper.
- Detect retry blocks from debug cycles, blocked debug attempts, or repeated unresolved failed fingerprints.
- Treat later `newEvidence` or accepted/resolved debug replan requests/accepted decisions as gate-clearing evidence.
- Integrate the gate into conductor task selection before task-agent preparation/execution.
- Update tests, manuals, inventory, traceability, and gap backlog.

## Out of Scope
- Automatic planner/replanner invocation from the gate.
- Semantic analysis of arbitrary child-agent output.
- Task-agent structured completion report enforcement; that remains GAP-020.

## Atomic Tasks
1. **IMPL-134 — Add debug retry gate helper**
   - Implement gate assessment in `src/debug.ts`.
   - Add tests for blocking cycles, clearing by new evidence, and clearing by accepted/resolved replans.
   - Validate with `npm test` and `npm run build`.
2. **IMPL-135 — Integrate debug retry gate into conductor**
   - Refuse conductor-selected tasks when the retry gate blocks them.
   - Log the refusal and add conductor tests.
   - Validate with `npm test` and `npm run build`.
3. **IMPL-136 — Document debug retry gate coverage**
   - Update manuals, implementation inventory, traceability, and gap backlog.
   - Validate with `npm test` and `npm run build`.
