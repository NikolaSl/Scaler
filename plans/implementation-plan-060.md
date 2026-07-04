# Implementation Plan 060 — GAP-009 Acceptance Evidence Rules

## Goal
Tighten validation checklist adjudication by adding deterministic evidence requirements for acceptance/completeness/source/compliance-style non-software gates.

## Scope
- Add checklist evidence policy evaluation for gates that require evidence on required passing items:
  - `acceptance_smoke`
  - `completeness`
  - `compliance`
  - `source_validation`
  - `adversarial_review`
- Store evidence-policy details on validation checklist records.
- Make required passing items without item-level or checklist-level evidence fail the checklist deterministically for evidence-required gates.
- Add formatting output that shows missing evidence item ids.
- Add unit tests for evidence-required pass/fail behavior and non-evidence-required gates.
- Add mocked integration for a checklist command that initially fails from missing evidence then passes when evidence is supplied.
- Add opt-in real Pi command coverage if deterministic/cheap.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not add CI/sandbox execution.
- Do not add dependency/test-first ordering yet.
- Do not infer evidence from model prose.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-060: add validation evidence policy plan`
2. `IMPL-250: add validation checklist evidence policy`
3. `IMPL-251: cover mocked validation evidence policy flow`
4. `IMPL-252: add real Pi validation evidence policy coverage`
5. `IMPL-253: document validation evidence policy coverage`
