# Implementation Plan 035 — Debug-Agent Escalation and Source Compliance Review

## Goal
Tighten debugging toward the original `assignement.md` and `specs/attempt-tracking.md` intent: avoid visible and hidden debug cycles, ask a focused debug agent for the next evidence-backed approach after failures, escalate to local/internet research when needed, and request replanning only after realistic debug/research approaches are exhausted.

## Normative compliance rule
Implementation and traceability reviews must consult all of these sources, not only `requirements-catalog.md` / `traceability-matrix.md`:

1. `assignement.md`
2. every relevant file under `specs/`
3. `requirements-catalog.md`
4. `traceability-matrix.md`
5. runtime/manual docs that describe implemented behavior

The matrix is the tracking view; `assignement.md` and `specs/` remain source requirements.

## Scope
- Add deterministic debug report ledger and validation for structured debug-agent conclusions.
- Add hidden fingerprint cycle summarization for longer failure chains, not only immediate A→B→A cycles.
- Add a focused debug-agent prompt/run workflow with structured-only report ingestion.
- Let debug reports create research requests for unresolved knowledge gaps or replan requests when debug/research is exhausted.
- Add command/manual/traceability updates and record remaining misses discovered in the compliance review.

## Atomic tasks

### PLAN-035 — Plan and compliance statement
- Create this plan.
- Commit plan only. This is a PLAN task, not an IMPL task.

### IMPL-138 — Debug report ledger and hidden cycle analysis
- Extend `src/debug.ts` with debug report records, validation, storage, formatting, and longer-cycle detection.
- Ensure report ingestion can create research requests or replan requests deterministically.
- Tests for report validation, research escalation, replan escalation, and longer cycles.

### IMPL-139 — Focused debug-agent workflow
- Add `src/debug-agent.ts` for prompt construction, isolated invocation, structured `scaler_debug_report` extraction/ingestion, run records, and formatting.
- Add `/scaler-debug-run` and `/scaler-debug-runs` commands.
- Update extension shape/tests.

### IMPL-140 — Documentation, traceability, and implemented-work misses
- Update manuals and command docs.
- Update inventory, traceability, and gap backlog.
- Explicitly document that compliance reviews must look at `assignement.md` and `specs/` in addition to PRD matrices.
- Record misses found so far, especially overclaimed debugging completeness and remaining automation gaps.

## Validation
After implementation tasks:

```bash
npm test
npm run build
```

Each implementation/docs slice is committed separately after validation where applicable.
