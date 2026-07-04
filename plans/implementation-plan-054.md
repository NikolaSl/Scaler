# Implementation Plan 054 — GAP-022 Next-Approach Retry Execution

## Goal
Turn accepted debug `next_approach` reports into a deterministic supervised retry workflow that executes the approach through the task-agent path, reruns the exact previously failing validation command(s), and records the outcome as durable debug/validation evidence without auto-accepting replans or full task completion.

## Scope
- Add `.scaler/debug/retries.json` retry records that link task id, debug report id, prior failed validation run, exact validation commands, task-agent run outcome, exact-validation outcome, and follow-up state.
- Add a `debug-retry` runner that:
  - selects an explicit/current debugging task;
  - requires the latest accepted `next_approach` debug report;
  - requires a previous failed validation run and selects its failed required command(s);
  - injects the next approach and exact failing validation target into the task-agent context;
  - runs under the repo-wide execution lock;
  - in prepare mode writes the prompt/invocation/retry record without executing the child agent;
  - in execute mode runs the task agent, then reruns only the exact failed validation command(s) after a successful child run;
  - records a structured debug attempt as `fixed` when the exact validation passes, or `same_failure`/`blocked` when it fails or cannot run;
  - leaves exact-validation-pass tasks in `validating` for full validation, and moves exact-validation-fail tasks back to `debugging`.
- Add `/scaler-debug-retry [taskId] [execute]` command wiring and parser coverage.
- Add unit tests for report/validation selection, context injection, retry record persistence, and exact-validation state handling.
- Add mocked integration coverage for validation failure → debug next approach → retry execution → exact validation pass/fail outcomes.
- Add opt-in real Pi/model coverage only if a narrow cardinal contract can remain deterministic and cheap.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not auto-accept replans.
- Do not mark a task `validated` from exact-validation success; full required validation still runs separately.
- Do not infer or execute arbitrary shell patches from prose outside a supervised task-agent retry.
- Do not add policy-driven automatic retry starts yet; the retry command remains explicit.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-054: add next-approach retry execution plan`
2. `IMPL-218: add debug next-approach retry runner`
3. `IMPL-219: add debug retry command`
4. `IMPL-220: cover mocked next-approach retry flow`
5. `IMPL-221: add real Pi next-approach retry coverage`
6. `IMPL-222: document next-approach retry coverage`
