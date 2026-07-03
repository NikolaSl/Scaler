# Implementation Plan 036 — Integration Test Harness

## Goal
Add deterministic integration tests that exercise SCALER workflows across modules and persisted `.scaler/` artifacts, avoiding over-reliance on local unit tests that can preserve incorrect component behavior.

## Compliance rule
Integration scenarios must be derived from `assignement.md` and relevant `specs/*.md` in addition to `requirements-catalog.md` and `traceability-matrix.md`.

## Scope
- Add a temp-repository integration harness with deterministic fake child-agent runners.
- Add optional real-Pi/model execution mode gated by environment variables.
- Add cardinal test instructions prepended/appended to real-model prompts so real/local model runs can deterministically emit the required structured JSON event no matter what other context says.
- Cover an end-to-end debug/research/replan-ish workflow using persisted state/artifacts.
- Cover structured-only ingestion rejection for free-form child output.
- Document how to run mock and optional real integration tests.

## Atomic tasks

### PLAN-036 — Plan
- Create this plan and commit it. This is a PLAN task, not an IMPL task.

### IMPL-142 — Integration harness and scenarios
- Add integration tests using temp repos and fake child-agent runners.
- Include optional real Pi/model runner controlled by environment variables.
- Validate persisted `.scaler/` artifacts across conductor, validation, debug, research, and replan escalation boundaries.
- Run `npm test` and `npm run build`.

### IMPL-143 — Documentation and traceability
- Document integration test modes and cardinal instruction behavior.
- Update inventory/traceability/backlog if coverage changes.
- Run `npm test` and `npm run build`.

## Optional real integration environment

Default tests use mock runners only. Optional real runs should be skipped unless explicitly enabled, for example:

```bash
SCALER_REAL_PI_INTEGRATION=1 SCALER_REAL_PI_MODEL=<model> npm test
```

Real-mode prompts must include a cardinal instruction at the top that requires the exact structured event expected by the test.
