# Implementation Plan 061 — GAP-009 Dependency/Test-First Validation Policy

## Goal
Add deterministic validation-manifest policy checks so dependency and test-first gates execute before ordinary validation gates and block validation before expensive commands if required ordering gates are missing or misplaced.

## Scope
- Add validation policy evaluation for `TaskValidationManifest`:
  - required `dependency_check` commands must appear before non-policy gates when present;
  - required `test_first` commands must appear before implementation validation gates when present;
  - manifests with implementation gates but no dependency/test-first gate get warning diagnostics, not failure, to avoid blocking existing projects without explicit policy gates;
  - duplicate policy checks are allowed and all must run before dependent gate classes.
- Persist policy diagnostics on validation run records.
- Make policy failures produce a failed validation run with synthetic required command records and no subprocess execution for blocked expensive gates.
- Add formatting/audit coverage through existing validation summaries.
- Add unit tests for pass, ordering failure, and missing-gate warnings.
- Add mocked integration for command-driven manifest policy blocking before an expensive command.
- Add opt-in real Pi command persistence coverage if deterministic/cheap.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not provision CI/sandbox execution.
- Do not infer test-first status from VCS history.
- Do not auto-create dependency/test-first commands.
- Do not change default package-script manifests to fail projects without explicit policy gates.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-061: add validation gate policy plan`
2. `IMPL-254: add validation gate policy diagnostics`
3. `IMPL-255: cover mocked validation gate policy flow`
4. `IMPL-256: add real Pi validation gate policy coverage`
5. `IMPL-257: document validation gate policy coverage`
