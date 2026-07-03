# Implementation Plan 024 — Bounded Stage Conductor Loop

## Goal

Continue closing GAP-001 by adding bounded multi-step stage-conductor automation that can chain deterministic stage advancement across PRD, knowledge, planning, replanning, execution, and completion without requiring an operator to manually invoke each single step.

## Scope

- Add a bounded stage-conductor loop helper that repeatedly runs the existing one-step conductor.
- Stop deterministically on max steps, unsupported stages, rejected advancement, prepared stage-agent handoff, stage-agent execution without advancement, or completion.
- Carry forward updated supervisor state after each successful stage advancement.
- Add a command for the bounded loop.
- Update docs, inventory, traceability, and gap backlog.

## Atomic tasks

### IMPL-104 — Add bounded stage-conductor loop helper

- Add `runStageConductorLoop` to `src/stage-conductor.ts`.
- Include result metadata: steps, final state, completion flag, and stop reason.
- Add tests for pre-existing ready artifacts chaining, execute-mode child reports chaining, prepare-mode stopping at stage-agent handoff, and max-step stopping.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-105 — Add bounded stage loop command

- Add argument parsing for `/scaler-stage-loop [execute] [max=N]`.
- Register `/scaler-stage-loop` and wire it to `runStageConductorLoop`.
- Update command registration tests and command parsing tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-106 — Document bounded stage loop

- Document `/scaler-stage-loop` and current stopping rules.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
