# Implementation Plan 062 — GAP-009 CI/Sandbox Validation Policy

## Goal
Add deterministic CI/sandbox validation metadata and policy checks so local CI, Docker/Compose/dev-container/Minikube-style validation does not silently execute as ordinary host validation.

## Scope
- Extend validation manifest commands and run records with `environment` metadata.
- Extend `/scaler-validation-add` with an optional ninth field for environment (`host`, `docker`, `compose`, `devcontainer`, `minikube`, `local_ci`).
- Normalize environment aliases and persist them in `.scaler/reports/validation-manifests.json` and `.scaler/reports/validation-runs.json`.
- Update validation policy diagnostics:
  - required `local_ci` gates must declare a sandbox/CI environment, not default host;
  - commands that invoke Docker/Compose/dev-container/Minikube tooling must declare a matching non-host environment;
  - acceptance/smoke host execution records a warning unless a non-host environment is declared.
- Keep execution command-based; this slice enforces declaration/policy before execution and does not build containers automatically.
- Add unit tests, mocked integration, and opt-in real Pi command coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not provision Docker/Compose/dev-container/Minikube environments automatically.
- Do not add scanner tool execution beyond metadata/policy enforcement.
- Do not weaken host safety hooks.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-062: add validation environment policy plan`
2. `IMPL-258: add validation environment metadata policy`
3. `IMPL-259: cover mocked validation environment policy flow`
4. `IMPL-260: add real Pi validation environment policy coverage`
5. `IMPL-261: document validation environment policy coverage`
