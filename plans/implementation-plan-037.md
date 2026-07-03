# Implementation Plan 037 — Correct PLAN/IMPL Ledger and Split Integration Suite

## Goal
Correct the recent PLAN/IMPL ledger so PLAN commits are not represented as implementation tasks, preserve the IMPL task numbers already defined by their plans, and move integration tests into a dedicated suite folder with support documentation for future agents.

## Scope
- Restore Plan 035/036 task references so implementation commits match the task descriptions already defined in those plans.
- Move integration tests from `test/integration.test.ts` to a dedicated integration suite folder.
- Update the `npm test` script so unit tests and integration-suite tests both run by default.
- Add full integration-suite documentation describing implementation style, mock runners, optional real Pi/model mode, cardinal instructions, configuration, and extension rules.
- Update manuals/inventory/matrix/backlog references.

## Atomic tasks

### PLAN-037 — Plan
- Create this plan and commit it. This is a PLAN task, not an IMPL task.

### IMPL-144 — Correct ledger references and integration suite layout
- Preserve Plan 035 and Plan 036 IMPL task numbers rather than renumbering implementations to unrelated task descriptions.
- Move integration tests into `test/integration/`.
- Update package test script and path references.
- Add `test/integration/README.md`.
- Run `npm test` and `npm run build`.

### IMPL-145 — Document integration-suite support
- Update manuals, inventory, traceability, and backlog references.
- Run `npm test` and `npm run build`.

## Validation

```bash
npm test
npm run build
```
