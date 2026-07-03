# Implementation Plan 042 — Real Pi Flow-Parity Integration Tests

## Goal
Expand opt-in real Pi integration coverage so it mirrors the highest-value mocked integration flows as closely as practical while staying cardinal, bounded, and explicitly gated.

## Motivation
Current real tests validate individual structured-output contracts and real extension command/tool/hook boundaries. The mocked suite validates multi-step SCALER workflows. To reduce risk before larger project investment, add real Pi/model tests that exercise chained ledger mutations rather than only single report contracts.

## Constraints

- Real tests remain skipped unless `SCALER_REAL_PI_INTEGRATION=1`.
- Default `npm test` remains deterministic and must not call real Pi or real models.
- Use provider-qualified real model defaults through `scripts/run-real-integration.sh`.
- Use cardinal instructions for every real-model output.
- Assert persisted `.scaler/` ledgers and audit logs, not prose.
- Keep each real scenario small enough for practical opt-in runs.
- Do not weaken structured-only ingestion rules.

## Atomic tasks

### PLAN-042 — Plan
- Create this plan and commit it before implementation.

### IMPL-157 — Real debug → research → next approach chain
Add an opt-in real Pi/model test that mirrors `mock/debug-research-flow.test.ts`:

- create a temp repo and debugging task;
- seed repeated debug attempts/retry-gate context;
- run the focused debug agent with a cardinal `needs_research` structured report;
- assert research request ledger creation;
- run the focused research agent with a cardinal complete research report for the generated request;
- assert report ledger and request resolution;
- run the focused debug agent again with a cardinal `next_approach` report;
- assert debug report ledger, audit events, and state consistency.

This uses real Pi/model child-agent subprocesses via the normal `run*AgentStep` pathways, with scripted cardinal instructions per step.

### IMPL-158 — Real stage conductor chain
Add an opt-in real Pi/model test that mirrors the mocked Stage I-IV conductor flow:

- seed a runtime PRD requirement and start supervisor stage at `prd`;
- run `runStageConductorLoop` with a real Pi/model stage-agent runner;
- use cardinal stage artifact JSON for `prd`, `knowledge`, `planning`, and `execution`;
- pre-create small local artifact files where readiness requires paths;
- assert artifacts, run records, advancement steps, final `completed` stage, and audit logs.

### IMPL-159 — Real replan proposal acceptance chain
Add an opt-in real Pi/model test that mirrors the mocked runtime PRD coverage-gap replan flow:

- seed existing validated work, runtime PRD requirements, current execution plan, and a replan request;
- run the focused replanner agent with a cardinal preservation-safe proposal;
- assert proposed-plan persistence and preservation result;
- accept the proposal;
- assert current plan replacement, version snapshot, replan decision, request resolution, and task creation.

### IMPL-160 — Document real flow-parity layer
- Update `test/integration/README.md` and `manual/testing.md` with the new chained real flow-parity layer.
- Update `implementation-inventory.md`, `traceability-matrix.md`, and `gap-backlog.md` if coverage statements change.
- Run real suite, `npm test`, and `npm run build`.

## Validation commands

Default deterministic validation:

```bash
npm test
npm run build
```

Opt-in real validation:

```bash
./scripts/run-real-integration.sh
```

## Non-goals

- Do not move real tests into default CI.
- Do not attempt arbitrary autonomous real-model flows without cardinal instructions.
- Do not require real network/browser research.
- Do not close GAP-022: these tests validate real chained components but do not implement the automatic bounded validation-failure → debug/research/replan conductor loop.
