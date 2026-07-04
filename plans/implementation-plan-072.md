# Implementation Plan 072 — GAP-022 Debug Retry Policy Automation

## Goal
Close GAP-022 by adding explicit policy controls for debug next-approach retry automation, approval gating, and optional post-exact-pass validation/commit chaining.

## Scope
- Persist debug retry policy under `.scaler/debug/retry-policy.json`.
- Add `/scaler-debug-retry-policy` for `auto-start`, `require-approval`, and `post-exact-pass` controls.
- Add a scoped retry approval ledger under `.scaler/debug/retry-approvals.json` plus `/scaler-debug-retry-approve`.
- Route `/scaler-debug-retry` through the policy wrapper, including approval checks and optional full-validation/commit chaining after exact validation passes.
- Let the bounded debug conductor auto-start retry when policy enables it, without auto-accepting replans.
- Add unit, command, mocked integration, and targeted opt-in real Pi coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not auto-accept replan proposals.
- Do not skip exact failing validation after a retry.
- Do not make auto-start the default.
- Do not commit unless full validation passes and `post-exact-pass=validate-commit` is explicitly configured.

## Validation
- Targeted debug retry policy unit/command/mock tests.
- Targeted real Pi retry-policy command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-072: add debug retry policy plan`
2. `IMPL-290: add debug retry policy automation`
3. `IMPL-291: cover debug retry policy flows`
4. `IMPL-292: document debug retry policy coverage`
