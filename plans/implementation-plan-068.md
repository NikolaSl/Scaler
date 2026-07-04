# Implementation Plan 068 — GAP-009 Validation Sandbox Lifecycle Evidence

## Goal
Close the remaining GAP-009 slice by adding automatic validation sandbox/local-CI lifecycle handling around declared non-host validation environments.

## Scope
- Detect declared validation environments (`local_ci`, Docker, Compose, devcontainer, Minikube) before command execution.
- Probe external sandbox tools when needed and block required validation commands with lifecycle evidence when required tooling is unavailable.
- Persist prepare/cleanup lifecycle records under `.scaler/reports/validation-environments.json` and link lifecycle evidence from validation command-run records.
- Add a status command for recent lifecycle records.
- Add unit, mocked integration, and targeted opt-in real Pi coverage for local-CI lifecycle records and unavailable sandbox blocking via injected probes.
- Update manuals, inventory, traceability, and backlog to describe implemented behavior.

## Non-goals
- Do not generate project Dockerfiles, Compose files, dev containers, or Kubernetes manifests.
- Do not start or stop user-managed services beyond the validation command itself.
- Do not bypass safety approval rules for host-level destructive, secret, deployment, or external actions.

## Validation
- Targeted validation lifecycle unit and mocked integration tests.
- Targeted real Pi validation lifecycle test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-068: add validation sandbox lifecycle plan`
2. `IMPL-278: add validation sandbox lifecycle records`
3. `IMPL-279: cover validation sandbox lifecycle flows`
4. `IMPL-280: document validation sandbox lifecycle coverage`
