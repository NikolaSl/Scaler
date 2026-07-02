# Implementation Plan 018 — Replanner Proposal Acceptance

## Goal

Continue closing GAP-003 by letting SCALER consume replan requests and publish a replacement execution plan from a staged proposal with preservation checks, snapshots, task application, and audit records.

## Scope

- Add a staged proposed-plan artifact under `.scaler/plans/proposed-plan.json`.
- Add replan decision records under `.scaler/plans/replan-decisions.json`.
- Add helpers for proposal validation/status and acceptance.
- Acceptance must check preservation before replacing the current plan.
- Acceptance snapshots the previous current plan, saves the proposed plan as current, applies missing tasks, marks open replan requests resolved, and records the decision.
- Add commands to inspect and accept proposals.
- Update docs and traceability.

## Atomic tasks

### IMPL-082 — Proposed plan and decision artifacts

- Add paths for proposed plan and replan decisions.
- Add load/save proposed plan helpers.
- Add decision record schema, load/save/format helpers.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-083 — Replan proposal acceptance workflow

- Add a deterministic acceptance helper that compares current and proposed plans using preservation checks.
- Reject unsafe proposals that drop validated tasks/requirements or leave runtime requirements unlinked.
- On accepted proposal: snapshot current plan, save proposed as current active plan, apply missing tasks, resolve open replan requests, and record the decision.
- Add tests.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-084 — Replan proposal commands

- Add `/scaler-replan-proposal-status`.
- Add `/scaler-replan-accept`.
- Update command parsing/registration tests as needed.
- Run `npm test` and `npm run build`.
- Commit.

### IMPL-085 — Documentation and traceability

- Document proposed plans, decisions, and commands.
- Update implementation inventory, traceability matrix, and gap backlog.
- Run `npm test` and `npm run build`.
- Commit.
