# Implementation Plan 059 — GAP-009 Non-Software Validation Checklist Adjudication

## Goal
Add deterministic non-software validation checklist records so completeness/consistency/compliance/source/adversarial/uncertainty gates can be adjudicated without shell commands or model prose.

## Scope
- Add `.scaler/reports/validation-checklists.json` checklist records.
- Add checklist item statuses (`passed`, `failed`, `blocked`, `not_applicable`) and deterministic rollup:
  - required failed/blocked items fail/block the checklist;
  - all required passed/not-applicable items pass;
  - optional failures are evidence but do not fail the checklist.
- Add `recordValidationChecklist` and formatting/loading helpers.
- Add `/scaler-validation-checklist` compact command for manual structured checklist entry.
- Add unit tests for rollup, persistence, formatting, evidence refs, and task status application.
- Add mocked integration for non-software gate checklist failure → debugging and pass → validated.
- Add opt-in real Pi slash-command persistence coverage.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not add CI/sandbox execution in this slice.
- Do not auto-generate checklist content from LLM output.
- Do not replace command validation manifests.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-059: add non-software validation checklist plan`
2. `IMPL-245: add validation checklist ledger`
3. `IMPL-246: add validation checklist command`
4. `IMPL-247: cover mocked validation checklist flow`
5. `IMPL-248: add real Pi validation checklist coverage`
6. `IMPL-249: document validation checklist coverage`
