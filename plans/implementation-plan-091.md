# Implementation Plan 091: Deterministic CI/CD sandbox provisioning and validation wrappers

## Gap
GAP-029: validation environment metadata/probe/cleanup evidence exists, but SCALER does not deterministically create/update local CI, Docker, Compose, dev-container, or Minikube validation environments or execute validation through generated controlled sandbox wrappers when plans require it.

## Scope
- IMPL-347: Add CI/CD environment provisioning records, stack/tooling detection, generated wrapper/config files, safety checks, scanner planning, and status formatting.
- IMPL-348: Wire non-host validation commands through generated sandbox/local-CI execution wrappers with lifecycle/provision refs and add slash-command access to provision/status records.
- IMPL-349: Cover CI/CD provisioning and sandbox wrapper execution with unit, mocked integration, opt-in real command coverage, and documentation/traceability updates closing GAP-029.

## Validation
- Unit tests for deterministic generated files, safety checks, scanner limitation records, and local-CI wrapper execution.
- Command/unit tests for `/scaler-cicd-env` parsing and extension command registration.
- Mocked integration for CI/CD provision command plus validation running through a generated local-CI wrapper.
- Opt-in real Pi command test for CI/CD provision/status persistence.
- Full `npm run build`, `npm test`, and `./scripts/run-real-integration.sh` after the slice.
