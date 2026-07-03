# Implementation Plan 020 — Stage Agent Preparation

## Goal

Continue GAP-001 by preparing focused Stage I-IV agent invocations that can produce the stage artifacts introduced in Plan 019.

## Scope

- Add deterministic prompt builders for `prd`, `knowledge`, `planning`, `execution`, and `replanning` stage agents.
- Build Pi subprocess invocation preparation for a selected stage without executing by default.
- Record stage-agent runs when execution is enabled in a later task.
- Add commands to prepare/run stage agents and list their run records.
- Update docs and traceability.

## Atomic tasks

### IMPL-090 — Stage agent prompt and invocation builder

- Add a stage-agent module that builds focused prompts from supervisor state and stage artifacts.
- Add stage-to-goal contracts for PRD, knowledge, planning, execution, and replanning stages.
- Add invocation preparation using the existing Pi subprocess invocation builder.
- Add unit tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-091 — Stage agent run records and execution helper

- Add `.scaler/reports/stage-agent-runs.json` records.
- Add prepare/execute helper protected by the execution lock.
- Record success/failure and stage artifact guidance.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-092 — Stage agent commands

- Add `/scaler-stage-run <stage> [execute]`.
- Add `/scaler-stage-runs [stage]`.
- Update command registration tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-093 — Documentation and traceability

- Document stage agent preparation/runs and current limitations.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
