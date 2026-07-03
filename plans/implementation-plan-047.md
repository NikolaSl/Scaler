# Implementation Plan 047 — GAP-009 Typed Validation Gates

## Goal
Strengthen validation manifests with typed gate metadata and richer default software gate discovery, while preserving the current deterministic command-runner behavior.

## Scope
- Add validation gate kind normalization for software, security, CI/smoke, regression, and non-software evidence gates.
- Extend validation command manifests/run records with optional `gate`, `expectedResult`, and `evidenceRefs` metadata.
- Classify default `package.json` scripts into gate kinds (`npm test` → unit tests, `npm run build` → build/compile, lint/typecheck/format/static, audit/security, integration/smoke where present).
- Extend `/scaler-validation-add` parsing/command handling with optional gate and expected result fields.
- Add unit tests for gate normalization, manifest persistence, default gate classification, command parsing, and run-record metadata.
- Add mocked integration coverage proving command-added gate metadata persists through validation and audit logs.
- Add opt-in real Pi extension command-dispatch coverage for `/scaler-validation-add` with typed gate metadata.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not implement full non-software checklist adjudication in this slice.
- Do not implement Docker/devcontainer/Compose/Minikube execution yet.
- Do not change pass/fail semantics: required commands still determine command-run validation status.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-047: add typed validation gate plan`
2. `IMPL-183: add validation gate metadata core`
3. `IMPL-184: wire validation gate command metadata`
4. `IMPL-185: add mocked validation gate integration coverage`
5. `IMPL-186: add real validation gate command coverage`
6. `IMPL-187: document typed validation gate coverage`
